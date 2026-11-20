//go:build integration

package main

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Replacement processes R3b (docs/contracts/replacement-processes-v1.md,
// «Carried candidates»): Start with carried_candidates through the production
// router. Candidates are seeded with SQL (their intake paths are other
// features); everything under test goes through POST V/replacements.

// carryPerson is a candidate the fixtures can place in a process: kind manual
// (a company candidate with a company CV) or organic (a user with a library CV).
type carryPerson struct {
	kind string
	id   uuid.UUID
	cv   uuid.UUID
	name string
}

type carryFlow struct {
	*replFlow
	people []carryPerson
}

func newCarryFlow(t *testing.T) *carryFlow {
	t.Helper()
	f := &carryFlow{replFlow: newReplFlow(t)}
	// Registered after the company and replacement cleanups, so it runs first:
	// participations (and the carried ones that point at them) go before their
	// processes, and the candidates after the participations.
	t.Cleanup(func() {
		ctx := context.Background()
		for _, q := range []string{
			`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1)`,
			`DELETE FROM process_participations WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
			`DELETE FROM process_delivery_fulfillments WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
		} {
			if _, err := f.h.pool.Exec(ctx, q, f.company.companyID); err != nil {
				t.Errorf("carry fixture cleanup: %v", err)
			}
		}
		f.dropPeople(f.people)
	})
	return f
}

func (f *carryFlow) dropPeople(people []carryPerson) {
	ctx := context.Background()
	for _, p := range people {
		for _, q := range []string{
			`DELETE FROM process_participations WHERE company_candidate_id=$1 OR candidate_id=$1`,
			`DELETE FROM company_candidate_cvs WHERE company_candidate_id=$1`,
			`DELETE FROM company_candidates WHERE id=$1`,
			`DELETE FROM candidate_cv_library WHERE candidate_id=$1`,
			`DELETE FROM candidate_cv_versions WHERE candidate_id=$1`,
			`DELETE FROM users WHERE id=$1 AND user_type='candidate'`,
		} {
			if _, err := f.h.pool.Exec(ctx, q, p.id); err != nil {
				f.t.Errorf("carry person cleanup: %v", err)
			}
		}
	}
}

func carryKey() string { return strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "") }

// person seeds a candidate of `company`, created by `by`.
func (f *carryFlow) person(kind, name string, company, by uuid.UUID) carryPerson {
	f.t.Helper()
	p := carryPerson{kind: kind, id: uuid.New(), cv: uuid.New(), name: name}
	if kind == "manual" {
		f.exec(`INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,professional_title,created_by) VALUES($1,$2,$3,$4,$4,'US','Title',$5)`, p.id, company, name, "c-"+p.id.String()+"@example.test", by)
		f.exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,6,'application/pdf','cv.pdf')`, p.cv, company, p.id, carryKey())
	} else {
		f.exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,$4,'candidate')`, p.id, uuid.NewString(), "o-"+p.id.String()+"@example.test", name)
		f.exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, p.cv, p.id, carryKey())
		f.exec(`INSERT INTO candidate_cv_library(id,candidate_id,version_id,name) VALUES($1,$2,$3,'cv.pdf')`, uuid.New(), p.id, p.cv)
	}
	f.people = append(f.people, p)
	return p
}

func (f *carryFlow) manual(name string) carryPerson {
	return f.person("manual", name, f.company.companyID, f.owner.userID)
}
func (f *carryFlow) organic(name string) carryPerson {
	return f.person("organic", name, f.company.companyID, f.owner.userID)
}

// participateAs puts the person in `process` at `stage`, applied/added at `at`.
func (f *carryFlow) participateAs(process string, p carryPerson, stage string, at time.Time, by uuid.UUID) string {
	f.t.Helper()
	pid := uuid.NewString()
	if p.kind == "manual" {
		f.exec(`INSERT INTO process_participations(id,process_id,company_candidate_id,company_candidate_cv_id,stage_id,source,added_by,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,created_at) VALUES($1,$2,$3,$4,$5,'manual',$6,'{`+snapshot00061Fields+`,"professional_title":"Frozen"}','[]','[]','manual',$7)`,
			pid, process, p.id, p.cv, stage, by, at)
		f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind) VALUES($1,$2,$3,$4,$5,NULL,false,false,'recruiter','intake')`, uuid.New(), pid, stage, by, at)
	} else {
		f.exec(`INSERT INTO process_participations(id,process_id,candidate_id,cv_version_id,stage_id,source,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,created_at) VALUES($1,$2,$3,$4,$5,'organic','{`+snapshot00061Fields+`,"professional_title":"Frozen"}','[]','[]','careers_site',$6)`,
			pid, process, p.id, p.cv, stage, at)
		f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at) VALUES($1,$2,$3,$4,$5)`, uuid.New(), pid, stage, p.id, at)
	}
	return pid
}

func (f *carryFlow) participate(process string, p carryPerson, stage string, at time.Time) string {
	return f.participateAs(process, p, stage, at, f.owner.userID)
}

