package draftstore

import (
	"context"
	"encoding/json"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

// teamSnapshot is captured before changing the outgoing responsible's function.
// Every writer of these inputs holds the same parent draft lock.
func (s *Store) teamSnapshot(ctx context.Context, tx pgx.Tx, id uuid.UUID, a activeAssignment, at time.Time) ([]byte, error) {
	pipeline, _, err := readPipeline(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	delivery, _, err := readDelivery(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	life, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	publication := "draft"
	if life.Publication != nil {
		publication = *life.Publication
	}
	type stageCount struct {
		ID        string `json:"stage_id"`
		Name      string `json:"stage_name"`
		Kind      string `json:"kind"`
		Active    int64  `json:"active"`
		Discarded int64  `json:"discarded"`
	}
	stages := make([]stageCount, 0, len(pipeline.Stages))
	var current int64
	for _, stage := range pipeline.Stages {
		row := stageCount{ID: stage.ID, Name: stage.Name, Kind: stage.Kind}
		if err := tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE stage_id=$2::uuid AND discarded_at IS NULL),count(*) FILTER(WHERE previous_stage_id=$2::uuid AND discarded_at IS NOT NULL) FROM process_participations WHERE process_id=$1`, id, stage.ID).Scan(&row.Active, &row.Discarded); err != nil {
			return nil, err
		}
		if stage.Kind == "placement" {
			current = row.Active
		}
		stages = append(stages, row)
	}
	preview, err := previewDelivery(ctx, tx, id, delivery)
	if err != nil {
		return nil, err
	}
	frozen, _, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	var fulfilledAt *time.Time
	var result *string
	if frozen != nil {
		fulfilledAt = &frozen.FulfilledAt
		result = &frozen.Result
	}
	var credited int64
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM placement_credits c JOIN placement_credit_recipients r ON r.credit_id=c.id WHERE c.process_id=$1 AND r.assignment_id=$2 AND c.status<>'voided'`, id, a.ID).Scan(&credited); err != nil {
		return nil, err
	}
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Captured   time.Time                 `json:"captured_at"`
		Lifecycle  map[string]any            `json:"lifecycle"`
		Stages     []stageCount              `json:"stage_counts"`
		Tramo      vacancyteam.TramoSnapshot `json:"tramo"`
		Delivery   map[string]any            `json:"delivery"`
		Placements map[string]int64          `json:"placements"`
	}{at, map[string]any{"publication": publication, "process": life.Process}, stages, vacancyteam.SnapshotTramo(a.Started, at, a.Deadline, delivery.CommitmentDate, zone), map[string]any{"target": delivery.TargetQuantity, "delivered": preview.Delivered, "fulfilled_at": fulfilledAt, "result": result, "commitment_date": delivery.CommitmentDate}, map[string]int64{"current": current, "credited": credited}})
}
