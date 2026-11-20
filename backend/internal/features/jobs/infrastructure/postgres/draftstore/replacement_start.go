package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/replacement"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var _ replacement.Store = (*Store)(nil)

const replacementOperation = "vacancy-replacement:r1"

// replacementFingerprint is the canonical body bound to the source id: one key
// cannot replay a different source, and whitespace is immaterial.
func replacementFingerprint(source uuid.UUID, body []byte) ([]byte, error) {
	if len(body) > pipelineconfig.MaxBodyBytes {
		return nil, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, drafts.ErrInvalidRequest
	}
	return draftjson.EncodeValidatedValue(map[string]any{"id": source.String(), "body": value})
}

type person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// startedReplacement is the 201 body, keys in the contract's order. Only id, kind,
// lifecycle and the headers are decoded by the frontend; the rest is informative.
type startedReplacement struct {
	ID                 string                 `json:"id"`
	Kind               string                 `json:"kind"`
	Sequence           int32                  `json:"sequence"`
	ReplacementOf      string                 `json:"replacement_of"`
	RootProcessID      string                 `json:"root_process_id"`
	Visibility         string                 `json:"visibility"`
	StartedAt          string                 `json:"started_at"`
	StartedBy          person                 `json:"started_by"`
	Responsible        person                 `json:"responsible"`
	TargetQuantity     int                    `json:"target_quantity"`
	CommitmentDate     string                 `json:"commitment_date"`
	PlacementCreditIDs []string               `json:"placement_credit_ids"`
	StageMap           []stageMapEntry        `json:"stage_map"`
	Carried            []carriedParticipation `json:"carried"`
	Delivery           startedDelivery        `json:"delivery"`
	Source             startedSource          `json:"source"`
	Lifecycle          lifecycle.View         `json:"lifecycle"`
}

// startedDelivery is the delivery after the carried candidates: a replacement that
// carries nobody starts with nothing delivered.
type startedDelivery struct {
	Delivered int  `json:"delivered"`
	Target    int  `json:"target"`
	Fulfilled bool `json:"fulfilled"`
}

type startedSource struct {
	ID              string         `json:"id"`
	FinishedByStart bool           `json:"finished_by_start"`
	Lifecycle       lifecycle.View `json:"lifecycle"`
}

