//go:build integration

// Production-router draft list acceptance: real newRouter, JWT and gates over
// the isolated draft_test database (same DSN guard as the draft flow tests).

package main

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/google/uuid"
)

type draftListFlowPage struct {
	Items []struct {
		ID                 string          `json:"id"`
		Title              *string         `json:"title"`
		Requester          json.RawMessage `json:"requester"`
		PrincipalRecruiter struct {
			ID   string  `json:"id"`
			Name *string `json:"name"`
		} `json:"principal_recruiter"`
		Version   string `json:"version"`
		CreatedAt string `json:"created_at"`
		UpdatedAt string `json:"updated_at"`
	} `json:"items"`
	NextCursor *string `json:"next_cursor"`
}

func draftListFlowGet(t *testing.T, h *draftFlowHarness, actor draftFlowActor, query string) draftListFlowPage {
	t.Helper()
	resp := h.do(t, http.MethodGet, draftFlowV2Path+query, "", actor.token, nil)
	draftFlowAssertNoStore(t, resp)
	if resp.status != http.StatusOK {
		t.Fatalf("list %q: %d %s", query, resp.status, resp.body)
	}
	var page draftListFlowPage
	if err := json.Unmarshal(resp.body, &page); err != nil {
		t.Fatalf("list body: %v; %s", err, resp.body)
	}
	return page
}

func draftListFlowCreate(t *testing.T, h *draftFlowHarness, actor draftFlowActor, body string) string {
	t.Helper()
	resp := h.do(t, http.MethodPost, draftFlowV2Path, body, actor.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if resp.status != http.StatusCreated {
		t.Fatalf("create v2 draft: %d %s", resp.status, resp.body)
	}
	id, _ := draftFlowObject(t, resp.body)["id"].(string)
	return id
}

func TestDraftListFlow_VisibilityPagingAndParity(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	recruiter := h.actor(t, recruiterID, recruiterSub)
	_, otherOwnerID, otherOwnerSub := draftFlowNewPrincipal(t, h.pool, "active")
	otherOwner := h.actor(t, otherOwnerID, otherOwnerSub)

	recruiterDraft := draftListFlowCreate(t, h, recruiter, `{"fields":{"title":"Backend Go","requester":{"kind":"client","id":null}}}`)
	ownerDraft := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
	foreignDraft := draftListFlowCreate(t, h, otherOwner, `{"fields":{"title":"Ajena"}}`)

	// Owner: both company drafts, most recent first, one per page.
	first := draftListFlowGet(t, h, owner, "?limit=1")
	if len(first.Items) != 1 || first.Items[0].ID != ownerDraft || first.Items[0].Title != nil || string(first.Items[0].Requester) != "null" || first.NextCursor == nil {
		t.Fatalf("owner page 1 = %+v", first)
	}
	second := draftListFlowGet(t, h, owner, "?limit=1&cursor="+url.QueryEscape(*first.NextCursor))
	if len(second.Items) != 1 || second.Items[0].ID != recruiterDraft || second.NextCursor != nil {
		t.Fatalf("owner page 2 = %+v", second)
	}
	item := second.Items[0]
	if item.Title == nil || *item.Title != "Backend Go" || string(item.Requester) != `{"kind":"client","id":null,"name":null}` ||
		item.PrincipalRecruiter.ID != recruiterID.String() || item.PrincipalRecruiter.Name == nil {
		t.Fatalf("recruiter draft row = %+v requester=%s", item, item.Requester)
	}

	// The row carries the same values as the draft read envelope.
	read := h.do(t, http.MethodGet, draftFlowV2Path+"/"+recruiterDraft, "", owner.token, nil)
	if read.status != http.StatusOK {
		t.Fatalf("get: %d %s", read.status, read.body)
	}
	env := draftFlowObject(t, read.body)
	if env["version"] != item.Version || env["created_at"] != item.CreatedAt || env["updated_at"] != item.UpdatedAt || env["principal_recruiter_id"] != item.PrincipalRecruiter.ID {
		t.Fatalf("row %+v differs from GET envelope %s", item, read.body)
	}

	// Recruiter: only their principal draft.
	own := draftListFlowGet(t, h, recruiter, "")
	if len(own.Items) != 1 || own.Items[0].ID != recruiterDraft || own.NextCursor != nil {
		t.Fatalf("recruiter list = %+v", own)
	}

	// Another company sees only its own draft.
	foreign := draftListFlowGet(t, h, otherOwner, "")
	if len(foreign.Items) != 1 || foreign.Items[0].ID != foreignDraft {
		t.Fatalf("other company list = %+v", foreign)
	}

	// A cursor is bound to its company and user.
	reused := h.do(t, http.MethodGet, draftFlowV2Path+"?cursor="+url.QueryEscape(*first.NextCursor), "", recruiter.token, nil)
	draftFlowAssertCatalogError(t, reused, http.StatusBadRequest, "invalid_request")
	crossCompany := h.do(t, http.MethodGet, draftFlowV2Path+"?cursor="+url.QueryEscape(*first.NextCursor), "", otherOwner.token, nil)
	draftFlowAssertCatalogError(t, crossCompany, http.StatusBadRequest, "invalid_request")

	// Anonymous requests are rejected by the gate and stay uncacheable.
	anonymous := h.do(t, http.MethodGet, draftFlowV2Path, "", "", nil)
	draftFlowAssertNoStore(t, anonymous)
	if anonymous.status != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d %s", anonymous.status, anonymous.body)
	}
}
