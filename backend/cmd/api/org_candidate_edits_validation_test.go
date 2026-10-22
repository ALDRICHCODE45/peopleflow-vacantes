package main

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/google/uuid"
)

const editStudy = `{"level":"bachelor","institution":"UNAM","field":"Computación","status":"completed","start_year":2015,"end_year":2019}`
const editInitial = `{"full_name":"Initial Candidate","email":"initial@example.test","phone":null,"location":{"country":"US","state":null,"municipality":null,"postal_code":null},"professional_title":"Engineer","current_company":"Initial Company","seniority":"junior","years_of_experience":"2","education":[` + editStudy + `],"languages":[{"code":"en","level":"B1"}],"skills":["go","sql"],"linkedin_url":"https://example.test/in/initial","portfolio_url":"https://example.test/initial"}`

type editCase struct{ name, body, field, code string }

func editInvalidCases() []editCase {
	return []editCase{
		{"unknown envelope", `{"wat":1,"set":{"email":null}}`, "", ""},
		{"unknown field", `{"set":{"summary":"not editable"}}`, "", ""},
		{"duplicate set", `{"set":{"phone":null},"set":{"email":null}}`, "", ""},
		{"duplicate field", `{"set":{"full_name":"One Name","full_name":"Other Name"}}`, "", ""},
		{"duplicate nested", `{"set":{"languages":[{"code":"en","code":"es","level":"B1"}]}}`, "", ""},
		{"reset manual", `{"reset":[],"set":{"phone":null}}`, "", ""},
		{"both", `{"reset":["email"],"set":{"email":null}}`, "", ""},
		{"empty", `{"set":{}}`, "", ""}, {"empty envelope", `{}`, "", ""}, {"null set", `{"set":null}`, "", ""},
		{"trailing", `{"set":{"phone":null}} {}`, "", ""},
		{"name required", `{"set":{"full_name":null}}`, "full_name", "required"},
		{"name invalid", `{"set":{"full_name":"A"}}`, "full_name", "invalid"},
		{"name length", `{"set":{"full_name":"` + strings.Repeat("ñ", 121) + `"}}`, "full_name", "too_long"},
		{"email", `{"set":{"email":"broken"}}`, "email", "invalid"},
		{"phone", `{"set":{"phone":"3312345678"}}`, "phone", "invalid"},
		{"phone whitespace", `{"set":{"phone":" +523312345678"}}`, "phone", "invalid"},
		{"MX phone length", `{"set":{"phone":"+5212345678901"}}`, "phone", "invalid"},
		{"contact", `{"set":{"email":null,"phone":null}}`, "contact", "required"},
		{"location required", `{"set":{"location":null}}`, "location", "required"},
		{"country catalog", `{"set":{"location":{"country":"XZ"}}}`, "location.country", "invalid"},
		{"MX subdivisions", `{"set":{"location":{"country":"MX"}}}`, "location.state", "required"},
		{"foreign subdivision", `{"set":{"location":{"country":"US","state":"14"}}}`, "location.state", "not_allowed"},
		{"title", `{"set":{"professional_title":22}}`, "professional_title", "invalid"},
		{"title length", `{"set":{"professional_title":"` + strings.Repeat("á", 121) + `"}}`, "professional_title", "too_long"},
		{"company", `{"set":{"current_company":false}}`, "current_company", "invalid"},
		{"seniority", `{"set":{"seniority":"Senior"}}`, "seniority", "invalid"},
		{"numeric years", `{"set":{"years_of_experience":2.5}}`, "years_of_experience", "invalid"},
		{"decimal years", `{"set":{"years_of_experience":"2.55"}}`, "years_of_experience", "invalid"},
		{"negative years", `{"set":{"years_of_experience":"-1"}}`, "years_of_experience", "invalid"},
		{"excess years", `{"set":{"years_of_experience":"60.1"}}`, "years_of_experience", "invalid"},
		{"studies required", `{"set":{"education":null}}`, "education", "required"},
		{"studies empty", `{"set":{"education":[]}}`, "education", "required"},
		{"study six keys", `{"set":{"education":[{"level":"bachelor"}]}}`, "education[0].status", "required"},
		{"study unknown", `{"set":{"education":[{"other":1}]}}`, "", ""},
		{"study status", `{"set":{"education":[{"level":"bachelor","institution":null,"field":null,"status":"done","start_year":null,"end_year":null}]}}`, "education[0].status", "invalid"},
		{"study year", `{"set":{"education":[{"level":"bachelor","institution":null,"field":null,"status":"in_progress","start_year":2020,"end_year":2024}]}}`, "education[0].end_year", "not_allowed"},
		{"skills type", `{"set":{"skills":"go"}}`, "skills", "invalid"},
		{"skills duplicate", `{"set":{"skills":["GO","go"]}}`, "skills[1]", "duplicate"},
		{"language catalog", `{"set":{"languages":[{"code":"xx","level":"B1"}]}}`, "languages[0].code", "invalid"},
		{"language level", `{"set":{"languages":[{"code":"en","level":"b1"}]}}`, "languages[0].level", "invalid"},
		{"language duplicate", `{"set":{"languages":[{"code":"en","level":"B1"},{"code":"en","level":"C1"}]}}`, "languages[1].code", "duplicate"},
		{"linkedin", `{"set":{"linkedin_url":"http://example.test"}}`, "linkedin_url", "invalid"},
		{"portfolio", `{"set":{"portfolio_url":"https://user:pass@example.test"}}`, "portfolio_url", "invalid"},
	}
}

