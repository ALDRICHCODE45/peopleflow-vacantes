//go:build integration

package main

import (
	"strings"
	"testing"
)

// Organic talent base rows read the professional title frozen in the latest
// participation's snapshot, never the live candidate profile ("PRIVATE TITLE"
// in the fixture). A company correction wins; original keeps the snapshot.
func TestOrgCandidateTitleSnapshot(t *testing.T) {
	f := newOrganicEditFixture(t)
	// The owner company's latest participation (2026-03-01) carries the copy;
	// the older one (2026-01-01) stays a legacy snapshot without the key.
	f.exec(t, `UPDATE process_participations p SET profile_snapshot=p.profile_snapshot||'{"professional_title":"Snapshot Engineer"}'
 FROM vacancy_processes vp WHERE vp.id=p.process_id AND vp.company_id=$1 AND p.candidate_id=$2 AND p.created_at='2026-03-01T00:00:00Z'`, f.company.companyID, f.id)
	list := func(token string) map[string]any {
		t.Helper()
		r := f.h.do(t, "GET", orgCandidatesPath+"?origin=organic&q=original-"+f.id.String(), "", token, nil)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		items := draftFlowObject(t, r.body)["items"].([]any)
		if len(items) != 1 {
			t.Fatal(string(r.body))
		}
		return items[0].(map[string]any)
	}
	initial := f.detail(t)
	if strings.Contains(string(initial.body), "PRIVATE TITLE") {
		t.Fatal("live profile title leaked", string(initial.body))
	}
	d := draftFlowObject(t, initial.body)
	original := d["original"].(map[string]any)
	if d["professional_title"] != "Snapshot Engineer" || original["professional_title"] != "Snapshot Engineer" {
		t.Fatalf("detail title=%v original=%v", d["professional_title"], original["professional_title"])
	}
	if item := list(f.recruiter.token); item["professional_title"] != "Snapshot Engineer" {
		t.Fatal(item)
	}
	// Another company sees its own (legacy, keyless) snapshot: null, not live.
	if item := list(f.foreign.token); item["professional_title"] != nil {
		t.Fatal(item)
	}
	// Setting the snapshot value is not a correction: nothing changes.
	histories, audits := f.counts(t)
	same := f.patch(t, `{"set":{"professional_title":"Snapshot Engineer"}}`, initial.header.Get("ETag"))
	if same.status != 200 {
		t.Fatal(same.status, string(same.body))
	}
	if h, a := f.counts(t); h != histories || a != audits || len(draftFlowObject(t, same.body)["corrected_fields"].([]any)) != 0 {
		t.Fatal("equal title recorded a correction", string(same.body))
	}
	r := f.patch(t, `{"set":{"professional_title":"Corrected Engineer"}}`, same.header.Get("ETag"))
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	d = draftFlowObject(t, r.body)
	if d["professional_title"] != "Corrected Engineer" || d["original"].(map[string]any)["professional_title"] != "Snapshot Engineer" {
		t.Fatal(string(r.body))
	}
	if item := list(f.recruiter.token); item["professional_title"] != "Corrected Engineer" {
		t.Fatal(item)
	}
	// History records the snapshot as the uncorrected "from" value.
	changes := f.history(t, "")["items"].([]any)[0].(map[string]any)["changes"].([]any)
	if c := changes[0].(map[string]any); len(changes) != 1 || c["field"] != "professional_title" || c["from"] != "Snapshot Engineer" || c["to"] != "Corrected Engineer" {
		t.Fatal(changes)
	}
	reset := f.patch(t, `{"reset":["professional_title"]}`, r.header.Get("ETag"))
	if reset.status != 200 || draftFlowObject(t, reset.body)["professional_title"] != "Snapshot Engineer" {
		t.Fatal(reset.status, string(reset.body))
	}
}
