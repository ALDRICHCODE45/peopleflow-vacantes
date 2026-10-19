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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const substatesConfiguredEvent = "JobDraftSubstatesConfigured"

var _ substatecatalog.Store = (*Store)(nil)

// GetSubstates reuses the pipeline's draft authorization boundary. An absent row
// is the empty catalog at version zero; reads never materialize it.
func (s *Store) GetSubstates(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin substates read: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, true); err != nil {
		return drafts.Result{}, err
	}
	c, version, err := readSubstates(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	active, err := activeSubstates(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	return renderSubstates(id, c, version, active)
}

// PutSubstates locks the parent draft before reading the optional catalog row,
// serializing concurrent first writes without changing draft/pipeline versions.
func (s *Store) PutSubstates(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("begin substates write: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.authorizePipeline(ctx, tx, companyID, actorID, id, true); err != nil {
		return drafts.Result{}, err
	}
	previous, version, err := readSubstates(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := pipelineconfig.CheckIfMatch(substatecatalog.ETag(id, version), ifMatch, present); err != nil {
		return drafts.Result{}, err
	}
	next, err := substatecatalog.Replace(previous, body)
	if err != nil {
		return drafts.Result{}, err
	}
	active, err := activeSubstates(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if err = substatecatalog.CheckRemoval(previous, next, active); err != nil {
		return drafts.Result{}, err
	}
	// Even an empty first PUT materializes version 1 and its audit event.
	if version > 0 && previous.Equal(next) {
		return renderSubstates(id, previous, version, active)
	}
	if version == math.MaxInt64 {
		return drafts.Result{}, drafts.ErrVersionOverflow
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode substates: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO job_draft_substate_catalogs (draft_id,version,catalog)
  VALUES ($1,$2,$3)
  ON CONFLICT (draft_id) DO UPDATE SET version=EXCLUDED.version,catalog=EXCLUDED.catalog`, id, version+1, encoded); err != nil {
		return drafts.Result{}, fmt.Errorf("write substates: %w", err)
	}
	previousJSON, err := json.Marshal(previous)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode previous substates: %w", err)
	}
	event := newDraftEvent(actorID, substatesConfiguredEvent, id, version+1)
	event.Metadata["previous"] = string(previousJSON)
	event.Metadata["new"] = string(encoded)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return drafts.Result{}, fmt.Errorf("co-write substates audit: %w", err)
	}
	result, err := renderSubstates(id, next, version+1, active)
	if err != nil {
		return drafts.Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return drafts.Result{}, fmt.Errorf("commit substates: %w", err)
	}
	return result, nil
}

func readSubstates(ctx context.Context, tx pgx.Tx, id uuid.UUID) (substatecatalog.Catalog, int64, error) {
	var raw []byte
	var version int64
	err := tx.QueryRow(ctx, `SELECT catalog,version FROM job_draft_substate_catalogs WHERE draft_id=$1`, id).Scan(&raw, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return substatecatalog.Empty(), 0, nil
	}
	if err != nil {
		return substatecatalog.Catalog{}, 0, fmt.Errorf("read substates: %w", err)
	}
	var c substatecatalog.Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return substatecatalog.Catalog{}, 0, fmt.Errorf("decode stored substates: %w", err)
	}
	if err := substatecatalog.Validate(c); err != nil || version <= 0 {
		return substatecatalog.Catalog{}, 0, errors.New("draftstore: invalid stored substates")
	}
	return c, version, nil
}

func activeSubstates(ctx context.Context, tx pgx.Tx, id uuid.UUID) (map[string]bool, error) {
	rows, err := tx.Query(ctx, `SELECT DISTINCT substate_id FROM process_participations WHERE process_id=$1 AND substate_id IS NOT NULL`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	active := map[string]bool{}
	for rows.Next() {
		var sub string
		if err = rows.Scan(&sub); err != nil {
			return nil, err
		}
		active[sub] = true
	}
	return active, rows.Err()
}

type substateView struct {
	substatecatalog.Substate
	InUse bool `json:"in_use"`
}

func renderSubstates(id uuid.UUID, c substatecatalog.Catalog, version int64, active map[string]bool) (drafts.Result, error) {
	entries := make([]substateView, len(c.Substates))
	for i, s := range c.Substates {
		entries[i] = substateView{Substate: s, InUse: active[s.ID]}
	}
	body, err := json.Marshal(struct {
		Version   string         `json:"version"`
		Substates []substateView `json:"substates"`
		Limits    struct {
			MaxSubstates  int `json:"maxSubstates"`
			NameMaxLength int `json:"nameMaxLength"`
		} `json:"limits"`
		Suggestions []string `json:"suggestions"`
	}{
		Version: strconv.FormatInt(version, 10), Substates: entries,
		Limits: struct {
			MaxSubstates  int `json:"maxSubstates"`
			NameMaxLength int `json:"nameMaxLength"`
		}{substatecatalog.MaxSubstates, substatecatalog.NameMaxLength},
		Suggestions: substatecatalog.Suggestions(),
	})
	if err != nil {
		return drafts.Result{}, fmt.Errorf("render substates: %w", err)
	}
	return drafts.Result{Body: body, ETag: substatecatalog.ETag(id, version)}, nil
}
