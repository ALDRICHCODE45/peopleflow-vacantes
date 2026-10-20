package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	identity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	identityvalues "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type companyCatalog struct{ geo.Reader }

func (companyCatalog) CountryExists(_ context.Context, c string) (bool, error) {
	return c == "MX" || c == "US", nil
}
func (companyCatalog) StateExists(_ context.Context, c, s string) (bool, error) {
	return c == "MX" && (s == "14" || s == "15"), nil
}
func (companyCatalog) MunicipalityState(_ context.Context, _, m string) (string, error) {
	if m == "14039" || m == "14040" {
		return "14", nil
	}
	return "", nil
}
func (companyCatalog) PostalMatches(_ context.Context, _, p string) ([]domain.PostalMatch, error) {
	if p == "44100" {
		return []domain.PostalMatch{{Municipality: domain.Item{Code: "14039"}}}, nil
	}
	return nil, nil
}
func (companyCatalog) Countries(context.Context) ([]domain.Item, error) {
	return []domain.Item{{Code: "MX", Name: "México"}, {Code: "US", Name: "Estados Unidos"}}, nil
}
func (companyCatalog) States(context.Context, string) ([]domain.Item, error) {
	return []domain.Item{{Code: "14", Name: "Jalisco"}, {Code: "15", Name: "México"}}, nil
}
func (companyCatalog) Municipalities(context.Context, string, string) ([]domain.Item, error) {
	return []domain.Item{{Code: "14039", Name: "Guadalajara"}, {Code: "14040", Name: "Hostotipaquillo"}}, nil
}

type failingCompanyCatalog struct {
	companyCatalog
	level      string
	afterWrite func() bool
}

func (c failingCompanyCatalog) fails(level string) bool {
	return c.level == level || (c.afterWrite != nil && c.afterWrite())
}
func (c failingCompanyCatalog) Countries(ctx context.Context) ([]domain.Item, error) {
	if c.fails("country") {
		return nil, errors.New("catalog read failed")
	}
	return c.companyCatalog.Countries(ctx)
}
func (c failingCompanyCatalog) States(ctx context.Context, country string) ([]domain.Item, error) {
	if c.fails("state") {
		return nil, errors.New("catalog read failed")
	}
	return c.companyCatalog.States(ctx, country)
}
func (c failingCompanyCatalog) Municipalities(ctx context.Context, country, state string) ([]domain.Item, error) {
	if c.fails("municipality") {
		return nil, errors.New("catalog read failed")
	}
	return c.companyCatalog.Municipalities(ctx, country, state)
}

func TestCompanyCatalogFailureDoesNotWrite(t *testing.T) {
	for _, level := range []string{"country", "state", "municipality", "post-write forbidden"} {
		for _, method := range []string{"POST", "PATCH"} {
			t.Run(method+"/"+level, func(t *testing.T) {
				actor, id := uuid.New(), uuid.New()
				current, err := entities.NewCompany("Acme SA de CV", "AAA010101AAA", "tech", entities.CompanyProfile{})
				if err != nil {
					t.Fatal(err)
				}
				current.ID = id
				repo := &stubRepo{getForUpdateOut: current}
				bootstrap := &stubBootstrapRepo{}
				users := &stubUserRepo{resolved: &identity.User{ID: actor, UserType: identityvalues.UserRecruiter}}
				service := usecases.NewCompanyServiceWithBootstrap(repo, users, bootstrap, failingCompanyCatalog{level: level, afterWrite: func() bool { return bootstrap.company != nil || repo.updateCalls > 0 }})
				handler := NewCompanyHandler(service)
				router := chi.NewRouter()
				router.Post("/companies", handler.createCompany)
				router.Patch("/me/company", handler.updateCompany)
				body := `{"location":{"country":"MX","state":"14","municipality":"14039"}}`
				path := "/me/company"
				if method == "POST" {
					path = "/companies"
					body = `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech","location":{"country":"MX","state":"14","municipality":"14039"}}`
				}
				req := httptest.NewRequest(method, path, strings.NewReader(body))
				req.Header.Set("If-Unmodified-Since", current.UpdatedAt.Format(time.RFC3339Nano))
				ctx := security.ContextWithClaims(req.Context(), security.Claims{Subject: "sub"})
				ctx = security.ContextWithCompanyContext(ctx, security.CompanyContext{CompanyID: id, UserID: actor})
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req.WithContext(ctx))
				if level == "post-write forbidden" {
					want := 200
					if method == "POST" {
						want = 201
					}
					if rec.Code != want || (method == "POST" && bootstrap.company == nil) || (method == "PATCH" && repo.updateCalls != 1) {
						t.Fatalf("post-write catalog read: %d %s", rec.Code, rec.Body.String())
					}
					assertCompanyLocationKeys(t, companyObject(t, rec.Body.Bytes())["location"])
					return
				}
				memberAssertCatalogEnvelope(t, rec, 500, httpjson.CodeInternalError)
				if bootstrap.company != nil || repo.updateCalls != 0 || current.Location != nil {
					t.Fatal("catalog failure changed company storage")
				}
			})
		}
	}
}

