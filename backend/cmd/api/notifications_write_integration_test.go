//go:build integration

// Notifications member writes and facets (notifications-v1 N5: POST B/read, POST B/unread,
// POST B/read-all, GET B/facets with B = /v2/me/company/notifications) through the
// production router, the real auth middleware and the real member gate. Same disposable
// draft_test_mig_* database harness as notifications_read_integration_test.go.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func (w *notifWorld) post(t *testing.T, u notifUser, path, body string) notifResponse {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, w.server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if u.sub != "" {
		req.Header.Set("Authorization", "Bearer "+w.signer.validToken(t, u.sub))
	}
	resp, err := w.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return notifResponse{status: resp.StatusCode, header: resp.Header.Clone(), body: raw}
}

// notifMark is the wire shape of read / unread / read-all, decoded strictly.
type notifMark struct {
	AffectedNotifications int    `json:"affected_notifications"`
	AffectedGroups        int    `json:"affected_groups"`
	MarkedAt              string `json:"marked_at"`
	UnreadCount           int    `json:"unread_count"`
	UnreadNotifications   int    `json:"unread_notifications"`
}

func (w *notifWorld) mark(t *testing.T, u notifUser, op, body string) notifMark {
	t.Helper()
	r := w.post(t, u, notifReadPath+"/"+op, body)
	if r.status != http.StatusOK || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("POST %s %s = %d cache=%q body=%s", op, body, r.status, r.header.Get("Cache-Control"), r.body)
	}
	var m notifMark
	dec := json.NewDecoder(strings.NewReader(string(r.body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
	at, err := time.Parse(time.RFC3339Nano, m.MarkedAt)
	if err != nil || at.Location() != time.UTC || !strings.HasSuffix(m.MarkedAt, "Z") {
		t.Fatalf("marked_at %q is not RFC 3339 UTC", m.MarkedAt)
	}
	return m
}

func wantMark(t *testing.T, got notifMark, affected, groups, unreadGroups, unreadRows int) {
	t.Helper()
	if got.AffectedNotifications != affected || got.AffectedGroups != groups || got.UnreadCount != unreadGroups || got.UnreadNotifications != unreadRows {
		t.Fatalf("mark = %+v, want affected %d/%d unread %d/%d", got, affected, groups, unreadGroups, unreadRows)
	}
}

// readAt returns read_at of each row (any recipient), nil when unread.
func (w *notifWorld) readAt(t *testing.T, ids ...uuid.UUID) []*time.Time {
	t.Helper()
	out := make([]*time.Time, len(ids))
	for i, id := range ids {
		if err := w.pool.QueryRow(context.Background(), `SELECT read_at FROM notifications WHERE id=$1`, id).Scan(&out[i]); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

func wantRead(t *testing.T, label string, got []*time.Time, want ...bool) {
	t.Helper()
	for i := range want {
		if (got[i] != nil) != want[i] {
			t.Fatalf("%s: row %d read=%v, want %v (all %v)", label, i, got[i] != nil, want[i], got)
		}
	}
}

func (w *notifWorld) audits(t *testing.T) int {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestNotificationsWrite_ReadUnreadAndUndoExactBatch(t *testing.T) {
	w := newNotifWorld(t)
	appKey := fmt.Sprintf("applications:%s:2026-11-26", w.jobA)
	old := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), at: ts(-time.Hour), read: true})
	a1 := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[1]), at: ts(0)})
	a2 := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[2]), at: ts(time.Minute)})
	single := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobB, at: ts(-2 * time.Hour)})
	resolved := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_due_soon", job: w.jobB, at: ts(-3 * time.Hour), resolved: true})
	overdue := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobA, at: ts(-4 * time.Hour)})
	// The colleague has a group with the same key and rows of their own (D26).
	theirs := w.notify(t, notifRow{recipient: w.colleague.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[3]), at: ts(0)})
	theirsRead := w.notify(t, notifRow{recipient: w.colleague.id, typ: "vacancy_assigned", job: w.jobA, at: ts(0), read: true})

	// Group read: only the caller's unread rows of the group, one statement timestamp.
	r := w.post(t, w.recruiter, notifReadPath+"/read", `{"group_keys":["`+appKey+`","n:`+theirsRead.String()+`","n:`+uuid.NewString()+`"]}`)
	t.Logf("POST %s/read → %d %s", notifReadPath, r.status, r.body)
	first := w.mark(t, w.recruiter, "read", `{"group_keys":["`+appKey+`"]}`)
	wantMark(t, first, 0, 0, 2, 2) // the logged call above already marked the group
	var logged notifMark
	if err := json.Unmarshal(r.body, &logged); err != nil {
		t.Fatal(err)
	}
	wantMark(t, logged, 2, 1, 2, 2)
	marked, _ := time.Parse(time.RFC3339Nano, logged.MarkedAt)
	got := w.readAt(t, old, a1, a2, theirs, theirsRead)
	if !got[1].Equal(marked) || !got[2].Equal(marked) || got[0].Equal(marked) || got[3] != nil || !got[4].Equal(ts(0)) {
		t.Fatalf("after group read: read_at=%v marked=%v", got, marked)
	}

	// New activity in the group, then a second batch by ids (a foreign id is ignored).
	a3 := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[3]), at: ts(2 * time.Minute)})
	second := w.mark(t, w.recruiter, "read", `{"ids":["`+single.String()+`","`+theirs.String()+`","`+uuid.NewString()+`"]}`)
	wantMark(t, second, 1, 1, 2, 2)
	if second.MarkedAt == logged.MarkedAt {
		t.Fatal("two marks share a marked_at")
	}

	// Undo of the first batch reverts exactly a1 and a2: not the older read row, not
	// the second batch, and the new row stays unread.
	undo := w.post(t, w.recruiter, notifReadPath+"/unread", `{"marked_at":"`+logged.MarkedAt+`"}`)
	t.Logf("POST %s/unread → %d %s", notifReadPath, undo.status, undo.body)
	var undone notifMark
	if undo.status != http.StatusOK || json.Unmarshal(undo.body, &undone) != nil {
		t.Fatalf("undo: %d %s", undo.status, undo.body)
	}
	wantMark(t, undone, 2, 1, 2, 4)
	wantRead(t, "after undo", w.readAt(t, old, a1, a2, a3, single, theirs, theirsRead), true, false, false, false, true, false, true)
	// The same undo again is idempotent.
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"marked_at":"`+logged.MarkedAt+`"}`), 0, 0, 2, 4)

	// Unread by ids / group keys touches only the caller's read, unresolved rows.
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"ids":["`+old.String()+`","`+theirsRead.String()+`","`+resolved.String()+`"]}`), 1, 1, 2, 5)
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"group_keys":["n:`+single.String()+`","n:`+theirsRead.String()+`"]}`), 1, 1, 3, 6)
	// A resolved row is never unread: read and unread both leave it alone.
	wantMark(t, w.mark(t, w.recruiter, "read", `{"ids":["`+resolved.String()+`"]}`), 0, 0, 3, 6)
	w.exec(t, `UPDATE notifications SET read_at=now() WHERE id=$1`, resolved)
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"group_keys":["n:`+resolved.String()+`"]}`), 0, 0, 3, 6)
	// Attention items are marked like any other row.
	wantMark(t, w.mark(t, w.recruiter, "read", `{"ids":["`+overdue.String()+`"]}`), 1, 1, 2, 5)
	wantRead(t, "colleague untouched", w.readAt(t, theirs, theirsRead), false, true)

	// The counters match GET B/unread-count; nothing was audited (D23).
	notifJSONEqual(t, w.get(t, w.recruiter, notifReadPath+"/unread-count").body, `{"unread_count":2,"unread_notifications":5}`)
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}

