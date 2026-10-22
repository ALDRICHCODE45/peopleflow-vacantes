package http

import (
	"encoding/json"
	"net/http"
	"reflect"
	"sort"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

func exactKeys(t *testing.T, object map[string]any, want ...string) {
	t.Helper()
	got := make([]string, 0, len(object))
	for key := range object {
		got = append(got, key)
	}
	sort.Strings(got)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("keys: got %v, want %v", got, want)
	}
}

func TestHarmonizedProfileExactShape(t *testing.T) {
	repo := &stubCandidateRepo{}
	router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
	body := `{"phone":"+525512345678","linkedin_url":"https://example.test/in/test","portfolio_url":"https://example.test","professional_title":"Engineer","current_company":"Company","years_of_experience":"2.0","profile_summary":"Summary","birth_date":"2000-01-01","seniority":"semi_senior","education":[{"level":"technical","institution":" School ","field":" Computing ","status":"completed","start_year":null,"end_year":null}],"skills":["Go"],"current_salary_gross":100,"current_salary_net":90,"expected_salary":110,"salary_currency":"MXN","expected_salary_period":"monthly"}`
	rec := doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", body, "sub"))
	if rec.Code != 200 {
		t.Fatalf("%d: %s", rec.Code, rec.Body.String())
	}
	var object map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &object); err != nil {
		t.Fatal(err)
	}
	exactKeys(t, object, "user_id", "phone", "linkedin_url", "portfolio_url", "professional_title", "current_company", "years_of_experience", "profile_summary", "birth_date", "location", "seniority", "education", "skills", "current_salary_gross", "current_salary_net", "expected_salary", "salary_currency", "expected_salary_period", "created_at", "updated_at")
	study := object["education"].([]any)[0].(map[string]any)
	exactKeys(t, study, "level", "institution", "field", "status", "start_year", "end_year")
	if object["years_of_experience"] != "2" || study["institution"] != "School" || study["field"] != "Computing" || study["end_year"] != nil {
		t.Fatalf("canonical output: %+v", object)
	}
	repo.getByIDOut = repo.upserted
	get := doRequest(t, router, authedRequest(t, http.MethodGet, "/me/profile/", "", "sub"))
	if get.Code != 200 || get.Body.String() != rec.Body.String() {
		t.Fatalf("GET mismatch: %s", get.Body.String())
	}
	rec = doRequest(t, router, authedRequest(t, http.MethodPut, "/me/profile/", `{}`, "sub"))
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	object = map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &object)
	exactKeys(t, object, "user_id", "years_of_experience", "seniority", "education", "location", "salary_currency", "created_at", "updated_at")
	if object["years_of_experience"] != nil || object["seniority"] != nil || len(object["education"].([]any)) != 0 {
		t.Fatalf("replacement: %+v", object)
	}
}

func TestHarmonizedLanguagesExactShape(t *testing.T) {
	repo := &stubCandidateRepo{listOut: []entities.Language{{Name: "es", Level: valueobjects.Native}}}
	router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
	for _, method := range []string{http.MethodPut, http.MethodGet} {
		rec := doRequest(t, router, authedRequest(t, method, "/me/profile/languages/", `{"languages":[{"code":"es","level":"native"}]}`, "sub"))
		if rec.Code != 200 {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		var object map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &object)
		exactKeys(t, object, "languages")
		entry := object["languages"].([]any)[0].(map[string]any)
		exactKeys(t, entry, "code", "level")
		if entry["code"] != "es" || entry["level"] != "native" {
			t.Fatalf("entry: %+v", entry)
		}
	}
}

func TestHarmonizedUnknownFields(t *testing.T) {
	for _, tc := range []struct{ path, body string }{
		{"/me/profile/", `{"education_level":"bachelor"}`},
		{"/me/profile/", `{"field_of_study":"Computing"}`},
		{"/me/profile/", `{"extra":null}`},
		{"/me/profile/", `{"education":[{"level":"master","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null,"extra":null}]}`},
		{"/me/profile/languages/", `{"languages":[{"name":"English","level":"B2"}]}`},
		{"/me/profile/languages/", `{"languages":[{"code":"en","level":"B2","extra":null}]}`},
		{"/me/profile/languages/", `{"languages":[],"extra":null}`},
	} {
		t.Run(tc.body, func(t *testing.T) {
			repo := &stubCandidateRepo{}
			router := newTestRouter(newTestHandler(repo, &stubUserRepo{resolved: &identityentities.User{ID: uuid.New()}}))
			rec := doRequest(t, router, authedRequest(t, http.MethodPut, tc.path, tc.body, "sub"))
			assertCatalogEnvelope(t, rec, 400, httpjson.CodeInvalidRequest)
			if repo.upsertCalls != 0 || repo.replaceCalls != 0 {
				t.Fatal("unknown field reached persistence")
			}
		})
	}
}
