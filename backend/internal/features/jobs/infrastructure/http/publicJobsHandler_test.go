package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type publicReaderStub struct {
	form  *publicjobs.Screening
	rows  []publicjobs.Row
	err   error
	calls int
}

func (s *publicReaderStub) Search(context.Context, publicjobs.Query) ([]publicjobs.Row, error) {
	s.calls++
	return s.rows, s.err
}
func (s *publicReaderStub) Get(_ context.Context, id uuid.UUID) (publicjobs.Detail, error) {
	s.calls++
	if s.err != nil {
		return publicjobs.Detail{}, s.err
	}
	if len(s.rows) == 0 || s.rows[0].Detail.ID != id {
		return publicjobs.Detail{}, publicjobs.ErrNotFound
	}
	return s.rows[0].Detail, nil
}

func (s *publicReaderStub) Screening(context.Context, uuid.UUID) (publicjobs.Screening, error) {
	s.calls++
	if s.err != nil {
		return publicjobs.Screening{}, s.err
	}
	if s.form == nil {
		return publicjobs.Screening{}, publicjobs.ErrNotFound
	}
	return *s.form, nil
}
func TestPublicUnavailableExactTombstone(t *testing.T) {
	for _, state := range []string{"paused", "closed"} {
		for _, suffix := range []string{"", "/screening"} {
			t.Run(state+suffix, func(t *testing.T) {
				id := uuid.MustParse("11111111-1111-4111-8111-111111111111")
				unavailable := &publicjobs.Unavailable{ID: id, Title: "Role", Availability: state}
				unavailable.Company.ID = id
				unavailable.Company.Name = "Acme"
				h := NewPublicJobsHandler(publicjobs.NewCatalog(&publicReaderStub{err: unavailable}))
				r := chi.NewRouter()
				r.Get("/v2/jobs/{id}", h.Get)
				r.Get("/v2/jobs/{id}/screening", h.Screening)
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs/"+id.String()+suffix, nil))
				var got map[string]any
				if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				data, ok := got["data"].(map[string]any)
				if w.Code != 410 || len(got) != 3 || got["code"] != "vacancy_unavailable" || !ok || len(data) != 4 {
					t.Fatal(w.Code, w.Body.String())
				}
				raw, _ := json.Marshal(data)
				if string(raw) != `{"availability":"`+state+`","company":{"id":"`+id.String()+`","name":"Acme"},"id":"`+id.String()+`","title":"Role"}` {
					t.Fatal(string(raw))
				}
			})
		}
	}
}

