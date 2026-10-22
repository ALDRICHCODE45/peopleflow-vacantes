//go:build integration

package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestOrgCandidateEditsFlow(t *testing.T) {
	f := newCandidateEditFixture(t)
	initial := f.detail(t)
	tag := initial.header.Get("ETag")
	d := orgCandidateKeys(t, draftFlowObject(t, initial.body), "kind", "id", "full_name", "professional_title", "current_company", "contact", "profile", "participations", "created_by", "created_at", "etag", "updated_at", "updated_by", "corrected_fields", "original", "skills", "linkedin_url", "portfolio_url", "education")
	if d["original"] != nil || len(d["corrected_fields"].([]any)) != 0 || len(d["education"].([]any)) != 1 {
		t.Fatal(d)
	}
	orgCandidateKeys(t, d["education"].([]any)[0], "level", "institution", "field", "status", "start_year", "end_year")
	t.Run("rejections are atomic", func(t *testing.T) {
		for _, tc := range editInvalidCases() {
			t.Run(tc.name, func(t *testing.T) {
				r := f.patch(t, tc.body, tag)
				code := "invalid_request"
				if tc.field != "" {
					code = "validation_error"
				}
				draftFlowAssertError(t, r, 400, code)
				if tc.field != "" {
					var body struct {
						Fields []struct{ Field, Code string }
					}
					if err := json.Unmarshal(r.body, &body); err != nil {
						t.Fatal(err)
					}
					found := false
					for _, field := range body.Fields {
						if strings.HasPrefix(field.Field, "candidate.") {
							t.Fatal(field)
						}
						if field.Field == tc.field && field.Code == tc.code {
							found = true
						}
					}
					if !found {
						t.Fatalf("missing %s/%s: %s", tc.field, tc.code, r.body)
					}
				}
				if got := f.detail(t); string(got.body) != string(initial.body) {
					t.Fatal("rejected request changed detail", string(got.body))
				}
				if h, a := f.counts(t); h != 0 || a != 0 {
					t.Fatal(h, a)
				}
			})
		}
		for _, token := range []string{"", `"stale"`, `W/` + tag, "*", tag + `, "other"`} {
			r := f.patch(t, `{"set":{"professional_title":"Rejected"}}`, token)
			status, code := 412, "precondition_failed"
			if token == "" {
				status = 428
				code = "precondition_required"
			}
			draftFlowAssertError(t, r, status, code)
			if len(draftFlowObject(t, r.body)) != 2 {
				t.Fatal(string(r.body))
			}
		}
		for _, method := range []string{"PATCH", "GET"} {
			path := f.path
			body := `{"set":{"full_name":"Foreign Write"}}`
			if method == "GET" {
				path += "/history"
				body = ""
			}
			r := f.h.do(t, method, path, body, f.foreign.token, map[string]string{"If-Match": tag})
			draftFlowAssertError(t, r, 404, "not_found")
		}
		if got := f.detail(t); string(got.body) != string(initial.body) {
			t.Fatal("rejection changed detail")
		}
		if h, a := f.counts(t); h != 0 || a != 0 {
			t.Fatal(h, a)
		}
	})
	t.Run("every field and exact private history", func(t *testing.T) {
		body := `{"set":{"full_name":"Updated Candidate","email":"updated@example.test","phone":"+523312345678","location":{"country":"MX","state":"14","municipality":"14039","postal_code":null},"professional_title":"Senior Engineer","current_company":"New Company","seniority":"senior","years_of_experience":"4.5","education":[{"level":"master","institution":"UNAM","field":"AI","status":"in_progress","start_year":2024,"end_year":null},` + editStudy + `],"languages":[{"code":"es","level":"native"},{"code":"en","level":"C1"}],"skills":["Rust"],"linkedin_url":"https://example.test/new-link","portfolio_url":"https://example.test/new-portfolio"}}`
		r := f.patch(t, body, tag)
		draftFlowAssertNoStore(t, r)
		if r.status != 200 || r.header.Get("ETag") == tag {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		got := f.detail(t)
		editJSONEqual(t, draftFlowObject(t, r.body), draftFlowObject(t, got.body))
		d = draftFlowObject(t, got.body)
		if d["etag"] != tag || d["full_name"] != "Updated Candidate" || d["professional_title"] != "Senior Engineer" || d["current_company"] != "New Company" || d["linkedin_url"] != "https://example.test/new-link" || d["portfolio_url"] != "https://example.test/new-portfolio" || d["updated_by"].(map[string]any)["id"] != f.recruiter.userID.String() || d["updated_at"] == nil {
			t.Fatal(d)
		}
		editJSONEqual(t, d["contact"], map[string]any{"email": "updated@example.test", "phone": "+523312345678"})
		p := d["profile"].(map[string]any)
		if p["seniority"] != "senior" || p["years_of_experience"] != "4.5" {
			t.Fatal(p)
		}
		editJSONEqual(t, p["skills"], []string{"rust"})
		editJSONEqual(t, d["skills"], []string{"rust"})
		editJSONEqual(t, p["languages"], []map[string]any{{"code": "en", "level": "C1"}, {"code": "es", "level": "native"}})
		editJSONEqual(t, p["education"], map[string]any{"highest_completed": "bachelor", "in_progress": "master"})
		location := p["location"].(map[string]any)
		if location["municipality"].(map[string]any)["id"] != "14039" || location["state"].(map[string]any)["id"] != "14" {
			t.Fatal(location)
		}
		studies := d["education"].([]any)
		if len(studies) != 2 || studies[0].(map[string]any)["status"] != "in_progress" || studies[1].(map[string]any)["level"] != "bachelor" {
			t.Fatal(studies)
		}
		for _, s := range studies {
			orgCandidateKeys(t, s, "level", "institution", "field", "status", "start_year", "end_year")
		}
		history := f.history(t, "")
		items := history["items"].([]any)
		if len(items) != 1 || history["next_cursor"] != nil {
			t.Fatal(history)
		}
		entry := orgCandidateKeys(t, items[0], "id", "at", "actor", "kind", "changes")
		if entry["kind"] != "edit" || entry["actor"].(map[string]any)["id"] != f.recruiter.userID.String() {
			t.Fatal(entry)
		}
		var before map[string]any
		_ = json.Unmarshal([]byte(editInitial), &before)
		var request struct{ Set map[string]any }
		_ = json.Unmarshal([]byte(body), &request)
		request.Set["skills"] = []any{"rust"}
		request.Set["languages"] = []map[string]any{{"code": "en", "level": "C1"}, {"code": "es", "level": "native"}}
		changes := entry["changes"].([]any)
		if len(changes) != 13 {
			t.Fatal(changes)
		}
		for _, raw := range changes {
			c := raw.(map[string]any)
			field := c["field"].(string)
			if field == "full_name" || field == "email" || field == "phone" {
				orgCandidateKeys(t, c, "field", "contact")
				if c["contact"] != true {
					t.Fatal(c)
				}
			} else {
				orgCandidateKeys(t, c, "field", "from", "to")
				editJSONEqual(t, c["from"], before[field])
				editJSONEqual(t, c["to"], request.Set[field])
			}
		}
		if h, a := f.counts(t); h != 1 || a != 1 {
			t.Fatal(h, a)
		}
		var stored, metadata []byte
		if err := f.h.pool.QueryRow(t.Context(), `SELECT changes FROM company_candidate_history WHERE candidate_id=$1`, f.id).Scan(&stored); err != nil {
			t.Fatal(err)
		}
		editJSONEqual(t, json.RawMessage(stored), changes)
		if strings.Contains(string(stored), "updated@example.test") || strings.Contains(string(stored), "Updated Candidate") || strings.Contains(string(stored), "+523312345678") {
			t.Fatal("contact values persisted")
		}
		if err := f.h.pool.QueryRow(t.Context(), `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='CompanyCandidateEdited'`, f.id).Scan(&metadata); err != nil {
			t.Fatal(err)
		}
		m := orgCandidateKeys(t, draftFlowObject(t, metadata), "fields")
		if len(m["fields"].([]any)) != 13 {
			t.Fatal(m)
		}
		// A recruiter who is neither creator nor principal edited the company record.
		// The list and its filters read live values without exposing contact.
		list := f.h.do(t, "GET", orgCandidatesPath+"?q=updated&seniority=senior&years=3_5&language=es&language_min_level=native", "", f.recruiter.token, nil)
		if list.status != 200 || draftFlowObject(t, list.body)["total"] != float64(1) {
			t.Fatal(list.status, string(list.body))
		}
		for _, item := range draftFlowObject(t, list.body)["items"].([]any) {
			if _, ok := item.(map[string]any)["contact"]; ok {
				t.Fatal("contact in list")
			}
		}
	})
	t.Run("no-op arrays replace and null clears", func(t *testing.T) {
		before := f.detail(t)
		r := f.patch(t, `{"set":{"years_of_experience":"4.5","full_name":" Updated Candidate "}}`, tag)
		if r.status != 200 || r.header.Get("ETag") != tag || string(r.body) != string(before.body) {
			t.Fatal(r.status, string(r.body))
		}
		if h, a := f.counts(t); h != 1 || a != 1 {
			t.Fatal(h, a)
		}
		r = f.patch(t, `{"set":{"skills":null,"languages":null,"phone":null,"professional_title":null,"current_company":null,"seniority":null,"years_of_experience":null,"linkedin_url":null,"portfolio_url":null,"education":[`+editStudy+`]}}`, tag)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		got := draftFlowObject(t, r.body)
		p := got["profile"].(map[string]any)
		if len(got["skills"].([]any)) != 0 || len(p["languages"].([]any)) != 0 || len(got["education"].([]any)) != 1 || got["contact"].(map[string]any)["phone"] != nil {
			t.Fatal(got)
		}
		for _, key := range []string{"professional_title", "current_company", "linkedin_url", "portfolio_url"} {
			if got[key] != nil {
				t.Fatal(got)
			}
		}
		if p["seniority"] != nil || p["years_of_experience"] != nil {
			t.Fatal(p)
		}
		r = f.patch(t, `{"set":{"email":null}}`, tag)
		draftFlowAssertError(t, r, 400, "validation_error")
		if h, a := f.counts(t); h != 2 || a != 2 {
			t.Fatal(h, a)
		}
		// Owner is also allowed, and email may clear when a phone remains.
		r = f.h.do(t, "PATCH", f.path, `{"set":{"email":null,"phone":"+523312345678"}}`, f.owner.token, map[string]string{"If-Match": tag})
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		tag = r.header.Get("ETag")
		r = f.patch(t, `{"set":{"email":"kept@example.test","phone":null}}`, tag)
		if r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
	})
	t.Run("history keyset ties binding and isolation", func(t *testing.T) {
		f.exec(t, `UPDATE company_candidate_history SET at='2026-01-01T00:00:00Z' WHERE candidate_id=$1`, f.id)
		first := f.history(t, "?limit=1")
		token := first["next_cursor"].(string)
		second := f.history(t, "?limit=2&cursor="+token)
		third := f.history(t, "?limit=50&cursor="+second["next_cursor"].(string))
		ids := []string{}
		for _, page := range []map[string]any{first, second, third} {
			for _, raw := range page["items"].([]any) {
				ids = append(ids, raw.(map[string]any)["id"].(string))
			}
		}
		if len(ids) != 4 || third["next_cursor"] != nil {
			t.Fatal(ids, third)
		}
		for i := 1; i < len(ids); i++ {
			if ids[i] >= ids[i-1] {
				t.Fatal("unstable tie ordering", ids)
			}
		}
		r := f.h.do(t, "GET", f.path+"/history?cursor="+token, "", f.foreign.token, nil)
		draftFlowAssertError(t, r, 400, "invalid_cursor")
		r = f.h.do(t, "GET", f.path+"/history", "", f.foreign.token, nil)
		draftFlowAssertError(t, r, 404, "not_found")
		// Actor names are nullable, but the actor's identity remains in history.
		f.exec(t, `UPDATE users SET deleted_at=now() WHERE id=$1`, f.owner.userID)
		page := f.history(t, "")
		found := false
		for _, raw := range page["items"].([]any) {
			actor := raw.(map[string]any)["actor"].(map[string]any)
			if actor["id"] == f.owner.userID.String() {
				found = true
				if actor["name"] != nil {
					t.Fatal(actor)
				}
			}
		}
		if !found {
			t.Fatal(page)
		}
		f.exec(t, `UPDATE users SET deleted_at=NULL WHERE id=$1`, f.owner.userID)
	})
	// Keep the final stored detail internally coherent with its history version.
	if h, a := f.counts(t); h != 4 || a != 4 {
		t.Fatal(h, a)
	}
}