func companyObject(t *testing.T, raw []byte) map[string]json.RawMessage {
	t.Helper()
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		t.Fatal(err)
	}
	return obj
}
func assertCompanyKeys(t *testing.T, obj map[string]json.RawMessage, want ...string) {
	t.Helper()
	got := make([]string, 0, len(obj))
	for k := range obj {
		got = append(got, k)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("keys: got %v want %v", got, want)
	}
}
func assertCompanyLocationKeys(t *testing.T, raw []byte) {
	t.Helper()
	location := companyObject(t, raw)
	assertCompanyKeys(t, location, "country", "state", "municipality", "postal_code", "label")
	for _, key := range []string{"country", "state", "municipality"} {
		if string(location[key]) != "null" {
			assertCompanyKeys(t, companyObject(t, location[key]), "id", "name")
		}
	}
}

func TestCompanyLocationCreateErrors(t *testing.T) {
	for _, tc := range []struct {
		name, location, field, reason string
		status                        int
	}{
		{"country required", `{}`, "location.country", "required", 422},
		{"unknown country", `{"country":"ZZ"}`, "location.country", "unknown", 422},
		{"international state", `{"country":"US","state":"14"}`, "location.state", "not_allowed", 422},
		{"municipality mismatch", `{"country":"MX","state":"15","municipality":"14039"}`, "location.municipality", "mismatch", 422},
		{"postal mismatch", `{"country":"MX","state":"14","municipality":"14040","postal_code":"44100"}`, "location.postal_code", "mismatch", 422},
		{"unknown key", `{"country":"MX","name":"México"}`, "", "", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bootstrap := &stubBootstrapRepo{}
			router := newTestRouter(newTestHandlerWithBootstrap(&stubRepo{}, bootstrap))
			rec := doPost(t, router, `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech","location":`+tc.location+`}`)
			if rec.Code != tc.status {
				t.Fatalf("%d: %s", rec.Code, rec.Body.String())
			}
			if tc.status == 422 {
				var envelope httpjson.ErrorEnvelope
				if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
					t.Fatal(err)
				}
				if envelope.Code != httpjson.CodeInvalidLocation {
					t.Fatalf("error catalog: %+v", envelope)
				}
				var body struct {
					Details []httpjson.GeoDetail `json:"details"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if len(body.Details) != 1 || body.Details[0].Field != tc.field || body.Details[0].Reason != tc.reason {
					t.Fatalf("details: %+v", body.Details)
				}
			}
			if bootstrap.company != nil {
				t.Fatal("invalid location persisted")
			}
		})
	}
}

func TestCompanyLocationPatchConflictAndClear(t *testing.T) {
	id, actor := uuid.New(), uuid.New()
	current, err := entities.NewCompany("Acme SA de CV", "AAA010101AAA", "tech", entities.CompanyProfile{Location: &domain.Value{Country: "MX", State: "14", Municipality: "14039", PostalCode: "44100"}})
	if err != nil {
		t.Fatal(err)
	}
	current.ID = id
	current.UpdatedAt = time.Now().UTC().Truncate(time.Microsecond)
	repo := &stubRepo{getForUpdateOut: current}
	handler := NewCompanyHandler(usecases.NewCompanyService(repo, companyCatalog{}))
	router := chi.NewRouter()
	router.Patch("/me/company", handler.updateCompany)
	request := func(body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPatch, "/me/company", strings.NewReader(body))
		req.Header.Set("If-Unmodified-Since", token)
		req = req.WithContext(security.ContextWithCompanyContext(req.Context(), security.CompanyContext{CompanyID: id, UserID: actor}))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	conflict := request(`{"location":null}`, "")
	if conflict.Code != 409 || !strings.Contains(conflict.Body.String(), `"label":"Guadalajara, Jalisco"`) || repo.updateCalls != 0 {
		t.Fatalf("conflict: %d %s", conflict.Code, conflict.Body.String())
	}
	var conflictBody struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(conflict.Body.Bytes(), &conflictBody); err != nil {
		t.Fatal(err)
	}
	assertCompanyLocationKeys(t, companyObject(t, conflictBody.Data)["location"])
	staleInvalid := request(`{"location":{"country":"ZZ"}}`, current.UpdatedAt.Add(-time.Second).Format(time.RFC3339Nano))
	memberAssertCatalogEnvelope(t, staleInvalid, 409, httpjson.CodeConflict)
	if repo.updateCalls != 0 || !strings.Contains(staleInvalid.Body.String(), `"label":"Guadalajara, Jalisco"`) {
		t.Fatal("stale CAS must precede location consistency validation")
	}
	staleMalformed := request(`{"location":{"country":"MX","label":"injected"}}`, current.UpdatedAt.Add(-time.Second).Format(time.RFC3339Nano))
	memberAssertCatalogEnvelope(t, staleMalformed, 400, httpjson.CodeInvalidRequest)
	cleared := request(`{"location":null}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if cleared.Code != 200 || repo.updateCalls != 1 || !strings.Contains(cleared.Body.String(), `"location":null`) || !repo.updatePatch.Location.Set || repo.updatePatch.Location.Valid {
		t.Fatalf("clear: %d %s", cleared.Code, cleared.Body.String())
	}
	replaced := request(`{"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"}}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if replaced.Code != 200 || !repo.updatePatch.Location.Set || !repo.updatePatch.Location.Valid || !strings.Contains(replaced.Body.String(), `"postal_code":"44100"`) {
		t.Fatalf("replace: %d %s", replaced.Code, replaced.Body.String())
	}
	assertCompanyLocationKeys(t, companyObject(t, replaced.Body.Bytes())["location"])
	kept := request(`{}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if kept.Code != 200 || repo.updatePatch.Location.Set || !strings.Contains(kept.Body.String(), `"label":"Guadalajara, Jalisco"`) {
		t.Fatalf("absent: %d %s", kept.Code, kept.Body.String())
	}
	countryOnly := request(`{"location":{"country":"US"}}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if countryOnly.Code != 200 || repo.updatePatch.Location.Value.State != "" || repo.updatePatch.Location.Value.Municipality != "" || repo.updatePatch.Location.Value.PostalCode != "" || !strings.Contains(countryOnly.Body.String(), `"state":null`) {
		t.Fatalf("whole replacement: %d %s", countryOnly.Code, countryOnly.Body.String())
	}
	invalid := request(`{"location":{"country":"ZZ"}}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if invalid.Code != 422 || repo.updateCalls != 4 || !strings.Contains(invalid.Body.String(), `"field":"location.country"`) {
		t.Fatalf("invalid: %d %s", invalid.Code, invalid.Body.String())
	}
	badKey := request(`{"location":{"country":"MX","label":"injected"}}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if badKey.Code != 400 || repo.updateCalls != 4 {
		t.Fatalf("unknown nested key: %d %s", badKey.Code, badKey.Body.String())
	}
}

func TestCompanyLocationOptionalCreateAndPublicNull(t *testing.T) {
	for _, location := range []string{"", `,"location":null`, `,"location":{"country":"US"}`, `,"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"}`} {
		t.Run(location, func(t *testing.T) {
			bootstrap := &stubBootstrapRepo{}
			repo := &stubRepo{}
			router := newTestRouter(newTestHandlerWithBootstrap(repo, bootstrap))
			created := doPost(t, router, `{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech"`+location+`}`)
			if created.Code != 201 {
				t.Fatalf("create: %d %s", created.Code, created.Body.String())
			}
			repo.getOut = bootstrap.company
			got := doGet(t, router, "/companies/"+bootstrap.company.ID.String())
			if got.Code != 200 {
				t.Fatalf("get: %d %s", got.Code, got.Body.String())
			}
			expected := `"location":null`
			if bootstrap.company.Location != nil {
				expected = `"label":"Estados Unidos"`
				if bootstrap.company.Location.Municipality != "" {
					expected = `"label":"Guadalajara, Jalisco"`
				}
				assertCompanyLocationKeys(t, companyObject(t, created.Body.Bytes())["location"])
				assertCompanyLocationKeys(t, companyObject(t, got.Body.Bytes())["location"])
			}
			if _, present := companyObject(t, got.Body.Bytes())["updated_at"]; present {
				t.Fatal("public GET must not expose updated_at")
			}
			for _, body := range []string{created.Body.String(), got.Body.String()} {
				if !strings.Contains(body, expected) || strings.Contains(body, `"city"`) {
					t.Fatalf("shape: %s", body)
				}
			}
		})
	}
}
