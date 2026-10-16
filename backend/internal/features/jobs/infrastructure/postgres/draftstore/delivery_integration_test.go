//go:build integration

package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const nullDelivery = `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null}`

func deliveryOf(t *testing.T, body []byte) deliveryconfig.Configuration {
	t.Helper()
	var c deliveryconfig.Configuration
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatal(err)
	}
	return c
}
func deliveryBody(t *testing.T, c deliveryconfig.Configuration) []byte {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func deliverySnapshot(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var snapshot string
	if err := pool.QueryRow(context.Background(), `SELECT json_build_array(
 (SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
 (SELECT row_to_json(p) FROM job_draft_pipeline_configs p WHERE draft_id=$1),
 (SELECT row_to_json(s) FROM job_draft_substate_catalogs s WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
 (SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}
func fixedDeliveryClock() time.Time { return time.Date(2026, 10, 16, 18, 0, 0, 0, time.UTC) }
func assertDeliveryAudit(t *testing.T, pool *pgxpool.Pool, id, actorID uuid.UUID, previous, next deliveryconfig.Configuration, version string) {
	t.Helper()
	var actor uuid.UUID
	var raw []byte
	if err := pool.QueryRow(context.Background(), `SELECT actor_id,metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftDeliveryConfigured' AND metadata->>'version'=$2`, id, version).Scan(&actor, &raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"previous", "new"} {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(metadata[key]), &fields); err != nil {
			t.Fatal(err)
		}
		if len(fields) != 3 {
			t.Fatalf("audit %s keys=%s", key, metadata[key])
		}
		for _, field := range []string{"cutoffStageId", "targetQuantity", "commitmentDate"} {
			if _, ok := fields[field]; !ok {
				t.Fatalf("audit missing %s", field)
			}
		}
	}
	if actor != actorID || metadata["version"] != version || !deliveryOf(t, []byte(metadata["previous"])).Equal(previous) || !deliveryOf(t, []byte(metadata["new"])).Equal(next) {
		t.Fatalf("audit actor=%s metadata=%s", actor, raw)
	}
}
func TestDelivery_PureGetFirstNullPutNoOpAndAudit(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	id := draftIDOf(t, created)
	ctx := context.Background()
	before := deliverySnapshot(t, pool, id)
	first, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(first, second) || before != deliverySnapshot(t, pool, id) || first.ETag != deliveryconfig.ETag(id, 0) {
		t.Fatalf("pure GET=%+v %+v %v", first, second, err)
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(first.Body, &env); err != nil {
		t.Fatal(err)
	}
	if len(env) != 6 || string(env["version"]) != `"0"` || string(env["cutoffStageId"]) != "null" || string(env["targetQuantity"]) != "null" || string(env["commitmentDate"]) != "null" || string(env["limits"]) != `{"maxTargetQuantity":999}` {
		t.Fatalf("default=%s", first.Body)
	}
	var cal deliveryconfig.Calendar
	if err := json.Unmarshal(env["calendar"], &cal); err != nil {
		t.Fatal(err)
	}
	if cal.Today != "2026-10-16" || cal.MaxDate != "2027-10-16" || cal.TimeZone != deliveryconfig.TimeZone {
		t.Fatalf("calendar=%+v", cal)
	}
	saved, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, first.ETag, true, []byte(nullDelivery))
	if err != nil || saved.ETag != deliveryconfig.ETag(id, 1) || !deliveryOf(t, saved.Body).Equal(deliveryconfig.Configuration{}) || auditCount(t, pool, id, deliveryConfiguredEvent) != 1 {
		t.Fatalf("first PUT=%+v %v", saved, err)
	}
	assertDeliveryAudit(t, pool, id, p.ownerID, deliveryconfig.Configuration{}, deliveryconfig.Configuration{}, "1")
	before = deliverySnapshot(t, pool, id)
	noop, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(nullDelivery))
	if err != nil || !reflect.DeepEqual(noop, saved) || before != deliverySnapshot(t, pool, id) {
		t.Fatalf("no-op=%+v %v", noop, err)
	}
}
func TestDelivery_ChangesDateOnChangeAndFourWayVersionIsolation(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, created)
	pipeline, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	substates, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	cutoff := pipelineconfig.Defaults(id).Stages[3].ID
	target := int64(5)
	date := "2026-10-16"
	c := deliveryconfig.Configuration{CutoffStageID: &cutoff, TargetQuantity: &target, CommitmentDate: &date}
	saved, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, deliveryBody(t, c))
	if err != nil || saved.ETag != deliveryconfig.ETag(id, 1) || !deliveryOf(t, saved.Body).Equal(c) {
		t.Fatalf("save=%+v %v", saved, err)
	}
	assertDeliveryAudit(t, pool, id, p.ownerID, deliveryconfig.Configuration{}, c, "1")
	before := deliverySnapshot(t, pool, id)
	noop, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, saved.ETag, true, deliveryBody(t, c))
	if err != nil || !reflect.DeepEqual(noop, saved) || before != deliverySnapshot(t, pool, id) {
		t.Fatalf("configured no-op=%+v %v", noop, err)
	}
	draftAfter, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(draftAfter, created) {
		t.Fatalf("delivery changed draft: %v", err)
	}
	pipelineAfter, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(pipelineAfter, pipeline) {
		t.Fatalf("delivery changed pipeline: %v", err)
	}
	substatesAfter, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(substatesAfter, substates) {
		t.Fatalf("delivery changed substates: %v", err)
	}
	config := pipelineConfigOf(t, pipeline.Body)
	config.Stages[3].Name = "Entrevistas"
	if _, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, pipeline.ETag, true, pipelineWriteBody(t, config)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, substates.ETag, true, []byte(`{"substates":[{"name":"Uno"}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, created.ETag, true, []byte(`{"fields":{"title":"Independiente"}}`)); err != nil {
		t.Fatal(err)
	}
	after, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(after, saved) {
		t.Fatalf("other writes changed delivery: %+v %v", after, err)
	}
	previous := deliveryOf(t, saved.Body)
	target = 6
	s.clock = func() time.Time { return time.Date(2028, 10, 16, 18, 0, 0, 0, time.UTC) }
	changed, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, saved.ETag, true, deliveryBody(t, c))
	if err != nil || changed.ETag != deliveryconfig.ETag(id, 2) || !deliveryOf(t, changed.Body).Equal(c) {
		t.Fatalf("unchanged past date=%+v %v", changed, err)
	}
	assertDeliveryAudit(t, pool, id, p.ownerID, previous, c, "2")
	cleared, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, changed.ETag, true, []byte(nullDelivery))
	if err != nil || cleared.ETag != deliveryconfig.ETag(id, 3) || !deliveryOf(t, cleared.Body).Equal(deliveryconfig.Configuration{}) {
		t.Fatalf("clear=%+v %v", cleared, err)
	}
	assertDeliveryAudit(t, pool, id, p.ownerID, c, deliveryconfig.Configuration{}, "3")
}
func TestDelivery_RejectionsAreAtomicAndAuthorizeBeforePreconditions(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, created)
	saved, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, []byte(nullDelivery))
	if err != nil {
		t.Fatal(err)
	}
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
		{"missing precondition", p.companyID, p.ownerID, id, "", false, []byte(nullDelivery), drafts.ErrPreconditionRequired},
		{"weak", p.companyID, p.ownerID, id, "W/" + saved.ETag, true, []byte(nullDelivery), drafts.ErrInvalidRequest},
		{"stale", p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, []byte(nullDelivery), drafts.ErrVersionConflict},
		{"draft tag", p.companyID, p.ownerID, id, created.ETag, true, []byte(nullDelivery), drafts.ErrVersionConflict},
		{"pipeline tag", p.companyID, p.ownerID, id, pipelineconfig.ETag(id, 0), true, []byte(nullDelivery), drafts.ErrVersionConflict},
		{"substates tag", p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, []byte(nullDelivery), drafts.ErrVersionConflict},
		{"missing key", p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"cutoffStageId":null,"targetQuantity":null}`), drafts.ErrInvalidRequest},
		{"unknown key", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.TrimSuffix(nullDelivery, "}") + `,"extra":1}`), drafts.ErrInvalidRequest},
		{"fraction", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"targetQuantity":null`, `"targetQuantity":1.5`, 1)), drafts.ErrInvalidRequest},
		{"unknown cutoff", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"cutoffStageId":null`, `"cutoffStageId":"`+uuid.NewString()+`"`, 1)), drafts.ErrValidation},
		{"discarded cutoff", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"cutoffStageId":null`, `"cutoffStageId":"`+pipelineconfig.Defaults(id).Exit.ID+`"`, 1)), drafts.ErrValidation},
		{"target limit", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"targetQuantity":null`, `"targetQuantity":1000`, 1)), drafts.ErrValidation},
		{"past date", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"commitmentDate":null`, `"commitmentDate":"2026-10-15"`, 1)), drafts.ErrValidation},
		{"weekend", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"commitmentDate":null`, `"commitmentDate":"2026-10-17"`, 1)), deliveryconfig.ErrNonBusinessDate},
		{"holiday", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Replace(nullDelivery, `"commitmentDate":null`, `"commitmentDate":"2026-11-16"`, 1)), deliveryconfig.ErrNonBusinessDate},
		{"oversized", p.companyID, p.ownerID, id, saved.ETag, true, []byte(strings.Repeat("x", deliveryconfig.MaxBodyBytes+1)), drafts.ErrPayloadTooLarge},
		{"nonprincipal", p.companyID, nonprincipal, id, "", false, []byte(`broken`), drafts.ErrNotFound},
		{"foreign", foreign.companyID, foreign.ownerID, id, "", false, []byte(`broken`), drafts.ErrNotFound},
		{"missing", p.companyID, p.ownerID, uuid.New(), "", false, []byte(`broken`), drafts.ErrNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := deliverySnapshot(t, pool, id)
			got, err := s.PutDelivery(ctx, tc.company, tc.actor, tc.id, tc.tag, tc.present, tc.body)
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
				t.Fatalf("got %+v %v want %v", got, err, tc.want)
			}
		})
	}
	for _, caller := range []struct{ company, actor uuid.UUID }{{p.companyID, nonprincipal}, {foreign.companyID, foreign.ownerID}} {
		before := deliverySnapshot(t, pool, id)
		got, err := s.GetDelivery(ctx, caller.company, caller.actor, id)
		if !errors.Is(err, drafts.ErrNotFound) || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
			t.Fatalf("GET rejection=%+v %v", got, err)
		}
	}
}
func TestDelivery_ConcurrentFirstPutsHaveOneWinner(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
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
			got, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, []byte(nullDelivery))
			if err == nil && got.ETag != deliveryconfig.ETag(id, 1) {
				err = errors.New("incomplete winner")
			}
			if err != nil && !reflect.DeepEqual(got, drafts.Result{}) {
				err = errors.New("rejection returned data")
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
			t.Fatal(err)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_draft_delivery_configs WHERE draft_id=$1 AND version=1`, id).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if wins != 1 || conflicts != 1 || rows != 1 || auditCount(t, pool, id, deliveryConfiguredEvent) != 1 {
		t.Fatalf("wins=%d conflicts=%d rows=%d", wins, conflicts, rows)
	}
}
func TestDelivery_CustomCutoffRemovalBlockedRenameAndReorderAllowed(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, created)
	initial := pipelineconfig.Defaults(id)
	stages := []map[string]string{{"id": initial.Stages[0].ID, "name": "Nuevos"}, {"name": "Prueba"}}
	for _, stage := range initial.Stages[1:] {
		stages = append(stages, map[string]string{"id": stage.ID, "name": stage.Name})
	}
	raw, err := json.Marshal(map[string]any{"stages": stages, "exit": map[string]string{"id": initial.Exit.ID, "name": initial.Exit.Name}})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, pipelineconfig.ETag(id, 0), true, raw)
	if err != nil {
		t.Fatal(err)
	}
	config := pipelineConfigOf(t, saved.Body)
	cutoff := config.Stages[1].ID
	delivery, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, deliveryBody(t, deliveryconfig.Configuration{CutoffStageID: &cutoff}))
	if err != nil {
		t.Fatal(err)
	}
	before := deliverySnapshot(t, pool, id)
	got, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, pipelineWriteBody(t, initial))
	if !errors.Is(err, pipelineconfig.ErrCutoffStageInUse) || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
		t.Fatalf("removal=%+v %v", got, err)
	}
	config.Stages[1].Name = "Renombrada"
	config.Stages[1], config.Stages[2] = config.Stages[2], config.Stages[1]
	renamed, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, pipelineWriteBody(t, config))
	if err != nil || renamed.ETag != pipelineconfig.ETag(id, 2) {
		t.Fatalf("rename/reorder=%+v %v", renamed, err)
	}
	after, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(after, delivery) {
		t.Fatal("pipeline changed delivery")
	}
	if _, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, delivery.ETag, true, []byte(nullDelivery)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, renamed.ETag, true, pipelineWriteBody(t, initial)); err != nil {
		t.Fatal(err)
	}
	// The removed identity must no longer be accepted as a delivery cutoff.
	before = deliverySnapshot(t, pool, id)
	got, err = s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 2), true, deliveryBody(t, deliveryconfig.Configuration{CutoffStageID: &cutoff}))
	if !errors.Is(err, drafts.ErrValidation) || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
		t.Fatalf("removed cutoff=%+v %v", got, err)
	}
}

// TestDelivery_ConcurrentCutoffSelectionAndRemovalNeverDangle races choosing a
// custom stage as the delivery cutoff against removing that stage from the
// pipeline. Both writes lock the same draft row (§8.1), so exactly one wins and
// the stored cutoff never points to a stage the pipeline no longer has.
func TestDelivery_ConcurrentCutoffSelectionAndRemovalNeverDangle(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	outcomes := map[string]int{}
	for range 20 {
		s, p, created := createV2Draft(t, pool)
		s.clock = fixedDeliveryClock
		id := draftIDOf(t, created)
		initial := pipelineconfig.Defaults(id)
		stages := []map[string]string{{"id": initial.Stages[0].ID, "name": "Nuevos"}, {"name": "Prueba"}}
		for _, stage := range initial.Stages[1:] {
			stages = append(stages, map[string]string{"id": stage.ID, "name": stage.Name})
		}
		raw, err := json.Marshal(map[string]any{"stages": stages, "exit": map[string]string{"id": initial.Exit.ID, "name": initial.Exit.Name}})
		if err != nil {
			t.Fatal(err)
		}
		saved, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, pipelineconfig.ETag(id, 0), true, raw)
		if err != nil {
			t.Fatal(err)
		}
		custom := pipelineConfigOf(t, saved.Body).Stages[1].ID

		start := make(chan struct{})
		var deliveryErr, pipelineErr error
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, deliveryErr = s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, deliveryBody(t, deliveryconfig.Configuration{CutoffStageID: &custom}))
		}()
		go func() {
			defer wg.Done()
			<-start
			_, pipelineErr = s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, pipelineWriteBody(t, initial))
		}()
		close(start)
		wg.Wait()

		pipeline, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
		delivery, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
		stored := deliveryOf(t, delivery.Body)
		hasCustom := false
		for _, stage := range pipelineConfigOf(t, pipeline.Body).Stages {
			if stage.ID == custom {
				hasCustom = true
			}
		}
		switch {
		case deliveryErr == nil && errors.Is(pipelineErr, pipelineconfig.ErrCutoffStageInUse):
			// Delivery won: the stage must survive and remain the cutoff.
			if !hasCustom || stored.CutoffStageID == nil || *stored.CutoffStageID != custom || pipeline.ETag != saved.ETag {
				t.Fatalf("delivery won but state is inconsistent: hasCustom=%v cutoff=%v", hasCustom, stored.CutoffStageID)
			}
			outcomes["delivery"]++
		case pipelineErr == nil && errors.Is(deliveryErr, drafts.ErrValidation):
			// Pipeline won: the stage is gone and nothing references it.
			if hasCustom || stored.CutoffStageID != nil || delivery.ETag != deliveryconfig.ETag(id, 0) || auditCount(t, pool, id, deliveryConfiguredEvent) != 0 {
				t.Fatalf("pipeline won but state is inconsistent: hasCustom=%v cutoff=%v", hasCustom, stored.CutoffStageID)
			}
			outcomes["pipeline"]++
		default:
			t.Fatalf("unexpected outcome: delivery=%v pipeline=%v", deliveryErr, pipelineErr)
		}
	}
	t.Logf("outcomes over 20 races: %v", outcomes)
}
