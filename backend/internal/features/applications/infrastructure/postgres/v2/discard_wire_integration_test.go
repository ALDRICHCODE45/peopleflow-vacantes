//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestDiscardRecoveryExactWireAndCandidatePrivacy(t *testing.T) {
	m := setupMovement(t)
	assertDetail := func(discarded bool) {
		t.Helper()
		rec := movementRequest(t, m, "GET", m.vacancy, m.item.ID, "", "", "")
		if rec.Code != 200 {
			t.Fatal(rec.Code, rec.Body.String())
		}
		detail := movementObject(t, rec.Body.Bytes())
		movementItemKeys(t, detail, "screening", "comment", "candidate_message", "contact")
		if discarded {
			d := movementKeys(t, detail["discard"], "reason", "previous_stage_id", "discarded_at", "recovery_stage_id")
			movementKeys(t, d["reason"], "group", "key")
			if detail["comment"] != "Internal explanation 😀" || detail["candidate_message"] != "Thank you\nfor applying." {
				t.Fatal(detail)
			}
		} else if detail["discard"] != nil || detail["comment"] != nil || detail["candidate_message"] != nil {
			t.Fatal(detail)
		}
	}
	assertCandidate := func(status string, message any) {
		t.Helper()
		page, err := m.store.List(context.Background(), m.sub, app.Query{Limit: 20})
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(page)
		if err != nil {
			t.Fatal(err)
		}
		obj := movementKeys(t, movementObject(t, raw), "items", "next_cursor")
		item := movementKeys(t, obj["items"].([]any)[0], "id", "vacancy", "company", "applied_at", "status", "message")
		vacancy := movementKeys(t, item["vacancy"], "id", "title", "state")
		if vacancy["state"] != "open" {
			t.Fatal(vacancy)
		}
		movementKeys(t, item["company"], "id", "name")
		if item["status"] != status || item["message"] != message || strings.Contains(string(raw), "Internal explanation") || strings.Contains(string(raw), "recruiter") {
			t.Fatal(string(raw))
		}
	}
	assertDetail(false)
	assertCandidate("submitted", nil)
	target := pipelineconfig.Defaults(m.vacancy).Stages[1].ID
	moved, err := m.move(t, m.item, target, false)
	if err != nil {
		t.Fatal(err)
	}
	m.item = moved.Item
	assertCandidate("in_process", nil)
	rec := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/discard", m.item.ETag, discardBody)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	discarded := movementObject(t, rec.Body.Bytes())
	movementItemKeys(t, discarded, "coverage", "delivery")
	movementKeys(t, discarded["delivery"], "state", "delivered", "target")
	movementKeys(t, discarded["coverage"], "covered", "required", "full_coverage_reached_at")
	d := movementKeys(t, discarded["discard"], "reason", "previous_stage_id", "discarded_at", "recovery_stage_id")
	movementKeys(t, d["reason"], "group", "key")
	if rec.Header().Get("ETag") != discarded["etag"] || discarded["stage_id"] != pipelineconfig.Defaults(m.vacancy).Exit.ID || discarded["moved_at"] != d["discarded_at"] || d["previous_stage_id"] != target {
		t.Fatal(discarded, rec.Header())
	}
	assertDetail(true)
	assertCandidate("closed", "Thank you\nfor applying.")
	rec = movementRequest(t, m, "GET", m.vacancy, uuid.Nil, "", "", "")
	obj := movementObject(t, rec.Body.Bytes())
	item := obj["participations"].([]any)[0].(map[string]any)
	movementItemKeys(t, item)
	if obj["exit"].(map[string]any)["count"] != float64(1) || item["discard"] == nil || item["moved_at"] != discarded["moved_at"] {
		t.Fatal(obj)
	}
	rec = movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/recover", discarded["etag"].(string), `{}`)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	recovered := movementObject(t, rec.Body.Bytes())
	movementItemKeys(t, recovered, "coverage", "delivery")
	movementKeys(t, recovered["delivery"], "state", "delivered", "target")
	if recovered["discard"] != nil || recovered["stage_id"] != target || rec.Header().Get("ETag") != recovered["etag"] {
		t.Fatal(recovered)
	}
	assertDetail(false)
	assertCandidate("in_process", nil)
	rec = movementRequest(t, m, "GET", m.vacancy, m.item.ID, "/history", "", "")
	entries := movementKeys(t, movementObject(t, rec.Body.Bytes()), "items")["items"].([]any)
	if len(entries) != 4 {
		t.Fatal(entries)
	}
	for i, kind := range []string{"intake", "move", "discard", "recovery"} {
		keys := []string{"kind", "from_stage_id", "to_stage_id", "hire", "departure", "actor", "at"}
		if kind == "discard" {
			keys = append(keys, "reason", "comment", "candidate_message")
		}
		e := movementKeys(t, entries[i], keys...)
		movementKeys(t, e["actor"], "kind", "id", "full_name")
		if e["kind"] != kind {
			t.Fatal(e)
		}
		if kind == "discard" {
			movementKeys(t, e["reason"], "group", "key")
			if e["comment"] != "Internal explanation 😀" || e["candidate_message"] != "Thank you\nfor applying." {
				t.Fatal(e)
			}
		}
	}
}

