//go:build integration

package main

import (
	"context"
	"encoding/base64"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

const publicSortInvalidRequest = `{"error":"invalid request","code":"invalid_request"}` + "\n"

// TestPublicJobsSortAndTotal pins public-jobs-sort-total S2-S4 through the
// production router and the real UNION query.
func TestPublicJobsSortAndTotal(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	create := func(mode, amount, min, max any, currency, period string, visible bool) string {
		t.Helper()
		id := publicationFlowReady(t, h, owner)
		publicFlowPatch(t, h, id, owner, map[string]any{"compensation": map[string]any{
			"mode": mode, "amount": amount, "min": min, "max": max,
			"currency": currency, "pay_period": period, "basis": "gross", "public_visible": visible,
		}})
		publicFlowPublish(t, h, id, owner)
		return id
	}
	// Created oldest to newest; every tie below resolves by the recent order.
	fixed30 := create("fixed", "30000", nil, nil, "MXN", "monthly", true)
	range30to38 := create("range", nil, "30000", "38000", "MXN", "monthly", true)
	fixed38 := create("fixed", "38000", nil, nil, "MXN", "monthly", true)
	range35to45 := create("range", nil, "35000", "45000", "MXN", "monthly", true)
	fixed45 := create("fixed", "45000", nil, nil, "MXN", "monthly", true)
	hidden := create("fixed", "999999", nil, nil, "MXN", "monthly", false)
	none := create(nil, nil, nil, nil, "MXN", "monthly", false)
	usd := create("range", nil, "100", "200", "USD", "monthly", true)
	yearly := create("fixed", "500000", nil, nil, "MXN", "yearly", true)
	legacyMin := 50000
	legacy := publicFlowLegacy(t, h, company.companyID, "Legacy salary", "Legacy", "", time.Now().UTC(), &legacyMin)
	legacyNone := publicFlowLegacy(t, h, company.companyID, "Legacy no salary", "Legacy", "", time.Now().UTC().Add(time.Second), nil)

	base := "/v2/jobs?company_id=" + company.companyID.String()
	recent := []string{legacyNone, legacy, yearly, usd, none, hidden, fixed45, range35to45, fixed38, range30to38, fixed30}
	// Public MXN·monthly·gross first, then other units, legacy, and hidden or
	// absent salaries last in recent order, in both directions.
	trailing := []string{yearly, usd, legacy, legacyNone, none, hidden}
	desc := append([]string{fixed45, range35to45, fixed38, range30to38, fixed30}, trailing...)
	asc := append([]string{range30to38, fixed30, range35to45, fixed38, fixed45}, trailing...)

	for _, tc := range []struct {
		name, sort string
		want       []string
	}{{"recent", "", recent}, {"explicit recent", "&sort=recent", recent}, {"salary_desc", "&sort=salary_desc", desc}, {"salary_asc", "&sort=salary_asc", asc}} {
		t.Run(tc.name, func(t *testing.T) {
			body := publicFlowGet(t, h, base+"&limit=50"+tc.sort, 200)
			if got := publicSortIDs(body); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("order\n got %v\nwant %v", got, tc.want)
			}
			publicSortAssertTotal(t, body, 11, false)
			// Paging over more rows than the limit returns the same order once.
			for _, limit := range []string{"1", "2", "4"} {
				seen := publicSortPage(t, h, base+"&limit="+limit+tc.sort, func(cursor string) {
					if strings.Contains(publicSortCursorJSON(t, cursor), "999999") {
						t.Fatal("cursor reveals a hidden salary")
					}
				})
				if !reflect.DeepEqual(seen, tc.want) {
					t.Fatalf("limit %s paged\n got %v\nwant %v", limit, seen, tc.want)
				}
			}
		})
	}

	t.Run("default is byte-for-byte the recent listing", func(t *testing.T) {
		absent := h.do(t, "GET", base+"&limit=3", "", "", nil)
		explicit := h.do(t, "GET", base+"&limit=3&sort=recent", "", "", nil)
		if absent.status != 200 || string(absent.body) != string(explicit.body) {
			t.Fatalf("absent=%s\nexplicit=%s", absent.body, explicit.body)
		}
		next := draftFlowObject(t, absent.body)["next_cursor"].(string)
		publicFlowGet(t, h, base+"&limit=3&sort=recent&cursor="+url.QueryEscape(next), 200)
	})

	t.Run("cursor is bound to its sort", func(t *testing.T) {
		cursorFor := func(sort string) string {
			return publicFlowGet(t, h, base+"&limit=1"+sort, 200)["next_cursor"].(string)
		}
		for _, tc := range []struct{ issued, used string }{
			{"&sort=salary_desc", "&sort=salary_asc"}, {"&sort=salary_desc", ""}, {"&sort=salary_desc", "&sort=recent"},
			{"&sort=salary_asc", "&sort=salary_desc"}, {"", "&sort=salary_desc"}, {"&sort=recent", "&sort=salary_asc"},
		} {
			r := h.do(t, "GET", base+"&limit=1"+tc.used+"&cursor="+url.QueryEscape(cursorFor(tc.issued)), "", "", nil)
			if r.status != 400 || string(r.body) != publicSortInvalidRequest {
				t.Fatalf("%q cursor used with %q: %d %s", tc.issued, tc.used, r.status, r.body)
			}
		}
	})

	t.Run("invalid sort", func(t *testing.T) {
		for _, sort := range []string{"sort=", "sort=price", "sort=SALARY_DESC", "sort=salary_asc&sort=salary_asc", "sort=recent&sort=salary_asc"} {
			r := h.do(t, "GET", base+"&"+sort, "", "", nil)
			if r.status != 400 || string(r.body) != publicSortInvalidRequest {
				t.Fatalf("%s: %d %s", sort, r.status, r.body)
			}
		}
	})

	t.Run("salary filter with salary sort and total", func(t *testing.T) {
		filter := "&salary_min=30000&salary_max=40000&salary_currency=MXN&salary_period=monthly&salary_basis=gross"
		body := publicFlowGet(t, h, base+filter+"&sort=salary_desc", 200)
		if got, want := publicSortIDs(body), []string{range35to45, fixed38, range30to38, fixed30}; !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v want %v", got, want)
		}
		publicSortAssertTotal(t, body, 4, false)
	})

	t.Run("total uses the filters, never the sort or cursor", func(t *testing.T) {
		first := publicFlowGet(t, h, base+"&limit=2&sort=salary_asc", 200)
		publicSortAssertTotal(t, first, 11, false)
		second := publicFlowGet(t, h, base+"&limit=2&sort=salary_asc&cursor="+url.QueryEscape(first["next_cursor"].(string)), 200)
		publicSortAssertTotal(t, second, 11, false)
		publicSortAssertTotal(t, publicFlowGet(t, h, base+"&q=Legacy", 200), 2, false)
		publicSortAssertTotal(t, publicFlowGet(t, h, base+"&salary_min=1&salary_currency=USD&salary_period=monthly&salary_basis=gross", 200), 1, false)
		empty := publicFlowGet(t, h, "/v2/jobs?company_id="+uuid.NewString()+"&sort=salary_desc", 200)
		if len(empty) != 3 || len(empty["items"].([]any)) != 0 || empty["next_cursor"] != nil {
			t.Fatal(empty)
		}
		publicSortAssertTotal(t, empty, 0, false)
		// A cursor past the end still reports the filtered total.
		last := publicFlowGet(t, h, base+"&limit=10", 200)
		end := publicFlowGet(t, h, base+"&limit=10&cursor="+url.QueryEscape(last["next_cursor"].(string)), 200)
		if len(end["items"].([]any)) != 1 || end["next_cursor"] != nil {
			t.Fatal(end)
		}
		publicSortAssertTotal(t, end, 11, false)
	})
}

