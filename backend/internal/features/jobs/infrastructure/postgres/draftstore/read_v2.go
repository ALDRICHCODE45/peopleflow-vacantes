package draftstore

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
)

var _ drafts.V2Reader = (*Store)(nil)

// GetV2 reads only schema-2 employer drafts without changing the v1 Store.
// The method itself selects the expected version, never the stored row.
func (s *Store) GetV2(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin get v2 tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return drafts.Result{}, err
	}
	record, found, err := readDraft(ctx, tx, companyID, id, false)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.Result{}, drafts.ErrNotFound
	}
	if err := requireV2ReadDocument(record.fields); err != nil {
		return drafts.Result{}, err
	}
	name, err := requesterNameForRead(ctx, tx, companyID, record.fields)
	if err != nil {
		return drafts.Result{}, err
	}
	body, err := renderGeoEnvelopeV2(ctx, tx, record, name)
	if err != nil {
		return drafts.Result{}, err
	}
	etag, err := draftversion.FormatETagV2(record.id.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format get v2 etag: %w", err)
	}
	return drafts.Result{Body: body, ETag: etag}, nil
}

// requireV2ReadDocument runs after authorization: known v1 is hidden, while
// invalid/unknown markers and noncanonical v2 values are server failures.
func requireV2ReadDocument(canonical []byte) error {
	value, err := draftjson.Decode(canonical)
	if err != nil {
		return fmt.Errorf("decode stored v2 draft schema: %w", err)
	}
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return errors.New("draftstore: stored draft envelope is not an object")
	}
	version, ok := object["schema_version"].(int64)
	if !ok {
		return errors.New("draftstore: missing or invalid stored schema version")
	}
	if version == 1 {
		return drafts.ErrNotFound
	}
	if version != 2 {
		return errors.New("draftstore: unknown stored schema version")
	}
	if err := draftinput.ValidatePersistedDraftV2(canonical); err != nil {
		return fmt.Errorf("validate stored v2 draft: %w", err)
	}
	return nil
}

// renderEnvelopeV2 accepts only the validated record from GetV2. It preserves
// the employer's typed screening, including answer keys, without a v1 projection.
func renderEnvelopeV2(record draftRecord, requesterName *string) ([]byte, error) {
	fields, err := envelopeFieldsOf(record.fields)
	if err != nil {
		return nil, err
	}
	plain, err := deriveDescriptionPlain(fields["description"])
	if err != nil {
		return nil, err
	}
	fields["description_plain"] = plain
	if requester, ok := fields["requester"].(map[string]any); ok {
		var name any
		if requesterName != nil {
			name = *requesterName
		}
		requester["name"] = name
	}
	body, err := draftjson.EncodeValidatedValue(map[string]any{
		"schema_version":         int64(2),
		"id":                     record.id.String(),
		"status":                 record.status,
		"principal_recruiter_id": record.principalID.String(),
		"version":                strconv.FormatInt(record.version, 10),
		"created_at":             record.createdAt.UTC().Format(timestampLayout),
		"updated_at":             record.updatedAt.UTC().Format(timestampLayout),
		"fields":                 fields,
	})
	if err != nil {
		return nil, fmt.Errorf("encode v2 read envelope: %w", err)
	}
	return body, nil
}