// An in-memory persistence seam runs the production application validation and
// diff, not reimplemented validators. SQL/locking/atomicity are tested separately.
type editMemory struct {
	orgDetailReader
	values  map[string]json.RawMessage
	version int64
	entries []pool.HistoryEntry
}

func newEditMemory() *editMemory {
	s := &editMemory{version: 1}
	_ = json.Unmarshal([]byte(editInitial), &s.values)
	return s
}

type editLookup struct{}

func (editLookup) CountryExists(_ context.Context, c string) (bool, error) {
	return c == "US" || c == "MX", nil
}
func (editLookup) StateExists(_ context.Context, c, s string) (bool, error) {
	return c == "MX" && s == "14", nil
}
func (editLookup) MunicipalityState(_ context.Context, c, m string) (string, error) {
	if c == "MX" && m == "14039" {
		return "14", nil
	}
	return "", nil
}
func (editLookup) PostalMatches(context.Context, string, string) ([]geo.PostalMatch, error) {
	return nil, nil
}
func (s *editMemory) Detail(ctx context.Context, c uuid.UUID, k string, id uuid.UUID) (pool.Detail, error) {
	d, err := s.orgDetailReader.Detail(ctx, c, k, id)
	if err != nil {
		return d, err
	}
	d.ETag = pool.ETag(k, id, s.version)
	d.CorrectedFields = []string{}
	d.Skills = []string{}
	_ = json.Unmarshal(s.values["full_name"], &d.FullName)
	_ = json.Unmarshal(s.values["education"], &d.Education)
	return d, nil
}
func (s *editMemory) Edit(ctx context.Context, c, a, id uuid.UUID, tag string, body []byte) (pool.Detail, error) {
	if _, err := s.Detail(ctx, c, "manual", id); err != nil {
		return pool.Detail{}, err
	}
	if tag != pool.ETag("manual", id, s.version) {
		return pool.Detail{}, pool.ErrPreconditionFailed
	}
	set, err := board.ParseManualEdit(body)
	if err != nil {
		return pool.Detail{}, err
	}
	after, changes, _, err := pool.PrepareManualEdit(ctx, editLookup{}, s.values, set)
	if err != nil {
		return pool.Detail{}, err
	}
	if len(changes) > 0 {
		s.values = after
		s.version++
		s.entries = append([]pool.HistoryEntry{{ID: uuid.New(), At: time.Date(2026, 1, 1, 0, 0, 0, int(s.version)*1000, time.UTC), Actor: pool.Creator{ID: a}, Kind: "edit", Changes: changes}}, s.entries...)
	}
	return s.Detail(ctx, c, "manual", id)
}
func (s *editMemory) History(ctx context.Context, c uuid.UUID, k string, id uuid.UUID, q pool.HistoryQuery) (pool.HistoryPage, error) {
	if _, err := s.Detail(ctx, c, k, id); err != nil {
		return pool.HistoryPage{}, err
	}
	out := pool.HistoryPage{Items: []pool.HistoryEntry{}}
	if k == "organic" {
		return out, nil
	}
	for _, e := range s.entries {
		if q.After != nil && !e.At.Before(q.After.At) {
			continue
		}
		out.Items = append(out.Items, e)
		if len(out.Items) == q.Limit+1 {
			break
		}
	}
	return out, nil
}

