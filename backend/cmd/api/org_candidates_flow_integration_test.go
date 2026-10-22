//go:build integration

package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func orgCandidateKeys(t *testing.T, value any, keys ...string) map[string]any {
	t.Helper()
	obj, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %v", value)
	}
	got := make([]string, 0, len(obj))
	for key := range obj {
		got = append(got, key)
	}
	sort.Strings(got)
	sort.Strings(keys)
	if !reflect.DeepEqual(got, keys) {
		t.Fatalf("keys=%v want=%v", got, keys)
	}
	return obj
}

// Fixtures own their rows; auth, router, pool query and pagination are production.
func TestOrgCandidatesFlow(t *testing.T) {
	local, err := cvstorage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	h := newDraftFlowHarness(t, local)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	recruiter := h.actor(t, recruiterID, recruiterSub)
	other, otherID, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
	foreign := h.actor(t, otherID, otherSub)
	vacancy1 := publicationFlowReady(t, h, owner)
	publicFlowPublish(t, h, vacancy1, owner)
	vacancy2 := publicationFlowReady(t, h, owner)
	publicFlowPublish(t, h, vacancy2, owner)
	vacancy3 := publicationFlowReady(t, h, foreign)
	publicFlowPublish(t, h, vacancy3, foreign)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	var users []uuid.UUID
	var geoCleanup []string
	t.Cleanup(func() {
		for _, companyID := range []uuid.UUID{company.companyID, other.companyID} {
			for _, sql := range []string{
				`DELETE FROM process_participations WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
				`DELETE FROM company_candidate_cvs WHERE company_id=$1`,
				`DELETE FROM company_candidate_languages WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)`,
				`DELETE FROM company_candidates WHERE company_id=$1`,
			} {
				if _, err := h.pool.Exec(ctx, sql, companyID); err != nil {
					t.Error(err)
				}
			}
		}
		for _, id := range users {
			for _, sql := range []string{`DELETE FROM candidate_profiles WHERE user_id=$1`, `DELETE FROM candidate_cv_library WHERE candidate_id=$1`, `DELETE FROM candidate_cv_versions WHERE candidate_id=$1`, `DELETE FROM users WHERE id=$1`} {
				if _, err := h.pool.Exec(ctx, sql, id); err != nil {
					t.Error(err)
				}
			}
		}
		for i := len(geoCleanup) - 1; i >= 0; i-- {
			if _, err := h.pool.Exec(ctx, geoCleanup[i]); err != nil {
				t.Error(err)
			}
		}
	})
	// Remove only catalog rows this fixture actually inserted, in FK-safe order.
	for _, row := range []struct{ insert, cleanup string }{
		{`INSERT INTO geo_countries(code,name_es,name_en) VALUES('MX','México','Mexico') ON CONFLICT DO NOTHING`, `DELETE FROM geo_countries WHERE code='MX'`},
		{`INSERT INTO geo_countries(code,name_es,name_en) VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`, `DELETE FROM geo_countries WHERE code='US'`},
		{`INSERT INTO geo_states(country_code,code,name,abbreviation) VALUES('MX','14','Jalisco','Jal.') ON CONFLICT DO NOTHING`, `DELETE FROM geo_states WHERE country_code='MX' AND code='14'`},
		{`INSERT INTO geo_municipalities(country_code,state_code,code,name) VALUES('MX','14','14039','Guadalajara') ON CONFLICT DO NOTHING`, `DELETE FROM geo_municipalities WHERE country_code='MX' AND code='14039'`},
	} {
		tag, err := h.pool.Exec(ctx, row.insert)
		if err != nil {
			t.Fatal(err)
		}
		if tag.RowsAffected() == 1 {
			geoCleanup = append(geoCleanup, row.cleanup)
		}
	}
	manual := func(c, a uuid.UUID, name string) uuid.UUID {
		t.Helper()
		id := uuid.New()
		exec(`INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,state_code,municipality_code,professional_title,current_company,created_by,created_at) VALUES($1,$2,$3,$4,$4,'MX','14','14039','Engineer','Live Company',$5,'2026-01-01T00:00:00Z')`, id, c, name, strings.ToLower(name)+"@example.test", a)
		return id
	}
	standalone := manual(company.companyID, ownerID, "Standalone")
	missingManual := manual(company.companyID, ownerID, "Country Only")
	// Non-MX locations have missing subdivisions.
	exec(`UPDATE company_candidates SET country_code='US',state_code=NULL,municipality_code=NULL WHERE id=$1`, missingManual)
	_ = manual(other.companyID, otherID, "Foreign Manual")
	profile := func(years any, seniority any, completed any, ongoing any, spoken any) string {
		p := map[string]any{"location": map[string]any{"country": "MX", "state": "14", "municipality": "14039"}, "skills": []string{"Frozen Go"}, "years_of_experience": years, "seniority": seniority, "education": map[string]any{"highest_completed": completed, "in_progress": ongoing}, "languages": spoken}
		raw, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	empty := `{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]}`
	addParticipation := func(person uuid.UUID, kind, vacancy, source, snapshot, at string, discarded bool) string {
		t.Helper()
		pid := uuid.NewString()
		config := pipelineconfig.Defaults(uuid.MustParse(vacancy))
		stage := config.Stages[0].ID
		var candidate, manualID, cv, manualCV, added any
		if kind == "manual" {
			manualID = person
		} else {
			candidate = person
		}
		if source == "organic" {
			cv = uuid.New()
			key, err := local.Put(ctx, []byte("%PDF-o"))
			if err != nil {
				t.Fatal(err)
			}
			exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, person, key)
			exec(`INSERT INTO candidate_cv_library(id,candidate_id,version_id,name,removed_at) VALUES($1,$2,$3,'Frozen CV',now())`, uuid.New(), person, cv)
		} else {
			manualCV = uuid.New()
			added = ownerID
			c := company.companyID
			if vacancy == vacancy3 {
				c = other.companyID
				added = otherID
			}
			key, err := local.Put(ctx, []byte("%PDF-m"))
			if err != nil {
				t.Fatal(err)
			}
			exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,6,'application/pdf','private.pdf')`, manualCV, c, manualID, key)
		}
		var snap any
		if snapshot != "" {
			snap = snapshot
		}
		appliedAt, err := time.Parse(time.RFC3339, at)
		if err != nil {
			t.Fatal(err)
		}
		exec(`INSERT INTO process_participations(id,process_id,candidate_id,company_candidate_id,stage_id,cv_version_id,company_candidate_cv_id,added_by,source,profile_snapshot,questions_snapshot,answers_snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'[]','[]',$11)`, pid, vacancy, candidate, manualID, stage, cv, manualCV, added, source, snap, appliedAt)
		if discarded {
			exec(`UPDATE process_participations SET stage_id=$2,previous_stage_id=$3,reason_group='candidate',reason_code='unresponsive',discarded_at=created_at WHERE id=$1`, pid, config.Exit.ID, stage)
		}
		return pid
	}
	organic := func(name string) uuid.UUID {
		t.Helper()
		id := uuid.New()
		users = append(users, id)
		exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,$4,'candidate')`, id, uuid.NewString(), strings.ReplaceAll(strings.ToLower(name), " ", ".")+"@example.test", name)
		return id
	}
	reused := organic("Reused")
	firstPID := addParticipation(reused, "organic", vacancy1, "organic", profile("0.9", "junior", "bachelor", nil, []any{map[string]any{"code": "en", "level": "C2"}}), "2026-02-01T00:00:00Z", false)
	latest := profile("1.5", "senior", "technical", "master", []any{map[string]any{"code": "es", "level": "native"}, map[string]any{"code": "en", "level": "B2"}})
	reusedPID := addParticipation(reused, "organic", vacancy2, "manual", latest, "2026-03-01T00:00:00Z", true)
	// A still-newer participation in another company cannot choose the profile.
	foreignPID := addParticipation(reused, "organic", vacancy3, "organic", empty, "2026-12-01T00:00:00Z", false)
	noProfile := organic("No Profile")
	addParticipation(noProfile, "organic", vacancy1, "organic", "", "2026-03-01T00:00:00Z", false)
	_ = organic("Never Applied")
	foreignOnly := organic("Foreign Organic")
	addParticipation(foreignOnly, "organic", vacancy3, "organic", empty, "2026-12-01T00:00:00Z", false)
	yearsIDs := map[string]string{}
	for _, year := range []string{"0", "0.9", "1", "3", "4.9", "5", "60"} {
		id := organic("Years" + year)
		yearsIDs[year] = id.String()
		addParticipation(id, "organic", vacancy1, "organic", profile(year, "junior", "bachelor", nil, []any{map[string]any{"code": "en", "level": "C2"}}), "2026-02-01T00:00:00Z", false)
	}
	manualPID := addParticipation(standalone, "manual", vacancy1, "manual", empty, "2026-01-01T00:00:00Z", false)
	// Live organic private information is deliberately different from the snapshot.
	exec(`INSERT INTO candidate_profiles(user_id,professional_title,current_company,skills) VALUES($1,'LIVE PRIVATE TITLE','LIVE PRIVATE COMPANY',ARRAY['LIVE PRIVATE SKILL'])`, reused)
	t.Run("detail and exact CV", func(t *testing.T) {
		exec(`UPDATE candidate_profiles SET phone='  +523312345678  ' WHERE user_id=$1`, reused)
		exec(`UPDATE company_candidates SET phone='+523311111111' WHERE id=$1`, standalone)
		exec(`UPDATE process_participations SET comment='Private discard' WHERE id=$1`, reusedPID)
		config := pipelineconfig.Defaults(uuid.MustParse(vacancy1))
		subID := uuid.NewString()
		catalog, _ := json.Marshal(map[string]any{"substates": []any{map[string]any{"id": subID, "name": "Waiting"}}})
		exec(`INSERT INTO job_draft_substate_catalogs(draft_id,version,catalog) VALUES($1,1,$2) ON CONFLICT(draft_id) DO UPDATE SET catalog=excluded.catalog`, vacancy1, catalog)
		exec(`UPDATE process_participations SET stage_id=$2,substate_id=$3 WHERE id=$1`, firstPID, config.Stages[3].ID, subID)
		// This detail-only placement must not change the later T2 pipeline PUT's impact.
		t.Cleanup(func() {
			exec(`UPDATE process_participations SET stage_id=$2,substate_id=NULL WHERE id=$1`, firstPID, config.Stages[0].ID)
		})
		detail := func(kind string, id uuid.UUID) map[string]any {
			t.Helper()
			r := h.do(t, "GET", orgCandidatesPath+"/"+kind+"/"+id.String(), "", recruiter.token, nil)
			draftFlowAssertNoStore(t, r)
			if r.status != 200 {
				t.Fatalf("%d %s", r.status, r.body)
			}
			d := orgCandidateKeys(t, draftFlowObject(t, r.body), "kind", "id", "full_name", "professional_title", "current_company", "contact", "profile", "participations", "created_by", "created_at", "etag", "updated_at", "updated_by", "corrected_fields", "original", "skills", "linkedin_url", "portfolio_url", "education")
			orgCandidateKeys(t, d["contact"], "email", "phone")
			if d["created_by"] != nil {
				orgCandidateKeys(t, d["created_by"], "id", "name")
			}
			orgCandidateKeys(t, d["profile"], "location", "skills", "years_of_experience", "seniority", "education", "languages")
			for _, raw := range d["participations"].([]any) {
				p := orgCandidateKeys(t, raw, "id", "vacancy", "stage", "state", "substate", "discard", "source", "applied_at", "added_by", "cv", "original_cv")
				v := orgCandidateKeys(t, p["vacancy"], "id", "title", "lifecycle")
				orgCandidateKeys(t, v["lifecycle"], "publication", "process")
				orgCandidateKeys(t, p["stage"], "id", "name")
				if p["substate"] != nil {
					orgCandidateKeys(t, p["substate"], "id", "name")
				}
				if p["cv"] != nil {
					cv := orgCandidateKeys(t, p["cv"], "file_name", "uploaded_at", "source")
					if cv["source"] != "candidate" || p["original_cv"] != nil {
						t.Fatal(p)
					}
				}
				if p["added_by"] != nil {
					orgCandidateKeys(t, p["added_by"], "id", "name")
				}
				if p["discard"] != nil {
					disc := orgCandidateKeys(t, p["discard"], "reason", "comment", "discarded_at")
					orgCandidateKeys(t, disc["reason"], "group", "key")
				}
			}
			return d
		}
		d := detail("organic", reused)
		if d["education"] != nil || d["original"].(map[string]any)["education"] != nil {
			t.Fatal("organic snapshots have no full studies", d)
		}
		r := h.do(t, "GET", orgCandidatesPath+"/organic/"+reused.String()+"/history", "", recruiter.token, nil)
		if r.status != 200 || strings.TrimSpace(string(r.body)) != `{"items":[],"next_cursor":null}` {
			t.Fatal(r.status, string(r.body))
		}
		ps := d["participations"].([]any)
		if len(ps) != 2 || ps[0].(map[string]any)["id"] != reusedPID || ps[1].(map[string]any)["id"] != firstPID || d["created_by"] != nil || d["created_at"] != "2026-02-01T00:00:00Z" || d["professional_title"] != nil || d["current_company"] != nil {
			t.Fatal(d)
		}
		if d["contact"].(map[string]any)["phone"] != "+523312345678" || d["contact"].(map[string]any)["email"] != "reused@example.test" || d["profile"].(map[string]any)["skills"].([]any)[0] != "Frozen Go" || d["profile"].(map[string]any)["years_of_experience"] != "1.5" {
			t.Fatal(d)
		}
		recent, first := ps[0].(map[string]any), ps[1].(map[string]any)
		if recent["source"] != "manual" || recent["state"] != "discarded" || recent["substate"] != nil || recent["discard"].(map[string]any)["comment"] != "Private discard" || first["discard"] != nil || first["substate"].(map[string]any)["name"] != "Waiting" || first["added_by"] != nil {
			t.Fatal(ps)
		}
		m := detail("manual", standalone)
		if m["contact"].(map[string]any)["phone"] != "+523311111111" || m["contact"].(map[string]any)["email"] != "standalone@example.test" || m["created_at"] != "2026-01-01T00:00:00Z" || m["created_by"].(map[string]any)["id"] != ownerID.String() || m["professional_title"] != "Engineer" || m["current_company"] != "Live Company" {
			t.Fatal(m)
		}
		if !reflect.DeepEqual(detail("organic", noProfile)["contact"], map[string]any{"email": "no.profile@example.test", "phone": nil}) {
			t.Fatal("missing live profile contact rule")
		}
		if len(detail("manual", missingManual)["participations"].([]any)) != 0 {
			t.Fatal("standalone participation")
		}
		exec(`UPDATE users SET deleted_at=now() WHERE id=$1`, ownerID)
		if detail("manual", missingManual)["created_by"].(map[string]any)["name"] != nil {
			t.Fatal("deleted creator leaked")
		}
		exec(`UPDATE users SET deleted_at=NULL WHERE id=$1`, ownerID)
		for _, tc := range []struct {
			kind                string
			id                  uuid.UUID
			pid, body, filename string
		}{{"manual", standalone, manualPID, "%PDF-m", "private.pdf.pdf"}, {"organic", reused, reusedPID, "%PDF-m", "private.pdf.pdf"}, {"organic", reused, firstPID, "%PDF-o", `"Frozen CV.pdf"`}} {
			r := h.do(t, "GET", orgCandidatesPath+"/"+tc.kind+"/"+tc.id.String()+"/participations/"+tc.pid+"/cv", "", recruiter.token, nil)
			draftFlowAssertNoStore(t, r)
			if r.status != 200 || string(r.body) != tc.body || r.header.Get("Content-Type") != "application/pdf" || r.header.Get("Content-Length") != "6" || r.header.Get("X-Content-Type-Options") != "nosniff" || r.header.Get("Content-Disposition") != "attachment; filename="+tc.filename {
				t.Fatal(r.status, string(r.body), r.header)
			}
		}
		for _, suffix := range []string{"/unknown/" + reused.String(), "/manual/bad", "/organic/" + foreignOnly.String(), "/manual/" + standalone.String() + "/participations/" + firstPID + "/cv", "/organic/" + reused.String() + "/participations/" + manualPID + "/cv", "/organic/" + reused.String() + "/participations/" + foreignPID + "/cv"} {
			r := h.do(t, "GET", orgCandidatesPath+suffix, "", recruiter.token, nil)
			draftFlowAssertNoStore(t, r)
			if r.status != 404 || draftFlowCatalogCode(t, r.body) != "not_found" {
				t.Fatal(r.status, string(r.body))
			}
		}
		r = h.do(t, "GET", orgCandidatesPath+"/manual/"+standalone.String(), "", foreign.token, nil)
		if r.status != 404 {
			t.Fatal(r.status, string(r.body))
		}
	})
	get := func(t *testing.T, actor draftFlowActor, query string) map[string]any {
		t.Helper()
		r := h.do(t, "GET", orgCandidatesPath+query, "", actor.token, nil)
		draftFlowAssertNoStore(t, r)
		if r.status != 200 {
			t.Fatalf("GET %s: %d %s", query, r.status, r.body)
		}
		return orgCandidateKeys(t, draftFlowObject(t, r.body), "items", "total", "next_cursor")
	}
	ids := func(page map[string]any) []string {
		out := []string{}
		for _, item := range page["items"].([]any) {
			out = append(out, item.(map[string]any)["id"].(string))
		}
		sort.Strings(out)
		return out
	}
	t.Run("membership privacy latest snapshot", func(t *testing.T) {
		page := get(t, recruiter, "")
		if page["total"] != float64(11) || len(page["items"].([]any)) != 11 {
			t.Fatal(page)
		}
		if !reflect.DeepEqual(ids(page), ids(get(t, owner, ""))) {
			t.Fatal("non-principal recruiter cannot see whole pool")
		}
		for _, raw := range page["items"].([]any) {
			item := orgCandidateKeys(t, raw, "kind", "id", "full_name", "professional_title", "current_company", "profile", "participations", "latest_participation", "last_activity_at")
			p := orgCandidateKeys(t, item["profile"], "location", "skills", "years_of_experience", "seniority", "education", "languages")
			orgCandidateKeys(t, p["education"], "highest_completed", "in_progress")
			for _, language := range p["languages"].([]any) {
				orgCandidateKeys(t, language, "code", "level")
			}
			orgCandidateKeys(t, item["participations"], "total", "active")
			if loc := p["location"]; loc != nil {
				l := orgCandidateKeys(t, loc, "country", "state", "municipality", "postal_code", "label")
				orgCandidateKeys(t, l["country"], "id", "name")
				if l["state"] != nil {
					orgCandidateKeys(t, l["state"], "id", "name")
				}
				if l["municipality"] != nil {
					orgCandidateKeys(t, l["municipality"], "id", "name")
				}
			}
			if item["kind"] == "organic" && (item["professional_title"] != nil || item["current_company"] != nil) {
				t.Fatal(item)
			}
			if item["id"] == missingManual.String() {
				if item["latest_participation"] != nil || item["last_activity_at"] != "2026-01-01T00:00:00Z" || !reflect.DeepEqual(item["participations"], map[string]any{"total": float64(0), "active": float64(0)}) {
					t.Fatal(item)
				}
			}
			if item["id"] == reused.String() {
				if p["years_of_experience"] != "1.5" || p["seniority"] != "senior" || !reflect.DeepEqual(item["participations"], map[string]any{"total": float64(2), "active": float64(1)}) {
					t.Fatal(item)
				}
				lp := orgCandidateKeys(t, item["latest_participation"], "vacancy", "stage", "state", "applied_at")
				v := orgCandidateKeys(t, lp["vacancy"], "id", "title", "lifecycle")
				l := orgCandidateKeys(t, v["lifecycle"], "publication", "process")
				stage := orgCandidateKeys(t, lp["stage"], "id", "name")
				if stage["name"] != "Descartados" || lp["applied_at"] != "2026-03-01T00:00:00Z" || item["last_activity_at"] != lp["applied_at"] || !reflect.DeepEqual(p["skills"], []any{"Frozen Go"}) {
					t.Fatal(item)
				}
				if lp["state"] != "discarded" || v["id"] != vacancy2 || l["publication"] != "published" || l["process"] != "active" {
					t.Fatal(item)
				}
			}
			if item["id"] == noProfile.String() {
				var want any
				_ = json.Unmarshal([]byte(empty), &want)
				if !reflect.DeepEqual(p, want) {
					t.Fatal(p)
				}
			}
			raw, _ := json.Marshal(item)
			if strings.Contains(string(raw), "PRIVATE") || strings.Contains(string(raw), "@example.test") {
				t.Fatal("privacy leak", string(raw))
			}
		}
	})
	t.Run("paging total tie order default bounds", func(t *testing.T) {
		all := get(t, recruiter, "?limit=50")
		wantOrder := []string{}
		for _, r := range all["items"].([]any) {
			wantOrder = append(wantOrder, r.(map[string]any)["id"].(string))
		}
		got := []string{}
		query := "?limit=1"
		for n := 0; n < 12; n++ {
			page := get(t, recruiter, query)
			if page["total"] != all["total"] {
				t.Fatal(page)
			}
			for _, r := range page["items"].([]any) {
				got = append(got, r.(map[string]any)["id"].(string))
			}
			if page["next_cursor"] == nil {
				break
			}
			query = "?limit=1&cursor=" + url.QueryEscape(page["next_cursor"].(string))
		}
		if !reflect.DeepEqual(got, wantOrder) {
			t.Fatal(got, wantOrder)
		}
		// Independently establish the mixed DESC/ASC tuple order, not just page parity.
		items := all["items"].([]any)
		for i := 1; i < len(items); i++ {
			a, b := items[i-1].(map[string]any), items[i].(map[string]any)
			x, y := a["last_activity_at"].(string), b["last_activity_at"].(string)
			if x < y || (x == y && fmt.Sprint(a["kind"], a["id"]) > fmt.Sprint(b["kind"], b["id"])) {
				t.Fatal(a, b)
			}
		}
		if len(get(t, recruiter, "")["items"].([]any)) != 11 {
			t.Fatal("default limit")
		}
		page := get(t, recruiter, "?limit=1&years=0_1&years=1_3")
		token := page["next_cursor"].(string)
		equivalent := get(t, recruiter, "?limit=50&years=1_3&years=0_1&cursor="+url.QueryEscape(token))
		if equivalent["total"] != float64(4) {
			t.Fatal(equivalent)
		}
		for _, query := range []string{"?origin=manual&cursor=" + url.QueryEscape(token), "?cursor=" + url.QueryEscape(token)} {
			r := h.do(t, "GET", orgCandidatesPath+query, "", recruiter.token, nil)
			draftFlowAssertCatalogError(t, r, 400, "invalid_cursor")
		}
		r := h.do(t, "GET", orgCandidatesPath+"?years=0_1&years=1_3&cursor="+url.QueryEscape(token), "", foreign.token, nil)
		draftFlowAssertCatalogError(t, r, 400, "invalid_cursor")
		decoded, _ := base64.RawURLEncoding.DecodeString(token)
		var doc map[string]any
		_ = json.Unmarshal(decoded, &doc)
		beyond := strings.Replace(string(decoded), doc["last_activity_at"].(string), "1900-01-01T00:00:00.000000Z", 1)
		emptyPage := get(t, recruiter, "?years=0_1&years=1_3&cursor="+base64.RawURLEncoding.EncodeToString([]byte(beyond)))
		if len(emptyPage["items"].([]any)) != 0 || emptyPage["total"] != float64(4) || emptyPage["next_cursor"] != nil {
			t.Fatal(emptyPage)
		}
		doc["version"] = 2
		raw, _ := json.Marshal(doc)
		r = h.do(t, "GET", orgCandidatesPath+"?cursor="+base64.RawURLEncoding.EncodeToString(raw), "", recruiter.token, nil)
		draftFlowAssertCatalogError(t, r, 400, "invalid_cursor")
	})
	organicIDs := []string{reused.String(), noProfile.String()}
	yearOnlyIDs := []string{}
	for _, id := range yearsIDs {
		organicIDs = append(organicIDs, id)
		yearOnlyIDs = append(yearOnlyIDs, id)
	}
	allIDs := append(append([]string{}, organicIDs...), standalone.String(), missingManual.String())
	participatingIDs := append(append([]string{}, organicIDs...), standalone.String())
	filterCases := []struct {
		name, query string
		want        []string
	}{
		{"manual", "origin=manual", []string{standalone.String(), missingManual.String()}},
		{"organic identity regardless of source", "origin=organic", organicIDs},
		{"q organic email", "q=REUSED%40example.test", []string{reused.String()}},
		{"state OR none", "state=14&state=none", allIDs},
		{"municipality OR none", "municipality=14039&municipality=none", allIDs},
		{"vacancy OR", "vacancy=" + vacancy1 + "&vacancy=" + vacancy2, participatingIDs},
		{"language without minimum", "language=es", []string{reused.String()}},
		{"language C2 excludes B2", "language=en&language_min_level=C2", yearOnlyIDs},
		{"language missing OR selected with min", "language=none&language=es&language_min_level=native", []string{standalone.String(), missingManual.String(), noProfile.String(), reused.String()}},
		{"education false excludes ongoing", "education_level=master&education_in_progress=false", []string{}},
		{"seniority OR", "seniority=none&seniority=senior", []string{standalone.String(), missingManual.String(), noProfile.String(), reused.String()}},
		{"years missing OR decimal", "years=none&years=1_3", []string{standalone.String(), missingManual.String(), noProfile.String(), reused.String(), yearsIDs["1"]}},
		{"q wildcard underscore literal", "q=_", []string{}},
		{"empty pool result", "q=absent", []string{}},
		{"q name", "q=rEuSeD", []string{reused.String()}},
		{"q email", "q=standalone%40example.test", []string{standalone.String()}},
		{"q literal percent", "q=%25", []string{}},
		{"state", "state=14&origin=manual", []string{standalone.String()}},
		{"municipality", "municipality=14039&origin=manual", []string{standalone.String()}},
		{"state none", "state=none", []string{missingManual.String(), noProfile.String()}},
		{"municipality none", "municipality=none", []string{missingManual.String(), noProfile.String()}},
		{"seniority", "seniority=senior", []string{reused.String()}},
		{"seniority none", "seniority=none", []string{standalone.String(), missingManual.String(), noProfile.String()}},
		{"year 0_1", "years=0_1", []string{yearsIDs["0"], yearsIDs["0.9"]}},
		{"year 1_3", "years=1_3", []string{yearsIDs["1"], reused.String()}},
		{"year 3_5", "years=3_5", []string{yearsIDs["3"], yearsIDs["4.9"]}},
		{"year 5_plus", "years=5_plus", []string{yearsIDs["5"], yearsIDs["60"]}},
		{"years none", "years=none", []string{standalone.String(), missingManual.String(), noProfile.String()}},
		{"language min native", "language=en&language_min_level=native", []string{}},
		{"language native selected", "language=es&language_min_level=native", []string{reused.String()}},
		{"language or", "language=es&language=fr&language_min_level=C1", []string{reused.String()}},
		{"language none", "language=none", []string{standalone.String(), missingManual.String(), noProfile.String()}},
		{"education excludes ongoing", "education_level=master", []string{}},
		{"education includes ongoing", "education_level=master&education_in_progress=true", []string{reused.String()}},
		{"education tsu order", "education_level=tsu&seniority=senior", []string{}},
		{"education technical", "education_level=technical&seniority=senior", []string{reused.String()}},
		{"cross-key and", "years=0_1&seniority=senior", []string{}},
		{"vacancy latest not required", "vacancy=" + vacancy1 + "&seniority=senior", []string{reused.String()}},
		{"vacancy second", "vacancy=" + vacancy2, []string{reused.String()}},
	}
	for _, tc := range filterCases {
		t.Run(tc.name, func(t *testing.T) {
			page := get(t, recruiter, "?limit=50&"+tc.query)
			sort.Strings(tc.want)
			if got := ids(page); !reflect.DeepEqual(got, tc.want) || page["total"] != float64(len(tc.want)) {
				t.Fatalf("ids=%v total=%v want=%v", got, page["total"], tc.want)
			}
		})
	}
	t.Run("catalog errors even on empty results", func(t *testing.T) {
		for _, tc := range []struct{ query, field, code string }{
			{"vacancy=" + vacancy3, "vacancy", "not_found"}, {"vacancy=" + uuid.NewString(), "vacancy", "not_found"}, {"state=99", "state", "invalid"}, {"municipality=99999", "municipality", "invalid"},
			{"vacancy=" + vacancy1 + "&vacancy=" + vacancy3, "vacancy", "not_found"},
		} {
			r := h.do(t, "GET", orgCandidatesPath+"?q=absent&"+tc.query, "", recruiter.token, nil)
			draftFlowAssertNoStore(t, r)
			obj := draftFlowObject(t, r.body)
			want := []any{map[string]any{"field": tc.field, "code": tc.code}}
			if r.status != 400 || obj["code"] != "invalid_filter" || !reflect.DeepEqual(obj["fields"], want) {
				t.Fatal(r.status, string(r.body))
			}
		}
	})
	t.Run("stored pipeline names and lifecycle pair", func(t *testing.T) {
		config := pipelineconfig.Defaults(uuid.MustParse(vacancy1))
		config.Stages[0].Name = "Renamed for pool"
		path := draftFlowV2Path + "/" + vacancy1 + "/pipeline"
		before := h.do(t, "GET", path, "", owner.token, nil)
		saved := h.do(t, "PUT", path, pipelineFlowBody(t, config), owner.token, map[string]string{"If-Match": before.header.Get("ETag")})
		if saved.status != 200 {
			t.Fatal(saved.status, string(saved.body))
		}
		page := get(t, recruiter, "?q=no+profile")
		lp := page["items"].([]any)[0].(map[string]any)["latest_participation"].(map[string]any)
		if lp["stage"].(map[string]any)["name"] != "Renamed for pool" {
			t.Fatal(lp)
		}
		// Inspect the actual lifecycle columns, not an invented unified status.
		exec(`UPDATE vacancy_processes SET status='paused',paused_at=now() WHERE id=$1`, vacancy1)
		page = get(t, recruiter, "?q=no+profile")
		lp = page["items"].([]any)[0].(map[string]any)["latest_participation"].(map[string]any)
		lifecycle := lp["vacancy"].(map[string]any)["lifecycle"]
		if !reflect.DeepEqual(lifecycle, map[string]any{"publication": "paused", "process": "active"}) {
			t.Fatal(lifecycle)
		}
		exec(`UPDATE vacancy_processes SET status='closed',closed_at=now(),process_status='finished',process_finished_at=now() WHERE id=$1`, vacancy1)
		page = get(t, recruiter, "?q=no+profile")
		lp = page["items"].([]any)[0].(map[string]any)["latest_participation"].(map[string]any)
		if !reflect.DeepEqual(lp["vacancy"].(map[string]any)["lifecycle"], map[string]any{"publication": "closed", "process": "finished"}) {
			t.Fatal(lp)
		}
		if get(t, recruiter, "")["total"] != float64(11) {
			t.Fatal("finished participations left the pool")
		}
		exec(`UPDATE vacancy_processes SET status='published',paused_at=NULL,closed_at=NULL,process_status='active',process_finished_at=NULL WHERE id=$1`, vacancy1)
	})
	t.Run("latest timestamp ties choose highest participation id", func(t *testing.T) {
		var oldPID string
		if err := h.pool.QueryRow(ctx, `SELECT id FROM process_participations WHERE candidate_id=$1 AND process_id=$2`, reused, vacancy1).Scan(&oldPID); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			exec(`UPDATE process_participations SET created_at='2026-02-01T00:00:00Z' WHERE id=$1`, oldPID)
		})
		exec(`UPDATE process_participations SET created_at='2026-03-01T00:00:00Z' WHERE id=$1`, oldPID)
		want := "1.5"
		if oldPID > reusedPID {
			want = "0.9"
		}
		page := get(t, recruiter, "?q=reused")
		item := page["items"].([]any)[0].(map[string]any)
		if item["profile"].(map[string]any)["years_of_experience"] != want {
			t.Fatal(item)
		}
	})
	t.Run("education threshold order and statuses on live manual", func(t *testing.T) {
		t.Cleanup(func() { exec(`DELETE FROM company_candidate_educations WHERE company_candidate_id=$1`, standalone) })
		levels := []string{"secondary", "high_school", "technical", "tsu", "bachelor", "specialty", "master", "phd"}
		exec(`INSERT INTO company_candidate_educations(company_candidate_id,position,level,status) VALUES($1,0,'secondary','completed')`, standalone)
		for i, completed := range levels {
			exec(`UPDATE company_candidate_educations SET level=$2 WHERE company_candidate_id=$1`, standalone, completed)
			for j, minimum := range levels {
				t.Run(completed+"_min_"+minimum, func(t *testing.T) {
					page := get(t, recruiter, "?q=standalone&education_level="+minimum)
					want := float64(0)
					if i >= j {
						want = 1
					}
					if page["total"] != want {
						t.Fatal(completed, minimum, page)
					}
				})
			}
		}
		exec(`UPDATE company_candidate_educations SET level='bachelor' WHERE company_candidate_id=$1`, standalone)
		exec(`INSERT INTO company_candidate_educations(company_candidate_id,position,level,status) VALUES($1,1,'master','in_progress'),($1,2,'phd','paused'),($1,3,'phd','incomplete')`, standalone)
		for _, tc := range []struct {
			query string
			total float64
		}{{"education_level=master", 0}, {"education_level=master&education_in_progress=true", 1}, {"education_level=phd&education_in_progress=true", 0}} {
			page := get(t, recruiter, "?q=standalone&"+tc.query)
			if page["total"] != tc.total {
				t.Fatal(page)
			}
		}
		item := get(t, recruiter, "?q=standalone")["items"].([]any)[0].(map[string]any)
		if !reflect.DeepEqual(item["profile"].(map[string]any)["education"], map[string]any{"highest_completed": "bachelor", "in_progress": "master"}) {
			t.Fatal(item)
		}
	})
	t.Run("language threshold order on live manual", func(t *testing.T) {
		t.Cleanup(func() { exec(`DELETE FROM company_candidate_languages WHERE company_candidate_id=$1`, standalone) })
		levels := []string{"A1", "A2", "B1", "B2", "C1", "C2", "native"}
		exec(`INSERT INTO company_candidate_languages(company_candidate_id,code,level) VALUES($1,'en','A1')`, standalone)
		for i, level := range levels {
			exec(`UPDATE company_candidate_languages SET level=$2 WHERE company_candidate_id=$1`, standalone, level)
			for j, minimum := range levels {
				t.Run(level+"_min_"+minimum, func(t *testing.T) {
					page := get(t, recruiter, "?q=standalone&language=en&language_min_level="+minimum)
					want := float64(0)
					if i >= j {
						want = 1
					}
					if page["total"] != want {
						t.Fatal(level, minimum, page)
					}
				})
			}
		}
		exec(`INSERT INTO company_candidate_languages(company_candidate_id,code,level) VALUES($1,'es','B2')`, standalone)
		item := get(t, recruiter, "?q=standalone")["items"].([]any)[0].(map[string]any)
		if !reflect.DeepEqual(item["profile"].(map[string]any)["languages"], []any{map[string]any{"code": "en", "level": "native"}, map[string]any{"code": "es", "level": "B2"}}) {
			t.Fatal(item)
		}
	})
	t.Run("live manual frozen organic", func(t *testing.T) {
		exec(`UPDATE company_candidates SET years_of_experience=0.9,seniority='lead',professional_title='Updated live' WHERE id=$1`, standalone)
		page := get(t, recruiter, "?origin=manual&years=0_1")
		if !reflect.DeepEqual(ids(page), []string{standalone.String()}) {
			t.Fatal(page)
		}
		if page["items"].([]any)[0].(map[string]any)["professional_title"] != "Updated live" {
			t.Fatal(page)
		}
	})
	t.Run("real gates", func(t *testing.T) {
		for _, tc := range []struct {
			token  string
			status int
		}{{"", 401}, {h.signer.expiredToken(t, ownerSub), 401}} {
			r := h.do(t, "GET", orgCandidatesPath, "", tc.token, nil)
			draftFlowAssertNoStore(t, r)
			if r.status != tc.status {
				t.Fatal(r.status, string(r.body))
			}
		}
		var sub string
		_ = h.pool.QueryRow(ctx, `SELECT cognito_sub FROM users WHERE id=$1`, noProfile).Scan(&sub)
		r := h.do(t, "GET", orgCandidatesPath, "", h.signer.validToken(t, sub), nil)
		draftFlowAssertNoStore(t, r)
		if r.status != 403 {
			t.Fatal(r.status, string(r.body))
		}
	})
}