// discard turns the participation into a discarded one, as the board does.
func (f *carryFlow) discard(pid, exit, from string) {
	f.t.Helper()
	f.exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=$3,reason_group='candidate',reason_code='unresponsive',discarded_at=created_at WHERE id=$1`, pid, exit, from)
}

// replStages maps a draft's built-in stage kinds (and the exit, kind "discarded") to their ids.
func replStages(id string) map[string]string {
	d := pipelineconfig.Defaults(uuid.MustParse(id))
	out := map[string]string{d.Exit.Kind: d.Exit.ID}
	for _, s := range d.Stages {
		out[s.Kind] = s.ID
	}
	return out
}

func carriedItem(p carryPerson, stage string) string {
	return `{"candidate":{"kind":"` + p.kind + `","id":"` + p.id.String() + `"},"stage_id":"` + stage + `"}`
}

func carriedJSON(items ...string) string {
	return `,"carried_candidates":[` + strings.Join(items, ",") + `]`
}

// rejected asserts a 4xx answer with the code and returns data.
func (f *carryFlow) rejected(resp draftFlowResponse, status int, code string) map[string]any {
	f.t.Helper()
	body := draftFlowObject(f.t, resp.body)
	if resp.status != status || body["code"] != code {
		f.t.Fatalf("%d %s, want %d %s", resp.status, resp.body, status, code)
	}
	data, _ := body["data"].(map[string]any)
	return data
}

func carryProblems(data map[string]any) []any { return data["candidates"].([]any) }

func carryProblem(index int, reason string) map[string]any {
	return map[string]any{"index": float64(index), "reason": reason}
}

// carryState is what a rejected start must leave untouched.
type carryState struct{ drafts, replacements, carried, audits, fulfillments int }

func (f *carryFlow) state() carryState {
	f.t.Helper()
	return carryState{
		drafts: f.companyDrafts(), replacements: f.replacements(),
		carried:      f.count(`SELECT count(*) FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE p.carried_from_participation_id IS NOT NULL AND vp.company_id=$1`, f.company.companyID),
		audits:       f.count(`SELECT count(*) FROM audit_events WHERE event_type IN ('VacancyCandidateCarried','VacancyReplacementStarted','VacancyDeliveryFulfilled') AND company_id=$1`, f.company.companyID),
		fulfillments: f.count(`SELECT count(*) FROM process_delivery_fulfillments d JOIN vacancy_processes vp ON vp.id=d.process_id WHERE vp.company_id=$1`, f.company.companyID),
	}
}

// unchanged asserts that a rejected start left no trace.
func (f *carryFlow) unchanged(before carryState) {
	f.t.Helper()
	if after := f.state(); after != before {
		f.t.Fatalf("a rejected start changed the state: %+v, was %+v", after, before)
	}
}

// delivered reads the delivery status of the board of a process.
func (f *carryFlow) board(id string) map[string]any {
	f.t.Helper()
	got := f.h.do(f.t, "GET", draftFlowV2Path+"/"+id+"/board", "", f.owner.token, nil)
	if got.status != 200 {
		f.t.Fatalf("board %s: %d %s", id, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

func TestReplacementStartCarriesManualAndOrganicCandidates(t *testing.T) {
	f := newCarryFlow(t)
	src, custom := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	c1, c2 := f.credit(src, "did_not_hold"), f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)

	marta, luis, ana := f.manual("Marta Ruiz"), f.manual("Luis Pérez"), f.organic("Ana Orgánica")
	pMarta := f.participate(src, marta, s["screening"], at)
	corrected := uuid.New()
	f.exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,6,'application/pdf','fixed.pdf')`, corrected, f.company.companyID, marta.id, carryKey())
	f.exec(`UPDATE process_participations SET corrected_company_cv_id=$2 WHERE id=$1`, pMarta, corrected)
	pLuis := f.participate(src, luis, s["in_process"], at)
	f.discard(pLuis, s["discarded"], s["in_process"])
	pAna := f.participate(src, ana, s["new"], at)
	sourceBefore := f.scalar(`SELECT json_agg(p ORDER BY id)::text FROM process_participations p WHERE process_id=$1`, src)

	key := uuid.NewString()
	current, _ := f.view(src)
	tag := current.header.Get("ETag")
	body := replBody(t, carriedJSON(carriedItem(marta, s["in_process"]), carriedItem(luis, custom), carriedItem(ana, s["screening"])), c1, c2)
	resp := f.startWith(src, body, f.owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": key})
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	out := draftFlowObject(t, resp.body)
	id := out["id"].(string)
	n := replStages(id)

	// Stages are named by source id and come back as the replacement's ids: built-ins are
	// re-derived for the new draft, a custom stage keeps its id.
	if n["in_process"] == s["in_process"] || n["screening"] == s["screening"] {
		t.Fatal("built-in ids must be re-derived for the replacement")
	}
	carried := out["carried"].([]any)
	if len(carried) != 3 {
		t.Fatalf("carried = %v", carried)
	}
	people := []struct {
		p        carryPerson
		template string
		stage    string
	}{{marta, pMarta, n["in_process"]}, {luis, pLuis, custom}, {ana, pAna, n["screening"]}}
	pids := make([]string, len(people))
	for i, want := range people {
		item := carried[i].(map[string]any)
		if got, wantKeys := replSortedKeys(item), []string{"candidate", "carried_from_participation_id", "participation_id", "stage_id"}; !reflect.DeepEqual(got, wantKeys) {
			t.Fatalf("carried keys = %v", got)
		}
		pids[i] = item["participation_id"].(string)
		if item["carried_from_participation_id"] != want.template || item["stage_id"] != want.stage ||
			!reflect.DeepEqual(item["candidate"], map[string]any{"kind": want.p.kind, "id": want.p.id.String()}) {
			t.Fatalf("carried[%d] = %v, want template %s stage %s", i, item, want.template, want.stage)
		}
	}
	if !reflect.DeepEqual(out["delivery"], map[string]any{"delivered": float64(2), "target": float64(2), "fulfilled": true}) {
		t.Fatalf("delivery = %v", out["delivery"])
	}

	for i, want := range people {
		// A new participation that copies the template, is never discarded and starts a fresh life.
		if got := f.count(`SELECT count(*) FROM process_participations c JOIN process_participations t ON t.id=c.carried_from_participation_id
 WHERE c.id=$1 AND t.id=$5 AND c.process_id=$2 AND c.stage_id=$3 AND c.source=t.source AND c.candidate_id IS NOT DISTINCT FROM t.candidate_id
 AND c.company_candidate_id IS NOT DISTINCT FROM t.company_candidate_id AND c.cv_version_id IS NOT DISTINCT FROM t.cv_version_id
 AND c.company_candidate_cv_id IS NOT DISTINCT FROM t.company_candidate_cv_id AND c.corrected_company_cv_id IS NOT DISTINCT FROM t.corrected_company_cv_id
 AND c.profile_snapshot IS NOT DISTINCT FROM t.profile_snapshot AND c.questions_snapshot=t.questions_snapshot AND c.answers_snapshot=t.answers_snapshot
 AND c.origin_channel=t.origin_channel AND c.version=1 AND c.created_at=(SELECT started_at FROM vacancy_replacements WHERE process_id=$2)
 AND c.discarded_at IS NULL AND c.previous_stage_id IS NULL AND c.reason_group IS NULL AND c.reason_code IS NULL AND c.substate_id IS NULL AND c.candidate_message IS NULL
 AND (c.source='manual') = (c.added_by IS NOT NULL) AND (c.added_by IS NULL OR c.added_by=$4)`, pids[i], id, want.stage, f.owner.userID, want.template); got != 1 {
			t.Fatalf("participation %d does not copy its template", i)
		}
		// One intake history row at the chosen stage, by the recruiter who started the replacement.
		if got := f.count(`SELECT count(*) FROM participation_stage_history h JOIN vacancy_replacements r ON r.process_id=$2 WHERE h.participation_id=$1 AND h.stage_id=$3 AND h.actor_id=$4
 AND h.from_stage_id IS NULL AND NOT h.hire AND NOT h.departure AND h.actor_kind='recruiter' AND h.event_kind='intake' AND h.created_at=r.started_at`, pids[i], id, want.stage, f.owner.userID); got != 1 {
			t.Fatalf("history of %d", i)
		}
		if f.count(`SELECT count(*) FROM participation_stage_history WHERE participation_id=$1`, pids[i]) != 1 {
			t.Fatalf("history of %d is not exactly the intake row", i)
		}
		// Audit: one VacancyCandidateCarried per candidate, ids and codes only.
		meta := f.auditMetadata(pids[i], "VacancyCandidateCarried")
		wantMeta := map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": id, "source_process_id": src, "source_participation_id": want.template,
			"candidate_kind": want.p.kind, "candidate_id": want.p.id.String(), "stage_id": want.stage}
		if !reflect.DeepEqual(meta, wantMeta) {
			t.Fatalf("audit %d = %v, want %v", i, meta, wantMeta)
		}
		if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyCandidateCarried' AND entity_type='process_participation' AND actor_id=$2 AND company_id=$3`, pids[i], f.owner.userID, f.company.companyID) != 1 {
			t.Fatalf("audit row %d", i)
		}
	}
	// Nothing on the source changes: the carry copies, it never moves.
	if after := f.scalar(`SELECT json_agg(p ORDER BY id)::text FROM process_participations p WHERE process_id=$1`, src); after != sourceBefore {
		t.Fatal("the source participations changed")
	}
	if got := f.auditMetadata(id, "VacancyReplacementStarted")["carried_count"]; got != float64(3) {
		t.Fatalf("carried_count = %v", got)
	}

	// Delivery counts like a manual intake: at or after the cutoff (in_process) is delivered
	// (Marta, Luis); before it is not (Ana). Two of two: fulfilled inside the start.
	if got := f.count(`SELECT count(*) FROM process_delivery_fulfillments WHERE process_id=$1 AND delivered=2 AND target=2`, id); got != 1 {
		t.Fatal("fulfillment row")
	}
	var snapshot []byte
	if err := f.h.pool.QueryRow(context.Background(), `SELECT candidates FROM process_delivery_fulfillments WHERE process_id=$1`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(snapshot), pids[0]) || !strings.Contains(string(snapshot), pids[1]) || strings.Contains(string(snapshot), pids[2]) {
		t.Fatalf("delivered candidates = %s", snapshot)
	}
	if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyDeliveryFulfilled'`, id) != 1 {
		t.Fatal("VacancyDeliveryFulfilled")
	}

	status := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline/delivery/status", "", f.owner.token, nil)
	if got := draftFlowObject(t, status.body); status.status != 200 || got["state"] != "fulfilled" || got["delivered"] != float64(2) || got["fulfillment"] == nil {
		t.Fatalf("delivery status: %d %s", status.status, status.body)
	}

	// The production board reads the carried participations like any other.
	board := f.board(id)
	if !reflect.DeepEqual(board["delivery"], map[string]any{"state": "fulfilled", "delivered": float64(2), "target": float64(2)}) {
		t.Fatalf("board delivery = %v", board["delivery"])
	}
	items := board["participations"].([]any)
	if len(items) != 3 {
		t.Fatalf("board participations = %d", len(items))
	}
	byID := map[string]map[string]any{}
	for _, raw := range items {
		item := raw.(map[string]any)
		byID[item["id"].(string)] = item
	}
	for i, want := range people {
		item := byID[pids[i]]
		if item == nil || item["stage_id"] != want.stage || item["discard"] != nil || item["source"] != map[string]string{"manual": "manual", "organic": "organic"}[want.p.kind] {
			t.Fatalf("board item %d = %v", i, item)
		}
	}

	// Replay: the frozen response, no second set of participations, history or audit rows.
	replay := f.startWith(src, body, f.owner.token, map[string]string{"If-Match": `"vl-stale"`, "Idempotency-Key": key})
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || string(replay.body) != string(resp.body) {
		t.Fatalf("replay: %d %v %s", replay.status, replay.header, replay.body)
	}
	if f.count(`SELECT count(*) FROM process_participations WHERE process_id=$1`, id) != 3 || f.count(`SELECT count(*) FROM audit_events WHERE event_type='VacancyCandidateCarried' AND company_id=$1`, f.company.companyID) != 3 {
		t.Fatal("replay created rows")
	}
	// The same key with other carried candidates is another request.
	other := replBody(t, carriedJSON(carriedItem(marta, s["screening"])), c1, c2)
	if conflict := f.startWith(src, other, f.owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": key}); conflict.status != 409 || draftFlowObject(t, conflict.body)["code"] != "idempotency_conflict" {
		t.Fatalf("different carried: %d %s", conflict.status, conflict.body)
	}
}

