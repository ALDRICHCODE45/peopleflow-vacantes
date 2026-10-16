package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const pipelineConfiguredEvent = "JobDraftPipelineConfigured"

var _ pipelineconfig.Store = (*Store)(nil)

// GetPipeline authorizes exactly like the v2 draft read, then returns the
// stored configuration or deterministic defaults. It never inserts a row.
func (s *Store) GetPipeline(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin pipeline read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, false); err != nil {
		return drafts.Result{}, err
	}
	c, version, err := readPipeline(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	return renderPipeline(id, c, version)
}

// PutPipeline locks the parent draft, not just the optional configuration row.
// Thus two first writers serialize before reading version zero, with no unique
// violation race and no change whatsoever to the draft's own version/ETag.
func (s *Store) PutPipeline(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin pipeline write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, true); err != nil {
		return drafts.Result{}, err
	}
	previous, version, err := readPipeline(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := pipelineconfig.CheckIfMatch(pipelineconfig.ETag(id, version), ifMatch, present); err != nil {
		return drafts.Result{}, err
	}
	next, err := pipelineconfig.Replace(previous, body)
	if err != nil {
		return drafts.Result{}, err
	}
	delivery, _, err := readDelivery(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if delivery.CutoffStageID != nil {
		retained := false
		for _, stage := range next.Stages {
			if stage.ID == *delivery.CutoffStageID {
				retained = true
				break
			}
		}
		if !retained {
			return drafts.Result{}, pipelineconfig.ErrCutoffStageInUse
		}
	}
	// Only a stored configuration can be a stored no-op. The first successful
	// PUT materializes version 1, even when the caller chooses all defaults.
	if version > 0 && previous.Equal(next) {
		return renderPipeline(id, previous, version)
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode pipeline: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_pipeline_configs (draft_id, version, configuration)
		VALUES ($1, $2, $3)
		ON CONFLICT (draft_id) DO UPDATE SET version=EXCLUDED.version, configuration=EXCLUDED.configuration`, id, version+1, encoded); err != nil {
		return drafts.Result{}, fmt.Errorf("write pipeline: %w", err)
	}
	previousJSON, err := json.Marshal(previous)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode previous pipeline: %w", err)
	}
	// The existing audit port uses string-valued metadata. Configuration
	// snapshots are complete JSON documents, not lossy human-readable summaries.
	event := newDraftEvent(actorID, pipelineConfiguredEvent, id, version+1)
	event.Metadata["previous"] = string(previousJSON)
	event.Metadata["new"] = string(encoded)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write pipeline audit: %w", err)
	}
	result, err := renderPipeline(id, next, version+1)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit pipeline: %w", err)
	}
	return result, nil
}

func (s *Store) authorizePipeline(ctx context.Context, tx pgx.Tx, companyID, actorID, id uuid.UUID, lock bool) error {
	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return err
	}
	record, found, err := readDraft(ctx, tx, companyID, id, lock)
	if err != nil {
		return err
	}
	if !found || !authorized(auth, actorID, record) {
		return drafts.ErrNotFound
	}
	return requireV2ReadDocument(record.fields)
}

func readPipeline(ctx context.Context, tx pgx.Tx, id uuid.UUID) (pipelineconfig.Configuration, int64, error) {
	var raw []byte
	var version int64
	err := tx.QueryRow(ctx, `SELECT configuration, version FROM job_draft_pipeline_configs WHERE draft_id=$1`, id).Scan(&raw, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return pipelineconfig.Defaults(id), 0, nil
	}
	if err != nil {
		return pipelineconfig.Configuration{}, 0, fmt.Errorf("read pipeline: %w", err)
	}
	var c pipelineconfig.Configuration
	if err := json.Unmarshal(raw, &c); err != nil {
		return pipelineconfig.Configuration{}, 0, fmt.Errorf("decode stored pipeline: %w", err)
	}
	if err := pipelineconfig.Validate(c); err != nil || version <= 0 {
		return pipelineconfig.Configuration{}, 0, errors.New("draftstore: invalid stored pipeline")
	}
	// Built-in identity is anchored to the draft even when a stored document
	// is corrupt. Client input can never redefine its semantic function.
	defaults := pipelineconfig.Defaults(id)
	builtins := map[string]string{defaults.Exit.Kind: defaults.Exit.ID}
	for _, stage := range defaults.Stages {
		builtins[stage.Kind] = stage.ID
	}
	for _, stage := range append(append([]pipelineconfig.Stage{}, c.Stages...), c.Exit) {
		if want, builtin := builtins[stage.Kind]; builtin && stage.ID != want {
			return pipelineconfig.Configuration{}, 0, errors.New("draftstore: invalid stored pipeline identity")
		}
	}
	return c, version, nil
}

func renderPipeline(id uuid.UUID, c pipelineconfig.Configuration, version int64) (drafts.Result, error) {
	body, err := json.Marshal(struct {
		Version string                 `json:"version"`
		Stages  []pipelineconfig.Stage `json:"stages"`
		Exit    pipelineconfig.Stage   `json:"exit"`
		Limits  struct {
			MaxCustomStages int `json:"maxCustomStages"`
			NameMaxLength   int `json:"nameMaxLength"`
		} `json:"limits"`
	}{
		Version: strconv.FormatInt(version, 10), Stages: c.Stages, Exit: c.Exit,
		Limits: struct {
			MaxCustomStages int `json:"maxCustomStages"`
			NameMaxLength   int `json:"nameMaxLength"`
		}{pipelineconfig.MaxCustomStages, pipelineconfig.NameMaxLength},
	})
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render pipeline: %w", err)
	}
	return drafts.Result{Body: body, ETag: pipelineconfig.ETag(id, version)}, nil
}
