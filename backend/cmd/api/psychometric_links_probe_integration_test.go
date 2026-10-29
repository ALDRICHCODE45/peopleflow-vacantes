//go:build integration

package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"

	psychopg "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/postgres"
)

// A failed rotation (audit insert rejected) must leave state unchanged and the
// previously issued link valid.
func TestPsychometricLinkRotationRollbackProbe(t *testing.T) {
	f := invitationSetup(t)
	f.enable(t, 7)
	created := invitationObject(t,
		f.h.do(t, "POST", f.send, "", f.actor.token, nil), 201)
	iid := created["id"].(string)
	path := f.base + "/psychometric-invitations/" + iid + "/link"
	token := invitationObject(t,
		f.h.do(t, "POST", path, "", f.actor.token, nil), 200)["token"].(string)
	before := sha256.Sum256([]byte(f.snapshot(t)))

	name := "b5_probe_reject"
	_, err := f.h.pool.Exec(context.Background(), fmt.Sprintf(
		`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK
		(entity_type <> 'psychometric_invitation' OR
		metadata->>'vacancy_id' <> '%s') NOT VALID`, name, f.id))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := f.h.pool.Exec(context.Background(),
			"ALTER TABLE audit_events DROP CONSTRAINT "+name); err != nil {
			t.Error(err)
		}
	})

	invitationError(t, f, path, f.actor.token, 500,
		"internal_error", "an internal error occurred")
	if before != sha256.Sum256([]byte(f.snapshot(t))) {
		t.Fatal("failed rotation mutated state")
	}
	store := psychopg.NewInvitationsStore(f.h.pool, nil)
	id, err := store.LookupToken(context.Background(), token)
	if err != nil || id.String() != iid {
		t.Fatal("failed rotation invalidated prior link")
	}
}
