package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	pool "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
)

type organicEditMemory struct {
	*editMemory
	corrections map[string]json.RawMessage
}

func newOrganicEditMemory() *organicEditMemory {
	return &organicEditMemory{newEditMemory(), map[string]json.RawMessage{}}
}
func (s *organicEditMemory) Detail(ctx context.Context, c uuid.UUID, k string, id uuid.UUID) (pool.Detail, error) {
	d, err := s.editMemory.Detail(ctx, c, k, id)
	if err != nil {
		return d, err
	}
	d.Original = &pool.Original{FullName: d.FullName}
	for key, v := range s.corrections {
		d.CorrectedFields = append(d.CorrectedFields, key)
		if key == "full_name" {
			_ = json.Unmarshal(v, &d.FullName)
		}
	}
	return d, nil
}
func (s *organicEditMemory) EditOrganic(ctx context.Context, c, a, id uuid.UUID, tag string, body []byte) (pool.Detail, error) {
	if _, err := s.Detail(ctx, c, "organic", id); err != nil {
		return pool.Detail{}, err
	}
	if tag != pool.ETag("organic", id, s.version) {
		return pool.Detail{}, pool.ErrPreconditionFailed
	}
	set, reset, err := board.ParseOrganicEdit(body)
	if err != nil {
		return pool.Detail{}, err
	}
	next, changes, err := pool.PrepareOrganicEdit(ctx, editLookup{}, s.values, s.corrections, set, reset)
	if err != nil {
		return pool.Detail{}, err
	}
	if len(changes) > 0 {
		s.corrections = next
		s.version++
		s.entries = append([]pool.HistoryEntry{{ID: uuid.New(), At: time.Now().UTC(), Actor: pool.Creator{ID: a}, Kind: "edit", Changes: changes}}, s.entries...)
	}
	return s.Detail(ctx, c, "organic", id)
}
func (s *organicEditMemory) History(ctx context.Context, c uuid.UUID, k string, id uuid.UUID, q pool.HistoryQuery) (pool.HistoryPage, error) {
	if _, err := s.Detail(ctx, c, k, id); err != nil {
		return pool.HistoryPage{}, err
	}
	return pool.HistoryPage{Items: s.entries}, nil
}
func TestOrgCandidateCorrectionsValidationHTTP(t *testing.T) {
	cases := editInvalidCases()
	filtered := []editCase{}
	for _, tc := range cases {
		if tc.name != "reset manual" {
			filtered = append(filtered, tc)
		}
	}
	filtered = append(filtered, []editCase{
		{"reset uncorrected", `{"reset":["seniority"]}`, "", ""},
		{"reset duplicate", `{"reset":["email","email"]}`, "", ""},
		{"reset unknown", `{"reset":["summary"]}`, "", ""},
		{"reset null", `{"reset":null}`, "", ""},
		{"reset wrong type", `{"reset":[1]}`, "", ""},
		{"empty reset", `{"reset":[]}`, "", ""},
	}...)
	for _, tc := range filtered {
		t.Run(tc.name, func(t *testing.T) {
			s := newOrganicEditMemory()
			headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": pool.ETag("organic", routeTestDraftID, 1)}
			w := doRouteRequest(t, orgCandidatesRouter(s), "PATCH", orgCandidatesPath+"/organic/"+routeTestDraftID.String(), tc.body, headers)
			assertDraftRouteNoStore(t, w)
			code := "invalid_request"
			if tc.field != "" {
				code = "validation_error"
			}
			if w.Code != 400 || routeCatalogCode(t, w) != code {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			if tc.field != "" {
				var b struct {
					Fields []struct{ Field, Code string }
				}
				_ = json.Unmarshal(w.Body.Bytes(), &b)
				found := false
				for _, f := range b.Fields {
					if f.Field == tc.field && f.Code == tc.code {
						found = true
					}
					if strings.HasPrefix(f.Field, "candidate.") {
						t.Fatal(f)
					}
				}
				if !found {
					t.Fatal(w.Body.String())
				}
			}
			if s.version != 1 || len(s.corrections) != 0 || len(s.entries) != 0 {
				t.Fatal("rejection mutated state")
			}
		})
	}
}
func TestOrgCandidateCorrectionsContactResetHTTP(t *testing.T) {
	s := newOrganicEditMemory()
	router := orgCandidatesRouter(s)
	path := orgCandidatesPath + "/organic/" + routeTestDraftID.String()
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": pool.ETag("organic", routeTestDraftID, 1)}
	w := doRouteRequest(t, router, "PATCH", path, `{"set":{"email":null,"phone":"+523312345678","languages":[{"code":"es","level":"native"},{"code":"en","level":"B1"}]}}`, headers)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	headers["If-Match"] = w.Header().Get("ETag")
	w = doRouteRequest(t, router, "PATCH", path, `{"reset":["phone"]}`, headers)
	if w.Code != 400 || routeCatalogCode(t, w) != "validation_error" || !strings.Contains(w.Body.String(), `"field":"contact","code":"required"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = doRouteRequest(t, router, "PATCH", path, `{"set":{"languages":[{"code":"en","level":"B1"},{"code":"es","level":"native"}]}}`, headers)
	if w.Code != 200 || w.Header().Get("ETag") != headers["If-Match"] || len(s.entries) != 1 {
		t.Fatal("language order is not a no-op", w.Code, w.Body.String())
	}
	// Original organic records can lack a snapshot, location, studies or profile.
	// Editing one field must not demand repairs to untouched legacy fields.
	s = newOrganicEditMemory()
	s.values["location"] = json.RawMessage(`null`)
	s.values["education"] = json.RawMessage(`null`)
	router = orgCandidatesRouter(s)
	headers["If-Match"] = pool.ETag("organic", routeTestDraftID, 1)
	w = doRouteRequest(t, router, "PATCH", path, `{"set":{"professional_title":"Legacy Engineer"}}`, headers)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestOrgCandidateCorrectionsSetResetHTTP(t *testing.T) {
	s := newOrganicEditMemory()
	r := orgCandidatesRouter(s)
	path := orgCandidatesPath + "/organic/" + routeTestDraftID.String()
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": pool.ETag("organic", routeTestDraftID, 1)}
	patch := func(body string, status int) {
		t.Helper()
		w := doRouteRequest(t, r, "PATCH", path, body, headers)
		assertDraftRouteNoStore(t, w)
		if w.Code != status {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
		if status == 200 {
			headers["If-Match"] = w.Header().Get("ETag")
		}
	}
	patch(`{"set":{"full_name":"Corrected Candidate","email":"corrected@example.test","phone":"+523312345678","years_of_experience":"4.5","skills":["Rust"]}}`, 200)
	patch(`{"set":{"phone":null,"skills":null}}`, 200)
	if string(s.corrections["phone"]) != "null" || string(s.corrections["skills"]) != "[]" {
		t.Fatal(s.corrections)
	}
	version := s.version
	patch(`{"set":{"years_of_experience":"4.5"}}`, 200)
	if s.version != version {
		t.Fatal("no-op advanced version")
	}
	patch(`{"set":{"email":null}}`, 400)
	patch(`{"set": { }, "reset":["full_name","email","phone","years_of_experience","skills"]}`, 200)
	if len(s.corrections) != 0 || string(s.values["full_name"]) != `"Initial Candidate"` {
		t.Fatal(s.corrections, s.values)
	}
	patch(`{"reset":["phone"]}`, 400)
	w := doRouteRequest(t, r, "GET", path+"/history", "", headers)
	var page struct {
		Items []struct{ Changes []map[string]any }
	}
	_ = json.Unmarshal(w.Body.Bytes(), &page)
	if w.Code != 200 || len(page.Items) != 3 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, c := range page.Items[0].Changes {
		if c["reset"] != true {
			t.Fatal(c)
		}
		key := c["field"].(string)
		if key == "email" || key == "phone" || key == "full_name" {
			if len(c) != 3 || c["contact"] != true {
				t.Fatal("contact reset values", c)
			}
		} else {
			var original any
			_ = json.Unmarshal(s.values[key], &original)
			got, _ := json.Marshal(c["to"])
			want, _ := json.Marshal(original)
			if string(got) != string(want) {
				t.Fatal(c)
			}
		}
	}
	for _, token := range []string{"", `"stale"`, `W/` + headers["If-Match"], "*", headers["If-Match"] + `, "other"`} {
		headers["If-Match"] = token
		status := 412
		if token == "" {
			status = 428
		}
		patch(`{"set":{"full_name":"Stale Candidate"}}`, status)
	}
	for _, method := range []string{"PATCH", "GET"} {
		suffix := ""
		if method == "GET" {
			suffix = "/history"
		}
		w = doRouteRequest(t, r, method, orgCandidatesPath+"/organic/"+uuid.NewString()+suffix, `{"set":{"phone":null}}`, headers)
		if method == "PATCH" && headers["If-Match"] == "" {
			continue
		}
		if w.Code != 404 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
