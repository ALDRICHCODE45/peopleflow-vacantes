//go:build integration

package main

import (
	"context"
	"encoding/json"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func publicFlowGet(t *testing.T, h *draftFlowHarness, path string, status int) map[string]any {
	t.Helper()
	r := h.do(t, "GET", path, "", "", nil)
	if r.status != status || r.header.Get("ETag") != "" || r.header.Get("Cache-Control") != "" {
		t.Fatalf("%s: %d %s %v", path, r.status, r.body, r.header)
	}
	return draftFlowObject(t, r.body)
}
func publicFlowPublish(t *testing.T, h *draftFlowHarness, id string, owner draftFlowActor) time.Time {
	t.Helper()
	base := draftFlowV2Path + "/" + id
	draft := h.do(t, "GET", base, "", owner.token, nil)
	published := h.do(t, "POST", base+"/publication", `{}`, owner.token, map[string]string{"If-Match": draft.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if published.status != 201 {
		t.Fatalf("publish=%s", published.body)
	}
	at, err := time.Parse(time.RFC3339Nano, draftFlowObject(t, published.body)["publishedAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	return at
}
func publicFlowPatch(t *testing.T, h *draftFlowHarness, id string, owner draftFlowActor, fields map[string]any) {
	t.Helper()
	base := draftFlowV2Path + "/" + id
	draft := h.do(t, "GET", base, "", owner.token, nil)
	body, err := json.Marshal(map[string]any{"fields": fields})
	if err != nil {
		t.Fatal(err)
	}
	saved := h.do(t, "PATCH", base, string(body), owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatalf("patch=%d %s", saved.status, saved.body)
	}
}
func publicFlowLegacy(t *testing.T, h *draftFlowHarness, company uuid.UUID, title, description, location string, at time.Time, min *int) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := h.pool.Exec(context.Background(), `INSERT INTO jobs(id,company_id,title,description,location,work_mode,employment_type,seniority,status,published_at,salary_min,salary_currency) VALUES($1,$2,$3,$4,$5,'remote','contract','senior','published',$6,$7,'USD')`, id, company, title, description, location, at, min); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id=$1 AND company_id=$2`, id, company); err != nil {
			t.Errorf("cleanup public catalog fixture: %v", err)
		}
	})
	return id
}

// Synthetic catalog display names exercise labels without sending free text
// through the structured write boundary; search isolation uses the title marker.
func publicFlowLocation(t *testing.T, h *draftFlowHarness, label string) map[string]any {
	t.Helper()
	if _, err := h.pool.Exec(context.Background(), `INSERT INTO geo_countries(code,name_es,name_en) VALUES('CO',$1,'Colombia') ON CONFLICT(code) DO UPDATE SET name_es=EXCLUDED.name_es`, label); err != nil {
		t.Fatal(err)
	}
	return map[string]any{"country": "CO"}
}

func publicFlowAssertKeys(t *testing.T, item map[string]any, detail bool) {
	t.Helper()
	want := []string{"id", "source", "title", "company", "location", "location_label", "remote_scope", "work_mode", "work_schedule", "contract_type", "professional_area", "seniority", "legacy_employment_type", "compensation", "legacy_salary", "published_at", "excerpt", "excerpt_truncated", "benefits_preview", "benefits_total", "skills_preview", "skills_total", "applicants", "screening_questions", "requirements_profile"}
	if detail {
		want = append(want, "description", "description_plain", "requirements", "benefits", "skills")
	}
	if len(item) != len(want) {
		t.Fatalf("keys=%v", item)
	}
	for _, k := range want {
		if _, ok := item[k]; !ok {
			t.Fatalf("missing %s", k)
		}
	}
	company := item["company"].(map[string]any)
	if len(company) != 3 || company["id"] == nil || company["name"] == nil {
		t.Fatalf("company=%v", company)
	}
	if !strings.HasSuffix(item["published_at"].(string), "Z") {
		t.Fatal("timestamp not UTC")
	}
	if detail {
		req := item["requirements"].(map[string]any)
		benefits := item["benefits"].(map[string]any)
		if len(req) != 2 || len(benefits) != 2 || benefits["predefined"] == nil || benefits["custom"] == nil {
			t.Fatal("detail extras shape")
		}
	}
}

func TestPublicJobsFlowUnionOrderingPagingFiltersAndPrivacy(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	id := publicationFlowReady(t, h, owner)
	marker := "publiccatalog" + strings.ReplaceAll(uuid.NewString(), "-", "")
	location := marker + " México"
	base := draftFlowV2Path + "/" + id
	// Persist an answer key and a hidden salary to prove the real public boundary excludes both.
	publicFlowPatch(t, h, id, owner, map[string]any{"title": marker, "location": publicFlowLocation(t, h, location), "screening_questions": []any{map[string]any{
		"id": uuid.NewString(), "type": "single_choice_evaluated", "prompt": "Private screening prompt", "options": []any{map[string]any{"id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "label": "Yes"}, map[string]any{"id": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "label": "No"}}, "correct_option_id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
	}}, "compensation": map[string]any{"mode": "fixed", "amount": "987654321.00", "min": nil, "max": nil, "currency": "MXN", "pay_period": "monthly", "basis": "gross", "public_visible": false}})
	publicFlowGet(t, h, "/v2/jobs/"+id, 404)
	at := publicFlowPublish(t, h, id, owner)
	min := 123
	legacyA := publicFlowLegacy(t, h, company.companyID, marker, "Detalle seguro", location, at, &min)
	legacyB := publicFlowLegacy(t, h, company.companyID, marker, "Detalle seguro", location, at, nil)
	newer := publicFlowLegacy(t, h, company.companyID, "Otra oferta", marker, location, at.Add(time.Hour), nil)
	legacyOrder := []string{legacyA, legacyB}
	sort.Sort(sort.Reverse(sort.StringSlice(legacyOrder)))
	want := append(append([]string{id}, legacyOrder...), newer)
	path := "/v2/jobs?q=" + marker + "&limit=1"
	inserted := ""
	seen := []string{}
	cursor := ""
	for page := 0; page < 10; page++ {
		request := path
		if cursor != "" {
			request += "&cursor=" + url.QueryEscape(cursor)
		}
		body := publicFlowGet(t, h, request, 200)
		if len(body) != 2 {
			t.Fatal("list envelope")
		}
		items := body["items"].([]any)
		for _, v := range items {
			item := v.(map[string]any)
			publicFlowAssertKeys(t, item, false)
			seen = append(seen, item["id"].(string))
		}
		if body["next_cursor"] == nil {
			break
		}
		cursor = body["next_cursor"].(string)
		if page == 0 { // A newer insertion must not disturb continuation from the anchored page.
			inserted = publicFlowLegacy(t, h, company.companyID, marker, "New insertion", location, at.Add(2*time.Hour), nil)
		}
	}
	if !reflect.DeepEqual(seen, want) {
		t.Fatalf("paged=%v want=%v", seen, want)
	}
	// Title A outranks description B even when the latter was published later.
	ranked := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&limit=50", 200)["items"].([]any)
	rankedIDs := []string{}
	for _, v := range ranked {
		rankedIDs = append(rankedIDs, v.(map[string]any)["id"].(string))
	}
	if !reflect.DeepEqual(rankedIDs, append([]string{inserted}, want...)) {
		t.Fatalf("ranked=%v", rankedIDs)
	}
	searchSeen := []string{}
	cursor = ""
	for page := 0; page < 10; page++ {
		request := "/v2/jobs?q=" + marker + "&limit=1"
		if cursor != "" {
			request += "&cursor=" + url.QueryEscape(cursor)
		}
		body := publicFlowGet(t, h, request, 200)
		for _, v := range body["items"].([]any) {
			searchSeen = append(searchSeen, v.(map[string]any)["id"].(string))
		}
		if body["next_cursor"] == nil {
			break
		}
		cursor = body["next_cursor"].(string)
	}
	if !reflect.DeepEqual(searchSeen, rankedIDs) {
		t.Fatalf("search cursor=%v want=%v", searchSeen, rankedIDs)
	}
	// Each vacancy-only dimension excludes legacy; employment_type='contract' is never mapped.
	for _, filter := range []string{"work_schedule=full_time", "contract_type=indefinite", "professional_area=technology_systems"} {
		items := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&"+filter, 200)["items"].([]any)
		if len(items) != 1 || items[0].(map[string]any)["id"] != id {
			t.Fatalf("%s=%v", filter, items)
		}
	}
	for _, filter := range []string{"work_mode=onsite", "contract_type=project", "work_schedule=part_time", "professional_area=legal"} {
		items := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&"+filter, 200)["items"].([]any)
		if len(items) != 0 {
			t.Fatalf("%s=%v", filter, items)
		}
	}
	vacancy := publicFlowGet(t, h, "/v2/jobs/"+id, 200)
	publicFlowAssertKeys(t, vacancy, true)
	raw, err := json.Marshal(vacancy)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"requester", "headcount", "requestDate", "request_date", "delivery", "pipeline", "questions_snapshot", "answers_snapshot", "correct_option_id", "987654321", "Private screening"} {
		if strings.Contains(string(raw), private) {
			t.Fatalf("leaked %s", private)
		}
	}
	if vacancy["compensation"] != nil || vacancy["legacy_salary"] != nil || vacancy["legacy_employment_type"] != nil || vacancy["seniority"] != nil || vacancy["description"] == nil {
		t.Fatalf("vacancy=%v", vacancy)
	}
	legacy := publicFlowGet(t, h, "/v2/jobs/"+legacyA, 200)
	if legacy["location_label"] != location || vacancy["location_label"] != location {
		t.Fatal("label/legacy fallback")
	}
	publicFlowAssertKeys(t, legacy, true)
	for _, k := range []string{"location", "remote_scope", "work_schedule", "contract_type", "professional_area", "description", "compensation"} {
		if legacy[k] != nil {
			t.Fatalf("legacy %s=%v", k, legacy[k])
		}
	}
	if legacy["legacy_employment_type"] != "contract" || legacy["seniority"] != "senior" || !reflect.DeepEqual(legacy["legacy_salary"], map[string]any{"min": "123.00", "max": nil, "currency": "USD"}) || !reflect.DeepEqual(legacy["requirements"], map[string]any{"required": nil, "preferred": nil}) || !reflect.DeepEqual(legacy["benefits"], map[string]any{"predefined": []any{}, "custom": []any{}}) {
		t.Fatalf("legacy=%v", legacy)
	}
	if publicFlowGet(t, h, "/v2/jobs/"+legacyB, 200)["legacy_salary"] != nil {
		t.Fatal("empty legacy salary")
	}
	// Legacy routes stay legacy-only, with their prior detail shape.
	old := h.do(t, "GET", "/jobs/"+legacyA, "", "", nil)
	oldBody := draftFlowObject(t, old.body)
	if old.status != 200 || oldBody["employment_type"] != "contract" || oldBody["source"] != nil {
		t.Fatalf("legacy route=%s", old.body)
	}
	old = h.do(t, "GET", "/jobs/"+id, "", "", nil)
	if old.status != 404 {
		t.Fatal("vacancy exposed via legacy route")
	}
	// Required writes cannot clear any of the three resources, and return the existing list envelope.
	for _, tc := range []struct {
		suffix, method, body string
		missing              []string
	}{
		{"", "PATCH", `{"fields":{"title":null,"remote_scope":null}}`, []string{"title_missing", "remote_scope_missing"}},
		{"/pipeline/delivery", "PUT", deliveryFlowNull, []string{"delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing"}},
		{"/management", "PUT", `{"requestDate":null,"hiringHeadcount":null}`, []string{"request_date_missing", "hiring_headcount_missing"}},
	} {
		current := h.do(t, "GET", base+tc.suffix, "", owner.token, nil)
		snapshot := publicationFlowSnapshot(t, h, id)
		projection := publicFlowProjectionSnapshot(t, h, id)
		result := h.do(t, tc.method, base+tc.suffix, tc.body, owner.token, map[string]string{"If-Match": current.header.Get("ETag")})
		publicationFlowAssertError(t, result, 422, "publication_incomplete", tc.missing)
		if snapshot != publicationFlowSnapshot(t, h, id) || projection != publicFlowProjectionSnapshot(t, h, id) {
			t.Fatal("rejection changed state")
		}
	}
	// Visible salary still remains null until every monetary metadata item is set.
	for _, tc := range []struct {
		basis   any
		visible bool
		want    bool
	}{{nil, true, false}, {"gross", true, true}, {"gross", false, false}} {
		publicFlowPatch(t, h, id, owner, map[string]any{"compensation": map[string]any{"mode": "range", "amount": nil, "min": "100", "max": "200", "currency": "USD", "pay_period": "weekly", "basis": tc.basis, "public_visible": tc.visible}})
		got := publicFlowGet(t, h, "/v2/jobs/"+id, 200)["compensation"]
		if (got != nil) != tc.want {
			t.Fatalf("salary=%v", got)
		}
		if got != nil && !reflect.DeepEqual(got, map[string]any{"mode": "range", "amount": nil, "min": "100.00", "max": "200.00", "currency": "USD", "pay_period": "weekly", "basis": "gross"}) {
			t.Fatalf("compensation shape=%v", got)
		}
	}
	// Both sources disappear under either company visibility gate.
	for _, sql := range []string{`UPDATE companies SET status='suspended' WHERE id=$1`, `UPDATE companies SET status='active',deleted_at=now() WHERE id=$1`} {
		if _, err := h.pool.Exec(context.Background(), sql, company.companyID); err != nil {
			t.Fatal(err)
		}
		publicFlowGet(t, h, "/v2/jobs/"+id, 404)
		publicFlowGet(t, h, "/v2/jobs/"+legacyA, 404)
		items := publicFlowGet(t, h, "/v2/jobs?q="+marker, 200)["items"].([]any)
		if len(items) != 0 {
			t.Fatal("inactive company listed")
		}
	}
}

func publicFlowProjectionSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var out string
	if err := h.pool.QueryRow(context.Background(), `SELECT row_to_json(p)::text FROM vacancy_public_projections p WHERE id=$1`, id).Scan(&out); err != nil {
		t.Fatal(err)
	}
	return out
}
