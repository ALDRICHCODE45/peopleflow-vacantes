package main

import (
	"bytes"
	"context"
	"testing"
)

func TestMissingDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	var out, stderr bytes.Buffer
	if code := run(context.Background(), nil, &out, &stderr); code == 0 || out.Len() != 0 || stderr.String() != "psychometric purge failed\n" {
		t.Fatalf("unexpected config failure: stdout=%q stderr=%q", out.String(), stderr.String())
	}
}

func TestDatabaseErrorsAreStatic(t *testing.T) {
	for _, dsn := range []string{"postgres://invalid%zz:secret", "postgres://secret:secret@127.0.0.1:1/draft_test?sslmode=disable&connect_timeout=1"} {
		t.Setenv("DATABASE_URL", dsn)
		var out, stderr bytes.Buffer
		if code := run(context.Background(), []string{"-execute"}, &out, &stderr); code == 0 || out.Len() != 0 || stderr.String() != "psychometric purge failed\n" {
			t.Fatalf("unsafe database error: %d %q %q", code, out.String(), stderr.String())
		}
	}
}

func TestHelpAndInvalidArguments(t *testing.T) {
	for _, tc := range []struct {
		args        []string
		code        int
		out, stderr string
	}{
		{[]string{"-help"}, 0, "usage: psychometric-purge [-execute]\nDry run by default; -execute deletes retained-expired assessment data in batches of 100. DATABASE_URL must be supplied in the environment.\n", ""},
		{[]string{"-bad-secret"}, 1, "", "psychometric purge failed\n"},
		{[]string{"unexpected"}, 1, "", "psychometric purge failed\n"},
	} {
		var out, stderr bytes.Buffer
		if code := run(context.Background(), tc.args, &out, &stderr); code != tc.code || out.String() != tc.out || stderr.String() != tc.stderr {
			t.Fatalf("unexpected argument result: %d %q %q", code, out.String(), stderr.String())
		}
	}
}
