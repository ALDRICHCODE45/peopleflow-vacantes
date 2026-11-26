//go:build integration

// Notifications candidate API (notifications-v1 N6, D18: B = /v2/me/notifications behind
// NoStore, requireAuth, requireCandidate) through the production router, the real auth
// middleware and the real candidate gate. Same disposable draft_test_mig_* database
// harness as notifications_read_integration_test.go (DRAFT_TEST_DATABASE_URL only).
package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

const notifCandidatePath = "/v2/me/notifications"

// notifFuture is a read-all `before` after every fixture timestamp (the fixtures sit on
// notifT0, which can be later than the wall clock).
const notifFuture = "2027-01-01T00:00:00Z"

// publish writes the public projection of a job (the title candidates see in
// /v2/me/applications).
func (w *notifWorld) publish(t *testing.T, job, company uuid.UUID, title string) {
	t.Helper()
	w.exec(t, `INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version,skills,screening_questions,requirements_profile)
		VALUES($1,$2,$3,'d','remote','full_time','indefinite','technology_systems','{}',now(),1,ARRAY[]::text[],0,'{"languages":[],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}')`, job, company, title)
}

func (w *notifWorld) candidateMark(t *testing.T, u notifUser, op, body string) notifMark {
	t.Helper()
	r := w.post(t, u, notifCandidatePath+"/"+op, body)
	if r.status != http.StatusOK || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("POST candidate %s %s = %d cache=%q body=%s", op, body, r.status, r.header.Get("Cache-Control"), r.body)
	}
	var m notifMark
	dec := json.NewDecoder(strings.NewReader(string(r.body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
	return m
}

// candidateWorld adds the candidate's own participations on job A (public title differs
// from the draft title) and job B, and a second company's job with its projection.
type candidateWorld struct {
	*notifWorld
	partA, partB, partOther uuid.UUID
}

func newCandidateWorld(t *testing.T) *candidateWorld {
	t.Helper()
	w := &candidateWorld{notifWorld: newNotifWorld(t)}
	w.exec(t, `UPDATE companies SET name='Otra Empresa' WHERE id=$1`, w.other)
	w.publish(t, w.jobA, w.company, "Analista de nómina Sr.")
	w.publish(t, w.jobB, w.company, "Ejecutivo de ventas")
	w.publish(t, w.otherJob, w.other, "Puesto ajeno")
	w.partA = w.participation(t, w.jobA, w.candidate.id)
	w.partB = w.participation(t, w.jobB, w.candidate.id)
	w.partOther = w.participation(t, w.otherJob, w.candidate.id)
	return w
}

func TestNotificationsCandidate_ListShapesAndUnreadCount(t *testing.T) {
	w := newCandidateWorld(t)
	invitation := uuid.NewString()
	status := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.partA),
		payload: `{"status":"in_process"}`, at: ts(0)})
	// An actor stored on a candidate row is never exposed (actor: null on candidate items).
	message := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_message_received", job: w.jobB, part: ptr(w.partB),
		actor: ptr(w.recruiter.id), payload: `{"status":"closed"}`, at: ts(-time.Hour), read: true})
	test := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_test_pending", job: w.otherJob, part: ptr(w.partOther),
		payload: `{"invitation_id":"` + invitation + `"}`, at: ts(-2 * time.Hour)})
	gone := uuid.New()
	goneRow := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: gone, payload: `{"status":"closed"}`, at: ts(-3 * time.Hour)})
	// Never visible on the candidate routes: the candidate's own member row, another
	// candidate's row and a member's row.
	w.notify(t, notifRow{recipient: w.candidate.id, typ: "vacancy_assigned", job: w.jobA, at: ts(time.Hour)})
	w.notify(t, notifRow{recipient: w.candidates[0].id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.parts[0]), payload: `{"status":"closed"}`, at: ts(time.Hour)})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", job: w.jobA, part: ptr(w.partA), at: ts(time.Hour)})

	r := w.get(t, w.candidate, notifCandidatePath)
	if r.status != http.StatusOK || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("status=%d cache=%q body=%s", r.status, r.header.Get("Cache-Control"), r.body)
	}
	t.Logf("GET %s → %s", notifCandidatePath, r.body)
	jobA, jobB, otherJob := w.jobA.String(), w.jobB.String(), w.otherJob.String()
	company, other := w.company.String(), w.other.String()
	notifJSONEqual(t, r.body, `{
  "attention": [],
  "attention_total": 0,
  "items": [
    {
      "group_key": "n:`+status.String()+`", "type": "candidate_status_changed", "kind": "operational", "urgency": "normal",
      "count": 1, "unread_count": 1, "read": false, "resolved": false,
      "latest_at": "2026-11-26T15:00:00Z", "first_at": "2026-11-26T15:00:00Z",
      "job": {"id": "`+jobA+`", "title": "Analista de nómina Sr."},
      "company": {"id": "`+company+`", "name": "Notif Read"},
      "latest": {"id": "`+status.String()+`", "created_at": "2026-11-26T15:00:00Z", "actor": null, "payload": {"status": "in_process"}},
      "sample": [],
      "link": {"kind": "application", "job_id": "`+jobA+`", "participation_id": "`+w.partA.String()+`"}
    },
    {
      "group_key": "n:`+message.String()+`", "type": "candidate_message_received", "kind": "operational", "urgency": "normal",
      "count": 1, "unread_count": 0, "read": true, "resolved": false,
      "latest_at": "2026-11-26T14:00:00Z", "first_at": "2026-11-26T14:00:00Z",
      "job": {"id": "`+jobB+`", "title": "Ejecutivo de ventas"},
      "company": {"id": "`+company+`", "name": "Notif Read"},
      "latest": {"id": "`+message.String()+`", "created_at": "2026-11-26T14:00:00Z", "actor": null, "payload": {"status": "closed"}},
      "sample": [],
      "link": {"kind": "application", "job_id": "`+jobB+`", "participation_id": "`+w.partB.String()+`"}
    },
    {
      "group_key": "n:`+test.String()+`", "type": "candidate_test_pending", "kind": "operational", "urgency": "normal",
      "count": 1, "unread_count": 1, "read": false, "resolved": false,
      "latest_at": "2026-11-26T13:00:00Z", "first_at": "2026-11-26T13:00:00Z",
      "job": {"id": "`+otherJob+`", "title": "Puesto ajeno"},
      "company": {"id": "`+other+`", "name": "Otra Empresa"},
      "latest": {"id": "`+test.String()+`", "created_at": "2026-11-26T13:00:00Z", "actor": null, "payload": {"invitation_id": "`+invitation+`"}},
      "sample": [],
      "link": {"kind": "assessment", "invitation_id": "`+invitation+`"}
    },
    {
      "group_key": "n:`+goneRow.String()+`", "type": "candidate_status_changed", "kind": "operational", "urgency": "normal",
      "count": 1, "unread_count": 1, "read": false, "resolved": false,
      "latest_at": "2026-11-26T12:00:00Z", "first_at": "2026-11-26T12:00:00Z",
      "job": {"id": "`+gone.String()+`", "title": null},
      "company": null,
      "latest": {"id": "`+goneRow.String()+`", "created_at": "2026-11-26T12:00:00Z", "actor": null, "payload": {"status": "closed"}},
      "sample": [],
      "link": null
    }
  ],
  "next_cursor": null,
  "unread_count": 3,
  "unread_notifications": 3
}`)

	c := w.get(t, w.candidate, notifCandidatePath+"/unread-count")
	if c.status != http.StatusOK || !strings.Contains(c.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("unread-count status=%d body=%s", c.status, c.body)
	}
	notifJSONEqual(t, c.body, `{"unread_count": 3, "unread_notifications": 3}`)

	// Filters, pagination and cursor errors behave as on the member tree.
	p := w.get(t, w.candidate, notifCandidatePath+"?state=unread&types=candidate_status_changed,candidate_test_pending&job_ids="+jobA+","+otherJob+"&limit=1")
	var page notifPage
	if err := json.Unmarshal(p.body, &page); err != nil || p.status != http.StatusOK {
		t.Fatalf("filtered: %d %s", p.status, p.body)
	}
	if got := notifKeys(page.Items); len(got) != 1 || got[0] != "n:"+status.String() || page.NextCursor == nil {
		t.Fatalf("filtered page 1 = %v next=%v", got, page.NextCursor)
	}
	p = w.get(t, w.candidate, notifCandidatePath+"?state=unread&types=candidate_status_changed,candidate_test_pending&job_ids="+jobA+","+otherJob+"&limit=1&cursor="+*page.NextCursor)
	page = notifPage{}
	if err := json.Unmarshal(p.body, &page); err != nil || p.status != http.StatusOK {
		t.Fatalf("filtered page 2: %d %s", p.status, p.body)
	}
	if got := notifKeys(page.Items); len(got) != 1 || got[0] != "n:"+test.String() || page.NextCursor != nil || page.Attention != nil || page.AttentionTotal != nil {
		t.Fatalf("filtered page 2 = %v next=%v attention=%v", got, page.NextCursor, page.Attention)
	}
	// A candidate asking for a member type gets an empty result, not an error.
	notifJSONEqual(t, w.get(t, w.candidate, notifCandidatePath+"?types=vacancy_assigned").body,
		`{"attention": [], "attention_total": 0, "items": [], "next_cursor": null, "unread_count": 3, "unread_notifications": 3}`)
	if r := w.get(t, w.candidate, notifCandidatePath+"?state=bogus"); r.status != http.StatusBadRequest || !strings.Contains(string(r.body), `"invalid_filter"`) {
		t.Fatalf("invalid filter: %d %s", r.status, r.body)
	}
	if r := w.get(t, w.candidate, notifCandidatePath+"?cursor=nope"); r.status != http.StatusBadRequest || !strings.Contains(string(r.body), `"invalid_cursor"`) {
		t.Fatalf("invalid cursor: %d %s", r.status, r.body)
	}
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}

