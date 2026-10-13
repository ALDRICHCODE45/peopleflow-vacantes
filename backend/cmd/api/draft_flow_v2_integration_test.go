//go:build integration

// Production-router HTTP v2 acceptance: real newRouter, JWT and membership
// middleware, real draft store, isolated PostgreSQL. Both v1 and v2 requests
// use the production route table; no test-local draft registrations.
// Run with the dedicated loopback draft_test DSN, never DATABASE_URL:
// DRAFT_TEST_DATABASE_URL=<isolated DSN> go test -tags=integration ./cmd/api -run '^TestDraftFlowV2_' -count=1
package main

import (
	"bytes"
	"context"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
)

const draftFlowV2Path = "/v2/me/company/job-drafts"
const draftFlowV2Create = `{"fields":{"title":"Backend Go","professional_area":"technology_systems","screening_questions":[{"id":"b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d","type":"single_choice_evaluated","prompt":"Which keyword declares a Go function?","options":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","label":"func"},{"id":"2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e","label":"function"}],"correct_option_id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"}]}}`

func newDraftFlowV2Harness(t *testing.T) *draftFlowHarness {
	t.Helper()
	return newDraftFlowHarness(t)
}

func draftFlowV2CreateDraft(t *testing.T, h *draftFlowHarness, actor draftFlowActor, key string) (string, string, []byte) {
	t.Helper()
	resp := h.do(t, http.MethodPost, draftFlowV2Path, draftFlowV2Create, actor.token, map[string]string{"Idempotency-Key": key})
	if resp.status != 201 || resp.header.Get("Idempotency-Replayed") != "false" || !strings.HasPrefix(resp.header.Get("ETag"), `"jd-r2-`) {
		t.Fatalf("v2 create: %d %v %s", resp.status, resp.header, resp.body)
	}
	draftFlowAssertNoStore(t, resp)
	draftFlowAssertVersion(t, resp.body, "1")
	env := draftFlowObject(t, resp.body)
	if env["schema_version"] != float64(2) {
		t.Fatalf("schema: %s", resp.body)
	}
	id, ok := env["id"].(string)
	if !ok {
		t.Fatalf("missing id: %s", resp.body)
	}
	if got, want := resp.header.Get("ETag"), `"jd-r2-`+id+`-v1"`; got != want {
		t.Fatalf("create ETag = %q, want %q", got, want)
	}
	// Private keys must survive employer HTTP transport; this is not candidate output.
	q := draftFlowFields(t, resp.body)["screening_questions"].([]any)[0].(map[string]any)
	if q["correct_option_id"] != "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" {
		t.Fatalf("private answer lost: %s", resp.body)
	}
	return id, resp.header.Get("ETag"), resp.body
}

// SQL snapshots observe effects that have no public audit/idempotency interface;
// behavior under test always goes through HTTP, never a direct store call.
func draftFlowV2Reject(t *testing.T, h *draftFlowHarness, companyID uuid.UUID, id, method, path, body, token string, headers map[string]string, status int, code string) {
	t.Helper()
	before := draftFlowReplaySnapshot(t, h, companyID, id)
	resp := h.do(t, method, path, body, token, headers)
	draftFlowAssertError(t, resp, status, code)
	env := draftFlowObject(t, resp.body)
	message, ok := env["error"].(string)
	if len(env) != 2 || !ok || message == "" || resp.header.Get("ETag") != "" || resp.header.Get("Idempotency-Replayed") != "" {
		t.Fatalf("error leaked data/headers: %v %s", resp.header, resp.body)
	}
	if after := draftFlowReplaySnapshot(t, h, companyID, id); after != before {
		t.Fatal("rejection mutated draft, idempotency or audit state")
	}
}

