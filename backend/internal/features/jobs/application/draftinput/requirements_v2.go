package draftinput

import (
	"fmt"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	shared "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

var writableFieldKeysV2 = append(append([]string{}, writableFieldKeys...), "min_years_of_experience", "min_education_level", "accepts_in_progress_education")
var languageFieldKeysV2 = []string{languages.CodeField, "min_level"}

// Keep the historical schema-1 scalar vocabulary isolated from v2.
func validateScalarsV2(object map[string]any) (draftfields.Scalars, error) {
	values := scalarSubmap(object)
	delete(values, "seniority")
	scalars, err := draftfields.ValidateScalars(values)
	if err != nil {
		return scalars, err
	}
	if raw, present := object["seniority"]; present {
		scalars.Seniority = shared.Optional[string]{Set: true}
		if raw != nil {
			value, ok := raw.(string)
			if !ok || !languages.ValidSeniority(value) {
				return scalars, fmt.Errorf("invalid seniority")
			}
			scalars.Seniority.Valid, scalars.Seniority.Value = true, value
		}
	}
	return scalars, nil
}

func composeRequirementsV2(object map[string]any, out *Fields) error {
	for _, field := range []struct {
		key       string
		target    *shared.Optional[string]
		normalize func(string) (string, bool)
	}{
		{"min_years_of_experience", &out.MinYearsOfExperience, languages.NormalizeYears},
		{"min_education_level", &out.MinEducationLevel, func(s string) (string, bool) { return s, languages.ValidEducationLevel(s) }},
	} {
		raw, present := object[field.key]
		if !present {
			continue
		}
		*field.target = shared.Optional[string]{Set: true}
		if raw == nil {
			continue
		}
		value, ok := raw.(string)
		if !ok {
			return validationError(fmt.Errorf("invalid %s", field.key))
		}
		value, ok = field.normalize(value)
		if !ok {
			return validationError(fmt.Errorf("invalid %s", field.key))
		}
		*field.target = shared.Optional[string]{Set: true, Valid: true, Value: value}
	}
	if raw, present := object["accepts_in_progress_education"]; present {
		value, ok := raw.(bool)
		if !ok {
			return validationError(fmt.Errorf("invalid accepts_in_progress_education"))
		}
		out.AcceptsInProgressEducation = shared.Optional[bool]{Set: true, Valid: true, Value: value}
	}
	return nil
}

func applyRequirementsDefaultsV2(fields *Fields) {
	fields.MinYearsOfExperience = withNullDefault(fields.MinYearsOfExperience)
	fields.MinEducationLevel = withNullDefault(fields.MinEducationLevel)
	if !fields.AcceptsInProgressEducation.Set {
		fields.AcceptsInProgressEducation = shared.Optional[bool]{Set: true, Valid: true}
	}
}

func canonicalFieldsV2(fields Fields, description any) map[string]any {
	out := canonicalFields(fields, description)
	setNullableScalar(out, "min_years_of_experience", fields.MinYearsOfExperience)
	setNullableScalar(out, "min_education_level", fields.MinEducationLevel)
	if fields.AcceptsInProgressEducation.Set {
		out["accepts_in_progress_education"] = fields.AcceptsInProgressEducation.Value
	}
	if fields.Languages.Set {
		items := make([]any, 0, len(fields.Languages.Value))
		for _, item := range fields.Languages.Value {
			items = append(items, map[string]any{languages.CodeField: item.Code, "min_level": item.MinLevel})
		}
		out["languages"] = items
	}
	return out
}
