//go:build integration

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/profile"
	"github.com/google/uuid"
)

func profileHarness(t *testing.T) *draftFlowHarness {
	t.Helper()
	if testing.Short() {
		t.Skip("isolated profile database")
	}
	return newDraftFlowHarness(t)
}

func profileBody(t *testing.T) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(profile.Empty())
	m := draftFlowObject(t, raw)
	delete(m, "confirmed_at")
	return m
}
func profileEncode(t *testing.T, m map[string]any) string {
	t.Helper()
	b, e := json.Marshal(m)
	if e != nil {
		t.Fatal(e)
	}
	return string(b)
}
func profileEntry(m map[string]any) map[string]any {
	return m["competencies"].([]any)[0].(map[string]any)
}
func profileConfirm(m map[string]any) {
	m["confirmed"] = true
	for _, x := range m["competencies"].([]any) {
		c := x.(map[string]any)
		if c["importance"] == "importance.clave" || c["importance"] == "importance.importante" {
			c["rationale"] = "Trabajo"
		}
	}
}
func profileAssert(t *testing.T, r draftFlowResponse, id string, version int64) map[string]any {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	m := draftFlowObject(t, r.body)
	if r.status != 200 || len(m) != 8 || m["version"] != fmt.Sprint(version) || r.header.Get("ETag") != profile.ETag(uuid.MustParse(id), version) {
		t.Fatalf("profile=%d %s %v", r.status, r.body, r.header)
	}
	return m
}
func profileSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var raw string
	err := h.pool.QueryRow(context.Background(), `SELECT json_build_array((SELECT row_to_json(p) FROM job_draft_psychometric_profiles p WHERE draft_id=$1),(SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestPsychometricProfileFlowDefaultsPreconditionsAndIsolation(t *testing.T) {
	h := profileHarness(t)
	company, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	otherID, otherSub := company.addUser(t, "recruiter")
	other := h.actor(t, otherID, otherSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/psychometric-profile"
	first := h.do(t, "GET", path, "", owner.token, nil)
	got := profileAssert(t, first, id, 0)
	expected := profileBody(t)
	expected["version"] = "0"
	expected["confirmed_at"] = nil
	if !reflect.DeepEqual(got, expected) {
		t.Fatalf("defaults=%s", first.body)
	}
	before := profileSnapshot(t, h, id)
	profileAssert(t, h.do(t, "GET", path, "", owner.token, nil), id, 0)
	if before != profileSnapshot(t, h, id) {
		t.Fatal("GET writes")
	}
	// An identical replacement of never-saved defaults is also a no-op.
	profileAssert(t, h.do(t, "PUT", path, profileEncode(t, profileBody(t)), owner.token, map[string]string{"If-Match": first.header.Get("ETag")}), id, 0)
	if before != profileSnapshot(t, h, id) {
		t.Fatal("default PUT materialized storage/audit")
	}
	body := profileBody(t)
	body["enabled"] = true
	raw := profileEncode(t, body)
	for _, tc := range []struct {
		name, tag string
		present   bool
		status    int
		code      string
	}{
		{"missing", "", false, 428, "precondition_required"}, {"stale", `"old"`, true, 412, "version_conflict"}, {"malformed", "bad", true, 400, "invalid_request"}, {"empty", "", true, 400, "invalid_request"}, {"weak", "W/" + first.header.Get("ETag"), true, 400, "invalid_request"}, {"wildcard", "*", true, 400, "invalid_request"}, {"list", first.header.Get("ETag") + "," + first.header.Get("ETag"), true, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var headers map[string]string
			if tc.present {
				headers = map[string]string{"If-Match": tc.tag}
			}
			r := h.do(t, "PUT", path, raw, owner.token, headers)
			draftFlowAssertCatalogError(t, r, tc.status, tc.code)
			if before != profileSnapshot(t, h, id) {
				t.Fatal("rejection changed profile/version/audit")
			}
		})
	}
	for _, actor := range []draftFlowActor{other, foreign} {
		for _, method := range []string{"GET", "PUT"} {
			draftFlowAssertCatalogError(t, h.do(t, method, path, raw, actor.token, nil), 404, "not_found")
			if before != profileSnapshot(t, h, id) {
				t.Fatal("foreign access writes")
			}
		}
	}
	unknown := strings.Replace(path, id, uuid.NewString(), 1)
	draftFlowAssertCatalogError(t, h.do(t, "GET", unknown, "", owner.token, nil), 404, "not_found")
	saved := h.do(t, "PUT", path, raw, owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	profileAssert(t, saved, id, 1)
	var count int
	var audit []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftPsychometricProfileConfigured'`, id).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftPsychometricProfileConfigured'`, id).Scan(&audit); err != nil {
		t.Fatal(err)
	}
	var meta map[string]string
	if err := json.Unmarshal(audit, &meta); err != nil {
		t.Fatal(err)
	}
	prev := draftFlowObject(t, []byte(meta["previous"]))
	next := draftFlowObject(t, []byte(meta["new"]))
	delete(expected, "version")
	expectedNext := profileBody(t)
	expectedNext["enabled"] = true
	expectedNext["confirmed_at"] = nil
	if meta["version"] != "1" || !reflect.DeepEqual(prev, expected) || !reflect.DeepEqual(next, expectedNext) {
		t.Fatal(string(audit))
	}
	before = profileSnapshot(t, h, id)
	profileAssert(t, h.do(t, "PUT", path, raw, owner.token, map[string]string{"If-Match": saved.header.Get("ETag")}), id, 1)
	if before != profileSnapshot(t, h, id) {
		t.Fatal("identical PUT changed profile/version/audit")
	}
	// Shared authorization and pipeline context remain read-only for checklist.
	checklistBefore := checklistFlowSnapshot(t, h, id)
	checklistFlowAssert(t, h.do(t, "GET", draftFlowV2Path+"/"+id+"/checklist", "", owner.token, nil), id, 0)
	if checklistBefore != checklistFlowSnapshot(t, h, id) {
		t.Fatal("checklist behavior changed")
	}
}

