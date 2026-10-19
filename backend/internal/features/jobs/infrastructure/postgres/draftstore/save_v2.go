package draftstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ drafts.V2Saver = (*Store)(nil)

// SaveV2 implements drafts.V2Saver.SaveV2. The store order is fixed: general
// gates, scoped row FOR UPDATE, owner/principal authorization, full persisted
// v2 validation, r2 precondition, patch decode, schema-2 merge, then the CAS
// write with its co-written audit event. Resource and schema errors precede
// precondition and body errors, and every error returns a zero Result.
func (s *Store) SaveV2(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin save v2 tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return drafts.Result{}, err
	}
	record, found, err := readDraft(ctx, tx, companyID, id, true)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.Result{}, drafts.ErrNotFound
	}
	// Schema gate after authorization and before precondition/body: a known
	// v1 row is hidden, while a corrupt or unknown marker and an invalid
	// persisted v2 document are server invariant failures, never mapped to
	// client validation.
	if err := requireV2ReadDocument(record.fields); err != nil {
		return drafts.Result{}, err
	}
	tag, err := draftversion.ParseIfMatchV2(ifMatch, present)
	if err != nil {
		return drafts.Result{}, mapPreconditionError(err)
	}
	if err := draftversion.Compare(draftversion.Tag{ID: id.String(), Version: record.version}, tag); err != nil {
		return drafts.Result{}, drafts.ErrVersionConflict
	}
	patch, err := draftinput.DecodePatchV2(body)
	if err != nil {
		return drafts.Result{}, mapInputError(err)
	}
	merged, err := mergeWritableV2(record.fields, patch.Fingerprint())
	if err != nil {
		return drafts.Result{}, err
	}

	candidate := record
	candidate.fields = merged
	if err := s.guardPublishedWrite(ctx, tx, candidate); err != nil {
		return drafts.Result{}, err
	}

	if bytes.Equal(merged, record.fields) {
		name, err := requesterNameForRead(ctx, tx, companyID, record.fields)
		if err != nil {
			return drafts.Result{}, err
		}
		responseBody, err := renderEnvelopeV2(record, name)
		if err != nil {
			return drafts.Result{}, err
		}
		etag, err := draftversion.FormatETagV2(record.id.String(), record.version)
		if err != nil {
			return drafts.Result{}, fmt.Errorf("format save v2 no-op etag: %w", err)
		}
		if err := refreshPublicProjection(ctx, tx, record); err != nil {
			return drafts.Result{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return drafts.Result{}, fmt.Errorf("commit published no-op save: %w", err)
		}
		return drafts.Result{Body: responseBody, ETag: etag}, nil
	}

	if record.version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	newVersion := record.version + 1

	name, err := requesterNameForWrite(ctx, tx, companyID, merged)
	if err != nil {
		return drafts.Result{}, err
	}

	var updatedAt time.Time
	if err := tx.QueryRow(ctx,
		`UPDATE job_drafts
		    SET fields = $1, version = $2, updated_at = now()
		  WHERE id = $3 AND company_id = $4 AND version = $5
		  RETURNING updated_at`,
		merged, newVersion, id, companyID, record.version,
	).Scan(&updatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Defense-in-depth: the row is locked FOR UPDATE, so a lost CAS is
			// unreachable via the designed flow.
			return drafts.Result{}, drafts.ErrVersionConflict
		}
		return drafts.Result{}, fmt.Errorf("update v2 draft: %w", err)
	}

	record.fields, record.version, record.updatedAt = merged, newVersion, updatedAt
	if err := refreshPublicProjection(ctx, tx, record); err != nil {
		return drafts.Result{}, err
	}

	responseBody, err := renderEnvelopeV2(record, name)
	if err != nil {
		return drafts.Result{}, err
	}
	etag, err := draftversion.FormatETagV2(record.id.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format save v2 etag: %w", err)
	}

	if err := s.audit.Append(ctx, tx, newDraftEvent(actorID, entities.EventJobDraftSaved, id, record.version)); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write draft v2 save audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit save v2 tx: %w", err)
	}
	return drafts.Result{Body: responseBody, ETag: etag}, nil
}

// mergeWritableV2 replaces every group present in the schema-2 delta over the
// current persisted fields and re-encodes the canonical schema-2 envelope.
// Absent fields, their order and the root schema_version 2 marker are
// preserved; there is no nested merge. The merged full 17-field document is
// revalidated before it can be treated as a stored document.
func mergeWritableV2(current, delta []byte) ([]byte, error) {
	currentFields, err := envelopeFieldsOf(current)
	if err != nil {
		return nil, err
	}
	deltaFields, err := envelopeFieldsOf(delta)
	if err != nil {
		return nil, err
	}

	merged := make(map[string]any, len(currentFields)+len(deltaFields))
	for key, value := range currentFields {
		merged[key] = value
	}
	for key, value := range deltaFields {
		merged[key] = value
	}

	encoded, err := draftjson.EncodeValidatedValue(map[string]any{
		"schema_version": int64(2),
		"fields":         merged,
	})
	if err != nil {
		return nil, fmt.Errorf("encode merged v2 fields: %w", err)
	}
	if err := draftinput.ValidatePersistedDraftV2(encoded); err != nil {
		return nil, fmt.Errorf("validate merged v2 draft: %w", err)
	}
	return encoded, nil
}
