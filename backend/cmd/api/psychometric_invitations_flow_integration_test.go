//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

type invitationFixture struct {
	h                   *draftFlowHarness
	actor               draftFlowActor
	id, pid, base, send string
}

func invitationSetup(t *testing.T) invitationFixture {
	t.Helper()
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	a := h.actor(t, uid, sub)
	id := publicationFlowReady(t, h, a)
	publicFlowPublish(t, h, id, a)
	pid := draftListCandidateSeed(t, h, id, pipelineconfig.Defaults(uuid.MustParse(id)).Stages[0].ID)
	base := draftFlowV2Path + "/" + id
	// Invitation audit entities are independent of the parent draft's cleanup.
	t.Cleanup(func() {
		_, err := h.pool.Exec(context.Background(), `DELETE FROM audit_events WHERE entity_type='psychometric_invitation' AND metadata->>'vacancy_id'=$1`, id)
		if err != nil {
			t.Error(err)
		}
	})
	return invitationFixture{h, a, id, pid, base, base + "/participations/" + pid + "/psychometric-invitations"}
}
func (f invitationFixture) enable(t *testing.T, days int) {
	t.Helper()
	path := f.base + "/psychometric-profile"
	r := f.h.do(t, "GET", path, "", f.actor.token, nil)
	body := profileBody(t)
	body["enabled"] = true
	body["expires_in_days"] = days
	r = f.h.do(t, "PUT", path, profileEncode(t, body), f.actor.token, map[string]string{"If-Match": r.header.Get("ETag")})
	if r.status != 200 {
		t.Fatalf("enable %d %s", r.status, r.body)
	}
}
func (f invitationFixture) snapshot(t *testing.T) string {
	t.Helper()
	var raw string
	err := f.h.pool.QueryRow(context.Background(), `SELECT json_build_array((SELECT json_agg(i ORDER BY i.id) FROM psychometric_invitations i JOIN process_participations p ON p.id=i.participation_id WHERE p.process_id=$1),(SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE a.metadata->>'vacancy_id'=$1::text))::text`, f.id).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func invitationObject(t *testing.T, r draftFlowResponse, status int) map[string]any {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	if r.status != status {
		t.Fatalf("invitation=%d %s want %d", r.status, r.body, status)
	}
	return draftFlowObject(t, r.body)
}
func invitationError(t *testing.T, f invitationFixture, path, token string, status int, code, message string) {
	t.Helper()
	before := f.snapshot(t)
	r := f.h.do(t, "POST", path, "", token, nil)
	draftFlowAssertNoStore(t, r)
	want := fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", message, code)
	if r.status != status || string(r.body) != want {
		t.Fatalf("%d %s want %d %s", r.status, r.body, status, want)
	}
	if before != f.snapshot(t) {
		t.Fatal("rejected write changed invitations/audits")
	}
}
func TestPsychometricInvitationFlowLifecycle(t *testing.T) {
	f := invitationSetup(t)
	invitationError(t, f, f.send, f.actor.token, 409, "profile_disabled", "psychometric profile disabled")
	f.enable(t, 1)
	created := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	iid := created["id"].(string)
	path := f.base + "/psychometric-invitations/" + iid
	at, err := time.Parse(time.RFC3339Nano, created["created_at"].(string))
	if err != nil {
		t.Fatal(err)
	}
	expires := at.AddDate(0, 0, 1)
	var name string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT full_name FROM users WHERE id=$1`, f.actor.userID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"id": iid, "participation_id": f.pid, "test": "ipip60-mx", "content_version": "psychometrics.content.v1", "scoring_version": "psychometrics.scoring.v1", "status": "created", "origin": "manual", "created_by": map[string]any{"id": f.actor.userID.String(), "full_name": name}, "trigger_stage_id": nil, "created_at": created["created_at"], "expires_at": expires.Format(time.RFC3339Nano), "consented_at": nil, "answered_count": float64(0), "total_count": float64(63), "finished_at": nil, "last_reminded_at": nil, "reminder_count": float64(0)}
	if !reflect.DeepEqual(created, want) {
		t.Fatalf("got=%v want=%v", created, want)
	}
	var purge time.Time
	var token []byte
	if err := f.h.pool.QueryRow(context.Background(), `SELECT purge_after,token_hash FROM psychometric_invitations WHERE id=$1`, iid).Scan(&purge, &token); err != nil || !purge.Equal(expires.AddDate(1, 0, 0)) || token != nil {
		t.Fatal(purge, token, err)
	}
	before := f.snapshot(t)
	again := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 200)
	if !reflect.DeepEqual(created, again) || before != f.snapshot(t) {
		t.Fatal("create not idempotent")
	}
	list := invitationObject(t, f.h.do(t, "GET", f.base+"/psychometric-invitations", "", f.actor.token, nil), 200)
	if !reflect.DeepEqual(list, map[string]any{"items": []any{created}}) || before != f.snapshot(t) {
		t.Fatal(list)
	}
	reminded := invitationObject(t, f.h.do(t, "POST", path+"/reminders", "", f.actor.token, nil), 200)
	want["reminder_count"] = float64(1)
	want["last_reminded_at"] = reminded["last_reminded_at"]
	if want["last_reminded_at"] == nil || !reflect.DeepEqual(reminded, want) {
		t.Fatal(reminded)
	}
	revoked := invitationObject(t, f.h.do(t, "POST", path+"/revoke", "", f.actor.token, nil), 200)
	want["status"] = "revoked"
	if !reflect.DeepEqual(revoked, want) {
		t.Fatal(revoked)
	}
	var revokedAt time.Time
	if err := f.h.pool.QueryRow(context.Background(), `SELECT revoked_at,purge_after FROM psychometric_invitations WHERE id=$1`, iid).Scan(&revokedAt, &purge); err != nil || !purge.Equal(revokedAt.AddDate(1, 0, 0)) {
		t.Fatal(purge, err)
	}
	before = f.snapshot(t)
	if got := invitationObject(t, f.h.do(t, "POST", path+"/revoke", "", f.actor.token, nil), 200); !reflect.DeepEqual(got, want) || before != f.snapshot(t) {
		t.Fatal("revoke not idempotent")
	}
	invitationError(t, f, path+"/reminders", f.actor.token, 409, "invitation_closed", "psychometric invitation closed")
	for _, event := range []string{"PsychometricInvitationCreated", "PsychometricReminderRecorded", "PsychometricInvitationRevoked"} {
		var n int
		if err := f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type=$2 AND actor_id=$3`, iid, event, f.actor.userID).Scan(&n); err != nil || n != 1 {
			t.Fatal(event, n, err)
		}
	}
	// Revoke permits a new assessment; list returns only the latest per participation.
	latest := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	if latest["id"] == iid {
		t.Fatal("reused revoked invitation")
	}
	list = invitationObject(t, f.h.do(t, "GET", f.base+"/psychometric-invitations", "", f.actor.token, nil), 200)
	if !reflect.DeepEqual(list, map[string]any{"items": []any{latest}}) {
		t.Fatal(list)
	}
}
func TestPsychometricInvitationFlowStatusesExpiryAndFinished(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 7)
	created := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	iid := created["id"].(string)
	path := f.base + "/psychometric-invitations/" + iid
	exec := func(q string) {
		t.Helper()
		if _, err := f.h.pool.Exec(context.Background(), q, iid); err != nil {
			t.Fatal(err)
		}
	}
	listStatus := func(want string) {
		t.Helper()
		before := f.snapshot(t)
		r := invitationObject(t, f.h.do(t, "GET", f.base+"/psychometric-invitations", "", f.actor.token, nil), 200)
		created["status"] = want
		if !reflect.DeepEqual(r, map[string]any{"items": []any{created}}) || before != f.snapshot(t) {
			t.Fatal(r)
		}
	}
	exec(`UPDATE psychometric_invitations SET consented_at=created_at WHERE id=$1`)
	created["consented_at"] = created["created_at"]
	listStatus("in_progress")
	// An expired timestamp closes an otherwise in-progress invitation. The pure
	// status test separately pins equality at the exact now == expires boundary.
	exec(`UPDATE psychometric_invitations SET expires_at=created_at,purge_after=created_at+interval '12 months' WHERE id=$1`)
	created["expires_at"] = created["created_at"]
	listStatus("expired")
	invitationError(t, f, path+"/reminders", f.actor.token, 409, "invitation_closed", "psychometric invitation closed")
	replacement := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	if replacement["id"] == iid {
		t.Fatal("expired blocked replacement")
	}
	var status string
	var superseded *time.Time
	var revoked *time.Time
	if err := f.h.pool.QueryRow(context.Background(), `SELECT superseded_at,revoked_at FROM psychometric_invitations WHERE id=$1`, iid).Scan(&superseded, &revoked); err != nil || superseded == nil || revoked != nil {
		t.Fatal(superseded, revoked, err)
	}
	status = "finished"
	iid = replacement["id"].(string)
	path = f.base + "/psychometric-invitations/" + iid
	exec(`UPDATE psychometric_invitations SET finished_at=created_at,purge_after=created_at+interval '12 months' WHERE id=$1`)
	invitationError(t, f, f.send, f.actor.token, 409, "already_finished", "psychometric assessment already finished")
	invitationError(t, f, path+"/reminders", f.actor.token, 409, "invitation_closed", "psychometric invitation closed")
	got := invitationObject(t, f.h.do(t, "GET", f.base+"/psychometric-invitations", "", f.actor.token, nil), 200)
	replacement["status"] = status
	replacement["finished_at"] = replacement["created_at"]
	if !reflect.DeepEqual(got, map[string]any{"items": []any{replacement}}) {
		t.Fatal(got)
	}
	var before time.Time
	if err := f.h.pool.QueryRow(context.Background(), `SELECT purge_after FROM psychometric_invitations WHERE id=$1`, iid).Scan(&before); err != nil {
		t.Fatal(err)
	}
	invitationObject(t, f.h.do(t, "POST", path+"/revoke", "", f.actor.token, nil), 200)
	var after time.Time
	if err := f.h.pool.QueryRow(context.Background(), `SELECT purge_after FROM psychometric_invitations WHERE id=$1`, iid).Scan(&after); err != nil || !after.Equal(before) {
		t.Fatal(after, err)
	}
}
func TestPsychometricInvitationFlowGatesAndConcurrency(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 30)
	other := invitationSetup(t)
	foreignPath := strings.Replace(f.send, f.pid, other.pid, 1)
	invitationError(t, f, foreignPath, f.actor.token, 404, "not_found", "not found")
	invitationError(t, f, f.send, other.actor.token, 404, "not_found", "not found")
	invitationError(t, f, f.send, "", 401, "unauthenticated", "unauthorized")
	// Both requests start together and observe exactly one new and one existing invitation.
	start := make(chan struct{})
	results := make(chan draftFlowResponse, 2)
	var wg sync.WaitGroup
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; results <- f.h.do(t, "POST", f.send, "", f.actor.token, nil) }()
	}
	close(start)
	wg.Wait()
	close(results)
	counts := map[int]int{}
	var first map[string]any
	for r := range results {
		counts[r.status]++
		obj := invitationObject(t, r, r.status)
		if first == nil {
			first = obj
		} else if !reflect.DeepEqual(first, obj) {
			t.Fatal("concurrent responses differ")
		}
	}
	if counts[201] != 1 || counts[200] != 1 {
		t.Fatal(counts)
	}
	var n int
	if err := f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM psychometric_invitations WHERE participation_id=$1 AND revoked_at IS NULL AND finished_at IS NULL AND superseded_at IS NULL`, f.pid).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	iid := first["id"].(string)
	if err := f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricInvitationCreated'`, iid).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	invitationError(t, f, f.base+"/psychometric-invitations/"+uuid.NewString()+"/revoke", f.actor.token, 404, "not_found", "not found")
	invitationError(t, f, other.base+"/psychometric-invitations/"+iid+"/reminders", other.actor.token, 404, "not_found", "not found")
	// The real discard operation covers discarded and exit-stage guards.
	detail := f.h.do(t, "GET", f.base+"/participations/"+f.pid, "", f.actor.token, nil)
	discarded := f.h.do(t, "POST", f.base+"/participations/"+f.pid+"/discard", `{"reason":{"group":"candidate","key":"unresponsive"},"comment":"Test","candidate_message":"Test"}`, f.actor.token, map[string]string{"If-Match": draftFlowObject(t, detail.body)["etag"].(string)})
	if discarded.status != 200 {
		t.Fatal(discarded.status, string(discarded.body))
	}
	invitationError(t, f, f.send, f.actor.token, 409, "participation_inactive", "participation inactive")
	current := f.h.do(t, "GET", f.base+"/lifecycle", "", f.actor.token, nil)
	finished := f.h.do(t, "POST", f.base+"/lifecycle/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, f.actor.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if finished.status != 200 {
		t.Fatal(finished.status, string(finished.body))
	}
	for _, path := range []string{f.send, f.base + "/psychometric-invitations/" + iid + "/reminders", f.base + "/psychometric-invitations/" + iid + "/revoke"} {
		before := f.snapshot(t)
		r := f.h.do(t, "POST", path, "", f.actor.token, nil)
		draftFlowAssertCatalogError(t, r, 409, "process_finished")
		expected := map[string]any{"error": "process finished", "code": "process_finished", "data": map[string]any{"lifecycle": draftFlowObject(t, finished.body)}}
		if !reflect.DeepEqual(draftFlowObject(t, r.body), expected) {
			t.Fatal(string(r.body))
		}
		if before != f.snapshot(t) {
			t.Fatal("finished write mutated data")
		}
	}
}
