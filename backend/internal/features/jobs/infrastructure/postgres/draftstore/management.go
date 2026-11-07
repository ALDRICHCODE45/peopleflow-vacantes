package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

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
	var headcount pgtype.Int4
	if next.HiringHeadcount != nil {
		headcount = pgtype.Int4{Int32: int32(*next.HiringHeadcount), Valid: true}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_management_configs (draft_id,version,request_date,hiring_headcount,target_close_date) VALUES ($1,$2,$3::date,$4,$5::date)
 ON CONFLICT (draft_id) DO UPDATE SET version=EXCLUDED.version,request_date=EXCLUDED.request_date,hiring_headcount=EXCLUDED.hiring_headcount,target_close_date=EXCLUDED.target_close_date`, id, version+1, next.RequestDate, headcount, next.TargetCloseDate); err != nil {
		return drafts.Result{}, fmt.Errorf("write management: %w", err)
	}
	// stakeholder-metrics-v1 §2.2: every closing-target change is history,
	// so metrics can judge a close against the date in effect at that moment.
	if !equalDate(previous.TargetCloseDate, next.TargetCloseDate) {
		if _, err := tx.Exec(ctx, `INSERT INTO vacancy_close_target_changes(id,draft_id,company_id,previous_date,new_date,performed_by,performed_at) VALUES($1,$2,$3,$4::date,$5::date,$6,$7)`, uuid.New(), id, companyID, previous.TargetCloseDate, next.TargetCloseDate, actorID, s.clock().UTC()); err != nil {
			return drafts.Result{}, fmt.Errorf("record close target change: %w", err)
		}
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
	event := newDraftEvent(actorID, companyID, audit.EventJobDraftManagementConfigured, id, version+1)
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
	var date, target pgtype.Date
	var headcount pgtype.Int4
	err := tx.QueryRow(ctx, `SELECT request_date,hiring_headcount,target_close_date,version FROM job_draft_management_configs WHERE draft_id=$1`, id).Scan(&date, &headcount, &target, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, 0, nil
	}
	if err != nil {
		return c, 0, fmt.Errorf("read management: %w", err)
	}
	if version <= 0 || headcount.Valid && (headcount.Int32 < 1 || headcount.Int32 > vacancymanagement.MaxHiringHeadcount) || !finiteDate(date) || !finiteDate(target) {
		return c, 0, errors.New("draftstore: invalid stored management")
	}
	if target.Valid {
		v := target.Time.Format(time.DateOnly)
		c.TargetCloseDate = &v
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

func finiteDate(d pgtype.Date) bool {
	return !d.Valid || d.InfinityModifier == pgtype.Finite && d.Time.Year() >= 0 && d.Time.Year() <= 9999
}

func equalDate(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }
