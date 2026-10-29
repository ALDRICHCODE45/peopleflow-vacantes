//go:build integration

package main

import (
	"crypto/sha256"
	"strings"
	"testing"
)

// Independent-verifier regression probe for B8 (S8): a nonexistent token gets
// the same private 404 on every public operation, including malformed input,
// so no real-handler response can mark a fake token as validated.
func TestPsychometricVerifierUnknownRoutes(t *testing.T) {
	f := assessmentSetup(t)
	base := "/v2/assessments/" + strings.Repeat("Z", 43)
	before := sha256.Sum256([]byte(f.snapshot(t)))
	for _, tc := range []struct{ m, p string }{
		{"GET", ""},
		{"GET", "/items"},
		{"POST", "/consent"},
		{"POST", "/finish"},
		{"PUT", "/answers/1"},
		{"DELETE", "/answers/1"},
		{"PUT", "/answers/nope"},
		{"DELETE", "/answers/0"},
	} {
		r := f.h.do(t, tc.m, base+tc.p, "{", "", nil)
		assessmentHeaders(t, r)
		want := "{\"error\":\"psychometric assessment unavailable\",\"code\":\"assessment_unavailable\"}\n"
		if r.status != 404 || string(r.body) != want {
			t.Fatalf("%s %s: %d %s", tc.m, tc.p, r.status, r.body)
		}
		if sha256.Sum256([]byte(f.snapshot(t))) != before {
			t.Fatal("mutation")
		}
	}
}
