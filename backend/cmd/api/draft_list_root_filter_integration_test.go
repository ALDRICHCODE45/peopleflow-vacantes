//go:build integration

package main

import (
	"net/http"
	"net/url"
	"reflect"
	"testing"
)

// Replacement processes R2b: the draft list root_process_id filter and its cursor binding.

func (f *replFlow) listAll(token, query string) []string {
	f.t.Helper()
	var ids []string
	sep := "?"
	if query != "" {
		sep = "&"
	}
	cursor := ""
	for {
		q := query + sep + "limit=2"
		if cursor != "" {
			q += "&cursor=" + url.QueryEscape(cursor)
		}
		page := f.list(token, q)
		if page.status != http.StatusOK {
			f.t.Fatalf("list %q: %d", q, page.status)
		}
		ids = append(ids, page.ids...)
		if page.next == "" {
			return ids
		}
		cursor = page.next
	}
}

func TestDraftListRootProcessIDFilter(t *testing.T) {
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

	t.Run("root_process_id lists the original and its replacements in the usual order", func(t *testing.T) {
		everything := f.listAll(f.owner.token, "")
		inChain := map[string]bool{root: true, first: true, private: true}
		want := []string{}
		for _, id := range everything {
			if inChain[id] {
				want = append(want, id)
			}
		}
		if len(want) != 3 {
			t.Fatalf("unfiltered list lost the chain: %v", everything)
		}
		if got := f.list(f.owner.token, "?root_process_id="+root).ids; !reflect.DeepEqual(got, want) {
			t.Fatalf("filtered = %v, want %v", got, want)
		}
		if got := f.listAll(f.owner.token, "?root_process_id="+root); !reflect.DeepEqual(got, want) {
			t.Fatalf("filtered across pages = %v, want %v", got, want)
		}
		if got := f.list(f.owner.token, "?root_process_id="+standalone).ids; !reflect.DeepEqual(got, []string{standalone}) {
			t.Fatalf("standalone = %v", got)
		}
		if got := f.list(f.owner.token, "?root_process_id="+unpublished).ids; !reflect.DeepEqual(got, []string{unpublished}) {
			t.Fatalf("never-published original = %v", got)
		}
	})

	t.Run("only a root id matches: a replacement id, an unknown id and a foreign id answer an empty page", func(t *testing.T) {
		foreignRoot := newReplFlow(t).published()
		for name, id := range map[string]string{"replacement": first, "unknown": "11111111-1111-4111-8111-111111111111", "foreign": foreignRoot, "nil uuid": "00000000-0000-0000-0000-000000000000"} {
			page := f.list(f.owner.token, "?root_process_id="+id)
			if page.status != http.StatusOK || len(page.items) != 0 || page.next != "" {
				t.Fatalf("%s: %d %v", name, page.status, page.ids)
			}
		}
	})

	t.Run("the visibility scope still applies", func(t *testing.T) {
		recruiterID, recruiterSub := f.company.addUser(t, "recruiter")
		recruiter := f.h.actor(t, recruiterID, recruiterSub)
		page := f.list(recruiter.token, "?root_process_id="+root)
		if page.status != http.StatusOK || len(page.items) != 0 {
			t.Fatalf("recruiter without a tramo: %d %v", page.status, page.ids)
		}
	})

	t.Run("a malformed value is invalid_request", func(t *testing.T) {
		for _, query := range map[string]string{
			"text":      "?root_process_id=abc",
			"empty":     "?root_process_id=",
			"uppercase": "?root_process_id=" + "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
			"repeated":  "?root_process_id=" + root + "&root_process_id=" + root,
			"braces":    "?root_process_id={" + root + "}",
		} {
			resp := f.h.do(t, http.MethodGet, draftFlowV2Path+query, "", f.owner.token, nil)
			draftFlowAssertError(t, resp, http.StatusBadRequest, "invalid_request")
		}
	})

	t.Run("a cursor belongs to the filter it was issued for", func(t *testing.T) {
		unfiltered := f.list(f.owner.token, "?limit=1").next
		filtered := f.list(f.owner.token, "?limit=1&root_process_id="+root).next
		other := f.list(f.owner.token, "?limit=1&root_process_id="+standalone).next
		if unfiltered == "" || filtered == "" || other != "" {
			t.Fatalf("cursors: %q %q %q", unfiltered, filtered, other)
		}
		for _, query := range map[string]string{
			"filtered cursor without the filter": "?cursor=" + url.QueryEscape(filtered),
			"unfiltered cursor with a filter":    "?root_process_id=" + root + "&cursor=" + url.QueryEscape(unfiltered),
			"filtered cursor under another root": "?root_process_id=" + standalone + "&cursor=" + url.QueryEscape(filtered),
		} {
			resp := f.h.do(t, http.MethodGet, draftFlowV2Path+query, "", f.owner.token, nil)
			draftFlowAssertError(t, resp, http.StatusBadRequest, "invalid_cursor")
		}
		if page := f.list(f.owner.token, "?limit=1&root_process_id="+root+"&cursor="+url.QueryEscape(filtered)); page.status != http.StatusOK || len(page.items) != 1 {
			t.Fatalf("same filter: %d %v", page.status, page.ids)
		}
		if page := f.list(f.owner.token, "?limit=1&cursor="+url.QueryEscape(unfiltered)); page.status != http.StatusOK {
			t.Fatalf("no filter: %d", page.status)
		}
	})
}
