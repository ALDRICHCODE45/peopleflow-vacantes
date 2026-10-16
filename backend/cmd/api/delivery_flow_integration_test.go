//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

const deliveryFlowNull = `{"cutoffStageId":null,"targetQuantity":null,"commitmentDate":null}`

func deliveryFlowBody(t *testing.T, c deliveryconfig.Configuration) string {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func deliveryFlowSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var snapshot string
	if err := h.pool.QueryRow(context.Background(), `SELECT json_build_array(
 (SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
 (SELECT row_to_json(p) FROM job_draft_pipeline_configs p WHERE draft_id=$1),
 (SELECT row_to_json(s) FROM job_draft_substate_catalogs s WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
 (SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}
func assertDeliveryFlowResponse(t *testing.T, r draftFlowResponse, id string, version int64) (deliveryconfig.Configuration, deliveryconfig.Calendar) {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	if r.status != 200 || r.header.Get("ETag") != deliveryconfig.ETag(uuid.MustParse(id), version) || r.header.Get("Idempotency-Replayed") != "" {
		t.Fatalf("response=%d %s %v", r.status, r.body, r.header)
	}
	root := draftFlowObject(t, r.body)
	if len(root) != 6 || root["version"] != fmt.Sprint(version) {
		t.Fatalf("root=%s", r.body)
	}
	for _, key := range []string{"cutoffStageId", "targetQuantity", "commitmentDate", "limits", "calendar"} {
		if _, ok := root[key]; !ok {
			t.Fatalf("missing %s", key)
		}
	}
	if !reflect.DeepEqual(root["limits"], map[string]any{"maxTargetQuantity": float64(999)}) {
		t.Fatalf("limits=%s", r.body)
	}
	calObj, ok := root["calendar"].(map[string]any)
	if !ok || len(calObj) != 5 {
		t.Fatalf("calendar=%s", r.body)
	}
	var env struct {
		deliveryconfig.Configuration
		Calendar deliveryconfig.Calendar `json:"calendar"`
	}
	if err := json.Unmarshal(r.body, &env); err != nil {
		t.Fatal(err)
	}
	cal := env.Calendar
	if cal.TimeZone != deliveryconfig.TimeZone || cal.Today != cal.MinDate {
		t.Fatalf("calendar=%+v", cal)
	}
	min, err := time.Parse(time.DateOnly, cal.MinDate)
	if err != nil {
		t.Fatal(err)
	}
	max, err := time.Parse(time.DateOnly, cal.MaxDate)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cal.NonBusinessDates, businesscalendar.NonBusinessDates(min, max)) {
		t.Fatalf("incomplete/non-ascending exclusions=%+v", cal)
	}
	return env.Configuration, cal
}
func deliveryFlowBusinessDate(t *testing.T, cal deliveryconfig.Calendar) string {
	t.Helper()
	d, err := time.Parse(time.DateOnly, cal.MinDate)
	if err != nil {
		t.Fatal(err)
	}
	for !businesscalendar.IsBusinessDay(d) {
		d = d.AddDate(0, 0, 1)
	}
	return d.Format(time.DateOnly)
}
func TestDeliveryFlow_FirstNullSaveLifecycleNoOpAndFourWayVersionIsolation(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := draftListFlowCreate(t, h, principal, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	path := base + "/pipeline/delivery"
	originals := map[string]draftFlowResponse{}
	for _, suffix := range []string{"", "/pipeline", "/pipeline/substates"} {
		originals[suffix] = h.do(t, "GET", base+suffix, "", owner.token, nil)
	}
	before := deliveryFlowSnapshot(t, h, id)
	first := h.do(t, "GET", path, "", principal.token, nil)
	c, cal := assertDeliveryFlowResponse(t, first, id, 0)
	second := h.do(t, "GET", path, "", owner.token, nil)
	assertDeliveryFlowResponse(t, second, id, 0)
	if !c.Equal(deliveryconfig.Configuration{}) || !bytes.Equal(first.body, second.body) || before != deliveryFlowSnapshot(t, h, id) {
		t.Fatal("GET defaults not pure")
	}
	for _, r := range originals {
		if first.header.Get("ETag") == r.header.Get("ETag") {
			t.Fatal("tag not isolated")
		}
	}
	saved := h.do(t, "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	c, _ = assertDeliveryFlowResponse(t, saved, id, 1)
	if !c.Equal(deliveryconfig.Configuration{}) {
		t.Fatal("first null save")
	}
	before = deliveryFlowSnapshot(t, h, id)
	noop := h.do(t, "PUT", path, deliveryFlowNull, principal.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	assertDeliveryFlowResponse(t, noop, id, 1)
	if !bytes.Equal(saved.body, noop.body) || before != deliveryFlowSnapshot(t, h, id) {
		t.Fatal("no-op wrote data")
	}
	cutoff := pipelineconfig.Defaults(uuid.MustParse(id)).Stages[3].ID
	target := int64(999)
	date := deliveryFlowBusinessDate(t, cal)
	want := deliveryconfig.Configuration{CutoffStageID: &cutoff, TargetQuantity: &target, CommitmentDate: &date}
	configured := h.do(t, "PUT", path, deliveryFlowBody(t, want), principal.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	c, _ = assertDeliveryFlowResponse(t, configured, id, 2)
	if !c.Equal(want) {
		t.Fatalf("configured=%+v want=%+v", c, want)
	}
	for suffix, previous := range originals {
		after := h.do(t, "GET", base+suffix, "", owner.token, nil)
		if after.status != 200 || after.header.Get("ETag") != previous.header.Get("ETag") || !bytes.Equal(after.body, previous.body) {
			t.Fatalf("delivery changed %s", suffix)
		}
	}
	config := pipelineFlowConfig(t, originals["/pipeline"].body)
	config.Stages[3].Name = "Entrega renombrada"
	changes := []struct{ method, suffix, body string }{{"PUT", "/pipeline", pipelineFlowBody(t, config)}, {"PUT", "/pipeline/substates", `{"substates":[{"name":"Uno"}]}`}, {"PATCH", "", `{"fields":{"title":"Independiente"}}`}}
	for _, change := range changes {
		r := h.do(t, change.method, base+change.suffix, change.body, owner.token, map[string]string{"If-Match": originals[change.suffix].header.Get("ETag")})
		if r.status != 200 || r.header.Get("ETag") == originals[change.suffix].header.Get("ETag") {
			t.Fatalf("write %s=%d %s", change.suffix, r.status, r.body)
		}
		after := h.do(t, "GET", path, "", owner.token, nil)
		assertDeliveryFlowResponse(t, after, id, 2)
		if !bytes.Equal(after.body, configured.body) {
			t.Fatalf("%s changed delivery", change.suffix)
		}
	}
	cleared := h.do(t, "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": configured.header.Get("ETag")})
	c, _ = assertDeliveryFlowResponse(t, cleared, id, 3)
	if !c.Equal(deliveryconfig.Configuration{}) {
		t.Fatal("clear did not null every field")
	}
	var count int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftDeliveryConfigured'`, id).Scan(&count); err != nil || count != 3 {
		t.Fatalf("audits=%d err=%v", count, err)
	}
}
func TestDeliveryFlow_RejectedRequestsLeaveEveryPersistedEffectUnchanged(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	nonprincipalID, nonprincipalSub := company.addUser(t, "recruiter")
	nonprincipal := h.actor(t, nonprincipalID, nonprincipalSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/pipeline/delivery"
	first := h.do(t, "GET", path, "", owner.token, nil)
	_, cal := assertDeliveryFlowResponse(t, first, id, 0)
	saved := h.do(t, "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	assertDeliveryFlowResponse(t, saved, id, 1)
	tag := saved.header.Get("ETag")
	headers := map[string]string{"If-Match": tag}
	cases := []struct {
		name, method, path, body, token string
		headers                         map[string]string
		status                          int
		code                            string
	}{
		{"missing header", "PUT", path, deliveryFlowNull, owner.token, nil, 428, "precondition_required"},
		{"empty header", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": ""}, 400, "invalid_request"},
		{"empty quoted header", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": `""`}, 400, "invalid_request"},
		{"weak", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": "W/" + tag}, 400, "invalid_request"},
		{"list", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": tag + "," + tag}, 400, "invalid_request"},
		{"wildcard", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": "*"}, 400, "invalid_request"},
		{"malformed header", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": "bad"}, 400, "invalid_request"},
		{"stale", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": first.header.Get("ETag")}, 412, "version_conflict"},
		{"pipeline tag", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": pipelineconfig.ETag(uuid.MustParse(id), 0)}, 412, "version_conflict"},
		{"substates tag", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": substatecatalog.ETag(uuid.MustParse(id), 0)}, 412, "version_conflict"},
		{"foreign tag", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": `"foreign"`}, 412, "version_conflict"},
		{"bad path", "GET", draftFlowV2Path + "/bad/pipeline/delivery", "", owner.token, nil, 400, "invalid_request"},
		{"malformed json", "PUT", path, `{"`, owner.token, headers, 400, "invalid_request"},
		{"trailing json", "PUT", path, deliveryFlowNull + `{}`, owner.token, headers, 400, "invalid_request"},
		{"missing keys", "PUT", path, `{}`, owner.token, headers, 400, "invalid_request"},
		{"unknown key", "PUT", path, strings.TrimSuffix(deliveryFlowNull, "}") + `,"calendar":{}}`, owner.token, headers, 400, "invalid_request"},
		{"duplicate escaped key", "PUT", path, strings.TrimSuffix(deliveryFlowNull, "}") + `,"commitment\u0044ate":null}`, owner.token, headers, 400, "invalid_request"},
		{"cutoff type", "PUT", path, strings.Replace(deliveryFlowNull, `"cutoffStageId":null`, `"cutoffStageId":false`, 1), owner.token, headers, 400, "invalid_request"},
		{"target string", "PUT", path, strings.Replace(deliveryFlowNull, `"targetQuantity":null`, `"targetQuantity":"5"`, 1), owner.token, headers, 400, "invalid_request"},
		{"fraction", "PUT", path, strings.Replace(deliveryFlowNull, `"targetQuantity":null`, `"targetQuantity":1.5`, 1), owner.token, headers, 400, "invalid_request"},
		{"date type", "PUT", path, strings.Replace(deliveryFlowNull, `"commitmentDate":null`, `"commitmentDate":1`, 1), owner.token, headers, 400, "invalid_request"},
		{"malformed date", "PUT", path, strings.Replace(deliveryFlowNull, `"commitmentDate":null`, `"commitmentDate":"2026-02-30"`, 1), owner.token, headers, 400, "invalid_request"},
		{"invalid utf8", "PUT", path, strings.Replace(deliveryFlowNull, `"commitmentDate":null`, `"commitmentDate":"`+string([]byte{0xff})+`"`, 1), owner.token, headers, 400, "invalid_request"},
		{"invalid surrogate", "PUT", path, strings.Replace(deliveryFlowNull, `"commitmentDate":null`, `"commitmentDate":"\uD800"`, 1), owner.token, headers, 400, "invalid_request"},
		{"unknown cutoff", "PUT", path, strings.Replace(deliveryFlowNull, `"cutoffStageId":null`, `"cutoffStageId":"`+uuid.NewString()+`"`, 1), owner.token, headers, 400, "validation_error"},
		{"discarded cutoff", "PUT", path, strings.Replace(deliveryFlowNull, `"cutoffStageId":null`, `"cutoffStageId":"`+pipelineconfig.Defaults(uuid.MustParse(id)).Exit.ID+`"`, 1), owner.token, headers, 400, "validation_error"},
		{"zero target", "PUT", path, strings.Replace(deliveryFlowNull, `"targetQuantity":null`, `"targetQuantity":0`, 1), owner.token, headers, 400, "validation_error"},
		{"over max target", "PUT", path, strings.Replace(deliveryFlowNull, `"targetQuantity":null`, `"targetQuantity":1000`, 1), owner.token, headers, 400, "validation_error"},
		{"oversized", "PUT", path, strings.Repeat("x", 1048577), owner.token, headers, 413, "payload_too_large"},
		{"anonymous", "GET", path, "", "", nil, 401, "unauthenticated"},
		{"invalid token", "PUT", path, deliveryFlowNull, "invalid", nil, 401, "unauthenticated"},
		{"nonprincipal get", "GET", path, "", nonprincipal.token, nil, 404, "not_found"},
		{"nonprincipal precedence", "PUT", path, `broken`, nonprincipal.token, nil, 404, "not_found"},
		{"foreign get", "GET", path, "", foreign.token, nil, 404, "not_found"},
		{"foreign precedence", "PUT", path, `broken`, foreign.token, nil, 404, "not_found"},
		{"missing get", "GET", draftFlowV2Path + "/" + uuid.NewString() + "/pipeline/delivery", "", owner.token, nil, 404, "not_found"},
		{"missing precedence", "PUT", draftFlowV2Path + "/" + uuid.NewString() + "/pipeline/delivery", `broken`, owner.token, nil, 404, "not_found"},
	}
	min, err := time.Parse(time.DateOnly, cal.MinDate)
	if err != nil {
		t.Fatal(err)
	}
	max, err := time.Parse(time.DateOnly, cal.MaxDate)
	if err != nil {
		t.Fatal(err)
	}
	for name, date := range map[string]string{"before window": min.AddDate(0, 0, -1).Format(time.DateOnly), "after window": max.AddDate(0, 0, 1).Format(time.DateOnly), "non-business": cal.NonBusinessDates[0]} {
		code := "validation_error"
		if name == "non-business" {
			code = "non_business_date"
		}
		cases = append(cases, struct {
			name, method, path, body, token string
			headers                         map[string]string
			status                          int
			code                            string
		}{name, "PUT", path, strings.Replace(deliveryFlowNull, `"commitmentDate":null`, `"commitmentDate":"`+date+`"`, 1), owner.token, headers, 400, code})
	}
	draft := h.do(t, "GET", draftFlowV2Path+"/"+id, "", owner.token, nil)
	cases = append(cases, struct {
		name, method, path, body, token string
		headers                         map[string]string
		status                          int
		code                            string
	}{"draft tag", "PUT", path, deliveryFlowNull, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")}, 412, "version_conflict"})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := deliveryFlowSnapshot(t, h, id)
			r := h.do(t, tc.method, tc.path, tc.body, tc.token, tc.headers)
			draftFlowAssertCatalogError(t, r, tc.status, tc.code)
			draftFlowAssertNoStore(t, r)
			obj := draftFlowObject(t, r.body)
			if len(obj) != 2 || obj["error"] == "" || obj["code"] != tc.code || r.header.Get("ETag") != "" || r.header.Get("Idempotency-Replayed") != "" || before != deliveryFlowSnapshot(t, h, id) {
				t.Fatalf("rejection=%d %s %v", r.status, r.body, r.header)
			}
		})
	}
}
func TestDeliveryFlow_PipelineCutoffConflictIsAtomicRenameAndReorderAllowed(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id + "/pipeline"
	initial := h.do(t, "GET", base, "", owner.token, nil)
	config := pipelineFlowConfig(t, initial.body)
	// Add an id-less custom stage in a valid progression position.
	body := pipelineFlowBody(t, config)
	var write map[string]any
	if err := json.Unmarshal([]byte(body), &write); err != nil {
		t.Fatal(err)
	}
	entries := write["stages"].([]any)
	newEntries := []any{entries[0], map[string]any{"name": "Prueba"}}
	newEntries = append(newEntries, entries[1:]...)
	write["stages"] = newEntries
	raw, err := json.Marshal(write)
	if err != nil {
		t.Fatal(err)
	}
	saved := h.do(t, "PUT", base, string(raw), owner.token, map[string]string{"If-Match": initial.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatalf("custom stage=%d %s", saved.status, saved.body)
	}
	custom := pipelineFlowConfig(t, saved.body)
	cutoff := custom.Stages[1].ID
	delivery := h.do(t, "PUT", base+"/delivery", deliveryFlowBody(t, deliveryconfig.Configuration{CutoffStageID: &cutoff}), owner.token, map[string]string{"If-Match": deliveryconfig.ETag(uuid.MustParse(id), 0)})
	assertDeliveryFlowResponse(t, delivery, id, 1)
	before := deliveryFlowSnapshot(t, h, id)
	rejected := h.do(t, "PUT", base, pipelineFlowBody(t, config), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	draftFlowAssertCatalogError(t, rejected, 409, "cutoff_stage_in_use")
	draftFlowAssertNoStore(t, rejected)
	if obj := draftFlowObject(t, rejected.body); len(obj) != 2 || obj["error"] == "" || rejected.header.Get("ETag") != "" || before != deliveryFlowSnapshot(t, h, id) {
		t.Fatalf("cutoff rejection=%d %s", rejected.status, rejected.body)
	}
	custom.Stages[1].Name = "Prueba renombrada"
	custom.Stages[1], custom.Stages[2] = custom.Stages[2], custom.Stages[1]
	renamed := h.do(t, "PUT", base, pipelineFlowBody(t, custom), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	if renamed.status != 200 || renamed.header.Get("ETag") != pipelineconfig.ETag(uuid.MustParse(id), 2) {
		t.Fatalf("rename/reorder=%d %s", renamed.status, renamed.body)
	}
	after := h.do(t, "GET", base+"/delivery", "", owner.token, nil)
	assertDeliveryFlowResponse(t, after, id, 1)
	if !bytes.Equal(after.body, delivery.body) {
		t.Fatal("rename/reorder changed delivery")
	}
}
