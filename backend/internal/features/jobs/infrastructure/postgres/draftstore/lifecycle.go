package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ lifecycle.Store = (*Store)(nil)

const lifecycleOperation = "vacancy-lifecycle:r1"

// Both reads take the same shared parent lock as publication, providing one
// coherent view without creating configuration, history or idempotency rows.
func (s *Store) GetLifecycle(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = s.publicationDraft(ctx, tx, companyID, actorID, id, false); err != nil {
		return drafts.Result{}, err
	}
	view, version, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	return lifecycleResult(id, view, version)
}
func (s *Store) GetLifecycleHistory(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = s.publicationDraft(ctx, tx, companyID, actorID, id, false); err != nil {
		return drafts.Result{}, err
	}
	rows, err := tx.Query(ctx, `SELECT id::text,action,process,actor_id::text,actor_name,created_at FROM vacancy_lifecycle_events WHERE process_id=$1 ORDER BY created_at DESC,lifecycle_version DESC`, id)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("read lifecycle history: %w", err)
	}
	defer rows.Close()
	items := []lifecycle.Event{}
	for rows.Next() {
		var e lifecycle.Event
		var at time.Time
		if err = rows.Scan(&e.ID, &e.Action, &e.Process, &e.Actor.ID, &e.Actor.Name, &at); err != nil {
			return drafts.Result{}, err
		}
		e.CreatedAt = at.UTC().Format(timestampLayout)
		items = append(items, e)
	}
	if err = rows.Err(); err != nil {
		return drafts.Result{}, err
	}
	body, err := json.Marshal(struct {
		Items []lifecycle.Event `json:"items"`
	}{items})
	return drafts.Result{Body: body}, err
}

