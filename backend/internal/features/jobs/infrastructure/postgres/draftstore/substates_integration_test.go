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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func substateCatalogOf(t *testing.T, body []byte) substatecatalog.Catalog {
	t.Helper()
	var c substatecatalog.Catalog
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func substateWriteBody(t *testing.T, c substatecatalog.Catalog) []byte {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Include the complete parent, both configuration rows, and every audit event.
func substateSnapshot(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var snapshot string
	if err := pool.QueryRow(context.Background(), `SELECT json_build_array(
  (SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
  (SELECT row_to_json(p) FROM job_draft_pipeline_configs p WHERE draft_id=$1),
  (SELECT row_to_json(s) FROM job_draft_substate_catalogs s WHERE draft_id=$1),
  (SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestSubstates_DefaultReadFirstEmptyPutNoOpAndAudit(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	before := substateSnapshot(t, pool, id)
	first, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(first, second) || before != substateSnapshot(t, pool, id) || first.ETag != substatecatalog.ETag(id, 0) || first.ETag == created.ETag || first.ETag == pipelineconfig.ETag(id, 0) {
		t.Fatalf("pure GET=%+v %+v %v", first, second, err)
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(first.Body, &env); err != nil || len(env) != 4 || string(env["version"]) != `"0"` || string(env["substates"]) != `[]` || string(env["limits"]) != `{"maxSubstates":50,"nameMaxLength":40}` {
		t.Fatalf("default=%s %v", first.Body, err)
	}
	var suggestions []string
	if err := json.Unmarshal(env["suggestions"], &suggestions); err != nil || !reflect.DeepEqual(suggestions, substatecatalog.Suggestions()) {
		t.Fatalf("suggestions=%s %v", env["suggestions"], err)
	}
	body := []byte(`{"substates":[]}`)
	saved, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, first.ETag, true, body)
	if err != nil || saved.ETag != substatecatalog.ETag(id, 1) || !bytes.Contains(saved.Body, []byte(`"version":"1"`)) || !substateCatalogOf(t, saved.Body).Equal(substatecatalog.Empty()) || auditCount(t, pool, id, substatesConfiguredEvent) != 1 {
		t.Fatalf("empty first PUT=%+v %v", saved, err)
	}
	assertSubstateAudit(t, pool, id, p.ownerID, substatecatalog.Empty(), substatecatalog.Empty(), "1")
	before = substateSnapshot(t, pool, id)
	noop, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, saved.ETag, true, body)
	if err != nil || !reflect.DeepEqual(noop, saved) || before != substateSnapshot(t, pool, id) {
		t.Fatalf("empty no-op=%+v %v", noop, err)
	}
}

func assertSubstateAudit(t *testing.T, pool *pgxpool.Pool, id, actorID uuid.UUID, previous, next substatecatalog.Catalog, version string) {
	t.Helper()
	var actor uuid.UUID
	var raw []byte
	if err := pool.QueryRow(context.Background(), `SELECT actor_id,metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftSubstatesConfigured' AND metadata->>'version'=$2`, id, version).Scan(&actor, &raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	if actor != actorID || metadata["version"] != version || !substateCatalogOf(t, []byte(metadata["previous"])).Equal(previous) || !substateCatalogOf(t, []byte(metadata["new"])).Equal(next) {
		t.Fatalf("audit actor=%s metadata=%s", actor, raw)
	}
}

func TestSubstates_ChangesNoOpAuditAndIndependentVersions(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	pipeline, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, []byte(`{"substates":[{"name":"Primera entrevista"},{"name":"En proceso"}]}`))
	if err != nil || saved.ETag != substatecatalog.ETag(id, 1) {
		t.Fatalf("save=%+v %v", saved, err)
	}
	c := substateCatalogOf(t, saved.Body)
	if len(c.Substates) != 2 {
		t.Fatalf("saved=%s", saved.Body)
	}
	for _, entry := range c.Substates {
		if uuid.MustParse(entry.ID).Version() != 4 {
			t.Fatalf("new id=%s", entry.ID)
		}
	}
	assertSubstateAudit(t, pool, id, p.ownerID, substatecatalog.Empty(), c, "1")
	previous := substateCatalogOf(t, saved.Body)
	c.Substates[0], c.Substates[1] = c.Substates[1], c.Substates[0]
	c.Substates[1].Name = "Segunda entrevista"
	changed, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, saved.ETag, true, substateWriteBody(t, c))
	if err != nil || changed.ETag != substatecatalog.ETag(id, 2) || !substateCatalogOf(t, changed.Body).Equal(c) || auditCount(t, pool, id, substatesConfiguredEvent) != 2 {
		t.Fatalf("changing PUT=%+v %v", changed, err)
	}
	assertSubstateAudit(t, pool, id, p.ownerID, previous, c, "2")
	before := substateSnapshot(t, pool, id)
	c.Substates[1].Name = " \tSegunda\u00a0entrevista "
	noop, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, changed.ETag, true, substateWriteBody(t, c))
	if err != nil || !reflect.DeepEqual(noop, changed) || before != substateSnapshot(t, pool, id) {
		t.Fatalf("normalized no-op=%+v %v", noop, err)
	}
	draft, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(draft, created) {
		t.Fatalf("substates changed draft=%+v %v", draft, err)
	}
	pipelineAfter, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(pipelineAfter, pipeline) {
		t.Fatalf("substates changed pipeline=%+v %v", pipelineAfter, err)
	}
	config := pipelineConfigOf(t, pipeline.Body)
	config.Stages[3].Name = "Entrevistas"
	if _, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, pipeline.ETag, true, pipelineWriteBody(t, config)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, created.ETag, true, []byte(`{"fields":{"title":"Independiente"}}`)); err != nil {
		t.Fatal(err)
	}
	after, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(after, changed) {
		t.Fatalf("pipeline/draft changed substates=%+v %v", after, err)
	}
}

