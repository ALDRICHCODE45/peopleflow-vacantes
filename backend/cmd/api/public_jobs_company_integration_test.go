//go:build integration

package main

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPublicJobsCompanyFilter(t *testing.T) {
	h := newDraftFlowHarness(t)
	first, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
	second, otherUID, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner, other := h.actor(t, uid, sub), h.actor(t, otherUID, otherSub)
	marker := "companyfilter" + strings.ReplaceAll(uuid.NewString(), "-", "")
	ids := map[string]bool{}
	for _, fixture := range []struct {
		company uuid.UUID
		actor   draftFlowActor
	}{{first.companyID, owner}, {second.companyID, other}} {
		id := publicationFlowReady(t, h, fixture.actor)
		publicFlowPatch(t, h, id, fixture.actor, map[string]any{"title": marker})
		publicFlowPublish(t, h, id, fixture.actor)
		legacy := publicFlowLegacy(t, h, fixture.company, marker, "Public legacy", "", time.Now().UTC(), nil)
		// A complete but unpublished vacancy must stay out of the catalog.
		draft := publicationFlowReady(t, h, fixture.actor)
		publicFlowPatch(t, h, draft, fixture.actor, map[string]any{"title": marker})
		if fixture.company == first.companyID {
			ids[id] = true
			ids[legacy] = true
		}
	}
	all := publicFlowGet(t, h, "/v2/jobs?q="+marker, 200)
	if len(all["items"].([]any)) != 4 {
		t.Fatal(all)
	}
	base := "/v2/jobs?q=" + marker + "&company_id=" + strings.ToUpper(first.companyID.String()) + "&limit=1"
	page := publicFlowGet(t, h, base, 200)
	for {
		items := page["items"].([]any)
		for _, raw := range items {
			item := raw.(map[string]any)
			publicFlowAssertKeys(t, item, false)
			id := item["id"].(string)
			if !ids[id] || item["company"].(map[string]any)["id"] != first.companyID.String() {
				t.Fatal("wrong company or unpublished vacancy", item)
			}
			delete(ids, id)
		}
		if page["next_cursor"] == nil {
			break
		}
		token := page["next_cursor"].(string)
		if invalid := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&company_id="+second.companyID.String()+"&cursor="+token, 400); invalid["code"] != "invalid_request" {
			t.Fatal(invalid)
		}
		page = publicFlowGet(t, h, base+"&cursor="+token, 200)
	}
	if len(ids) != 0 {
		t.Fatal("missing jobs", ids)
	}
	for _, query := range []string{"company_id=bad", "company_id=", "company_id=" + first.companyID.String() + "&company_id=" + second.companyID.String()} {
		if invalid := publicFlowGet(t, h, "/v2/jobs?"+query, 400); len(invalid) != 2 || invalid["code"] != "invalid_filter" || invalid["error"] != "invalid filter" {
			t.Fatal(invalid)
		}
	}
	empty := publicFlowGet(t, h, "/v2/jobs?company_id="+uuid.NewString(), 200)
	if len(empty["items"].([]any)) != 0 || empty["next_cursor"] != nil {
		t.Fatal(empty)
	}
}
