package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	boardapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	poolapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	poolhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/pool"
	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

const orgCandidatesPath = "/v2/me/company/candidates"

func orgCandidatesRouter(readers ...poolapp.Reader) http.Handler {
	var reader poolapp.Reader
	if len(readers) > 0 {
		reader = readers[0]
	}
	return newRouter(routerDeps{
		candidatePoolHandler: poolhttp.NewHandler(poolapp.NewService(reader)),
		requireAuth:          routeRequireAuth,
		requireOwner:         routeRoleGate(companies.OwnerRole, routeTestOwnerHeader),
		requireRecruiter:     routeRoleGate(companies.RecruiterRole, routeTestRecruiterHeader),
	})
}

// The reader fake exercises the real HTTP/service boundary, not SQL matching.
// Real membership and filtering expectations live in TestOrgCandidatesFlow.
type orgCandidatesReader struct {
	queries      []poolapp.Query
	err          error
	summary      *poolapp.Summary
	summaryCalls int
}

func (s *orgCandidatesReader) Search(_ context.Context, company uuid.UUID, q poolapp.Query) (poolapp.Page, error) {
	if company != routeTestCompanyID {
		return poolapp.Page{}, errors.New("wrong company scope")
	}
	s.queries = append(s.queries, q)
	if s.err != nil {
		return poolapp.Page{}, s.err
	}
	out := poolapp.Page{Total: 51, Items: []poolapp.Item{}}
	for i := 1; i <= 51; i++ {
		item := poolapp.Item{Kind: "manual", ID: uuid.MustParse(fmt.Sprintf("11111111-1111-4111-8111-%012d", i)), FullName: "Candidate", LastActivityAt: time.Date(2026, 1, 1, 0, 0, 0, 123456000, time.UTC), Profile: boardapp.Profile{Skills: []string{}, Languages: []intake.SnapshotLanguage{}}}
		if q.After != nil && item.ID.String() <= q.After.ID.String() {
			continue
		}
		out.Items = append(out.Items, item)
		if len(out.Items) == q.Limit+1 {
			break
		}
	}
	return out, nil
}

func (s *orgCandidatesReader) Summary(_ context.Context, company uuid.UUID) (poolapp.Summary, error) {
	s.summaryCalls++
	if company != routeTestCompanyID {
		return poolapp.Summary{}, errors.New("wrong company scope")
	}
	if s.err != nil {
		return poolapp.Summary{}, s.err
	}
	if s.summary != nil {
		return *s.summary, nil
	}
	return poolapp.Summary{Total: 5, WithActiveProcess: 2, AddedLast7Days: 3, ByKind: poolapp.KindCounts{Manual: 2, Organic: 3}}, nil
}

func (s *orgCandidatesReader) Detail(context.Context, uuid.UUID, string, uuid.UUID) (poolapp.Detail, error) {
	return poolapp.Detail{}, boardapp.ErrNotFound
}
func (s *orgCandidatesReader) File(context.Context, uuid.UUID, string, uuid.UUID, uuid.UUID) (boardapp.File, error) {
	return boardapp.File{}, boardapp.ErrNotFound
}

func TestOrgCandidatesRouteGates(t *testing.T) {
	for _, tc := range []struct {
		name    string
		headers map[string]string
		status  int
		code    string
	}{
		{"anonymous", nil, 401, "unauthenticated"},
		{"non recruiter", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := doRouteRequest(t, orgCandidatesRouter(), "GET", orgCandidatesPath, "", tc.headers)
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			assertDraftRouteNoStore(t, w)
			if routeCatalogCode(t, w) != tc.code {
				t.Fatal(w.Body.String())
			}
		})
	}
}

