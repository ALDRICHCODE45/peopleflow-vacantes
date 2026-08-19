// Package postgres implements the identity persistence ports against PostgreSQL.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Querier is the sqlc-generated surface the adapter needs. Defining it here
// keeps the adapter's dependency on the *db package narrow and lets the
// adapter tests stub the surface without spinning up Postgres.
type Querier interface {
	CreateUser(ctx context.Context, arg db.CreateUserParams) (db.User, error)
	GetUserByID(ctx context.Context, id uuid.UUID) (db.User, error)
	GetUserByCognitoSub(ctx context.Context, cognitoSub string) (db.User, error)
}

// Compile-time assertion that *db.Queries satisfies the adapter's seam.
var _ Querier = (*db.Queries)(nil)

// UserRepository is the PostgreSQL adapter for repositories.UserRepository.
type UserRepository struct {
	queries Querier
}

// NewUserRepository wraps the sqlc-generated data layer.
func NewUserRepository(queries Querier) *UserRepository {
	return &UserRepository{queries: queries}
}

// Compile-time assertion that the adapter satisfies the domain port.
var _ repositories.UserRepository = (*UserRepository)(nil)

// Create persists a new user via the idempotent upsert. The
// ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING returns
// zero rows on conflict, which surfaces as pgx.ErrNoRows; the adapter
// re-fetches by cognito_sub and returns the existing entity unchanged.
func (r *UserRepository) Create(ctx context.Context, user *entities.User) (*entities.User, error) {
	row, err := r.queries.CreateUser(ctx, buildCreateParams(user))
	if err != nil {
		// pgx.ErrNoRows here means the upsert hit the conflict path; resync
		// by re-fetching the existing row. Anything else is mapped to a
		// domain sentinel (or passed through).
		if errors.Is(err, pgx.ErrNoRows) {
			existing, getErr := r.queries.GetUserByCognitoSub(ctx, user.CognitoSub)
			if getErr != nil {
				return nil, mapCreateError(getErr)
			}
			return toEntity(existing)
		}
		return nil, mapCreateError(err)
	}
	return toEntity(row)
}

// GetByID fetches a user by primary key. Soft-deleted rows (deleted_at NOT
// NULL) count as not found.
func (r *UserRepository) GetByID(ctx context.Context, id uuid.UUID) (*entities.User, error) {
	row, err := r.queries.GetUserByID(ctx, id)
	if err != nil {
		return nil, mapCreateError(err)
	}
	return toEntity(row)
}

// GetByCognitoSub fetches a user by their Cognito identifier. Soft-deleted
// rows count as not found.
func (r *UserRepository) GetByCognitoSub(ctx context.Context, cognitoSub string) (*entities.User, error) {
	row, err := r.queries.GetUserByCognitoSub(ctx, cognitoSub)
	if err != nil {
		return nil, mapCreateError(err)
	}
	return toEntity(row)
}

// buildCreateParams translates an entity into the sqlc CreateUserParams
// struct. The VOs are reduced to their string form; the caller is
// responsible for having validated them via the constructor.
func buildCreateParams(u *entities.User) db.CreateUserParams {
	return db.CreateUserParams{
		ID:         u.ID,
		CognitoSub: u.CognitoSub,
		Email:      u.Email.Value(),
		FullName:   u.FullName.Value(),
		UserType:   u.UserType.String(),
	}
}

// toEntity rebuilds the domain entity from a sqlc row. The VOs are
// reconstructed via the constructors so unrecognized values fail loudly
// instead of silently producing a zero-valued aggregate.
func toEntity(row db.User) (*entities.User, error) {
	email, err := valueobjects.NewEmail(row.Email)
	if err != nil {
		return nil, err
	}
	fullName, err := valueobjects.NewFullName(row.FullName)
	if err != nil {
		return nil, err
	}
	userType, err := valueobjects.NewUserType(row.UserType)
	if err != nil {
		return nil, entities.ErrInvalidUserType
	}

	u := &entities.User{
		ID:         row.ID,
		CognitoSub: row.CognitoSub,
		Email:      email,
		FullName:   fullName,
		UserType:   userType,
		CreatedAt:  pgTimestamptzToTime(row.CreatedAt),
		UpdatedAt:  pgTimestamptzToTime(row.UpdatedAt),
		DeletedAt:  pgTimestamptzToTimePtr(row.DeletedAt),
	}
	return u, nil
}

// pgTimestamptzToTime returns the Time value or the zero time when the
// pgx wrapper is invalid. The CREATE/SELECT queries always produce valid
// timestamps, so a zero here would only come from a corrupted row.
func pgTimestamptzToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

// pgTimestamptzToTimePtr returns nil for invalid (NULL) timestamps and a
// non-nil pointer otherwise.
func pgTimestamptzToTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	tt := t.Time
	return &tt
}

// mapCreateError translates Postgres constraint violations and not-found
// errors into identity-domain sentinels so the application layer can
// dispatch on errors.Is without importing pgx/pgconn.
//
// Branches:
//   - 23505 on users_cognito_sub_unique -> ErrUserExists (defensive —
//     the upsert normally swallows this and pgx surfaces
//     pgx.ErrNoRows; the Create path catches that and re-fetches).
//   - 23505 on users_email_unique -> ErrEmailTaken (the live branch —
//     a new cognito_sub colliding with an existing email).
//   - pgx.ErrNoRows (wrapped or not) -> ErrUserNotFound (the two Get
//     methods).
//   - any other error -> pass-through unchanged.
func mapCreateError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "23505" {
			switch pgErr.ConstraintName {
			case "users_cognito_sub_unique":
				return entities.ErrUserExists
			case "users_email_unique":
				return entities.ErrEmailTaken
			}
		}
		return err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrUserNotFound
	}
	return err
}
