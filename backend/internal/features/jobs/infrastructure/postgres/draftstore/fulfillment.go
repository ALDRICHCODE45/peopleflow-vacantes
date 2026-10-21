package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// All callers hold the draft lock before the process lock. This is also used
// from intake/movement transactions through application-owned composition ports.
func lockDeliveryProcess(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	var found uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM vacancy_processes WHERE id=$1 FOR UPDATE`, id).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
func readFulfillment(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*fulfillment.Snapshot, int64, error) {
	var f fulfillment.Snapshot
	var delivered int64
	var date time.Time
	var candidates []byte
	err := tx.QueryRow(ctx, `SELECT fulfilled_at,result,business_days_delta,target,cutoff_stage_id::text,cutoff_stage_name,commitment_date,candidates,delivered FROM process_delivery_fulfillments WHERE process_id=$1`, id).Scan(&f.FulfilledAt, &f.Result, &f.BusinessDaysDelta, &f.Target, &f.CutoffStageID, &f.CutoffStageName, &date, &candidates, &delivered)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	if err = json.Unmarshal(candidates, &f.Candidates); err != nil {
		return nil, 0, err
	}
	if int64(len(f.Candidates)) != f.Target {
		return nil, 0, errors.New("invalid fulfillment candidates")
	}
	f.FulfilledAt = f.FulfilledAt.UTC()
	f.CommitmentDate = date.Format(time.DateOnly)
	return &f, delivered, nil
}
func reachedCandidates(ctx context.Context, tx pgx.Tx, id uuid.UUID, cutoff *string) ([]fulfillment.Candidate, error) {
	out := []fulfillment.Candidate{}
	if cutoff == nil {
		return out, nil
	}
	rows, err := tx.Query(ctx, `SELECT p.id,u.id,u.full_name,min(h.created_at) AS reached_at
 FROM process_participations p JOIN users u ON u.id=p.candidate_id
 JOIN participation_stage_history h ON h.participation_id=p.id
 WHERE p.process_id=$1 AND h.stage_id=$2::uuid AND h.event_kind IN ('intake','move','recovery')
 GROUP BY p.id,u.id,u.full_name ORDER BY reached_at,p.id`, id, *cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c fulfillment.Candidate
		if err = rows.Scan(&c.ParticipationID, &c.Candidate.ID, &c.Candidate.FullName, &c.ReachedAt); err != nil {
			return nil, err
		}
		c.ReachedAt = c.ReachedAt.UTC()
		out = append(out, c)
	}
	return out, rows.Err()
}
func previewDelivery(ctx context.Context, tx pgx.Tx, id uuid.UUID, c deliveryconfig.Configuration) (fulfillment.Preview, error) {
	candidates, err := reachedCandidates(ctx, tx, id, c.CutoffStageID)
	out := fulfillment.Preview{Delivered: int64(len(candidates)), Target: c.TargetQuantity, Candidates: candidates}
	out.WouldFulfill = c.CutoffStageID != nil && c.TargetQuantity != nil && c.CommitmentDate != nil && out.Delivered >= *c.TargetQuantity
	return out, err
}
func completeDelivery(c deliveryconfig.Configuration) bool {
	return c.CutoffStageID != nil && c.TargetQuantity != nil && c.CommitmentDate != nil
}

// RecordDelivery evaluates only actual entries into the configured cutoff. It
// neither opens nor commits a transaction; audit failure aborts the caller too.
func (s *Store) RecordDelivery(ctx context.Context, tx pgx.Tx, id, actor, entered uuid.UUID, at time.Time) error {
	c, _, err := readDelivery(ctx, tx, id)
	if err != nil {
		return err
	}
	if !completeDelivery(c) {
		return errors.New("published delivery configuration incomplete")
	}
	if *c.CutoffStageID != entered.String() {
		return nil
	}
	_, err = s.recordFulfillment(ctx, tx, id, actor, c, at)
	return err
}
func (s *Store) recordFulfillment(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID, c deliveryconfig.Configuration, at time.Time) (bool, error) {
	saved, _, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return false, err
	}
	if saved != nil {
		return true, nil
	}
	preview, err := previewDelivery(ctx, tx, id, c)
	if err != nil || !preview.WouldFulfill {
		return false, err
	}
	pipeline, _, err := readPipeline(ctx, tx, id)
	if err != nil {
		return false, err
	}
	name := ""
	for _, stage := range pipeline.Stages {
		if stage.ID == *c.CutoffStageID {
			name = stage.Name
			break
		}
	}
	if name == "" {
		return false, errors.New("unknown delivery cutoff")
	}
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		return false, err
	}
	result, delta := fulfillment.Evaluate(at, *c.CommitmentDate, zone)
	f := fulfillment.Snapshot{FulfilledAt: at.UTC(), Result: result, BusinessDaysDelta: delta, Target: *c.TargetQuantity, CutoffStageID: *c.CutoffStageID, CutoffStageName: name, CommitmentDate: *c.CommitmentDate, Candidates: preview.Candidates[:int(*c.TargetQuantity)]}
	candidates, err := json.Marshal(f.Candidates)
	if err != nil {
		return false, err
	}
	command, err := tx.Exec(ctx, `INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates,delivered) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(process_id) DO NOTHING`, id, f.FulfilledAt, f.Result, f.BusinessDaysDelta, f.Target, f.CutoffStageID, f.CutoffStageName, f.CommitmentDate, candidates, preview.Delivered)
	if err != nil {
		return false, err
	}
	if command.RowsAffected() == 0 {
		return true, nil
	}
	raw, err := json.Marshal(f)
	if err != nil {
		return false, err
	}
	err = s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyDeliveryFulfilled", EntityType: "vacancy_process", EntityID: id, Metadata: map[string]string{"vacancy_id": id.String(), "snapshot": string(raw)}})
	return true, err
}
func (s *Store) deliveryStatus(ctx context.Context, tx pgx.Tx, id uuid.UUID) (fulfillment.Status, error) {
	f, delivered, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return fulfillment.Status{}, err
	}
	if f != nil {
		return fulfillment.Status{State: "fulfilled", Delivered: delivered, Target: f.Target, CutoffStageID: f.CutoffStageID, CommitmentDate: f.CommitmentDate, Fulfillment: f}, nil
	}
	c, _, err := readDelivery(ctx, tx, id)
	if err != nil {
		return fulfillment.Status{}, err
	}
	if !completeDelivery(c) {
		return fulfillment.Status{}, errors.New("published delivery configuration incomplete")
	}
	preview, err := previewDelivery(ctx, tx, id, c)
	if err != nil {
		return fulfillment.Status{}, err
	}
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		return fulfillment.Status{}, err
	}
	remaining := fulfillment.Remaining(s.clock(), *c.CommitmentDate, zone)
	return fulfillment.Status{State: "pending", Delivered: preview.Delivered, Target: *c.TargetQuantity, CutoffStageID: *c.CutoffStageID, CommitmentDate: *c.CommitmentDate, BusinessDaysRemaining: &remaining}, nil
}

// DeliverySummary uses primitive values so composition ports do not import a
// sibling feature's DTO. Caller holds the draft/process transaction locks.
func (s *Store) DeliverySummary(ctx context.Context, tx pgx.Tx, id uuid.UUID) (string, int64, int64, error) {
	status, err := s.deliveryStatus(ctx, tx, id)
	return status.State, status.Delivered, status.Target, err
}
func (s *Store) GetDeliveryStatus(ctx context.Context, company, actor, id uuid.UUID) (fulfillment.Status, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fulfillment.Status{}, err
	}
	defer tx.Rollback(ctx)
	if err = s.authorizePipeline(ctx, tx, company, actor, id, true); err != nil {
		return fulfillment.Status{}, err
	}
	published, err := lockDeliveryProcess(ctx, tx, id)
	if err != nil {
		return fulfillment.Status{}, err
	}
	if !published {
		return fulfillment.Status{}, fulfillment.ErrNotPublished
	}
	return s.deliveryStatus(ctx, tx, id)
}
func (s *Store) PreviewDelivery(ctx context.Context, company, actor, id uuid.UUID, body []byte) (fulfillment.Preview, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fulfillment.Preview{}, err
	}
	defer tx.Rollback(ctx)
	if err = s.authorizePipeline(ctx, tx, company, actor, id, true); err != nil {
		return fulfillment.Preview{}, err
	}
	published, err := lockDeliveryProcess(ctx, tx, id)
	if err != nil {
		return fulfillment.Preview{}, err
	}
	if !published {
		return fulfillment.Preview{}, fulfillment.ErrNotPublished
	}
	f, _, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return fulfillment.Preview{}, err
	}
	if f != nil {
		return fulfillment.Preview{}, fulfillment.ErrFulfilled
	}
	c, _, err := readDelivery(ctx, tx, id)
	if err != nil {
		return fulfillment.Preview{}, err
	}
	p, _, err := readPipeline(ctx, tx, id)
	if err != nil {
		return fulfillment.Preview{}, err
	}
	calendar, err := s.deliveryCalendar()
	if err != nil {
		return fulfillment.Preview{}, err
	}
	next, err := deliveryconfig.Replace(c, p, body, calendar)
	if err != nil {
		return fulfillment.Preview{}, err
	}
	// The vacancy is published, so a proposal is admissible only if it keeps the
	// delivery requirements complete, exactly as the PUT guard demands (§16.6.4).
	// The other publication requirements are unaffected by a delivery proposal.
	if missing := incompleteDeliveryProposal(next); len(missing) > 0 {
		return fulfillment.Preview{}, &publication.Incomplete{Missing: missing}
	}
	return previewDelivery(ctx, tx, id, next)
}

// incompleteDeliveryProposal lists the missing delivery requirements of a
// proposal in §9.3 order. A past commitment date is not reported: published
// writes are exempt from commitment_date_past (§10.2).
func incompleteDeliveryProposal(c deliveryconfig.Configuration) []string {
	var missing []string
	if c.CutoffStageID == nil {
		missing = append(missing, "delivery_cutoff_missing")
	}
	if c.TargetQuantity == nil {
		missing = append(missing, "delivery_target_missing")
	}
	if c.CommitmentDate == nil {
		missing = append(missing, "commitment_date_missing")
	}
	return missing
}
