// Package repositories defines the persistence ports for the candidates
// bounded context. The application layer depends only on these interfaces;
// the postgres adapter in infrastructure/postgres is the only concrete
// implementation in this slice.
package repositories

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/google/uuid"
)

// CandidateRepository is the persistence port. Every method takes a context
// and the canonical user identifier (uuid.UUID — the internal users.id
// resolved from JWT sub at the use-case edge; never the cognito_sub itself).
type CandidateRepository interface {
	// UpsertProfile performs the idempotent INSERT ... ON CONFLICT (user_id)
	// DO UPDATE on candidate_profiles and returns the persisted row.
	UpsertProfile(ctx context.Context, profile *entities.CandidateProfile) (*entities.CandidateProfile, error)
	// GetProfileByUserID fetches the candidate_profiles row. Returns
	// entities.ErrProfileNotFound when no row exists.
	GetProfileByUserID(ctx context.Context, userID uuid.UUID) (*entities.CandidateProfile, error)
	// ListLanguagesByUserID returns the candidate_languages rows ordered by
	// language. Empty slice (not nil) when the user has no rows.
	ListLanguagesByUserID(ctx context.Context, userID uuid.UUID) ([]entities.Language, error)
	// ReplaceLanguagesByUserID atomically replaces the user's full language
	// list inside one transaction. Duplicate languages in the input must
	// have been rejected by the use case; this method still defends against
	// any race that slips through by surfacing ErrDuplicateLanguage.
	ReplaceLanguagesByUserID(ctx context.Context, userID uuid.UUID, languages []entities.Language) error
}
