//go:build integration

package main

import (
	"bytes"
	"context"
	"testing"
	"time"
)

// Independent-verifier regression probe for B10 (S10): locked rows terminate
// without being counted, and a failing batch rolls back without leaking text.
func TestPurgeVerifierLockedAndFailure(t *testing.T) {
	p := purgeFixture(t)
	id := seedInvitation(t, p, "finished", "past")
	before := snapshot(t, p, "")
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(),
		"SELECT id FROM psychometric_invitations WHERE id=$1 FOR UPDATE",
		id); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var out, stderr bytes.Buffer
	if code := run(ctx, []string{"-execute"}, &out, &stderr); code != 0 ||
		out.String() != expectedCounts(0, 0) || stderr.Len() != 0 {
		t.Fatalf("locked: %d %q %q", code, out.String(), stderr.String())
	}
	if snapshot(t, p, "") != before {
		t.Fatal("locked rows changed")
	}
	if err = tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	execFixture(t, p, `CREATE FUNCTION fail_scrub() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SECRET-id-token-dsn'; END $$;
 CREATE TRIGGER fail_scrub BEFORE UPDATE ON psychometric_invitations
 FOR EACH ROW EXECUTE FUNCTION fail_scrub()`)
	if code, out, stderr := callPurge(); code != 0 ||
		out != expectedCounts(1, 1) || stderr != "" {
		t.Fatalf("dry: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge("-execute"); code != 1 ||
		out != "" || stderr != "psychometric purge failed\n" {
		t.Fatalf("failure: %d %q %q", code, out, stderr)
	}
	if snapshot(t, p, "") != before {
		t.Fatal("failed batch changed rows")
	}
	execFixture(t, p, "DROP TRIGGER fail_scrub ON psychometric_invitations")
	if code, out, stderr := callPurge("-execute"); code != 0 ||
		out != expectedCounts(1, 1) || stderr != "" {
		t.Fatalf("retry: %d %q %q", code, out, stderr)
	}
}
