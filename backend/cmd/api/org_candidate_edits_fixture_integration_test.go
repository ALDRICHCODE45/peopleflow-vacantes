//go:build integration

package main

import (
	"context"
	"encoding/json"
	"testing"

	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/google/uuid"
)

type candidateEditFixture struct {
	h                         *draftFlowHarness
	company                   *draftFlowCompany
	owner, recruiter, foreign draftFlowActor
	id                        uuid.UUID
	path                      string
}

func newCandidateEditFixture(t *testing.T, files ...*cvstorage.Local) *candidateEditFixture {
	t.Helper()
	h := newDraftFlowHarness(t, files...)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	rid, rsub := company.addUser(t, "recruiter")
	_, fid, fsub := draftFlowNewPrincipal(t, h.pool, "active")
	f := &candidateEditFixture{h: h, company: company, owner: h.actor(t, ownerID, ownerSub), recruiter: h.actor(t, rid, rsub), foreign: h.actor(t, fid, fsub), id: uuid.New()}
	f.path = orgCandidatesPath + "/manual/" + f.id.String()
	ctx := context.Background()
	var geoCleanup []string
	// Clean only this fixture's private rows before company/actor cleanup.
	t.Cleanup(func() {
		for _, query := range []string{
			`DELETE FROM company_candidate_history WHERE candidate_id=$1`,
			`DELETE FROM audit_events WHERE entity_id=$1`,
			`DELETE FROM company_candidate_languages WHERE company_candidate_id=$1`,
			`DELETE FROM company_candidate_educations WHERE company_candidate_id=$1`,
			`DELETE FROM company_candidates WHERE id=$1`,
		} {
			if _, err := h.pool.Exec(ctx, query, f.id); err != nil {
				t.Error(err)
			}
		}
		for i := len(geoCleanup) - 1; i >= 0; i-- {
			if _, err := h.pool.Exec(ctx, geoCleanup[i]); err != nil {
				t.Error(err)
			}
		}
	})
	for _, row := range []struct{ insert, cleanup string }{
		{`INSERT INTO geo_countries VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`, `DELETE FROM geo_countries WHERE code='US'`},
		{`INSERT INTO geo_countries VALUES('MX','México','Mexico') ON CONFLICT DO NOTHING`, `DELETE FROM geo_countries WHERE code='MX'`},
		{`INSERT INTO geo_states(country_code,code,name,abbreviation) VALUES('MX','14','Jalisco','Jal.') ON CONFLICT DO NOTHING`, `DELETE FROM geo_states WHERE country_code='MX' AND code='14'`},
		{`INSERT INTO geo_municipalities VALUES('MX','14','14039','Guadalajara') ON CONFLICT DO NOTHING`, `DELETE FROM geo_municipalities WHERE country_code='MX' AND code='14039'`},
	} {
		tag, err := h.pool.Exec(ctx, row.insert)
		if err != nil {
			t.Fatal(err)
		}
		if tag.RowsAffected() == 1 {
			geoCleanup = append(geoCleanup, row.cleanup)
		}
	}
	f.exec(t, `INSERT INTO company_candidates(id,company_id,created_by,full_name,email,email_normalized,country_code,professional_title,current_company,seniority,years_of_experience,skills,linkedin_url,portfolio_url) VALUES($1,$2,$3,'Initial Candidate','initial@example.test','initial@example.test','US','Engineer','Initial Company','junior',2,ARRAY['go','sql'],'https://example.test/in/initial','https://example.test/initial')`, f.id, company.companyID, ownerID)
	f.exec(t, `INSERT INTO company_candidate_educations(company_candidate_id,position,level,institution,field,status,start_year,end_year) VALUES($1,0,'bachelor','UNAM','Computación','completed',2015,2019)`, f.id)
	f.exec(t, `INSERT INTO company_candidate_languages VALUES($1,'en','B1')`, f.id)
	return f
}
func (f *candidateEditFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.h.pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}
func (f *candidateEditFixture) detail(t *testing.T) draftFlowResponse {
	t.Helper()
	r := f.h.do(t, "GET", f.path, "", f.recruiter.token, nil)
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if tag, _ := draftFlowObject(t, r.body)["etag"].(string); tag == "" || tag != r.header.Get("ETag") {
		t.Fatal("missing/mismatched etag", string(r.body))
	}
	return r
}
func (f *candidateEditFixture) patch(t *testing.T, body, tag string) draftFlowResponse {
	t.Helper()
	return f.h.do(t, "PATCH", f.path, body, f.recruiter.token, map[string]string{"If-Match": tag})
}
func (f *candidateEditFixture) counts(t *testing.T) (int, int) {
	t.Helper()
	return draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_history WHERE candidate_id=$1`, f.id), draftFlowAuditCount(t, f.h.pool, f.id, "CompanyCandidateEdited")
}
func (f *candidateEditFixture) history(t *testing.T, query string) map[string]any {
	t.Helper()
	r := f.h.do(t, "GET", f.path+"/history"+query, "", f.recruiter.token, nil)
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	return orgCandidateKeys(t, draftFlowObject(t, r.body), "items", "next_cursor")
}
func editJSONEqual(t *testing.T, a, b any) {
	t.Helper()
	ar, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	br, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	var av, bv any
	if err = json.Unmarshal(ar, &av); err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(br, &bv); err != nil {
		t.Fatal(err)
	}
	ar, _ = json.Marshal(av)
	br, _ = json.Marshal(bv)
	if string(ar) != string(br) {
		t.Fatalf("got %s want %s", ar, br)
	}
}
