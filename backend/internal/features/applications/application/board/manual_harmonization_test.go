package board

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

func harmonizedStudy() map[string]any {
	return map[string]any{"level": "bachelor", "institution": nil, "field": nil, "status": "completed", "start_year": nil, "end_year": nil}
}

func TestManualHarmonizationContract(t *testing.T) {
	candidate := validManualCandidate()
	candidate["education"] = []any{harmonizedStudy()}
	candidate["years_of_experience"] = "1.5"
	candidate["seniority"] = "junior"
	candidate["languages"] = []any{map[string]any{"code": "es", "level": "native"}}
	out, fields, err := manualValidationRequest(t, candidate).Validate(context.Background(), manualGeo{}, true)
	if err != nil || len(fields) != 0 {
		t.Fatalf("harmonized candidate rejected: fields=%v error=%v", fields, err)
	}
	if *out.Candidate.YearsOfExperience != "1.5" || *out.Candidate.Seniority != "junior" || out.Candidate.Languages[0].Code != "es" || out.Candidate.Languages[0].Level != "native" {
		t.Fatalf("candidate=%+v", out.Candidate)
	}
}

// Expected error paths/codes mirror candidate profile ValidateProfileFields,
// except intake additionally requires at least one study (INT-8). No feature
// import is needed to pin the shared wire contract.
func TestManualEducationProfileParity(t *testing.T) {
	for _, tc := range []struct {
		name, key string
		value     any
		code      string
	}{
		{"null level", "level", nil, "required"}, {"empty level", "level", "", "required"},
		{"level case", "level", "BACHELOR", "invalid"}, {"level whitespace", "level", " bachelor ", "invalid"},
		{"unknown level", "level", "associate", "invalid"}, {"level type", "level", 3, "invalid"},
		{"null status", "status", nil, "required"}, {"status case", "status", "Completed", "invalid"},
		{"empty institution", "institution", "  ", "invalid"}, {"institution type", "institution", 3, "invalid"},
		{"institution too long", "institution", strings.Repeat("é", 121), "too_long"},
		{"field too long", "field", strings.Repeat("é", 121), "too_long"}, {"empty field", "field", "", "invalid"},
		{"early year", "start_year", 1949, "invalid"}, {"late year", "end_year", 2101, "invalid"},
		{"fractional year", "start_year", 2000.5, "invalid"}, {"string year", "start_year", "2000", "invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := validManualCandidate()
			e := harmonizedStudy()
			e[tc.key] = tc.value
			c["education"] = []any{e}
			_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
			want := ManualFieldError{"candidate.education[0]." + tc.key, tc.code}
			if err != nil || len(fields) != 1 || fields[0] != want {
				t.Fatalf("want %+v, got %+v / %v", want, fields, err)
			}
		})
	}
	for _, key := range []string{"level", "institution", "field", "status", "start_year", "end_year"} {
		t.Run("missing "+key, func(t *testing.T) {
			c := validManualCandidate()
			e := harmonizedStudy()
			delete(e, key)
			c["education"] = []any{e}
			_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
			want := ManualFieldError{"candidate.education[0]." + key, "required"}
			if err != nil || len(fields) != 1 || fields[0] != want {
				t.Fatal(fields, err)
			}
		})
	}
	for _, status := range languages.EducationStatuses() {
		for _, level := range languages.EducationLevels() {
			t.Run(status+"/"+level, func(t *testing.T) {
				c := validManualCandidate()
				e := harmonizedStudy()
				e["level"] = level
				e["status"] = status
				e["institution"] = " UNAM "
				e["field"] = strings.Repeat("é", 120)
				e["start_year"] = 1950
				c["education"] = []any{e, e}
				out, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
				if err != nil || len(fields) != 0 {
					t.Fatal(fields, err)
				}
				if len(out.Candidate.Education) != 2 || *out.Candidate.Education[0].Institution != "UNAM" {
					t.Fatal(out.Candidate.Education)
				}
			})
		}
	}
	for _, tc := range []struct {
		name         string
		start, end   int
		status, code string
	}{
		{"reversed", 2021, 2020, "completed", "invalid"}, {"ongoing", 2000, 2020, "in_progress", "not_allowed"},
		{"equal", 2000, 2000, "completed", ""}, {"limits", 1950, 2100, "completed", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := validManualCandidate()
			e := harmonizedStudy()
			e["start_year"] = tc.start
			e["end_year"] = tc.end
			e["status"] = tc.status
			c["education"] = []any{e}
			_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
			if err != nil {
				t.Fatal(err)
			}
			if tc.code == "" {
				if len(fields) != 0 {
					t.Fatal(fields)
				}
			} else if len(fields) != 1 || fields[0] != (ManualFieldError{"candidate.education[0].end_year", tc.code}) {
				t.Fatal(fields)
			}
		})
	}
}

