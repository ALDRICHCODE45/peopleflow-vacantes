package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

// pipelineSQLStateError stands in for a driver error exposing SQLState(); its
// message carries a submitted value that must never reach the log.
type pipelineSQLStateError struct{}

func (pipelineSQLStateError) Error() string    { return `invalid input syntax: "secret@example.test"` }
func (pipelineSQLStateError) SQLState() string { return "22P02" }

// Bugfix pipeline-preview-500: a pipeline 500 logs its cause with bounded
// fields (no raw URL, no driver message); contract errors log nothing.
func TestPipelineRoutes_InternalErrorLogsBoundedCause(t *testing.T) {
	base := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline"
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"opaque"`}
	cases := []struct {
		name, method, path, route string
		err                       error
		status                    int
		want                      map[string]string // nil: no failure record
	}{
		{"preview invariant", "POST", base + "/preview", "/v2/me/company/job-drafts/{id}/pipeline/preview", fmt.Errorf("pipeline impact: %w", errors.New("history for participation outside the locked set")), 500,
			map[string]string{"error_type": "*fmt.wrapError", "sqlstate": "", "cause": "pipeline impact: history for participation outside the locked set"}},
		{"put driver", "PUT", base, "/v2/me/company/job-drafts/{id}/pipeline", pipelineSQLStateError{}, 500,
			map[string]string{"error_type": "main.pipelineSQLStateError", "sqlstate": "22P02", "cause": ""}},
		{"get internal", "GET", base, "/v2/me/company/job-drafts/{id}/pipeline", errors.New("boom"), 500,
			map[string]string{"error_type": "*errors.errorString", "sqlstate": "", "cause": "boom"}},
		{"preview occupied", "POST", base + "/preview", "", &pipelineconfig.Occupied{StageIDs: []string{routeTestDraftID.String()}}, 409, nil},
		{"preview validation", "POST", base + "/preview", "", drafts.ErrValidation, 400, nil},
		{"put confirmation", "PUT", base, "", pipelineconfig.ErrImpactConfirmation, 409, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
			t.Cleanup(func() { slog.SetDefault(prev) })
			body := ""
			if tc.method != "GET" {
				body = `{}`
			}
			r := doRouteRequest(t, pipelineRoutesRouter(&pipelineRouteStore{err: tc.err}), tc.method, tc.path, body, auth)
			if r.Code != tc.status {
				t.Fatalf("status=%d body=%s", r.Code, r.Body.String())
			}
			if strings.Contains(buf.String(), "secret@example.test") || strings.Contains(r.Body.String(), "outside the locked set") {
				t.Fatal("driver message logged or cause leaked to the response")
			}
			var records []map[string]any
			for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
				rec := map[string]any{}
				if line == "" || json.Unmarshal([]byte(line), &rec) != nil || rec["msg"] != "pipeline handler failed" {
					continue
				}
				records = append(records, rec)
			}
			if tc.want == nil {
				if len(records) != 0 {
					t.Fatalf("contract error logged: %v", records)
				}
				return
			}
			if len(records) != 1 {
				t.Fatalf("want one failure record, got %v (%s)", records, buf.String())
			}
			rec := records[0]
			want := map[string]string{"level": "ERROR", "method": tc.method, "path": tc.route, "code_class": "internal_error"}
			for k, v := range tc.want {
				want[k] = v
			}
			for k, v := range want {
				if rec[k] != v {
					t.Fatalf("%s=%v want %q (record %v)", k, rec[k], v, rec)
				}
			}
			if _, ok := rec["request_id"]; !ok {
				t.Fatalf("request_id missing: %v", rec)
			}
			allowed := map[string]bool{"time": true, "level": true, "msg": true, "request_id": true, "method": true, "path": true, "code_class": true, "error_type": true, "cause": true, "sqlstate": true}
			for k := range rec {
				if !allowed[k] {
					t.Fatalf("unexpected log key %q: %v", k, rec)
				}
			}
		})
	}
}
