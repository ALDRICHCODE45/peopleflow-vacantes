package usecases

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// GetUserByID returns the user with the given ID, or entities.ErrUserNotFound
// when no live row exists. The repository's error is surfaced unchanged so
// callers can dispatch on errors.Is without losing the original error.
func (s *UserService) GetUserByID(ctx context.Context, id uuid.UUID) (*entities.User, error) {
	return s.repository.GetByID(ctx, id)
}