func TestNotificationsWrite_ValidationErrors(t *testing.T) {
	w := newNotifWorld(t)
	keys, ids, jobs := make([]string, 101), make([]string, 201), make([]string, 21)
	for i := range keys {
		keys[i] = `"n:` + uuid.NewString() + `"`
	}
	for i := range ids {
		ids[i] = `"` + uuid.NewString() + `"`
	}
	for i := range jobs {
		jobs[i] = `"` + uuid.NewString() + `"`
	}
	validation := func(fields string) string {
		return `{"error":"validation failed","code":"validation_error","fields":` + fields + `}`
	}
	const invalidRequest = `{"error":"invalid request","code":"invalid_request"}`
	note := uuid.NewString()
	cases := []struct {
		op, body string
		status   int
		want     string
	}{
		{"read", `{}`, 400, validation(`[{"field":"body","code":"required"}]`)},
		{"unread", `{}`, 400, validation(`[{"field":"body","code":"required"}]`)},
		{"read", ``, 400, invalidRequest},
		{"read", `{"group_keys":["n:` + note + `"],"ids":["` + note + `"]}`, 400, validation(`[{"field":"body","code":"invalid"}]`)},
		{"unread", `{"ids":["` + note + `"],"marked_at":"2026-11-26T18:45:02Z"}`, 400, validation(`[{"field":"body","code":"invalid"}]`)},
		{"read", `{"marked_at":"2026-11-26T18:45:02Z"}`, 400, validation(`[{"field":"marked_at","code":"not_allowed"}]`)},
		{"unread", `{"marked_at":"ayer"}`, 400, validation(`[{"field":"marked_at","code":"invalid"}]`)},
		{"read", `{"group_keys":[]}`, 400, validation(`[{"field":"group_keys","code":"empty"}]`)},
		{"unread", `{"ids":[]}`, 400, validation(`[{"field":"ids","code":"empty"}]`)},
		{"read", `{"group_keys":[` + strings.Join(keys, ",") + `]}`, 400, validation(`[{"field":"group_keys","code":"too_many"}]`)},
		{"read", `{"ids":[` + strings.Join(ids, ",") + `]}`, 400, validation(`[{"field":"ids","code":"too_many"}]`)},
		{"read", `{"ids":["nope"]}`, 400, validation(`[{"field":"ids","code":"invalid"}]`)},
		{"unread", `{"group_keys":["applications:` + w.jobA.String() + `:2026-13-40"]}`, 400, validation(`[{"field":"group_keys","code":"invalid"}]`)},
		{"read", `{"foo":1}`, 400, invalidRequest},
		{"read", `{"ids":"` + note + `"}`, 400, invalidRequest},
		{"unread", `not json`, 400, invalidRequest},
		{"read", `{"ids":["` + note + `"]} {}`, 400, invalidRequest},
		{"read", `{"ids":["` + strings.Repeat("x", 70_000) + `"]}`, 413, `{"error":"payload too large","code":"payload_too_large"}`},
		{"read-all", `{"types":["bogus"],"job_ids":[` + strings.Join(jobs, ",") + `],"before":"2026-11-26"}`, 400,
			validation(`[{"field":"before","code":"invalid"},{"field":"job_ids","code":"too_many"},{"field":"types","code":"invalid"}]`)},
		{"read-all", `{"types":[]}`, 400, validation(`[{"field":"types","code":"empty"}]`)},
		{"read-all", `{"marked_at":"2026-11-26T18:45:02Z"}`, 400, invalidRequest},
		{"read-all", `[]`, 400, invalidRequest},
	}
	for _, tc := range cases {
		r := w.post(t, w.recruiter, notifReadPath+"/"+tc.op, tc.body)
		if r.status != tc.status {
			t.Errorf("%s %.60s: status=%d body=%s", tc.op, tc.body, r.status, r.body)
			continue
		}
		notifJSONEqual(t, r.body, tc.want)
	}
	facets := []struct{ query, want string }{
		{"?state=read", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"state","code":"invalid"}]}`},
		{"?state=all&state=unread", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"state","code":"duplicate"}]}`},
	}
	for _, tc := range facets {
		r := w.get(t, w.recruiter, notifReadPath+"/facets"+tc.query)
		if r.status != http.StatusBadRequest {
			t.Errorf("facets %s: %d %s", tc.query, r.status, r.body)
			continue
		}
		notifJSONEqual(t, r.body, tc.want)
	}
	// Read-all accepts an empty body (all optional).
	wantMark(t, w.mark(t, w.recruiter, "read-all", ``), 0, 0, 0, 0)
}

