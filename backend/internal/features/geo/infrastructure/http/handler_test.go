package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

type readerStub struct {
	err         error
	version     string
	countryName string
	matches     []domain.PostalMatch
	postalCalls int
}

func (s *readerStub) Countries(context.Context) ([]domain.Item, error) {
	name := s.countryName
	if name == "" {
		name = "México"
	}
	return []domain.Item{{Code: "MX", Name: name}}, s.err
}
func (s *readerStub) States(context.Context, string) ([]domain.Item, error) {
	return []domain.Item{{Code: "14", Name: "Jalisco"}}, s.err
}
func (s *readerStub) Municipalities(context.Context, string, string) ([]domain.Item, error) {
	return []domain.Item{{Code: "14039", Name: "Guadalajara"}}, s.err
}
func (s *readerStub) CountryExists(_ context.Context, c string) (bool, error) {
	return c == "MX" || c == "US", s.err
}
func (s *readerStub) StateExists(_ context.Context, c, s1 string) (bool, error) {
	return c == "MX" && s1 == "14", s.err
}
func (s *readerStub) MunicipalityState(context.Context, string, string) (string, error) {
	return "14", s.err
}
func (s *readerStub) PostalMatches(_ context.Context, c, p string) ([]domain.PostalMatch, error) {
	s.postalCalls++
	if p != "44100" {
		return nil, s.err
	}
	if s.matches != nil {
		return s.matches, s.err
	}
	return []domain.PostalMatch{{State: domain.Item{Code: "14", Name: "Jalisco"}, Municipality: domain.Item{Code: "14039", Name: "Guadalajara"}}}, s.err
}
func (s *readerStub) Version(context.Context) (string, error) { return s.version, s.err }
func TestCatalogRoutes(t *testing.T) {
	stub := &readerStub{version: "1"}
	r := chi.NewRouter()
	RegisterRoutes(r, stub)
	for _, tc := range []struct {
		name, path string
		status     int
		code       httpjson.Code
	}{
		{"countries", "/v2/geo/countries", 200, ""}, {"states", "/v2/geo/countries/MX/states", 200, ""},
		{"municipalities", "/v2/geo/countries/MX/states/14/municipalities", 200, ""}, {"postal", "/v2/geo/countries/MX/postal-codes/44100", 200, ""},
		{"unsupported", "/v2/geo/countries/US/states", 404, httpjson.CodeCountryNotFound},
		{"unknown country", "/v2/geo/countries/ZZ/states", 404, httpjson.CodeCountryNotFound},
		{"unknown state", "/v2/geo/countries/MX/states/99/municipalities", 404, httpjson.CodeStateNotFound},
		{"bad postal", "/v2/geo/countries/MX/postal-codes/1234", 400, httpjson.CodeInvalidPostalCode},
		{"unicode digits", "/v2/geo/countries/MX/postal-codes/１２３４５", 400, httpjson.CodeInvalidPostalCode},
		{"unknown postal", "/v2/geo/countries/MX/postal-codes/00000", 404, httpjson.CodePostalCodeNotFound},
		{"unknown parameter", "/v2/geo/countries?q=x", 400, httpjson.CodeInvalidRequest},
		{"malformed parameter", "/v2/geo/countries?x=%zz", 400, httpjson.CodeInvalidRequest},
		{"bulk postal unavailable", "/v2/geo/countries/MX/postal-codes", 404, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tc.path, nil)
			req.Header.Set("Authorization", "Bearer ignored")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			if tc.code != "" {
				var env httpjson.ErrorEnvelope
				if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || env.Code != tc.code {
					t.Fatal(w.Body, err)
				}
			}
			if tc.status == 200 {
				if w.Header().Get("Cache-Control") != "public, max-age=86400" {
					t.Fatal(w.Header())
				}
				tag := w.Header().Get("ETag")
				if !strings.HasPrefix(tag, `"`) || strings.HasPrefix(tag, "W/") {
					t.Fatal(tag)
				}
				for _, condition := range []string{tag, "W/" + tag, `"other", ` + tag, "*"} {
					rr := httptest.NewRecorder()
					re := httptest.NewRequest("GET", tc.path, nil)
					re.Header.Set("If-None-Match", condition)
					r.ServeHTTP(rr, re)
					if rr.Code != 304 || rr.Body.Len() != 0 || rr.Header().Get("ETag") != tag {
						t.Fatal(rr.Code, rr.Body)
					}
				}
				stub.version = "2"
				rr := httptest.NewRecorder()
				re := httptest.NewRequest("GET", tc.path, nil)
				re.Header.Set("If-None-Match", tag)
				r.ServeHTTP(rr, re)
				if rr.Code != 200 || rr.Header().Get("ETag") == tag {
					t.Fatal("refresh must invalidate", rr.Code)
				}
				stub.version = "1"
			}
		})
	}
	stub.err = errors.New("private database detail")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/geo/countries", nil))
	if w.Code != 500 || strings.Contains(w.Body.String(), "private") || w.Header().Get("Cache-Control") != "" {
		t.Fatal(w.Code, w.Body, w.Header())
	}
}