func (s *Store) TransitionLifecycle(ctx context.Context, companyID, actorID, id uuid.UUID, action, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	record, err := s.publicationDraft(ctx, tx, companyID, actorID, id, true)
	if err != nil {
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
	if err = lockIdempotencyKey(ctx, tx, companyID, actorID, lifecycleOperation, key); err != nil {
		return drafts.Result{}, err
	}
	existing, found, err := findIdempotency(ctx, tx, companyID, actorID, lifecycleOperation, key)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		fingerprint, err := lifecycleFingerprint(id, action, body)
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
	current, version, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err = lifecycle.CheckPrecondition(id, version, ifMatch, present); err != nil {
		return drafts.Result{}, err
	}
	// Invalid state precedes body validation and readiness, just like publish's
	// already-published check. A bad close choice never defaults to continue.
	allowed := false
	for _, v := range current.AllowedActions {
		if action == v && action != "publish" {
			allowed = true
		}
	}
	if !allowed {
		return drafts.Result{}, &lifecycle.InvalidTransition{Action: action, Lifecycle: current}
	}
	fingerprint, choice, err := lifecyclePayload(id, action, body)
	if err != nil {
		return drafts.Result{}, err
	}
	now := s.clock().UTC().Truncate(time.Microsecond)
	next, err := lifecycle.Transition(current, action, choice, now)
	if err != nil {
		return drafts.Result{}, err
	}
	if action == "resume" || action == "reopen" {
		// The shared guard exempts clock passage only. Reopening never resets
		// pipeline, participation, fulfillment, authoring versions or history.
		if err = s.guardPublishedWrite(ctx, tx, record); err != nil {
			return drafts.Result{}, err
		}
	}
	result, err := lifecycleResult(id, next, version+1)
	if err != nil {
		return drafts.Result{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE vacancy_processes SET status=$2,process_status=$3,lifecycle_version=$4,published_at=$5::text::timestamptz,paused_at=$6::text::timestamptz,closed_at=$7::text::timestamptz,process_finished_at=$8::text::timestamptz WHERE id=$1`, id, *next.Publication, *next.Process, version+1, next.PublishedAt, next.PausedAt, next.ClosedAt, next.ProcessFinishedAt); err != nil {
		return drafts.Result{}, fmt.Errorf("write lifecycle: %w", err)
	}
	var actorName string
	if err = tx.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, actorID).Scan(&actorName); err != nil {
		return drafts.Result{}, err
	}
	var process *string
	if action == "close" {
		process = &choice
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,process,actor_id,actor_name,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, uuid.Must(uuid.NewV7()), id, version+1, action, process, actorID, actorName, now); err != nil {
		return drafts.Result{}, fmt.Errorf("write lifecycle history: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.Must(uuid.NewV7()), companyID, actorID, lifecycleOperation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, result.Body, result.ETag); err != nil {
		return drafts.Result{}, fmt.Errorf("write lifecycle idempotency: %w", err)
	}
	event := newDraftEvent(actorID, lifecycleAuditType(action), id, version+1)
	event.EntityType = "vacancy_process"
	event.Metadata["publication"] = *next.Publication
	event.Metadata["process"] = *next.Process
	if err = s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write lifecycle audit: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit lifecycle: %w", err)
	}
	return result, nil
}

func lifecycleAuditType(action string) string {
	switch action {
	case "pause":
		return audit.EventVacancyPaused
	case "resume":
		return audit.EventVacancyResumed
	case "close":
		return audit.EventVacancyClosed
	case "finish_process":
		return audit.EventVacancyProcessFinished
	case "reopen":
		return audit.EventVacancyReopened
	default:
		return ""
	}
}

func readLifecycle(ctx context.Context, tx pgx.Tx, id uuid.UUID) (lifecycle.View, int64, error) {
	view := lifecycle.View{Version: "0"}
	var version int64
	var pub, process string
	var published time.Time
	var paused, closed, finished *time.Time
	err := tx.QueryRow(ctx, `SELECT status,process_status,lifecycle_version,published_at,paused_at,closed_at,process_finished_at FROM vacancy_processes WHERE id=$1`, id).Scan(&pub, &process, &version, &published, &paused, &closed, &finished)
	if errors.Is(err, pgx.ErrNoRows) {
		view.AllowedActions = lifecycle.AllowedActions(view)
		return view, 0, nil
	}
	if err != nil {
		return view, 0, fmt.Errorf("read lifecycle: %w", err)
	}
	timestamp := func(at *time.Time) *string {
		if at == nil {
			return nil
		}
		v := at.UTC().Format(timestampLayout)
		return &v
	}
	view.Publication = &pub
	view.Process = &process
	view.Version = strconv.FormatInt(version, 10)
	view.PublishedAt = timestamp(&published)
	view.PausedAt = timestamp(paused)
	view.ClosedAt = timestamp(closed)
	view.ProcessFinishedAt = timestamp(finished)
	view.AllowedActions = lifecycle.AllowedActions(view)
	return view, version, nil
}
func lifecycleResult(id uuid.UUID, view lifecycle.View, version int64) (drafts.Result, error) {
	body, err := json.Marshal(view)
	if err != nil {
		return drafts.Result{}, err
	}
	return drafts.Result{Body: body, ETag: lifecycle.ETag(id, version)}, nil
}

// Replay fingerprints any valid JSON before fresh-request body validation, as
// publication does: changed payloads conflict even if no longer valid input.
func lifecycleFingerprint(id uuid.UUID, action string, body []byte) ([]byte, error) {
	if len(body) > pipelineconfig.MaxBodyBytes {
		return nil, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, drafts.ErrInvalidRequest
	}
	return draftjson.EncodeValidatedValue(map[string]any{"id": id.String(), "action": action, "body": value})
}

// Canonical fingerprints include both resource and action. One actor's key
// cannot silently replay a different draft/action; whitespace is immaterial.
func lifecyclePayload(id uuid.UUID, action string, body []byte) ([]byte, string, error) {
	if len(body) > pipelineconfig.MaxBodyBytes {
		return nil, "", drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, "", drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, "", drafts.ErrInvalidRequest
	}
	choice := ""
	if action == "close" {
		choice, _ = root["process"].(string)
		if len(root) != 1 || choice != "continue" && choice != "finish" {
			return nil, "", drafts.ErrInvalidRequest
		}
	} else if len(root) != 0 {
		return nil, "", drafts.ErrInvalidRequest
	}
	fingerprint, err := draftjson.EncodeValidatedValue(map[string]any{"id": id.String(), "action": action, "body": root})
	return fingerprint, choice, err
}
