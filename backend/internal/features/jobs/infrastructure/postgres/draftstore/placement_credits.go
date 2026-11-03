package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CorrectPlacementCredit shares the vacancy row lock with all board/team writes.
// It deliberately does not require a resource ETag or an active process.
func (s *Store) CorrectPlacementCredit(ctx context.Context, company, actor, id, pid, cid uuid.UUID, restore bool, key string, keyPresent bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	auth, err := s.lockGates(ctx, tx, company, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	record, found, err := readDraft(ctx, tx, company, id, true, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found || !authorized(auth, actor, record) {
		return drafts.Result{}, draftAccessError(ctx, tx, actor, record, found)
	}
	if err = requireV2ReadDocument(record.fields); err != nil {
		return drafts.Result{}, err
	}
	if auth.role != roleOwner {
		return drafts.Result{}, vacancyteam.ErrForbidden
	}
	if !keyPresent {
		return drafts.Result{}, drafts.ErrIdempotencyKeyRequired
	}
	parsed, err := uuid.Parse(key)
	if err != nil {
		return drafts.Result{}, drafts.ErrInvalidIdempotencyKey
	}
	key = parsed.String()
	value, err := draftjson.Decode(body)
	if err != nil {
		return drafts.Result{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 0 {
		return drafts.Result{}, drafts.ErrInvalidRequest
	}
	fingerprint, err := draftjson.EncodeValidatedValue(map[string]any{"id": id.String(), "participation_id": pid.String(), "credit_id": cid.String(), "body": root})
	if err != nil {
		return drafts.Result{}, err
	}
	cause := "owner_void"
	if restore {
		cause = "owner_restore"
	}
	operation := "placement-credit:" + cause + ":r1"
	replay, err := replayTeamWrite(ctx, tx, company, actor, operation, key, fingerprint)
	if err != nil {
		return drafts.Result{}, err
	}
	if replay.Replayed {
		return replay, nil
	}
	var status string
	var episodeOpen bool
	err = tx.QueryRow(ctx, `SELECT c.status,c.exit_history_id IS NULL FROM placement_credits c JOIN process_participations p ON p.id=c.participation_id AND p.process_id=c.process_id WHERE c.company_id=$1 AND c.process_id=$2 AND c.participation_id=$3 AND c.id=$4`, company, id, pid, cid).Scan(&status, &episodeOpen)
	if errors.Is(err, pgx.ErrNoRows) {
		return drafts.Result{}, drafts.ErrNotFound
	}
	if err != nil {
		return drafts.Result{}, err
	}
	next := "voided"
	if restore {
		if status != "voided" {
			return drafts.Result{}, vacancyteam.RuleError("credit_status_unchanged")
		}
		next = "did_not_hold"
		if episodeOpen {
			next = "active"
		}
	} else if status == "voided" {
		return drafts.Result{}, vacancyteam.RuleError("credit_status_unchanged")
	}
	at := s.clock().UTC().Truncate(time.Microsecond)
	if _, err = tx.Exec(ctx, `UPDATE placement_credits SET status=$2,status_changed_at=$3,status_changed_by=$4 WHERE id=$1`, cid, next, at, actor); err != nil {
		return drafts.Result{}, err
	}
	if err = s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyPlacementCreditChanged", EntityType: "process_participation", EntityID: pid, Metadata: map[string]string{"company_id": company.String(), "vacancy_id": id.String(), "credit_id": cid.String(), "from_status": status, "to_status": next, "cause": cause}}); err != nil {
		return drafts.Result{}, err
	}
	raw, err := db.ReadPlacementCredits(ctx, tx, id, pid)
	if err != nil {
		return drafts.Result{}, err
	}
	var credits []json.RawMessage
	if err = json.Unmarshal(raw, &credits); err != nil {
		return drafts.Result{}, err
	}
	var result drafts.Result
	for _, raw := range credits {
		var item struct {
			ID uuid.UUID `json:"id"`
		}
		if err = json.Unmarshal(raw, &item); err != nil {
			return result, err
		}
		if item.ID == cid {
			result.Body = raw
			break
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.Must(uuid.NewV7()), company, actor, operation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, result.Body, ""); err != nil {
		return drafts.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return drafts.Result{}, err
	}
	return result, nil
}