func TestReplacementCarryDeliveryCountsLikeManualIntake(t *testing.T) {
	f := newCarryFlow(t)
	src, _ := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	c1, c2 := f.credit(src, "did_not_hold"), f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)
	early, exact := f.manual("Antes del corte"), f.organic("En el corte")
	f.participate(src, early, s["new"], at)
	f.participate(src, exact, s["new"], at)

	// Before the cutoff (in_process) does not deliver; an organic candidate exactly at it does:
	// one delivered of two, not fulfilled, nothing recorded.
	resp := f.start(src, replBody(t, carriedJSON(carriedItem(early, s["screening_ok"]), carriedItem(exact, s["in_process"])), c1, c2))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	out := draftFlowObject(t, resp.body)
	id := out["id"].(string)
	if !reflect.DeepEqual(out["delivery"], map[string]any{"delivered": float64(1), "target": float64(2), "fulfilled": false}) {
		t.Fatalf("delivery = %v", out["delivery"])
	}
	if f.count(`SELECT count(*) FROM process_delivery_fulfillments WHERE process_id=$1`, id) != 0 || f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyDeliveryFulfilled'`, id) != 0 {
		t.Fatal("a pending delivery must not be fulfilled")
	}
	if board := f.board(id); !reflect.DeepEqual(board["delivery"], map[string]any{"state": "pending", "delivered": float64(1), "target": float64(2)}) {
		t.Fatalf("board delivery = %v", board["delivery"])
	}
	status := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline/delivery/status", "", f.owner.token, nil)
	got := draftFlowObject(t, status.body)
	if status.status != 200 || got["state"] != "pending" || got["delivered"] != float64(1) || got["target"] != float64(2) || got["fulfillment"] != nil {
		t.Fatalf("delivery status: %d %s", status.status, status.body)
	}
}

