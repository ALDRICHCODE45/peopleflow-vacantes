package publicjobs

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseQueryGeographyAndMultiSelect(t *testing.T) {
	for _, raw := range []string{
		"state=09&state=14&municipality=09002&municipality=14039&work_mode=remote&work_mode=hybrid&applicant_country=MX",
		"work_mode=remote", "municipality=14039", "applicant_country=CO",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); err != nil {
				t.Fatalf("valid geography filter rejected: %v", err)
			}
		})
	}
	for _, raw := range []string{
		"state=none", "state=9", "state=090", "state=09&state=09", "state=",
		"municipality=1403", "municipality=140390", "municipality=14039&municipality=14039",
		"applicant_country=mx", "applicant_country=MX&applicant_country=CO", "applicant_country=MX%20",
		"work_mode=remote&work_mode=remote", "work_mode=none", "work_mode=Remote", "work_mode=", "state=%FF", "state=%ZZ", "applicant_country=%00",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidFilter) {
				t.Fatalf("want invalid_filter, got %v", err)
			}
		})
	}
	if _, err := ParseQuery("location=Mexico"); err == nil {
		t.Fatal("removed location filter accepted")
	}
}

func TestParseQueryStrictContract(t *testing.T) {
	for _, raw := range []string{"unknown=x", "limit=0", "limit=51", "limit=1&limit=2", "limit=", "limit=+1", "limit=1.0", "work_schedule=contract", "contract_type=full_time", "professional_area=unknown", "q=a&q=b", "cursor=bad", "q=%ZZ", "location=%FF", "q=%00"} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseQuery(raw); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("accepted %q: %v", raw, err)
			}
		})
	}
	q, err := ParseQuery("q=Go&state=09&work_mode=remote&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems")
	if err != nil || q.Limit != 20 || q.Q != "Go" || !reflect.DeepEqual(q.States, []string{"09"}) {
		t.Fatalf("query=%+v error=%v", q, err)
	}
	for _, n := range []string{"1", "50"} {
		if _, err := ParseQuery("limit=" + n); err != nil {
			t.Fatal(err)
		}
	}
}

type catalogReaderStub struct {
	rows  []Row
	query Query
}

func (s *catalogReaderStub) Search(_ context.Context, q Query) ([]Row, error) {
	s.query = q
	return s.rows, nil
}
func (s *catalogReaderStub) Get(_ context.Context, id uuid.UUID) (Detail, error) {
	for _, row := range s.rows {
		if row.Detail.ID == id {
			return row.Detail, nil
		}
	}
	return Detail{}, ErrNotFound
}

func TestCatalogCursorUsesLastVisibleAcrossSourcesAndBindsFilters(t *testing.T) {
	at := time.Date(2026, 10, 16, 18, 0, 0, 123456000, time.UTC)
	rows := []Row{}
	for _, source := range []string{"vacancy", "legacy", "legacy"} {
		rows = append(rows, Row{Detail: Detail{Item: Item{ID: uuid.New(), Source: source, PublishedAt: at}}, Rank: 0.12345679104328156})
	}
	stub := &catalogReaderStub{rows: rows}
	service := NewCatalog(stub)
	q, err := ParseQuery("q=Go&limit=2")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.List(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 || result.NextCursor == nil || stub.query.Limit != 3 {
		t.Fatalf("page=%+v", result)
	}
	q2, err := ParseQuery("q=Go&limit=1&cursor=" + url.QueryEscape(*result.NextCursor))
	if err != nil {
		t.Fatal(err)
	}
	if q2.After == nil || q2.After.ID != rows[1].Detail.ID || q2.After.Source != "legacy" || !q2.After.PublishedAt.Equal(at) || q2.After.Rank != rows[1].Rank {
		t.Fatalf("anchor=%+v", q2.After)
	}
	if _, err := ParseQuery("q=Other&cursor=" + url.QueryEscape(*result.NextCursor)); !errors.Is(err, ErrInvalidRequest) {
		t.Fatal("cursor reused with different search")
	}
	stub.rows = []Row{}
	empty, err := service.List(context.Background(), q)
	if err != nil || empty.Items == nil || empty.NextCursor != nil {
		t.Fatalf("empty=%+v %v", empty, err)
	}
}

func TestGeographyCursorCanonicalBindingAndOldVersionRejection(t *testing.T) {
	q, err := ParseQuery("state=14&state=09&municipality=14039&municipality=09002&work_mode=remote&work_mode=hybrid&applicant_country=MX")
	if err != nil {
		t.Fatal(err)
	}
	p := Position{ID: uuid.New(), Source: "vacancy", PublishedAt: time.Now().UTC()}
	token, err := encodeCursor(q, p)
	if err != nil {
		t.Fatal(err)
	}
	permuted := "state=09&state=14&municipality=09002&municipality=14039&work_mode=hybrid&work_mode=remote&applicant_country=MX"
	if got, err := ParseQuery(permuted + "&cursor=" + token + "&limit=50"); err != nil || got.After == nil || got.After.ID != p.ID {
		t.Fatalf("permuted binding: %+v %v", got, err)
	}
	for _, changed := range []string{
		strings.Replace(permuted, "state=14", "state=15", 1),
		strings.Replace(permuted, "municipality=14039", "municipality=14040", 1),
		strings.Replace(permuted, "work_mode=remote", "work_mode=onsite", 1),
		strings.Replace(permuted, "applicant_country=MX", "applicant_country=CO", 1),
	} {
		if _, err := ParseQuery(changed + "&cursor=" + token); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("changed filters accepted: %s %v", changed, err)
		}
	}
	for _, oldLocation := range []string{"", "Mexico"} {
		oldFilters, _ := json.Marshal([]string{"", oldLocation, "", "", "", ""})
		sum := sha256.Sum256(oldFilters)
		raw, _ := json.Marshal(cursorToken{Version: 1, Filters: hex.EncodeToString(sum[:]), Position: p})
		oldToken := base64.RawURLEncoding.EncodeToString(raw)
		if _, err := ParseQuery("cursor=" + oldToken); !errors.Is(err, ErrInvalidRequest) {
			t.Fatal("pre-G5 cursor accepted", err)
		}
	}
}

