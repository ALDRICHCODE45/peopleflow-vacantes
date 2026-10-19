//go:build integration

package main

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func pipelineFlowBody(t *testing.T, c pipelineconfig.Configuration) string {
	t.Helper()
	stages := make([]map[string]any, len(c.Stages))
	for i, s := range c.Stages {
		stages[i] = map[string]any{"id": s.ID, "name": s.Name}
	}
	raw, err := json.Marshal(map[string]any{"stages": stages, "exit": map[string]any{"id": c.Exit.ID, "name": c.Exit.Name}})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func pipelineFlowConfig(t *testing.T, raw []byte) pipelineconfig.Configuration {
	t.Helper()
	var c pipelineconfig.Configuration
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func pipelineFlowSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var snapshot string
	if err := h.pool.QueryRow(context.Background(), `SELECT json_build_array(
		(SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
		(SELECT row_to_json(p) FROM job_draft_pipeline_configs p WHERE draft_id=$1),
		(SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&snapshot); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestPipelineFlow_DefaultsReplaceOrderNoOpAndVersionIsolation(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := draftListFlowCreate(t, h, principal, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/pipeline"
	draftBefore := h.do(t, "GET", draftFlowV2Path+"/"+id, "", owner.token, nil)
	before := pipelineFlowSnapshot(t, h, id)
	first := h.do(t, "GET", path, "", principal.token, nil)
	second := h.do(t, "GET", path, "", owner.token, nil)
	for _, response := range []draftFlowResponse{first, second} {
		draftFlowAssertNoStore(t, response)
		if response.status != 200 || response.header.Get("ETag") != pipelineconfig.ETag(uuid.MustParse(id), 0) || !pipelineFlowConfig(t, response.body).Equal(pipelineconfig.Defaults(uuid.MustParse(id))) {
			t.Fatalf("default response: %+v", response)
		}
		obj := draftFlowObject(t, response.body)
		limits := obj["limits"].(map[string]any)
		if len(obj) != 5 || obj["structure_locked"] != false || obj["version"] != "0" || limits["maxCustomStages"] != float64(3) || limits["nameMaxLength"] != float64(40) {
			t.Fatalf("envelope: %s", response.body)
		}
	}
	if !reflect.DeepEqual(first.body, second.body) || pipelineFlowSnapshot(t, h, id) != before {
		t.Fatal("consecutive GETs changed bytes or wrote data")
	}
	c := pipelineFlowConfig(t, first.body)
	c.Stages[1], c.Stages[3] = c.Stages[3], c.Stages[1]
	c.Stages[1].Name = "Entrevistas"
	c.Exit.Name = "Fuera"
	body := pipelineFlowBody(t, c)
	placement := `{"id":"` + c.Stages[4].ID + `"`
	body = strings.Replace(body, placement, `{"name":"Prueba técnica"},`+placement, 1)
	saved := h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	draftFlowAssertNoStore(t, saved)
	if saved.status != 200 || saved.header.Get("ETag") != pipelineconfig.ETag(uuid.MustParse(id), 1) || draftFlowObject(t, saved.body)["version"] != "1" {
		t.Fatalf("save=%d %s headers=%v", saved.status, saved.body, saved.header)
	}
	got := pipelineFlowConfig(t, saved.body)
	if len(got.Stages) != 6 || got.Stages[1] != c.Stages[1] || got.Stages[4].Kind != "custom" || got.Stages[4].Name != "Prueba técnica" || got.Exit != c.Exit || uuid.MustParse(got.Stages[4].ID).Version() != 4 {
		t.Fatalf("response order/identity=%+v", got)
	}
	draftAfter := h.do(t, "GET", draftFlowV2Path+"/"+id, "", owner.token, nil)
	if draftBefore.header.Get("ETag") != draftAfter.header.Get("ETag") || !reflect.DeepEqual(draftBefore.body, draftAfter.body) {
		t.Fatal("pipeline PUT changed draft version/body")
	}
	before = pipelineFlowSnapshot(t, h, id)
	got.Stages[1].Name = "  Entrevistas\u00a0\t"
	noop := h.do(t, "PUT", path, pipelineFlowBody(t, got), principal.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	if noop.status != 200 || noop.header.Get("ETag") != saved.header.Get("ETag") || !reflect.DeepEqual(noop.body, saved.body) || pipelineFlowSnapshot(t, h, id) != before {
		t.Fatalf("no-op=%d %s", noop.status, noop.body)
	}
	draftFlowAssertNoStore(t, noop)
	patch := h.do(t, "PATCH", draftFlowV2Path+"/"+id, `{"fields":{"title":"Independiente"}}`, principal.token, map[string]string{"If-Match": draftAfter.header.Get("ETag")})
	if patch.status != 200 || patch.header.Get("ETag") == draftAfter.header.Get("ETag") {
		t.Fatalf("draft PATCH=%d %s", patch.status, patch.body)
	}
	afterPatch := h.do(t, "GET", path, "", principal.token, nil)
	if afterPatch.status != 200 || afterPatch.header.Get("ETag") != saved.header.Get("ETag") || !reflect.DeepEqual(afterPatch.body, saved.body) {
		t.Fatal("draft PATCH changed pipeline version")
	}
	var count int
	if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftPipelineConfigured'`, id).Scan(&count); err != nil || count != 1 {
		t.Fatalf("audit count=%d err=%v", count, err)
	}
}

func TestPipelineFlow_RejectedRequestsLeaveEveryPersistedEffectUnchanged(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	nonprincipalID, nonprincipalSub := company.addUser(t, "recruiter")
	nonprincipal := h.actor(t, nonprincipalID, nonprincipalSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/pipeline"
	read := h.do(t, "GET", path, "", owner.token, nil)
	if read.status != 200 {
		t.Fatalf("read=%d %s", read.status, read.body)
	}
	c := pipelineFlowConfig(t, read.body)
	c.Exit.Name = "No seleccionados"
	body := pipelineFlowBody(t, c)
	saved := h.do(t, "PUT", path, body, owner.token, map[string]string{"If-Match": read.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatalf("save=%d %s", saved.status, saved.body)
	}
	tag := saved.header.Get("ETag")
	type rejection struct {
		name, method, path, body, token string
		headers                         map[string]string
		status                          int
		code                            string
	}
	cases := []rejection{
		{"missing header", "PUT", path, body, owner.token, nil, 428, "precondition_required"},
		{"empty header", "PUT", path, body, owner.token, map[string]string{"If-Match": ""}, 400, "invalid_request"},
		{"weak header", "PUT", path, body, owner.token, map[string]string{"If-Match": "W/" + tag}, 400, "invalid_request"},
		{"list header", "PUT", path, body, owner.token, map[string]string{"If-Match": tag + "," + tag}, 400, "invalid_request"},
		{"malformed header", "PUT", path, body, owner.token, map[string]string{"If-Match": "bad"}, 400, "invalid_request"},
		{"stale", "PUT", path, body, owner.token, map[string]string{"If-Match": read.header.Get("ETag")}, 412, "version_conflict"},
		{"foreign tag", "PUT", path, body, owner.token, map[string]string{"If-Match": `"foreign"`}, 412, "version_conflict"},
		{"malformed path", "GET", draftFlowV2Path + "/bad/pipeline", "", owner.token, nil, 400, "invalid_request"},
		{"malformed json", "PUT", path, `{"`, owner.token, map[string]string{"If-Match": tag}, 400, "invalid_request"},
		{"unknown root", "PUT", path, strings.Replace(body, `"stages":`, `"extra":1,"stages":`, 1), owner.token, map[string]string{"If-Match": tag}, 400, "invalid_request"},
		{"unknown kind", "PUT", path, strings.Replace(body, `"name":"Nuevos"`, `"kind":"new","name":"Nuevos"`, 1), owner.token, map[string]string{"If-Match": tag}, 400, "invalid_request"},
		{"duplicate root", "PUT", path, strings.Replace(body, `"stages":`, `"stages":[],"stages":`, 1), owner.token, map[string]string{"If-Match": tag}, 400, "invalid_request"},
		{"duplicate nested", "PUT", path, strings.Replace(body, `"name":"Nuevos"`, `"name":"X","name":"Nuevos"`, 1), owner.token, map[string]string{"If-Match": tag}, 400, "invalid_request"},
		{"invalid utf8", "PUT", path, strings.Replace(body, "Nuevos", string([]byte{0xff}), 1), owner.token, map[string]string{"If-Match": tag}, 400, "invalid_request"},
		{"unknown id", "PUT", path, strings.Replace(body, c.Stages[1].ID, uuid.NewString(), 1), owner.token, map[string]string{"If-Match": tag}, 400, "validation_error"},
		{"duplicate id", "PUT", path, strings.Replace(body, c.Stages[1].ID, c.Stages[2].ID, 1), owner.token, map[string]string{"If-Match": tag}, 400, "validation_error"},
		{"duplicate name", "PUT", path, strings.Replace(body, "Screening OK", "NUEVOS", 1), owner.token, map[string]string{"If-Match": tag}, 400, "validation_error"},
		{"long name", "PUT", path, strings.Replace(body, "Screening OK", strings.Repeat("é", 41), 1), owner.token, map[string]string{"If-Match": tag}, 400, "validation_error"},
		{"oversized", "PUT", path, strings.Repeat("x", 1048577), owner.token, map[string]string{"If-Match": tag}, 413, "payload_too_large"},
		{"anonymous", "GET", path, "", "", nil, 401, "unauthenticated"},
		{"invalid token", "PUT", path, body, "invalid", nil, 401, "unauthenticated"},
		{"nonprincipal get", "GET", path, "", nonprincipal.token, nil, 404, "not_found"},
		{"nonprincipal put precedence", "PUT", path, `broken`, nonprincipal.token, nil, 404, "not_found"},
		{"foreign get", "GET", path, "", foreign.token, nil, 404, "not_found"},
		{"foreign put precedence", "PUT", path, `broken`, foreign.token, nil, 404, "not_found"},
		{"missing", "GET", draftFlowV2Path + "/" + uuid.NewString() + "/pipeline", "", owner.token, nil, 404, "not_found"},
	}
	mutations := []struct {
		name   string
		mutate func(*pipelineconfig.Configuration)
	}{
		{"missing new", func(c *pipelineconfig.Configuration) { c.Stages = c.Stages[1:] }},
		{"missing screening", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:1], c.Stages[2:]...) }},
		{"missing screening ok", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:2], c.Stages[3:]...) }},
		{"missing in process", func(c *pipelineconfig.Configuration) { c.Stages = append(c.Stages[:3], c.Stages[4:]...) }},
		{"missing placement", func(c *pipelineconfig.Configuration) { c.Stages = c.Stages[:4] }},
		{"new not first", func(c *pipelineconfig.Configuration) { c.Stages[0], c.Stages[1] = c.Stages[1], c.Stages[0] }},
		{"placement not last", func(c *pipelineconfig.Configuration) { c.Stages[3], c.Stages[4] = c.Stages[4], c.Stages[3] }},
		{"discarded in progression", func(c *pipelineconfig.Configuration) { c.Stages[1], c.Exit = c.Exit, c.Stages[1] }},
		{"empty name", func(c *pipelineconfig.Configuration) { c.Stages[1].Name = " \u00a0\t" }},
		{"control name", func(c *pipelineconfig.Configuration) { c.Exit.Name = "a\x00b" }},
		{"exit duplicate", func(c *pipelineconfig.Configuration) { c.Exit.Name = " nuevos " }},
	}
	for _, mutation := range mutations {
		config := pipelineFlowConfig(t, saved.body)
		mutation.mutate(&config)
		cases = append(cases, rejection{mutation.name, "PUT", path, pipelineFlowBody(t, config), owner.token, map[string]string{"If-Match": tag}, 400, "validation_error"})
	}
	placement := `{"id":"` + c.Stages[4].ID + `"`
	four := strings.Replace(body, placement, `{"name":"Uno"},{"name":"Dos"},{"name":"Tres"},{"name":"Cuatro"},`+placement, 1)
	cases = append(cases, rejection{"four custom stages", "PUT", path, four, owner.token, map[string]string{"If-Match": tag}, 400, "validation_error"})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := pipelineFlowSnapshot(t, h, id)
			response := h.do(t, tc.method, tc.path, tc.body, tc.token, tc.headers)
			draftFlowAssertCatalogError(t, response, tc.status, tc.code)
			draftFlowAssertNoStore(t, response)
			if obj := draftFlowObject(t, response.body); len(obj) != 2 || obj["error"] == "" || obj["code"] != tc.code {
				t.Fatalf("error envelope has extra or missing data: %s", response.body)
			}
			if response.header.Get("ETag") != "" || response.header.Get("Idempotency-Replayed") != "" || pipelineFlowSnapshot(t, h, id) != before {
				t.Fatalf("rejection leaked headers or changed storage: %+v", response)
			}
		})
	}
}