// More candidates at or after the cutoff than the target: fulfilled in the start, the snapshot
// keeps exactly the target, and every delivered candidate is counted.
func TestReplacementCarryMoreThanTheTargetFulfills(t *testing.T) {
	f := newCarryFlow(t)
	src, custom := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)
	a, b, c := f.manual("Uno Perez"), f.organic("Dos Perez"), f.manual("Tres Perez")
	for _, p := range []carryPerson{a, b, c} {
		f.participate(src, p, s["new"], at)
	}
	// The organic candidate is carried beyond the cutoff: it is delivered by intake, not by a cutoff entry.
	resp := f.start(src, replBody(t, carriedJSON(carriedItem(a, s["in_process"]), carriedItem(b, custom), carriedItem(c, s["in_process"])), credit))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	out := draftFlowObject(t, resp.body)
	id := out["id"].(string)
	if !reflect.DeepEqual(out["delivery"], map[string]any{"delivered": float64(3), "target": float64(1), "fulfilled": true}) {
		t.Fatalf("delivery = %v", out["delivery"])
	}
	if f.count(`SELECT count(*) FROM process_delivery_fulfillments WHERE process_id=$1 AND delivered=3 AND target=1 AND jsonb_array_length(candidates)=1`, id) != 1 {
		t.Fatal("fulfillment row")
	}
}

