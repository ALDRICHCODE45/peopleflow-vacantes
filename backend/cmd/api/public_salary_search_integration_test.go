//go:build integration

package main

import (
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestPublicSalarySearchFilters pins SAL-5..SAL-8 over the real UNION query:
// only published public compensation in identical units is compared, ranges
// overlap inclusively, one-sided bounds are open, and legacy rows, hidden or
// absent salaries are excluded only while a salary filter is active.
func TestPublicSalarySearchFilters(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	marker := "salarysearch" + strings.ReplaceAll(uuid.NewString(), "-", "")
	create := func(mode, amount, min, max, currency, period, basis any, visible bool) string {
		t.Helper()
		id := publicationFlowReady(t, h, owner)
		publicFlowPatch(t, h, id, owner, map[string]any{"title": marker, "compensation": map[string]any{
			"mode": mode, "amount": amount, "min": min, "max": max,
			"currency": currency, "pay_period": period, "basis": basis, "public_visible": visible,
		}})
		publicFlowPublish(t, h, id, owner)
		return id
	}
	mxn := func(mode, amount, min, max any) string {
		return create(mode, amount, min, max, "MXN", "monthly", "gross", true)
	}
	range35to45 := mxn("range", nil, "35000", "45000")
	fixed38 := mxn("fixed", "38000", nil, nil)
	range10to20 := mxn("range", nil, "10000", "20000")
	fixed30 := mxn("fixed", "30000", nil, nil)
	range40to50 := mxn("range", nil, "40000", "50000")
	fixed50 := mxn("fixed", "50000", nil, nil)
	hidden := create("fixed", "38000", nil, nil, "MXN", "monthly", "gross", false)
	usd := create("range", nil, "35000", "45000", "USD", "monthly", "gross", true)
	yearly := create("fixed", "38000", nil, nil, "MXN", "yearly", "gross", true)
	net := create("fixed", "38000", nil, nil, "MXN", "monthly", "net", true)
	noSalary := create(nil, nil, nil, nil, "MXN", "monthly", nil, false)
	legacyMin := 38000
	legacy := publicFlowLegacy(t, h, company.companyID, marker, "Legacy salary", "Guadalajara, Jalisco", time.Now().UTC(), &legacyMin)
	all := []string{range35to45, fixed38, range10to20, fixed30, range40to50, fixed50, hidden, usd, yearly, net, noSalary, legacy}

	units := "&salary_currency=MXN&salary_period=monthly&salary_basis=gross"
	for _, tc := range []struct {
		name, filter string
		want         []string
	}{
		{"no salary filter keeps hidden, absent and legacy salaries", "", all},
		{"SAL-7 example 30-40k with inclusive bounds", "salary_min=30000&salary_max=40000" + units, []string{range35to45, fixed38, fixed30, range40to50}},
		{"from X matches max or fixed amount", "salary_min=40000" + units, []string{range35to45, range40to50, fixed50}},
		{"up to Y matches min or fixed amount", "salary_max=20000" + units, []string{range10to20}},
		{"exact cents just above a range max", "salary_min=45000.01" + units, []string{range40to50, fixed50}},
		{"single point", "salary_min=38000&salary_max=38000" + units, []string{range35to45, fixed38}},
		{"currency must match", "salary_min=30000&salary_max=40000&salary_currency=USD&salary_period=monthly&salary_basis=gross", []string{usd}},
		{"pay period must match", "salary_min=30000&salary_max=40000&salary_currency=MXN&salary_period=yearly&salary_basis=gross", []string{yearly}},
		{"basis must match", "salary_min=30000&salary_max=40000&salary_currency=MXN&salary_period=monthly&salary_basis=net", []string{net}},
		{"no overlap", "salary_min=60000" + units, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := publicSalaryIDs(t, publicFlowGet(t, h, "/v2/jobs?q="+marker+"&limit=50&"+tc.filter, 200))
			want := append([]string{}, tc.want...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %v want %v", got, want)
			}
		})
	}

	// Detail stays reachable regardless of filters, and a hidden salary is
	// never exposed by the listing that excluded it.
	if c := publicFlowGet(t, h, "/v2/jobs/"+hidden, 200)["compensation"]; c != nil {
		t.Fatalf("hidden salary exposed: %v", c)
	}

	for _, filter := range []string{
		"salary_min=40000&salary_max=30000" + units, "salary_min=1", "salary_currency=MXN&salary_period=monthly&salary_basis=gross",
		"salary_min=1.234" + units, "salary_min=1&salary_min=2" + units, "salary_min=1&salary_currency=EUR&salary_period=monthly&salary_basis=gross",
		"salary_min=" + units, "salary_min=%ZZ" + units,
	} {
		t.Run("invalid "+filter, func(t *testing.T) {
			body := publicFlowGet(t, h, "/v2/jobs?q=nomatchingjobs&"+filter, 400)
			if len(body) != 2 || body["code"] != "invalid_filter" || body["error"] != "invalid filter" {
				t.Fatal(body)
			}
		})
	}

	t.Run("paging is bound to the normalized salary filter", func(t *testing.T) {
		want := []string{range35to45, fixed38, fixed30, range40to50}
		sort.Strings(want)
		seen := []string{}
		cursor := ""
		for page := 0; page < len(want)+1; page++ {
			filter := "salary_min=30000&salary_max=40000" + units
			if page%2 == 1 {
				filter = "salary_basis=gross&salary_period=monthly&salary_currency=MXN&salary_max=40000.0&salary_min=30000.00"
			}
			path := "/v2/jobs?q=" + marker + "&limit=1&" + filter
			if cursor != "" {
				path += "&cursor=" + url.QueryEscape(cursor)
			}
			body := publicFlowGet(t, h, path, 200)
			seen = append(seen, publicSalaryIDs(t, body)...)
			next, _ := body["next_cursor"].(string)
			if next == "" {
				break
			}
			if page == 0 {
				changed := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&limit=1&salary_min=30000&salary_max=40000.01"+units+"&cursor="+url.QueryEscape(next), 400)
				if changed["code"] != "invalid_request" {
					t.Fatalf("cursor accepted a different salary filter: %v", changed)
				}
				plain := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&limit=1&cursor="+url.QueryEscape(next), 400)
				if plain["code"] != "invalid_request" {
					t.Fatalf("salary cursor accepted without the filter: %v", plain)
				}
			}
			cursor = next
		}
		sort.Strings(seen)
		if !reflect.DeepEqual(seen, want) {
			t.Fatalf("paged %v want %v", seen, want)
		}
	})
}

func publicSalaryIDs(t *testing.T, body map[string]any) []string {
	t.Helper()
	got := []string{}
	for _, item := range body["items"].([]any) {
		got = append(got, item.(map[string]any)["id"].(string))
	}
	sort.Strings(got)
	return got
}
