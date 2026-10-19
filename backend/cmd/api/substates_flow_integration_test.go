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

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func substatesFlowBody(t *testing.T, c substatecatalog.Catalog) string {
	t.Helper()
	raw, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func substatesFlowCatalog(t *testing.T, raw []byte) substatecatalog.Catalog {
	t.Helper()
	var c substatecatalog.Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func substatesFlowSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var snapshot string
	if err := h.pool.QueryRow(context.Background(), `SELECT json_build_array(
  (SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
  (SELECT row_to_json(p) FROM job_draft_pipeline_configs p WHERE draft_id=$1),
  (SELECT row_to_json(s) FROM job_draft_substate_catalogs s WHERE draft_id=$1),
  (SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func assertSubstatesFlowResponse(t *testing.T, response draftFlowResponse, id string, version int64) substatecatalog.Catalog {
	t.Helper()
	draftFlowAssertNoStore(t, response)
	if response.status != 200 || response.header.Get("ETag") != substatecatalog.ETag(uuid.MustParse(id), version) || response.header.Get("Idempotency-Replayed") != "" {
		t.Fatalf("success=%d %s headers=%v", response.status, response.body, response.header)
	}
	obj := draftFlowObject(t, response.body)
	if len(obj) != 4 || obj["version"] != fmt.Sprint(version) {
		t.Fatalf("root=%s", response.body)
	}
	limits, ok := obj["limits"].(map[string]any)
	if !ok || !reflect.DeepEqual(limits, map[string]any{"maxSubstates": float64(50), "nameMaxLength": float64(40)}) {
		t.Fatalf("limits=%s", response.body)
	}
	suggestions, ok := obj["suggestions"].([]any)
	wantSuggestions := substatecatalog.Suggestions()
	if !ok || len(suggestions) != len(wantSuggestions) {
		t.Fatalf("suggestions=%s", response.body)
	}
	for i, want := range wantSuggestions {
		if suggestions[i] != want {
			t.Fatalf("suggestions=%s", response.body)
		}
	}
	entries, ok := obj["substates"].([]any)
	if !ok {
		t.Fatalf("substates must be an array: %s", response.body)
	}
	c := substatesFlowCatalog(t, response.body)
	for i, raw := range entries {
		entry, ok := raw.(map[string]any)
		if !ok || len(entry) != 3 || entry["id"] != c.Substates[i].ID || entry["name"] != c.Substates[i].Name || entry["in_use"] != false {
			t.Fatalf("entry=%+v", entry)
		}
		if parsed, err := uuid.Parse(c.Substates[i].ID); err != nil || parsed == uuid.Nil {
			t.Fatalf("id=%s", c.Substates[i].ID)
		}
	}
	return c
}

func TestSubstatesFlow_EmptyFirstSaveLifecycleNoOpAndVersionIsolation(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := draftListFlowCreate(t, h, principal, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/pipeline/substates"
	draftBefore := h.do(t, "GET", draftFlowV2Path+"/"+id, "", owner.token, nil)
	pipelineBefore := h.do(t, "GET", draftFlowV2Path+"/"+id+"/pipeline", "", owner.token, nil)
	before := substatesFlowSnapshot(t, h, id)
	first := h.do(t, "GET", path, "", principal.token, nil)
	second := h.do(t, "GET", path, "", owner.token, nil)
	if c := assertSubstatesFlowResponse(t, first, id, 0); !c.Equal(substatecatalog.Empty()) {
		t.Fatalf("initial catalog=%+v", c)
	}
	assertSubstatesFlowResponse(t, second, id, 0)
	if !bytes.Equal(first.body, second.body) || first.header.Get("ETag") == draftBefore.header.Get("ETag") || first.header.Get("ETag") == pipelineBefore.header.Get("ETag") || before != substatesFlowSnapshot(t, h, id) {
		t.Fatal("GET wrote data or tags are not independent")
	}
	empty := h.do(t, "PUT", path, `{"substates":[]}`, owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	if c := assertSubstatesFlowResponse(t, empty, id, 1); !c.Equal(substatecatalog.Empty()) {
		t.Fatalf("empty first save=%+v", c)
	}
	before = substatesFlowSnapshot(t, h, id)
	emptyNoop := h.do(t, "PUT", path, `{"substates":[]}`, principal.token, map[string]string{"If-Match": empty.header.Get("ETag")})
	assertSubstatesFlowResponse(t, emptyNoop, id, 1)
	if !bytes.Equal(emptyNoop.body, empty.body) || before != substatesFlowSnapshot(t, h, id) {
		t.Fatal("empty stored no-op wrote data")
	}
	saved := h.do(t, "PUT", path, `{"substates":[{"name":"  Primera\u00a0entrevista "},{"name":"En proceso"},{"name":"A\u0301rea"},{"name":"Area"}]}`, principal.token, map[string]string{"If-Match": empty.header.Get("ETag")})
	c := assertSubstatesFlowResponse(t, saved, id, 2)
	wantNames := []string{"Primera entrevista", "En proceso", "Área", "Area"}
	if len(c.Substates) != len(wantNames) {
		t.Fatalf("catalog=%+v", c)
	}
	for i, s := range c.Substates {
		if s.Name != wantNames[i] || uuid.MustParse(s.ID).Version() != 4 {
			t.Fatalf("request order/server id=%+v", c)
		}
	}
	c.Substates[0], c.Substates[1] = c.Substates[1], c.Substates[0]
	c.Substates[1].Name = "Segunda entrevista"
	reordered := h.do(t, "PUT", path, substatesFlowBody(t, c), owner.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	if got := assertSubstatesFlowResponse(t, reordered, id, 3); !got.Equal(c) {
		t.Fatalf("reorder/rename=%+v want=%+v", got, c)
	}
	before = substatesFlowSnapshot(t, h, id)
	c.Substates[1].Name = " \tSegunda\u00a0entrevista "
	noop := h.do(t, "PUT", path, substatesFlowBody(t, c), principal.token, map[string]string{"If-Match": reordered.header.Get("ETag")})
	assertSubstatesFlowResponse(t, noop, id, 3)
	if !bytes.Equal(noop.body, reordered.body) || before != substatesFlowSnapshot(t, h, id) {
		t.Fatal("normalized no-op changed storage")
	}
	for _, check := range []struct {
		path     string
		previous draftFlowResponse
	}{{draftFlowV2Path + "/" + id, draftBefore}, {draftFlowV2Path + "/" + id + "/pipeline", pipelineBefore}} {
		after := h.do(t, "GET", check.path, "", owner.token, nil)
		if after.status != 200 || after.header.Get("ETag") != check.previous.header.Get("ETag") || !bytes.Equal(after.body, check.previous.body) {
			t.Fatal("substates PUT changed draft/pipeline")
		}
	}
	config := pipelineFlowConfig(t, pipelineBefore.body)
	config.Stages[3].Name = "Entrevistas renombradas"
	pipelineSave := h.do(t, "PUT", draftFlowV2Path+"/"+id+"/pipeline", pipelineFlowBody(t, config), owner.token, map[string]string{"If-Match": pipelineBefore.header.Get("ETag")})
	if pipelineSave.status != 200 || pipelineSave.header.Get("ETag") == pipelineBefore.header.Get("ETag") {
		t.Fatalf("pipeline save=%d %s", pipelineSave.status, pipelineSave.body)
	}
	afterPipeline := h.do(t, "GET", path, "", owner.token, nil)
	assertSubstatesFlowResponse(t, afterPipeline, id, 3)
	if !bytes.Equal(afterPipeline.body, reordered.body) {
		t.Fatal("pipeline PUT changed substate version/body")
	}
	patch := h.do(t, "PATCH", draftFlowV2Path+"/"+id, `{"fields":{"title":"Independiente"}}`, principal.token, map[string]string{"If-Match": draftBefore.header.Get("ETag")})
	if patch.status != 200 || patch.header.Get("ETag") == draftBefore.header.Get("ETag") {
		t.Fatalf("draft patch=%d %s", patch.status, patch.body)
	}
	afterPatch := h.do(t, "GET", path, "", principal.token, nil)
	assertSubstatesFlowResponse(t, afterPatch, id, 3)
	if !bytes.Equal(afterPatch.body, reordered.body) {
		t.Fatal("draft PATCH changed substate version/body")
	}
	removed := h.do(t, "PUT", path, `{"substates":[]}`, owner.token, map[string]string{"If-Match": reordered.header.Get("ETag")})
	if got := assertSubstatesFlowResponse(t, removed, id, 4); !got.Equal(substatecatalog.Empty()) {
		t.Fatalf("removal=%+v", got)
	}
	var count int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftSubstatesConfigured'`, id).Scan(&count); err != nil || count != 4 {
		t.Fatalf("audit count=%d err=%v", count, err)
	}
}

func TestSubstatesFlow_RejectedRequestsLeaveEveryPersistedEffectUnchanged(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	nonprincipalID, nonprincipalSub := company.addUser(t, "recruiter")
	nonprincipal := h.actor(t, nonprincipalID, nonprincipalSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/pipeline/substates"
	saved := h.do(t, "PUT", path, `{"substates":[{"name":"Uno"},{"name":"Dos"}]}`, owner.token, map[string]string{"If-Match": substatecatalog.ETag(uuid.MustParse(id), 0)})
	c := assertSubstatesFlowResponse(t, saved, id, 1)
	body := substatesFlowBody(t, c)
	tag := saved.header.Get("ETag")
	headers := map[string]string{"If-Match": tag}
	type rejection struct {
		name, method, path, body, token string
		headers                         map[string]string
		status                          int
		code                            string
	}
	cases := []rejection{
		{"missing header", "PUT", path, body, owner.token, nil, 428, "precondition_required"},
		{"empty header", "PUT", path, body, owner.token, map[string]string{"If-Match": ""}, 400, "invalid_request"},
		{"empty quoted header", "PUT", path, body, owner.token, map[string]string{"If-Match": `""`}, 400, "invalid_request"},
		{"weak header", "PUT", path, body, owner.token, map[string]string{"If-Match": "W/" + tag}, 400, "invalid_request"},
		{"list header", "PUT", path, body, owner.token, map[string]string{"If-Match": tag + "," + tag}, 400, "invalid_request"},
		{"wildcard header", "PUT", path, body, owner.token, map[string]string{"If-Match": "*"}, 400, "invalid_request"},
		{"malformed header", "PUT", path, body, owner.token, map[string]string{"If-Match": "bad"}, 400, "invalid_request"},
		{"stale", "PUT", path, body, owner.token, map[string]string{"If-Match": substatecatalog.ETag(uuid.MustParse(id), 0)}, 412, "version_conflict"},
		{"pipeline tag", "PUT", path, body, owner.token, map[string]string{"If-Match": pipelineconfig.ETag(uuid.MustParse(id), 0)}, 412, "version_conflict"},
		{"foreign tag", "PUT", path, body, owner.token, map[string]string{"If-Match": `"foreign"`}, 412, "version_conflict"},
		{"malformed path", "GET", draftFlowV2Path + "/bad/pipeline/substates", "", owner.token, nil, 400, "invalid_request"},
		{"malformed json", "PUT", path, `{"`, owner.token, headers, 400, "invalid_request"},
		{"trailing json", "PUT", path, body + `{}`, owner.token, headers, 400, "invalid_request"},
		{"unknown root", "PUT", path, `{"substates":[],"extra":1}`, owner.token, headers, 400, "invalid_request"},
		{"unknown nested", "PUT", path, `{"substates":[{"name":"Uno","kind":"in_process"}]}`, owner.token, headers, 400, "invalid_request"},
		{"duplicate root", "PUT", path, `{"substates":[],"sub\u0073tates":[]}`, owner.token, headers, 400, "invalid_request"},
		{"duplicate nested", "PUT", path, `{"substates":[{"name":"Uno","na\u006de":"Dos"}]}`, owner.token, headers, 400, "invalid_request"},
		{"invalid utf8", "PUT", path, strings.Replace(body, "Uno", string([]byte{0xff}), 1), owner.token, headers, 400, "invalid_request"},
		{"invalid surrogate", "PUT", path, `{"substates":[{"name":"\uD800"}]}`, owner.token, headers, 400, "invalid_request"},
		{"null list", "PUT", path, `{"substates":null}`, owner.token, headers, 400, "invalid_request"},
		{"unknown id", "PUT", path, strings.Replace(body, c.Substates[0].ID, uuid.NewString(), 1), owner.token, headers, 400, "validation_error"},
		{"duplicate id", "PUT", path, strings.Replace(body, c.Substates[0].ID, c.Substates[1].ID, 1), owner.token, headers, 400, "validation_error"},
		{"malformed id", "PUT", path, strings.Replace(body, c.Substates[0].ID, "bad", 1), owner.token, headers, 400, "validation_error"},
		{"duplicate casefold name", "PUT", path, `{"substates":[{"name":"Straße"},{"name":"STRASSE"}]}`, owner.token, headers, 400, "validation_error"},
		{"duplicate nfc name", "PUT", path, `{"substates":[{"name":" ÁREA TI "},{"name":"A\u0301rea\u00a0ti"}]}`, owner.token, headers, 400, "validation_error"},
		{"empty name", "PUT", path, `{"substates":[{"name":" \u00a0\t"}]}`, owner.token, headers, 400, "validation_error"},
		{"control name", "PUT", path, `{"substates":[{"name":"a\u0000b"}]}`, owner.token, headers, 400, "validation_error"},
		{"long name", "PUT", path, `{"substates":[{"name":"` + strings.Repeat("é", 41) + `"}]}`, owner.token, headers, 400, "validation_error"},
		{"oversized", "PUT", path, strings.Repeat("x", 1048577), owner.token, headers, 413, "payload_too_large"},
		{"anonymous", "GET", path, "", "", nil, 401, "unauthenticated"},
		{"invalid token", "PUT", path, body, "invalid", nil, 401, "unauthenticated"},
		{"nonprincipal get", "GET", path, "", nonprincipal.token, nil, 404, "not_found"},
		{"nonprincipal put precedence", "PUT", path, `broken`, nonprincipal.token, nil, 404, "not_found"},
		{"foreign get", "GET", path, "", foreign.token, nil, 404, "not_found"},
		{"foreign put precedence", "PUT", path, `broken`, foreign.token, nil, 404, "not_found"},
		{"missing get", "GET", draftFlowV2Path + "/" + uuid.NewString() + "/pipeline/substates", "", owner.token, nil, 404, "not_found"},
		{"missing put precedence", "PUT", draftFlowV2Path + "/" + uuid.NewString() + "/pipeline/substates", `broken`, owner.token, nil, 404, "not_found"},
	}
	draft := h.do(t, "GET", draftFlowV2Path+"/"+id, "", owner.token, nil)
	cases = append(cases, rejection{"draft tag", "PUT", path, body, owner.token, map[string]string{"If-Match": draft.header.Get("ETag")}, 412, "version_conflict"})
	many := make([]string, 51)
	for i := range many {
		many[i] = fmt.Sprintf(`{"name":"Sub %d"}`, i)
	}
	cases = append(cases, rejection{"51 substates", "PUT", path, `{"substates":[` + strings.Join(many, ",") + `]}`, owner.token, headers, 400, "validation_error"})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := substatesFlowSnapshot(t, h, id)
			response := h.do(t, tc.method, tc.path, tc.body, tc.token, tc.headers)
			draftFlowAssertCatalogError(t, response, tc.status, tc.code)
			draftFlowAssertNoStore(t, response)
			if obj := draftFlowObject(t, response.body); len(obj) != 2 || obj["error"] == "" || obj["code"] != tc.code {
				t.Fatalf("error envelope=%s", response.body)
			}
			if response.header.Get("ETag") != "" || response.header.Get("Idempotency-Replayed") != "" || before != substatesFlowSnapshot(t, h, id) {
				t.Fatalf("rejection leaked data/changed state: %+v", response)
			}
		})
	}
}
