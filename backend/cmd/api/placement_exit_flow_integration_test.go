//go:build integration

package main

import (
	"bytes"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestPlacementExitFlow(t *testing.T) {
	for _, operation := range []string{"moves", "discard"} {
		t.Run(operation, func(t *testing.T) {
			f := newCandidateCVFixture(t, "manual")
			base, path := boardCorrectionPaths(t, f)
			cfg := pipelineconfig.Defaults(uuid.MustParse(base[len(draftFlowV2Path)+1:]))
			current := boardCorrectionRead(t, f, path, f.owner)
			tag := draftFlowObject(t, current.body)["etag"].(string)
			prefix := `"to_stage_id":"` + cfg.Stages[0].ID + `"`
			if operation == "discard" {
				prefix = `"reason":{"group":"candidate","key":"unresponsive"}`
			}
			reject := func(name, payload string, status int, code string) {
				t.Helper()
				t.Run(name, func(t *testing.T) {
					before := boardCorrectionRead(t, f, base+"/board", f.owner)
					history := boardCorrectionRead(t, f, path+"/history", f.owner)
					audit := draftFlowCount(t, f.h.pool, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, f.pid)
					r := f.h.do(t, "POST", path+"/"+operation, payload, f.owner.token, map[string]string{"If-Match": tag})
					draftFlowAssertCatalogError(t, r, status, code)
					after := boardCorrectionRead(t, f, base+"/board", f.owner)
					historyAfter := boardCorrectionRead(t, f, path+"/history", f.owner)
					if r.header.Get("ETag") != "" || !bytes.Equal(before.body, after.body) || !bytes.Equal(history.body, historyAfter.body) || audit != draftFlowCount(t, f.h.pool, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, f.pid) {
						t.Fatal("rejection changed state")
					}
				})
			}
			reject("unexpected reason", `{`+prefix+`,"placement_exit_reason":"candidate_left"}`, 400, "invalid_request")
			// Existing ordinary moves, and fulfillment capture, retain their behavior.
			for i := 1; i < len(cfg.Stages); i++ {
				r := f.h.do(t, "POST", path+"/moves", `{"to_stage_id":"`+cfg.Stages[i].ID+`"}`, f.owner.token, map[string]string{"If-Match": tag})
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				tag = draftFlowObject(t, r.body)["etag"].(string)
			}
			reject("missing", `{`+prefix+`}`, 409, "placement_exit_reason_required")
			for _, value := range []string{`null`, `true`, `1`, `""`, `"unknown"`} {
				reject("invalid "+value, `{`+prefix+`,"placement_exit_reason":`+value+`}`, 400, "invalid_request")
			}
			reject("legacy flag", `{`+prefix+`,"confirm_placement_exit":true}`, 400, "invalid_request")
			if operation == "discard" {
				reject("discard reason required", `{"placement_exit_reason":"candidate_left"}`, 400, "invalid_request")
			}
			// Both reason codes work; recovery confirmation is unchanged.
			for _, reason := range []string{"moved_by_mistake", "candidate_left"} {
				r := f.h.do(t, "POST", path+"/"+operation, `{`+prefix+`,"placement_exit_reason":"`+reason+`"}`, f.owner.token, map[string]string{"If-Match": tag})
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				item := draftFlowObject(t, r.body)
				if item["version"] == draftFlowObject(t, current.body)["version"] || r.header.Get("ETag") != item["etag"] {
					t.Fatal(string(r.body))
				}
				tag = item["etag"].(string)
				if operation == "discard" {
					missing := f.h.do(t, "POST", path+"/recover", `{}`, f.owner.token, map[string]string{"If-Match": tag})
					draftFlowAssertCatalogError(t, missing, 409, "placement_reentry_confirmation_required")
					r = f.h.do(t, "POST", path+"/recover", `{"confirm_placement_reentry":true}`, f.owner.token, map[string]string{"If-Match": tag})
				} else {
					for i := 1; i < len(cfg.Stages); i++ {
						r = f.h.do(t, "POST", path+"/moves", `{"to_stage_id":"`+cfg.Stages[i].ID+`"}`, f.owner.token, map[string]string{"If-Match": tag})
						if r.status != 200 {
							t.Fatal(r.status, string(r.body))
						}
						tag = draftFlowObject(t, r.body)["etag"].(string)
					}
				}
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				tag = draftFlowObject(t, r.body)["etag"].(string)
			}
		})
	}
}