// An organic candidate carried beyond the cutoff is the only delivered candidate that fulfils:
// the intake rule that recognizes it is the one for manual intake, extended to carried rows.
func TestReplacementCarryOrganicBeyondTheCutoffFulfills(t *testing.T) {
	f := newCarryFlow(t)
	src, custom := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	organic := f.organic("Solo Organico")
	f.participate(src, organic, s["new"], time.Now().UTC().Add(-72*time.Hour).Truncate(time.Microsecond))
	resp := f.start(src, replBody(t, carriedJSON(carriedItem(organic, custom)), credit))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	out := draftFlowObject(t, resp.body)
	if !reflect.DeepEqual(out["delivery"], map[string]any{"delivered": float64(1), "target": float64(1), "fulfilled": true}) {
		t.Fatalf("delivery = %v", out["delivery"])
	}
	if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyDeliveryFulfilled'`, out["id"]) != 1 {
		t.Fatal("VacancyDeliveryFulfilled")
	}
}

func TestReplacementCarryUsesTheMostRecentParticipationOfTheChain(t *testing.T) {
	f := newCarryFlow(t)
	root := f.published()
	f.closeIt(root, "finish")
	f.cover(root)
	first := f.published()
	f.link(first, root, root, 1)
	f.closeIt(first, "finish")
	fallen := f.credit(first, "did_not_hold")
	rs, fs := replStages(root), replStages(first)
	t0 := time.Now().UTC().Add(-96 * time.Hour).Truncate(time.Microsecond)
	t1 := t0.Add(48 * time.Hour)

	newer := f.manual("En las dos")
	pOld := f.participate(root, newer, rs["in_process"], t0)
	pNew := f.participate(first, newer, fs["screening"], t1)
	f.discard(pNew, fs["discarded"], fs["screening"])
	onlyRoot := f.organic("Solo en el original")
	pRoot := f.participate(root, onlyRoot, rs["screening"], t0)
	placedNow := f.manual("Contratada en el reemplazo")
	f.discard(f.participate(root, placedNow, rs["screening"], t0), rs["discarded"], rs["screening"])
	f.participate(first, placedNow, fs["placement"], t1)
	placedOlder := f.organic("Contratado en el original")
	f.participate(root, placedOlder, rs["placement"], t0)

	// Currently placed, in the latest or in an older process, is never carried.
	before := f.state()
	resp := f.start(first, replBody(t, carriedJSON(carriedItem(placedNow, fs["screening"]), carriedItem(newer, fs["screening"]), carriedItem(placedOlder, fs["screening"])), fallen))
	data := f.rejected(resp, 422, "carried_candidate_invalid")
	if got := carryProblems(data); !reflect.DeepEqual(got, []any{carryProblem(0, "currently_placed"), carryProblem(2, "currently_placed")}) {
		t.Fatalf("problems = %v", got)
	}
	f.unchanged(before)

	// The most recent participation is the template, wherever it lives in the chain.
	resp = f.start(first, replBody(t, carriedJSON(carriedItem(newer, fs["in_process"]), carriedItem(onlyRoot, fs["screening"])), fallen))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	out := draftFlowObject(t, resp.body)
	carried := out["carried"].([]any)
	if len(carried) != 2 || carried[0].(map[string]any)["carried_from_participation_id"] != pNew || carried[1].(map[string]any)["carried_from_participation_id"] != pRoot {
		t.Fatalf("carried = %v (templates %s %s, old %s)", carried, pNew, pRoot, pOld)
	}
	if out["replacement_of"] != first || out["root_process_id"] != root || out["sequence"] != float64(2) {
		t.Fatalf("chain = %v", out)
	}
	// A candidate carried before is the template of the next carry, and it is not placed.
	again := carried[0].(map[string]any)["participation_id"].(string)
	if f.count(`SELECT count(*) FROM process_participations WHERE id=$1 AND carried_from_participation_id=$2`, again, pNew) != 1 {
		t.Fatal("lineage")
	}
}

