package draftfields

import (
	"fmt"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

// ValidateLanguagesV2 validates catalog requirements without normalization or
// deduplication. Every error identifies the offending field; no partial result
// is returned. Requirements inform applicants and never affect readiness.
func ValidateLanguagesV2(raw any) ([]Language, error) {
	items, err := nestedArray(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: languages", err)
	}
	if len(items) > 20 {
		return nil, fmt.Errorf("%w: languages", errLanguagesTooMany)
	}
	out := make([]Language, 0, len(items))
	seen := make(map[string]bool, len(items))
	for i, item := range items {
		object, ok := item.(map[string]any)
		if !ok || object == nil {
			return nil, fmt.Errorf("%w: languages[%d]", errLanguageNotObject, i)
		}
		for key := range object {
			if key != languages.CodeField && key != "min_level" {
				return nil, fmt.Errorf("%w: languages[%d].%s", errLanguageUnknownKey, i, key)
			}
		}
		for _, key := range []string{languages.CodeField, "min_level"} {
			if _, ok := object[key]; !ok {
				return nil, fmt.Errorf("%w: languages[%d].%s", errLanguageMissingKey, i, key)
			}
		}
		code, ok := object[languages.CodeField].(string)
		if !ok {
			return nil, fmt.Errorf("%w: languages[%d].code", errLanguageWrongType, i)
		}
		if _, ok := languages.Lookup(code); !ok || seen[code] {
			return nil, fmt.Errorf("%w: languages[%d].code", errLanguageInvalidLanguage, i)
		}
		level, ok := object["min_level"].(string)
		if !ok {
			return nil, fmt.Errorf("%w: languages[%d].min_level", errLanguageWrongType, i)
		}
		if !languages.ValidLanguageLevel(level) {
			return nil, fmt.Errorf("%w: languages[%d].min_level", errLanguageInvalidLevel, i)
		}
		seen[code] = true
		out = append(out, Language{Code: code, MinLevel: level})
	}
	return out, nil
}
