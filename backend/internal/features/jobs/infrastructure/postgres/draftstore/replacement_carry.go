package draftstore

import (
	"context"
	"fmt"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/replacement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Carried candidates of a replacement (docs/contracts/replacement-processes-v1.md,
// «Carried candidates»): a candidate of the logical vacancy is reused as a NEW
// participation of the replacement, at a stage the recruiter chose among the
// SOURCE process' stages, never Placement and never the exit.

// carryTemplate is a candidate's most recent participation in the chain: what a
// carry copies and what decides whether the candidate may be carried.
type carryTemplate struct {
	participation uuid.UUID
	process       uuid.UUID
	stage         uuid.UUID
	discarded     bool
}

// carryPlan is one validated carried candidate. stage is the replacement's stage.
type carryPlan struct {
	candidate replacement.CarriedCandidate
	template  carryTemplate
	stage     uuid.UUID
}

type carriedIdentity struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// carriedParticipation is one entry of the 201's `carried`, keys in the contract's order.
type carriedParticipation struct {
	ParticipationID string          `json:"participation_id"`
	CarriedFrom     string          `json:"carried_from_participation_id"`
	Candidate       carriedIdentity `json:"candidate"`
	StageID         string          `json:"stage_id"`
	// plan stays out of the wire: the audit and the delivery hook read it.
	plan carryPlan
}

func carryKey(c replacement.CarriedCandidate) string { return c.Kind + ":" + c.ID.String() }

// readCarryTemplates resolves, for every requested candidate, its most recent
// participation (created_at DESC, id DESC) in any process of the chain. The kind
// is the identity column: organic = candidate_id (also for a manual intake of an
// organic account), manual = company_candidate_id. A candidate with no
// participation in the chain (another company's included) has no entry.
func readCarryTemplates(ctx context.Context, tx pgx.Tx, chain replacementChain, requested []replacement.CarriedCandidate) (map[string]carryTemplate, error) {
	processes := make([]uuid.UUID, len(chain.Processes))
	for i, p := range chain.Processes {
		processes[i] = p.ID
	}
	kinds, ids := make([]string, len(requested)), make([]uuid.UUID, len(requested))
	for i, c := range requested {
		kinds[i], ids[i] = c.Kind, c.ID
	}
	rows, err := tx.Query(ctx, `WITH req AS (SELECT r.kind, r.id FROM unnest($2::text[], $3::uuid[]) AS r(kind, id))
SELECT DISTINCT ON (req.kind, req.id) req.kind, req.id, p.id, p.process_id, p.stage_id, p.discarded_at IS NOT NULL
FROM req JOIN process_participations p ON p.process_id = ANY($1::uuid[])
 AND ((req.kind = 'organic' AND p.candidate_id = req.id) OR (req.kind = 'manual' AND p.company_candidate_id = req.id))
ORDER BY req.kind, req.id, p.created_at DESC, p.id DESC`, processes, kinds, ids)
	if err != nil {
		return nil, fmt.Errorf("read carry templates: %w", err)
	}
	defer rows.Close()
	out := map[string]carryTemplate{}
	for rows.Next() {
		var c replacement.CarriedCandidate
		var t carryTemplate
		if err = rows.Scan(&c.Kind, &c.ID, &t.participation, &t.process, &t.stage, &t.discarded); err != nil {
			return nil, err
		}
		out[carryKey(c)] = t
	}
	return out, rows.Err()
}

// planCarried validates the carried candidates and maps their stages. A candidate
// problem (not_in_chain, currently_placed, duplicate) outranks a stage problem
// (stage_not_found, stage_is_placement, stage_is_exit): the first kind that has
// any is reported, for every offending index, in request order. Nothing is
// written. The chain read is the one the root and source process locks make
// consistent: every other process of the chain is finished, so only a late
// departure (a discard out of Placement) can still change a template, and that
// only ever makes a candidate eligible.
func (s *Store) planCarried(ctx context.Context, tx pgx.Tx, chain replacementChain, source, newID uuid.UUID, requested []replacement.CarriedCandidate) ([]carryPlan, error) {
	if len(requested) == 0 {
		return nil, nil
	}
	templates, err := readCarryTemplates(ctx, tx, chain, requested)
	if err != nil {
		return nil, err
	}
	placement := map[uuid.UUID]uuid.UUID{}
	placementOf := func(process uuid.UUID) (uuid.UUID, error) {
		if id, ok := placement[process]; ok {
			return id, nil
		}
		pipeline, _, err := readPipeline(ctx, tx, process)
		if err != nil {
			return uuid.Nil, err
		}
		for _, stage := range pipeline.Stages {
			if stage.Kind == "placement" {
				id, err := uuid.Parse(stage.ID)
				if err != nil {
					return uuid.Nil, err
				}
				placement[process] = id
				return id, nil
			}
		}
		return uuid.Nil, fmt.Errorf("process %s has no placement stage", process)
	}
	var problems []replacement.CarriedProblem
	found := make([]carryTemplate, len(requested))
	seen := map[string]bool{}
	for i, c := range requested {
		key := carryKey(c)
		if seen[key] {
			problems = append(problems, replacement.CarriedProblem{Index: i, Reason: replacement.CandidateDuplicate})
			continue
		}
		seen[key] = true
		t, ok := templates[key]
		if !ok {
			problems = append(problems, replacement.CarriedProblem{Index: i, Reason: replacement.CandidateNotInChain})
			continue
		}
		at, err := placementOf(t.process)
		if err != nil {
			return nil, err
		}
		if !t.discarded && t.stage == at {
			problems = append(problems, replacement.CarriedProblem{Index: i, Reason: replacement.CandidateCurrentlyPlaced})
			continue
		}
		found[i] = t
	}
	if len(problems) > 0 {
		return nil, &replacement.CarriedCandidatesInvalid{Candidates: problems}
	}

	// Stages are named by the source's ids and mapped like the clone maps them.
	pipeline, _, err := readPipeline(ctx, tx, source)
	if err != nil {
		return nil, err
	}
	cloned, entries := clonePipeline(pipeline, newID)
	byID := make(map[string]stageMapEntry, len(entries))
	for _, e := range entries {
		byID[e.SourceStageID] = e
	}
	plans := make([]carryPlan, len(requested))
	for i, c := range requested {
		entry, ok := byID[c.StageID.String()]
		switch {
		case !ok:
			problems = append(problems, replacement.CarriedProblem{Index: i, Reason: replacement.StageNotFound})
		case entry.Kind == "placement":
			problems = append(problems, replacement.CarriedProblem{Index: i, Reason: replacement.StageIsPlacement})
		case entry.Kind == cloned.Exit.Kind:
			problems = append(problems, replacement.CarriedProblem{Index: i, Reason: replacement.StageIsExit})
		default:
			plans[i] = carryPlan{candidate: c, template: found[i], stage: uuid.MustParse(entry.StageID)}
		}
	}
	if len(problems) > 0 {
		return nil, &replacement.CarriedStagesInvalid{Candidates: problems}
	}
	return plans, nil
}

// insertCarried creates the carried participations in the replacement, in request
// order: a copy of the template (identity, source, CV references, snapshots,
// channel) with a fresh life: version 1, never discarded, created at the start,
// `added_by` the caller for a manual source, and the lineage. Each gets the one
// `intake` history row a manual intake writes and runs the stage-entry hook. The
// delivery is accounted by the caller once they all exist.
func (s *Store) insertCarried(ctx context.Context, tx pgx.Tx, actor, newID uuid.UUID, now time.Time, plans []carryPlan) ([]carriedParticipation, error) {
	out := make([]carriedParticipation, len(plans))
	for i, plan := range plans {
		pid := uuid.Must(uuid.NewV7())
		if _, err := tx.Exec(ctx, `INSERT INTO process_participations(id,process_id,candidate_id,company_candidate_id,cv_version_id,company_candidate_cv_id,corrected_company_cv_id,stage_id,source,added_by,version,created_at,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,carried_from_participation_id)
 SELECT $1,$2,candidate_id,company_candidate_id,cv_version_id,company_candidate_cv_id,corrected_company_cv_id,$3,source,CASE WHEN source='manual' THEN $4::uuid END,1,$5,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,id
 FROM process_participations WHERE id=$6`, pid, newID, plan.stage, actor, now, plan.template.participation); err != nil {
			return nil, fmt.Errorf("carry participation: %w", err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind) VALUES($1,$2,$3,$4,$5,NULL,false,false,'recruiter','intake')`, uuid.Must(uuid.NewV7()), pid, plan.stage, actor, now); err != nil {
			return nil, fmt.Errorf("carry history: %w", err)
		}
		if s.stageEntry != nil {
			if err := s.stageEntry.OnStageEntered(ctx, tx, newID, pid, plan.stage, "intake"); err != nil {
				return nil, fmt.Errorf("carry stage entry: %w", err)
			}
		}
		out[i] = carriedParticipation{
			ParticipationID: pid.String(), CarriedFrom: plan.template.participation.String(),
			Candidate: carriedIdentity{Kind: plan.candidate.Kind, ID: plan.candidate.ID.String()}, StageID: plan.stage.String(), plan: plan,
		}
	}
	return out, nil
}

// recordCarriedDelivery accounts the carried intakes for the replacement's
// delivery with the manual-intake rule (assumption A3) and reads the result: at
// the cutoff stage, or after it, a carried candidate is delivered and the delivery
// may fulfil inside the start.
func (s *Store) recordCarriedDelivery(ctx context.Context, tx pgx.Tx, actor, newID uuid.UUID, now time.Time, carried []carriedParticipation) (startedDelivery, error) {
	for _, c := range carried {
		if err := s.RecordDelivery(ctx, tx, newID, actor, c.plan.stage, now); err != nil {
			return startedDelivery{}, fmt.Errorf("record carried delivery: %w", err)
		}
	}
	status, err := s.deliveryStatus(ctx, tx, newID)
	if err != nil {
		return startedDelivery{}, err
	}
	return startedDelivery{Delivered: int(status.Delivered), Target: int(status.Target), Fulfilled: status.State == "fulfilled"}, nil
}

// auditCarried appends one VacancyCandidateCarried per carried participation.
// source_process_id / source_participation_id name the template the copy came from.
func (s *Store) auditCarried(ctx context.Context, tx pgx.Tx, companyID, actor, newID uuid.UUID, carried []carriedParticipation) error {
	for _, c := range carried {
		pid := uuid.MustParse(c.ParticipationID)
		event := audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: audit.EventVacancyCandidateCarried,
			EntityType: "process_participation", EntityID: pid, CompanyID: &companyID, VacancyID: &newID,
			Metadata: map[string]string{
				"company_id": companyID.String(), "vacancy_id": newID.String(), "source_process_id": c.plan.template.process.String(),
				"source_participation_id": c.CarriedFrom, "candidate_kind": c.Candidate.Kind, "candidate_id": c.Candidate.ID, "stage_id": c.StageID,
			}}
		if err := s.audit.Append(ctx, tx, event); err != nil {
			return fmt.Errorf("co-write carried candidate audit: %w", err)
		}
	}
	return nil
}
