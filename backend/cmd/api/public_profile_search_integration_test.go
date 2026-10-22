//go:build integration

package main

import (
	"context"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPublicProfileSearchFilters(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)
	marker := "profilesearch" + strings.ReplaceAll(uuid.NewString(), "-", "")
	create := func(code, level string, seniority, years, education any, ongoing bool) string {
		t.Helper()
		langs := []any{}
		if code != "" {
			langs = append(langs, map[string]any{"code": code, "min_level": level})
		}
		id := publicationFlowReady(t, h, owner)
		publicFlowPatch(t, h, id, owner, map[string]any{"title": marker, "languages": langs, "seniority": seniority, "min_years_of_experience": years, "min_education_level": education, "accepts_in_progress_education": ongoing})
		publicFlowPublish(t, h, id, owner)
		return id
	}
	en := create("en", "A1", "junior", "2", "bachelor", false)
	fr := create("fr", "native", "semi_senior", "1.5", "technical", true)
	high := create("en", "C2", "senior", "3", "master", true)
	empty := create("", "", nil, nil, nil, false)
	legacy := publicFlowLegacy(t, h, company.companyID, marker, "Description", "México", time.Now().UTC(), nil)
	if _, err := h.pool.Exec(context.Background(), `UPDATE jobs SET seniority='mid' WHERE id=$1`, legacy); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, filter string
		want         []string
	}{
		{"absent filters", "", []string{en, fr, high, empty, legacy}},
		{"language any level excludes empty and legacy", "language=en", []string{en, high}},
		{"language OR", "language=en&language=fr", []string{en, fr, high}},
		{"seniority legacy mapping", "seniority=semi_senior", []string{fr, legacy}},
		{"seniority OR excludes null", "seniority=junior&seniority=semi_senior", []string{en, fr, legacy}},
		{"years equality and null", "years_of_experience=2", []string{en, fr, empty, legacy}},
		{"years decimal equality", "years_of_experience=1.5", []string{fr, empty, legacy}},
		{"years below minimum", "years_of_experience=1.4", []string{empty, legacy}},
		{"education equality and null", "education_level=bachelor", []string{en, fr, empty, legacy}},
		{"education order not alphabetical", "education_level=technical", []string{fr, empty, legacy}},
		{"ongoing does not satisfy minimum", "education_level=secondary", []string{empty, legacy}},
		{"highest education", "education_level=phd", []string{en, fr, high, empty, legacy}},
		{"OR within AND across", "language=en&language=fr&seniority=junior&seniority=semi_senior&years_of_experience=2&education_level=bachelor", []string{en, fr}},
		{"dimensions intersect", "language=en&seniority=semi_senior", []string{}},
		{"existing text filter AND", "language=en&q=nonexistentprofilemarker", []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := "/v2/jobs?q=" + marker + "&limit=50&" + tc.filter
			if strings.Contains(tc.filter, "&q=") {
				path = "/v2/jobs?limit=50&" + tc.filter
			}
			got := publicSalaryIDs(t, publicFlowGet(t, h, path, 200))
			want := append([]string{}, tc.want...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %v want %v", got, want)
			}
		})
	}
	for _, filter := range []string{"language=", "language=en&language=en", "language=zz", "language=%ZZ", "seniority=mid", "seniority=junior&seniority=junior", "years_of_experience=", "years_of_experience=2&years_of_experience=2", "years_of_experience=1.50", "years_of_experience=60.1", "education_level=", "education_level=none", "education_level=technical&education_level=technical"} {
		t.Run("invalid "+filter, func(t *testing.T) {
			body := publicFlowGet(t, h, "/v2/jobs?q=nomatchingjobs&"+filter, 400)
			if len(body) != 2 || body["code"] != "invalid_filter" || body["error"] != "invalid filter" {
				t.Fatal(body)
			}
		})
	}
	t.Run("paging equivalent years", func(t *testing.T) {
		want := []string{en, fr, empty, legacy}
		sort.Strings(want)
		seen := []string{}
		cursor := ""
		for page := 0; page < len(want)+1; page++ {
			years := "2"
			if page%2 == 1 {
				years = "2.0"
			}
			path := "/v2/jobs?q=" + marker + "&limit=1&years_of_experience=" + years
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
				for _, filter := range []string{"years_of_experience=3", "education_level=bachelor", ""} {
					bad := publicFlowGet(t, h, "/v2/jobs?q="+marker+"&"+filter+"&cursor="+url.QueryEscape(next), 400)
					if bad["code"] != "invalid_request" {
						t.Fatal(bad)
					}
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