func TestDiscardRecoveryAuthorizationAndRejectionsOverHTTP(t *testing.T) {
	a, b := setupMovement(t), setupMovement(t)
	beforeA, beforeB := a.snapshot(t), b.snapshot(t)
	// §13.6.9: the old reason member is rejected, not silently accepted as key.
	legacy := movementRequest(t, a, "POST", a.vacancy, a.item.ID, "/discard", a.item.ETag, `{"reason":{"group":"candidate","\u0063ode":"unresponsive"}}`)
	if legacy.Code != 400 || movementObject(t, legacy.Body.Bytes())["code"] != "invalid_request" {
		t.Fatal(legacy.Code, legacy.Body.String())
	}
	for _, op := range []string{"discard", "recover"} {
		t.Run(op, func(t *testing.T) {
			body := discardBody
			if op == "recover" {
				body = `{}`
			}
			for _, tc := range []struct {
				name         string
				vacancy, pid uuid.UUID
				tag          string
				status       int
				code         string
			}{
				{"foreign actual participation", a.vacancy, b.item.ID, b.item.ETag, 404, "not_found"},
				{"foreign actual vacancy", b.vacancy, b.item.ID, b.item.ETag, 404, "not_found"},
				{"missing participation", a.vacancy, uuid.New(), a.item.ETag, 404, "not_found"},
				{"missing tag", a.vacancy, a.item.ID, "", 428, "precondition_required"},
				{"stale tag", a.vacancy, a.item.ID, `"foreign"`, 412, "version_conflict"},
				{"malformed tag", a.vacancy, a.item.ID, "bad", 400, "invalid_request"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					rec := movementRequest(t, a, "POST", tc.vacancy, tc.pid, "/"+op, tc.tag, body)
					obj := movementKeys(t, movementObject(t, rec.Body.Bytes()), "error", "code")
					if rec.Code != tc.status || obj["code"] != tc.code || rec.Header().Get("ETag") != "" {
						t.Fatal(rec.Code, obj)
					}
				})
			}
		})
	}
	// A real authorized draft cannot accept either operation, before item/tag checks.
	draft := uuid.New()
	if _, err := a.pool.Exec(context.Background(), `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, draft, a.vacancy); err != nil {
		t.Fatal(err)
	}
	for _, op := range []string{"discard", "recover"} {
		rec := movementRequest(t, a, "POST", draft, a.item.ID, "/"+op, a.item.ETag, `{}`)
		obj := movementKeys(t, movementObject(t, rec.Body.Bytes()), "error", "code")
		if rec.Code != 409 || obj["code"] != "vacancy_not_published" {
			t.Fatal(rec.Code, obj)
		}
	}
	if beforeA != a.snapshot(t) || beforeB != b.snapshot(t) {
		t.Fatal("rejections changed persisted effects")
	}
}
