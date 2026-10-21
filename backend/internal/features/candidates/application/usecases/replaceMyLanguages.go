package usecases

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	catalog "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
)

func (s *CandidateService) ReplaceMyLanguages(ctx context.Context, sub string, params dtos.ReplaceMyLanguagesDto) error {
	userID, err := s.resolveUserID(ctx, sub)
	if err != nil {
		return err
	}
	var out []entities.Language
	if params.RawLanguages != nil {
		out, err = validateLanguages(params.RawLanguages)
	} else {
		out, err = buildLanguages(params.Languages)
	}
	if err != nil {
		return err
	}
	return s.repository.ReplaceLanguagesByUserID(ctx, userID, out)
}

func buildLanguages(in []dtos.LanguageDto) ([]entities.Language, error) {
	records := make([]map[string]string, 0, len(in))
	for _, entry := range in {
		records = append(records, map[string]string{catalog.CodeField: entry.Name, "level": entry.Level})
	}
	raw, err := json.Marshal(records)
	if err != nil {
		return nil, err
	}
	return validateLanguages(raw)
}

func validateLanguages(raw json.RawMessage) ([]entities.Language, error) {
	errs := &ValidationError{}
	var records []json.RawMessage
	if nullable(raw) || json.Unmarshal(raw, &records) != nil {
		errs.add("languages", "invalid")
		return nil, errs
	}
	if len(records) > 10 {
		errs.add("languages", "too_long")
		return nil, errs
	}
	out := make([]entities.Language, 0, len(records))
	seen := map[string]bool{}
	for i, record := range records {
		prefix := fmt.Sprintf("languages[%d]", i)
		var fields map[string]json.RawMessage
		if json.Unmarshal(record, &fields) != nil || fields == nil {
			errs.add(prefix, "invalid")
			continue
		}
		for key := range fields {
			if key != catalog.CodeField && key != "level" {
				return nil, ErrUnknownField
			}
		}
		code := stringField(fields[catalog.CodeField], prefix+".code", true, func(s string) bool { _, ok := catalog.Lookup(s); return ok }, errs)
		level := stringField(fields["level"], prefix+".level", true, catalog.ValidLanguageLevel, errs)
		if code != nil {
			if seen[*code] {
				errs.add(prefix+".code", "duplicate")
			}
			seen[*code] = true
		}
		if code != nil && level != nil {
			parsed, _ := valueobjects.ParseCefrLevel(*level)
			out = append(out, entities.Language{Name: *code, Level: parsed})
		}
	}
	if len(errs.Fields) > 0 {
		return nil, errs
	}
	return out, nil
}