func TestOrgCandidateEditsValidationHTTP(t *testing.T) {
	for _, tc := range editInvalidCases() {
		t.Run(tc.name, func(t *testing.T) {
			s := newEditMemory()
			before, _ := json.Marshal(s.values)
			headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": pool.ETag("manual", routeTestDraftID, 1)}
			w := doRouteRequest(t, orgCandidatesRouter(s), "PATCH", orgCandidatesPath+"/manual/"+routeTestDraftID.String(), tc.body, headers)
			assertDraftRouteNoStore(t, w)
			code := "invalid_request"
			if tc.field != "" {
				code = "validation_error"
			}
			if w.Code != 400 || routeCatalogCode(t, w) != code {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			if tc.field != "" {
				var body struct {
					Fields []struct{ Field, Code string }
				}
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				found := false
				for _, f := range body.Fields {
					if strings.HasPrefix(f.Field, "candidate.") {
						t.Fatal(f)
					}
					if f.Field == tc.field && f.Code == tc.code {
						found = true
					}
				}
				if !found {
					t.Fatalf("missing %s/%s: %s", tc.field, tc.code, w.Body.String())
				}
			}
			after, _ := json.Marshal(s.values)
			if string(before) != string(after) || s.version != 1 || len(s.entries) != 0 {
				t.Fatal("rejection changed persistence")
			}
		})
	}
}

func TestOrgCandidateEditsNoopAndHistoryHTTP(t *testing.T) {
	s := newEditMemory()
	router := orgCandidatesRouter(s)
	path := orgCandidatesPath + "/manual/" + routeTestDraftID.String()
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": pool.ETag("manual", routeTestDraftID, 1)}
	w := doRouteRequest(t, router, "PATCH", path, `{"set":{"years_of_experience":"2.0","full_name":" Initial Candidate "}}`, headers)
	if w.Code != 200 || w.Header().Get("ETag") != headers["If-Match"] || len(s.entries) != 0 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = doRouteRequest(t, router, "PATCH", path, `{"set":{"phone":"+523312345678","years_of_experience":"4.5","skills":["Rust"]}}`, headers)
	if w.Code != 200 || w.Header().Get("ETag") == headers["If-Match"] {
		t.Fatal(w.Code, w.Body.String())
	}
	current := w.Header().Get("ETag")
	w = doRouteRequest(t, router, "PATCH", path, `{"set":{"full_name":"Stale Candidate"}}`, headers)
	var envelope map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &envelope)
	if w.Code != 412 || len(envelope) != 2 || routeCatalogCode(t, w) != "precondition_failed" {
		t.Fatal(w.Code, w.Body.String())
	}
	headers["If-Match"] = current
	w = doRouteRequest(t, router, "PATCH", path, `{"set":{"current_company":null,"languages":null,"skills":null}}`, headers)
	if w.Code != 200 || string(s.values["current_company"]) != "null" || string(s.values["languages"]) != "[]" || string(s.values["skills"]) != "[]" {
		t.Fatal(w.Code, w.Body.String(), s.values)
	}
	w = doRouteRequest(t, router, "GET", path+"/history?limit=1", "", headers)
	var page pool.HistoryPage
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatal(w.Code, w.Body.String())
	}
	w = doRouteRequest(t, router, "GET", path+"/history?limit=50&cursor="+*page.NextCursor, "", headers)
	page = pool.HistoryPage{}
	if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	expected := `[{"field":"phone","contact":true},{"field":"skills","from":["go","sql"],"to":["rust"]},{"field":"years_of_experience","from":"2","to":"4.5"}]`
	var want []pool.Change
	_ = json.Unmarshal([]byte(expected), &want)
	if w.Code != 200 || len(page.Items) != 1 || page.NextCursor != nil || !reflect.DeepEqual(page.Items[0].Changes, want) {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, query := range []string{"limit=0", "limit=51", "limit=-1", "limit=1&limit=2", "unknown=x", "cursor=bad", "cursor="} {
		w = doRouteRequest(t, router, "GET", path+"/history?"+query, "", headers)
		if w.Code != 400 {
			t.Fatal(query, w.Code, w.Body.String())
		}
	}
	w = doRouteRequest(t, router, "GET", orgCandidatesPath+"/organic/"+routeTestDraftID.String()+"/history", "", headers)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"items":[],"next_cursor":null}` {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, method := range []string{"PATCH", "GET"} {
		suffix := ""
		if method == "GET" {
			suffix = "/history"
		}
		w = doRouteRequest(t, router, method, orgCandidatesPath+"/manual/"+uuid.NewString()+suffix, `{"set":{"phone":null}}`, headers)
		if w.Code != 404 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