func TestOrgCandidatesInvalidFilters(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	cases := []struct{ name, query, field, code string }{
		{"unknown", "wat=x", "wat", "unknown"},
		{"origin", "origin=recruiter", "origin", "invalid"},
		{"blank q", "q=", "q", "invalid"},
		{"long q", "q=" + strings.Repeat("ñ", 101), "q", "invalid"},
		{"state", "state=XX", "state", "invalid"},
		{"municipality", "municipality=1", "municipality", "invalid"},
		{"seniority", "seniority=Senior", "seniority", "invalid"},
		{"years", "years=1.5", "years", "invalid"},
		{"language", "language=EN", "language", "invalid"},
		{"level", "language=en&language_min_level=NATIVE", "language_min_level", "invalid"},
		{"language required", "language_min_level=native", "language", "required"},
		{"education", "education_level=doctorate", "education_level", "invalid"},
		{"education boolean", "education_level=bachelor&education_in_progress=1", "education_in_progress", "invalid"},
		{"education required", "education_in_progress=true", "education_level", "required"},
		{"vacancy", "vacancy=bad", "vacancy", "invalid"},
		{"encoding", "years=%ZZ", "years", "invalid"},
		{"zero limit", "limit=0", "limit", "invalid"},
		{"large limit", "limit=51", "limit", "invalid"},
		{"signed limit", "limit=+1", "limit", "invalid"},
		{"blank limit", "limit=", "limit", "invalid"},
	}
	for _, key := range []string{"q", "origin", "language_min_level", "education_level", "education_in_progress", "limit", "cursor"} {
		cases = append(cases, struct{ name, query, field, code string }{"duplicate " + key, key + "=x&" + key + "=x", key, "duplicate"})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := doRouteRequest(t, orgCandidatesRouter(), "GET", orgCandidatesPath+"?"+tc.query, "", headers)
			assertDraftRouteNoStore(t, w)
			var got struct {
				Error  string              `json:"error"`
				Code   string              `json:"code"`
				Fields []map[string]string `json:"fields"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(w.Code, w.Body.String())
			}
			want := []map[string]string{{"field": tc.field, "code": tc.code}}
			if w.Code != 400 || got.Code != "invalid_filter" || got.Error != "invalid filter" || !reflect.DeepEqual(got.Fields, want) {
				t.Fatalf("status=%d body=%s want=%v", w.Code, w.Body.String(), want)
			}
		})
	}
	t.Run("sorted combined errors", func(t *testing.T) {
		w := doRouteRequest(t, orgCandidatesRouter(), "GET", orgCandidatesPath+"?years=bad&zzz=x&origin=bad", "", headers)
		var got map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		want := []any{map[string]any{"field": "origin", "code": "invalid"}, map[string]any{"field": "years", "code": "invalid"}, map[string]any{"field": "zzz", "code": "unknown"}}
		if w.Code != 400 || len(got) != 3 || !reflect.DeepEqual(got["fields"], want) {
			t.Fatal(w.Code, w.Body.String())
		}
	})
}

func TestOrgCandidatesPage(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	reader := &orgCandidatesReader{}
	router := orgCandidatesRouter(reader)
	get := func(query string) map[string]any {
		t.Helper()
		w := doRouteRequest(t, router, "GET", orgCandidatesPath+query, "", headers)
		assertDraftRouteNoStore(t, w)
		var page map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || w.Code != 200 {
			t.Fatal(w.Code, w.Body.String(), err)
		}
		if len(page) != 3 || page["total"] != float64(51) {
			t.Fatal(page)
		}
		return page
	}
	first := get("")
	if len(first["items"].([]any)) != 20 || first["next_cursor"] == nil || reader.queries[0].Limit != 20 {
		t.Fatal(first)
	}
	item := first["items"].([]any)[0].(map[string]any)
	raw, _ := json.Marshal(item)
	want := `{"current_company":null,"full_name":"Candidate","id":"11111111-1111-4111-8111-000000000001","kind":"manual","last_activity_at":"2026-01-01T00:00:00.123456Z","latest_participation":null,"participations":{"active":0,"total":0},"professional_title":null,"profile":{"education":{"highest_completed":null,"in_progress":null},"languages":[],"location":null,"seniority":null,"skills":[],"years_of_experience":null}}`
	if string(raw) != want {
		t.Fatal(string(raw))
	}
	second := get("?limit=50&cursor=" + url.QueryEscape(first["next_cursor"].(string)))
	if len(second["items"].([]any)) != 31 || second["next_cursor"] != nil || second["items"].([]any)[0].(map[string]any)["id"] != "11111111-1111-4111-8111-000000000021" {
		t.Fatal(second)
	}
	if len(get("?limit=50")["items"].([]any)) != 50 {
		t.Fatal("max limit not respected")
	}
	filtered := get("?limit=1&years=1_3&years=0_1")
	token := filtered["next_cursor"].(string)
	get("?limit=50&years=0_1&years=1_3&cursor=" + url.QueryEscape(token))
	w := doRouteRequest(t, router, "GET", orgCandidatesPath+"?years=0_1&cursor="+url.QueryEscape(token), "", headers)
	if w.Code != 400 || routeCatalogCode(t, w) != "invalid_cursor" {
		t.Fatal(w.Code, w.Body.String())
	}
	// Every filter is forwarded in normalized form; SQL is not emulated here.
	get("?q=MiXeD&origin=organic&vacancy=" + routeTestDraftID.String() + "&state=none&state=14&municipality=14039&seniority=senior&years=none&language=en&language_min_level=native&education_level=master&education_in_progress=true")
	q := reader.queries[len(reader.queries)-1]
	if q.Q != "mixed" || q.Origin != "organic" || q.LanguageMinLevel != "native" || q.EducationLevel != "master" || !q.EducationInProgress || !reflect.DeepEqual(q.State, []string{"14", "none"}) {
		t.Fatal(q)
	}
	reader.err = errors.New("PRIVATE datastore failure")
	w = doRouteRequest(t, router, "GET", orgCandidatesPath, "", headers)
	assertDraftRouteNoStore(t, w)
	if w.Code != 500 || routeCatalogCode(t, w) != "internal_error" || strings.Contains(w.Body.String(), "PRIVATE") {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestOrgCandidatesCursorNormalization(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	router := orgCandidatesRouter(&orgCandidatesReader{})
	w := doRouteRequest(t, router, "GET", orgCandidatesPath+"?limit=1&years=0_1&years=1_3", "", headers)
	var page struct {
		NextCursor string `json:"next_cursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil || w.Code != 200 {
		t.Fatal(w.Code, w.Body.String(), err)
	}
	token := page.NextCursor
	raw, _ := base64.RawURLEncoding.DecodeString(token)
	cases := []struct {
		name, token, filter string
		status              int
	}{
		{"repeated selections normalized", token, "years=1_3&years=0_1&years=0_1", 200},
		{"base64 newline forbidden", token[:5] + "\n" + token[5:], "years=0_1&years=1_3", 400},
		{"base64 padding forbidden", token + "=", "years=0_1&years=1_3", 400},
	}
	for _, mutation := range []struct{ name, from, to string }{
		{"version", `"version":1`, `"version":2`},
		{"version float", `"version":1`, `"version":1.0`},
		{"duplicate key", `"version":1`, `"version":1,"version":1`},
		{"extra key", `"version":1`, `"version":1,"extra":true`},
		{"company", routeTestCompanyID.String(), "44444444-4444-4444-4444-444444444444"},
		{"kind", `"kind":"manual"`, `"kind":"other"`},
		{"timestamp precision", `.123456Z`, `.1234560Z`},
	} {
		changed := strings.Replace(string(raw), mutation.from, mutation.to, 1)
		if changed == string(raw) {
			t.Fatal("mutation did not change token", mutation.name)
		}
		cases = append(cases, struct {
			name, token, filter string
			status              int
		}{mutation.name, base64.RawURLEncoding.EncodeToString([]byte(changed)), "years=0_1&years=1_3", 400})
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := doRouteRequest(t, router, "GET", orgCandidatesPath+"?"+tc.filter+"&cursor="+url.QueryEscape(tc.token), "", headers)
			assertDraftRouteNoStore(t, w)
			if w.Code != tc.status || (tc.status == 400 && routeCatalogCode(t, w) != "invalid_cursor") {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}

func TestOrgCandidatesInvalidCursor(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for i, token := range []string{"", "bad", strings.Repeat("a", 4097), base64.RawURLEncoding.EncodeToString([]byte(`{"version":1,"version":1}`))} {
		t.Run(fmt.Sprintf("token_%d", i), func(t *testing.T) {
			w := doRouteRequest(t, orgCandidatesRouter(), "GET", orgCandidatesPath+"?cursor="+token, "", headers)
			assertDraftRouteNoStore(t, w)
			var got map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &got)
			if w.Code != 400 || len(got) != 2 || got["code"] != "invalid_cursor" {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}
