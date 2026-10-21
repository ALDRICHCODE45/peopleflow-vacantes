//go:build integration

package main

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Synthetic intake fixtures only; moves, discard, recovery, column edits and
// lifecycle transitions below go through the real production router/gates.
func draftListCandidateSeed(t *testing.T, h *draftFlowHarness, id, stage string) string {
	t.Helper()
	ctx := context.Background()
	candidate, cv, pid := uuid.New(), uuid.New(), uuid.NewString()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		exec(`DELETE FROM audit_events WHERE entity_id=$1`, pid)
		exec(`DELETE FROM participation_stage_history WHERE participation_id=$1`, pid)
		exec(`DELETE FROM process_participations WHERE id=$1`, pid)
		exec(`DELETE FROM candidate_cv_library WHERE candidate_id=$1`, candidate)
		exec(`DELETE FROM candidate_cv_versions WHERE candidate_id=$1`, candidate)
		exec(`DELETE FROM users WHERE id=$1`, candidate)
	})
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'candidate-private-sentinel','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO candidate_cv_library(id,candidate_id,version_id,name) VALUES($1,$2,$3,'private-cv-sentinel.pdf')`, uuid.New(), candidate, cv)
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, pid, id, candidate, stage, cv)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), pid, stage, candidate)
	return pid
}

func draftListCandidateItem(t *testing.T, h *draftFlowHarness, actor draftFlowActor, id string) map[string]any {
	t.Helper()
	response := h.do(t, "GET", draftFlowV2Path+"?limit=50", "", actor.token, nil)
	draftFlowAssertNoStore(t, response)
	if response.status != 200 {
		t.Fatalf("list: %d %s", response.status, response.body)
	}
	if strings.Contains(string(response.body), "private-sentinel") || strings.Contains(string(response.body), "private-cv-sentinel") {
		t.Fatal("candidate personal data leaked")
	}
	for _, raw := range draftFlowObject(t, response.body)["items"].([]any) {
		item := raw.(map[string]any)
		if item["id"] == id {
			if len(item) != 13 {
				t.Fatalf("item keys: %v", item)
			}
			return item
		}
	}
	t.Fatalf("draft %s missing", id)
	return nil
}

