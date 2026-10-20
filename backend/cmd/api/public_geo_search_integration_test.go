//go:build integration

package main

import (
	"context"
	"net/url"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestPublicGeoSearchFilters(t *testing.T) {
	h := newDraftFlowHarness(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO geo_countries(code,name_es,name_en) VALUES('MX','México','Mexico'),('CO','Colombia','Colombia'),('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`)
	exec(`INSERT INTO geo_states(country_code,code,name,abbreviation) VALUES('MX','09','Ciudad de México','CDMX'),('MX','14','Jalisco','Jal.') ON CONFLICT DO NOTHING`)
	exec(`INSERT INTO geo_municipalities(country_code,state_code,code,name) VALUES('MX','09','09002','Azcapotzalco'),('MX','14','14039','Guadalajara') ON CONFLICT DO NOTHING`)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	marker := "geosearch" + strings.ReplaceAll(uuid.NewString(), "-", "")
	location := func(state, municipality string) any {
		return map[string]any{"country": "MX", "state": state, "municipality": municipality}
	}
	anywhere := map[string]any{"kind": "anywhere"}
	countries := func(country string) any { return map[string]any{"kind": "countries", "countries": []string{country}} }
	create := func(mode string, loc, scope any) string {
		t.Helper()
		id := publicationFlowReady(t, h, owner)
		publicFlowPatch(t, h, id, owner, map[string]any{"title": marker, "work_mode": mode, "location": loc, "remote_scope": scope})
		publicFlowPublish(t, h, id, owner)
		return id
	}
	onsite := create("onsite", location("14", "14039"), nil)
	hybrid := create("hybrid", location("09", "09002"), nil)
	remoteAnywhere := create("remote", nil, anywhere)
	remoteMX := create("remote", location("14", "14039"), countries("MX"))
	remoteCO := create("remote", location("09", "09002"), countries("CO"))
	migratedRemote := create("remote", nil, anywhere)
	exec(`UPDATE vacancy_public_projections SET remote_scope_kind=NULL,remote_countries=NULL WHERE id=$1`, migratedRemote)
	migratedOnsite := create("onsite", location("14", "14039"), nil)
	exec(`UPDATE vacancy_public_projections SET country_code=NULL,state_code=NULL,municipality_code=NULL WHERE id=$1`, migratedOnsite)
	legacyRemote := publicFlowLegacy(t, h, company.companyID, marker, "Legacy remote", "Guadalajara, Jalisco", time.Now().UTC(), nil)
	legacyOnsite := publicFlowLegacy(t, h, company.companyID, marker, "Legacy onsite", "Guadalajara, Jalisco", time.Now().UTC(), nil)
	exec(`UPDATE jobs SET work_mode='onsite' WHERE id=$1`, legacyOnsite)
	all := []string{onsite, hybrid, remoteAnywhere, remoteMX, remoteCO, migratedRemote, migratedOnsite, legacyRemote, legacyOnsite}
	// Equal title rank and publication timestamps deliberately exercise the
	// source/UUID tie-breakers, including the vacancy-to-legacy page boundary.
	publishedAt := time.Date(2026, 10, 16, 18, 0, 0, 123456000, time.UTC)
	exec(`UPDATE vacancy_public_projections SET published_at=$2 WHERE id=ANY($1::uuid[])`, all[:7], publishedAt)
	exec(`UPDATE jobs SET published_at=$2 WHERE id=ANY($1::uuid[])`, all[7:], publishedAt)
	for _, tc := range []struct {
		name, filter string
		want         []string
	}{
		{"unfiltered", "", all},
		{"state", "state=14", []string{onsite, remoteMX}},
		{"municipality alone", "municipality=09002", []string{hybrid, remoteCO}},
		{"OR states", "state=14&state=09", []string{onsite, hybrid, remoteMX, remoteCO}},
		{"OR municipalities", "municipality=14039&municipality=09002", []string{onsite, hybrid, remoteMX, remoteCO}},
		{"AND dimensions", "state=14&municipality=09002", []string{}},
		{"AND work modes", "state=14&work_mode=remote&work_mode=hybrid", []string{remoteMX}},
		{"applicant MX", "applicant_country=MX", []string{onsite, hybrid, remoteAnywhere, remoteMX, migratedOnsite, legacyOnsite}},
		{"applicant CO", "applicant_country=CO", []string{onsite, hybrid, remoteAnywhere, remoteCO, migratedOnsite, legacyOnsite}},
		{"applicant US", "applicant_country=US", []string{onsite, hybrid, remoteAnywhere, migratedOnsite, legacyOnsite}},
		{"all dimensions", "state=09&state=14&municipality=14039&work_mode=remote&applicant_country=CO", []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			items := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&limit=50&"+tc.filter, 200)["items"].([]any)
			got := []string{}
			for _, item := range items {
				got = append(got, item.(map[string]any)["id"].(string))
			}
			sort.Strings(got)
			want := append([]string{}, tc.want...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %v want %v", got, want)
			}
		})
	}
	for _, filter := range []string{"state=99", "municipality=99999", "applicant_country=ZZ", "state=9", "work_mode=none", "state=14&state=14", "applicant_country=MX&applicant_country=MX"} {
		t.Run("invalid "+filter, func(t *testing.T) {
			body := publicFlowGet(t, h, "/v2/jobs?q=nomatchingjobs&"+filter, 400)
			if len(body) != 2 || body["code"] != "invalid_filter" || body["error"] != "invalid filter" {
				t.Fatal(body)
			}
		})
	}
	for _, tc := range []struct {
		name, first, continuation, changed string
		limit                              int
		ids                                []string
	}{
		{"state", "state=14&state=09&work_mode=remote&work_mode=hybrid", "state=09&state=14&work_mode=hybrid&work_mode=remote", "state=14", 1, []string{hybrid, remoteMX, remoteCO}},
		{"municipality", "municipality=14039&municipality=09002", "municipality=09002&municipality=14039", "municipality=14039", 2, []string{onsite, hybrid, remoteMX, remoteCO}},
		{"applicant_country", "applicant_country=MX", "applicant_country=MX", "applicant_country=CO", 2, []string{onsite, hybrid, remoteAnywhere, remoteMX, migratedOnsite, legacyOnsite}},
	} {
		t.Run("paging "+tc.name, func(t *testing.T) {
			// Derive expected order from known fixtures, not another API read.
			want := append([]string{}, tc.ids...)
			sort.Slice(want, func(i, j int) bool {
				iLegacy := want[i] == legacyRemote || want[i] == legacyOnsite
				jLegacy := want[j] == legacyRemote || want[j] == legacyOnsite
				if iLegacy != jLegacy {
					return !iLegacy
				} // source DESC: vacancy, legacy
				return want[i] > want[j] // canonical UUID strings preserve UUID order
			})
			seen := []string{}
			seenIDs := map[string]bool{}
			seenCursors := map[string]bool{}
			cursor := ""
			for offset := 0; offset < len(want); offset += tc.limit {
				filter := tc.first
				if offset > 0 {
					filter = tc.continuation
				}
				path := "/v2/jobs?q=" + marker + "&" + filter + "&limit=" + strconv.Itoa(tc.limit)
				if cursor != "" {
					path += "&cursor=" + url.QueryEscape(cursor)
				}
				page := publicFlowGet(t, h, path, 200)
				got := []string{}
				for _, item := range page["items"].([]any) {
					id := item.(map[string]any)["id"].(string)
					if seenIDs[id] {
						t.Fatalf("repeated id across pages: %s", id)
					}
					seenIDs[id] = true
					got = append(got, id)
				}
				end := min(offset+tc.limit, len(want))
				if !reflect.DeepEqual(got, want[offset:end]) {
					t.Fatalf("page at %d: got %v want %v", offset, got, want[offset:end])
				}
				seen = append(seen, got...)
				if end == len(want) {
					if page["next_cursor"] != nil {
						t.Fatalf("last page has continuation: %v", page)
					}
					continue
				}
				next, ok := page["next_cursor"].(string)
				if !ok || next == "" || seenCursors[next] {
					t.Fatalf("missing/repeated cursor before last page: %v", page)
				}
				seenCursors[next] = true
				cursor = next
				if offset == 0 {
					bad := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&"+tc.changed+"&cursor="+url.QueryEscape(cursor), 400)
					if bad["code"] != "invalid_request" {
						t.Fatal(bad)
					}
				}
			}
			if !reflect.DeepEqual(seen, want) {
				t.Fatalf("all pages: got %v want %v", seen, want)
			}
		})
	}
}

// Capture the actual sqlc query rather than maintaining a second search query.
type publicSearchCapture struct {
	db.DBTX
	sql  string
	args []any
}

func (c *publicSearchCapture) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	c.sql, c.args = sql, args
	return c.DBTX.Query(ctx, sql, args...)
}
func TestPublicGeoSearchIndexCapability(t *testing.T) {
	h := newDraftFlowHarness(t)
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	// Capability, not cost: keep projection-first join order and plan for the
	// supplied values even if earlier calls warmed a generic prepared plan.
	for _, setting := range []string{`SET LOCAL enable_seqscan=off`, `SET LOCAL join_collapse_limit=1`, `SET LOCAL plan_cache_mode=force_custom_plan`} {
		if _, err := tx.Exec(ctx, setting); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name, index string
		params      db.SearchPublicJobsParams
	}{
		{"state", "vacancy_public_state_idx", db.SearchPublicJobsParams{States: []string{"14"}, PageLimit: 21}},
		{"municipality", "vacancy_public_municipality_idx", db.SearchPublicJobsParams{Municipalities: []string{"14039"}, PageLimit: 21}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			capture := &publicSearchCapture{DBTX: tx}
			if _, err := db.New(capture).SearchPublicJobs(ctx, tc.params); err != nil {
				t.Fatal(err)
			}
			assertPublicSearchPlan(t, ctx, tx, "EXPLAIN "+capture.sql, capture.args, tc.index)
		})
	}
	// applicant_country also admits non-remote/anywhere branches, so the full
	// OR's cost-based plan need not use GIN. Protect index capability of its
	// containment arm (the exact operator/type used by the generated query).
	assertPublicSearchPlan(t, ctx, tx, `EXPLAIN SELECT id FROM vacancy_public_projections WHERE remote_scope_kind='countries' AND remote_countries @> ARRAY[$1::text::char(2)]`, []any{"MX"}, "vacancy_public_remote_countries_idx")
}
func assertPublicSearchPlan(t *testing.T, ctx context.Context, tx pgx.Tx, sql string, args []any, index string) {
	t.Helper()
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), index) {
		t.Fatalf("plan must permit %s:\n%s", index, plan.String())
	}
}
