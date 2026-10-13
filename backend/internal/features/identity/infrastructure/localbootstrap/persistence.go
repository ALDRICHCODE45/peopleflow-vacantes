package localbootstrap

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/google/uuid"
)

// CreateCode is the closed success code returned by an apply attempt.
type CreateCode string

// Apply success codes (L4 §8).
const (
	CreateCodeCreated       CreateCode = "created"
	CreateCodeAlreadyExists CreateCode = "already_exists"
)

// ErrAlreadyExists signals that a compatible same-subject row already exists.
// It is a success outcome for the caller, not a failure.
var ErrAlreadyExists = errors.New("local bootstrap: compatible user already exists")

// CreateUserCommand is the bootstrap-owned creation input. It is derived only
// from the freshly verified token/UserInfo pair.
type CreateUserCommand struct {
	CognitoSub string
	Email      string
	FullName   string
	UserType   string
}

// UserCreator performs the single users-only creation attempt.
type UserCreator interface {
	Create(ctx context.Context, cmd CreateUserCommand) (CreateCode, error)
}

// RowStore is the narrow persistence seam the bootstrap-compatible adapter
// needs. The existing identity Postgres repository satisfies it by
// composition.
type RowStore interface {
	Create(ctx context.Context, user *entities.User) (*entities.User, error)
	GetByID(ctx context.Context, id uuid.UUID) (*entities.User, error)
	GetByCognitoSub(ctx context.Context, cognitoSub string) (*entities.User, error)
}

// CompatibleUserStore enforces compatible-existing-row comparison and
// race-safe insert/read without changing the existing repository semantics.
type CompatibleUserStore struct {
	store RowStore
}

// NewCompatibleUserStore wraps the existing identity repository.
func NewCompatibleUserStore(store RowStore) *CompatibleUserStore {
	return &CompatibleUserStore{store: store}
}

// Compile-time assertion that the adapter satisfies the identity port.
var _ repositories.UserRepository = (*CompatibleUserStore)(nil)

// Create implements repositories.UserRepository with bootstrap conflict
// semantics:
//
//   - a compatible existing same-subject row reports ErrAlreadyExists with no
//     write (the operation is idempotent for identical identities);
//   - any incompatible existing row (different email, name or user type)
//     reports ErrIdentityConflict and stops — it is never silently preserved
//     or relinked by email;
//   - otherwise the existing idempotent upsert performs one insert attempt and
//     the returned row is re-compared to close the insert/lookup race.
//
// It never updates, merges or deletes a row, and it never retries after an
// ambiguous persistence error.
func (s *CompatibleUserStore) Create(ctx context.Context, user *entities.User) (*entities.User, error) {
	existing, err := s.store.GetByCognitoSub(ctx, user.CognitoSub)
	switch {
	case err == nil:
		if !compatible(existing, user) {
			return nil, ErrIdentityConflict
		}
		return nil, ErrAlreadyExists
	case errors.Is(err, entities.ErrUserNotFound):
		// No live row: fall through to the single insert attempt.
	default:
		// Ambiguous read (connection error, timeout, ...): never guess.
		return nil, err
	}

	created, err := s.store.Create(ctx, user)
	if err != nil {
		return nil, err
	}
	if !compatible(created, user) {
		return nil, ErrIdentityConflict
	}
	if created.ID == user.ID {
		return created, nil
	}
	// The upsert resolved a concurrent insert: the existing row is compatible.
	return nil, ErrAlreadyExists
}

// GetByID delegates unchanged.
func (s *CompatibleUserStore) GetByID(ctx context.Context, id uuid.UUID) (*entities.User, error) {
	return s.store.GetByID(ctx, id)
}

// GetByCognitoSub delegates unchanged.
func (s *CompatibleUserStore) GetByCognitoSub(ctx context.Context, cognitoSub string) (*entities.User, error) {
	return s.store.GetByCognitoSub(ctx, cognitoSub)
}

// compatible reports whether an existing row carries exactly the candidate's
// verified email, full name and user type. The cognito_sub is the lookup key.
func compatible(existing, candidate *entities.User) bool {
	if existing == nil || candidate == nil {
		return false
	}
	return existing.Email.Value() == candidate.Email.Value() &&
		existing.FullName.Value() == candidate.FullName.Value() &&
		existing.UserType == candidate.UserType
}

// UserServiceCreator reuses UserService.CreateUser validation and maps the
// bootstrap outcomes to the closed success codes.
type UserServiceCreator struct {
	users *usecases.UserService
}

// NewUserServiceCreator wraps the existing identity use case.
func NewUserServiceCreator(users *usecases.UserService) *UserServiceCreator {
	return &UserServiceCreator{users: users}
}

// Compile-time assertion that the creator satisfies the handler port.
var _ UserCreator = (*UserServiceCreator)(nil)

// Create performs the single creation attempt. Validation errors and ambiguous
// persistence errors are returned unchanged so the transport maps them to the
// bootstrap_failed code; identity conflicts stop with ErrIdentityConflict.
func (c *UserServiceCreator) Create(ctx context.Context, cmd CreateUserCommand) (CreateCode, error) {
	_, err := c.users.CreateUser(ctx, usecases.CreateUserParams{
		CognitoSub: cmd.CognitoSub,
		Email:      cmd.Email,
		FullName:   cmd.FullName,
		UserType:   cmd.UserType,
	})
	switch {
	case err == nil:
		return CreateCodeCreated, nil
	case errors.Is(err, ErrAlreadyExists):
		return CreateCodeAlreadyExists, nil
	case errors.Is(err, ErrIdentityConflict),
		errors.Is(err, entities.ErrEmailTaken),
		errors.Is(err, entities.ErrUserExists):
		return "", ErrIdentityConflict
	default:
		return "", err
	}
}
