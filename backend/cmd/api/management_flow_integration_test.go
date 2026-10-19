//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
)

func assertManagementFlow(t *testing.T, r draftFlowResponse, id string, version int64) map[string]any {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	obj := draftFlowObject(t, r.body)
	if r.status != 200 || len(obj) != 5 || r.header.Get("ETag") != vacancymanagement.ETag(uuid.MustParse(id), version) || r.header.Get("Idempotency-Replayed") != "" || !reflect.DeepEqual(obj["limits"], map[string]any{"maxHiringHeadcount": float64(999)}) {
		t.Fatalf("management=%d %s %v", r.status, r.body, r.header)
	}
	for _, key := range []string{"version", "requestDate", "hiringHeadcount", "limits", "today"} {
		if _, ok := obj[key]; !ok {
			t.Fatal("missing", key)
		}
	}
	if _, err := time.Parse(time.DateOnly, obj["today"].(string)); err != nil {
		t.Fatal(err)
	}
	return obj
}
func TestManagementFlowPureGetNullFirstPutNoOpAndIndependentVersions(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	principalID, principalSub := company.addUser(t, "recruiter")
	principal := h.actor(t, principalID, principalSub)
	id := draftListFlowCreate(t, h, principal, `{"fields":{}}`)
	base := draftFlowV2Path + "/" + id
	path := base + "/management"
	originals := map[string]draftFlowResponse{}
	for _, suffix := range []string{"", "/pipeline", "/pipeline/substates", "/pipeline/delivery"} {
		originals[suffix] = h.do(t, "GET", base+suffix, "", owner.token, nil)
	}
	before := publicationFlowSnapshot(t, h, id)
	first := h.do(t, "GET", path, "", principal.token, nil)
	obj := assertManagementFlow(t, first, id, 0)
	second := h.do(t, "GET", path, "", owner.token, nil)
	if obj["version"] != "0" || obj["requestDate"] != nil || obj["hiringHeadcount"] != nil || !bytes.Equal(first.body, second.body) || before != publicationFlowSnapshot(t, h, id) {
		t.Fatal("GET defaults not pure")
	}
	nullBody := `{"requestDate":null,"hiringHeadcount":null}`
	saved := h.do(t, "PUT", path, nullBody, owner.token, map[string]string{"If-Match": first.header.Get("ETag")})
	obj = assertManagementFlow(t, saved, id, 1)
	if obj["version"] != "1" {
		t.Fatal(obj)
	}
	before = publicationFlowSnapshot(t, h, id)
	noop := h.do(t, "PUT", path, nullBody, principal.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	assertManagementFlow(t, noop, id, 1)
	if !bytes.Equal(noop.body, saved.body) || before != publicationFlowSnapshot(t, h, id) {
		t.Fatal("no-op wrote")
	}
	// Any past weekday is accepted, including a Sunday; request and target differ.
	body := `{"requestDate":"2020-01-05","hiringHeadcount":999}`
	changed := h.do(t, "PUT", path, body, principal.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	obj = assertManagementFlow(t, changed, id, 2)
	if obj["requestDate"] != "2020-01-05" || obj["hiringHeadcount"] != float64(999) {
		t.Fatal(obj)
	}
	for suffix, original := range originals {
		after := h.do(t, "GET", base+suffix, "", owner.token, nil)
		if after.status != 200 || !bytes.Equal(after.body, original.body) || after.header.Get("ETag") != original.header.Get("ETag") {
			t.Fatalf("management changed %s", suffix)
		}
	}
	var actor string
	var metadata []byte
	if err := h.pool.QueryRow(context.Background(), `SELECT actor_id::text,metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftManagementConfigured' AND metadata->>'version'='2'`, id).Scan(&actor, &metadata); err != nil {
		t.Fatal(err)
	}
	var meta map[string]string
	if err := json.Unmarshal(metadata, &meta); err != nil {
		t.Fatal(err)
	}
	if actor != principalID.String() || meta["previous"] != nullBody || meta["new"] != body {
		t.Fatalf("audit=%s", metadata)
	}
	for _, change := range []struct{ method, suffix, body string }{{"PATCH", "", `{"fields":{"title":"Independent"}}`}, {"PUT", "/pipeline", pipelineFlowBody(t, pipelineFlowConfig(t, originals["/pipeline"].body))}, {"PUT", "/pipeline/substates", `{"substates":[{"name":"Interview"}]}`}, {"PUT", "/pipeline/delivery", deliveryFlowNull}} {
		r := h.do(t, change.method, base+change.suffix, change.body, owner.token, map[string]string{"If-Match": originals[change.suffix].header.Get("ETag")})
		if r.status != 200 {
			t.Fatalf("change %s=%s", change.suffix, r.body)
		}
	}
	after := h.do(t, "GET", path, "", owner.token, nil)
	assertManagementFlow(t, after, id, 2)
	if !bytes.Equal(after.body, changed.body) {
		t.Fatal("other resources changed management")
	}
}
func TestManagementFlowRejectedRequestsLeaveAllStateUnchanged(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	nonprincipal := h.actor(t, recruiterID, recruiterSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, foreignID, foreignSub)
	id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	path := draftFlowV2Path + "/" + id + "/management"
	get := h.do(t, "GET", path, "", owner.token, nil)
	obj := assertManagementFlow(t, get, id, 0)
	today, err := time.Parse(time.DateOnly, obj["today"].(string))
	if err != nil {
		t.Fatal(err)
	}
	future := today.AddDate(0, 0, 1).Format(time.DateOnly)
	tag := get.header.Get("ETag")
	headers := map[string]string{"If-Match": tag}
	nullBody := `{"requestDate":null,"hiringHeadcount":null}`
	for _, tc := range []struct {
		name, body string
		status     int
		code       string
	}{
		{"missing", `{}`, 400, "invalid_request"}, {"unknown", `{"requestDate":null,"hiringHeadcount":null,"today":"2026-10-16"}`, 400, "invalid_request"}, {"duplicate", `{"requestDate":null,"request\u0044ate":null,"hiringHeadcount":null}`, 400, "invalid_request"},
		{"date type", `{"requestDate":1,"hiringHeadcount":null}`, 400, "invalid_request"}, {"date malformed", `{"requestDate":"2026-02-30","hiringHeadcount":null}`, 400, "invalid_request"}, {"headcount type", `{"requestDate":null,"hiringHeadcount":"1"}`, 400, "invalid_request"}, {"fraction", `{"requestDate":null,"hiringHeadcount":1.5}`, 400, "invalid_request"},
		{"future", `{"requestDate":"` + future + `","hiringHeadcount":1}`, 400, "validation_error"}, {"zero", `{"requestDate":null,"hiringHeadcount":0}`, 400, "validation_error"}, {"over", `{"requestDate":null,"hiringHeadcount":1000}`, 400, "validation_error"}, {"surrogate", `{"requestDate":"\uD800","hiringHeadcount":null}`, 400, "invalid_request"}, {"utf8", "{\"requestDate\":\"\xff\",\"hiringHeadcount\":null}", 400, "invalid_request"}, {"budget", strings.Repeat("x", 1048577), 413, "payload_too_large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationFlowSnapshot(t, h, id)
			r := h.do(t, "PUT", path, tc.body, owner.token, headers)
			publicationFlowAssertError(t, r, tc.status, tc.code, nil)
			if before != publicationFlowSnapshot(t, h, id) {
				t.Fatal("rejection wrote state")
			}
		})
	}
	for _, tc := range []struct {
		name, method, path, token string
		headers                   map[string]string
		status                    int
		code                      string
	}{
		{"missing precondition", "PUT", path, owner.token, nil, 428, "precondition_required"}, {"empty", "PUT", path, owner.token, map[string]string{"If-Match": ""}, 400, "invalid_request"}, {"weak", "PUT", path, owner.token, map[string]string{"If-Match": "W/" + tag}, 400, "invalid_request"}, {"list", "PUT", path, owner.token, map[string]string{"If-Match": tag + "," + tag}, 400, "invalid_request"}, {"stale", "PUT", path, owner.token, map[string]string{"If-Match": vacancymanagement.ETag(uuid.MustParse(id), 1)}, 412, "version_conflict"},
		{"nonprincipal", "PUT", path, nonprincipal.token, nil, 404, "not_found"}, {"foreign", "PUT", path, foreign.token, nil, 404, "not_found"}, {"missing", "PUT", draftFlowV2Path + "/" + uuid.NewString() + "/management", owner.token, nil, 404, "not_found"}, {"bad id", "GET", draftFlowV2Path + "/bad/management", owner.token, nil, 400, "invalid_request"}, {"anonymous", "GET", path, "", nil, 401, "unauthenticated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationFlowSnapshot(t, h, id)
			r := h.do(t, tc.method, tc.path, nullBody, tc.token, tc.headers)
			publicationFlowAssertError(t, r, tc.status, tc.code, nil)
			if before != publicationFlowSnapshot(t, h, id) {
				t.Fatal("rejection wrote state")
			}
		})
	}
}
