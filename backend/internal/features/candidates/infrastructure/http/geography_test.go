package http

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	candidates "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/usecases"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	identity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

type profileCatalog struct{ geo.Reader }

func (profileCatalog) CountryExists(_ context.Context, c string) (bool, error) {
	return c == "MX" || c == "US", nil
}
func (profileCatalog) StateExists(_ context.Context, c, s string) (bool, error) {
	return c == "MX" && (s == "14" || s == "15"), nil
}
func (profileCatalog) MunicipalityState(_ context.Context, _, m string) (string, error) {
	if m == "14039" {
		return "14", nil
	}
	return "", nil
}
func (profileCatalog) Countries(context.Context) ([]domain.Item, error) {
	return []domain.Item{{Code: "MX", Name: "México"}, {Code: "US", Name: "Estados Unidos"}}, nil
}
func (profileCatalog) States(context.Context, string) ([]domain.Item, error) {
	return []domain.Item{{Code: "14", Name: "Jalisco"}}, nil
}
func (profileCatalog) Municipalities(context.Context, string, string) ([]domain.Item, error) {
	return []domain.Item{{Code: "14039", Name: "Guadalajara"}}, nil
}

func TestProfileLocationRoundTripAndReplacement(t *testing.T) {
	for _, tc := range []struct{ name, location, label string }{
		{"country", `{"country":"US"}`, "Estados Unidos"},
		{"state", `{"country":"MX","state":"14"}`, "Jalisco"},
		{"municipality", `{"country":"MX","state":"14","municipality":"14039"}`, "Guadalajara, Jalisco"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			users := &stubUserRepo{resolved: &identity.User{ID: uuid.New()}}
			router := newTestRouter(NewCandidateHandler(candidates.NewCandidateService(repo, users, profileCatalog{})))
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", `{"location":`+tc.location+`}`, "sub"))
			if rec.Code != 200 {
				t.Fatalf("PUT: %d %s", rec.Code, rec.Body.String())
			}
			var response candidateProfileResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Location == nil || response.Location.Label != tc.label || response.Location.PostalCode != nil {
				t.Fatalf("read: %+v", response.Location)
			}
			if strings.Contains(rec.Body.String(), `"city"`) || strings.Contains(rec.Body.String(), `"country":"`) {
				t.Fatal("legacy shape")
			}
			repo.getByIDOut = repo.upserted
			got := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "sub"))
			if got.Code != 200 || got.Body.String() != rec.Body.String() {
				t.Fatalf("GET: %d %s", got.Code, got.Body.String())
			}
			for _, body := range []string{`{}`, `{"location":null}`} {
				cleared := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub"))
				if cleared.Code != 200 || repo.upserted.Location != nil || !strings.Contains(cleared.Body.String(), `"location":null`) {
					t.Fatalf("replace: %d %s", cleared.Code, cleared.Body.String())
				}
			}
		})
	}
}

func TestProfileLocationErrorsNoWrite(t *testing.T) {
	for _, tc := range []struct {
		name, location, field, reason string
		status                        int
	}{
		{"empty object", `{}`, "location.country", "required", 422},
		{"unknown country", `{"country":"ZZ"}`, "location.country", "unknown", 422},
		{"unknown state", `{"country":"MX","state":"99"}`, "location.state", "unknown", 422},
		{"missing parent", `{"country":"MX","municipality":"14039"}`, "location.state", "required", 422},
		{"mismatch", `{"country":"MX","state":"15","municipality":"14039"}`, "location.municipality", "mismatch", 422},
		{"postal", `{"country":"MX","postal_code":"44100"}`, "location.postal_code", "not_allowed", 422},
		{"empty postal", `{"country":"MX","postal_code":""}`, "location.postal_code", "not_allowed", 422},
		{"null postal", `{"country":"MX","postal_code":null}`, "location.postal_code", "not_allowed", 422},
		{"unknown key", `{"country":"MX","label":"injected"}`, "", "", 400},
		{"wrong type", `"MX"`, "", "", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			users := &stubUserRepo{resolved: &identity.User{ID: uuid.New()}}
			router := newTestRouter(NewCandidateHandler(candidates.NewCandidateService(repo, users, profileCatalog{})))
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", `{"location":`+tc.location+`}`, "sub"))
			if rec.Code != tc.status {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
			if repo.upsertCalls != 0 {
				t.Fatal("invalid location persisted")
			}
			if tc.status == 422 {
				assertCatalogEnvelope(t, rec, 422, httpjson.CodeInvalidLocation)
				var body struct {
					Details []geo.LocationDetail `json:"details"`
				}
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if len(body.Details) != 1 || body.Details[0].Field != tc.field || body.Details[0].Reason != tc.reason {
					t.Fatalf("details: %+v", body.Details)
				}
			}
		})
	}
}