func TestNotificationsWrite_ReadAllFiltersBeforeAndUndo(t *testing.T) {
	w := newNotifWorld(t)
	// Rows two days before notifT0 (in the past for the database clock) plus one
	// created an hour after the real clock, which the default before (now) excludes.
	at := func(d time.Duration) time.Time { return ts(-48*time.Hour + d) }
	appKey := fmt.Sprintf("applications:%s:2026-11-24", w.jobA)
	appA1 := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), at: at(-10 * time.Minute)})
	appA2 := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[1]), at: at(0)})
	appB := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: fmt.Sprintf("applications:%s:2026-11-24", w.jobB), job: w.jobB, at: at(-time.Minute)})
	teamA := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_team_added", job: w.jobA, payload: `{"function":"member"}`, at: at(-time.Hour)})
	overdueB := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobB, at: at(-2 * time.Hour)})
	recent := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobB, at: at(time.Hour)})
	theirs := w.notify(t, notifRow{recipient: w.colleague.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[2]), at: at(0)})
	otherCompany := w.notify(t, notifRow{recipient: w.recruiter.id, company: &w.other, typ: "application_received", group: appKey, job: w.jobA, at: at(0)})
	future := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobA, at: time.Now().UTC().Add(time.Hour)})
	all := []uuid.UUID{appA1, appA2, appB, teamA, overdueB, recent, theirs, otherCompany, future}

	// Filters: application_received on job A only.
	r := w.post(t, w.recruiter, notifReadPath+"/read-all", `{"types":["application_received"],"job_ids":["`+w.jobA.String()+`"]}`)
	t.Logf("POST %s/read-all → %d %s", notifReadPath, r.status, r.body)
	var filtered notifMark
	if r.status != http.StatusOK || json.Unmarshal(r.body, &filtered) != nil {
		t.Fatalf("read-all filtered: %d %s", r.status, r.body)
	}
	wantMark(t, filtered, 2, 1, 5, 5)
	wantRead(t, "filtered", w.readAt(t, all...), true, true, false, false, false, false, false, false, false)

	// before: only rows created at or before it; the attention item is included.
	before := w.mark(t, w.recruiter, "read-all", `{"before":"`+at(-time.Hour).Format(time.RFC3339)+`"}`)
	wantMark(t, before, 2, 2, 3, 3)
	wantRead(t, "before", w.readAt(t, all...), true, true, false, true, true, false, false, false, false)

	// Undo reverts exactly the before-batch; then the default before (now) marks the
	// rest except the row created after the request.
	wantMark(t, w.mark(t, w.recruiter, "unread", `{"marked_at":"`+before.MarkedAt+`"}`), 2, 2, 5, 5)
	wantRead(t, "undo", w.readAt(t, all...), true, true, false, false, false, false, false, false, false)
	rest := w.mark(t, w.recruiter, "read-all", `{}`)
	wantMark(t, rest, 4, 4, 1, 1)
	wantRead(t, "rest", w.readAt(t, all...), true, true, true, true, true, true, false, false, false)
	// A filter matching nothing still returns a marked_at.
	wantMark(t, w.mark(t, w.recruiter, "read-all", `{"types":["candidate_status_changed"]}`), 0, 0, 1, 1)
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}