func TestDraftListCandidatesFlow_LiveCountsCurrentPipelineAndVisibility(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := publicationFlowReady(t, h, principal)
	base := draftFlowV2Path + "/" + id
	ownerDraft := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	if item := draftListCandidateItem(t, h, owner, id); item["candidates"] != nil {
		t.Fatal("never-published candidates must be null", item)
	}
	if item := draftListCandidateItem(t, h, principal, id); item["candidates"] != nil {
		t.Fatal(item)
	}
	publicFlowPublish(t, h, id, principal)
	t.Cleanup(func() {
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM process_delivery_fulfillments WHERE process_id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	c := pipelineconfig.Defaults(uuid.MustParse(id))
	assertCounts := func(total, inProcess, discarded int, stages map[string]int) {
		t.Helper()
		wantStages := make([]any, len(c.Stages))
		for i, s := range c.Stages {
			wantStages[i] = map[string]any{"id": s.ID, "kind": s.Kind, "name": s.Name, "count": float64(stages[s.ID])}
		}
		want := map[string]any{"total": float64(total), "in_process": float64(inProcess), "discarded": float64(discarded), "by_stage": wantStages}
		for _, actor := range []draftFlowActor{owner, principal} {
			item := draftListCandidateItem(t, h, actor, id)
			if !reflect.DeepEqual(item["candidates"], want) {
				t.Fatalf("counts=%v want=%v", item["candidates"], want)
			}
		}
	}
	// Published without a materialized pipeline uses the same defaults as board.
	assertCounts(0, 0, 0, nil)
	var configRows int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM job_draft_pipeline_configs WHERE draft_id=$1`, id).Scan(&configRows); err != nil || configRows != 0 {
		t.Fatal(configRows, err)
	}
	baseline := draftListCandidateItem(t, h, owner, id)
	delete(baseline, "candidates")
	pipeline := h.do(t, "GET", base+"/pipeline", "", principal.token, nil)
	body := strings.Replace(pipelineFlowBody(t, c), `{"id":"`+c.Stages[1].ID+`"`, `{"name":"Prueba técnica"},{"id":"`+c.Stages[1].ID+`"`, 1)
	body = strings.Replace(body, `{"id":"`+c.Stages[4].ID+`"`, `{"name":"Vacía"},{"id":"`+c.Stages[4].ID+`"`, 1)
	saved := h.do(t, "PUT", base+"/pipeline", body, principal.token, map[string]string{"If-Match": pipeline.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatalf("pipeline: %d %s", saved.status, saved.body)
	}
	c = pipelineFlowConfig(t, saved.body)
	custom, empty := c.Stages[1].ID, c.Stages[len(c.Stages)-2].ID
	newStage := c.Stages[0].ID
	// Fulfill at the first real entry into En proceso, then change live counts.
	delivery := h.do(t, "GET", base+"/pipeline/delivery", "", principal.token, nil)
	deliveryConfig := draftFlowObject(t, delivery.body)
	deliveryBody := `{"cutoffStageId":"` + c.Stages[4].ID + `","targetQuantity":1,"commitmentDate":"` + deliveryConfig["commitmentDate"].(string) + `"}`
	changed := h.do(t, "PUT", base+"/pipeline/delivery", deliveryBody, principal.token, map[string]string{"If-Match": delivery.header.Get("ETag")})
	if changed.status != 200 {
		t.Fatalf("delivery: %d %s", changed.status, changed.body)
	}
	p0 := draftListCandidateSeed(t, h, id, newStage)
	draftListCandidateSeed(t, h, id, newStage)
	p2 := draftListCandidateSeed(t, h, id, newStage)
	assertCounts(3, 0, 0, map[string]int{newStage: 3})
	mutate := func(pid, op, body string) {
		t.Helper()
		path := base + "/participations/" + pid
		read := h.do(t, "GET", path, "", principal.token, nil)
		if read.status != 200 {
			t.Fatalf("participation: %d %s", read.status, read.body)
		}
		response := h.do(t, "POST", path+"/"+op, body, principal.token, map[string]string{"If-Match": draftFlowObject(t, read.body)["etag"].(string)})
		if response.status != 200 {
			t.Fatalf("%s: %d %s", op, response.status, response.body)
		}
	}
	move := func(pid, stage string) { t.Helper(); mutate(pid, "moves", `{"to_stage_id":"`+stage+`"}`) }
	discard := func(pid string) {
		t.Helper()
		mutate(pid, "discard", `{"reason":{"group":"candidate","key":"unresponsive"},"comment":"discard-private-sentinel","candidate_message":"message-private-sentinel"}`)
	}
	move(p0, custom)
	move(p2, custom)
	discard(p2)
	assertCounts(3, 1, 1, map[string]int{newStage: 1, custom: 1})
	// Counts/order/cursor/other item fields remain independent of pipeline changes.
	current := draftListCandidateItem(t, h, owner, id)
	delete(current, "candidates")
	if !reflect.DeepEqual(current, baseline) {
		t.Fatal("counts changed other item keys", current, baseline)
	}
	reordered := pipelineFlowConfig(t, saved.body)
	reordered.Stages[2], reordered.Stages[3] = reordered.Stages[3], reordered.Stages[2]
	reordered.Stages[1].Name = "Prueba renombrada"
	putPipeline := func(config pipelineconfig.Configuration) draftFlowResponse {
		t.Helper()
		write := strings.TrimSuffix(pipelineFlowBody(t, config), "}") + `,"confirm_impact":true}`
		return h.do(t, "PUT", base+"/pipeline", write, principal.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	}
	saved = putPipeline(reordered)
	if saved.status != 200 {
		t.Fatalf("reorder: %d %s", saved.status, saved.body)
	}
	c = pipelineFlowConfig(t, saved.body)
	assertCounts(3, 1, 1, map[string]int{newStage: 1, custom: 1})
	removed := pipelineFlowConfig(t, saved.body)
	kept := []pipelineconfig.Stage{}
	for _, s := range removed.Stages {
		if s.ID != custom && s.ID != empty {
			kept = append(kept, s)
		}
	}
	removed.Stages = kept
	blocked := putPipeline(removed)
	if blocked.status != 409 {
		t.Fatalf("occupied stage removal: %d %s", blocked.status, blocked.body)
	}
	discard(p0)
	retired := putPipeline(removed)
	if retired.status != 200 {
		t.Fatalf("retirement: %d %s", retired.status, retired.body)
	}
	c = pipelineFlowConfig(t, retired.body)
	if len(c.Retired) != 2 {
		t.Fatal("removed stages must be retained as history", c)
	}
	assertCounts(3, 0, 2, map[string]int{newStage: 1})
	// A retired previous stage is metadata only; recovery must explicitly select
	// a current eligible stage and cannot put a participation back into it.
	path := base + "/participations/" + p2
	read := h.do(t, "GET", path, "", principal.token, nil)
	invalid := h.do(t, "POST", path+"/recover", `{"to_stage_id":"`+custom+`"}`, principal.token, map[string]string{"If-Match": draftFlowObject(t, read.body)["etag"].(string)})
	if invalid.status != 400 {
		t.Fatalf("recovery into retired stage: %d %s", invalid.status, invalid.body)
	}
	assertCounts(3, 0, 2, map[string]int{newStage: 1})
	mutate(p2, "recover", `{"to_stage_id":"`+newStage+`"}`)
	assertCounts(3, 0, 1, map[string]int{newStage: 2})
	mutate(p0, "recover", `{"to_stage_id":"`+newStage+`"}`)
	// Walk the CURRENT order to cutoff; every non-new kind counts as in-process.
	for _, stage := range c.Stages[1 : len(c.Stages)-1] {
		move(p0, stage.ID)
		assertCounts(3, 1, 0, map[string]int{newStage: 2, stage.ID: 1})
	}
	readFrozen := func() string {
		t.Helper()
		var raw string
		if err := h.pool.QueryRow(context.Background(), `SELECT row_to_json(f)::text FROM process_delivery_fulfillments f WHERE process_id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	frozen := readFrozen()
	discard(p0)
	assertCounts(3, 0, 1, map[string]int{newStage: 2})
	mutate(p0, "recover", `{}`)
	assertCounts(3, 1, 0, map[string]int{newStage: 2, c.Stages[len(c.Stages)-2].ID: 1})
	move(p0, newStage)
	assertCounts(3, 0, 0, map[string]int{newStage: 3})
	if readFrozen() != frozen {
		t.Fatal("live counts changed frozen delivery")
	}
	var retiredOccupants int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM process_participations WHERE process_id=$1 AND stage_id=ANY($2::uuid[])`, id, []string{custom, empty}).Scan(&retiredOccupants); err != nil || retiredOccupants != 0 {
		t.Fatal("participations must never sit in retired stages", retiredOccupants, err)
	}
	// Owner sees all; principal sees only their own. Foreign participations do not count.
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	foreignDraft := publicationFlowReady(t, h, foreign)
	publicFlowPublish(t, h, foreignDraft, foreign)
	draftListCandidateSeed(t, h, foreignDraft, pipelineconfig.Defaults(uuid.MustParse(foreignDraft)).Stages[0].ID)
	for _, tc := range []struct {
		actor draftFlowActor
		want  []string
	}{{owner, []string{ownerDraft, id}}, {principal, []string{id}}, {foreign, []string{foreignDraft}}} {
		page := draftListFlowGet(t, h, tc.actor, "")
		got := []string{}
		for _, item := range page.Items {
			got = append(got, item.ID)
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatal("visibility/order changed", got, tc.want)
		}
	}
	assertCounts(3, 0, 0, map[string]int{newStage: 3})
	lifecycle := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	finished := h.do(t, "POST", base+"/lifecycle/close", `{"process":"finish"}`, owner.token, map[string]string{"If-Match": lifecycle.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if finished.status != 200 {
		t.Fatalf("finish: %d %s", finished.status, finished.body)
	}
	assertCounts(3, 0, 0, map[string]int{newStage: 3})
	// The finished view still reports the CURRENT positions, not fulfillment.
	if item := draftListCandidateItem(t, h, owner, id); item["process"] != "finished" || item["status"] != "closed" {
		t.Fatal(item)
	}
	first := draftListFlowGet(t, h, owner, "?limit=1")
	if len(first.Items) != 1 || first.Items[0].ID != ownerDraft || first.NextCursor == nil {
		t.Fatal(first)
	}
	second := draftListFlowGet(t, h, owner, "?limit=1&cursor="+*first.NextCursor)
	if len(second.Items) != 1 || second.Items[0].ID != id || second.NextCursor != nil {
		t.Fatal(second)
	}
}
