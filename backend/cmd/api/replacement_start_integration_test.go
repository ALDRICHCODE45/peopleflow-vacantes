//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Replacement processes R3a (docs/contracts/replacement-processes-v1.md,
// «POST V/replacements»): Start through the production router. Carried candidates are
// R3b (replacement_carry_integration_test.go); publish:true and publishing later are R3c
// (replacement_publication_integration_test.go).

func replMexicoCalendar(t *testing.T) deliveryconfig.Calendar {
	t.Helper()
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	return deliveryconfig.CalendarAt(time.Now(), zone)
}

// replBusinessDate is the first business day the commitment date accepts.
func replBusinessDate(t *testing.T) string { return deliveryFlowBusinessDate(t, replMexicoCalendar(t)) }

// replWeekend is a date inside the window that is not a business day.
func replWeekend(t *testing.T) string {
	t.Helper()
	d, err := time.Parse(time.DateOnly, replMexicoCalendar(t).MinDate)
	if err != nil {
		t.Fatal(err)
	}
	for businesscalendar.IsBusinessDay(d) {
		d = d.AddDate(0, 0, 1)
	}
	return d.Format(time.DateOnly)
}

func replCreditsJSON(credits []string) string {
	quoted := make([]string, len(credits))
	for i, c := range credits {
		quoted[i] = `"` + c + `"`
	}
	return "[" + strings.Join(quoted, ",") + "]"
}

// replBody is a valid start body; extra is appended inside the object.
func replBody(t *testing.T, extra string, credits ...string) string {
	t.Helper()
	return `{"placement_credit_ids":` + replCreditsJSON(credits) + `,"commitment_date":"` + replBusinessDate(t) + `"` + extra + `}`
}

