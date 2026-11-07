//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Synthetic metric facts (stakeholder-metrics-v1 §2), seeded with SQL so every
// formula and edge case gets exact instants; every read goes through the
// production router.

func mxAt(value string) time.Time {
	at, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return at
}

func mxPtr[T any](v T) *T { return &v }

type mxFixture struct {
	t       *testing.T
	h       *draftFlowHarness
	company *draftFlowCompany
	ownerID uuid.UUID
	owner   draftFlowActor
	drafts  []uuid.UUID
	people  []uuid.UUID // candidate users
	version map[uuid.UUID]int
}

func newMXFixture(t *testing.T, h *draftFlowHarness) *mxFixture {
	t.Helper()
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	f := &mxFixture{t: t, h: h, company: company, ownerID: ownerID, owner: h.actor(t, ownerID, sub), version: map[uuid.UUID]int{}}
	f.name(ownerID, "Olga Owner")
	// Registered after the company: runs first and removes what its cleanup
	// cannot cascade (participations and fulfillments reference processes).
	t.Cleanup(f.cleanup)
	return f
}

func (f *mxFixture) exec(query string, args ...any) {
	f.t.Helper()
	if _, err := f.h.pool.Exec(context.Background(), query, args...); err != nil {
		f.t.Fatalf("%v\n%s", err, query)
	}
}

func (f *mxFixture) cleanup() {
	ctx := context.Background()
	for _, q := range []string{
		`DELETE FROM placement_credits WHERE process_id=ANY($1)`,
		`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=ANY($1))`,
		`DELETE FROM process_participations WHERE process_id=ANY($1)`,
		`DELETE FROM process_delivery_fulfillments WHERE process_id=ANY($1)`,
	} {
		if _, err := f.h.pool.Exec(ctx, q, f.drafts); err != nil {
			f.t.Errorf("metrics fixture cleanup: %v", err)
		}
	}
	for _, q := range []string{`DELETE FROM company_candidate_corrections WHERE user_id=ANY($1)`, `DELETE FROM candidate_cv_versions WHERE candidate_id=ANY($1)`, `DELETE FROM users WHERE id=ANY($1)`} {
		if _, err := f.h.pool.Exec(ctx, q, f.people); err != nil {
			f.t.Errorf("metrics fixture cleanup: %v", err)
		}
	}
}

func (f *mxFixture) name(user uuid.UUID, name string) {
	f.exec(`UPDATE users SET full_name=$2 WHERE id=$1`, user, name)
}

// member adds a named member of the given role.
func (f *mxFixture) member(role, name string) (uuid.UUID, draftFlowActor) {
	id, sub := f.company.addUser(f.t, role)
	f.name(id, name)
	return id, f.h.actor(f.t, id, sub)
}

// formerMember is a user whose membership was removed: history keeps them.
func (f *mxFixture) formerMember(name string) uuid.UUID {
	id, _ := f.member("recruiter", name)
	f.exec(`DELETE FROM company_members WHERE user_id=$1`, id)
	return id
}

func (f *mxFixture) requester(kind, name string) uuid.UUID {
	id := uuid.New()
	f.exec(`INSERT INTO job_draft_requesters(id,company_id,kind,name,name_key) VALUES($1,$2,$3,$4,$5)`, id, f.company.companyID, kind, name, strings.ToLower(name)+id.String())
	return id
}

// draft inserts a vacancy draft with its team row; published is nil for a
// draft never published. kind/id set the requester columns.
func (f *mxFixture) draft(title string, published *time.Time, kind *string, requester *uuid.UUID, mode string) uuid.UUID {
	id := uuid.New()
	f.drafts = append(f.drafts, id)
	fields, _ := json.Marshal(map[string]any{"fields": map[string]any{"title": title}})
	f.exec(`INSERT INTO job_drafts(id,company_id,created_by,fields,requester_kind,requester_id) VALUES($1,$2,$3,$4,$5,$6)`, id, f.company.companyID, f.ownerID, fields, kind, requester)
	f.exec(`INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) VALUES($1,$2,$3,now())`, id, f.company.companyID, mode)
	if published != nil {
		f.exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',$3,$4)`, id, f.company.companyID, *published, f.ownerID)
	}
	return id
}

