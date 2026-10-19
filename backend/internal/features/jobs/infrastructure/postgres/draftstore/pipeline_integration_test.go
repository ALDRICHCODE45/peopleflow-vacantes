//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func pipelineWriteBody(t *testing.T, c pipelineconfig.Configuration) []byte {
	t.Helper()
	stages := make([]map[string]string, len(c.Stages))
	for i, s := range c.Stages {
		stages[i] = map[string]string{"id": s.ID, "name": s.Name}
	}
	body, err := json.Marshal(map[string]any{"stages": stages, "exit": map[string]string{"id": c.Exit.ID, "name": c.Exit.Name}})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func pipelineConfigOf(t *testing.T, body []byte) pipelineconfig.Configuration {
	t.Helper()
	var c pipelineconfig.Configuration
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// Snapshot includes every observable persisted effect, including draft bytes,
// timestamps, pipeline version/data and all audit rows for this draft.
func pipelineSnapshot(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var snapshot string
	if err := pool.QueryRow(context.Background(), `SELECT json_build_array(
		(SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
		(SELECT row_to_json(p) FROM job_draft_pipeline_configs p WHERE draft_id=$1),
		(SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestPipeline_DefaultReadSaveNoOpAuditAndIndependentVersions(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	before := pipelineSnapshot(t, pool, id)
	first, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil || !bytes.Equal(first.Body, second.Body) || first.ETag != second.ETag || first.ETag == created.ETag {
		t.Fatalf("repeat defaults: %+v %+v %v", first, second, err)
	}
	if before != pipelineSnapshot(t, pool, id) {
		t.Fatal("GET wrote data")
	}
	var env struct {
		Version string `json:"version"`
		Limits  struct {
			MaxCustomStages int `json:"maxCustomStages"`
			NameMaxLength   int `json:"nameMaxLength"`
		} `json:"limits"`
	}
	if err := json.Unmarshal(first.Body, &env); err != nil || env.Version != "0" || env.Limits.MaxCustomStages != 3 || env.Limits.NameMaxLength != 40 || !pipelineConfigOf(t, first.Body).Equal(pipelineconfig.Defaults(id)) {
		t.Fatalf("default response: %s %v", first.Body, err)
	}
	c := pipelineConfigOf(t, first.Body)
	c.Stages[1].Name = "Filtro"
	saved, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, first.ETag, true, pipelineWriteBody(t, c))
	if err != nil || saved.ETag != pipelineconfig.ETag(id, 1) || !pipelineConfigOf(t, saved.Body).Equal(c) {
		t.Fatalf("save: %+v %v", saved, err)
	}
	var actor uuid.UUID
	var metadata map[string]string
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT actor_id, metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftPipelineConfigured'`, id).Scan(&actor, &raw); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	if actor != p.ownerID || !pipelineConfigOf(t, []byte(metadata["previous"])).Equal(pipelineconfig.Defaults(id)) || !pipelineConfigOf(t, []byte(metadata["new"])).Equal(c) || metadata["version"] != "1" {
		t.Fatalf("audit actor=%s metadata=%s", actor, raw)
	}
	draft, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil || draft.ETag != created.ETag || !bytes.Equal(draft.Body, created.Body) {
		t.Fatalf("pipeline PUT changed draft: %+v %v", draft, err)
	}
	before = pipelineSnapshot(t, pool, id)
	c.Stages[1].Name = " \tFiltro\u00a0 "
	noop, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, pipelineWriteBody(t, c))
	if err != nil || !reflect.DeepEqual(noop, saved) || pipelineSnapshot(t, pool, id) != before {
		t.Fatalf("normalized no-op: %+v %v", noop, err)
	}
	if _, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, []byte(`{"fields":{"title":"Changed title"}}`)); err != nil {
		t.Fatal(err)
	}
	afterPatch, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil || afterPatch.ETag != saved.ETag || !pipelineConfigOf(t, afterPatch.Body).Equal(pipelineConfigOf(t, saved.Body)) {
		t.Fatalf("draft PATCH changed pipeline: %+v %v", afterPatch, err)
	}
	if count := auditCount(t, pool, id, "JobDraftPipelineConfigured"); count != 1 {
		t.Fatalf("pipeline audit count=%d", count)
	}
}

