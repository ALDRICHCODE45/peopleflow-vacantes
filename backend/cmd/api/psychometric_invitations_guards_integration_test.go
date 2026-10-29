//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestPsychometricInvitationFlowWholeBoardAndExited(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 7)
	config := pipelineconfig.Defaults(uuid.MustParse(f.id))
	exited := draftListCandidateSeed(t, f.h, f.id, config.Exit.ID)
	invitationError(t, f, strings.Replace(f.send, f.pid, exited, 1), f.actor.token, 409, "participation_inactive", "participation inactive")
	second := draftListCandidateSeed(t, f.h, f.id, config.Stages[0].ID)
	expected := []any{}
	for _, pid := range []string{f.pid, second} {
		send := strings.Replace(f.send, f.pid, pid, 1)
		first := invitationObject(t, f.h.do(t, "POST", send, "", f.actor.token, nil), 201)
		invitationObject(t, f.h.do(t, "POST", f.base+"/psychometric-invitations/"+first["id"].(string)+"/revoke", "", f.actor.token, nil), 200)
		latest := invitationObject(t, f.h.do(t, "POST", send, "", f.actor.token, nil), 201)
		expected = append(expected, latest)
	}
	other := invitationSetup(t)
	other.enable(t, 7)
	invitationObject(t, other.h.do(t, "POST", other.send, "", other.actor.token, nil), 201)
	sort.Slice(expected, func(i, j int) bool {
		return expected[i].(map[string]any)["participation_id"].(string) < expected[j].(map[string]any)["participation_id"].(string)
	})
	before := f.snapshot(t)
	got := invitationObject(t, f.h.do(t, "GET", f.base+"/psychometric-invitations", "", f.actor.token, nil), 200)
	if !reflect.DeepEqual(got, map[string]any{"items": expected}) || before != f.snapshot(t) {
		t.Fatal(got)
	}
}

func TestPsychometricInvitationFlowUnpublishedAndUnknown(t *testing.T) {
	f := invitationSetup(t)
	id := draftListFlowCreate(t, f.h, f.actor, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	r := f.h.do(t, "GET", base+"/psychometric-invitations", "", f.actor.token, nil)
	draftFlowAssertNoStore(t, r)
	if r.status != 200 || string(r.body) != `{"items":[]}` {
		t.Fatal(r.status, string(r.body))
	}
	invitationError(t, f, base+"/participations/"+uuid.NewString()+"/psychometric-invitations", f.actor.token, 404, "not_found", "not found")
}

func TestPsychometricInvitationFlowAuditFailureRollsBack(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 7)
	name := "psychometric_audit_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.h.pool.Exec(context.Background(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	reject := func() {
		exec(fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (entity_type <> 'psychometric_invitation' OR metadata->>'vacancy_id' <> '%s') NOT VALID`, name, f.id))
	}
	allow := func() { exec(fmt.Sprintf(`ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS %s`, name)) }
	t.Cleanup(allow)
	reject()
	invitationError(t, f, f.send, f.actor.token, 500, "internal_error", "an internal error occurred")
	allow()
	created := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	iid := created["id"].(string)
	path := f.base + "/psychometric-invitations/" + iid
	reject()
	for _, suffix := range []string{"/reminders", "/revoke"} {
		invitationError(t, f, path+suffix, f.actor.token, 500, "internal_error", "an internal error occurred")
	}
	// Even expiry slot release must roll back if the replacement's audit fails.
	exec(`UPDATE psychometric_invitations SET expires_at=created_at,purge_after=created_at+interval '12 months' WHERE id=$1`, iid)
	invitationError(t, f, f.send, f.actor.token, 500, "internal_error", "an internal error occurred")
}

func TestPsychometricInvitationFlowProfileChangesAndClosedOngoing(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 7)
	initial := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	f.enable(t, 30)
	// A later profile save never changes an already pinned invitation or its expiry.
	before := f.snapshot(t)
	again := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 200)
	if !reflect.DeepEqual(initial, again) || before != f.snapshot(t) {
		t.Fatal("profile save changed invitation")
	}
	iid := initial["id"].(string)
	for _, step := range []struct{ action, body string }{{"pause", `{}`}, {"resume", `{}`}, {"close", `{"process":"continue","reason":"cancelled","reason_note":null}`}} {
		current := f.h.do(t, "GET", f.base+"/lifecycle", "", f.actor.token, nil)
		changed := f.h.do(t, "POST", f.base+"/lifecycle/"+step.action, step.body, f.actor.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
		if changed.status != 200 {
			t.Fatal(changed.status, string(changed.body))
		}
		got := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 200)
		if !reflect.DeepEqual(initial, got) {
			t.Fatal(got)
		}
	}
	// Reminder counts accumulate; reminders do not depend on profile confirmation.
	for count := 1; count <= 2; count++ {
		got := invitationObject(t, f.h.do(t, "POST", f.base+"/psychometric-invitations/"+iid+"/reminders", "", f.actor.token, nil), 200)
		initial["reminder_count"] = float64(count)
		initial["last_reminded_at"] = got["last_reminded_at"]
		if !reflect.DeepEqual(initial, got) || got["last_reminded_at"] == nil {
			t.Fatal(got)
		}
	}
}
