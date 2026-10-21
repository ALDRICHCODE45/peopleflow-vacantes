package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const managementConfiguredEvent = "JobDraftManagementConfigured"

var _ vacancymanagement.Store = (*Store)(nil)

func (s *Store) GetManagement(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin management read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, false); err != nil {
		return drafts.Result{}, err
	}
	c, version, err := readManagement(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	today, err := s.managementToday()
	if err != nil {
		return drafts.Result{}, err
	}
	return renderManagement(id, c, version, today)
}
func (s *Store) PutManagement(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin management write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, true); err != nil {
		return drafts.Result{}, err
	}
	if err := requireActiveProcess(ctx, tx, id); err != nil {
		return drafts.Result{}, err
	}
	previous, version, err := readManagement(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := pipelineconfig.CheckIfMatch(vacancymanagement.ETag(id, version), ifMatch, present); err != nil {
		return drafts.Result{}, err
	}
	today, err := s.managementToday()
	if err != nil {
		return drafts.Result{}, err
	}
	next, err := vacancymanagement.Replace(previous, body, today)
	if err != nil {
		return drafts.Result{}, err
	}
	if version > 0 && previous.Equal(next) {
		return renderManagement(id, previous, version, today)
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	var date pgtype.Date
	var headcount pgtype.Int4
	if next.RequestDate != nil {
		parsed, err := time.Parse(time.DateOnly, *next.RequestDate)
		if err != nil {
			return drafts.Result{}, fmt.Errorf("encode request date: %w", err)
		}
		date = pgtype.Date{Time: parsed, Valid: true}
	}
	if next.HiringHeadcount != nil {
		headcount = pgtype.Int4{Int32: int32(*next.HiringHeadcount), Valid: true}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_management_configs (draft_id,version,request_date,hiring_headcount) VALUES ($1,$2,$3,$4)
 ON CONFLICT (draft_id) DO UPDATE SET version=EXCLUDED.version,request_date=EXCLUDED.request_date,hiring_headcount=EXCLUDED.hiring_headcount`, id, version+1, date, headcount); err != nil {
		return drafts.Result{}, fmt.Errorf("write management: %w", err)
	}
	if err := s.guardPublishedConfiguration(ctx, tx, companyID, id); err != nil {
		return drafts.Result{}, err
	}
	previousJSON, err := json.Marshal(previous)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode previous management: %w", err)
	}
	nextJSON, err := json.Marshal(next)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode management: %w", err)
	}
	event := newDraftEvent(actorID, managementConfiguredEvent, id, version+1)
	event.Metadata["previous"] = string(previousJSON)
	event.Metadata["new"] = string(nextJSON)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write management audit: %w", err)
	}
	result, err := renderManagement(id, next, version+1, today)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit management: %w", err)
	}
	return result, nil
}
func readManagement(ctx context.Context, tx pgx.Tx, id uuid.UUID) (vacancymanagement.Configuration, int64, error) {
	var c vacancymanagement.Configuration
	var version int64
	var date pgtype.Date
	var headcount pgtype.Int4
	err := tx.QueryRow(ctx, `SELECT request_date,hiring_headcount,version FROM job_draft_management_configs WHERE draft_id=$1`, id).Scan(&date, &headcount, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, 0, nil
	}
	if err != nil {
		return c, 0, fmt.Errorf("read management: %w", err)
	}
	if version <= 0 || headcount.Valid && (headcount.Int32 < 1 || headcount.Int32 > vacancymanagement.MaxHiringHeadcount) || date.Valid && (date.InfinityModifier != pgtype.Finite || date.Time.Year() < 0 || date.Time.Year() > 9999) {
		return c, 0, errors.New("draftstore: invalid stored management")
	}
	if date.Valid {
		v := date.Time.Format(time.DateOnly)
		c.RequestDate = &v
	}
	if headcount.Valid {
		v := int64(headcount.Int32)
		c.HiringHeadcount = &v
	}
	return c, version, nil
}
func (s *Store) managementToday() (string, error) {
	zone, err := time.LoadLocation(vacancymanagement.TimeZone)
	if err != nil {
		return "", fmt.Errorf("load management timezone: %w", err)
	}
	return vacancymanagement.TodayAt(s.clock(), zone), nil
}
func renderManagement(id uuid.UUID, c vacancymanagement.Configuration, version int64, today string) (drafts.Result, error) {
	body, err := json.Marshal(struct {
		Version string `json:"version"`
		vacancymanagement.Configuration
		Limits struct {
			MaxHiringHeadcount int `json:"maxHiringHeadcount"`
		} `json:"limits"`
		Today string `json:"today"`
	}{Version: strconv.FormatInt(version, 10), Configuration: c, Limits: struct {
		MaxHiringHeadcount int `json:"maxHiringHeadcount"`
	}{vacancymanagement.MaxHiringHeadcount}, Today: today})
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render management: %w", err)
	}
	return drafts.Result{Body: body, ETag: vacancymanagement.ETag(id, version)}, nil
}
