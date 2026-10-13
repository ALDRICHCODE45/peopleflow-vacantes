package draftstore

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const createV2Operation = "create:v2"

var _ drafts.V2Writer = (*Store)(nil)

// CreateV2 creates only schema-2 employer drafts. The separate operation
// namespace prevents v1/v2 key collisions; the transaction co-writes the draft,
// digest-tagged idempotency response and audit event. Routes remain unwired.
func (s *Store) CreateV2(ctx context.Context, companyID, actorID uuid.UUID, key string, body []byte) (drafts.Result, error) {
	if key == "" {
		return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
	}
	parsedKey, err := uuid.Parse(key)
	if err != nil {
		return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
	}
	canonicalKey := parsedKey.String()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin create v2 tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return drafts.Result{}, err
	}
	create, err := draftinput.DecodeCreateV2(body)
	if err != nil {
		return drafts.Result{}, mapInputError(err)
	}
	fingerprint := create.Fingerprint()
	if err := lockIdempotencyKey(ctx, tx, companyID, actorID, createV2Operation, canonicalKey); err != nil {
		return drafts.Result{}, err
	}
	existing, found, err := findIdempotency(ctx, tx, companyID, actorID, createV2Operation, canonicalKey)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		if err := authorizeAddressedDraftV2(ctx, tx, auth, actorID, companyID, existing.etag); err != nil {
			return drafts.Result{}, err
		}
		match, err := fingerprintsMatch(existing.algorithm, existing.fingerprint, fingerprint)
		if err != nil {
			return drafts.Result{}, err
		}
		if !match {
			return drafts.Result{}, drafts.ErrIdempotencyConflict
		}
		return drafts.Result{Body: existing.body, ETag: existing.etag, Replayed: true}, nil
	}
	name, err := requesterNameForWrite(ctx, tx, companyID, fingerprint)
	if err != nil {
		return drafts.Result{}, err
	}
	draftID := uuid.Must(uuid.NewV7())
	record := draftRecord{id: draftID, companyID: companyID, createdBy: actorID, principalID: actorID, status: "draft", version: 1, fields: fingerprint}
	if err := tx.QueryRow(ctx,
		`INSERT INTO job_drafts (id, company_id, created_by, principal_recruiter_id, status, version, fields)
   VALUES ($1, $2, $3, $4, 'draft', 1, $5) RETURNING created_at, updated_at`,
		draftID, companyID, actorID, actorID, fingerprint,
	).Scan(&record.createdAt, &record.updatedAt); err != nil {
		return drafts.Result{}, fmt.Errorf("insert v2 draft: %w", err)
	}
	responseBody, err := renderEnvelopeV2(record, name)
	if err != nil {
		return drafts.Result{}, err
	}
	etag, err := draftversion.FormatETagV2(draftID.String(), record.version)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("format create v2 etag: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO job_draft_idempotency
   (id, company_id, actor_id, operation, idem_key, fingerprint, fingerprint_algorithm, response_body, response_etag)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		uuid.Must(uuid.NewV7()), companyID, actorID, createV2Operation, canonicalKey,
		fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, responseBody, etag,
	); err != nil {
		return drafts.Result{}, fmt.Errorf("insert v2 idempotency record: %w", err)
	}
	if err := s.audit.Append(ctx, tx, newDraftEvent(actorID, entities.EventJobDraftCreated, draftID, record.version)); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write draft v2 create audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit create v2 tx: %w", err)
	}
	return drafts.Result{Body: responseBody, ETag: etag}, nil
}

// authorizeAddressedDraftV2 checks the current authorized row, not the frozen
// response: replay keeps the original bytes even if the draft was later saved.
// The r2 ETag and schema gate are explicit, never selected from client input.
func authorizeAddressedDraftV2(ctx context.Context, tx pgx.Tx, auth authContext, actorID, companyID uuid.UUID, etag string) error {
	tag, err := draftversion.ParseIfMatchV2(etag, true)
	if err != nil {
		return fmt.Errorf("parse stored v2 idempotency etag: %w", err)
	}
	draftID, err := uuid.Parse(tag.ID)
	if err != nil {
		return fmt.Errorf("parse stored v2 idempotency draft id: %w", err)
	}
	record, found, err := readDraft(ctx, tx, companyID, draftID, false)
	if err != nil {
		return err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.ErrNotFound
	}
	return requireV2ReadDocument(record.fields)
}