// tramo opens one stay; end nil keeps it open.
func (f *mxFixture) tramo(draft, user uuid.UUID, start time.Time, end *time.Time) uuid.UUID {
	id := uuid.New()
	var cause *string
	if end != nil {
		cause = mxPtr("removed")
	}
	f.exec(`INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,$4,$5,'added',$6,$7)`, id, draft, f.company.companyID, user, start, end, cause)
	return id
}

// function records one function period of a tramo.
func (f *mxFixture) function(assignment, draft uuid.UUID, function string, start time.Time, end *time.Time) {
	var cause *string
	if end != nil {
		cause = mxPtr("tramo_ended")
	}
	f.exec(`INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,$4,$5,'added',$6,$7)`, uuid.New(), assignment, draft, function, start, end, cause)
}

// stay is a tramo holding one function for its whole length.
func (f *mxFixture) stay(draft, user uuid.UUID, function string, start time.Time, end *time.Time) uuid.UUID {
	a := f.tramo(draft, user, start, end)
	f.function(a, draft, function, start, end)
	return a
}

// lifecycle appends a lifecycle event; reason only for close (nil = legacy).
func (f *mxFixture) lifecycle(draft uuid.UUID, action string, at time.Time, reason *string) {
	if f.version[draft] == 0 {
		f.version[draft] = 1
	}
	f.version[draft]++
	var process, note *string
	if action == "close" {
		process = mxPtr("continue")
		if reason != nil && *reason == "other" {
			note = mxPtr("motivo")
		}
	}
	f.exec(`INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,process,actor_id,actor_name,created_at,reason,reason_note) VALUES($1,$2,$3,$4,$5,$6,'Olga',$7,$8,$9)`,
		uuid.New(), draft, f.version[draft], action, process, f.ownerID, at, reason, note)
}

func (f *mxFixture) delivery(draft, cutoff uuid.UUID, target int, commitment string) {
	f.exec(`INSERT INTO job_draft_delivery_configs(draft_id,version,cutoff_stage_id,target_quantity,commitment_date) VALUES($1,1,$2,$3,$4)`, draft, cutoff, target, commitment)
}

// fulfill freezes the fulfillment row; fulfilledAt is deliberately not the
// N-th reached_at (the save-time defect, D8).
func (f *mxFixture) fulfill(draft, cutoff uuid.UUID, commitment string, fulfilledAt time.Time, reached ...time.Time) {
	candidates := []map[string]any{}
	for _, at := range reached {
		candidates = append(candidates, map[string]any{"participation_id": uuid.New(), "candidate": map[string]any{"id": uuid.New(), "full_name": "frozen"}, "reached_at": at})
	}
	raw, _ := json.Marshal(candidates)
	f.exec(`INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates) VALUES($1,$2,'late',0,$3,$3,$4,'Corte',$5,$6)`,
		draft, fulfilledAt, len(reached), cutoff, commitment, raw)
}

func (f *mxFixture) renegotiate(draft uuid.UUID, previous *string, next string, at time.Time) {
	f.exec(`INSERT INTO vacancy_commitment_changes(id,draft_id,company_id,previous_date,new_date,reason,performed_by,performed_at) VALUES($1,$2,$3,$4,$5,'client_request',$6,$7)`, uuid.New(), draft, f.company.companyID, previous, next, f.ownerID, at)
}

func (f *mxFixture) management(draft uuid.UUID, headcount *int, target *string) {
	f.exec(`INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount,target_close_date) VALUES($1,1,$2,$3)`, draft, headcount, target)
}

