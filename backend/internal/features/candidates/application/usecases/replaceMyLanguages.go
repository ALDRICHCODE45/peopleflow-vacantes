package usecases

import (
	"context"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	candidatesentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
)

// ReplaceMyLanguages atomically replaces the caller's full language list.
// The use case owns VO parsing (CEFR level) and duplicate detection so
// the HTTP layer maps a single sentinel to 400 and the repository is
// never invoked on validation failure.
//
// The atomicity guarantee (delete-then-insert in one tx) lives in the
// postgres adapter; this layer only forwards the canonical list.
func (s *CandidateService) ReplaceMyLanguages(ctx context.Context, cognitoSub string, params dtos.ReplaceMyLanguagesDto) error {
	userID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return err
	}

	languages, err := buildLanguages(params.Languages)
	if err != nil {
		return err
	}

	return s.repository.ReplaceLanguagesByUserID(ctx, userID, languages)
}

// buildLanguages parses each DTO entry through the CEFR VO and enforces
// the spec invariant "the pair (user_id, language) SHALL be unique" at
// the use-case edge — duplicates must reject with entities.ErrDuplicateLanguage
// so the HTTP layer maps to 400.
//
// Empty input returns an empty (non-nil) slice so the adapter issues
// "delete all, insert none" and the stored list is cleared.
func buildLanguages(in []dtos.LanguageDto) ([]candidatesentities.Language, error) {
	if len(in) == 0 {
		return []candidatesentities.Language{}, nil
	}

	seen := make(map[string]struct{}, len(in))
	out := make([]candidatesentities.Language, 0, len(in))
	for _, dto := range in {
		level, err := valueobjects.ParseCefrLevel(dto.Level)
		if err != nil {
			return nil, err
		}
		name := strings.ToLower(strings.TrimSpace(dto.Name))
		if name == "" {
			return nil, valueobjects.ErrInvalidCefrLevel
		}
		if _, dup := seen[name]; dup {
			return nil, candidatesentities.ErrDuplicateLanguage
		}
		seen[name] = struct{}{}
		out = append(out, candidatesentities.Language{Name: name, Level: level})
	}
	return out, nil
}