func TestNotificationsCandidate_MarksUndoReadAllAndFacets(t *testing.T) {
	w := newCandidateWorld(t)
	a1 := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.partA), payload: `{"status":"in_process"}`, at: ts(0)})
	a2 := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_test_pending", job: w.jobA, part: ptr(w.partA), payload: `{"invitation_id":"` + uuid.NewString() + `"}`, at: ts(time.Minute)})
	b1 := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_message_received", job: w.jobB, part: ptr(w.partB), payload: `{"status":"closed"}`, at: ts(2 * time.Minute)})
	o1 := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: w.otherJob, part: ptr(w.partOther), payload: `{"status":"closed"}`, at: ts(3 * time.Minute), read: true})
	// Foreign rows: the candidate's own member row, another candidate's row, a member's row.
	ownMember := w.notify(t, notifRow{recipient: w.candidate.id, typ: "vacancy_assigned", job: w.jobA, at: ts(0)})
	otherCandidate := w.notify(t, notifRow{recipient: w.candidates[0].id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.parts[0]), payload: `{"status":"closed"}`, at: ts(0)})
	member := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobA, at: ts(0)})
	foreign := `"` + ownMember.String() + `","` + otherCandidate.String() + `","` + member.String() + `"`
	foreignKeys := `"n:` + ownMember.String() + `","n:` + otherCandidate.String() + `","n:` + member.String() + `"`

	// Foreign ids and keys are silently not affected (D26).
	wantMark(t, w.candidateMark(t, w.candidate, "read", `{"ids":[`+foreign+`]}`), 0, 0, 3, 3)
	wantMark(t, w.candidateMark(t, w.candidate, "read", `{"group_keys":[`+foreignKeys+`]}`), 0, 0, 3, 3)
	wantMark(t, w.candidateMark(t, w.candidate, "unread", `{"ids":[`+foreign+`]}`), 0, 0, 3, 3)

	// Read by keys, then undo exactly that batch.
	first := w.candidateMark(t, w.candidate, "read", `{"group_keys":["n:`+a1.String()+`","n:`+a2.String()+`"]}`)
	wantMark(t, first, 2, 2, 1, 1)
	wantMark(t, w.candidateMark(t, w.candidate, "read", `{"ids":["`+b1.String()+`"]}`), 1, 1, 0, 0)
	wantMark(t, w.candidateMark(t, w.candidate, "unread", `{"marked_at":"`+first.MarkedAt+`"}`), 2, 2, 2, 2)
	wantRead(t, "after undo", w.readAt(t, a1, a2, b1, o1), false, false, true, true)
	wantMark(t, w.candidateMark(t, w.candidate, "unread", `{"ids":["`+o1.String()+`"]}`), 1, 1, 3, 3)

	// Facets: per type and per job with the candidate's public title, per state, filters ignored.
	f := w.get(t, w.candidate, notifCandidatePath+"/facets?types=candidate_test_pending")
	if f.status != http.StatusOK || !strings.Contains(f.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("facets: %d %s", f.status, f.body)
	}
	t.Logf("GET %s/facets → %s", notifCandidatePath, f.body)
	notifJSONEqual(t, f.body, `{
  "state": "unread",
  "types": [{"type": "candidate_status_changed", "count": 2}, {"type": "candidate_test_pending", "count": 1}],
  "jobs": [
    {"job_id": "`+w.jobA.String()+`", "title": "Analista de nómina Sr.", "count": 2},
    {"job_id": "`+w.otherJob.String()+`", "title": "Puesto ajeno", "count": 1}
  ],
  "jobs_total": 2
}`)
	notifJSONEqual(t, w.get(t, w.candidate, notifCandidatePath+"/facets?state=all").body, `{
  "state": "all",
  "types": [{"type": "candidate_status_changed", "count": 2}, {"type": "candidate_message_received", "count": 1}, {"type": "candidate_test_pending", "count": 1}],
  "jobs": [
    {"job_id": "`+w.jobA.String()+`", "title": "Analista de nómina Sr.", "count": 2},
    {"job_id": "`+w.jobB.String()+`", "title": "Ejecutivo de ventas", "count": 1},
    {"job_id": "`+w.otherJob.String()+`", "title": "Puesto ajeno", "count": 1}
  ],
  "jobs_total": 3
}`)

	// read-all with filters, then everything; undo the last batch.
	wantMark(t, w.candidateMark(t, w.candidate, "read-all", `{"job_ids":["`+w.jobA.String()+`"],"types":["candidate_status_changed"],"before":"`+notifFuture+`"}`), 1, 1, 2, 2)
	all := w.candidateMark(t, w.candidate, "read-all", `{"before":"`+notifFuture+`"}`)
	wantMark(t, all, 2, 2, 0, 0)
	wantRead(t, "read-all", w.readAt(t, a1, a2, b1, o1), true, true, true, true)
	wantMark(t, w.candidateMark(t, w.candidate, "unread", `{"marked_at":"`+all.MarkedAt+`"}`), 2, 2, 2, 2)
	wantRead(t, "read-all undo", w.readAt(t, a1, a2, b1, o1), true, false, true, false)

	// Validation is the same as on the member tree.
	if r := w.post(t, w.candidate, notifCandidatePath+"/read", `{}`); r.status != http.StatusBadRequest || !strings.Contains(string(r.body), `"validation_error"`) {
		t.Fatalf("empty body: %d %s", r.status, r.body)
	}
	if r := w.post(t, w.candidate, notifCandidatePath+"/read", `{"bogus":1}`); r.status != http.StatusBadRequest || !strings.Contains(string(r.body), `"invalid_request"`) {
		t.Fatalf("unknown field: %d %s", r.status, r.body)
	}

	// Nothing foreign was ever touched, and nothing was audited (D23).
	wantRead(t, "foreign untouched", w.readAt(t, ownMember, otherCandidate, member), false, false, false)
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}

