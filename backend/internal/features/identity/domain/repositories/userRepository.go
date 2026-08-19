// Package repositories defines the persistence ports for the identity context.
package repositories

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// UserRepository is the persistence port for the identity bounded context.
// The Create contract returns the persisted entity because the Postgres
// adapter may issue an idempotent upsert and need to re-fetch by cognito_sub
// to return the existing row.
type UserRepository interface {
	Create(ctx context.Context, user *entities.User) (*entities.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*entities.User, error)
	GetByCognitoSub(ctx context.Context, cognitoSub string) (*entities.User, error)
}
