package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
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
	cleared := request(`{"location":null}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if cleared.Code != 200 || repo.updateCalls != 1 || !strings.Contains(cleared.Body.String(), `"location":null`) || !repo.updatePatch.Location.Set || repo.updatePatch.Location.Valid {
		t.Fatalf("clear: %d %s", cleared.Code, cleared.Body.String())
	}
	replaced := request(`{"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"}}`, current.UpdatedAt.Format(time.RFC3339Nano))
	if replaced.Code != 200 || !repo.updatePatch.Location.Set || !repo.updatePatch.Location.Valid || !strings.Contains(replaced.Body.String(), `"postal_code":"44100"`) {
		t.Fatalf("replace: %d %s", replaced.Code, replaced.Body.String())
	}
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
	for _, location := range []string{"", `,"location":null`, `,"location":{"country":"US"}`} {
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
			}
			for _, body := range []string{created.Body.String(), got.Body.String()} {
				if !strings.Contains(body, expected) || strings.Contains(body, `"city"`) {
					t.Fatalf("shape: %s", body)
				}
			}
		})
	}
}
