//go:build integration

// Notifications v2 in-app off (docs/contracts/notifications-v2.md D6, §In-app off): a
// row created with in_app = false is hidden from every scoped inbox statement — list
// (grouped rows, latest, sample), attention, unread counts, facets — and is never
// touched by read / unread / read-all / undo, on both the member and candidate trees.
// Same disposable draft_test_mig_* harness as notifications_read_integration_test.go.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// hide marks rows as created with the in-app channel off.
func (w *notifWorld) hide(t *testing.T, ids ...uuid.UUID) {
	t.Helper()
	for _, id := range ids {
		w.exec(t, `UPDATE notifications SET in_app=false WHERE id=$1`, id)
	}
}

func TestNotificationsHidden_MemberListCountsFacetsAndMarks(t *testing.T) {
	w := newNotifWorld(t)
	appKey := fmt.Sprintf("applications:%s:2026-11-26", w.jobA)
	pendingKey := fmt.Sprintf("psychometrics_pending:%s:2026-11-26", w.jobB)
	visibleApp := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), actor: ptr(w.candidates[0].id), at: ts(0)})
	visibleSingle := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobA, at: ts(-time.Hour)})
	// Hidden: a newer unread row and an older read row inside the visible group, a
	// group made only of a hidden row on job B, and an unread overdue attention item.
	hiddenApp := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[1]), actor: ptr(w.candidates[1].id), at: ts(5 * time.Minute)})
	hiddenRead := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[2]), at: ts(-10 * time.Minute), read: true})
	hiddenGroup := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "psychometric_pending", group: pendingKey, job: w.jobB, at: ts(time.Minute)})
	hiddenOverdue := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobA, at: ts(-2 * time.Hour)})
	hiddenDue := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "assignment_deadline_due_soon", job: w.jobB, at: ts(-3 * time.Hour)})
	w.hide(t, hiddenApp, hiddenRead, hiddenGroup, hiddenOverdue, hiddenDue)
	hidden := []uuid.UUID{hiddenApp, hiddenRead, hiddenGroup, hiddenOverdue, hiddenDue}

	// List: no attention, two groups; the mixed group counts, samples and shows only
	// its visible row even though the hidden one is newer.
	p := w.page(t, w.recruiter, "")
	if p.Attention == nil || len(*p.Attention) != 0 || p.AttentionTotal == nil || *p.AttentionTotal != 0 {
		t.Fatalf("attention = %v total %v, want empty", p.Attention, p.AttentionTotal)
	}
	if keys := notifKeys(p.Items); strings.Join(keys, ",") != appKey+",n:"+visibleSingle.String() {
		t.Fatalf("items = %v", keys)
	}
	app := p.Items[0]
	if app.Count != 1 || app.UnreadCount != 1 || app.Latest.ID != visibleApp.String() || app.LatestAt != "2026-11-26T15:00:00Z" ||
		app.FirstAt != "2026-11-26T15:00:00Z" || len(app.Sample) != 1 || app.Sample[0].ParticipationID != w.parts[0].String() {
		t.Fatalf("mixed group = %+v", app)
	}
	if p.UnreadCount != 2 || p.UnreadNotifications != 2 {
		t.Fatalf("page counters = %d/%d, want 2/2", p.UnreadCount, p.UnreadNotifications)
	}
	// Filters selecting only hidden rows find nothing; unread-only too.
	for _, q := range []string{"?types=psychometric_pending", "?types=delivery_overdue,assignment_deadline_due_soon", "?job_ids=" + w.jobB.String(), "?state=unread&types=psychometric_pending"} {
		if fp := w.page(t, w.recruiter, q); len(fp.Items) != 0 || len(*fp.Attention) != 0 || *fp.AttentionTotal != 0 {
			t.Fatalf("GET %s = items %v attention %v", q, notifKeys(fp.Items), fp.Attention)
		}
	}
	notifJSONEqual(t, w.get(t, w.recruiter, notifReadPath+"/unread-count").body, `{"unread_count":2,"unread_notifications":2}`)

	// Facets: hidden rows add no type, no job and no count, in either state.
	jobA := w.jobA.String()
	for _, state := range []string{"", "?state=all"} {
		name := "unread"
		if state != "" {
			name = "all"
		}
		notifJSONEqual(t, w.get(t, w.recruiter, notifReadPath+"/facets"+state).body, `{
  "state": "`+name+`",
  "types": [{"type": "application_received", "count": 1}, {"type": "vacancy_assigned", "count": 1}],
  "jobs": [{"job_id": "`+jobA+`", "title": "Analista de nómina", "count": 2}],
  "jobs_total": 1
}`)
	}

	// Marks by id or group key never reach a hidden row.
	ids := `"` + hiddenApp.String() + `","` + hiddenGroup.String() + `","` + hiddenOverdue.String() + `","` + hiddenDue.String() + `"`
	wantMark(t, w.mark(t, w.recruiter, "read", `{"ids":[`+ids+`]}`), 0, 0, 2, 2)
	wantMark(t, w.mark(t, w.recruiter, "read", `{"group_keys":["`+pendingKey+`","n:`+hiddenOverdue.String()+`"]}`), 0, 0, 2, 2)
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"ids":["`+hiddenRead.String()+`"]}`), 0, 0, 2, 2)
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"group_keys":["`+appKey+`"]}`), 0, 0, 2, 2)
	// The mixed group's read marks only its visible row.
	wantMark(t, w.mark(t, w.recruiter, "read", `{"group_keys":["`+appKey+`"]}`), 1, 1, 1, 1)
	wantRead(t, "group read", w.readAt(t, visibleApp, hiddenApp, hiddenRead), true, false, true)
	// read-all (filtered and not) skips hidden rows.
	wantMark(t, w.mark(t, w.recruiter, "read-all", `{"types":["psychometric_pending","delivery_overdue"],"before":"`+notifFuture+`"}`), 0, 0, 1, 1)
	all := w.mark(t, w.recruiter, "read-all", `{"before":"`+notifFuture+`"}`)
	wantMark(t, all, 1, 1, 0, 0)
	wantRead(t, "read-all", w.readAt(t, hidden...), false, true, false, false, false)
	// Undo of exactly that batch reverts the visible row only, even when a hidden
	// row carries the same read_at.
	w.exec(t, `UPDATE notifications SET read_at=$2 WHERE id=$1`, hiddenRead, all.MarkedAt)
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"marked_at":"`+all.MarkedAt+`"}`), 1, 1, 1, 1)
	wantRead(t, "undo", w.readAt(t, visibleSingle, hiddenRead), false, true)
	notifJSONEqual(t, w.get(t, w.recruiter, notifReadPath+"/unread-count").body, `{"unread_count":1,"unread_notifications":1}`)
}

// candidatePage is a lax view of the candidate GET B (only what the hidden check needs).
type candidatePage struct {
	Attention      []json.RawMessage `json:"attention"`
	AttentionTotal int               `json:"attention_total"`
	Items          []struct {
		GroupKey string `json:"group_key"`
		Count    int    `json:"count"`
	} `json:"items"`
	UnreadCount         int `json:"unread_count"`
	UnreadNotifications int `json:"unread_notifications"`
}

func TestNotificationsHidden_CandidateListCountsFacetsAndMarks(t *testing.T) {
	w := newCandidateWorld(t)
	visible := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.partA), payload: `{"status":"in_process"}`, at: ts(0)})
	hiddenTest := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_test_pending", job: w.jobB, part: ptr(w.partB), payload: `{"invitation_id":"` + uuid.NewString() + `"}`, at: ts(time.Minute)})
	hiddenRead := w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_message_received", job: w.jobB, part: ptr(w.partB), payload: `{"status":"closed"}`, at: ts(-time.Minute), read: true})
	w.hide(t, hiddenTest, hiddenRead)

	r := w.get(t, w.candidate, notifCandidatePath)
	if r.status != http.StatusOK {
		t.Fatalf("GET candidate = %d %s", r.status, r.body)
	}
	var p candidatePage
	if err := json.Unmarshal(r.body, &p); err != nil {
		t.Fatal(err)
	}
	if len(p.Items) != 1 || p.Items[0].GroupKey != "n:"+visible.String() || len(p.Attention) != 0 || p.AttentionTotal != 0 || p.UnreadCount != 1 || p.UnreadNotifications != 1 {
		t.Fatalf("candidate page = %s", r.body)
	}
	notifJSONEqual(t, w.get(t, w.candidate, notifCandidatePath+"/unread-count").body, `{"unread_count":1,"unread_notifications":1}`)
	jobA := w.jobA.String()
	notifJSONEqual(t, w.get(t, w.candidate, notifCandidatePath+"/facets?state=all").body, `{
  "state": "all",
  "types": [{"type": "candidate_status_changed", "count": 1}],
  "jobs": [{"job_id": "`+jobA+`", "title": "Analista de nómina Sr.", "count": 1}],
  "jobs_total": 1
}`)

	wantMark(t, w.candidateMark(t, w.candidate, "read", `{"ids":["`+hiddenTest.String()+`"]}`), 0, 0, 1, 1)
	wantMark(t, w.candidateMark(t, w.candidate, "read", `{"group_keys":["n:`+hiddenTest.String()+`"]}`), 0, 0, 1, 1)
	wantMark(t, w.candidateMark(t, w.candidate, "unread", `{"ids":["`+hiddenRead.String()+`"]}`), 0, 0, 1, 1)
	all := w.candidateMark(t, w.candidate, "read-all", `{"before":"`+notifFuture+`"}`)
	wantMark(t, all, 1, 1, 0, 0)
	w.exec(t, `UPDATE notifications SET read_at=$2 WHERE id=$1`, hiddenRead, all.MarkedAt)
	wantMark(t, w.candidateMark(t, w.candidate, "unread", `{"marked_at":"`+all.MarkedAt+`"}`), 1, 1, 1, 1)
	wantRead(t, "candidate hidden", w.readAt(t, visible, hiddenTest, hiddenRead), false, false, true)
}
