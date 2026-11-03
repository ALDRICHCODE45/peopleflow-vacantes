//go:build integration

package main

import (
	"encoding/json"
	"fmt"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"reflect"
	"testing"
)

func TestTeamReassignmentSnapshotAndFrozenDeadline(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	base, path := boardCorrectionPaths(t, f)
	cfg := pipelineconfig.Defaults(uuid.MustParse(base[len(draftFlowV2Path)+1:]))
	delivery := f.h.do(t, "GET", base+"/pipeline/delivery", "", f.owner.token, nil)
	c := draftFlowObject(t, delivery.body)
	body, _ := json.Marshal(map[string]any{"cutoffStageId": c["cutoffStageId"], "targetQuantity": 1, "commitmentDate": c["commitmentDate"]})
	saved := f.h.do(t, "PUT", base+"/pipeline/delivery", string(body), f.owner.token, map[string]string{"If-Match": delivery.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatal(saved.status, string(saved.body))
	}
	tag := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["etag"].(string)
	for _, stage := range cfg.Stages[1:] {
		r := f.h.do(t, "POST", path+"/moves", fmt.Sprintf(`{"to_stage_id":%q}`, stage.ID), f.owner.token, map[string]string{"If-Match": tag})
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = draftFlowObject(t, r.body)["etag"].(string)
	}
	peer, _ := f.company.addUser(t, "recruiter")
	team := f.h.do(t, "GET", base+"/team", "", f.owner.token, nil)
	reassign := func(user uuid.UUID, deadline string) {
		t.Helper()
		payload := fmt.Sprintf(`{"to_user_id":%q,"reason":"workload","recruiter_deadline":%q}`, user, deadline)
		r := f.h.do(t, "POST", base+"/team/reassign-responsible", payload, f.owner.token, map[string]string{"If-Match": team.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		team = r
	}
	reassign(peer, "2028-01-10")
	history := func() []any {
		t.Helper()
		r := f.h.do(t, "GET", base+"/team/history", "", f.owner.token, nil)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		return draftFlowObject(t, r.body)["items"].([]any)
	}
	var first map[string]any
	for _, raw := range history() {
		item := raw.(map[string]any)
		if item["kind"] == "reassignment" {
			first = item["reassignment"].(map[string]any)["state_snapshot"].(map[string]any)
		}
	}
	if first == nil || len(first) != 6 {
		t.Fatal(first)
	}
	if !reflect.DeepEqual(first["lifecycle"], map[string]any{"publication": "published", "process": "active"}) || !reflect.DeepEqual(first["placements"], map[string]any{"current": float64(1), "credited": float64(1)}) {
		t.Fatal(first)
	}
	stages := first["stage_counts"].([]any)
	if len(stages) != len(cfg.Stages) {
		t.Fatal(stages)
	}
	for i, raw := range stages {
		s := raw.(map[string]any)
		active := float64(0)
		if i == len(stages)-1 {
			active = 1
		}
		want := map[string]any{"stage_id": cfg.Stages[i].ID, "stage_name": cfg.Stages[i].Name, "kind": cfg.Stages[i].Kind, "active": active, "discarded": float64(0)}
		if !reflect.DeepEqual(s, want) {
			t.Fatal(s, want)
		}
	}
	d := first["delivery"].(map[string]any)
	if len(d) != 5 || d["target"] != float64(1) || d["delivered"] != float64(1) || d["fulfilled_at"] == nil || d["result"] == nil || d["commitment_date"] != c["commitmentDate"] {
		t.Fatal(d)
	}
	tramo := first["tramo"].(map[string]any)
	if len(tramo) != 5 || tramo["effective_deadline"] != c["commitmentDate"] || tramo["deadline_source"] != "commitment" || tramo["business_days_total"] == nil {
		t.Fatal(tramo)
	}
	discarded := f.h.do(t, "POST", path+"/discard", `{"reason":{"group":"candidate","key":"unresponsive"},"placement_exit_reason":"candidate_left"}`, f.owner.token, map[string]string{"If-Match": tag})
	if discarded.status != 200 {
		t.Fatal(discarded.status, string(discarded.body))
	}
	changed := f.h.do(t, "POST", base+"/commitment", `{"commitment_date":"2099-01-05","reason":"internal_delay"}`, f.owner.token, map[string]string{"If-Match": saved.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if changed.status != 200 {
		t.Fatal(changed.status, string(changed.body))
	}
	reassign(f.owner.userID, "2029-01-10")
	reassigned, closed, latest := 0, 0, false
	for _, raw := range history() {
		item := raw.(map[string]any)
		if item["kind"] == "tramo" {
			a := item["tramo"].(map[string]any)
			user := a["user"].(map[string]any)["id"]
			if a["end_cause"] == "reassigned" {
				closed++
				want := any("2028-01-10")
				if user == f.owner.userID.String() {
					want = c["commitmentDate"]
				}
				if a["closing_deadline"] != want {
					t.Fatal(a)
				}
			} else if user == f.owner.userID.String() && a["recruiter_deadline"] != "2029-01-10" {
				t.Fatal(a)
			}
		}
		if item["kind"] == "reassignment" {
			reassigned++
			s := item["reassignment"].(map[string]any)["state_snapshot"].(map[string]any)
			if reflect.DeepEqual(s["placements"], map[string]any{"current": float64(0), "credited": float64(1)}) {
				latest = true
				last := s["stage_counts"].([]any)[4].(map[string]any)
				if last["discarded"] != float64(1) || last["active"] != float64(0) {
					t.Fatal(last)
				}
				if s["tramo"].(map[string]any)["effective_deadline"] != "2028-01-10" {
					t.Fatal(s)
				}
			} else if !reflect.DeepEqual(s, first) {
				t.Fatal("frozen snapshot changed", s)
			}
		}
	}
	if reassigned != 2 || closed != 2 || !latest {
		t.Fatal(reassigned, closed, latest)
	}
}
