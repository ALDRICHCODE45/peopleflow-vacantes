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
		"full_name": "Ana Pérez", "education_level": "bachelor", "email": " ANA@example.com ", "phone": nil,
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
		{"education required", "education_level", nil, "candidate.education_level", "required"},
		{"education invalid", "education_level", "none", "candidate.education_level", "invalid"},
		{"email invalid", "email", "bad", "candidate.email", "invalid"},
		{"MX nine digits", "phone", "+52123456789", "candidate.phone", "invalid"},
		{"MX eleven digits", "phone", "+5212345678901", "candidate.phone", "invalid"},
		{"MX ten digits", "phone", "+521234567890", "", ""},
		{"short text max", "professional_title", strings.Repeat("x", 120), "", ""},
		{"short text over", "professional_title", strings.Repeat("x", 121), "candidate.professional_title", "too_long"},
		{"company over", "current_company", strings.Repeat("x", 121), "candidate.current_company", "too_long"},
		{"study over", "field_of_study", strings.Repeat("x", 121), "candidate.field_of_study", "too_long"},
		{"summary max", "summary", strings.Repeat("x", 2000), "", ""},
		{"summary over", "summary", strings.Repeat("x", 2001), "candidate.summary", "too_long"},
		{"experience negative", "experience_years", -1, "candidate.experience_years", "invalid"},
		{"experience over", "experience_years", 61, "candidate.experience_years", "invalid"},
		{"experience fraction", "experience_years", 1.5, "candidate.experience_years", "invalid"},
		{"experience max", "experience_years", 60, "", ""},
		{"skills count", "skills", make([]string, 31), "candidate.skills", "too_long"},
		{"skill size", "skills", []string{strings.Repeat("x", 61)}, "candidate.skills[0]", "too_long"},
		{"skill empty", "skills", []string{" "}, "candidate.skills[0]", "required"},
		{"skill duplicate", "skills", []string{" Go ", "go"}, "candidate.skills[1]", "duplicate"},
		{"language count", "languages", make([]any, 11), "candidate.languages", "too_long"},
		{"language level", "languages", []any{map[string]any{"language": "English", "level": "b1"}}, "candidate.languages[0].level", "invalid"},
		{"language required", "languages", []any{map[string]any{"language": "", "level": "B1"}}, "candidate.languages[0].language", "required"},
		{"language duplicate", "languages", []any{map[string]any{"language": "English", "level": "B1"}, map[string]any{"language": " english ", "level": "C1"}}, "candidate.languages[1].language", "duplicate"},
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
	candidate["education_level"] = "bad"
	_, fields, err = manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []ManualFieldError{{"candidate.full_name", "required"}, {"candidate.contact", "required"}, {"candidate.education_level", "invalid"}, {"cv", "required"}} {
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
	for _, candidate := range []string{`{"salary":1}`, `{"birth_date":"2000-01-01"}`, `{"full_name":"Ana","full_name":"Eva"}`, `{"residence":{"country":"MX","country":"US"}}`, `{"residence":{"extra":1}}`, `{"languages":[{"language":"en","level":"B1","extra":1}]}`} {
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