func TestCatalogEnrichmentExcerptAndLogo(t *testing.T) {
	for _, tc := range []struct {
		name, plain, want string
		truncated         bool
	}{
		{"empty", "", "", false},
		{"whitespace", "\u00a0\n\t\u2003", "", false},
		{"collapse", "\u00a0 uno\n\t dos\u0085\u2028tres \u3000", "uno dos tres", false},
		{"239", strings.Repeat("界", 239), strings.Repeat("界", 239), false},
		{"240", strings.Repeat("界", 240), strings.Repeat("界", 240), false},
		{"241 hard cut", strings.Repeat("界", 241), strings.Repeat("界", 240), true},
		{"combining code points", strings.Repeat("e\u0301", 121), strings.Repeat("e\u0301", 120), true},
		{"word boundary", strings.Repeat("a", 230) + " abcdefghijk", strings.Repeat("a", 230), true},
		{"boundary at limit", strings.Repeat("a", 239) + " z", strings.Repeat("a", 239), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, source := range []string{"legacy", "vacancy"} {
				d := Detail{Item: Item{Source: source}, DescriptionPlain: tc.plain}
				catalog := NewCatalog(&catalogReaderStub{rows: []Row{{Detail: d}}})
				page, err := catalog.List(context.Background(), Query{Limit: 1})
				if err != nil {
					t.Fatal(err)
				}
				detail, err := catalog.Get(context.Background(), d.ID)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(detail.Item, page.Items[0]) {
					t.Fatal("list and detail enrichment diverged")
				}
				raw, _ := json.Marshal(page.Items[0])
				var got map[string]any
				_ = json.Unmarshal(raw, &got)
				var want any = tc.want
				if tc.want == "" {
					want = nil
				}
				if got["excerpt"] != want || got["excerpt_truncated"] != tc.truncated {
					t.Fatalf("%s: %s", source, raw)
				}
			}
		})
	}
	for _, logo := range []string{"https://example.test/logo.png", "https://example.test:443/a?q=x", "", "/logo.png", "//example.test/a", "http://example.test/a", "data:image/png;base64,eA==", "https://user:pass@example.test/a", "https:///a", "https://", "https://exa mple.test/a", "https://example.test/%zz", "https://[broken/a"} {
		t.Run(logo, func(t *testing.T) {
			for _, source := range []string{"legacy", "vacancy"} {
				fixture, _ := json.Marshal(map[string]any{"source": source, "company": map[string]any{"logo_url": logo}})
				var d Detail
				if err := json.Unmarshal(fixture, &d); err != nil {
					t.Fatal(err)
				}
				page, err := NewCatalog(&catalogReaderStub{rows: []Row{{Detail: d}}}).List(context.Background(), Query{Limit: 1})
				if err != nil {
					t.Fatal(err)
				}
				raw, _ := json.Marshal(page.Items[0])
				var got map[string]any
				_ = json.Unmarshal(raw, &got)
				company := got["company"].(map[string]any)
				var want any
				if strings.HasPrefix(logo, "https://example.test") && !strings.Contains(logo, "%zz") {
					want = logo
				}
				value, present := company["logo_url"]
				if !present || value != want {
					t.Fatalf("%s: %s", source, raw)
				}
			}
		})
	}
}

