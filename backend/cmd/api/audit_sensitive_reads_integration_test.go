//go:build integration

package main

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Sensitive reads (audit-log-v1 §2): one row per successful read, in the read's
// own transaction, fail-closed. Everything below goes through the real router,
// auth, talent base gate, stores and database.

func (f *candidateCVFixture) vacancy(t *testing.T) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.h.pool.QueryRow(context.Background(), `SELECT process_id FROM process_participations WHERE id=$1`, f.pid).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func (f *candidateCVFixture) boardPath(t *testing.T) string {
	t.Helper()
	return draftFlowV2Path + "/" + f.vacancy(t).String() + "/participations/" + f.pid.String()
}

// secondManual adds a second manual candidate to the fixture's company.
func (f *candidateCVFixture) secondManual(t *testing.T) uuid.UUID {
	t.Helper()
	id := uuid.New()
	f.exec(t, `INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,created_by) VALUES($1,$2,'Second Candidate',$3,$3,'US',$4)`, id, f.company.companyID, "second-"+id.String()+"@example.test", f.owner.userID)
	t.Cleanup(func() {
		f.exec(t, `DELETE FROM company_candidates WHERE id=$1`, id)
	})
	return id
}

func auditCleanupCompany(t *testing.T, f *candidateCVFixture) {
	t.Helper()
	t.Cleanup(func() {
		if err := auditDeleteCompany(f.h.pool, f.company.companyID); err != nil {
			t.Error(err)
		}
	})
}

func TestAuditSensitiveReads_PoolDetail(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			auditCleanupCompany(t, f)
			company := f.company.companyID
			want := wantAuditRow{actor: f.recruiter.userID, eventType: "CompanyCandidateViewed", entityType: "company_candidate", entityID: f.id, company: company, metadata: map[string]any{"kind": kind}}
			if n := len(auditRowsOf(t, f.h.pool, company, want.eventType)); n != 0 {
				t.Fatalf("rows before any read: %d", n)
			}

			first := f.detail(t)
			rows := auditRowsOf(t, f.h.pool, company, want.eventType)
			if len(rows) != 1 {
				t.Fatalf("rows after one read = %d, want 1", len(rows))
			}
			assertAuditRow(t, rows[0], want)

			// No deduplication: the same person reading again is a second row, and the
			// response itself is untouched by the audit.
			second := f.detail(t)
			if string(second.body) != string(first.body) || second.header.Get("ETag") != first.header.Get("ETag") {
				t.Fatal("repeated read changed the response")
			}
			if n := len(auditRowsOf(t, f.h.pool, company, want.eventType)); n != 2 {
				t.Fatalf("rows after two reads = %d, want 2", n)
			}

			// The API has no 304 path on this route: a revalidation still returns the
			// body, and the person saw the data, so it is a third row.
			reval := f.h.do(t, "GET", f.path, "", f.recruiter.token, map[string]string{"If-None-Match": first.header.Get("ETag")})
			if reval.status != 200 || string(reval.body) != string(first.body) {
				t.Fatalf("revalidation: %d %s", reval.status, reval.body)
			}
			if n := len(auditRowsOf(t, f.h.pool, company, want.eventType)); n != 3 {
				t.Fatalf("rows after revalidation = %d, want 3", n)
			}

			// An owner reading is attributed to the owner.
			f.h.do(t, "GET", f.path, "", f.owner.token, nil)
			rows = auditRowsOf(t, f.h.pool, company, want.eventType)
			if len(rows) != 4 {
				t.Fatalf("rows = %d, want 4", len(rows))
			}
			want.actor = f.owner.userID
			assertAuditRow(t, rows[3], want)
		})
	}
}

func TestAuditSensitiveReads_PoolDetailRejectionsWriteNothing(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	company := f.company.companyID
	before := auditCompanyCount(t, f.h.pool, company)
	for _, tc := range []struct {
		name, path, token string
		status            int
		code              string
	}{
		{"unknown candidate", orgCandidatesPath + "/manual/" + uuid.NewString(), f.recruiter.token, 404, "not_found"},
		{"invalid kind", orgCandidatesPath + "/other/" + f.id.String(), f.recruiter.token, 404, "not_found"},
		{"invalid id", orgCandidatesPath + "/manual/not-a-uuid", f.recruiter.token, 404, "not_found"},
		{"other company", f.path, f.foreign.token, 404, "not_found"},
		{"unauthenticated", f.path, "", 401, "unauthenticated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := f.h.do(t, "GET", tc.path, "", tc.token, nil)
			draftFlowAssertError(t, r, tc.status, tc.code)
		})
	}
	if got := auditCompanyCount(t, f.h.pool, company); got != before {
		t.Fatalf("rejected reads wrote %d rows", got-before)
	}
}