// start posts the body with a fresh key and the source's current lifecycle ETag.
func (f *replFlow) start(source, body string) draftFlowResponse {
	f.t.Helper()
	current, _ := f.view(source)
	return f.startWith(source, body, f.owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
}

func (f *replFlow) startWith(source, body, token string, headers map[string]string) draftFlowResponse {
	f.t.Helper()
	return f.h.do(f.t, "POST", draftFlowV2Path+"/"+source+"/replacements", body, token, headers)
}

// closedChain is a published original, closed finished and covered, with n fallen credits.
func (f *replFlow) closedChain(n int) (string, []string) {
	f.t.Helper()
	root := f.published()
	f.closeIt(root, "finish")
	f.cover(root)
	credits := make([]string, n)
	for i := range credits {
		credits[i] = f.credit(root, "did_not_hold")
	}
	return root, credits
}

func (f *replFlow) scalar(query string, args ...any) any {
	f.t.Helper()
	var out any
	if err := f.h.pool.QueryRow(context.Background(), query, args...).Scan(&out); err != nil {
		f.t.Fatal(err)
	}
	return out
}

func (f *replFlow) count(query string, args ...any) int {
	f.t.Helper()
	return draftFlowCount(f.t, f.h.pool, query, args...)
}

func (f *replFlow) companyDrafts() int {
	return f.count(`SELECT count(*) FROM job_drafts WHERE company_id=$1`, f.company.companyID)
}

func (f *replFlow) replacements() int {
	return f.count(`SELECT count(*) FROM vacancy_replacements WHERE company_id=$1`, f.company.companyID)
}

func (f *replFlow) auditMetadata(entity, eventType string) map[string]any {
	f.t.Helper()
	var raw []byte
	if err := f.h.pool.QueryRow(context.Background(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type=$2`, entity, eventType).Scan(&raw); err != nil {
		f.t.Fatalf("audit %s %s: %v", entity, eventType, err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		f.t.Fatal(err)
	}
	return out
}

func replSortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// draftWithConfiguration is a ready draft carrying everything Start clones: a
// custom stage, a checklist whose reminder stages name a built-in and the
// custom stage, and a substate catalog.
func (f *replFlow) draftWithConfiguration() (id, custom string) {
	f.t.Helper()
	id = f.draft()
	base := draftFlowV2Path + "/" + id
	pipeline := f.h.do(f.t, "GET", base+"/pipeline", "", f.owner.token, nil)
	config := pipelineFlowConfig(f.t, pipeline.body)
	config.Stages = append(config.Stages[:4], append([]pipelineconfig.Stage{{Name: "Entrevista"}}, config.Stages[4:]...)...)
	added := f.h.do(f.t, "PUT", base+"/pipeline", strings.ReplaceAll(pipelineFlowBody(f.t, config), `"id":"",`, ""), f.owner.token, map[string]string{"If-Match": pipeline.header.Get("ETag")})
	if added.status != 200 {
		f.t.Fatalf("add stage: %d %s", added.status, added.body)
	}
	config = pipelineFlowConfig(f.t, added.body)
	custom = config.Stages[4].ID
	inProcess := pipelineconfig.Defaults(uuid.MustParse(id)).Stages[3].ID
	saved := f.h.do(f.t, "PUT", base+"/checklist", checklistFlowBody(uuid.NewString(), `["`+inProcess+`","`+custom+`"]`), f.owner.token, map[string]string{"If-Match": checklist.ETag(uuid.MustParse(id), 0)})
	if saved.status != 200 {
		f.t.Fatalf("checklist: %d %s", saved.status, saved.body)
	}
	substates := f.h.do(f.t, "GET", base+"/pipeline/substates", "", f.owner.token, nil)
	if put := f.h.do(f.t, "PUT", base+"/pipeline/substates", `{"substates":[{"name":"Uno"}]}`, f.owner.token, map[string]string{"If-Match": substates.header.Get("ETag")}); put.status != 200 {
		f.t.Fatalf("substates: %d %s", put.status, put.body)
	}
	// The psychometric profile also names stages (auto-send): stored directly, only its clone is observed.
	f.exec(`INSERT INTO job_draft_psychometric_profiles(draft_id,version,profile) VALUES($1,1,$2::jsonb)`, id, `{"enabled":false,"auto_send_stage_ids":["`+inProcess+`","`+custom+`"]}`)
	publicFlowPublish(f.t, f.h, id, f.owner)
	return id, custom
}

func TestReplacementStartClonesTheSourceIntoAPrivateProcess(t *testing.T) {
	f := newReplFlow(t)
	src, custom := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	c1, c2 := f.credit(src, "did_not_hold"), f.credit(src, "did_not_hold")
	spare := f.credit(src, "did_not_hold")
	sourceBefore, _ := f.view(src)
	drafts := f.companyDrafts()

	resp := f.start(src, replBody(t, "", c1, c2))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	draftFlowAssertNoStore(t, resp)
	body := draftFlowObject(t, resp.body)
	id := body["id"].(string)
	if resp.header.Get("Location") != draftFlowV2Path+"/"+id || resp.header.Get("ETag") != `"vl-`+id+`-v1"` || resp.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("headers = %v", resp.header)
	}
	if got, want := replSortedKeys(body), []string{"carried", "commitment_date", "delivery", "id", "kind", "lifecycle", "placement_credit_ids", "replacement_of", "responsible", "root_process_id", "sequence", "source", "stage_map", "started_at", "started_by", "target_quantity", "visibility"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %v, want %v", got, want)
	}
	owner := f.owner.userID.String()
	person := map[string]any{"id": owner, "name": f.scalar(`SELECT full_name FROM users WHERE id=$1`, f.owner.userID)}
	for key, want := range map[string]any{
		"kind": "replacement", "sequence": float64(1), "replacement_of": src, "root_process_id": src, "visibility": "private",
		"target_quantity": float64(2), "commitment_date": replBusinessDate(t), "placement_credit_ids": []any{c1, c2}, "carried": []any{},
		"started_by": person, "responsible": person, "delivery": map[string]any{"delivered": float64(0), "target": float64(2), "fulfilled": false},
	} {
		if !reflect.DeepEqual(body[key], want) {
			t.Fatalf("%s = %#v, want %#v", key, body[key], want)
		}
	}
	// A source that was already finished is untouched: no second finish, same ETag.
	source := body["source"].(map[string]any)
	if source["id"] != src || source["finished_by_start"] != false {
		t.Fatalf("source = %v", source)
	}
	after, afterView := f.view(src)
	if after.header.Get("ETag") != sourceBefore.header.Get("ETag") || afterView["process"] != "finished" || afterView["active_replacement_id"] != id {
		t.Fatalf("source after = %s", after.body)
	}
	if !reflect.DeepEqual(source["lifecycle"], any(afterView)) {
		t.Fatalf("source.lifecycle = %v, want %v", source["lifecycle"], afterView)
	}
	// The new process' lifecycle view is the one GET renders; a private replacement offers
	// «publish» (R3c) next to the usual actions.
	_, view := f.view(id)
	replAssertView(t, view, map[string]any{
		"publication": "published", "process": "active", "version": "1", "visibility": "private", "kind": "replacement", "sequence": float64(1),
		"replacement_of": src, "root_process_id": src, "closed_covered": false, "can_start_replacement": false, "start_replacement_blocker": "source_not_closed",
		"startable_credits_count": float64(1), "active_replacement_id": id, "allowed_actions": []any{"pause", "close", "publish"},
	})
	if !reflect.DeepEqual(body["lifecycle"], any(view)) {
		t.Fatalf("lifecycle = %v, want %v", body["lifecycle"], view)
	}

	// Links, the new draft and its process row.
	if f.companyDrafts() != drafts+1 || f.replacements() != 1 {
		t.Fatalf("drafts %d, replacements %d", f.companyDrafts(), f.replacements())
	}
	if got := f.count(`SELECT count(*) FROM vacancy_replacements WHERE process_id=$1 AND source_process_id=$2 AND root_process_id=$2 AND sequence=1 AND target_quantity=2 AND started_by=$3 AND company_id=$4`, id, src, f.owner.userID, f.company.companyID); got != 1 {
		t.Fatal("vacancy_replacements row")
	}
	if got := f.count(`SELECT count(*) FROM vacancy_replacement_credits WHERE replacement_process_id=$1 AND placement_credit_id IN ($2,$3)`, id, c1, c2); got != 2 {
		t.Fatalf("credit links = %d", got)
	}
	if f.count(`SELECT count(*) FROM vacancy_replacement_credits WHERE placement_credit_id=$1`, spare) != 0 {
		t.Fatal("an unrequested credit was taken")
	}
	if got := f.count(`SELECT count(*) FROM vacancy_processes p JOIN vacancy_replacements r ON r.process_id=p.id WHERE p.id=$1 AND p.status='published' AND p.process_status='active' AND p.lifecycle_version=1 AND p.published_by=$2 AND p.published_at=r.started_at AND p.company_id=$3 AND p.paused_at IS NULL AND p.closed_at IS NULL AND p.process_finished_at IS NULL`, id, f.owner.userID, f.company.companyID); got != 1 {
		t.Fatal("vacancy_processes row")
	}
	if at := f.scalar(`SELECT to_char(started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM vacancy_replacements WHERE process_id=$1`, id); at != body["started_at"] {
		t.Fatalf("started_at = %v, stored %v", body["started_at"], at)
	}
	for table, query := range map[string]string{
		"lifecycle events": `SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1`,
		"fulfillment":      `SELECT count(*) FROM process_delivery_fulfillments WHERE process_id=$1`,
		"milestones":       `SELECT count(*) FROM process_coverage_milestones WHERE process_id=$1`,
		"participations":   `SELECT count(*) FROM process_participations WHERE process_id=$1`,
		"credits":          `SELECT count(*) FROM placement_credits WHERE process_id=$1`,
		"projection":       `SELECT count(*) FROM vacancy_public_projections WHERE id=$1`,
	} {
		if n := f.count(query, id); n != 0 {
			t.Fatalf("%s of the new process = %d, want 0", table, n)
		}
	}

	// The draft is the same ad: identical content bytes and requester, fresh version.
	var sameFields bool
	if err := f.h.pool.QueryRow(context.Background(), `SELECT n.fields=s.fields AND n.requester_kind IS NOT DISTINCT FROM s.requester_kind AND n.requester_id IS NOT DISTINCT FROM s.requester_id AND n.version=1 AND n.status='draft' AND n.created_by=$3 FROM job_drafts n, job_drafts s WHERE n.id=$1 AND s.id=$2`, id, src, f.owner.userID).Scan(&sameFields); err != nil || !sameFields {
		t.Fatalf("draft clone: %v %v", sameFields, err)
	}
	draft := f.h.do(t, "GET", draftFlowV2Path+"/"+id, "", f.owner.token, nil)
	if draft.status != 200 || draftFlowObject(t, draft.body)["status"] != "draft" {
		t.Fatalf("GET draft: %d %s", draft.status, draft.body)
	}

	// Pipeline: same stages, kinds, names and order; built-in ids anchored to the new draft, custom ids kept.
	srcConfig := pipelineFlowConfig(t, f.h.do(t, "GET", draftFlowV2Path+"/"+src+"/pipeline", "", f.owner.token, nil).body)
	pipeline := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline", "", f.owner.token, nil)
	got := pipelineFlowConfig(t, pipeline.body)
	defaults := pipelineconfig.Defaults(uuid.MustParse(id))
	if pipeline.status != 200 || pipeline.header.Get("ETag") != pipelineconfig.ETag(uuid.MustParse(id), 1) || len(got.Stages) != 6 || len(got.Retired) != 0 {
		t.Fatalf("pipeline: %d %v %s", pipeline.status, pipeline.header, pipeline.body)
	}
	builtin := map[string]string{}
	for _, s := range append(append([]pipelineconfig.Stage{}, defaults.Stages...), defaults.Exit) {
		builtin[s.Kind] = s.ID
	}
	mapping := map[string]string{}
	for i, s := range append(append([]pipelineconfig.Stage{}, srcConfig.Stages...), srcConfig.Exit) {
		g := append(append([]pipelineconfig.Stage{}, got.Stages...), got.Exit)[i]
		want := s.ID
		if id, ok := builtin[s.Kind]; ok {
			want = id
		}
		if g.Kind != s.Kind || g.Name != s.Name || g.ID != want {
			t.Fatalf("stage %d = %+v, source %+v, want id %s", i, g, s, want)
		}
		mapping[s.ID] = g.ID
	}
	if mapping[custom] != custom {
		t.Fatal("a custom stage id must be kept")
	}
	stageMap := body["stage_map"].([]any)
	if len(stageMap) != 7 {
		t.Fatalf("stage_map = %v", stageMap)
	}
	for _, entry := range stageMap {
		e := entry.(map[string]any)
		if mapping[e["source_stage_id"].(string)] != e["stage_id"] || e["kind"] == "" {
			t.Fatalf("stage_map entry %v", e)
		}
	}

	// Delivery: cutoff mapped to the new stage, own target and commitment; management: headcount = target.
	delivery := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline/delivery", "", f.owner.token, nil)
	d := draftFlowObject(t, delivery.body)
	if delivery.status != 200 || d["cutoffStageId"] != defaults.Stages[3].ID || d["targetQuantity"] != float64(2) || d["commitmentDate"] != replBusinessDate(t) || d["version"] != "1" || d["fulfilled"] != false {
		t.Fatalf("delivery: %d %s", delivery.status, delivery.body)
	}
	management := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/management", "", f.owner.token, nil)
	m := draftFlowObject(t, management.body)
	if management.status != 200 || m["hiringHeadcount"] != float64(2) || m["requestDate"] != m["today"] || m["targetCloseDate"] != nil || m["version"] != "1" {
		t.Fatalf("management: %d %s", management.status, management.body)
	}
	// Substates and checklist are cloned at version 1; reminder stages follow the stage map.
	substates := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline/substates", "", f.owner.token, nil)
	if s := draftFlowObject(t, substates.body); substates.status != 200 || s["version"] != "1" || len(s["substates"].([]any)) != 1 {
		t.Fatalf("substates: %d %s", substates.status, substates.body)
	}
	list := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/checklist", "", f.owner.token, nil)
	c := draftFlowObject(t, list.body)
	if list.status != 200 || c["version"] != "1" || len(c["criteria"].([]any)) != 1 || !reflect.DeepEqual(c["reminder_stage_ids"], []any{defaults.Stages[3].ID, custom}) {
		t.Fatalf("checklist: %d %s", list.status, list.body)
	}

	if got := f.scalar(`SELECT profile->'auto_send_stage_ids' FROM job_draft_psychometric_profiles WHERE draft_id=$1 AND version=1`, id); !reflect.DeepEqual(got, any([]any{defaults.Stages[3].ID, custom})) {
		t.Fatalf("psychometric auto_send_stage_ids = %v", got)
	}

	// The team is fresh: the caller is the only member and the responsible.
	team := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/team", "", f.owner.token, nil)
	members := draftFlowObject(t, team.body)["members"].([]any)
	if team.status != 200 || len(members) != 1 || members[0].(map[string]any)["function"] != "responsible" || members[0].(map[string]any)["user"].(map[string]any)["id"] != owner {
		t.Fatalf("team: %d %s", team.status, team.body)
	}

	// Audit: a new draft, a new team, and the replacement; nothing on the finished source.
	if draftFlowAuditCount(t, f.h.pool, uuid.MustParse(id), "JobDraftCreated") != 1 || draftFlowAuditCount(t, f.h.pool, uuid.MustParse(id), "VacancyTeamCreated") != 1 {
		t.Fatal("draft/team audit rows")
	}
	started := f.auditMetadata(id, "VacancyReplacementStarted")
	want := map[string]any{
		"company_id": f.company.companyID.String(), "vacancy_id": id, "source_process_id": src, "root_process_id": src, "sequence": float64(1),
		"target_quantity": float64(2), "credit_ids": []any{c1, c2}, "carried_count": float64(0), "visibility": "private", "responsible_user_id": owner,
	}
	sortedCredits := []string{c1, c2}
	sort.Strings(sortedCredits)
	want["credit_ids"] = []any{sortedCredits[0], sortedCredits[1]}
	if !reflect.DeepEqual(started, want) {
		t.Fatalf("VacancyReplacementStarted = %v, want %v", started, want)
	}
	if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyReplacementStarted' AND entity_type='vacancy_process' AND vacancy_id=$1 AND company_id=$2 AND actor_id=$3`, id, f.company.companyID, f.owner.userID) != 1 {
		t.Fatal("VacancyReplacementStarted envelope")
	}
	if draftFlowAuditCount(t, f.h.pool, uuid.MustParse(src), "VacancyProcessFinished") != 0 {
		t.Fatal("an already finished source must not be finished again")
	}
}

func TestReplacementStartFinishesAClosedActiveSourceAndChains(t *testing.T) {
	f := newReplFlow(t)
	root := f.published()
	f.closeIt(root, "continue")
	f.cover(root)
	credit := f.credit(root, "did_not_hold")
	before, view := f.view(root)
	if view["process"] != "active" || view["version"] != "2" {
		t.Fatalf("setup = %s", before.body)
	}

	resp := f.start(root, replBody(t, "", credit))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	body := draftFlowObject(t, resp.body)
	first := body["id"].(string)
	source := body["source"].(map[string]any)
	if source["finished_by_start"] != true || source["id"] != root {
		t.Fatalf("source = %v", source)
	}
	after, afterView := f.view(root)
	if after.header.Get("ETag") != `"vl-`+root+`-v3"` || afterView["process"] != "finished" || afterView["process_finished_at"] == nil || !reflect.DeepEqual(afterView["allowed_actions"], []any{}) || afterView["active_replacement_id"] != first {
		t.Fatalf("source after = %s", after.body)
	}
	if !reflect.DeepEqual(source["lifecycle"], any(afterView)) {
		t.Fatalf("source.lifecycle = %v, want %v", source["lifecycle"], afterView)
	}
	// The lifecycle history and the audit trail say who finished it and why.
	history := f.h.do(t, "GET", draftFlowV2Path+"/"+root+"/lifecycle/history", "", f.owner.token, nil)
	items := draftFlowObject(t, history.body)["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["action"] != "finish_process" || items[0].(map[string]any)["actor"].(map[string]any)["id"] != f.owner.userID.String() {
		t.Fatalf("history = %s", history.body)
	}
	if f.count(`SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1 AND action='finish_process' AND lifecycle_version=3 AND process IS NULL AND actor_id=$2`, root, f.owner.userID) != 1 {
		t.Fatal("finish_process event")
	}
	finished := f.auditMetadata(root, "VacancyProcessFinished")
	if !reflect.DeepEqual(finished, map[string]any{"version": "3", "publication": "closed", "process": "finished", "cause": "replacement_started", "replacement_process_id": first}) {
		t.Fatalf("VacancyProcessFinished = %v", finished)
	}
	if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyProcessFinished' AND entity_type='vacancy_process' AND actor_id=$2`, root, f.owner.userID) != 1 {
		t.Fatal("VacancyProcessFinished envelope")
	}
	// An ordinary finish carries neither new key.
	other := f.published()
	f.closeIt(other, "continue")
	if got := f.transition(other, "finish-process", `{}`); got.status != 200 {
		t.Fatalf("finish: %d %s", got.status, got.body)
	}
	if plain := f.auditMetadata(other, "VacancyProcessFinished"); plain["cause"] != nil || plain["replacement_process_id"] != nil {
		t.Fatalf("ordinary finish metadata = %v", plain)
	}

	// A replacement of a replacement stays in the logical vacancy: same root, next sequence;
	// its closed-active source is finished by the start as well.
	f.closeIt(first, "continue")
	second := f.credit(first, "did_not_hold")
	resp = f.start(first, replBody(t, ``, second))
	if resp.status != 201 {
		t.Fatalf("second start: %d %s", resp.status, resp.body)
	}
	next := draftFlowObject(t, resp.body)
	if next["sequence"] != float64(2) || next["replacement_of"] != first || next["root_process_id"] != root || next["source"].(map[string]any)["finished_by_start"] != true {
		t.Fatalf("second = %s", resp.body)
	}
	_, view = f.view(first)
	replAssertView(t, view, map[string]any{"process": "finished", "active_replacement_id": next["id"], "can_start_replacement": false, "start_replacement_blocker": "replacement_active"})
	meta := f.auditMetadata(next["id"].(string), "VacancyReplacementStarted")
	if meta["sequence"] != float64(2) || meta["root_process_id"] != root || meta["source_process_id"] != first {
		t.Fatalf("second audit = %v", meta)
	}
	// Only one process of the chain is active afterwards: the newest replacement.
	if f.count(`SELECT count(*) FROM vacancy_processes p WHERE p.process_status='active' AND (p.id=$1 OR p.id IN (SELECT process_id FROM vacancy_replacements WHERE root_process_id=$1))`, root) != 1 {
		t.Fatal("exactly one active process per logical vacancy")
	}
}

// A refused start must not finish the source it would have replaced.
func TestReplacementStartRefusalDoesNotFinishTheSource(t *testing.T) {
	f := newReplFlow(t)
	root := f.published()
	f.closeIt(root, "continue")
	f.cover(root)
	before, _ := f.view(root)
	bad := f.credit(root, "active")
	resp := f.start(root, replBody(t, "", bad))
	draftFlowAssertError(t, resp, 422, "replacement_credits_invalid")
	after, view := f.view(root)
	if after.header.Get("ETag") != before.header.Get("ETag") || view["process"] != "active" || f.replacements() != 0 ||
		f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyProcessFinished'`, root) != 0 {
		t.Fatalf("a refused start finished the source: %s", after.body)
	}
}

func TestReplacementStartTargetQuantityAndResponsible(t *testing.T) {
	f := newReplFlow(t)
	recruiterID, recruiterSub := f.company.addUser(t, "recruiter")
	recruiter := f.h.actor(t, recruiterID, recruiterSub)
	outsiderID, outsiderSub := f.company.addUser(t, "recruiter")
	outsider := f.h.actor(t, outsiderID, outsiderSub)
	stakeholderID, stakeholderSub := f.company.addUser(t, "stakeholder")
	stakeholder := f.h.actor(t, stakeholderID, stakeholderSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreign := f.h.actor(t, foreignID, foreignSub)

	root, credits := f.closedChain(2)
	// The recruiter joins the source's team: a non-owner tramo may start.
	team := f.h.do(t, "GET", draftFlowV2Path+"/"+root+"/team", "", f.owner.token, nil)
	if added := f.h.do(t, "POST", draftFlowV2Path+"/"+root+"/team/members", fmt.Sprintf(`{"user_id":%q}`, recruiterID), f.owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()}); added.status != 200 {
		t.Fatalf("add member: %d %s", added.status, added.body)
	}
	etag := func() map[string]string {
		current, _ := f.view(root)
		return map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()}
	}

	// No access: 404 for a recruiter without tramo and for another company; 403 for a stakeholder.
	for _, tc := range []struct {
		token  string
		status int
		code   string
	}{{outsider.token, 404, "not_found"}, {foreign.token, 404, "not_found"}, {stakeholder.token, 403, "forbidden"}} {
		draftFlowAssertError(t, f.startWith(root, replBody(t, "", credits[0]), tc.token, etag()), tc.status, tc.code)
	}
	if f.replacements() != 0 {
		t.Fatal("a rejected start wrote")
	}

	// A non-owner may not hand the replacement to someone else, nor to a non-member.
	got := f.startWith(root, replBody(t, `,"responsible":{"user_id":"`+f.owner.userID.String()+`"}`, credits[0]), recruiter.token, etag())
	draftFlowAssertError(t, got, 403, "team_action_forbidden")
	got = f.startWith(root, replBody(t, `,"responsible":{"user_id":"`+uuid.NewString()+`"}`, credits[0]), f.owner.token, etag())
	draftFlowAssertError(t, got, 422, "not_company_member")
	got = f.startWith(root, replBody(t, `,"responsible":{"user_id":"`+stakeholderID.String()+`"}`, credits[0]), f.owner.token, etag())
	draftFlowAssertError(t, got, 422, "not_company_member")
	if f.replacements() != 0 {
		t.Fatal("a rejected start wrote")
	}

	// The non-owner starts, naming themselves explicitly: they are the responsible.
	got = f.startWith(root, replBody(t, `,"responsible":{"user_id":"`+recruiterID.String()+`"},"target_quantity":3`, credits...), recruiter.token, etag())
	if got.status != 201 {
		t.Fatalf("recruiter start: %d %s", got.status, got.body)
	}
	body := draftFlowObject(t, got.body)
	id := body["id"].(string)
	if body["target_quantity"] != float64(3) || body["responsible"].(map[string]any)["id"] != recruiterID.String() || body["started_by"].(map[string]any)["id"] != recruiterID.String() {
		t.Fatalf("body = %s", got.body)
	}
	if f.count(`SELECT count(*) FROM job_draft_management_configs WHERE draft_id=$1 AND hiring_headcount=3`, id) != 1 || f.count(`SELECT count(*) FROM job_draft_delivery_configs WHERE draft_id=$1 AND target_quantity=3`, id) != 1 {
		t.Fatal("target quantity must feed headcount and delivery target")
	}
	// They keep access to what they created; the old team does not carry over.
	if read := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/lifecycle", "", recruiter.token, nil); read.status != 200 {
		t.Fatalf("creator access: %d %s", read.status, read.body)
	}
	if f.count(`SELECT count(*) FROM vacancy_assignments WHERE draft_id=$1 AND ended_at IS NULL`, id) != 1 {
		t.Fatal("the team must be fresh")
	}

	// The owner may name another member as responsible; the owner is not on that team but sees it as owner.
	root2, credits2 := f.closedChain(1)
	got = f.startWith(root2, replBody(t, `,"responsible":{"user_id":"`+recruiterID.String()+`"}`, credits2[0]), f.owner.token, etag2(f, root2))
	if got.status != 201 {
		t.Fatalf("owner handover: %d %s", got.status, got.body)
	}
	body = draftFlowObject(t, got.body)
	if body["responsible"].(map[string]any)["id"] != recruiterID.String() || body["started_by"].(map[string]any)["id"] != f.owner.userID.String() {
		t.Fatalf("handover body = %s", got.body)
	}
	if f.count(`SELECT count(*) FROM vacancy_assignments a JOIN vacancy_assignment_functions fn ON fn.assignment_id=a.id WHERE a.draft_id=$1 AND a.user_id=$2 AND fn.function='responsible' AND a.ended_at IS NULL`, body["id"], recruiterID) != 1 {
		t.Fatal("responsible tramo")
	}
	meta := f.auditMetadata(body["id"].(string), "VacancyReplacementStarted")
	if meta["responsible_user_id"] != recruiterID.String() {
		t.Fatalf("audit = %v", meta)
	}
}