func TestPublicScreeningHTTPExactShape(t *testing.T) {
	form := publicjobs.Screening{Revision: "opaque", Questions: []publicjobs.ScreeningQuestion{{ID: uuid.NewString(), Prompt: "Why?", Type: "open", Options: nil}}, Limits: publicjobs.ScreeningLimits{OpenAnswerMaxLength: 2000}}
	stub := &publicReaderStub{form: &form}
	h := NewPublicJobsHandler(publicjobs.NewCatalog(stub))
	r := chi.NewRouter()
	r.Get("/v2/jobs/{id}/screening", h.Screening)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs/"+uuid.NewString()+"/screening", nil))
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || len(got) != 3 || w.Header().Get("Cache-Control") != "" || w.Header().Get("ETag") != "" {
		t.Fatal(w.Code, got, w.Header())
	}
	q := got["questions"].([]any)[0].(map[string]any)
	if len(q) != 4 || q["options"] != nil || q["type"] != "open" {
		t.Fatal(q)
	}
	limits := got["limits"].(map[string]any)
	if len(limits) != 1 || limits["open_answer_max_length"] != float64(2000) {
		t.Fatal(limits)
	}
	stub.form = nil
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs/"+uuid.NewString()+"/screening", nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}

func TestPublicJobsHTTPCursorRejectsChangedScalarFilters(t *testing.T) {
	for _, tc := range []struct {
		key, original, changed string
	}{
		{"work_schedule", "full_time", "part_time"},
		{"contract_type", "indefinite", "project"},
		{"professional_area", "technology_systems", "legal"},
	} {
		t.Run(tc.key, func(t *testing.T) {
			at := time.Date(2026, 10, 16, 18, 0, 0, 0, time.UTC)
			stub := &publicReaderStub{rows: []publicjobs.Row{
				{Detail: publicjobs.Detail{Item: publicjobs.Item{ID: uuid.New(), Source: "vacancy", PublishedAt: at}}},
				{Detail: publicjobs.Detail{Item: publicjobs.Item{ID: uuid.New(), Source: "vacancy", PublishedAt: at}}},
			}}
			r := chi.NewRouter()
			r.Get("/v2/jobs", NewPublicJobsHandler(publicjobs.NewCatalog(stub)).List)
			get := func(query string) *httptest.ResponseRecorder {
				t.Helper()
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v2/jobs?"+query, nil))
				return w
			}
			first := get(tc.key + "=" + tc.original + "&limit=1")
			var page publicjobs.Page
			if err := json.Unmarshal(first.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
			if first.Code != http.StatusOK || page.NextCursor == nil {
				t.Fatalf("cursor issuance: %d %s", first.Code, first.Body.String())
			}
			cursor := "&cursor=" + url.QueryEscape(*page.NextCursor)
			// Positive control: the issued cursor is valid with its original filter.
			if same := get(tc.key + "=" + tc.original + cursor); same.Code != http.StatusOK {
				t.Fatalf("unchanged filter: %d %s", same.Code, same.Body.String())
			}
			before := stub.calls
			changed := get(tc.key + "=" + tc.changed + cursor)
			if changed.Code != http.StatusBadRequest || changed.Body.String() != "{\"error\":\"invalid request\",\"code\":\"invalid_request\"}\n" {
				t.Fatalf("changed filter: %d %s", changed.Code, changed.Body.String())
			}
			if stub.calls != before {
				t.Fatal("changed-filter cursor reached reader")
			}
		})
	}
}

func TestPublicJobsHTTPStrictAnonymousAndCacheHeaders(t *testing.T) {
	id := uuid.New()
	stub := &publicReaderStub{rows: []publicjobs.Row{{Detail: publicjobs.Detail{Item: publicjobs.Item{ID: id, Source: "vacancy", Title: "Go", PublishedAt: time.Now().UTC()}, Benefits: publicjobs.Benefits{Predefined: []string{}, Custom: []string{}}}}}}
	r := chi.NewRouter()
	h := NewPublicJobsHandler(publicjobs.NewCatalog(stub))
	r.Get("/v2/jobs", h.List)
	r.Get("/v2/jobs/{id}", h.Get)
	for _, tc := range []struct {
		name, path string
		status     int
		code       string
	}{
		{"list", "/v2/jobs", 200, ""}, {"detail", "/v2/jobs/" + id.String(), 200, ""},
		{"repeated filters", "/v2/jobs?state=09&state=14&municipality=14039&work_mode=remote&work_mode=hybrid&applicant_country=MX", 200, ""},
		{"profile filters", "/v2/jobs?seniority=senior&language=en&years_of_experience=2.0&education_level=bachelor", 200, ""},
		{"unknown param", "/v2/jobs?unknown=senior", 400, "invalid_request"},
		{"invalid profile filter", "/v2/jobs?seniority=mid", 400, "invalid_filter"},
		{"duplicate", "/v2/jobs?limit=1&limit=2", 400, "invalid_request"},
		{"invalid enum", "/v2/jobs?contract_type=contract", 400, "invalid_request"},
		{"bad cursor", "/v2/jobs?cursor=bad", 400, "invalid_request"},
		{"removed location", "/v2/jobs?location=Mexico", 400, "invalid_request"},
		{"malformed state", "/v2/jobs?state=9", 400, "invalid_filter"},
		{"reserved none", "/v2/jobs?municipality=none", 400, "invalid_filter"},
		{"duplicate value", "/v2/jobs?work_mode=remote&work_mode=remote", 400, "invalid_filter"},
		{"repeated country", "/v2/jobs?applicant_country=MX&applicant_country=CO", 400, "invalid_filter"},
		{"missing", "/v2/jobs/" + uuid.NewString(), 404, "not_found"},
		{"malformed id", "/v2/jobs/bad", 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := stub.calls
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if w.Code != tc.status {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "" {
				t.Fatal("private cache headers")
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if tc.code != "" && (len(body) != 2 || body["code"] != tc.code) {
				t.Fatalf("error=%s", w.Body.String())
			}
			if tc.status == 400 && stub.calls != before {
				t.Fatal("invalid request reached reader")
			}
			if tc.name == "list" {
				if len(body) != 2 || body["next_cursor"] != nil {
					t.Fatal("list envelope")
				}
				item := body["items"].([]any)[0].(map[string]any)
				if len(item) != 25 {
					t.Fatalf("list keys=%v", item)
				}
			}
			if tc.name == "detail" && len(body) != 30 {
				t.Fatalf("detail keys=%v", body)
			}
		})
	}
	stub.err = errors.Join(errors.New("wrapped"), publicjobs.ErrInvalidFilter)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs?state=99", nil))
	if w.Code != 400 || w.Body.String() != "{\"error\":\"invalid filter\",\"code\":\"invalid_filter\"}\n" {
		t.Fatalf("catalog validation envelope: %d %s", w.Code, w.Body.String())
	}
	stub.err = errors.New("database failure with sensitive context")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/jobs", nil))
	if w.Code != 500 || w.Body.String() == stub.err.Error() {
		t.Fatal("internal error leaked")
	}
}
