package board

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

type manualGeo struct{ failure error }

func (g manualGeo) CountryExists(_ context.Context, country string) (bool, error) {
	return country == "MX" || country == "US", g.failure
}
func (g manualGeo) StateExists(_ context.Context, _, state string) (bool, error) {
	return state == "14", g.failure
}
func (g manualGeo) MunicipalityState(_ context.Context, _, municipality string) (string, error) {
	if municipality == "14039" {
		return "14", g.failure
	}
	return "", g.failure
}
func (g manualGeo) PostalMatches(context.Context, string, string) ([]geo.PostalMatch, error) {
	return nil, g.failure
}

func validManualCandidate() map[string]any {
	return map[string]any{
		"full_name": "Ana Pérez", "education": []any{map[string]any{"level": "bachelor", "institution": nil, "field": nil, "status": "completed", "start_year": nil, "end_year": nil}}, "email": " ANA@example.com ", "phone": nil,
		"residence": map[string]any{"country": "MX", "state": "14", "municipality": "14039", "postal_code": nil},
	}
}
func manualValidationRequest(t *testing.T, candidate any) ManualRequest {
	t.Helper()
	body, err := json.Marshal(map[string]any{"stage_id": "10000000-0000-0000-0000-000000000001", "existing": nil, "confirmed_distinct": false, "candidate": candidate})
	if err != nil {
		t.Fatal(err)
	}
	r, err := ParseManualRequest(body)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestManualCandidateValidation(t *testing.T) {
	for _, tc := range []struct {
		name, key   string
		value       any
		field, code string
	}{
		{"name required", "full_name", nil, "candidate.full_name", "required"},
		{"single rune name", "full_name", "é", "candidate.full_name", "invalid"},
		{"long name", "full_name", strings.Repeat("é", 121), "candidate.full_name", "too_long"},
		{"name wrong type", "full_name", 42, "candidate.full_name", "invalid"},
		{"education required", "education", nil, "candidate.education", "required"},
		{"education invalid", "education", "none", "candidate.education", "invalid"},
		{"email invalid", "email", "bad", "candidate.email", "invalid"},
		{"MX nine digits", "phone", "+52123456789", "candidate.phone", "invalid"},
		{"MX eleven digits", "phone", "+5212345678901", "candidate.phone", "invalid"},
		{"MX ten digits", "phone", "+521234567890", "", ""},
		{"short text max", "professional_title", strings.Repeat("x", 120), "", ""},
		{"short text over", "professional_title", strings.Repeat("x", 121), "candidate.professional_title", "too_long"},
		{"company over", "current_company", strings.Repeat("x", 121), "candidate.current_company", "too_long"},
		{"summary max", "summary", strings.Repeat("x", 2000), "", ""},
		{"summary over", "summary", strings.Repeat("x", 2001), "candidate.summary", "too_long"},
		{"experience negative", "years_of_experience", "-1", "candidate.years_of_experience", "invalid"},
		{"experience over", "years_of_experience", "60.1", "candidate.years_of_experience", "invalid"},
		{"experience number", "years_of_experience", 1.5, "candidate.years_of_experience", "invalid"},
		{"experience max", "years_of_experience", "60", "", ""},
		{"skills count", "skills", make([]string, 31), "candidate.skills", "too_long"},
		{"skill size", "skills", []string{strings.Repeat("x", 61)}, "candidate.skills[0]", "too_long"},
		{"skill size boundary", "skills", []string{strings.Repeat("X", 60)}, "", ""},
		{"skill count boundary", "skills", strings.Fields("A B C D E F G H I J K L M N O P Q R S T U V W X Y Z AA AB AC AD"), "", ""},
		{"skill null item", "skills", []any{nil}, "candidate.skills[0]", "required"},
		{"skill wrong item type", "skills", []any{42}, "candidate.skills[0]", "invalid"},
		{"skill empty dropped", "skills", []string{" "}, "", ""},
		{"skill duplicate dropped", "skills", []string{" Go ", "go"}, "", ""},
		{"language count", "languages", make([]any, 11), "candidate.languages", "too_long"},
		{"language level", "languages", []any{map[string]any{"code": "en", "level": "b1"}}, "candidate.languages[0].level", "invalid"},
		{"language required", "languages", []any{map[string]any{"code": "", "level": "B1"}}, "candidate.languages[0].code", "required"},
		{"language duplicate", "languages", []any{map[string]any{"code": "en", "level": "B1"}, map[string]any{"code": "en", "level": "C1"}}, "candidate.languages[1].code", "duplicate"},
		{"http URL", "linkedin_url", "http://example.com", "candidate.linkedin_url", "invalid"},
		{"relative URL", "portfolio_url", "/hello", "candidate.portfolio_url", "invalid"},
		{"URL over", "portfolio_url", "https://example.com/" + strings.Repeat("x", 2048), "candidate.portfolio_url", "too_long"},
		{"residence required", "residence", nil, "candidate.residence", "required"},
		{"non MX state", "residence", map[string]any{"country": "US", "state": "CA"}, "candidate.residence.state", "not_allowed"},
		{"MX missing municipality", "residence", map[string]any{"country": "MX", "state": "14"}, "candidate.residence.municipality", "required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			candidate := validManualCandidate()
			candidate[tc.key] = tc.value
			_, fields, err := manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, true)
			if err != nil {
				t.Fatal(err)
			}
			if tc.field == "" {
				if len(fields) != 0 {
					t.Fatalf("fields=%+v", fields)
				}
				return
			}
			for _, field := range fields {
				if field.Field == tc.field && field.Code == tc.code {
					return
				}
			}
			t.Fatalf("missing %s/%s in %+v", tc.field, tc.code, fields)
		})
	}
}
func TestManualValidationCollectsFieldsAndNormalizes(t *testing.T) {
	candidate := validManualCandidate()
	out, fields, err := manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, true)
	if err != nil || len(fields) != 0 {
		t.Fatalf("%+v %v", fields, err)
	}
	if out.Candidate.EmailNormalized == nil || *out.Candidate.EmailNormalized != "ana@example.com" {
		t.Fatalf("candidate=%+v", out.Candidate)
	}
	candidate["full_name"] = nil
	candidate["email"] = nil
	candidate["education"] = "bad"
	_, fields, err = manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []ManualFieldError{{"candidate.full_name", "required"}, {"candidate.contact", "required"}, {"candidate.education", "invalid"}, {"cv", "required"}} {
		found := false
		for _, got := range fields {
			if got == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing %+v in %+v", want, fields)
		}
	}
}
func TestManualCandidateUnknownAndDuplicateKeys(t *testing.T) {
	for _, candidate := range []string{`{"salary":1}`, `{"birth_date":"2000-01-01"}`, `{"full_name":"Ana","full_name":"Eva"}`, `{"residence":{"country":"MX","country":"US"}}`, `{"residence":{"extra":1}}`, `{"languages":[{"code":"en","level":"B1","extra":1}]}`, `{"education_level":"bachelor"}`, `{"field_of_study":null}`, `{"experience_years":1}`} {
		t.Run(candidate, func(t *testing.T) {
			r := manualValidationRequest(t, nil)
			r.Candidate = json.RawMessage(candidate)
			if _, _, err := r.Validate(context.Background(), manualGeo{}, true); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}
func TestManualValidationCatalogFailure(t *testing.T) {
	failure := errors.New("catalog unavailable")
	_, _, err := manualValidationRequest(t, validManualCandidate()).Validate(context.Background(), manualGeo{failure}, true)
	if !errors.Is(err, failure) {
		t.Fatalf("error=%v", err)
	}
}
