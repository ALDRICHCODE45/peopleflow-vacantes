package main

import (
	"bytes"
	"context"
	"testing"
)

const usageText = "usage: audit-purge [-execute]\n" +
	"Dry run by default: prints how many audit_events rows are older than the 24 month retention. " +
	"-execute deletes them in batches of 1000, one transaction per batch, each binding the peopleflow.audit_purge flag to its own transaction id (audit-log-v1 sections 6 and 7). " +
	"Run it daily from the deploy scheduler, dry run first. DATABASE_URL must be supplied in the environment.\n"

func TestMissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	var out, stderr bytes.Buffer
	if code := run(context.Background(), nil, &out, &stderr); code != 1 || out.Len() != 0 || stderr.String() != "audit purge failed\n" {
		t.Fatalf("unexpected config failure: %d stdout=%q stderr=%q", code, out.String(), stderr.String())
	}
}

func TestDatabaseErrorsAreStatic(t *testing.T) {
	for _, dsn := range []string{"postgres://invalid%zz:secret", "postgres://secret:secret@127.0.0.1:1/draft_test?sslmode=disable&connect_timeout=1"} {
		for _, args := range [][]string{nil, {"-execute"}} {
			t.Setenv("DATABASE_URL", dsn)
			var out, stderr bytes.Buffer
			if code := run(context.Background(), args, &out, &stderr); code != 1 || out.Len() != 0 || stderr.String() != "audit purge failed\n" {
				t.Fatalf("unsafe database error: %d %q %q", code, out.String(), stderr.String())
			}
		}
	}
}

func TestHelpAndInvalidArguments(t *testing.T) {
	for _, tc := range []struct {
		args        []string
		code        int
		out, stderr string
	}{
		{[]string{"-help"}, 0, usageText, ""},
		{[]string{"-h"}, 0, usageText, ""},
		{[]string{"-bad-secret"}, 1, "", "audit purge failed\n"},
		{[]string{"unexpected"}, 1, "", "audit purge failed\n"},
		{[]string{"-execute=maybe"}, 1, "", "audit purge failed\n"},
	} {
		var out, stderr bytes.Buffer
		if code := run(context.Background(), tc.args, &out, &stderr); code != tc.code || out.String() != tc.out || stderr.String() != tc.stderr {
			t.Fatalf("args %q: %d %q %q", tc.args, code, out.String(), stderr.String())
		}
	}
}