func TestDraftFlowV2_CreateReadSaveAndFrozenReplay(t *testing.T) {
	h := newDraftFlowV2Harness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, user, sub)
	key := uuid.NewString()
	id, tag, created := draftFlowV2CreateDraft(t, h, actor, key)
	path := draftFlowV2Path + "/" + id
	read := h.do(t, http.MethodGet, path, "", actor.token, nil)
	draftFlowAssertNoStore(t, read)
	if read.status != 200 || !bytes.Equal(read.body, created) || read.header.Get("ETag") != tag || read.header.Get("Idempotency-Replayed") != "" {
		t.Fatalf("get differs: %d %v %s", read.status, read.header, read.body)
	}
	save := h.do(t, http.MethodPatch, path, `{"fields":{"title":"Backend Rust"}}`, actor.token, map[string]string{"If-Match": tag})
	draftFlowAssertNoStore(t, save)
	draftFlowAssertVersion(t, save.body, "2")
	if save.status != 200 || save.header.Get("ETag") != `"jd-r2-`+id+`-v2"` || save.header.Get("Idempotency-Replayed") != "" || draftFlowFields(t, save.body)["title"] != "Backend Rust" {
		t.Fatalf("save: %d %v %s", save.status, save.header, save.body)
	}
	if !reflect.DeepEqual(draftFlowFields(t, save.body)["screening_questions"], draftFlowFields(t, created)["screening_questions"]) {
		t.Fatal("save changed private screening, including answer value")
	}
	before := draftFlowReplaySnapshot(t, h, company.companyID, id)
	replay := h.do(t, http.MethodPost, draftFlowV2Path, draftFlowV2Create, actor.token, map[string]string{"Idempotency-Key": key})
	draftFlowAssertNoStore(t, replay)
	if replay.status != 201 {
		t.Fatalf("replay: %d %s", replay.status, replay.body)
	}
	draftFlowAssertFrozenReplay(t, replay, created, tag)
	if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
		t.Fatal("frozen replay mutated state")
	}
	read = h.do(t, http.MethodGet, path, "", actor.token, nil)
	draftFlowAssertNoStore(t, read)
	if read.status != 200 || !bytes.Equal(read.body, save.body) || read.header.Get("ETag") != save.header.Get("ETag") {
		t.Fatal("replay changed current read")
	}
	draftFlowV2Reject(t, h, company.companyID, id, http.MethodPatch, path, `{"fields":{"title":"stale"}}`, actor.token, map[string]string{"If-Match": tag}, 412, "version_conflict")
}

func TestDraftFlowV2_VersionNamespaceAndV1Regression(t *testing.T) {
	h := newDraftFlowV2Harness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, user, sub)
	key := uuid.NewString()
	v1id, v1tag, v1body := h.create(t, actor, key, draftFlowMinimalCreate)
	v2id, _, _ := draftFlowV2CreateDraft(t, h, actor, key)
	if v1id == v2id || !strings.HasPrefix(v1tag, `"jd-r1-`) {
		t.Fatal("version namespaces not independent")
	}
	replay := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, actor.token, map[string]string{"Idempotency-Key": key})
	draftFlowAssertNoStore(t, replay)
	if replay.status != 201 {
		t.Fatalf("v1 replay: %d %s", replay.status, replay.body)
	}
	draftFlowAssertFrozenReplay(t, replay, v1body, v1tag)
	read := h.do(t, http.MethodGet, draftFlowPath+"/"+v1id, "", actor.token, nil)
	draftFlowAssertNoStore(t, read)
	if read.status != 200 || read.header.Get("ETag") != v1tag || !bytes.Equal(read.body, v1body) {
		t.Fatal("v1 get changed")
	}
	save := h.do(t, http.MethodPatch, draftFlowPath+"/"+v1id, `{"fields":{"title":"Still v1"}}`, actor.token, map[string]string{"If-Match": v1tag})
	draftFlowAssertNoStore(t, save)
	draftFlowAssertVersion(t, save.body, "2")
	if save.status != 200 || !strings.HasPrefix(save.header.Get("ETag"), `"jd-r1-`) || draftFlowFields(t, save.body)["title"] != "Still v1" {
		t.Fatal("v1 save changed")
	}
	for _, tc := range []struct{ name, path, id string }{{"v2_hides_v1", draftFlowV2Path, v1id}, {"v1_hides_v2", draftFlowPath, v2id}} {
		t.Run(tc.name, func(t *testing.T) {
			draftFlowV2Reject(t, h, company.companyID, tc.id, http.MethodGet, tc.path+"/"+tc.id, "", actor.token, nil, 404, "not_found")
			// A known other schema wins over a foreign tag and malformed body semantics.
			draftFlowV2Reject(t, h, company.companyID, tc.id, http.MethodPatch, tc.path+"/"+tc.id, `{`, actor.token, map[string]string{"If-Match": "bad"}, 404, "not_found")
		})
	}
}