func TestPsychometricProfileFlowValidation(t *testing.T) {
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	path := base + "/psychometric-profile"
	initial := h.do(t, "GET", path, "", owner.token, nil)
	tag := initial.header.Get("ETag")
	pipeline := pipelineFlowConfig(t, h.do(t, "GET", base+"/pipeline", "", owner.token, nil).body)
	stage := pipeline.Stages[0].ID
	cases := []struct {
		name, field, code string
		mutate            func(map[string]any)
	}{
		{"required enabled", "enabled", "required", func(m map[string]any) { delete(m, "enabled") }},
		{"required test", "test", "required", func(m map[string]any) { delete(m, "test") }},
		{"required confirmed", "confirmed", "required", func(m map[string]any) { delete(m, "confirmed") }},
		{"required competencies", "competencies", "required", func(m map[string]any) { delete(m, "competencies") }},
		{"required stages", "auto_send_stage_ids", "required", func(m map[string]any) { delete(m, "auto_send_stage_ids") }},
		{"required expiry", "expires_in_days", "required", func(m map[string]any) { delete(m, "expires_in_days") }},
		{"unknown key", "extra", "not_allowed", func(m map[string]any) { m["extra"] = true }},
		{"version readonly", "version", "not_allowed", func(m map[string]any) { m["version"] = "0" }},
		{"timestamp readonly", "confirmed_at", "not_allowed", func(m map[string]any) { m["confirmed_at"] = nil }},
		{"test id", "test", "invalid", func(m map[string]any) { m["test"] = "other" }},
		{"missing id", "competencies", "required", func(m map[string]any) { m["competencies"] = m["competencies"].([]any)[:6] }},
		{"duplicate id", "competencies[6].competency_id", "duplicate", func(m map[string]any) {
			cs := m["competencies"].([]any)
			cs[6].(map[string]any)["competency_id"] = cs[0].(map[string]any)["competency_id"]
		}},
		{"unknown id", "competencies[0].competency_id", "invalid", func(m map[string]any) { profileEntry(m)["competency_id"] = "comp.unknown" }},
		{"importance canonical", "competencies[0].importance", "invalid", func(m map[string]any) { profileEntry(m)["importance"] = "clave" }},
		{"no relevance band", "competencies[0].desired_band", "not_allowed", func(m map[string]any) { profileEntry(m)["desired_band"] = "band.high" }},
		{"relevant needs band", "competencies[0].desired_band", "required", func(m map[string]any) {
			profileEntry(m)["importance"] = "importance.importante"
			profileEntry(m)["rationale"] = ""
		}},
		{"canonical band", "competencies[0].desired_band", "invalid", func(m map[string]any) {
			profileEntry(m)["importance"] = "importance.clave"
			profileEntry(m)["desired_band"] = "high"
			profileEntry(m)["rationale"] = ""
		}},
		{"trimmed rationale", "competencies[0].rationale", "required", func(m map[string]any) {
			profileEntry(m)["importance"] = "importance.importante"
			profileEntry(m)["desired_band"] = "band.low"
			profileConfirm(m)
			profileEntry(m)["rationale"] = " "
		}},
		{"long rationale", "competencies[0].rationale", "too_long", func(m map[string]any) {
			profileEntry(m)["importance"] = "importance.importante"
			profileEntry(m)["desired_band"] = "band.low"
			profileEntry(m)["rationale"] = strings.Repeat("á", 1001)
		}},
		{"key task", "competencies[0].task", "required", func(m map[string]any) {
			profileEntry(m)["importance"] = "importance.clave"
			profileEntry(m)["desired_band"] = "band.high"
			profileConfirm(m)
		}},
		{"long task", "competencies[0].task", "too_long", func(m map[string]any) {
			profileEntry(m)["importance"] = "importance.clave"
			profileEntry(m)["desired_band"] = "band.low"
			profileEntry(m)["rationale"] = ""
			profileEntry(m)["task"] = strings.Repeat("ñ", 301)
		}},
		{"irrelevant supplied task", "competencies[0].task", "not_allowed", func(m map[string]any) { profileConfirm(m); profileEntry(m)["task"] = " " }},
		{"entry exact keys", "competencies[0].extra", "not_allowed", func(m map[string]any) { profileEntry(m)["extra"] = 1 }},
		{"expiry low", "expires_in_days", "invalid", func(m map[string]any) { m["expires_in_days"] = 0 }},
		{"expiry high", "expires_in_days", "invalid", func(m map[string]any) { m["expires_in_days"] = 31 }},
		{"expiry fraction", "expires_in_days", "invalid", func(m map[string]any) { m["expires_in_days"] = 1.5 }},
		{"stage unknown", "auto_send_stage_ids[0]", "invalid", func(m map[string]any) { m["auto_send_stage_ids"] = []string{uuid.NewString()} }},
		{"stage exit", "auto_send_stage_ids[0]", "invalid", func(m map[string]any) { m["auto_send_stage_ids"] = []string{pipeline.Exit.ID} }},
		{"stage duplicate", "auto_send_stage_ids[1]", "duplicate", func(m map[string]any) { m["auto_send_stage_ids"] = []string{stage, stage} }},
	}
	before := profileSnapshot(t, h, id)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := profileBody(t)
			tc.mutate(m)
			r := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
			draftFlowAssertNoStore(t, r)
			obj := draftFlowObject(t, r.body)
			want := []any{map[string]any{"field": tc.field, "code": tc.code}}
			if r.status != 400 || len(obj) != 3 || obj["code"] != "validation_error" || obj["error"] != "validation failed" || !reflect.DeepEqual(obj["fields"], want) {
				t.Fatalf("%d %s want=%v", r.status, r.body, want)
			}
			if before != profileSnapshot(t, h, id) {
				t.Fatal("rejected write changed stored data/version/audit")
			}
		})
	}
	for _, raw := range []string{`null`, `[]`, `{} {}`, `{"enabled":true,"enabled":false}`} {
		draftFlowAssertCatalogError(t, h.do(t, "PUT", path, raw, owner.token, map[string]string{"If-Match": tag}), 400, "invalid_request")
		if before != profileSnapshot(t, h, id) {
			t.Fatal("malformed body writes")
		}
	}
}