func TestReplacementCarryRejectionsCreateNothing(t *testing.T) {
	f := newCarryFlow(t)
	src, _ := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)
	m1, m2, o1, placed := f.manual("Uno Perez"), f.manual("Dos Perez"), f.organic("Tres Perez"), f.manual("Contratado Perez")
	f.participate(src, m1, s["screening"], at)
	f.discard(f.participate(src, m2, s["screening"], at), s["discarded"], s["screening"])
	f.participate(src, o1, s["new"], at)
	f.participate(src, placed, s["placement"], at)

	// Another company's candidate is not in the chain, and nothing says it exists.
	foreign, foreignOwner, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreignActor := f.h.actor(t, foreignOwner, foreignSub)
	foreignDraft := publicationFlowReady(t, f.h, foreignActor)
	publicFlowPublish(t, f.h, foreignDraft, foreignActor)
	outsider := f.person("manual", "De otra empresa", foreign.companyID, foreignOwner)
	foreignPID := f.participateAs(foreignDraft, outsider, replStages(foreignDraft)["screening"], at, foreignOwner)
	t.Cleanup(func() { // runs before the foreign company's own cleanup
		for _, q := range []string{`DELETE FROM participation_stage_history WHERE participation_id=$1`, `DELETE FROM process_participations WHERE id=$1`} {
			if _, err := f.h.pool.Exec(context.Background(), q, foreignPID); err != nil {
				t.Error(err)
			}
		}
		f.dropPeople([]carryPerson{outsider})
	})
	unknown := carryPerson{kind: "organic", id: uuid.New()}
	unknownManual := carryPerson{kind: "manual", id: uuid.New()}
	before := f.state()

	// Candidate problems, one reason per index, in request order; only the problems are listed.
	for name, tc := range map[string]struct {
		items []string
		want  []any
	}{
		"not in the chain": {[]string{carriedItem(unknown, s["screening"]), carriedItem(unknownManual, s["screening"]), carriedItem(outsider, s["screening"])},
			[]any{carryProblem(0, "not_in_chain"), carryProblem(1, "not_in_chain"), carryProblem(2, "not_in_chain")}},
		"currently placed": {[]string{carriedItem(placed, s["screening"])}, []any{carryProblem(0, "currently_placed")}},
		"duplicate":        {[]string{carriedItem(m1, s["screening"]), carriedItem(m1, s["new"])}, []any{carryProblem(1, "duplicate")}},
		"mixed, in order": {[]string{carriedItem(unknown, s["screening"]), carriedItem(m1, s["screening"]), carriedItem(placed, s["screening"]), carriedItem(m1, s["screening"]), carriedItem(m2, s["screening"])},
			[]any{carryProblem(0, "not_in_chain"), carryProblem(2, "currently_placed"), carryProblem(3, "duplicate")}},
		// A candidate problem outranks a stage problem anywhere in the list.
		"candidate before stage": {[]string{carriedItem(unknown, s["screening"]), carriedItem(m1, s["placement"])}, []any{carryProblem(0, "not_in_chain")}},
	} {
		data := f.rejected(f.start(src, replBody(t, carriedJSON(tc.items...), credit)), 422, "carried_candidate_invalid")
		if got := carryProblems(data); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s: problems = %v, want %v", name, got, tc.want)
		}
		f.unchanged(before)
	}
}

func TestReplacementCarryStageProblems(t *testing.T) {
	f := newCarryFlow(t)
	src, custom := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)
	a, b, c, d, e := f.manual("Ana A"), f.manual("Beto B"), f.organic("Carla C"), f.manual("Dani D"), f.manual("Eva E")
	for _, p := range []carryPerson{a, b, c, d, e} {
		f.participate(src, p, s["screening"], at)
	}
	before := f.state()
	stranger := pipelineconfig.Defaults(uuid.New()).Stages[1].ID

	data := f.rejected(f.start(src, replBody(t, carriedJSON(
		carriedItem(a, s["placement"]), carriedItem(b, s["discarded"]), carriedItem(c, uuid.NewString()), carriedItem(d, stranger), carriedItem(e, custom),
	), credit)), 422, "carried_stage_invalid")
	want := []any{carryProblem(0, "stage_is_placement"), carryProblem(1, "stage_is_exit"), carryProblem(2, "stage_not_found"), carryProblem(3, "stage_not_found")}
	if got := carryProblems(data); !reflect.DeepEqual(got, want) {
		t.Fatalf("problems = %v, want %v", got, want)
	}
	f.unchanged(before)

	// The server names stages by the SOURCE's ids (built-ins and custom alike) and answers with the
	// replacement's: the same request, corrected, succeeds and nothing was consumed.
	ok := f.start(src, replBody(t, carriedJSON(carriedItem(a, s["in_process"]), carriedItem(e, custom)), credit))
	if ok.status != 201 {
		t.Fatalf("corrected start: %d %s", ok.status, ok.body)
	}
	out := draftFlowObject(t, ok.body)
	carried := out["carried"].([]any)
	n := replStages(out["id"].(string))
	if len(carried) != 2 || carried[0].(map[string]any)["stage_id"] != n["in_process"] || carried[1].(map[string]any)["stage_id"] != custom {
		t.Fatalf("carried = %v", carried)
	}
}

// The carry checks run after the credits and before the responsible, as the contract orders them.
func TestReplacementCarryChecksRunInTheContractsOrder(t *testing.T) {
	f := newCarryFlow(t)
	src, _ := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	unknown := carryPerson{kind: "organic", id: uuid.New()}
	before := f.state()

	bad := carriedJSON(carriedItem(unknown, s["screening"]))
	if got := f.rejected(f.start(src, replBody(t, bad, uuid.NewString())), 422, "replacement_credits_invalid"); got == nil {
		t.Fatal("credits are checked before the carried candidates")
	}
	f.rejected(f.start(src, replBody(t, bad+`,"responsible":{"user_id":"`+uuid.NewString()+`"}`, credit)), 422, "carried_candidate_invalid")
	f.unchanged(before)
}