func TestCatalogWireShapesAndRepresentationETag(t *testing.T) {
	stub := &readerStub{version: "1"}
	r := chi.NewRouter()
	RegisterRoutes(r, stub)
	for _, tc := range []struct{ path, want string }{
		{"/v2/geo/countries", `{"items":[{"id":"MX","name":"México"}]}`},
		{"/v2/geo/countries/MX/states", `{"items":[{"id":"14","name":"Jalisco"}]}`},
		{"/v2/geo/countries/MX/states/14/municipalities", `{"items":[{"id":"14039","name":"Guadalajara"}]}`},
		{"/v2/geo/countries/MX/postal-codes/44100", `{"postal_code":"44100","matches":[{"state":{"id":"14","name":"Jalisco"},"municipality":{"id":"14039","name":"Guadalajara"}}]}`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			var got, want any
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.want), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("wire drift: %s", w.Body)
			}
		})
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/geo/countries", nil))
	stub.countryName = "Changed during a refresh"
	req := httptest.NewRequest("GET", "/v2/geo/countries", nil)
	req.Header.Set("If-None-Match", w.Header().Get("ETag"))
	next := httptest.NewRecorder()
	r.ServeHTTP(next, req)
	if next.Code != 200 || next.Header().Get("ETag") == w.Header().Get("ETag") {
		t.Fatal("different bytes must never share a strong validator")
	}
	stub.matches = []domain.PostalMatch{
		{State: domain.Item{Code: "14", Name: "Jalisco"}, Municipality: domain.Item{Code: "14039", Name: "Guadalajara"}},
		{State: domain.Item{Code: "14", Name: "Jalisco"}, Municipality: domain.Item{Code: "14040", Name: "Second municipality"}},
	}
	multi := httptest.NewRecorder()
	r.ServeHTTP(multi, httptest.NewRequest("GET", "/v2/geo/countries/MX/postal-codes/44100", nil))
	var body postalResponse
	if err := json.Unmarshal(multi.Body.Bytes(), &body); err != nil || len(body.Matches) != 2 {
		t.Fatal(multi.Body, err)
	}
}

func TestCoreCatalogRoutesWithoutPostalData(t *testing.T) {
	stub := &readerStub{version: "base-only-1", matches: []domain.PostalMatch{}}
	r := chi.NewRouter()
	RegisterRoutes(r, stub)
	for _, path := range []string{"/v2/geo/countries", "/v2/geo/countries/MX/states", "/v2/geo/countries/MX/states/14/municipalities"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			if w.Code != 200 || w.Header().Get("Cache-Control") != "public, max-age=86400" || w.Header().Get("ETag") == "" {
				t.Fatal(w.Code, w.Body, w.Header())
			}
		})
	}
	if stub.postalCalls != 0 {
		t.Fatal("core routes must not query postal data")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/geo/countries/MX/postal-codes/44100", nil))
	var envelope httpjson.ErrorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || w.Code != 404 || envelope.Code != httpjson.CodePostalCodeNotFound {
		t.Fatal(w.Code, w.Body, err)
	}
}

func TestUnexpectedErrorLogsOnlyBoundedCorrelation(t *testing.T) {
	var output bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	RegisterRoutes(r, &readerStub{err: errors.New("private database connection details")})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/v2/geo/countries", nil))
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if w.Code != 500 || len(record) != 5 || record["code_class"] != string(httpjson.CodeInternalError) || record["request_id"] == "" || strings.Contains(output.String(), "private") {
		t.Fatal(record, w.Code)
	}
	for _, key := range []string{"time", "level", "msg", "code_class", "request_id"} {
		if _, exists := record[key]; !exists {
			t.Fatalf("missing %s", key)
		}
	}
}
