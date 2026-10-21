package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"github.com/google/uuid"
)

func studyJSON(level, status string, start, end any) json.RawMessage {
	raw, _ := json.Marshal([]map[string]any{{"level": level, "institution": " UNAM ", "field": " Ingeniería ", "status": status, "start_year": start, "end_year": end}})
	return raw
}

func TestProfileFieldsVocabulariesAndBoundaries(t *testing.T) {
	for _, level := range languages.EducationLevels() {
		for _, status := range languages.EducationStatuses() {
			t.Run(level+"/"+status, func(t *testing.T) {
				years, seniority, records, err := ValidateProfileFields([]byte(`"2.0"`), []byte(`"junior"`), studyJSON(level, status, 1950, nil))
				if err != nil || years == nil || *years != "2" || seniority == nil || *seniority != "junior" || len(records) != 1 {
					t.Fatalf("%v %v %+v %v", years, seniority, records, err)
				}
				if *records[0].Institution != "UNAM" || *records[0].Field != "Ingeniería" || records[0].EndYear != nil {
					t.Fatalf("normalization: %+v", records[0])
				}
			})
		}
	}
	for _, value := range languages.Seniorities() {
		raw, _ := json.Marshal(value)
		_, s, _, err := ValidateProfileFields(nil, raw, nil)
		if err != nil || s == nil || *s != value {
			t.Fatalf("seniority %s: %v", value, err)
		}
	}
	for _, value := range []string{"0", "0.0", "0.1", "59.9", "60", "60.0"} {
		raw, _ := json.Marshal(value)
		if _, _, _, err := ValidateProfileFields(raw, nil, nil); err != nil {
			t.Fatalf("years %s: %v", value, err)
		}
	}
	raw := studyJSON("phd", "completed", 2100, 2100)
	if _, _, _, err := ValidateProfileFields(nil, nil, raw); err != nil {
		t.Fatalf("inclusive upper year: %v", err)
	}
	var entries []map[string]any
	_ = json.Unmarshal(raw, &entries)
	entries[0]["institution"] = strings.Repeat("é", 120)
	entries[0]["field"] = strings.Repeat("界", 120)
	records := make([]map[string]any, 10)
	for i := range records {
		records[i] = entries[0]
	}
	raw, _ = json.Marshal(records)
	if _, _, got, err := ValidateProfileFields(nil, nil, raw); err != nil || len(got) != 10 {
		t.Fatalf("ten duplicate studies and code point boundary: %v", err)
	}
}

func TestProfileFieldsRejectBeforePersistence(t *testing.T) {
	cases := []struct {
		name        string
		dto         dtos.UpsertMyProfileDto
		field, code string
	}{
		{"numeric years", dtos.UpsertMyProfileDto{YearsOfExperience: []byte(`1.5`)}, "years_of_experience", "invalid"},
		{"years format", dtos.UpsertMyProfileDto{YearsOfExperience: []byte(`"01"`)}, "years_of_experience", "invalid"},
		{"years range", dtos.UpsertMyProfileDto{YearsOfExperience: []byte(`"60.1"`)}, "years_of_experience", "invalid"},
		{"seniority", dtos.UpsertMyProfileDto{Seniority: []byte(`"mid"`)}, "seniority", "invalid"},
		{"null array", dtos.UpsertMyProfileDto{Education: []byte(`null`)}, "education", "invalid"},
		{"level", dtos.UpsertMyProfileDto{Education: studyJSON("college", "completed", nil, nil)}, "education[0].level", "invalid"},
		{"status", dtos.UpsertMyProfileDto{Education: studyJSON("master", "finished", nil, nil)}, "education[0].status", "invalid"},
		{"low year", dtos.UpsertMyProfileDto{Education: studyJSON("master", "completed", 1949, nil)}, "education[0].start_year", "invalid"},
		{"high year", dtos.UpsertMyProfileDto{Education: studyJSON("master", "completed", nil, 2101)}, "education[0].end_year", "invalid"},
		{"reversed", dtos.UpsertMyProfileDto{Education: studyJSON("master", "completed", 2021, 2020)}, "education[0].end_year", "invalid"},
		{"ongoing", dtos.UpsertMyProfileDto{Education: studyJSON("master", "in_progress", 2020, 2021)}, "education[0].end_year", "not_allowed"},
	}
	for _, key := range []string{"level", "institution", "field", "status", "start_year", "end_year"} {
		var records []map[string]any
		_ = json.Unmarshal(studyJSON("master", "completed", nil, nil), &records)
		delete(records[0], key)
		raw, _ := json.Marshal(records)
		cases = append(cases, struct {
			name        string
			dto         dtos.UpsertMyProfileDto
			field, code string
		}{"missing " + key, dtos.UpsertMyProfileDto{Education: raw}, "education[0]." + key, "required"})
	}
	for _, key := range []string{"institution", "field"} {
		for _, value := range []string{"   ", strings.Repeat("界", 121)} {
			var records []map[string]any
			_ = json.Unmarshal(studyJSON("master", "completed", nil, nil), &records)
			records[0][key] = value
			raw, _ := json.Marshal(records)
			code := "invalid"
			if len(value) > 120 {
				code = "too_long"
			}
			cases = append(cases, struct {
				name        string
				dto         dtos.UpsertMyProfileDto
				field, code string
			}{key + code, dtos.UpsertMyProfileDto{Education: raw}, "education[0]." + key, code})
		}
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := &stubCandidateRepository{}
			svc := newSvc(repo, &stubUserRepository{resolved: makeUser(uuid.New(), "sub")})
			_, err := svc.UpsertMyProfile(context.Background(), "sub", tc.dto)
			var invalid *ValidationError
			if !errors.As(err, &invalid) {
				t.Fatalf("expected field validation: %v", err)
			}
			found := false
			for _, field := range invalid.Fields {
				if field == (FieldError{tc.field, tc.code}) {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing %s/%s: %+v", tc.field, tc.code, invalid.Fields)
			}
			if repo.upsertCalls != 0 {
				t.Fatal("invalid request reached persistence")
			}
		})
	}
}

func TestLanguagesCatalogLevelsAndBoundaries(t *testing.T) {
	for _, level := range languages.LanguageLevels() {
		raw, _ := json.Marshal([]languages.Proficiency{{Code: "nah", Level: level}})
		got, err := validateLanguages(raw)
		if err != nil || len(got) != 1 || got[0].Name != "nah" || got[0].Level.String() != level {
			t.Fatalf("%s: %+v %v", level, got, err)
		}
	}
	entries := []languages.Proficiency{}
	for _, code := range []string{"en", "es", "fr", "de", "it", "pt", "ja", "ko", "ar", "nah"} {
		entries = append(entries, languages.Proficiency{Code: code, Level: "native"})
	}
	raw, _ := json.Marshal(entries)
	if got, err := validateLanguages(raw); err != nil || len(got) != 10 {
		t.Fatalf("ten languages: %v", err)
	}
	entries = append(entries, languages.Proficiency{Code: "en", Level: "A1"})
	raw, _ = json.Marshal(entries)
	if _, err := validateLanguages(raw); err == nil {
		t.Fatal("eleven accepted")
	}
}