func TestSubstates_RejectionsAreAtomicAndAuthorizeBeforePreconditions(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	saved, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, []byte(`{"substates":[{"name":"Uno"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	body := substateWriteBody(t, substateCatalogOf(t, saved.Body))
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
		{"weak", p.companyID, p.ownerID, id, "W/" + saved.ETag, true, body, drafts.ErrInvalidRequest},
		{"list", p.companyID, p.ownerID, id, saved.ETag + "," + saved.ETag, true, body, drafts.ErrInvalidRequest},
		{"stale", p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, body, drafts.ErrVersionConflict},
		{"draft tag", p.companyID, p.ownerID, id, created.ETag, true, body, drafts.ErrVersionConflict},
		{"pipeline tag", p.companyID, p.ownerID, id, pipelineconfig.ETag(id, 0), true, body, drafts.ErrVersionConflict},
		{"unknown keys", p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"substates":[],"extra":1}`), drafts.ErrInvalidRequest},
		{"duplicate keys", p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"substates":[],"substates":[]}`), drafts.ErrInvalidRequest},
		{"duplicate name", p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"substates":[{"name":"Straße"},{"name":"STRASSE"}]}`), drafts.ErrValidation},
		{"unknown id", p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"substates":[{"id":"` + uuid.NewString() + `","name":"Uno"}]}`), drafts.ErrValidation},
		{"oversized", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Repeat("x", substatecatalog.MaxBodyBytes+1)), drafts.ErrPayloadTooLarge},
		{"nonprincipal", p.companyID, nonprincipal, id, "", false, []byte(`broken`), drafts.ErrNotFound},
		{"foreign", foreign.companyID, foreign.ownerID, id, "", false, []byte(`broken`), drafts.ErrNotFound},
		{"missing", p.companyID, p.ownerID, uuid.New(), "", false, []byte(`broken`), drafts.ErrNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := substateSnapshot(t, pool, id)
			got, err := s.PutSubstates(ctx, tc.company, tc.actor, tc.id, tc.tag, tc.present, tc.body)
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != substateSnapshot(t, pool, id) {
				t.Fatalf("rejection=%+v %v want %v", got, err, tc.want)
			}
		})
	}
	for _, caller := range []struct{ company, actor uuid.UUID }{{p.companyID, nonprincipal}, {foreign.companyID, foreign.ownerID}} {
		before := substateSnapshot(t, pool, id)
		got, err := s.GetSubstates(ctx, caller.company, caller.actor, id)
		if !errors.Is(err, drafts.ErrNotFound) || !reflect.DeepEqual(got, drafts.Result{}) || before != substateSnapshot(t, pool, id) {
			t.Fatalf("GET rejection=%+v %v", got, err)
		}
	}
}

func TestSubstates_ConcurrentFirstPutsHaveOneWinner(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			got, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, []byte(`{"substates":[]}`))
			if err == nil && (got.ETag != substatecatalog.ETag(id, 1) || !bytes.Contains(got.Body, []byte(`"version":"1"`))) {
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
			t.Fatalf("race error: %v", err)
		}
	}
	if wins != 1 || conflicts != 1 || auditCount(t, pool, id, substatesConfiguredEvent) != 1 {
		t.Fatalf("wins=%d conflicts=%d", wins, conflicts)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_draft_substate_catalogs WHERE draft_id=$1 AND version=1`, id).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("winning row count=%d err=%v", rows, err)
	}
}