type notifFacets struct {
	State string `json:"state"`
	Types []struct {
		Type  string `json:"type"`
		Count int    `json:"count"`
	} `json:"types"`
	Jobs []struct {
		JobID string  `json:"job_id"`
		Title *string `json:"title"`
		Count int     `json:"count"`
	} `json:"jobs"`
	JobsTotal int `json:"jobs_total"`
}

func TestNotificationsFacets_PerStateIgnoringFilters(t *testing.T) {
	w := newNotifWorld(t)
	appKey := fmt.Sprintf("applications:%s:2026-11-26", w.jobA)
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), at: ts(0), read: true})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[1]), at: ts(time.Minute)})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: fmt.Sprintf("applications:%s:2026-11-25", w.jobA), job: w.jobA, at: ts(-24 * time.Hour), read: true})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobA, at: ts(-time.Hour)})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_reassigned", job: w.jobB, at: ts(-2 * time.Hour)})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobB, at: ts(-3 * time.Hour), read: true})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_due_soon", job: w.jobB, at: ts(-4 * time.Hour), resolved: true})
	gone := uuid.New() // a job without a draft: title null
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_team_added", job: gone, at: ts(-5 * time.Hour)})
	// Out of scope: the colleague, another company, candidate rows.
	w.notify(t, notifRow{recipient: w.colleague.id, typ: "psychometric_completed", group: fmt.Sprintf("psychometrics:%s:2026-11-26", w.jobB), job: w.jobB, at: ts(0)})
	w.notify(t, notifRow{recipient: w.recruiter.id, company: &w.other, typ: "vacancy_assigned", job: w.otherJob, at: ts(0)})
	w.notify(t, notifRow{recipient: w.recruiter.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, payload: `{"status":"in_process"}`, at: ts(0)})

	jobA, jobB, goneID := w.jobA.String(), w.jobB.String(), gone.String()
	r := w.get(t, w.recruiter, notifReadPath+"/facets?types=vacancy_assigned&job_ids="+jobB)
	t.Logf("GET %s/facets → %d %s", notifReadPath, r.status, r.body)
	if r.status != http.StatusOK || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("facets: %d %q %s", r.status, r.header.Get("Cache-Control"), r.body)
	}
	notifJSONEqual(t, r.body, `{
  "state": "unread",
  "types": [
    {"type": "application_received", "count": 1},
    {"type": "delivery_overdue", "count": 1},
    {"type": "vacancy_reassigned", "count": 1},
    {"type": "vacancy_team_added", "count": 1}
  ],
  "jobs": [
    {"job_id": "`+jobA+`", "title": "Analista de nómina", "count": 2},
    {"job_id": "`+jobB+`", "title": "Ejecutivo de ventas", "count": 1},
    {"job_id": "`+goneID+`", "title": null, "count": 1}
  ],
  "jobs_total": 3
}`)
	allState := w.get(t, w.recruiter, notifReadPath+"/facets?state=all")
	notifJSONEqual(t, allState.body, `{
  "state": "all",
  "types": [
    {"type": "application_received", "count": 2},
    {"type": "delivery_due_soon", "count": 1},
    {"type": "delivery_overdue", "count": 1},
    {"type": "vacancy_assigned", "count": 1},
    {"type": "vacancy_reassigned", "count": 1},
    {"type": "vacancy_team_added", "count": 1}
  ],
  "jobs": [
    {"job_id": "`+jobA+`", "title": "Analista de nómina", "count": 3},
    {"job_id": "`+jobB+`", "title": "Ejecutivo de ventas", "count": 3},
    {"job_id": "`+goneID+`", "title": null, "count": 1}
  ],
  "jobs_total": 3
}`)

	// Nothing unread: empty arrays, never null.
	notifJSONEqual(t, w.get(t, w.stakeholder, notifReadPath+"/facets").body, `{"state":"unread","types":[],"jobs":[],"jobs_total":0}`)

	// jobs ≤ 50 ordered by count DESC, title; jobs_total counts every job.
	var many []string
	for i := 0; i < 52; i++ {
		job := uuid.New()
		many = append(many, job.String())
		w.notify(t, notifRow{recipient: w.colleague.id, typ: "vacancy_assigned", job: job, at: ts(time.Duration(i) * time.Second)})
	}
	w.notify(t, notifRow{recipient: w.colleague.id, typ: "vacancy_team_added", job: w.jobA, at: ts(0)})
	w.notify(t, notifRow{recipient: w.colleague.id, typ: "vacancy_assigned", job: w.jobA, at: ts(0)})
	var f notifFacets
	raw := w.get(t, w.colleague, notifReadPath+"/facets").body
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&f); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	if len(f.Jobs) != 50 || f.JobsTotal != 54 || f.Jobs[0].JobID != jobA || f.Jobs[0].Count != 2 || f.Jobs[1].JobID != jobB || f.Jobs[1].Count != 1 {
		t.Fatalf("colleague facets: jobs=%d total=%d first=%+v", len(f.Jobs), f.JobsTotal, f.Jobs[:2])
	}
	// Untitled jobs follow the titled ones, ordered by id.
	sort.Strings(many)
	var got []string
	for _, j := range f.Jobs[2:] {
		if j.Title != nil {
			t.Fatalf("untitled job has a title: %+v", j)
		}
		got = append(got, j.JobID)
	}
	if !reflect.DeepEqual(got, many[:48]) {
		t.Fatalf("untitled order = %v", got)
	}
	if f.Types[0].Type != "vacancy_assigned" || f.Types[0].Count != 53 {
		t.Fatalf("colleague types = %+v", f.Types)
	}
}