func TestReplacementCarryShapeAndLimit(t *testing.T) {
	f := newCarryFlow(t)
	src, _ := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	id, stage := uuid.NewString(), s["screening"]
	before := f.state()
	for name, items := range map[string]string{
		"not a list":      `,"carried_candidates":{}`,
		"item a string":   `,"carried_candidates":["x"]`,
		"unknown key":     `,"carried_candidates":[{"candidate":{"kind":"manual","id":"` + id + `"},"stage_id":"` + stage + `","x":1}]`,
		"no stage":        `,"carried_candidates":[{"candidate":{"kind":"manual","id":"` + id + `"}}]`,
		"kind not listed": `,"carried_candidates":[{"candidate":{"kind":"talent_pool","id":"` + id + `"},"stage_id":"` + stage + `"}]`,
		"id not a uuid":   `,"carried_candidates":[{"candidate":{"kind":"manual","id":"nope"},"stage_id":"` + stage + `"}]`,
		"stage not uuid":  `,"carried_candidates":[{"candidate":{"kind":"manual","id":"` + id + `"},"stage_id":"nope"}]`,
	} {
		if got := f.start(src, replBody(t, items, credit)); got.status != 400 || draftFlowObject(t, got.body)["code"] != "invalid_request" {
			t.Fatalf("%s: %d %s", name, got.status, got.body)
		}
	}
	many := make([]string, 201)
	for i := range many {
		many[i] = carriedItem(carryPerson{kind: "organic", id: uuid.New()}, stage)
	}
	got := f.start(src, replBody(t, carriedJSON(many...), credit))
	body := draftFlowObject(t, got.body)
	if got.status != 400 || body["code"] != "validation_error" || !reflect.DeepEqual(body["fields"], []any{map[string]any{"field": "carried_candidates", "code": "out_of_range"}}) {
		t.Fatalf("201 candidates: %d %s", got.status, got.body)
	}
	f.unchanged(before)
	// An empty list is still a start without candidates.
	if resp := f.start(src, replBody(t, `,"carried_candidates":[]`, credit)); resp.status != 201 || len(draftFlowObject(t, resp.body)["carried"].([]any)) != 0 {
		t.Fatalf("empty list: %d %s", resp.status, resp.body)
	}
}

// A stage-entry hook (psychometric auto-send) runs for every carried participation, inside the
// start transaction, as for a manual intake; a failing hook aborts the whole start.
type carryHook struct {
	t     *testing.T
	calls []string
	fail  bool
}