// StartReplacement implements replacement.Store (contract «POST V/replacements»).
// Order inside one transaction: general gates and source draft lock (as lifecycle
// transitions), key shape, replay, the root and source process locks (§Concurrency),
// If-Match, source closed, latest of the chain, body, credits, carried candidates,
// responsible; then the clone, the links, the carried participations and the finish
// of a closed-active source (D15), atomically.
func (s *Store) StartReplacement(ctx context.Context, companyID, actorID, id uuid.UUID, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, auth, err := s.publicationDraftAs(ctx, tx, companyID, actorID, id, true)
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
	if err = lockIdempotencyKey(ctx, tx, companyID, actorID, replacementOperation, key); err != nil {
		return drafts.Result{}, err
	}
	existing, found, err := findIdempotency(ctx, tx, companyID, actorID, replacementOperation, key)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		fingerprint, err := replacementFingerprint(id, body)
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

	// Lock order: source draft (above) → root process → source process → credits.
	// With the root held, the chain read below is the chain this start commits to.
	if err = lockReplacementChain(ctx, tx, companyID, id); err != nil {
		return drafts.Result{}, err
	}
	current, version, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err = lifecycle.CheckPrecondition(id, version, ifMatch, present); err != nil {
		return drafts.Result{}, err
	}
	if current.Publication == nil || *current.Publication != "closed" {
		return drafts.Result{}, &replacement.SourceNotClosed{Lifecycle: current}
	}
	chain, _, err := readReplacementChain(ctx, tx, companyID, id)
	if err != nil {
		return drafts.Result{}, err
	}
	latest := chain.latest()
	if latest.ID != id {
		if active, ok := chain.activeReplacement(); ok {
			return drafts.Result{}, &lifecycle.ReplacementAlreadyActive{ProcessID: active.ID.String(), RootProcessID: chain.Root.String(), Lifecycle: current}
		}
		return drafts.Result{}, &replacement.SourceNotLatest{LatestProcessID: latest.ID.String(), RootProcessID: chain.Root.String(), Lifecycle: current}
	}
	calendar, err := s.deliveryCalendar()
	if err != nil {
		return drafts.Result{}, err
	}
	req, err := replacement.Decode(body, calendar)
	if err != nil {
		return drafts.Result{}, err
	}
	if err = checkReplacementCredits(ctx, tx, companyID, chain, req.CreditIDs); err != nil {
		return drafts.Result{}, err
	}
	newID := uuid.Must(uuid.NewV7())
	plans, err := s.planCarried(ctx, tx, chain, id, newID, req.Carried)
	if err != nil {
		return drafts.Result{}, err
	}
	responsible := actorID
	if req.Responsible != nil && *req.Responsible != actorID {
		// Handing the replacement over is an owner action (vacancy-team-v1 «Reassign the responsible»).
		if auth.role != roleOwner {
			return drafts.Result{}, vacancyteam.ErrForbidden
		}
		var member bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2 AND role<>'stakeholder')`, companyID, *req.Responsible).Scan(&member); err != nil {
			return drafts.Result{}, err
		}
		if !member {
			return drafts.Result{}, vacancyteam.ErrNotCompanyMember
		}
		responsible = *req.Responsible
	}
	fingerprint, err := replacementFingerprint(id, body)
	if err != nil {
		return drafts.Result{}, err
	}

	now := s.clock().UTC().Truncate(time.Microsecond)
	sequence := latest.Sequence + 1
	finishSource := current.Process != nil && *current.Process == "active"

	draft := draftRecord{id: newID, companyID: companyID, createdBy: actorID, principalID: responsible, status: "draft", version: 1}
	if err = tx.QueryRow(ctx, `INSERT INTO job_drafts (id, company_id, created_by, status, version, fields, requester_kind, requester_id)
 SELECT $1, company_id, $3, 'draft', 1, fields, requester_kind, requester_id FROM job_drafts WHERE id=$2
 RETURNING fields, created_at, updated_at`, newID, id, actorID).Scan(&draft.fields, &draft.createdAt, &draft.updatedAt); err != nil {
		return drafts.Result{}, fmt.Errorf("clone draft: %w", err)
	}
	entries, err := s.cloneReplacementConfiguration(ctx, tx, id, newID, req)
	if err != nil {
		return drafts.Result{}, err
	}
	if err = s.createTeamFor(ctx, tx, draft, actorID, responsible); err != nil {
		return drafts.Result{}, err
	}
	// A process row without a public projection is private; publishing is R3c.
	if _, err = tx.Exec(ctx, `INSERT INTO vacancy_processes (id,company_id,status,published_at,published_by) VALUES ($1,$2,'published',$3,$4)`, newID, companyID, now, actorID); err != nil {
		return drafts.Result{}, fmt.Errorf("insert replacement process: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO vacancy_replacements (process_id,company_id,source_process_id,root_process_id,sequence,started_at,started_by,target_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, newID, companyID, id, chain.Root, sequence, now, actorID, req.TargetQuantity); err != nil {
		return drafts.Result{}, fmt.Errorf("link replacement: %w", err)
	}
	for _, credit := range req.CreditIDs {
		if _, err = tx.Exec(ctx, `INSERT INTO vacancy_replacement_credits (replacement_process_id,placement_credit_id) VALUES ($1,$2)`, newID, credit); err != nil {
			return drafts.Result{}, fmt.Errorf("link replaced credit: %w", err)
		}
	}
	carried, err := s.insertCarried(ctx, tx, actorID, newID, now, plans)
	if err != nil {
		return drafts.Result{}, err
	}
	delivery := startedDelivery{Target: req.TargetQuantity}
	if len(carried) > 0 {
		if delivery, err = s.recordCarriedDelivery(ctx, tx, actorID, newID, now, carried); err != nil {
			return drafts.Result{}, err
		}
	}
	var actorName, responsibleName string
	if err = tx.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, actorID).Scan(&actorName); err != nil {
		return drafts.Result{}, err
	}
	if err = tx.QueryRow(ctx, `SELECT full_name FROM users WHERE id=$1`, responsible).Scan(&responsibleName); err != nil {
		return drafts.Result{}, err
	}

	if finishSource {
		if err = s.finishSourceForReplacement(ctx, tx, companyID, actorID, actorName, id, newID, version, now); err != nil {
			return drafts.Result{}, err
		}
	}

	// The responses render what this transaction commits.
	sourceView, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	newView, _, err := readLifecycle(ctx, tx, newID)
	if err != nil {
		return drafts.Result{}, err
	}
	creditIDs := make([]string, len(req.CreditIDs))
	for i, credit := range req.CreditIDs {
		creditIDs[i] = credit.String()
	}
	response, err := json.Marshal(startedReplacement{
		ID: newID.String(), Kind: "replacement", Sequence: sequence, ReplacementOf: id.String(), RootProcessID: chain.Root.String(), Visibility: "private",
		StartedAt: now.Format(timestampLayout), StartedBy: person{actorID.String(), actorName}, Responsible: person{responsible.String(), responsibleName},
		TargetQuantity: req.TargetQuantity, CommitmentDate: req.CommitmentDate, PlacementCreditIDs: creditIDs, StageMap: entries, Carried: append([]carriedParticipation{}, carried...),
		Delivery:  delivery,
		Source:    startedSource{ID: id.String(), FinishedByStart: finishSource, Lifecycle: sourceView},
		Lifecycle: newView,
	})
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render replacement: %w", err)
	}
	etag := lifecycle.ETag(newID, 1)
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_idempotency(id,company_id,actor_id,operation,idem_key,fingerprint,fingerprint_algorithm,response_body,response_etag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, uuid.Must(uuid.NewV7()), companyID, actorID, replacementOperation, key, fingerprintDigest(fingerprint), FingerprintAlgorithmSHA256, response, etag); err != nil {
		return drafts.Result{}, fmt.Errorf("write replacement idempotency: %w", err)
	}

	if err = s.audit.Append(ctx, tx, newDraftEvent(actorID, companyID, audit.EventJobDraftCreated, newID, 1)); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write replacement draft audit: %w", err)
	}
	started := audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actorID, EventType: audit.EventVacancyReplacementStarted, EntityType: "vacancy_process", EntityID: newID, CompanyID: &companyID, VacancyID: &newID,
		StructuredMetadata: map[string]any{
			"company_id": companyID.String(), "vacancy_id": newID.String(), "source_process_id": id.String(), "root_process_id": chain.Root.String(), "sequence": int(sequence),
			"target_quantity": req.TargetQuantity, "credit_ids": req.SortedCreditIDs(), "carried_count": len(carried), "visibility": "private", "responsible_user_id": responsible.String(),
		}}
	if err = s.audit.Append(ctx, tx, started); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write replacement audit: %w", err)
	}
	if err = s.auditCarried(ctx, tx, companyID, actorID, newID, carried); err != nil {
		return drafts.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit replacement: %w", err)
	}
	return drafts.Result{Body: response, ETag: etag}, nil
}

// lockReplacementChain takes the root process row, then the source's when it is
// another, each in a fresh statement (contract §Concurrency). A source that never
// published has no process row and no chain: nothing to lock.
func lockReplacementChain(ctx context.Context, tx pgx.Tx, companyID, source uuid.UUID) error {
	chain, found, err := readReplacementChain(ctx, tx, companyID, source)
	if err != nil || !found {
		return err
	}
	for _, id := range []uuid.UUID{chain.Root, source} {
		if id == source && chain.Root == source {
			break
		}
		var locked uuid.UUID
		if err = tx.QueryRow(ctx, `SELECT id FROM vacancy_processes WHERE id=$1 FOR UPDATE`, id).Scan(&locked); err != nil {
			return fmt.Errorf("lock replacement chain: %w", err)
		}
	}
	return nil
}

// checkReplacementCredits locks the requested credits and validates each one
// (contract «Start preconditions» 5): of a process of the chain, did_not_hold and
// not replaced yet. Problems are reported in request order.
func checkReplacementCredits(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, chain replacementChain, requested []uuid.UUID) error {
	inChain := map[uuid.UUID]bool{}
	for _, p := range chain.Processes {
		inChain[p.ID] = true
	}
	rows, err := tx.Query(ctx, `SELECT c.id, c.process_id, c.status, EXISTS (SELECT 1 FROM vacancy_replacement_credits vc WHERE vc.placement_credit_id=c.id)
 FROM placement_credits c WHERE c.company_id=$1 AND c.id = ANY($2) ORDER BY c.id FOR UPDATE OF c`, companyID, requested)
	if err != nil {
		return fmt.Errorf("lock replacement credits: %w", err)
	}
	type credit struct {
		process  uuid.UUID
		status   string
		replaced bool
	}
	byID := map[uuid.UUID]credit{}
	for rows.Next() {
		var id uuid.UUID
		var c credit
		if err = rows.Scan(&id, &c.process, &c.status, &c.replaced); err != nil {
			rows.Close()
			return err
		}
		byID[id] = c
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	var problems []replacement.CreditProblem
	for _, id := range requested {
		c, ok := byID[id]
		switch {
		case !ok || !inChain[c.process]:
			problems = append(problems, replacement.CreditProblem{CreditID: id.String(), Reason: replacement.CreditNotInChain})
		case c.status != "did_not_hold":
			problems = append(problems, replacement.CreditProblem{CreditID: id.String(), Reason: replacement.CreditNotDidNotHold})
		case c.replaced:
			problems = append(problems, replacement.CreditProblem{CreditID: id.String(), Reason: replacement.CreditAlreadyReplaced})
		}
	}
	if len(problems) > 0 {
		return &replacement.CreditsInvalid{Credits: problems}
	}
	return nil
}

// cloneReplacementConfiguration copies the source's per-process configuration to
// the new draft and returns the stage map (contract «What is cloned»). Every
// source configuration is its effective one: no row means the defaults.
func (s *Store) cloneReplacementConfiguration(ctx context.Context, tx pgx.Tx, source, newID uuid.UUID, req replacement.Request) ([]stageMapEntry, error) {
	pipeline, _, err := readPipeline(ctx, tx, source)
	if err != nil {
		return nil, err
	}
	cloned, entries := clonePipeline(pipeline, newID)
	if err = pipelineconfig.Validate(cloned); err != nil {
		return nil, fmt.Errorf("validate cloned pipeline: %w", err)
	}
	encoded, err := json.Marshal(cloned)
	if err != nil {
		return nil, fmt.Errorf("encode cloned pipeline: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_pipeline_configs (draft_id, version, configuration) VALUES ($1, 1, $2)`, newID, encoded); err != nil {
		return nil, fmt.Errorf("clone pipeline: %w", err)
	}
	mapping := stageIDMap(entries)

	// Substate catalogs hold no stage ids: copied as rows.
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_substate_catalogs (draft_id, version, catalog) SELECT $2, 1, catalog FROM job_draft_substate_catalogs WHERE draft_id=$1`, source, newID); err != nil {
		return nil, fmt.Errorf("clone substates: %w", err)
	}
	// Checklist reminders and psychometric auto-send name stages: they follow the stage map.
	for _, doc := range []struct{ table, column, key string }{
		{"job_draft_checklists", "checklist", "reminder_stage_ids"},
		{"job_draft_psychometric_profiles", "profile", "auto_send_stage_ids"},
	} {
		var raw []byte
		err = tx.QueryRow(ctx, fmt.Sprintf(`SELECT %s FROM %s WHERE draft_id=$1`, doc.column, doc.table), source).Scan(&raw)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", doc.table, err)
		}
		if raw, err = remapStageIDs(raw, doc.key, mapping); err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, fmt.Sprintf(`INSERT INTO %s (draft_id, version, %s) VALUES ($1, 1, $2)`, doc.table, doc.column), newID, raw); err != nil {
			return nil, fmt.Errorf("clone %s: %w", doc.table, err)
		}
	}

	delivery, _, err := readDelivery(ctx, tx, source)
	if err != nil {
		return nil, err
	}
	var cutoff pgtype.UUID
	if delivery.CutoffStageID != nil {
		if next, ok := mapping[*delivery.CutoffStageID]; ok {
			cutoff = pgtype.UUID{Bytes: uuid.MustParse(next), Valid: true}
		}
	}
	commitment, err := time.Parse(time.DateOnly, req.CommitmentDate)
	if err != nil {
		return nil, fmt.Errorf("encode commitment date: %w", err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_delivery_configs (draft_id,version,cutoff_stage_id,target_quantity,commitment_date) VALUES ($1,1,$2,$3,$4)`, newID, cutoff, req.TargetQuantity, pgtype.Date{Time: commitment, Valid: true}); err != nil {
		return nil, fmt.Errorf("clone delivery: %w", err)
	}
	today, err := s.managementToday()
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO job_draft_management_configs (draft_id,version,request_date,hiring_headcount,target_close_date) VALUES ($1,1,$2::date,$3,NULL)`, newID, today, req.TargetQuantity); err != nil {
		return nil, fmt.Errorf("clone management: %w", err)
	}
	return entries, nil
}

// finishSourceForReplacement is D15: the closed-active source finishes in the
// same transaction as the start, with the lifecycle event and the audit event
// that names the replacement.
func (s *Store) finishSourceForReplacement(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, actorName string, source, replacementID uuid.UUID, version int64, now time.Time) error {
	if _, err := tx.Exec(ctx, `UPDATE vacancy_processes SET process_status='finished',process_finished_at=$2,lifecycle_version=$3 WHERE id=$1`, source, now, version+1); err != nil {
		return fmt.Errorf("finish replaced source: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,process,actor_id,actor_name,created_at,reason,reason_note) VALUES($1,$2,$3,'finish_process',NULL,$4,$5,$6,NULL,NULL)`, uuid.Must(uuid.NewV7()), source, version+1, actorID, actorName, now); err != nil {
		return fmt.Errorf("write finish history: %w", err)
	}
	event := newDraftEvent(actorID, companyID, audit.EventVacancyProcessFinished, source, version+1)
	event.EntityType = "vacancy_process"
	event.Metadata["publication"] = "closed"
	event.Metadata["process"] = "finished"
	event.Metadata["cause"] = "replacement_started"
	event.Metadata["replacement_process_id"] = replacementID.String()
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return fmt.Errorf("co-write replaced source audit: %w", err)
	}
	return nil
}