func TestCatalogEnrichmentPreviews(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		predefined, custom, skills []string
	}{
		{"zero", []string{}, []string{}, []string{}},
		{"under", []string{"wellness"}, []string{"Café"}, []string{" Go ", "e\u0301"}},
		{"at", []string{"wellness", "health_insurance"}, []string{"Café"}, []string{"a", "b", "c", "d", "e", "f"}},
		{"over", []string{"wellness", "health_insurance"}, []string{"Café", "Gym"}, []string{"a", "b", "c", "d", "e", "f", "g"}},
		{"predefined first", []string{"wellness", "health_insurance", "extra_time_off", "annual_bonus"}, []string{"Café"}, []string{"a"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture, _ := json.Marshal(map[string]any{"source": "vacancy", "benefits": Benefits{tc.predefined, tc.custom}, "skills": tc.skills, "screening_questions": 2, "applicants": "25_plus"})
			var d Detail
			if err := json.Unmarshal(fixture, &d); err != nil {
				t.Fatal(err)
			}
			page, err := NewCatalog(&catalogReaderStub{rows: []Row{{Detail: d}}}).List(context.Background(), Query{Limit: 1})
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(page.Items[0])
			var got map[string]any
			_ = json.Unmarshal(raw, &got)
			p := append([]string{}, tc.predefined...)
			if len(p) > 3 {
				p = p[:3]
			}
			c := append([]string{}, tc.custom...)
			if len(c) > 3-len(p) {
				c = c[:3-len(p)]
			}
			s := append([]string{}, tc.skills...)
			if len(s) > 6 {
				s = s[:6]
			}
			want, _ := json.Marshal(map[string]any{"predefined": p, "custom": c})
			actual, _ := json.Marshal(got["benefits_preview"])
			wantSkills, _ := json.Marshal(s)
			actualSkills, _ := json.Marshal(got["skills_preview"])
			if string(want) != string(actual) || string(wantSkills) != string(actualSkills) || got["benefits_total"] != float64(len(tc.predefined)+len(tc.custom)) || got["skills_total"] != float64(len(tc.skills)) || got["screening_questions"] != float64(2) || got["applicants"] != "25_plus" {
				t.Fatalf("%s", raw)
			}
		})
	}
}

func TestPublicShapesExactKeysAndNullability(t *testing.T) {
	item := Item{ID: uuid.New(), Source: "legacy", PublishedAt: time.Now().UTC()}
	raw, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	expected := []string{"id", "source", "title", "company", "location", "location_label", "remote_scope", "work_mode", "work_schedule", "contract_type", "professional_area", "seniority", "legacy_employment_type", "compensation", "legacy_salary", "published_at", "excerpt", "excerpt_truncated", "benefits_preview", "benefits_total", "skills_preview", "skills_total", "applicants", "screening_questions", "requirements_profile"}
	if len(fields) != len(expected) {
		t.Fatalf("keys=%s", raw)
	}
	for _, k := range expected {
		if _, ok := fields[k]; !ok {
			t.Fatalf("missing %s", k)
		}
	}
	for _, k := range []string{"work_schedule", "contract_type", "professional_area", "compensation", "legacy_salary"} {
		if fields[k] != nil {
			t.Fatalf("%s=%v", k, fields[k])
		}
	}
	detail := Detail{Item: item, Benefits: Benefits{Predefined: []string{}, Custom: []string{}}}
	raw, err = json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields) != len(expected)+5 || fields["description"] != nil || fields["description_plain"] != "" {
		t.Fatalf("detail=%s", raw)
	}
	if !reflect.DeepEqual(fields["requirements"], map[string]any{"required": nil, "preferred": nil}) || !reflect.DeepEqual(fields["benefits"], map[string]any{"predefined": []any{}, "custom": []any{}}) {
		t.Fatalf("extras=%s", raw)
	}
}
