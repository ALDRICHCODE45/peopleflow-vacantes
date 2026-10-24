//go:build integration

package main

import (
	"encoding/json"
	"net/url"
	"sort"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestOrgCandidateCorrectionsFlow(t *testing.T) {
	f := newOrganicEditFixture(t)
	initial := f.detail(t)
	d := draftFlowObject(t, initial.body)
	tag := initial.header.Get("ETag")
	owned := organicOwnedBytes(t, f)
	var originalValues map[string]any
	if err := json.Unmarshal([]byte(`{"location":{"country":"US","state":null,"municipality":null,"postal_code":null},"professional_title":null,"current_company":null,"seniority":"junior","years_of_experience":"2","education":null,"languages":[{"code":"en","level":"B1"}],"skills":["frozen"],"linkedin_url":null,"portfolio_url":null}`), &originalValues); err != nil {
		t.Fatal(err)
	}
	original := orgCandidateKeys(t, d["original"], "full_name", "contact", "professional_title", "current_company", "profile", "linkedin_url", "portfolio_url", "education")
	if original["full_name"] != "Original Candidate" || original["education"] != nil || d["education"] != nil || len(d["corrected_fields"].([]any)) != 0 || d["updated_at"] != nil || d["updated_by"] != nil {
		t.Fatal(d)
	}
	editJSONEqual(t, original["contact"], map[string]any{"email": f.email, "phone": "+523311111111"})
	for _, k := range []string{"professional_title", "current_company", "linkedin_url", "portfolio_url"} {
		if original[k] != nil {
			t.Fatal(original)
		}
	}
	p := original["profile"].(map[string]any)
	if p["seniority"] != "junior" || p["years_of_experience"] != "2" {
		t.Fatal(p)
	}
	foreignBefore := f.h.do(t, "GET", f.path, "", f.foreign.token, nil)
	if foreignBefore.status != 200 {
		t.Fatal(foreignBefore.status, string(foreignBefore.body))
	}
	t.Run("gates preconditions identity and validation", func(t *testing.T) {
		_, outsiderID, outsiderSub := draftFlowNewPrincipal(t, f.h.pool, "active")
		outsider := f.h.actor(t, outsiderID, outsiderSub)
		for _, token := range []string{"", `"stale"`, `W/` + tag, "*", tag + `, "other"`, foreignBefore.header.Get("ETag")} {
			r := f.patch(t, `{"set":{"professional_title":"Rejected"}}`, token)
			status, code := 412, "precondition_failed"
			if token == "" {
				status, code = 428, "precondition_required"
			}
			draftFlowAssertError(t, r, status, code)
			if len(draftFlowObject(t, r.body)) != 2 {
				t.Fatal(string(r.body))
			}
		}
		for _, suffix := range []string{"", "/history"} {
			method := "PATCH"
			if suffix != "" {
				method = "GET"
			}
			r := f.h.do(t, method, f.path+suffix, `{"set":{"phone":null}}`, "", map[string]string{"If-Match": tag})
			draftFlowAssertError(t, r, 401, "unauthenticated")
			r = f.h.do(t, method, f.path+suffix, `{"set":{"phone":null}}`, outsider.token, map[string]string{"If-Match": tag})
			draftFlowAssertError(t, r, 404, "not_found")
		}
		for _, tc := range editInvalidCases() {
			if tc.name == "reset manual" {
				continue
			}
			t.Run(tc.name, func(t *testing.T) {
				r := f.patch(t, tc.body, tag)
				code := "invalid_request"
				if tc.field != "" {
					code = "validation_error"
				}
				draftFlowAssertError(t, r, 400, code)
			})
		}
		draftFlowAssertError(t, f.patch(t, `{"reset":["seniority"]}`, tag), 400, "invalid_request")
		for _, suffix := range []string{"", "/history"} {
			method := "PATCH"
			if suffix != "" {
				method = "GET"
			}
			r := f.h.do(t, method, orgCandidatesPath+"/organic/"+uuid.NewString()+suffix, `{"set":{"phone":null}}`, f.recruiter.token, map[string]string{"If-Match": tag})
			draftFlowAssertError(t, r, 404, "not_found")
		}
		if got := f.detail(t); string(got.body) != string(initial.body) {
			t.Fatal("rejection changed detail")
		}
		if h, a := f.counts(t); h != 0 || a != 0 {
			t.Fatal(h, a)
		}
	})
	t.Run("set all fields and effective projections", func(t *testing.T) {
		body := `{"set":{"full_name":"Corrected Candidate","email":"effective@example.test","phone":"+523312345678","location":{"country":"MX","state":"14","municipality":"14039","postal_code":null},"professional_title":"Corrected Engineer","current_company":"Corrected Company","seniority":"lead","years_of_experience":"5.5","education":[{"level":"phd","institution":null,"field":null,"status":"paused","start_year":null,"end_year":null},{"level":"technical","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null},` + editStudy + `,{"level":"master","institution":null,"field":null,"status":"in_progress","start_year":null,"end_year":null},{"level":"technical","institution":null,"field":null,"status":"in_progress","start_year":null,"end_year":null},{"level":"phd","institution":null,"field":null,"status":"incomplete","start_year":null,"end_year":null}],"languages":[{"code":"es","level":"native"}],"skills":["React","TypeScript","SQL","react","REACT"],"linkedin_url":"https://example.test/corrected","portfolio_url":"https://example.test/portfolio"}}`
		r := f.patch(t, body, tag)
		draftFlowAssertNoStore(t, r)
		if r.status != 200 || r.header.Get("ETag") == tag {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		d = draftFlowObject(t, r.body)
		editJSONEqual(t, d, draftFlowObject(t, f.detail(t).body))
		if d["full_name"] != "Corrected Candidate" || d["professional_title"] != "Corrected Engineer" || d["current_company"] != "Corrected Company" || d["updated_by"].(map[string]any)["id"] != f.recruiter.userID.String() || d["updated_at"] == nil {
			t.Fatal(d)
		}
		editJSONEqual(t, d["original"], original)
		editJSONEqual(t, d["contact"], map[string]any{"email": "effective@example.test", "phone": "+523312345678"})
		wantFields := []string{"full_name", "email", "phone", "location", "professional_title", "current_company", "seniority", "years_of_experience", "education", "languages", "skills", "linkedin_url", "portfolio_url"}
		sort.Strings(wantFields)
		editJSONEqual(t, d["corrected_fields"], wantFields)
		profile := d["profile"].(map[string]any)
		orgCandidateKeys(t, profile, "location", "skills", "years_of_experience", "seniority", "education", "languages")
		editJSONEqual(t, profile["education"], map[string]any{"highest_completed": "bachelor", "in_progress": "master"})
		editJSONEqual(t, d["skills"], []string{"React", "TypeScript", "SQL"})
		editJSONEqual(t, profile["skills"], []string{"React", "TypeScript", "SQL"})
		for _, study := range d["education"].([]any) {
			orgCandidateKeys(t, study, "level", "institution", "field", "status", "start_year", "end_year")
		}
		// Every filter uses effective values before count, cursor and page projection.
		matches := func(query string, want bool) {
			t.Helper()
			r := f.h.do(t, "GET", orgCandidatesPath+"?origin=organic&"+query, "", f.recruiter.token, nil)
			if r.status != 200 {
				t.Fatal(r.status, string(r.body))
			}
			page := draftFlowObject(t, r.body)
			n := float64(0)
			if want {
				n = 1
			}
			if page["total"] != n {
				t.Fatalf("%s: %s", query, r.body)
			}
			if want {
				item := page["items"].([]any)[0].(map[string]any)
				if item["full_name"] != "Corrected Candidate" || item["professional_title"] != "Corrected Engineer" || item["current_company"] != "Corrected Company" {
					t.Fatal(item)
				}
				editJSONEqual(t, item["profile"], profile)
				if _, exists := item["contact"]; exists {
					t.Fatal("contact leaked")
				}
			}
		}
		for _, q := range []string{"q=corrected", "q=effective%40example.test", "state=14", "municipality=14039", "seniority=lead", "years=5_plus", "language=es&language_min_level=native", "education_level=bachelor", "education_level=master&education_in_progress=true", "state=14&municipality=14039&seniority=lead&years=5_plus&language=es&education_level=master&education_in_progress=true"} {
			matches(q, true)
		}
		for _, q := range []string{"q=original", "state=none", "municipality=none", "seniority=junior", "years=1_3", "language=en", "education_level=master", "education_level=phd&education_in_progress=true"} {
			matches(q, false)
		}
		// Vacancy membership and lifecycle remain participation-derived, not corrected.
		ps := d["participations"].([]any)
		vacancy := ps[0].(map[string]any)["vacancy"].(map[string]any)["id"].(string)
		matches("vacancy="+vacancy, true)
		foreignAfter := f.h.do(t, "GET", f.path, "", f.foreign.token, nil)
		if string(foreignAfter.body) != string(foreignBefore.body) || foreignAfter.header.Get("ETag") != foreignBefore.header.Get("ETag") {
			t.Fatal("cross-company correction leak", string(foreignAfter.body))
		}
		for _, tc := range []struct {
			query string
			total float64
		}{{"q=effective", 0}, {"q=original", 1}} {
			r := f.h.do(t, "GET", orgCandidatesPath+"?origin=organic&"+tc.query, "", f.foreign.token, nil)
			if r.status != 200 || draftFlowObject(t, r.body)["total"] != tc.total {
				t.Fatal("foreign list correction leak", r.status, string(r.body))
			}
			if tc.total == 1 {
				item := draftFlowObject(t, r.body)["items"].([]any)[0].(map[string]any)
				if item["full_name"] != "Original Candidate" || item["professional_title"] != nil || item["current_company"] != nil {
					t.Fatal(item)
				}
			}
		}
		history := f.history(t, "")
		changes := history["items"].([]any)[0].(map[string]any)["changes"].([]any)
		if len(changes) != 13 {
			t.Fatal(changes)
		}
		var request struct{ Set map[string]any }
		if err := json.Unmarshal([]byte(body), &request); err != nil {
			t.Fatal(err)
		}
		request.Set["skills"] = []string{"React", "TypeScript", "SQL"}
		for _, raw := range changes {
			c := raw.(map[string]any)
			key := c["field"].(string)
			if key == "full_name" || key == "email" || key == "phone" {
				orgCandidateKeys(t, c, "field", "contact")
				if c["contact"] != true {
					t.Fatal(c)
				}
			} else {
				orgCandidateKeys(t, c, "field", "from", "to")
				editJSONEqual(t, c["from"], originalValues[key])
				editJSONEqual(t, c["to"], request.Set[key])
			}
		}
		var raw, metadata []byte
		if err := f.h.pool.QueryRow(t.Context(), `SELECT changes FROM company_candidate_history WHERE company_id=$1 AND candidate_id=$2`, f.company.companyID, f.id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "effective@example.test") || strings.Contains(string(raw), "Corrected Candidate") || strings.Contains(string(raw), "+523312345678") {
			t.Fatal("stored contact values")
		}
		if err := f.h.pool.QueryRow(t.Context(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='CompanyCandidateEdited'`, f.id).Scan(&metadata); err != nil {
			t.Fatal(err)
		}
		editJSONEqual(t, orgCandidateKeys(t, draftFlowObject(t, metadata), "fields")["fields"], wantFields)
		if h, a := f.counts(t); h != 1 || a != 1 {
			t.Fatal(h, a)
		}
	})
	t.Run("noop null arrays resets and history", func(t *testing.T) {
		before := f.detail(t)
		r := f.patch(t, `{"set":{"full_name":" Corrected Candidate ","years_of_experience":"5.5"}}`, tag)
		if r.status != 200 || string(r.body) != string(before.body) || r.header.Get("ETag") != tag {
			t.Fatal(r.status, string(r.body))
		}
		r = f.patch(t, `{"set":{"phone":null,"skills":null,"languages":null,"professional_title":null,"current_company":null,"seniority":null,"years_of_experience":null,"linkedin_url":null,"portfolio_url":null}}`, tag)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		d = draftFlowObject(t, r.body)
		if d["contact"].(map[string]any)["phone"] != nil || d["professional_title"] != nil || len(d["skills"].([]any)) != 0 {
			t.Fatal(d)
		}
		for _, q := range []string{"seniority=none", "years=none", "language=none"} {
			r = f.h.do(t, "GET", orgCandidatesPath+"?origin=organic&"+q, "", f.recruiter.token, nil)
			if r.status != 200 || draftFlowObject(t, r.body)["total"] != float64(1) {
				t.Fatal(q, r.status, string(r.body))
			}
		}
		r = f.patch(t, `{"set":{"email":null}}`, tag)
		draftFlowAssertError(t, r, 400, "validation_error")
		editJSONEqual(t, draftFlowObject(t, r.body)["fields"], []map[string]any{{"field": "contact", "code": "required"}})
		// Resetting phone restores the current profile phone, allowing email to clear.
		r = f.patch(t, `{"reset":["phone"],"set":{"email":null}}`, tag)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		// Removing a correction is a real write even if it already equals original null.
		r = f.patch(t, `{"reset":["full_name","email","location","professional_title","current_company","seniority","years_of_experience","education","languages","skills","linkedin_url","portfolio_url"]}`, tag)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		d = draftFlowObject(t, r.body)
		if len(d["corrected_fields"].([]any)) != 0 || d["education"] != nil {
			t.Fatal(d)
		}
		editJSONEqual(t, d["profile"], original["profile"])
		editJSONEqual(t, d["contact"], original["contact"])
		editJSONEqual(t, d["original"], original)
		r = f.patch(t, `{"reset":["education"]}`, tag)
		draftFlowAssertError(t, r, 400, "invalid_request")
		history := f.history(t, "?limit=1")
		token := history["next_cursor"].(string)
		changes := history["items"].([]any)[0].(map[string]any)["changes"].([]any)
		for _, raw := range changes {
			c := raw.(map[string]any)
			if c["reset"] != true {
				t.Fatal(c)
			}
			key := c["field"].(string)
			switch key {
			case "full_name", "email":
				orgCandidateKeys(t, c, "field", "reset", "contact")
			default:
				orgCandidateKeys(t, c, "field", "reset", "from", "to")
				editJSONEqual(t, c["to"], originalValues[key])
			}
			if key == "education" && c["to"] != nil {
				t.Fatal(c)
			}
		}
		next := f.history(t, "?limit=50&cursor="+url.QueryEscape(token))
		if len(next["items"].([]any)) != 3 || next["next_cursor"] != nil {
			t.Fatal(next)
		}
		foreignHistory := f.h.do(t, "GET", f.path+"/history", "", f.foreign.token, nil)
		if foreignHistory.status != 200 || len(draftFlowObject(t, foreignHistory.body)["items"].([]any)) != 0 {
			t.Fatal(string(foreignHistory.body))
		}
		// Contact reset values must also be absent in persistent history, not just JSON.
		var all []byte
		if err := f.h.pool.QueryRow(t.Context(), `SELECT jsonb_agg(changes) FROM company_candidate_history WHERE candidate_id=$1`, f.id).Scan(&all); err != nil {
			t.Fatal(err)
		}
		var entries [][]map[string]any
		_ = json.Unmarshal(all, &entries)
		for _, entry := range entries {
			for _, c := range entry {
				key := c["field"]
				if key == "full_name" || key == "email" || key == "phone" {
					if _, ok := c["from"]; ok {
						t.Fatal(c)
					}
					if _, ok := c["to"]; ok {
						t.Fatal(c)
					}
				}
			}
		}
		if h, a := f.counts(t); h != 4 || a != 4 {
			t.Fatal(h, a)
		}
	})
	if after := organicOwnedBytes(t, f); after != owned {
		t.Fatal("candidate-owned rows or snapshot bytes changed")
	}
}