func etag2(f *replFlow, id string) map[string]string {
	current, _ := f.view(id)
	return map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()}
}

func TestReplacementStartPreconditionsAndErrors(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(2)
	expect := func(name string, resp draftFlowResponse, status int, code string) map[string]any {
		t.Helper()
		if resp.status != status || draftFlowCatalogCode(t, resp.body) != code {
			t.Fatalf("%s: %d %s, want %d %s", name, resp.status, resp.body, status, code)
		}
		draftFlowAssertNoStore(t, resp)
		return draftFlowObject(t, resp.body)
	}
	var drafts, replacements, links int
	linkCount := func() int { return f.count(`SELECT count(*) FROM vacancy_replacement_credits`) }
	// baseline is taken after a subtest's own fixtures exist: rejections must add nothing to it.
	baseline := func() { drafts, replacements, links = f.companyDrafts(), f.replacements(), linkCount() }
	baseline()
	unchanged := func(name string) {
		t.Helper()
		if f.companyDrafts() != drafts || f.replacements() != replacements || linkCount() != links {
			t.Fatalf("%s wrote", name)
		}
	}

	t.Run("source not closed", func(t *testing.T) {
		never := f.draft()
		published := f.published()
		paused := f.published()
		if got := f.transition(paused, "pause", `{}`); got.status != 200 {
			t.Fatal(got.body)
		}
		baseline()
		for name, id := range map[string]string{"never published": never, "published": published, "paused": paused} {
			resp := f.start(id, replBody(t, "", credits[0]))
			body := expect(name, resp, 409, "replacement_source_not_closed")
			_, view := f.view(id)
			if data := body["data"].(map[string]any); len(data) != 1 || !reflect.DeepEqual(data["lifecycle"], any(view)) {
				t.Fatalf("%s data = %v, want only the lifecycle %v", name, data, view)
			}
		}
		unchanged("source not closed")
	})

	t.Run("not latest and already active", func(t *testing.T) {
		chainRoot, chainCredits := f.closedChain(1)
		first := f.published()
		f.link(first, chainRoot, chainRoot, 1)
		// Replacement active: the original answers already_active with the active process.
		resp := f.start(chainRoot, replBody(t, "", chainCredits[0]))
		body := expect("active", resp, 409, "replacement_already_active")
		data := body["data"].(map[string]any)
		_, view := f.view(chainRoot)
		if data["process_id"] != first || data["root_process_id"] != chainRoot || len(data) != 3 || !reflect.DeepEqual(data["lifecycle"], any(view)) {
			t.Fatalf("data = %v", data)
		}
		// Replacement finished: the original is simply not the latest.
		f.closeIt(first, "finish")
		resp = f.start(chainRoot, replBody(t, "", chainCredits[0]))
		body = expect("not latest", resp, 409, "replacement_source_not_latest")
		data = body["data"].(map[string]any)
		_, view = f.view(chainRoot)
		if data["latest_process_id"] != first || data["root_process_id"] != chainRoot || len(data) != 3 || !reflect.DeepEqual(data["lifecycle"], any(view)) {
			t.Fatalf("data = %v", data)
		}
	})

	t.Run("credits", func(t *testing.T) {
		chainRoot, chainCredits := f.closedChain(1)
		first := f.published()
		f.link(first, chainRoot, chainRoot, 1)
		f.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, first, chainCredits[0])
		f.closeIt(first, "finish")
		stillActive := f.credit(first, "active")
		voided := f.credit(first, "voided")
		fresh := f.credit(first, "did_not_hold")
		foreignRoot, foreignCredits := f.closedChain(1)
		_ = foreignRoot
		unknown := uuid.NewString()

		resp := f.start(first, replBody(t, "", chainCredits[0], stillActive, voided, foreignCredits[0], unknown, fresh))
		body := expect("credits", resp, 422, "replacement_credits_invalid")
		want := []any{
			map[string]any{"credit_id": chainCredits[0], "reason": "already_replaced"},
			map[string]any{"credit_id": stillActive, "reason": "not_did_not_hold"},
			map[string]any{"credit_id": voided, "reason": "not_did_not_hold"},
			map[string]any{"credit_id": foreignCredits[0], "reason": "not_in_chain"},
			map[string]any{"credit_id": unknown, "reason": "not_in_chain"},
		}
		if got := body["data"].(map[string]any)["credits"]; !reflect.DeepEqual(got, any(want)) || len(body["data"].(map[string]any)) != 1 {
			t.Fatalf("credits = %v, want %v", got, want)
		}
		if f.count(`SELECT count(*) FROM vacancy_replacements WHERE root_process_id=$1`, chainRoot) != 1 {
			t.Fatal("a rejected start wrote a replacement")
		}
		// A credit of any process of the chain is accepted (here the original's, from the latest process).
		f.exec(`UPDATE placement_credits SET status='did_not_hold' WHERE id=$1`, stillActive)
		okCredit := f.credit(chainRoot, "did_not_hold")
		resp = f.start(first, replBody(t, "", okCredit, fresh))
		if resp.status != 201 {
			t.Fatalf("chain credits: %d %s", resp.status, resp.body)
		}
	})

	t.Run("validation", func(t *testing.T) {
		baseline()
		field := func(name, extra string, want ...map[string]any) {
			t.Helper()
			resp := f.start(root, replBody(t, extra, credits...))
			expect(name, resp, 400, "validation_error")
			if got := draftFlowObject(t, resp.body)["fields"]; !reflect.DeepEqual(got, any(toAny(want))) {
				t.Fatalf("%s fields = %v, want %v", name, got, want)
			}
		}
		field("below credits", `,"target_quantity":1`, map[string]any{"field": "target_quantity", "code": "below_credits_count"})
		field("zero", `,"target_quantity":0`, map[string]any{"field": "target_quantity", "code": "out_of_range"})
		field("above max", `,"target_quantity":1000`, map[string]any{"field": "target_quantity", "code": "out_of_range"})

		past := `{"placement_credit_ids":` + replCreditsJSON(credits) + `,"commitment_date":"2020-01-06","target_quantity":1}`
		resp := f.start(root, past)
		expect("past date", resp, 400, "validation_error")
		if got := draftFlowObject(t, resp.body)["fields"]; !reflect.DeepEqual(got, any(toAny([]map[string]any{{"field": "target_quantity", "code": "below_credits_count"}, {"field": "commitment_date", "code": "out_of_range"}}))) {
			t.Fatalf("both fields = %v", got)
		}
		weekend := `{"placement_credit_ids":` + replCreditsJSON(credits) + `,"commitment_date":"` + replWeekend(t) + `"}`
		expect("weekend", f.start(root, weekend), 400, "non_business_date")

		for name, body := range map[string]string{
			"empty body":          ``,
			"not an object":       `[]`,
			"no credits key":      `{"commitment_date":"` + replBusinessDate(t) + `"}`,
			"empty credits":       `{"placement_credit_ids":[],"commitment_date":"` + replBusinessDate(t) + `"}`,
			"duplicate credits":   `{"placement_credit_ids":["` + credits[0] + `","` + credits[0] + `"],"commitment_date":"` + replBusinessDate(t) + `"}`,
			"bad credit id":       `{"placement_credit_ids":["nope"],"commitment_date":"` + replBusinessDate(t) + `"}`,
			"no commitment date":  `{"placement_credit_ids":` + replCreditsJSON(credits) + `}`,
			"bad commitment date": `{"placement_credit_ids":` + replCreditsJSON(credits) + `,"commitment_date":"15/12/2026"}`,
			"unknown key":         replBody(t, `,"surprise":true`, credits...),
			"string target":       replBody(t, `,"target_quantity":"2"`, credits...),
			"float target":        replBody(t, `,"target_quantity":2.5`, credits...),
			"bad responsible":     replBody(t, `,"responsible":{"id":"x"}`, credits...),
			"responsible extra":   replBody(t, `,"responsible":{"user_id":"`+f.owner.userID.String()+`","x":1}`, credits...),
			// publish must be a boolean (true is R3c, replacement_publication_integration_test.go); carried
			// candidates (R3b) are covered by replacement_carry_integration_test.go.
			"publish string":        replBody(t, `,"publish":"no"`, credits...),
			"publish number":        replBody(t, `,"publish":1`, credits...),
			"carried without stage": replBody(t, `,"carried_candidates":[{"candidate":{"kind":"manual","id":"`+uuid.NewString()+`"}}]`, credits...),
		} {
			expect(name, f.start(root, body), 400, "invalid_request")
		}
		// The explicit defaults are accepted shapes (checked below with a real start): publish:false, no carried.
		unchanged("validation")
	})

	t.Run("headers", func(t *testing.T) {
		baseline()
		current, _ := f.view(root)
		etag := current.header.Get("ETag")
		body := replBody(t, "", credits...)
		key := uuid.NewString()
		expect("no key", f.startWith(root, body, f.owner.token, map[string]string{"If-Match": etag}), 400, "idempotency_key_required")
		expect("bad key", f.startWith(root, body, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": "nope"}), 400, "invalid_idempotency_key")
		expect("no if-match", f.startWith(root, body, f.owner.token, map[string]string{"Idempotency-Key": key}), 428, "precondition_required")
		expect("malformed", f.startWith(root, body, f.owner.token, map[string]string{"If-Match": "W/x", "Idempotency-Key": key}), 400, "invalid_request")
		expect("stale", f.startWith(root, body, f.owner.token, map[string]string{"If-Match": `"vl-` + root + `-v1"`, "Idempotency-Key": key}), 412, "version_conflict")
		expect("other resource", f.startWith(root, body, f.owner.token, map[string]string{"If-Match": `"vl-` + uuid.NewString() + `-v3"`, "Idempotency-Key": key}), 412, "version_conflict")
		expect("bad id", f.h.do(t, "POST", draftFlowV2Path+"/not-a-uuid/replacements", body, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": key}), 400, "invalid_request")
		expect("unknown draft", f.startWith(uuid.NewString(), body, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": key}), 404, "not_found")
		unchanged("headers")
	})
}

func toAny(items []map[string]any) []any {
	out := make([]any, len(items))
	for i, item := range items {
		out[i] = item
	}
	return out
}

func TestReplacementStartIdempotencyAndETag(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(2)
	body := replBody(t, `,"publish":false,"carried_candidates":[]`, credits...)
	current, _ := f.view(root)
	headers := map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()}

	first := f.startWith(root, body, f.owner.token, headers)
	if first.status != 201 || first.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("first: %d %s", first.status, first.body)
	}
	drafts := f.companyDrafts()
	// The same key with the same payload (whitespace aside) replays the frozen response.
	spaced := strings.ReplaceAll(body, `,"`, `, "`)
	replay := f.startWith(root, spaced, f.owner.token, headers)
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || string(replay.body) != string(first.body) || replay.header.Get("ETag") != first.header.Get("ETag") || replay.header.Get("Location") != first.header.Get("Location") {
		t.Fatalf("replay: %d %v %s", replay.status, replay.header, replay.body)
	}
	// Replay is answered even though the source moved on (a stale If-Match, a successor now exists).
	headers["If-Match"] = `"vl-` + root + `-v1"`
	if again := f.startWith(root, body, f.owner.token, headers); again.status != 201 || again.header.Get("Idempotency-Replayed") != "true" || string(again.body) != string(first.body) {
		t.Fatalf("stale replay: %d %s", again.status, again.body)
	}
	if f.replacements() != 1 || f.companyDrafts() != drafts {
		t.Fatal("a replay wrote")
	}
	// Different payload, same key: conflict. Same key on another source: conflict.
	other := replBody(t, `,"target_quantity":3`, credits...)
	got := f.startWith(root, other, f.owner.token, headers)
	draftFlowAssertError(t, got, 409, "idempotency_conflict")
	otherRoot, otherCredits := f.closedChain(1)
	got = f.startWith(otherRoot, replBody(t, "", otherCredits...), f.owner.token, headers)
	draftFlowAssertError(t, got, 409, "idempotency_conflict")
	if f.replacements() != 1 {
		t.Fatal("a conflicting key wrote")
	}
	if f.count(`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1 AND operation='vacancy-replacement:r1'`, f.company.companyID) != 1 {
		t.Fatal("exactly one frozen response is stored")
	}
}

func TestReplacementStartNeverPublishesTheNewProcess(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(1)
	resp := f.start(root, replBody(t, "", credits...))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	id := draftFlowObject(t, resp.body)["id"].(string)
	// Private by default: a process row and no projection, so neither the public
	// catalog nor a candidate application can see it.
	projections := func() int { return f.count(`SELECT count(*) FROM vacancy_public_projections WHERE id=$1`, id) }
	if projections() != 0 {
		t.Fatal("Start created a public projection")
	}
	// Editing the replacement's ad must not publish it (refreshPublicProjection only refreshes an existing projection).
	publicFlowPatch(t, f.h, id, f.owner, map[string]any{"title": "Backend Go (reemplazo)"})
	if projections() != 0 {
		t.Fatal("saving the replacement draft created a public projection")
	}
	// The original keeps refreshing its own projection as before.
	publicFlowPatch(t, f.h, root, f.owner, map[string]any{"title": "Backend Go editado"})
	if f.count(`SELECT count(*) FROM vacancy_public_projections WHERE id=$1 AND title='Backend Go editado'`, root) != 1 {
		t.Fatal("a published original must still refresh its projection")
	}
	_, view := f.view(id)
	if view["visibility"] != "private" {
		t.Fatalf("visibility = %v", view["visibility"])
	}
}

func TestReplacementStartConcurrentStartsOneWins(t *testing.T) {
	for _, tc := range []struct {
		name  string
		close string
	}{{"finished source", "finish"}, {"closed-active source", "continue"}} {
		t.Run(tc.name, func(t *testing.T) {
			f := newReplFlow(t)
			root := f.published()
			f.closeIt(root, tc.close)
			f.cover(root)
			credits := []string{f.credit(root, "did_not_hold"), f.credit(root, "did_not_hold"), f.credit(root, "did_not_hold"), f.credit(root, "did_not_hold")}
			current, _ := f.view(root)
			etag := current.header.Get("ETag")
			drafts := f.companyDrafts()

			const racers = 4
			bodies := make([]string, racers)
			for i := range bodies {
				bodies[i] = replBody(t, "", credits[i])
			}
			results := make(chan draftFlowCall, racers)
			var ready, done sync.WaitGroup
			ready.Add(1)
			for i := 0; i < racers; i++ {
				done.Add(1)
				go func(body string) {
					defer done.Done()
					ready.Wait()
					resp, err := f.h.roundTrip("POST", draftFlowV2Path+"/"+root+"/replacements", body, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": uuid.NewString()})
					results <- draftFlowCall{resp: resp, err: err}
				}(bodies[i])
			}
			ready.Done()
			done.Wait()
			close(results)

			created, losers := 0, 0
			for r := range results {
				if r.err != nil {
					t.Fatal(r.err)
				}
				switch r.resp.status {
				case 201:
					created++
				case 409:
					if code := draftFlowCatalogCode(t, r.resp.body); code != "replacement_already_active" {
						t.Fatalf("loser = %d %s", r.resp.status, r.resp.body)
					}
					losers++
				case 412:
					// A closed-active source is finished by the winner, so its ETag moved before the loser's check.
					if tc.close != "continue" || draftFlowCatalogCode(t, r.resp.body) != "version_conflict" {
						t.Fatalf("loser = %d %s", r.resp.status, r.resp.body)
					}
					losers++
				default:
					t.Fatalf("unexpected %d %s", r.resp.status, r.resp.body)
				}
			}
			if created != 1 || losers != racers-1 {
				t.Fatalf("created %d, losers %d", created, losers)
			}
			if f.replacements() != 1 || f.companyDrafts() != drafts+1 || f.count(`SELECT count(*) FROM vacancy_replacement_credits`) != 1 {
				t.Fatalf("replacements %d, drafts %d (was %d)", f.replacements(), f.companyDrafts(), drafts)
			}
			if f.count(`SELECT count(*) FROM vacancy_processes p JOIN vacancy_replacements r ON r.root_process_id=p.id AND r.process_id<>p.id WHERE p.id=$1 AND p.process_status='finished'`, root) != 1 {
				t.Fatal("the source must end up finished")
			}
		})
	}
}