func TestAuditSensitiveReads_PoolCV(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			auditCleanupCompany(t, f)
			company := f.company.companyID
			vacancy := f.vacancy(t)
			base := f.path + "/participations/" + f.pid.String()
			for _, tc := range []struct{ path, variant string }{{base + "/cv", "current"}, {base + "/cv/original", "original"}} {
				before := len(auditRowsOf(t, f.h.pool, company, "CompanyCandidateCVDownloaded"))
				r := f.h.do(t, "GET", tc.path, "", f.recruiter.token, nil)
				if r.status != 200 || string(r.body) != "%PDF-original" {
					t.Fatalf("%s: %d %q", tc.variant, r.status, r.body)
				}
				if r.header.Get("Content-Type") != "application/pdf" || r.header.Get("Content-Length") != "13" || r.header.Get("X-Content-Type-Options") != "nosniff" || !strings.HasPrefix(r.header.Get("Content-Disposition"), "attachment;") {
					t.Fatalf("%s headers changed: %v", tc.variant, r.header)
				}
				rows := auditRowsOf(t, f.h.pool, company, "CompanyCandidateCVDownloaded")
				if len(rows) != before+1 {
					t.Fatalf("%s: rows = %d, want %d", tc.variant, len(rows), before+1)
				}
				assertAuditRow(t, rows[before], wantAuditRow{
					actor: f.recruiter.userID, eventType: "CompanyCandidateCVDownloaded", entityType: "company_candidate", entityID: f.id,
					company: company, vacancy: &vacancy,
					metadata: map[string]any{"kind": kind, "participation_id": f.pid.String(), "variant": tc.variant},
				})
			}

			// Rejections write nothing: unknown participation, a participation of
			// another candidate path, other company, unauthenticated.
			before := auditCompanyCount(t, f.h.pool, company)
			for _, path := range []string{
				f.path + "/participations/" + uuid.NewString() + "/cv",
				f.path + "/participations/" + uuid.NewString() + "/cv/original",
				f.path + "/participations/not-a-uuid/cv",
			} {
				draftFlowAssertError(t, f.h.do(t, "GET", path, "", f.recruiter.token, nil), 404, "not_found")
			}
			draftFlowAssertError(t, f.h.do(t, "GET", base+"/cv", "", f.foreign.token, nil), 404, "not_found")
			draftFlowAssertError(t, f.h.do(t, "GET", base+"/cv/original", "", "", nil), 401, "unauthenticated")
			if got := auditCompanyCount(t, f.h.pool, company); got != before {
				t.Fatalf("rejected downloads wrote %d rows", got-before)
			}
		})
	}
}