func TestPsychometricProfileFlowConfirmationReplacementAndBounds(t *testing.T) {
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/psychometric-profile"
	tag := profile.ETag(uuid.MustParse(id), 0)
	put := func(m map[string]any, v int64) map[string]any {
		t.Helper()
		r := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": tag})
		got := profileAssert(t, r, id, v)
		tag = r.header.Get("ETag")
		return got
	}
	m := profileBody(t)
	profileEntry(m)["importance"] = "importance.clave"
	profileEntry(m)["desired_band"] = "band.low"
	profileEntry(m)["rationale"] = ""
	profileEntry(m)["task"] = " "
	m["expires_in_days"] = 1
	got := put(m, 1)
	if got["confirmed_at"] != nil || got["confirmed"] != false {
		t.Fatal(got)
	}
	profileConfirm(m)
	profileEntry(m)["rationale"] = " " + strings.Repeat("á", 1000) + " "
	profileEntry(m)["task"] = " " + strings.Repeat("ñ", 300) + " "
	m["expires_in_days"] = 30
	got = put(m, 2)
	at := got["confirmed_at"]
	if stamp, ok := at.(string); !ok {
		t.Fatal("missing confirmation timestamp")
	} else if _, err := time.Parse(time.RFC3339Nano, stamp); err != nil {
		t.Fatal(err)
	}
	if at == nil || got["confirmed"] != true || got["enabled"] != false || len([]rune(profileEntry(got)["rationale"].(string))) != 1000 || len([]rune(profileEntry(got)["task"].(string))) != 300 {
		t.Fatal(got)
	}
	before := profileSnapshot(t, h, id)
	put(m, 2)
	if before != profileSnapshot(t, h, id) {
		t.Fatal("confirmed no-op writes")
	}
	m["enabled"] = true
	got = put(m, 3)
	if got["confirmed_at"] != at {
		t.Fatal("non-requirement edit reconfirms")
	}
	profileEntry(m)["desired_band"] = "band.medium"
	got = put(m, 4)
	if got["confirmed_at"] == nil || got["confirmed_at"] == at || got["confirmed"] != true {
		t.Fatal("explicit reconfirmation lost")
	}
	m["confirmed"] = false
	profileEntry(m)["desired_band"] = "band.high"
	got = put(m, 5)
	if got["confirmed_at"] != nil || got["confirmed"] != false {
		t.Fatal("requirements edit retained confirmation")
	}
	// Full replacement resets every client-owned field, independently of enabled.
	got = put(profileBody(t), 6)
	if !reflect.DeepEqual(profileEntry(got), profileEntry(profileBody(t))) || got["enabled"] != false || got["expires_in_days"] != float64(7) {
		t.Fatal(got)
	}
}