func TestManualEducationShapeAndCount(t *testing.T) {
	for _, tc := range []struct {
		name       string
		education  any
		path, code string
		shape      bool
	}{
		{"empty", []any{}, "candidate.education", "required", false},
		{"null", nil, "candidate.education", "required", false},
		{"non array", true, "candidate.education", "invalid", false},
		{"null record", []any{nil}, "candidate.education[0]", "invalid", false},
		{"scalar record", []any{3}, "candidate.education[0]", "invalid", false},
		{"unknown key", []any{map[string]any{"unexpected": nil}}, "", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := validManualCandidate()
			c["education"] = tc.education
			_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
			if tc.shape {
				if !errors.Is(err, ErrInvalidRequest) {
					t.Fatal(err)
				}
				return
			}
			if err != nil || len(fields) != 1 || fields[0] != (ManualFieldError{tc.path, tc.code}) {
				t.Fatal(fields, err)
			}
		})
	}
	for _, n := range []int{10, 11} {
		c := validManualCandidate()
		studies := []any{}
		for range n {
			studies = append(studies, harmonizedStudy())
		}
		c["education"] = studies
		_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
		if err != nil {
			t.Fatal(err)
		}
		if n == 10 && len(fields) != 0 || n == 11 && (len(fields) != 1 || fields[0] != (ManualFieldError{"candidate.education", "too_long"})) {
			t.Fatal(fields)
		}
	}
}

func TestManualYearsSeniorityAndLanguagesParity(t *testing.T) {
	for _, tc := range []struct {
		key        string
		value      any
		path, code string
	}{
		{"years_of_experience", "01", "candidate.years_of_experience", "invalid"},
		{"years_of_experience", "1.50", "candidate.years_of_experience", "invalid"},
		{"years_of_experience", " 1", "candidate.years_of_experience", "invalid"},
		{"seniority", "mid", "candidate.seniority", "invalid"},
		{"seniority", " Junior ", "candidate.seniority", "invalid"},
		{"languages", []any{map[string]any{"code": "zzz", "level": "B1"}}, "candidate.languages[0].code", "invalid"},
		{"languages", []any{map[string]any{"code": "ES", "level": "B1"}}, "candidate.languages[0].code", "invalid"},
		{"languages", []any{map[string]any{"code": " es ", "level": "B1"}}, "candidate.languages[0].code", "invalid"},
		{"languages", []any{map[string]any{"code": "es", "level": "Native"}}, "candidate.languages[0].level", "invalid"},
	} {
		c := validManualCandidate()
		c[tc.key] = tc.value
		_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
		if err != nil || len(fields) != 1 || fields[0] != (ManualFieldError{tc.path, tc.code}) {
			t.Fatal(tc, fields, err)
		}
	}
	for _, seniority := range languages.Seniorities() {
		c := validManualCandidate()
		c["seniority"] = seniority
		c["years_of_experience"] = "2.0"
		out, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
		if err != nil || len(fields) != 0 {
			t.Fatal(fields, err)
		}
		if *out.Candidate.YearsOfExperience != "2" || *out.Candidate.Seniority != seniority {
			t.Fatal(out.Candidate)
		}
	}
	for _, level := range languages.LanguageLevels() {
		c := validManualCandidate()
		c["languages"] = []any{map[string]any{"code": "qaa", "level": level}}
		_, fields, err := manualValidationRequest(t, c).Validate(context.Background(), manualGeo{}, true)
		if err != nil || len(fields) != 0 {
			t.Fatal(fields, err)
		}
	}
}