func TestAuditSensitiveReads_Contacts(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	company := f.company.companyID
	second := f.secondManual(t)
	post := func(body string, token string) draftFlowResponse {
		return f.h.do(t, "POST", orgCandidatesPath+"/contacts", body, token, map[string]string{"Content-Type": "application/json"})
	}
	// Requested in reverse id order: the row stores them sorted, the response keeps request order.
	ids := []uuid.UUID{f.id, second}
	if ids[0].String() < ids[1].String() {
		ids[0], ids[1] = ids[1], ids[0]
	}
	r := post(fmt.Sprintf(`{"candidates":[{"kind":"manual","id":%q},{"kind":"manual","id":%q}]}`, ids[0], ids[1]), f.recruiter.token)
	if r.status != 200 {
		t.Fatalf("contacts: %d %s", r.status, r.body)
	}
	items := draftFlowObject(t, r.body)["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["id"] != ids[0].String() || items[0].(map[string]any)["email"] == nil {
		t.Fatalf("response changed: %s", r.body)
	}
	rows := auditRowsOf(t, f.h.pool, company, "CompanyCandidateContactsRevealed")
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{
		actor: f.recruiter.userID, eventType: "CompanyCandidateContactsRevealed", entityType: "company", entityID: company, company: company,
		metadata: map[string]any{"count": float64(2), "candidates": []any{
			map[string]any{"kind": "manual", "id": ids[1].String()},
			map[string]any{"kind": "manual", "id": ids[0].String()},
		}},
	})
	// IDs only: the revealed values never reach the audit row.
	var raw string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT metadata::text FROM audit_events WHERE company_id=$1 AND event_type='CompanyCandidateContactsRevealed'`, company).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "@") || strings.Contains(raw, "example.test") || strings.Contains(raw, "email") || strings.Contains(raw, "phone") {
		t.Fatalf("contact values leaked into the audit row: %s", raw)
	}

	// A second reveal is a second row (no dedup); only the candidates actually
	// revealed are listed: an unknown id in the request reveals nothing.
	r = post(fmt.Sprintf(`{"candidates":[{"kind":"manual","id":%q},{"kind":"manual","id":%q}]}`, f.id, uuid.NewString()), f.owner.token)
	if r.status != 200 {
		t.Fatalf("contacts: %d %s", r.status, r.body)
	}
	rows = auditRowsOf(t, f.h.pool, company, "CompanyCandidateContactsRevealed")
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	assertAuditRow(t, rows[1], wantAuditRow{
		actor: f.owner.userID, eventType: "CompanyCandidateContactsRevealed", entityType: "company", entityID: company, company: company,
		metadata: map[string]any{"count": float64(1), "candidates": []any{map[string]any{"kind": "manual", "id": f.id.String()}}},
	})

	// Nothing revealed, nothing recorded; and rejected requests write nothing.
	before := auditCompanyCount(t, f.h.pool, company)
	r = post(fmt.Sprintf(`{"candidates":[{"kind":"manual","id":%q}]}`, uuid.NewString()), f.recruiter.token)
	if got, ok := draftFlowObject(t, r.body)["items"].([]any); r.status != 200 || !ok || len(got) != 0 {
		t.Fatalf("unknown candidate: %d %s", r.status, r.body)
	}
	for _, tc := range []struct {
		name, body, token string
		status            int
		code              string
	}{
		{"empty list", `{"candidates":[]}`, f.recruiter.token, 400, "validation_error"},
		{"bad kind", `{"candidates":[{"kind":"x","id":"` + f.id.String() + `"}]}`, f.recruiter.token, 400, "validation_error"},
		{"duplicate", fmt.Sprintf(`{"candidates":[{"kind":"manual","id":%q},{"kind":"manual","id":%q}]}`, f.id, f.id), f.recruiter.token, 400, "validation_error"},
		{"bad json", `{`, f.recruiter.token, 400, "invalid_request"},
		{"unauthenticated", `{"candidates":[]}`, "", 401, "unauthenticated"},
	} {
		draftFlowAssertError(t, post(tc.body, tc.token), tc.status, tc.code)
	}
	if got := auditCompanyCount(t, f.h.pool, company); got != before {
		t.Fatalf("empty or rejected reveals wrote %d rows", got-before)
	}
}

func TestAuditSensitiveReads_BoardDetailAndCV(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	company := f.company.companyID
	vacancy := f.vacancy(t)
	base := f.boardPath(t)

	// Detail: the response is the board's, the row is the participation's.
	r := f.h.do(t, "GET", base, "", f.owner.token, nil)
	if r.status != 200 || draftFlowObject(t, r.body)["id"] != f.pid.String() {
		t.Fatalf("detail: %d %s", r.status, r.body)
	}
	rows := auditRowsOf(t, f.h.pool, company, "ParticipationViewed")
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	assertAuditRow(t, rows[0], wantAuditRow{actor: f.owner.userID, eventType: "ParticipationViewed", entityType: "process_participation", entityID: f.pid, company: company, vacancy: &vacancy, metadata: map[string]any{}})
	if again := f.h.do(t, "GET", base, "", f.owner.token, nil); string(again.body) != string(r.body) {
		t.Fatal("repeated read changed the response")
	}
	if n := len(auditRowsOf(t, f.h.pool, company, "ParticipationViewed")); n != 2 {
		t.Fatalf("rows = %d, want 2 (no dedup)", n)
	}

	for _, tc := range []struct{ path, variant string }{{base + "/cv", "current"}, {base + "/cv/original", "original"}} {
		before := len(auditRowsOf(t, f.h.pool, company, "ParticipationCVDownloaded"))
		cv := f.h.do(t, "GET", tc.path, "", f.owner.token, nil)
		if cv.status != 200 || string(cv.body) != "%PDF-original" || cv.header.Get("Content-Type") != "application/pdf" || cv.header.Get("Cache-Control") != "no-store" || !strings.HasPrefix(cv.header.Get("Content-Disposition"), "attachment;") {
			t.Fatalf("%s: %d %q %v", tc.variant, cv.status, cv.body, cv.header)
		}
		rows = auditRowsOf(t, f.h.pool, company, "ParticipationCVDownloaded")
		if len(rows) != before+1 {
			t.Fatalf("%s rows = %d, want %d", tc.variant, len(rows), before+1)
		}
		assertAuditRow(t, rows[before], wantAuditRow{actor: f.owner.userID, eventType: "ParticipationCVDownloaded", entityType: "process_participation", entityID: f.pid, company: company, vacancy: &vacancy, metadata: map[string]any{"variant": tc.variant}})
	}

	// Rejections write nothing.
	snapshot := auditCompanyCount(t, f.h.pool, company)
	missing := draftFlowV2Path + "/" + vacancy.String() + "/participations/" + uuid.NewString()
	for _, path := range []string{missing, missing + "/cv", missing + "/cv/original"} {
		draftFlowAssertError(t, f.h.do(t, "GET", path, "", f.owner.token, nil), 404, "not_found")
	}
	for _, path := range []string{base, base + "/cv", base + "/cv/original"} {
		draftFlowAssertError(t, f.h.do(t, "GET", path, "", f.foreign.token, nil), 404, "not_found")
		draftFlowAssertError(t, f.h.do(t, "GET", path, "", "", nil), 401, "unauthenticated")
	}
	draftFlowAssertError(t, f.h.do(t, "GET", draftFlowV2Path+"/not-a-uuid/participations/"+f.pid.String(), "", f.owner.token, nil), 400, "invalid_request")
	if got := auditCompanyCount(t, f.h.pool, company); got != snapshot {
		t.Fatalf("rejected reads wrote %d rows", got-snapshot)
	}
}

// A failing audit insert fails the read with 500 and serves nothing (fail-closed).
func TestAuditSensitiveReads_FailClosed(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	auditCleanupCompany(t, f)
	company := f.company.companyID
	pool := f.h.pool
	base := f.path + "/participations/" + f.pid.String()
	board := f.boardPath(t)
	routes := []struct {
		name, method, path, body, token string
	}{
		{"pool detail", "GET", f.path, "", f.recruiter.token},
		{"pool cv", "GET", base + "/cv", "", f.recruiter.token},
		{"pool cv original", "GET", base + "/cv/original", "", f.recruiter.token},
		{"contacts", "POST", orgCandidatesPath + "/contacts", fmt.Sprintf(`{"candidates":[{"kind":"manual","id":%q}]}`, f.id), f.recruiter.token},
		{"board detail", "GET", board, "", f.owner.token},
		{"board cv", "GET", board + "/cv", "", f.owner.token},
		{"board cv original", "GET", board + "/cv/original", "", f.owner.token},
	}
	// The fixture's own setup already audited (vacancy, publication): count from there.
	baseline := auditCompanyCount(t, pool, company)
	allow := auditBlock(t, pool, company, "CompanyCandidateViewed", "CompanyCandidateCVDownloaded", "CompanyCandidateContactsRevealed", "ParticipationViewed", "ParticipationCVDownloaded")
	for _, tc := range routes {
		t.Run(tc.name, func(t *testing.T) {
			r := f.h.do(t, tc.method, tc.path, tc.body, tc.token, map[string]string{"Content-Type": "application/json"})
			draftFlowAssertCatalogError(t, r, 500, "internal_error")
			if strings.Contains(string(r.body), "PDF") || strings.Contains(string(r.body), f.email) || strings.Contains(r.header.Get("Content-Disposition"), "attachment") {
				t.Fatalf("nothing may be served when the audit fails: %v %s", r.header, r.body)
			}
		})
	}
	if n := auditCompanyCount(t, pool, company); n != baseline {
		t.Fatalf("a failed audit left %d rows", n-baseline)
	}
	allow()
	for _, tc := range routes {
		if r := f.h.do(t, tc.method, tc.path, tc.body, tc.token, map[string]string{"Content-Type": "application/json"}); r.status != 200 {
			t.Fatalf("%s after unblocking: %d %s", tc.name, r.status, r.body)
		}
	}
	if n := auditCompanyCount(t, pool, company); n != baseline+len(routes) {
		t.Fatalf("rows after unblocking = %d, want %d", n-baseline, len(routes))
	}
}