func (h *carryHook) OnStageEntered(ctx context.Context, tx pgx.Tx, process, participation, stage uuid.UUID, kind string) error {
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations WHERE id=$1 AND process_id=$2 AND stage_id=$3 AND carried_from_participation_id IS NOT NULL AND discarded_at IS NULL)`, participation, process, stage).Scan(&ok); err != nil || !ok {
		h.t.Errorf("the participation must exist, carried, at the stage, when the hook runs: %v %v", ok, err)
	}
	h.calls = append(h.calls, kind+":"+stage.String())
	if h.fail {
		return errors.New("injected hook failure")
	}
	return nil
}

func TestReplacementCarryRunsTheStageEntryHook(t *testing.T) {
	f := newCarryFlow(t)
	src, custom := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	c1, c2 := f.credit(src, "did_not_hold"), f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)
	a, b := f.manual("Hook Ana"), f.organic("Hook Beto")
	f.participate(src, a, s["screening"], at)
	f.participate(src, b, s["new"], at)
	body := replBody(t, carriedJSON(carriedItem(a, custom), carriedItem(b, s["in_process"])), c1, c2)
	before := f.state()

	hook := &carryHook{t: t, fail: true}
	f.h.store.WithStageEntryHook(hook)
	if got := f.start(src, body); got.status != 500 {
		t.Fatalf("a failing hook: %d %s", got.status, got.body)
	}
	f.unchanged(before)

	hook.fail, hook.calls = false, nil
	resp := f.start(src, body)
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	id := draftFlowObject(t, resp.body)["id"].(string)
	if want := []string{"intake:" + custom, "intake:" + replStages(id)["in_process"]}; !reflect.DeepEqual(hook.calls, want) {
		t.Fatalf("hook calls = %v, want %v", hook.calls, want)
	}
}

// departedChain is root -> first (a finished replacement) with the people of S11: who left
// Placement because they left (candidate_left), who left it by mistake (moved_by_mistake), and
// the shapes in between. `first` is the source a new start runs from.
type departedChain struct {
	root, first, credit string
	// departedRoot left in the original, departedFirst in the replacement, departedOrganic is
	// an organic account that left, cameBack left in the original and has a newer, unplaced
	// participation in the replacement, byMistake and corrected left by mistake / were corrected.
	departedRoot, departedFirst, departedOrganic, cameBack, byMistake, corrected carryPerson
	placedAgain                                                                  carryPerson
	cameBackNow                                                                  string
}

func (f *carryFlow) departedChain() departedChain {
	f.t.Helper()
	root := f.published()
	first := f.published()
	f.link(first, root, root, 1)
	f.closeIt(root, "finish")
	f.cover(root)
	f.closeIt(first, "finish")
	fs := replStages(first)
	t0 := time.Now().UTC().Add(-96 * time.Hour).Truncate(time.Microsecond)
	at := func(h int) time.Time { return t0.Add(time.Duration(h) * time.Hour) }
	c := departedChain{root: root, first: first, credit: f.credit(first, "did_not_hold")}
	c.departedRoot, c.departedFirst, c.departedOrganic = f.manual("Se fue en el original"), f.manual("Se fue en el reemplazo"), f.organic("Se fue organico")
	c.cameBack, c.byMistake, c.corrected, c.placedAgain = f.manual("Volvio"), f.manual("Por error"), f.manual("Corregida"), f.manual("Contratada otra vez")
	f.hire(root, c.departedRoot, at(0), "did_not_hold")
	f.hire(first, c.departedFirst, at(1), "did_not_hold")
	f.hire(root, c.departedOrganic, at(2), "did_not_hold")
	// Left in the original; the newest participation is a plain, unplaced one in the replacement.
	f.hire(root, c.cameBack, at(3), "did_not_hold")
	c.cameBackNow = f.participate(first, c.cameBack, fs["screening"], at(30))
	// moved_by_mistake voids the credit: not a departed hire.
	f.hire(root, c.byMistake, at(4), "voided")
	// The owner corrected a candidate_left credit to voided: the exit reason is still candidate_left.
	_, part := f.hire(root, c.corrected, at(5), "did_not_hold")
	f.exec(`UPDATE placement_credits SET status='voided' WHERE participation_id=$1`, part)
	// Left, then hired again in the replacement: placed now (and departed before).
	f.hire(root, c.placedAgain, at(6), "did_not_hold")
	f.hire(first, c.placedAgain, at(31), "active")
	return c
}

func TestReplacementCarryRejectsDepartedHires(t *testing.T) {
	f := newCarryFlow(t)
	c := f.departedChain()
	fs := replStages(c.first)
	clean := f.manual("Sin contratar")
	f.participate(c.first, clean, fs["screening"], time.Now().UTC().Add(-48*time.Hour).Truncate(time.Microsecond))
	unknown := carryPerson{kind: "organic", id: uuid.New()}
	before := f.state()

	for name, tc := range map[string]struct {
		items []string
		want  []any
	}{
		"left in the original":    {[]string{carriedItem(c.departedRoot, fs["screening"])}, []any{carryProblem(0, "departed_hire")}},
		"left in the replacement": {[]string{carriedItem(c.departedFirst, fs["screening"])}, []any{carryProblem(0, "departed_hire")}},
		"organic":                 {[]string{carriedItem(c.departedOrganic, fs["screening"])}, []any{carryProblem(0, "departed_hire")}},
		// Any participation of the chain counts, not only the most recent one.
		"came back as a plain participation":       {[]string{carriedItem(c.cameBack, fs["screening"])}, []any{carryProblem(0, "departed_hire")}},
		"a corrected credit keeps its exit reason": {[]string{carriedItem(c.corrected, fs["screening"])}, []any{carryProblem(0, "departed_hire")}},
		// Only the departed ones are listed; the ones that can be carried are not.
		"mixed with carriable ones": {[]string{carriedItem(clean, fs["screening"]), carriedItem(c.departedRoot, fs["screening"]), carriedItem(c.byMistake, fs["screening"]), carriedItem(c.departedFirst, fs["new"])},
			[]any{carryProblem(1, "departed_hire"), carryProblem(3, "departed_hire")}},
		// Same precedence as the other candidate reasons: duplicate (from the second occurrence), not_in_chain
		// and currently_placed are decided first; the first occurrence is judged on its own merits.
		"precedence": {[]string{carriedItem(unknown, fs["screening"]), carriedItem(c.departedRoot, fs["screening"]), carriedItem(c.placedAgain, fs["screening"]), carriedItem(c.departedRoot, fs["new"])},
			[]any{carryProblem(0, "not_in_chain"), carryProblem(1, "departed_hire"), carryProblem(2, "currently_placed"), carryProblem(3, "duplicate")}},
		// A candidate problem (departed included) outranks a stage problem anywhere in the list.
		"candidate before stage": {[]string{carriedItem(clean, fs["placement"]), carriedItem(c.departedRoot, fs["screening"])}, []any{carryProblem(1, "departed_hire")}},
	} {
		data := f.rejected(f.start(c.first, replBody(t, carriedJSON(tc.items...), c.credit)), 422, "carried_candidate_invalid")
		if got := carryProblems(data); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s: problems = %v, want %v", name, got, tc.want)
		}
		f.unchanged(before)
	}
}

func TestReplacementCarryStillCarriesAMovedByMistakeDeparture(t *testing.T) {
	f := newCarryFlow(t)
	c := f.departedChain()
	fs := replStages(c.first)
	resp := f.start(c.first, replBody(t, carriedJSON(carriedItem(c.byMistake, fs["screening"])), c.credit))
	if resp.status != 201 {
		t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	carried := draftFlowObject(t, resp.body)["carried"].([]any)
	if len(carried) != 1 || carried[0].(map[string]any)["candidate"].(map[string]any)["id"] != c.byMistake.id.String() {
		t.Fatalf("carried = %v", carried)
	}
}