// TestPublicJobsTotalCap seeds 1001 rows: the count stops at 1000.
func TestPublicJobsTotalCap(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, _, _ := draftFlowNewPrincipal(t, h.pool, "active")
	ctx := context.Background()
	t.Cleanup(func() {
		if _, err := h.pool.Exec(ctx, `DELETE FROM jobs WHERE company_id=$1`, company.companyID); err != nil {
			t.Errorf("cleanup cap fixture: %v", err)
		}
	})
	seed := func(n int, title string) {
		t.Helper()
		if _, err := h.pool.Exec(ctx, `INSERT INTO jobs(id,company_id,title,description,location,work_mode,employment_type,seniority,status,published_at)
			SELECT gen_random_uuid(),$1,$2,'Cap fixture','','onsite','contract','senior','published',now()-make_interval(secs=>g) FROM generate_series(1,$3::int) g`,
			company.companyID, title, n); err != nil {
			t.Fatal(err)
		}
	}
	base := "/v2/jobs?company_id=" + company.companyID.String()
	seed(1000, "Cap fixture")
	publicSortAssertTotal(t, publicFlowGet(t, h, base, 200), 1000, false)
	marker := "capmarker" + strings.ReplaceAll(uuid.NewString(), "-", "")
	seed(1, marker)
	for _, sort := range []string{"", "&sort=salary_desc", "&sort=salary_asc"} {
		body := publicFlowGet(t, h, base+sort, 200)
		publicSortAssertTotal(t, body, 1000, true)
		if len(body["items"].([]any)) != 20 || body["next_cursor"] == nil {
			t.Fatal("page changed by the count")
		}
	}
	publicSortAssertTotal(t, publicFlowGet(t, h, base+"&q="+marker, 200), 1, false)
}

func publicSortIDs(body map[string]any) []string {
	ids := []string{}
	for _, item := range body["items"].([]any) {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	return ids
}

func publicSortPage(t *testing.T, h *draftFlowHarness, path string, onCursor func(string)) []string {
	t.Helper()
	seen := []string{}
	cursor := ""
	for range 50 {
		request := path
		if cursor != "" {
			request += "&cursor=" + url.QueryEscape(cursor)
		}
		body := publicFlowGet(t, h, request, 200)
		seen = append(seen, publicSortIDs(body)...)
		next, _ := body["next_cursor"].(string)
		if next == "" {
			return seen
		}
		onCursor(next)
		cursor = next
	}
	t.Fatal("pagination did not terminate")
	return nil
}

func publicSortCursorJSON(t *testing.T, cursor string) string {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func publicSortAssertTotal(t *testing.T, body map[string]any, count int, capped bool) {
	t.Helper()
	total, ok := body["total"].(map[string]any)
	if !ok || len(total) != 2 || total["count"] != float64(count) || total["capped"] != capped {
		t.Fatalf("total=%v want count=%d capped=%v", body["total"], count, capped)
	}
}
