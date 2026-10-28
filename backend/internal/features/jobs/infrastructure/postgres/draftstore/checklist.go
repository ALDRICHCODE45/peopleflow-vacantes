package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ checklist.Store = (*Store)(nil)

// authorizeChecklist retains the draft fields needed by vacancy-specific rules.
// All checklist operations hold the parent lock, shared with pipeline/lifecycle
// writes, so a replacement cannot race a process finish or a reminder-stage edit.
func (s *Store) authorizeChecklist(ctx context.Context, tx pgx.Tx, companyID, actorID, id uuid.UUID) (draftRecord, error) {
	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return draftRecord{}, err
	}
	record, found, err := readDraft(ctx, tx, companyID, id, true)
	if err != nil {
		return draftRecord{}, err
	}
	if !found || !authorized(auth, actorID, record) {
		return draftRecord{}, drafts.ErrNotFound
	}
	if err := requireV2ReadDocument(record.fields); err != nil {
		return draftRecord{}, err
	}
	return record, nil
}

func (s *Store) GetChecklist(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin checklist read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := s.authorizeChecklist(ctx, tx, companyID, actorID, id); err != nil {
		return drafts.Result{}, err
	}
	c, version, err := readChecklist(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	stages, err := checklistStages(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	return renderChecklist(id, c.Visible(stages), version)
}

func (s *Store) PutChecklist(ctx context.Context, companyID, actorID, id uuid.UUID, tag string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin checklist write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	record, err := s.authorizeChecklist(ctx, tx, companyID, actorID, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := requireActiveProcess(ctx, tx, id); err != nil {
		return drafts.Result{}, err
	}
	previous, version, err := readChecklist(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := pipelineconfig.CheckIfMatch(checklist.ETag(id, version), tag, present); err != nil {
		return drafts.Result{}, err
	}
	rules, err := checklistRules(ctx, tx, id, record.fields)
	if err != nil {
		return drafts.Result{}, err
	}
	next, err := checklist.Replace(body, rules)
	if err != nil {
		return drafts.Result{}, err
	}
	if version > 0 && previous.Equal(next) {
		return renderChecklist(id, previous, version)
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return drafts.Result{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_checklists(draft_id,version,checklist) VALUES($1,$2,$3)
 ON CONFLICT(draft_id) DO UPDATE SET version=EXCLUDED.version,checklist=EXCLUDED.checklist`, id, version+1, encoded); err != nil {
		return drafts.Result{}, fmt.Errorf("write checklist: %w", err)
	}
	old, err := json.Marshal(previous)
	if err != nil {
		return drafts.Result{}, err
	}
	event := newDraftEvent(actorID, "JobDraftChecklistConfigured", id, version+1)
	event.Metadata["previous"] = string(old)
	event.Metadata["new"] = string(encoded)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write checklist audit: %w", err)
	}
	result, err := renderChecklist(id, next, version+1)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit checklist: %w", err)
	}
	return result, nil
}

func readChecklist(ctx context.Context, tx pgx.Tx, id uuid.UUID) (checklist.Checklist, int64, error) {
	var raw []byte
	var version int64
	err := tx.QueryRow(ctx, `SELECT checklist,version FROM job_draft_checklists WHERE draft_id=$1`, id).Scan(&raw, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return checklist.Empty(), 0, nil
	}
	if err != nil {
		return checklist.Checklist{}, 0, fmt.Errorf("read checklist: %w", err)
	}
	c, err := checklist.Decode(raw)
	return c, version, err
}

func checklistStages(ctx context.Context, tx pgx.Tx, id uuid.UUID) ([]string, error) {
	c, _, err := readPipeline(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	stages := make([]string, len(c.Stages))
	for i, s := range c.Stages {
		stages[i] = s.ID
	}
	return stages, nil
}

func checklistRules(ctx context.Context, tx pgx.Tx, id uuid.UUID, fields []byte) (checklist.Rules, error) {
	stages, err := checklistStages(ctx, tx, id)
	if err != nil {
		return checklist.Rules{}, err
	}
	screening, err := publicjobs.BuildScreening(fields)
	if err != nil {
		return checklist.Rules{}, err
	}
	rules := checklist.Rules{Stages: stages, Geo: checklistGeo{ctx: ctx, tx: tx}}
	for _, q := range screening.Questions {
		if q.Type != "single_choice" {
			continue
		}
		question := checklist.Question{ID: q.ID}
		for _, option := range q.Options {
			question.Options = append(question.Options, option.ID)
		}
		rules.Questions = append(rules.Questions, question)
	}
	return rules, nil
}

type checklistGeo struct {
	ctx context.Context
	tx  pgx.Tx
}

func (g checklistGeo) CountryExists(code string) (bool, error) {
	var exists bool
	err := g.tx.QueryRow(g.ctx, `SELECT EXISTS(SELECT 1 FROM geo_countries WHERE code=$1)`, code).Scan(&exists)
	return exists, err
}
func (g checklistGeo) StateExists(country, state string) (bool, error) {
	var exists bool
	err := g.tx.QueryRow(g.ctx, `SELECT EXISTS(SELECT 1 FROM geo_states WHERE country_code=$1 AND code=$2)`, country, state).Scan(&exists)
	return exists, err
}

func renderChecklist(id uuid.UUID, c checklist.Checklist, version int64) (drafts.Result, error) {
	body, err := json.Marshal(struct {
		Version string `json:"version"`
		checklist.Checklist
	}{strconv.FormatInt(version, 10), c})
	if err != nil {
		return drafts.Result{}, err
	}
	return drafts.Result{Body: body, ETag: checklist.ETag(id, version)}, nil
}
