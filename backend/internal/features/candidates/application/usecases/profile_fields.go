package usecases

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

// FieldError contains only a public path and a bounded validation code.
type FieldError struct{ Field, Code string }
type ValidationError struct{ Fields []FieldError }

func (e *ValidationError) Error() string { return "invalid candidate profile fields" }

var ErrUnknownField = errors.New("unknown candidate profile field")

func (e *ValidationError) add(path, code string) { e.Fields = append(e.Fields, FieldError{path, code}) }
func nullable(raw json.RawMessage) bool {
	return len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}
func stringField(raw json.RawMessage, path string, required bool, valid func(string) bool, errs *ValidationError) *string {
	if nullable(raw) {
		if required {
			errs.add(path, "required")
		}
		return nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		errs.add(path, "invalid")
		return nil
	}
	if required && s == "" {
		errs.add(path, "required")
		return nil
	}
	if !valid(s) {
		errs.add(path, "invalid")
		return nil
	}
	return &s
}
func textField(raw json.RawMessage, path string, errs *ValidationError) *string {
	s := stringField(raw, path, false, func(string) bool { return true }, errs)
	if s == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*s)
	if trimmed == "" {
		errs.add(path, "invalid")
	} else if utf8.RuneCountInString(trimmed) > 120 {
		errs.add(path, "too_long")
	}
	return &trimmed
}
func yearField(raw json.RawMessage, path string, errs *ValidationError) *int {
	if nullable(raw) {
		return nil
	}
	var year int
	if err := json.Unmarshal(raw, &year); err != nil || year < 1950 || year > 2100 {
		errs.add(path, "invalid")
		return nil
	}
	return &year
}

// ValidateProfileFields validates raw wire primitives without coercion. Raw JSON
// preserves missing keys separately from explicit null in education records.
func ValidateProfileFields(yearsRaw, seniorityRaw, educationRaw json.RawMessage) (*string, *string, []entities.Education, error) {
	errs := &ValidationError{}
	years := stringField(yearsRaw, "years_of_experience", false, languages.ValidYears, errs)
	if years != nil {
		normalized, _ := languages.NormalizeYears(*years)
		years = &normalized
	}
	seniority := stringField(seniorityRaw, "seniority", false, languages.ValidSeniority, errs)
	out := make([]entities.Education, 0)
	if len(educationRaw) != 0 {
		var records []json.RawMessage
		if nullable(educationRaw) || json.Unmarshal(educationRaw, &records) != nil {
			errs.add("education", "invalid")
		} else if len(records) > 10 {
			errs.add("education", "too_long")
		} else {
			for i, raw := range records {
				prefix := fmt.Sprintf("education[%d]", i)
				var fields map[string]json.RawMessage
				if json.Unmarshal(raw, &fields) != nil || fields == nil {
					errs.add(prefix, "invalid")
					continue
				}
				keys := []string{"level", "institution", "field", "status", "start_year", "end_year"}
				allowed := map[string]bool{}
				for _, key := range keys {
					allowed[key] = true
				}
				for key := range fields {
					if !allowed[key] {
						return nil, nil, nil, ErrUnknownField
					}
				}
				missing := false
				for _, key := range keys {
					if _, ok := fields[key]; !ok {
						errs.add(prefix+"."+key, "required")
						missing = true
					}
				}
				if missing {
					continue
				}
				level := stringField(fields["level"], prefix+".level", true, languages.ValidEducationLevel, errs)
				status := stringField(fields["status"], prefix+".status", true, languages.ValidEducationStatus, errs)
				record := entities.Education{
					Institution: textField(fields["institution"], prefix+".institution", errs),
					Field:       textField(fields["field"], prefix+".field", errs),
					StartYear:   yearField(fields["start_year"], prefix+".start_year", errs),
					EndYear:     yearField(fields["end_year"], prefix+".end_year", errs),
				}
				if level != nil {
					record.Level = *level
				}
				if status != nil {
					record.Status = *status
				}
				if record.Status == "in_progress" && !nullable(fields["end_year"]) {
					errs.add(prefix+".end_year", "not_allowed")
				} else if record.StartYear != nil && record.EndYear != nil && *record.StartYear > *record.EndYear {
					errs.add(prefix+".end_year", "invalid")
				}
				out = append(out, record)
			}
		}
	}
	if len(errs.Fields) > 0 {
		return nil, nil, nil, errs
	}
	return years, seniority, out, nil
}
