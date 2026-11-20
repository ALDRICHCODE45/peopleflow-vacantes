//go:build integration

package main

import (
	"net/http"
	"reflect"
	"testing"
)

// Replacement processes R2: draft list keys (docs/contracts/replacement-processes-v1.md, «Draft list»).

type replListPage struct {
	status int
	items  []map[string]any
	ids    []string
	next   string
}

func (f *replFlow) list(token, query string) replListPage {
	f.t.Helper()
	resp := f.h.do(f.t, http.MethodGet, draftFlowV2Path+query, "", token, nil)
	draftFlowAssertNoStore(f.t, resp)
	page := replListPage{status: resp.status}
	if resp.status != http.StatusOK {
		return page
	}
	body := draftFlowObject(f.t, resp.body)
	for _, raw := range body["items"].([]any) {
		item := raw.(map[string]any)
		page.items = append(page.items, item)
		page.ids = append(page.ids, item["id"].(string))
	}
	if next, ok := body["next_cursor"].(string); ok {
		page.next = next
	}
	return page
}

func TestDraftListReplacementKeys(t *testing.T) {
	f := newReplFlow(t)
	unpublished := f.draft()
	root := f.published()
	f.closeIt(root, "finish")
	first := f.published()
	f.link(first, root, root, 1)
	f.closeIt(first, "finish")
	private := f.published()
	f.link(private, first, root, 2)
	f.exec(`DELETE FROM vacancy_public_projections WHERE id=$1`, private)
	standalone := f.published()

	t.Run("items carry the replacement keys next to every existing key", func(t *testing.T) {
		page := f.list(f.owner.token, "?limit=50")
		byID := map[string]map[string]any{}
		for _, item := range page.items {
			if len(item) != 23 {
				t.Fatalf("item has %d keys: %v", len(item), item)
			}
			byID[item["id"].(string)] = item
		}
		for id, want := range map[string]map[string]any{
			unpublished: {"kind": "original", "sequence": nil, "replacement_of": nil, "root_process_id": unpublished, "visibility": nil, "status": "draft"},
			root:        {"kind": "original", "sequence": nil, "replacement_of": nil, "root_process_id": root, "visibility": "public", "status": "closed"},
			first:       {"kind": "replacement", "sequence": float64(1), "replacement_of": root, "root_process_id": root, "visibility": "public", "status": "closed"},
			private:     {"kind": "replacement", "sequence": float64(2), "replacement_of": first, "root_process_id": root, "visibility": "private", "status": "published"},
			standalone:  {"kind": "original", "sequence": nil, "replacement_of": nil, "root_process_id": standalone, "visibility": "public", "status": "published"},
		} {
			item := byID[id]
			if item == nil {
				t.Fatalf("%s missing from the list", id)
			}
			for k, v := range want {
				if !reflect.DeepEqual(item[k], v) {
					t.Fatalf("%s: %s = %#v, want %#v", id, k, item[k], v)
				}
			}
		}
	})
}
