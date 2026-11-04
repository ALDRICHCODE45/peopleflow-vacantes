//go:build integration

package main

import (
	"fmt"
	"testing"
)

// Regression probes from the independent 2a verification (audit-log-v1 §2).

// Contacts across companies or with the wrong kind reveal nothing and record nothing.
func TestVerifyProbe_ContactsForeignAndWrongKindRecordNothing(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	company := f.company.companyID
	total := func() int {
		return draftFlowCount(t, f.h.pool, `SELECT count(*) FROM audit_events WHERE event_type='CompanyCandidateContactsRevealed' AND metadata::text LIKE '%'||$1||'%'`, f.id.String())
	}
	before, beforeCompany := total(), auditCompanyCount(t, f.h.pool, company)
	post := func(body, token string) draftFlowResponse {
		return f.h.do(t, "POST", orgCandidatesPath+"/contacts", body, token, map[string]string{"Content-Type": "application/json"})
	}
	for name, tc := range map[string]struct{ body, token string }{
		"foreign company": {fmt.Sprintf(`{"candidates":[{"kind":"manual","id":%q}]}`, f.id), f.foreign.token},
		"wrong kind":      {fmt.Sprintf(`{"candidates":[{"kind":"organic","id":%q}]}`, f.id), f.recruiter.token},
	} {
		r := post(tc.body, tc.token)
		items, ok := draftFlowObject(t, r.body)["items"].([]any)
		if r.status != 200 || !ok || len(items) != 0 {
			t.Fatalf("%s: %d %s", name, r.status, r.body)
		}
	}
	if total() != before || auditCompanyCount(t, f.h.pool, company) != beforeCompany {
		t.Fatal("a reveal of nothing wrote an audit row")
	}
}

// Pool CV of a participation reached through a different candidate path is 404 and records nothing.
func TestVerifyProbe_PoolCVOtherCandidatePathRecordsNothing(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	second := f.secondManual(t)
	before := auditCompanyCount(t, f.h.pool, f.company.companyID)
	path := orgCandidatesPath + "/manual/" + second.String() + "/participations/" + f.pid.String() + "/cv"
	draftFlowAssertError(t, f.h.do(t, "GET", path, "", f.recruiter.token, nil), 404, "not_found")
	if got := auditCompanyCount(t, f.h.pool, f.company.companyID); got != before {
		t.Fatalf("rejected download wrote %d rows", got-before)
	}
}
