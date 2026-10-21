package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const deliveryConfiguredEvent = "JobDraftDeliveryConfigured"

var _ deliveryconfig.Store = (*Store)(nil)

// GetDelivery authorizes before reading and never materializes defaults.
func (s *Store) GetDelivery(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin delivery read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, true); err != nil {
		return drafts.Result{}, err
	}
	c, version, err := readDelivery(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	calendar, err := s.deliveryCalendar()
	if err != nil {
		return drafts.Result{}, err
	}
	f, _, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	return renderDelivery(id, c, version, calendar, f != nil)
}

// PutDelivery locks the draft before reading both delivery and pipeline. The
// shared lock also protects cut-1 deletion checks from a concurrent cutoff save.
func (s *Store) PutDelivery(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin delivery write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, true); err != nil {
		return drafts.Result{}, err
	}
	if err := requireActiveProcess(ctx, tx, id); err != nil {
		return drafts.Result{}, err
	}
	published, err := lockDeliveryProcess(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	frozen, _, err := readFulfillment(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if frozen != nil {
		return drafts.Result{}, fulfillment.ErrFulfilled
	}
	previous, version, err := readDelivery(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := pipelineconfig.CheckIfMatch(deliveryconfig.ETag(id, version), ifMatch, present); err != nil {
		return drafts.Result{}, err
	}
	pipeline, _, err := readPipeline(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	calendar, err := s.deliveryCalendar()
	if err != nil {
		return drafts.Result{}, err
	}
	next, err := deliveryconfig.Replace(previous, pipeline, body, calendar)
	if err != nil {
		return drafts.Result{}, err
	}
	if version > 0 && previous.Equal(next) {
		return renderDelivery(id, previous, version, calendar, false)
	}
	confirm, err := deliveryconfig.Confirmation(body)
	if err != nil {
		return drafts.Result{}, err
	}
	if published {
		preview, err := previewDelivery(ctx, tx, id, next)
		if err != nil {
			return drafts.Result{}, err
		}
		if preview.WouldFulfill && !confirm {
			return drafts.Result{}, fulfillment.ErrConfirmationRequired
		}
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	var cutoff pgtype.UUID
	var target pgtype.Int4
	var date pgtype.Date
	if next.CutoffStageID != nil {
		cutoff = pgtype.UUID{Bytes: uuid.MustParse(*next.CutoffStageID), Valid: true}
	}
	if next.TargetQuantity != nil {
		target = pgtype.Int4{Int32: int32(*next.TargetQuantity), Valid: true}
	}
	if next.CommitmentDate != nil {
		parsed, err := time.Parse(time.DateOnly, *next.CommitmentDate)
		if err != nil {
			return drafts.Result{}, fmt.Errorf("encode delivery date: %w", err)
		}
		date = pgtype.Date{Time: parsed, Valid: true}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_delivery_configs (draft_id,version,cutoff_stage_id,target_quantity,commitment_date)
 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (draft_id) DO UPDATE SET version=EXCLUDED.version,cutoff_stage_id=EXCLUDED.cutoff_stage_id,target_quantity=EXCLUDED.target_quantity,commitment_date=EXCLUDED.commitment_date`, id, version+1, cutoff, target, date); err != nil {
		return drafts.Result{}, fmt.Errorf("write delivery: %w", err)
	}
	if err := s.guardPublishedConfiguration(ctx, tx, companyID, id); err != nil {
		return drafts.Result{}, err
	}
	previousJSON, err := json.Marshal(previous)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode previous delivery: %w", err)
	}
	nextJSON, err := json.Marshal(next)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode delivery: %w", err)
	}
	event := newDraftEvent(actorID, deliveryConfiguredEvent, id, version+1)
	event.Metadata["previous"] = string(previousJSON)
	event.Metadata["new"] = string(nextJSON)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write delivery audit: %w", err)
	}
	fulfilled := false
	if published {
		fulfilled, err = s.recordFulfillment(ctx, tx, id, actorID, next, s.clock().UTC().Truncate(time.Microsecond))
		if err != nil {
			return drafts.Result{}, err
		}
	}
	result, err := renderDelivery(id, next, version+1, calendar, fulfilled)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit delivery: %w", err)
	}
	return result, nil
}

func readDelivery(ctx context.Context, tx pgx.Tx, id uuid.UUID) (deliveryconfig.Configuration, int64, error) {
	var c deliveryconfig.Configuration
	var version int64
	var cutoff pgtype.UUID
	var target pgtype.Int4
	var date pgtype.Date
	err := tx.QueryRow(ctx, `SELECT cutoff_stage_id,target_quantity,commitment_date,version FROM job_draft_delivery_configs WHERE draft_id=$1`, id).Scan(&cutoff, &target, &date, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, 0, nil
	}
	if err != nil {
		return c, 0, fmt.Errorf("read delivery: %w", err)
	}
	if version <= 0 || target.Valid && (target.Int32 < 1 || target.Int32 > deliveryconfig.MaxTargetQuantity) || date.Valid && (date.InfinityModifier != pgtype.Finite || date.Time.Year() < 0 || date.Time.Year() > 9999) {
		return c, 0, errors.New("draftstore: invalid stored delivery")
	}
	if cutoff.Valid {
		v := uuid.UUID(cutoff.Bytes).String()
		c.CutoffStageID = &v
	}
	if target.Valid {
		v := int64(target.Int32)
		c.TargetQuantity = &v
	}
	if date.Valid {
		v := date.Time.Format(time.DateOnly)
		c.CommitmentDate = &v
	}
	return c, version, nil
}

func (s *Store) deliveryCalendar() (deliveryconfig.Calendar, error) {
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		return deliveryconfig.Calendar{}, fmt.Errorf("load delivery timezone: %w", err)
	}
	return deliveryconfig.CalendarAt(s.clock(), zone), nil
}

func renderDelivery(id uuid.UUID, c deliveryconfig.Configuration, version int64, calendar deliveryconfig.Calendar, fulfilled bool) (drafts.Result, error) {
	body, err := json.Marshal(struct {
		Fulfilled bool   `json:"fulfilled"`
		Version   string `json:"version"`
		deliveryconfig.Configuration
		Limits struct {
			MaxTargetQuantity int `json:"maxTargetQuantity"`
		} `json:"limits"`
		Calendar deliveryconfig.Calendar `json:"calendar"`
	}{Fulfilled: fulfilled, Version: strconv.FormatInt(version, 10), Configuration: c, Limits: struct {
		MaxTargetQuantity int `json:"maxTargetQuantity"`
	}{deliveryconfig.MaxTargetQuantity}, Calendar: calendar})
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render delivery: %w", err)
	}
	return drafts.Result{Body: body, ETag: deliveryconfig.ETag(id, version)}, nil
}
