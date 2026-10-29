//go:build integration

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	psychopg "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/postgres"
	"github.com/google/uuid"
)

func TestPsychometricLinksFlow(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 7)
	created := invitationObject(t, f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	iid := created["id"].(string)
	path := f.base + "/psychometric-invitations/" + iid + "/link"
	store := psychopg.NewInvitationsStore(f.h.pool, nil)
	lookup := func(token string) (uuid.UUID, error) { return store.LookupToken(context.Background(), token) }
	auditCount := func() int {
		t.Helper()
		var n int
		if err := f.h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricLinkIssued' AND actor_id=$2`, iid, f.actor.userID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	mint := func() string {
		t.Helper()
		r := invitationObject(t, f.h.do(t, "POST", path, "", f.actor.token, nil), 200)
		token, ok := r["token"].(string)
		if !ok || !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(token) || len(r) != 2 || r["expires_at"] != created["expires_at"] {
			t.Fatal("invalid link response")
		}
		if _, err := time.Parse(time.RFC3339Nano, r["expires_at"].(string)); err != nil {
			t.Fatal(err)
		}
		return token
	}
	first := mint()
	var hash []byte
	if err := f.h.pool.QueryRow(context.Background(), `SELECT token_hash FROM psychometric_invitations WHERE id=$1`, iid).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	want := sha256.Sum256([]byte(first))
	if !bytes.Equal(hash, want[:]) {
		t.Fatal("wrong hash")
	}
	if strings.Contains(f.snapshot(t), first) {
		t.Fatal("raw token persisted in row or audit")
	}
	if id, err := lookup(first); err != nil || id.String() != iid {
		t.Fatal("minted token unavailable")
	}
	if auditCount() != 1 {
		t.Fatal("missing mint audit")
	}
	second := mint()
	if second == first {
		t.Fatal("token reused")
	}
	if id, err := lookup(first); id != uuid.Nil || err != invitations.ErrUnavailable {
		t.Fatal("old link still available")
	}
	if id, err := lookup(second); err != nil || id.String() != iid {
		t.Fatal("replacement unavailable")
	}
	if auditCount() != 2 {
		t.Fatal("wrong mint audit count")
	}
	// Simultaneous issuers serialize: exactly the last committed hash resolves.
	start := make(chan struct{})
	out := make(chan draftFlowResponse, 2)
	var wg sync.WaitGroup
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; out <- f.h.do(t, "POST", path, "", f.actor.token, nil) }()
	}
	close(start)
	wg.Wait()
	close(out)
	valid := 0
	for r := range out {
		obj := invitationObject(t, r, 200)
		token := obj["token"].(string)
		if strings.Contains(f.snapshot(t), token) {
			t.Fatal("raw token persisted")
		}
		id, err := lookup(token)
		if err == nil && id.String() == iid {
			valid++
		} else if id != uuid.Nil || err != invitations.ErrUnavailable {
			t.Fatal("unexpected lookup outcome")
		}
	}
	if valid != 1 || auditCount() != 4 {
		t.Fatal("concurrent issuance invariant failed")
	}
	unknown := strings.Repeat("A", 43)
	unavailable := func(token string) {
		t.Helper()
		before := f.snapshot(t)
		id, err := lookup(token)
		if id != uuid.Nil || err != invitations.ErrUnavailable {
			t.Fatal("distinguishable unavailable outcome")
		}
		if before != f.snapshot(t) {
			t.Fatal("lookup mutated data")
		}
	}
	for _, token := range []string{"", "short", strings.Repeat("A", 44), strings.Repeat("!", 43), unknown} {
		unavailable(token)
	}
	for _, state := range []string{"finished", "expired", "revoked"} {
		t.Run(state, func(t *testing.T) {
			token := mint()
			q := map[string]string{"finished": `UPDATE psychometric_invitations SET finished_at=created_at WHERE id=$1`, "expired": `UPDATE psychometric_invitations SET expires_at=created_at WHERE id=$1`, "revoked": `UPDATE psychometric_invitations SET revoked_at=created_at WHERE id=$1`}[state]
			if _, err := f.h.pool.Exec(context.Background(), q, iid); err != nil {
				t.Fatal(err)
			}
			invitationError(t, f, path, f.actor.token, 409, "invitation_closed", "psychometric invitation closed")
			if state != "finished" {
				unavailable(token)
			}
			if _, err := f.h.pool.Exec(context.Background(), `UPDATE psychometric_invitations SET finished_at=NULL,revoked_at=NULL,expires_at=$2 WHERE id=$1`, iid, created["expires_at"]); err != nil {
				t.Fatal(err)
			}
		})
	}
	other := invitationSetup(t)
	invitationError(t, f, path, other.actor.token, 404, "not_found", "not found")
	invitationError(t, f, other.base+"/psychometric-invitations/"+iid+"/link", other.actor.token, 404, "not_found", "not found")
	invitationError(t, f, f.base+"/psychometric-invitations/"+uuid.NewString()+"/link", f.actor.token, 404, "not_found", "not found")
	current := f.h.do(t, "GET", f.base+"/lifecycle", "", f.actor.token, nil)
	closed := f.h.do(t, "POST", f.base+"/lifecycle/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, f.actor.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if closed.status != 200 {
		t.Fatal(closed.status)
	}
	before := f.snapshot(t)
	r := f.h.do(t, "POST", path, "", f.actor.token, nil)
	draftFlowAssertNoStore(t, r)
	expected := map[string]any{"error": "process finished", "code": "process_finished", "data": map[string]any{"lifecycle": draftFlowObject(t, closed.body)}}
	if r.status != 409 || !reflect.DeepEqual(draftFlowObject(t, r.body), expected) || before != f.snapshot(t) {
		t.Fatal("process gate failed")
	}
}