func TestPsychometricProfileFlowRetiredStagesAndLifecycle(t *testing.T) {
	h := profileHarness(t)
	_, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, uid, sub)
	id := publicationFlowReady(t, h, owner)
	base := draftFlowV2Path + "/" + id
	path := base + "/psychometric-profile"
	pipeline := h.do(t, "GET", base+"/pipeline", "", owner.token, nil)
	config := pipelineFlowConfig(t, pipeline.body)
	config.Stages = append(config.Stages[:4], append([]pipelineconfig.Stage{{Name: "Review"}}, config.Stages[4:]...)...)
	added := h.do(t, "PUT", base+"/pipeline", strings.ReplaceAll(pipelineFlowBody(t, config), `"id":"",`, ""), owner.token, map[string]string{"If-Match": pipeline.header.Get("ETag")})
	if added.status != 200 {
		t.Fatal(added.status, string(added.body))
	}
	config = pipelineFlowConfig(t, added.body)
	stage := config.Stages[4].ID
	m := profileBody(t)
	m["auto_send_stage_ids"] = []string{stage}
	saved := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": profile.ETag(uuid.MustParse(id), 0)})
	profileAssert(t, saved, id, 1)
	config.Stages = append(config.Stages[:4], config.Stages[5:]...)
	removed := h.do(t, "PUT", base+"/pipeline", pipelineFlowBody(t, config), owner.token, map[string]string{"If-Match": added.header.Get("ETag")})
	if removed.status != 200 {
		t.Fatal(removed.status, string(removed.body))
	}
	before := profileSnapshot(t, h, id)
	got := profileAssert(t, h.do(t, "GET", path, "", owner.token, nil), id, 1)
	if len(got["auto_send_stage_ids"].([]any)) != 0 || before != profileSnapshot(t, h, id) {
		t.Fatal("retired stage visible or GET writes")
	}
	bad := h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	draftFlowAssertCatalogError(t, bad, 400, "validation_error")
	if before != profileSnapshot(t, h, id) {
		t.Fatal("retired write changed state")
	}
	publicFlowPublish(t, h, id, owner)
	m["auto_send_stage_ids"] = []string{}
	saved = h.do(t, "PUT", path, profileEncode(t, m), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	profileAssert(t, saved, id, 2)
	current := h.do(t, "GET", base+"/lifecycle", "", owner.token, nil)
	closed := h.do(t, "POST", base+"/lifecycle/close", `{"process":"finish","reason":"cancelled","reason_note":null}`, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if closed.status != 200 {
		t.Fatal(closed.status, string(closed.body))
	}
	before = profileSnapshot(t, h, id)
	draftFlowAssertCatalogError(t, h.do(t, "PUT", path, `{}`, owner.token, nil), 409, "process_finished")
	profileAssert(t, h.do(t, "GET", path, "", owner.token, nil), id, 2)
	if before != profileSnapshot(t, h, id) {
		t.Fatal("finished writes changed data/version/audit")
	}
}
