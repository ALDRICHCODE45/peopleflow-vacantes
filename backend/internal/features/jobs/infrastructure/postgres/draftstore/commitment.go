package draftstore

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const commitmentOperation = "vacancy-commitment:r1"

var _ deliveryconfig.CommitmentStore = (*Store)(nil)

func commitmentFingerprint(id uuid.UUID, body []byte) ([]byte, error) {
	if len(body) > deliveryconfig.MaxBodyBytes {
		return nil, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, drafts.ErrInvalidRequest
	}
	if input, err := deliveryconfig.DecodeCommitment(body); err == nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		value, err = draftjson.Decode(raw)
		if err != nil {
			return nil, err
		}
	}
	return draftjson.EncodeValidatedValue(map[string]any{"id": id.String(), "body": value})
}

// The parent draft lock serializes renegotiations with delivery, publication and
// team writes. Frozen fulfillment snapshots are deliberately never rewritten.
func (s *Store) RenegotiateCommitment(ctx context.Context, company, actor, id uuid.UUID, key string, keyPresent bool, tag string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	if err = s.authorizePipeline(ctx, tx, company, actor, id, true); err != nil {
		return drafts.Result{}, err
	}
	if !keyPresent {
		return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
	}
	parsed, err := uuid.Parse(key)
	if err != nil {
		return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
	}
	key = parsed.String()
	if err = lockIdempotencyKey(ctx, tx, company, actor, commitmentOperation, key); err != nil {
		return drafts.Result{}, err
	}
	existing, found, err := findIdempotency(ctx, tx, company, actor, commitmentOperation, key)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		fingerprint, err := commitmentFingerprint(id, body)
		if err != nil {
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
	current, version, err := readDelivery(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err = pipelineconfig.CheckIfMatch(deliveryconfig.ETag(id, version), tag, present); err != nil {
		return drafts.Result{}, err
	}
	published, err := lockDeliveryProcess(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if !published {
		return drafts.Result{}, fulfillment.ErrNotPublished
	}
	if version == 0 {
		return drafts.Result{}, deliveryconfig.ErrDeliveryNotConfigured
	}
	input, err := deliveryconfig.DecodeCommitment(body)
	if err != nil {
		return drafts.Result{}, err
	}
	fingerprint, err := commitmentFingerprint(id, body)
	if err != nil {
		return drafts.Result{}, err
	}
	if current.CommitmentDate != nil && *current.CommitmentDate == input.Date {
		return drafts.Result{}, deliveryconfig.ErrCommitmentUnchanged
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	change := uuid.Must(uuid.NewV7())
	now := s.clock().UTC().Truncate(time.Microsecond)
	if _, err = tx.Exec(ctx, `UPDATE job_draft_delivery_configs SET commitment_date=$2::date,version=version+1 WHERE draft_id=$1`, id, input.Date); err != nil {
		return drafts.Result{}, fmt.Errorf("update commitment: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vacancy_commitment_changes(id,draft_id,company_id,previous_date,new_date,reason,note,performed_by,performed_at) VALUES($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9)`, change, id, company, current.CommitmentDate, input.Date, input.Reason, input.Note, actor, now); err != nil {
		return drafts.Result{}, fmt.Errorf("record commitment change: %w", err)
	}
	previous := ""
	if current.CommitmentDate != nil {
		previous = *current.CommitmentDate
	}
	event := audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyCommitmentRenegotiated", EntityType: "vacancy", EntityID: id, Metadata: map[string]string{"company_id": company.String(), "change_id": change.String(), "previous_date": previous, "new_date": input.Date, "reason": input.Reason}}
	if err = s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write commitment audit: %w", err)
	}
	current.CommitmentDate = &input.Date
	calendar, err := s.deliveryCalendar()
	if err != nil {
		return drafts.Result{}, err
	}
	frozen, _, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	result, err := renderDelivery(id, current, version+1, calendar, frozen != nil)
	if err != nil {
		return drafts.Result{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.Must(uuid.NewV7()), company, actor, commitmentOperation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, result.Body, result.ETag); err != nil {
		return drafts.Result{}, fmt.Errorf("freeze commitment response: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return drafts.Result{}, err
	}
	return result, nil
}
