//go:build integration

// Production-router requester catalog acceptance: real newRouter, JWT and
// membership middleware, real store, isolated PostgreSQL. It also proves the
// catalog unblocks a v2 draft that references a requester by id.
// DRAFT_TEST_DATABASE_URL=<isolated DSN> go test -tags=integration ./cmd/api -run '^TestRequesterFlow_' -count=1
package main

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"
)

const requesterFlowPath = "/me/company/requesters"

// requesterFlowCompany is a draft-flow company whose requester audit rows are
// also cleaned up.
func requesterFlowCompany(t *testing.T, h *draftFlowHarness) (*draftFlowCompany, draftFlowActor) {
	t.Helper()
	c, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	t.Cleanup(func() {
		_, _ = h.pool.Exec(context.Background(),
			`DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM job_draft_requesters WHERE company_id = $1)`, c.companyID)
	})
	return c, h.actor(t, ownerID, sub)
}

func requesterFlowCreate(t *testing.T, h *draftFlowHarness, actor draftFlowActor, kind, name string) draftFlowResponse {
	t.Helper()
	body := `{"kind":"` + kind + `","name":"` + name + `"}`
	return h.do(t, http.MethodPost, requesterFlowPath, body, actor.token, nil)
}

func TestRequesterFlow_CreateDuplicateListAndUseInDraft(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, owner := requesterFlowCompany(t, h)

	created := requesterFlowCreate(t, h, owner, "internal_area", "Departamento  de TI")
	draftFlowAssertNoStore(t, created)
	if created.status != http.StatusCreated {
		t.Fatalf("create: %d %s", created.status, created.body)
	}
	entry := draftFlowObject(t, created.body)
	id, _ := entry["id"].(string)
	if _, err := uuid.Parse(id); err != nil || entry["kind"] != "internal_area" || entry["name"] != "Departamento de TI" || len(entry) != 3 {
		t.Fatalf("created entry = %s", created.body)
	}

	dup := requesterFlowCreate(t, h, owner, "internal_area", "DEPARTAMENTO DE TI")
	draftFlowAssertNoStore(t, dup)
	if dup.status != http.StatusConflict {
		t.Fatalf("duplicate: %d %s", dup.status, dup.body)
	}
	env := draftFlowObject(t, dup.body)
	data, _ := env["data"].(map[string]any)
	existing, _ := data["existing"].(map[string]any)
	if env["code"] != "requester_already_exists" || existing["id"] != id || existing["name"] != "Departamento de TI" {
		t.Fatalf("duplicate envelope = %s", dup.body)
	}

	if second := requesterFlowCreate(t, h, owner, "internal_area", "Área legal"); second.status != http.StatusCreated {
		t.Fatalf("second create: %d %s", second.status, second.body)
	}

	// Two pages of one item, following the server-issued cursor.
	first := h.do(t, http.MethodGet, requesterFlowPath+"?kind=internal_area&limit=1", "", owner.token, nil)
	draftFlowAssertNoStore(t, first)
	page1 := draftFlowObject(t, first.body)
	items1, _ := page1["items"].([]any)
	next, _ := page1["next_cursor"].(string)
	if first.status != http.StatusOK || len(items1) != 1 || next == "" {
		t.Fatalf("page 1: %d %s", first.status, first.body)
	}
	secondPage := h.do(t, http.MethodGet, requesterFlowPath+"?kind=internal_area&limit=1&cursor="+url.QueryEscape(next), "", owner.token, nil)
	page2 := draftFlowObject(t, secondPage.body)
	items2, _ := page2["items"].([]any)
	if secondPage.status != http.StatusOK || len(items2) != 1 || page2["next_cursor"] != nil {
		t.Fatalf("page 2: %d %s", secondPage.status, secondPage.body)
	}
	names := []any{items1[0].(map[string]any)["name"], items2[0].(map[string]any)["name"]}
	if names[0] != "Departamento de TI" || names[1] != "Área legal" {
		t.Fatalf("pages = %v, want [Departamento de TI, Área legal]", names)
	}

	// The catalog entry now unblocks a v2 draft that references it.
	draft := `{"fields":{"title":"Backend Go","requester":{"kind":"internal_area","id":"` + id + `"}}}`
	resp := h.do(t, http.MethodPost, draftFlowV2Path, draft, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if resp.status != http.StatusCreated {
		t.Fatalf("v2 draft with requester: %d %s", resp.status, resp.body)
	}
	requester, _ := draftFlowFields(t, resp.body)["requester"].(map[string]any)
	if requester["id"] != id || requester["name"] != "Departamento de TI" {
		t.Fatalf("draft requester = %v", requester)
	}
}

func TestRequesterFlow_CompanyIsolation(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerA := requesterFlowCompany(t, h)
	_, ownerB := requesterFlowCompany(t, h)

	created := requesterFlowCreate(t, h, ownerA, "client", "Cyber Power")
	if created.status != http.StatusCreated {
		t.Fatalf("create: %d %s", created.status, created.body)
	}
	idA, _ := draftFlowObject(t, created.body)["id"].(string)

	listB := h.do(t, http.MethodGet, requesterFlowPath+"?kind=client", "", ownerB.token, nil)
	if items, _ := draftFlowObject(t, listB.body)["items"].([]any); listB.status != http.StatusOK || len(items) != 0 {
		t.Fatalf("company B sees company A's catalog: %d %s", listB.status, listB.body)
	}

	// Company B may create its own entry with the same name.
	if own := requesterFlowCreate(t, h, ownerB, "client", "Cyber Power"); own.status != http.StatusCreated {
		t.Fatalf("company B create: %d %s", own.status, own.body)
	}

	// Company B cannot reference company A's entry from a draft.
	draft := `{"fields":{"requester":{"kind":"client","id":"` + idA + `"}}}`
	resp := h.do(t, http.MethodPost, draftFlowV2Path, draft, ownerB.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if resp.status != http.StatusBadRequest || draftFlowObject(t, resp.body)["code"] != "validation_error" {
		t.Fatalf("cross-company requester: %d %s", resp.status, resp.body)
	}

	// No token: 401 and still no-store.
	anon := h.do(t, http.MethodGet, requesterFlowPath+"?kind=client", "", "", nil)
	draftFlowAssertNoStore(t, anon)
	if anon.status != http.StatusUnauthorized {
		t.Fatalf("anonymous list: %d %s", anon.status, anon.body)
	}
}