func TestNotificationsCandidate_ScopeIsolation(t *testing.T) {
	w := newCandidateWorld(t)
	mine := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.partA), payload: `{"status":"in_process"}`, at: ts(0)})
	ownMember := w.notify(t, notifRow{recipient: w.candidate.id, typ: "vacancy_assigned", job: w.jobA, at: ts(time.Minute)})
	// The recruiter holds a candidate-kind row (data the member tree must never show).
	recruiterCandidate := w.notify(t, notifRow{recipient: w.recruiter.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, payload: `{"status":"closed"}`, at: ts(0)})
	recruiterMember := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobA, at: ts(0)})

	type route struct{ method, path, body string }
	routesFor := func(base string) []route {
		return []route{
			{http.MethodGet, base, ``},
			{http.MethodGet, base + "/unread-count", ``},
			{http.MethodPost, base + "/read", `{"ids":["` + mine.String() + `"]}`},
			{http.MethodPost, base + "/unread", `{"ids":["` + mine.String() + `"]}`},
			{http.MethodPost, base + "/read-all", `{}`},
			{http.MethodGet, base + "/facets", ``},
		}
	}
	call := func(u notifUser, rt route) notifResponse {
		if rt.method == http.MethodGet {
			return w.get(t, u, rt.path)
		}
		return w.post(t, u, rt.path, rt.body)
	}
	for _, rt := range routesFor(notifCandidatePath) {
		if r := call(notifUser{}, rt); r.status != http.StatusUnauthorized || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
			t.Fatalf("%s %s anonymous: %d %q", rt.method, rt.path, r.status, r.header.Get("Cache-Control"))
		}
		// A company member on the candidate tree gets the candidate gate's error.
		if r := call(w.recruiter, rt); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"wrong_role"`) {
			t.Fatalf("%s %s member: %d %s", rt.method, rt.path, r.status, r.body)
		}
		// A session without an account gets account_required.
		if r := call(notifUser{sub: "notif-unknown-" + uuid.NewString()}, rt); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"account_required"`) {
			t.Fatalf("%s %s no account: %d %s", rt.method, rt.path, r.status, r.body)
		}
	}
	// A candidate without membership on the member tree is forbidden.
	for _, rt := range routesFor(notifReadPath) {
		if r := call(w.candidate, rt); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"forbidden"`) {
			t.Fatalf("%s %s candidate: %d %s", rt.method, rt.path, r.status, r.body)
		}
	}
	wantRead(t, "nothing marked by refused calls", w.readAt(t, mine, ownMember, recruiterCandidate, recruiterMember), false, false, false, false)

	// The recruiter's member tree never shows its candidate-kind row.
	if p := w.page(t, w.recruiter, ""); len(p.Items) != 1 || p.Items[0].GroupKey != "n:"+recruiterMember.String() || p.UnreadNotifications != 1 {
		t.Fatalf("member tree items = %v unread=%d", notifKeys(p.Items), p.UnreadNotifications)
	}

	// A candidate with a company membership still sees only candidate rows on the
	// candidate tree, and only member rows on the member tree.
	w.exec(t, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), w.candidate.id, w.company)
	var page notifPage
	r := w.get(t, w.candidate, notifCandidatePath)
	if err := json.Unmarshal(r.body, &page); err != nil || r.status != http.StatusOK {
		t.Fatalf("candidate tree: %d %s", r.status, r.body)
	}
	if got := notifKeys(page.Items); len(got) != 1 || got[0] != "n:"+mine.String() || page.UnreadNotifications != 1 {
		t.Fatalf("candidate tree items = %v unread=%d", got, page.UnreadNotifications)
	}
	notifJSONEqual(t, w.get(t, w.candidate, notifCandidatePath+"/unread-count").body, `{"unread_count": 1, "unread_notifications": 1}`)
	if p := w.page(t, w.candidate, ""); len(p.Items) != 1 || p.Items[0].GroupKey != "n:"+ownMember.String() {
		t.Fatalf("member tree of the candidate = %v", notifKeys(p.Items))
	}
	// Marks on one tree never reach the other tree's rows.
	wantMark(t, w.candidateMark(t, w.candidate, "read", `{"ids":["`+ownMember.String()+`","`+recruiterCandidate.String()+`"]}`), 0, 0, 1, 1)
	wantMark(t, w.mark(t, w.candidate, "read", `{"ids":["`+mine.String()+`"]}`), 0, 0, 1, 1)
	wantMark(t, w.candidateMark(t, w.candidate, "read-all", `{"before":"`+notifFuture+`"}`), 1, 1, 0, 0)
	wantRead(t, "trees separate", w.readAt(t, mine, ownMember, recruiterCandidate, recruiterMember), true, false, false, false)
	wantMark(t, w.mark(t, w.candidate, "read-all", `{"before":"`+notifFuture+`"}`), 1, 1, 0, 0)
	wantRead(t, "member read-all", w.readAt(t, mine, ownMember, recruiterCandidate, recruiterMember), true, true, false, false)
	notifJSONEqual(t, w.get(t, w.candidate, notifCandidatePath+"/facets?state=all").body, `{
  "state": "all", "types": [{"type": "candidate_status_changed", "count": 1}],
  "jobs": [{"job_id": "`+w.jobA.String()+`", "title": "Analista de nómina Sr.", "count": 1}], "jobs_total": 1
}`)
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}