func TestPipeline_RejectionsAreAtomicAndAuthorizeBeforePreconditions(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	get, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	body := pipelineWriteBody(t, pipelineConfigOf(t, get.Body))
	nonprincipal := addMember(t, pool, p.companyID, "recruiter")
	foreign := newPrincipal(t, pool)
	cases := []struct {
		name               string
		company, actor, id uuid.UUID
		tag                string
		present            bool
		body               []byte
		want               error
	}{
		{"missing precondition", p.companyID, p.ownerID, id, "", false, body, drafts.ErrPreconditionRequired},
		{"empty precondition", p.companyID, p.ownerID, id, "", true, body, drafts.ErrInvalidRequest},
		{"weak precondition", p.companyID, p.ownerID, id, "W/" + get.ETag, true, body, drafts.ErrInvalidRequest},
		{"list precondition", p.companyID, p.ownerID, id, get.ETag + "," + get.ETag, true, body, drafts.ErrInvalidRequest},
		{"foreign precondition", p.companyID, p.ownerID, id, created.ETag, true, body, drafts.ErrVersionConflict},
		{"unknown keys", p.companyID, p.ownerID, id, get.ETag, true, []byte(`{"stages":[],"exit":{},"kind":"custom"}`), drafts.ErrInvalidRequest},
		{"invariant", p.companyID, p.ownerID, id, get.ETag, true, []byte(strings.Replace(string(body), "Screening OK", "Nuevos", 1)), drafts.ErrValidation},
		{"unknown id", p.companyID, p.ownerID, id, get.ETag, true, []byte(strings.Replace(string(body), pipelineconfig.Defaults(id).Stages[1].ID, uuid.NewString(), 1)), drafts.ErrValidation},
		{"nonprincipal", p.companyID, nonprincipal, id, "", false, []byte(`broken`), drafts.ErrNotFound},
		{"foreign draft", foreign.companyID, foreign.ownerID, id, "", false, []byte(`broken`), drafts.ErrNotFound},
		{"missing draft", p.companyID, p.ownerID, uuid.New(), "", false, []byte(`broken`), drafts.ErrNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := pipelineSnapshot(t, pool, id)
			got, err := s.PutPipeline(ctx, tc.company, tc.actor, tc.id, tc.tag, tc.present, tc.body)
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || pipelineSnapshot(t, pool, id) != before {
				t.Fatalf("rejection changed state or result: %+v %v want %v", got, err, tc.want)
			}
		})
	}
	for _, caller := range []struct{ company, actor uuid.UUID }{{p.companyID, nonprincipal}, {foreign.companyID, foreign.ownerID}} {
		before := pipelineSnapshot(t, pool, id)
		got, err := s.GetPipeline(ctx, caller.company, caller.actor, id)
		if !errors.Is(err, drafts.ErrNotFound) || !reflect.DeepEqual(got, drafts.Result{}) || pipelineSnapshot(t, pool, id) != before {
			t.Fatalf("GET rejection: %+v %v", got, err)
		}
	}
}

func TestPipeline_ConcurrentFirstPutsHaveOneWinner(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	get, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	c := pipelineConfigOf(t, get.Body)
	c.Exit.Name = "Fuera"
	body := pipelineWriteBody(t, c)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			got, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, get.ETag, true, body)
			if err == nil && (got.ETag != pipelineconfig.ETag(id, 1) || !bytes.Contains(got.Body, []byte(`"version":"1"`))) {
				err = errors.New("incomplete winning response")
			}
			if err != nil && !reflect.DeepEqual(got, drafts.Result{}) {
				err = errors.New("rejected PUT returned data")
			}
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, drafts.ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected race error: %v", err)
		}
	}
	if wins != 1 || conflicts != 1 || auditCount(t, pool, id, "JobDraftPipelineConfigured") != 1 {
		t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
	}
}