func TestDraftFlowV2_PreconditionErrorsLeaveState(t *testing.T) {
	h := newDraftFlowV2Harness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, user, sub)
	id, tag, _ := draftFlowV2CreateDraft(t, h, actor, uuid.NewString())
	path := draftFlowV2Path + "/" + id
	for _, tc := range []struct {
		name, tag string
		status    int
		code      string
	}{
		{"missing", "", 428, "precondition_required"}, {"foreign_r1", strings.Replace(tag, "jd-r2-", "jd-r1-", 1), 400, "invalid_request"},
		{"weak", "W/" + tag, 400, "invalid_request"}, {"list", tag + "," + tag, 400, "invalid_request"}, {"star", "*", 400, "invalid_request"},
		{"wrong_id", `"jd-r2-` + uuid.NewString() + `-v1"`, 412, "version_conflict"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			headers := map[string]string{}
			if tc.tag != "" {
				headers["If-Match"] = tc.tag
			}
			draftFlowV2Reject(t, h, company.companyID, id, http.MethodPatch, path, `{`, actor.token, headers, tc.status, tc.code)
		})
	}
	draftFlowV2Reject(t, h, company.companyID, id, http.MethodPatch, path, `{`, actor.token, map[string]string{"If-Match": tag}, 400, "invalid_request")
}

func TestDraftFlowV2_AuthSchemaAndCorruptionPrecedence(t *testing.T) {
	h := newDraftFlowV2Harness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, user, sub)
	key := uuid.NewString()
	id, _, _ := draftFlowV2CreateDraft(t, h, actor, key)
	path := draftFlowV2Path + "/" + id
	// Corrupt storage should be 500 only after auth and resource authorization.
	draftFlowSeedDraftFields(t, h, id, `{"schema_version":3,"fields":{}}`)
	for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodPost} {
		t.Run("unauthenticated_"+method, func(t *testing.T) {
			target := path
			if method == http.MethodPost {
				target = draftFlowV2Path
			}
			draftFlowV2Reject(t, h, company.companyID, id, method, target, `{`, "", map[string]string{"Idempotency-Key": key}, 401, "unauthenticated")
		})
	}
	_, otherUser, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	other := h.actor(t, otherUser, otherSub)
	for _, method := range []string{http.MethodGet, http.MethodPatch} {
		draftFlowV2Reject(t, h, company.companyID, id, method, path, `{`, other.token, nil, 404, "not_found")
		draftFlowV2Reject(t, h, company.companyID, id, method, path, `{`, actor.token, nil, 500, "internal_error")
	}
	// Same actor/key: valid decoding reaches the frozen replay's current-row gate.
	draftFlowV2Reject(t, h, company.companyID, id, http.MethodPost, draftFlowV2Path, draftFlowV2Create, actor.token, map[string]string{"Idempotency-Key": key}, 500, "internal_error")
}

func TestDraftFlowV2_ReplayReauthorization(t *testing.T) {
	h := newDraftFlowV2Harness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, user, sub)
	key := uuid.NewString()
	id, _, _ := draftFlowV2CreateDraft(t, h, actor, key)
	peer, _ := company.addUser(t, "recruiter")
	if _, err := h.pool.Exec(context.Background(), `UPDATE company_members SET role='recruiter' WHERE company_id=$1 AND user_id=$2`, company.companyID, user); err != nil {
		t.Fatal(err)
	}
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$1 WHERE id=$2`, peer, id); err != nil {
		t.Fatal(err)
	}
	draftFlowSeedDraftFields(t, h, id, `{"schema_version":3,"fields":{}}`)
	// Middleware still admits the recruiter, but resource authorization hides the
	// draft before corrupt storage or a changed-body idempotency conflict.
	draftFlowV2Reject(t, h, company.companyID, id, http.MethodPost, draftFlowV2Path, `{"fields":{"title":"Changed"}}`, actor.token, map[string]string{"Idempotency-Key": key}, 404, "not_found")
}

func TestDraftFlowV2_ProductionGatesNoStore(t *testing.T) {
	h := newDraftFlowV2Harness(t)
	company, user, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, user, sub)
	id, _, _ := draftFlowV2CreateDraft(t, h, actor, uuid.NewString())
	if _, err := h.pool.Exec(context.Background(), `DELETE FROM company_members WHERE company_id=$1 AND user_id=$2`, company.companyID, user); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodPost, http.MethodGet, http.MethodPatch} {
		t.Run(method, func(t *testing.T) {
			path := draftFlowV2Path + "/" + id
			if method == http.MethodPost {
				path = draftFlowV2Path
			}
			for _, tc := range []struct {
				name, token string
				status      int
				code        string
			}{
				{"unauthenticated", "", 401, "unauthenticated"},
				{"removed_membership", actor.token, 403, "forbidden"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					draftFlowV2Reject(t, h, company.companyID, id, method, path, `{`, tc.token, nil, tc.status, tc.code)
				})
			}
		})
	}
}