func (f *mxFixture) closeTarget(draft uuid.UUID, previous, next *string, at time.Time) {
	f.exec(`INSERT INTO vacancy_close_target_changes(id,draft_id,company_id,previous_date,new_date,performed_by,performed_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, uuid.New(), draft, f.company.companyID, previous, next, f.ownerID, at)
}

// apply creates an organic participation with an explicit channel, applying
// into stage at the given instant (actor: the candidate).
func (f *mxFixture) apply(draft, stage uuid.UUID, name, channel string, at time.Time) uuid.UUID {
	candidate, cv, pid := uuid.New(), uuid.New(), uuid.New()
	f.people = append(f.people, candidate)
	f.exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,$4,'candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test", name)
	f.exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	f.exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,origin_channel,created_at) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6,$7)`, pid, draft, candidate, stage, cv, channel, at)
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at) VALUES($1,$2,$3,$4,$5)`, uuid.New(), pid, stage, candidate, at)
	return pid
}

// correct sets the company's correction of a candidate's name.
func (f *mxFixture) correct(participation uuid.UUID, name string) {
	f.exec(`INSERT INTO company_candidate_corrections(company_id,user_id,corrections) SELECT $1,candidate_id,jsonb_build_object('full_name',$3::text) FROM process_participations WHERE id=$2`, f.company.companyID, participation, name)
}

// move is a recruiter move between stages.
func (f *mxFixture) move(participation, from, to, actor uuid.UUID, at time.Time) {
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,event_kind,from_stage_id,actor_kind) VALUES($1,$2,$3,$4,$5,'move',$6,'recruiter')`, uuid.New(), participation, to, actor, at, from)
	f.exec(`UPDATE process_participations SET stage_id=$2 WHERE id=$1`, participation, to)
}

type mxRecipient struct {
	user, assignment uuid.UUID
	kind             string
}

func (f *mxFixture) credit(draft, participation uuid.UUID, hired time.Time, status string, recipients ...mxRecipient) uuid.UUID {
	id := uuid.New()
	f.exec(`INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status) VALUES($1,$2,$3,$4,$5,$6,$7,'with_responsible',$8)`, id, f.company.companyID, draft, participation, uuid.New(), hired, f.ownerID, status)
	for _, r := range recipients {
		f.exec(`INSERT INTO placement_credit_recipients(credit_id,user_id,assignment_id,kind) VALUES($1,$2,$3,$4)`, id, r.user, r.assignment, r.kind)
	}
	return id
}

const mxSnapshot = `{"captured_at":"2025-02-10T18:00:00Z","lifecycle":{"publication":"published","process":"active"},
 "stage_counts":[{"stage_id":"s","stage_name":"Corte","kind":"custom","active":2,"discarded":0}],
 "tramo":{"started_at":"2025-01-06T16:00:00Z","effective_deadline":null,"deadline_source":"none","business_days_elapsed":24,"business_days_total":null},
 "delivery":{"target":2,"delivered":2,"fulfilled_at":null,"result":null,"commitment_date":"2025-01-20"},
 "placements":{"current":0,"credited":0}}`

func (f *mxFixture) reassign(draft, from, to uuid.UUID, reason string, note *string, at time.Time) {
	f.exec(`INSERT INTO vacancy_reassignments(id,draft_id,company_id,from_assignment_id,to_assignment_id,reason,note,previous_responsible,performed_by,performed_at,state_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,'remove',$8,$9,$10)`,
		uuid.New(), draft, f.company.companyID, from, to, reason, note, f.ownerID, at, mxSnapshot)
}

// get reads a metrics route and decodes the 200 body.
func (f *mxFixture) get(actor draftFlowActor, path string) map[string]any {
	f.t.Helper()
	r := f.h.do(f.t, "GET", "/v2/me/company/metrics/"+path, "", actor.token, nil)
	if r.status != 200 {
		f.t.Fatalf("GET %s: %d %s", path, r.status, r.body)
	}
	draftFlowAssertNoStore(f.t, r)
	return draftFlowObject(f.t, r.body)
}

func (f *mxFixture) auditCount(event string) int {
	var n int
	if err := f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE company_id=$1 AND ($2='' OR event_type=$2)`, f.company.companyID, event).Scan(&n); err != nil {
		f.t.Fatal(err)
	}
	return n
}

// mxJSON round-trips a Go literal through JSON for editJSONEqual.
func mxJSON(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func mxRate(value any, numerator, denominator int) map[string]any {
	return map[string]any{"value": value, "numerator": numerator, "denominator": denominator}
}

func mxPerson(id uuid.UUID, name any, former bool) map[string]any {
	return map[string]any{"user_id": id.String(), "name": name, "former_member": former}
}

func mxPeriod(from, to string) map[string]any {
	return map[string]any{"from": from, "to": to, "time_zone": "America/Mexico_City"}
}

var _ = fmt.Sprintf
