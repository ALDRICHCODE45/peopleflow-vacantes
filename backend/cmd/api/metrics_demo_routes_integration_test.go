//go:build integration

package main

import (
	"context"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/metricsdemo"
	"github.com/google/uuid"
)

// The demo vacancies are operable in the app (T13, L23): the owner sees
// every demo draft in the v2 draft list, and the draft, board, pipeline,
// checklist and publication routes open each of them, including the
// vacancies the dashboard links to («Abrir pipeline»).

// demoDraftIDs are the demo company's job_drafts ids, sorted.
func demoDraftIDs(t *testing.T, h *draftFlowHarness) []string {
	t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT id::text FROM job_drafts WHERE company_id=$1 ORDER BY id`, metricsdemo.CompanyID())
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// demoListedDrafts walks the v2 draft list (every page) as token.
func demoListedDrafts(t *testing.T, h *draftFlowHarness, token string) []string {
	t.Helper()
	var out []string
	cursor := ""
	for range 100 {
		path := "/v2/me/company/job-drafts?limit=50"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		resp := h.do(t, "GET", path, "", token, nil)
		if resp.status != 200 {
			t.Errorf("GET %s: %d %s", path, resp.status, resp.body)
			return nil
		}
		page := draftFlowObject(t, resp.body)
		for _, raw := range page["items"].([]any) {
			out = append(out, raw.(map[string]any)["id"].(string))
		}
		next, _ := page["next_cursor"].(string)
		if next == "" {
			slices.Sort(out)
			return out
		}
		cursor = next
	}
	t.Fatal("draft list does not end")
	return nil
}

// draftIDsIn collects every "draft_id" string anywhere in a JSON value.
func draftIDsIn(v any, out map[string]bool) {
	switch v := v.(type) {
	case map[string]any:
		for k, child := range v {
			if id, ok := child.(string); ok && k == "draft_id" {
				out[id] = true
			}
			draftIDsIn(child, out)
		}
	case []any:
		for _, child := range v {
			draftIDsIn(child, out)
		}
	}
}

func TestMetricsDemo_DraftRoutesOpenEveryVacancy(t *testing.T) {
	ctx := context.Background()
	h := newDraftFlowHarness(t)
	a := newDemoAccounts(t, h)
	if _, err := metricsdemo.Apply(ctx, h.pool, demoDB, a.emails, time.Now()); err != nil {
		t.Fatal(err)
	}
	token := h.actor(t, a.owner, a.ownerSub).token
	want := demoDraftIDs(t, h)
	if len(want) == 0 {
		t.Fatal("the demo wrote no drafts")
	}
	if got := demoListedDrafts(t, h, token); !slices.Equal(got, want) {
		t.Errorf("draft list: %d drafts %v, demo has %d %v", len(got), got, len(want), want)
	}

	var published map[string]bool = map[string]bool{}
	rows, err := h.pool.Query(ctx, `SELECT id::text FROM vacancy_processes WHERE company_id=$1`, metricsdemo.CompanyID())
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		published[id] = true
	}
	rows.Close()
	if len(published) == 0 {
		t.Fatal("no published demo vacancy")
	}

	routes := []string{"", "/board", "/pipeline", "/checklist", "/publication", "/team", "/management", "/pipeline/delivery", "/lifecycle"}
	for _, id := range want {
		for _, route := range routes {
			path := "/v2/me/company/job-drafts/" + id + route
			resp := h.do(t, "GET", path, "", token, nil)
			if route == "/board" && !published[id] {
				// A draft never published has no board (the app's rule).
				if resp.status != 409 || !strings.Contains(string(resp.body), "vacancy_not_published") {
					t.Errorf("GET %s (unpublished): %d %s", path, resp.status, resp.body)
				}
				continue
			}
			if resp.status != 200 {
				t.Errorf("GET %s (published=%v): %d %s", path, published[id], resp.status, resp.body)
			}
		}
	}

	// The dashboard's vacancy links open the board.
	linked := map[string]bool{}
	for _, section := range []string{"vacancies", "attention"} {
		resp := h.do(t, "GET", "/v2/me/company/dashboard/"+section, "", token, nil)
		if resp.status != 200 {
			t.Fatalf("GET dashboard/%s: %d %s", section, resp.status, resp.body)
		}
		draftIDsIn(draftFlowObject(t, resp.body), linked)
	}
	if len(linked) == 0 {
		t.Fatal("the dashboard links no demo vacancy")
	}
	for id := range linked {
		if _, err := uuid.Parse(id); err != nil || !slices.Contains(want, id) {
			t.Fatalf("dashboard links %q, not a demo draft", id)
		}
		if resp := h.do(t, "GET", "/v2/me/company/job-drafts/"+id+"/board", "", token, nil); resp.status != 200 {
			t.Errorf("dashboard link %s board: %d %s", id, resp.status, resp.body)
		}
	}
}

// Remove copes with rows the app creates for the demo company that the seed
// never wrote: opening the site editor (GET /v2/me/company/site) lazily
// creates the company_sites draft row; media and slug history hang from it;
// a legacy job (POST /jobs) and an application to it.
var demoLegacyJob = uuid.MustParse("0e5a7c2d-3f1b-4c8e-9a6d-2b7f1e4c9d30")

func TestMetricsDemo_RemoveDeletesAppCreatedRows(t *testing.T) {
	ctx := context.Background()
	h := newDraftFlowHarness(t)
	a := newDemoAccounts(t, h)
	if _, err := metricsdemo.Apply(ctx, h.pool, demoDB, a.emails, time.Now()); err != nil {
		t.Fatal(err)
	}
	token := h.actor(t, a.owner, a.ownerSub).token
	if resp := h.do(t, "GET", "/v2/me/company/site", "", token, nil); resp.status != 200 {
		t.Fatalf("GET site: %d %s", resp.status, resp.body)
	}
	company := metricsdemo.CompanyID()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by)
 VALUES(gen_random_uuid(),$1,'cover','demo-test/cover','image/png',800,600,1024,$2)`, []any{company, a.owner}},
		{`INSERT INTO company_site_slug_history(slug,company_id) VALUES('demo-metricas-test-'||substr(md5(random()::text),1,8),$1)`, []any{company}},
		{`INSERT INTO jobs(id,company_id,title,description,work_mode,employment_type,seniority) VALUES($1,$2,'Legacy','Legacy','remote','full_time','mid')`, []any{demoLegacyJob, company}},
		{`INSERT INTO applications(id,job_id,candidate_id) VALUES(gen_random_uuid(),$1,$2)`, []any{demoLegacyJob, a.owner}},
	} {
		if _, err := h.pool.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatalf("%s: %v", stmt.sql, err)
		}
	}
	var sites int
	if err := h.pool.QueryRow(ctx, `SELECT count(*) FROM company_sites WHERE company_id=$1`, company).Scan(&sites); err != nil || sites != 1 {
		t.Fatalf("company_sites rows %d, %v", sites, err)
	}

	if _, err := metricsdemo.Remove(ctx, h.pool, demoDB); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := h.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM companies WHERE id=$1) + (SELECT count(*) FROM company_sites WHERE company_id=$1)
 + (SELECT count(*) FROM company_site_media WHERE company_id=$1) + (SELECT count(*) FROM company_site_slug_history WHERE company_id=$1)
 + (SELECT count(*) FROM job_drafts WHERE company_id=$1) + (SELECT count(*) FROM jobs WHERE company_id=$1)
 + (SELECT count(*) FROM applications WHERE job_id=$2)`, company, demoLegacyJob).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Fatalf("remove left %d demo company rows", left)
	}
}