func TestNotificationsWrite_ScopeIsolation(t *testing.T) {
	w := newNotifWorld(t)
	mine := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobA, at: ts(-48 * time.Hour)})
	colleague := w.notify(t, notifRow{recipient: w.colleague.id, typ: "vacancy_assigned", job: w.jobA, at: ts(-48 * time.Hour)})
	otherCompany := w.notify(t, notifRow{recipient: w.recruiter.id, company: &w.other, typ: "vacancy_assigned", job: w.otherJob, at: ts(-48 * time.Hour)})
	candidateRow := w.notify(t, notifRow{recipient: w.recruiter.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, payload: `{"status":"in_process"}`, at: ts(-48 * time.Hour)})
	foreign := []uuid.UUID{colleague, otherCompany, candidateRow}
	idList := func(ids ...uuid.UUID) string {
		out := make([]string, len(ids))
		for i, id := range ids {
			out[i] = `"` + id.String() + `"`
		}
		return strings.Join(out, ",")
	}

	// Foreign ids and keys are silently not affected (no 404, D26).
	wantMark(t, w.mark(t, w.recruiter, "read", `{"ids":[`+idList(foreign...)+`]}`), 0, 0, 1, 1)
	keys := `"n:` + colleague.String() + `","n:` + otherCompany.String() + `","n:` + candidateRow.String() + `"`
	wantMark(t, w.mark(t, w.recruiter, "read", `{"group_keys":[`+keys+`]}`), 0, 0, 1, 1)
	wantMark(t, w.mark(t, w.recruiter, "read-all", `{}`), 1, 1, 0, 0)
	wantRead(t, "foreign untouched", w.readAt(t, append([]uuid.UUID{mine}, foreign...)...), true, false, false, false)

	// The same user reads in the other company: only that company's rows.
	w.exec(t, `DELETE FROM company_members WHERE user_id=$1 AND company_id=$2`, w.recruiter.id, w.company)
	w.exec(t, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), w.recruiter.id, w.other)
	moved := w.mark(t, w.recruiter, "read-all", `{}`)
	wantMark(t, moved, 1, 1, 0, 0)
	wantRead(t, "other company", w.readAt(t, otherCompany, colleague, candidateRow), true, false, false)

	// Another user's batch cannot be undone by its marked_at.
	colleagueMark := w.mark(t, w.colleague, "read", `{"ids":["`+colleague.String()+`"]}`)
	wantMark(t, w.mark(t, w.outsider, "unread", `{"marked_at":"`+colleagueMark.MarkedAt+`"}`), 0, 0, 0, 0)
	wantRead(t, "colleague batch kept", w.readAt(t, colleague), true)
	// The stakeholder passes the gate and affects nothing.
	wantMark(t, w.mark(t, w.stakeholder, "read-all", `{}`), 0, 0, 0, 0)

	routes := []struct{ method, path, body string }{
		{http.MethodPost, notifReadPath + "/read", `{"ids":["` + mine.String() + `"]}`},
		{http.MethodPost, notifReadPath + "/unread", `{"ids":["` + mine.String() + `"]}`},
		{http.MethodPost, notifReadPath + "/read-all", `{}`},
		{http.MethodGet, notifReadPath + "/facets", ``},
	}
	call := func(u notifUser, method, path, body string) notifResponse {
		if method == http.MethodGet {
			return w.get(t, u, path)
		}
		return w.post(t, u, path, body)
	}
	for _, rt := range routes {
		r := call(notifUser{}, rt.method, rt.path, rt.body)
		if r.status != http.StatusUnauthorized || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
			t.Fatalf("%s anonymous: %d %q", rt.path, r.status, r.header.Get("Cache-Control"))
		}
		if r = call(w.candidate, rt.method, rt.path, rt.body); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"forbidden"`) {
			t.Fatalf("%s candidate: %d %s", rt.path, r.status, r.body)
		}
	}
	w.exec(t, `UPDATE companies SET deleted_at=now() WHERE id=$1`, w.company)
	for _, rt := range routes {
		if r := call(w.colleague, rt.method, rt.path, rt.body); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"company_inactive"`) {
			t.Fatalf("%s deleted company: %d %s", rt.path, r.status, r.body)
		}
	}
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}
