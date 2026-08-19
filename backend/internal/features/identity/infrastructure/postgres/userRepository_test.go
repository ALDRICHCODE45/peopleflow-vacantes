package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Compile-time assertion that the adapter honors the port.
var _ repositories.UserRepository = (*UserRepository)(nil)

// stubQuerier is a hand-rolled stub of the *db.Queries surface used by the
// adapter. We keep it package-private so the test doesn't leak into other
// packages.
type stubQuerier struct {
	mu sync.Mutex

	createFn func(ctx context.Context, arg db.CreateUserParams) (db.User, error)
	getByID  func(ctx context.Context, id uuid.UUID) (db.User, error)
	getBySub func(ctx context.Context, sub string) (db.User, error)

	createCalls int
}

func (s *stubQuerier) CreateUser(ctx context.Context, arg db.CreateUserParams) (db.User, error) {
	s.mu.Lock()
	s.createCalls++
	s.mu.Unlock()
	if s.createFn != nil {
		return s.createFn(ctx, arg)
	}
	return db.User{}, nil
}

func (s *stubQuerier) GetUserByID(ctx context.Context, id uuid.UUID) (db.User, error) {
	if s.getByID != nil {
		return s.getByID(ctx, id)
	}
	return db.User{}, nil
}

func (s *stubQuerier) GetUserByCognitoSub(ctx context.Context, sub string) (db.User, error) {
	if s.getBySub != nil {
		return s.getBySub(ctx, sub)
	}
	return db.User{}, nil
}

// toUserRowDB is a small helper that builds a synthetic db.User row with all
// the columns populated (created_at/updated_at valid, deleted_at invalid).
func makeUserRow(id uuid.UUID, sub, email, fullName, userType string, createdAt time.Time) db.User {
	return db.User{
		ID:         id,
		CognitoSub: sub,
		Email:      email,
		FullName:   fullName,
		UserType:   userType,
		CreatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Time: createdAt, Valid: true},
		DeletedAt:  pgtype.Timestamptz{Valid: false},
	}
}

// TestUserRepository_CreateReturnsEntity proves the contract that happy-path
// Create returns the persisted entity. The adapter is responsible for
// mapping the entity into CreateUserParams and back.
func TestUserRepository_CreateReturnsEntity(t *testing.T) {
	id := uuid.New()
	row := db.User{
		ID:         id,
		CognitoSub: "sub-abc",
		Email:      "alice@example.com",
		FullName:   "Alice Wonder",
		UserType:   "candidate",
		CreatedAt:  pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
	}
	stub := &stubQuerier{
		createFn: func(_ context.Context, _ db.CreateUserParams) (db.User, error) {
			return row, nil
		},
	}

	repo := NewUserRepository(stub)
	email, _ := valueobjects.NewEmail("alice@example.com")
	name, _ := valueobjects.NewFullName("Alice Wonder")
	ut, _ := valueobjects.NewUserType("candidate")
	u := &entities.User{
		ID:         id,
		CognitoSub: "sub-abc",
		Email:      email,
		FullName:   name,
		UserType:   ut,
	}

	got, err := repo.Create(context.Background(), u)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil || got.ID != id {
		t.Errorf("expected entity returned, got: %v", got)
	}
}

// TestUserRepository_CreatePropagatesMapCreateError ensures the adapter
// applies mapCreateError to incoming driver errors so callers don't see
// raw pgconn.PgError values.
func TestUserRepository_CreatePropagatesMapCreateError(t *testing.T) {
	stub := &stubQuerier{
		createFn: func(_ context.Context, _ db.CreateUserParams) (db.User, error) {
			return db.User{}, errors.New("raw pg error")
		},
	}
	repo := NewUserRepository(stub)
	email, _ := valueobjects.NewEmail("alice@example.com")
	name, _ := valueobjects.NewFullName("Alice Wonder")
	ut, _ := valueobjects.NewUserType("candidate")
	_, err := repo.Create(context.Background(), &entities.User{
		ID:         uuid.New(),
		CognitoSub: "sub-abc",
		Email:      email,
		FullName:   name,
		UserType:   ut,
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if err.Error() != "raw pg error" {
		t.Errorf("expected pass-through error, got: %v", err)
	}
}

// TestBuildCreateParams_MapsEntityToDB ensures each entity field reaches the
// sqlc params struct correctly.
func TestBuildCreateParams_MapsEntityToDB(t *testing.T) {
	id := uuid.New()
	email, _ := valueobjects.NewEmail("alice@example.com")
	name, _ := valueobjects.NewFullName("Alice Wonder")
	ut, _ := valueobjects.NewUserType("candidate")
	u := &entities.User{
		ID:         id,
		CognitoSub: "sub-abc",
		Email:      email,
		FullName:   name,
		UserType:   ut,
	}
	got := buildCreateParams(u)
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.CognitoSub != "sub-abc" {
		t.Errorf("CognitoSub: want %q, got %q", "sub-abc", got.CognitoSub)
	}
	if got.Email != "alice@example.com" {
		t.Errorf("Email: want %q, got %q", "alice@example.com", got.Email)
	}
	if got.FullName != "Alice Wonder" {
		t.Errorf("FullName: want %q, got %q", "Alice Wonder", got.FullName)
	}
	if got.UserType != "candidate" {
		t.Errorf("UserType: want %q, got %q", "candidate", got.UserType)
	}
}

// TestToEntity_RoundTripsRow locks the toEntity mapping by feeding a
// synthetic row and asserting the resulting entity carries the same fields
// (and VOs validate).
func TestToEntity_RoundTripsRow(t *testing.T) {
	id := uuid.New()
	now := time.Now().UTC()
	row := makeUserRow(id, "sub-abc", "alice@example.com", "Alice Wonder", "candidate", now)

	got, err := toEntity(row)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got.ID != id {
		t.Errorf("ID: %v", got.ID)
	}
	if got.CognitoSub != "sub-abc" {
		t.Errorf("CognitoSub: %q", got.CognitoSub)
	}
	if got.Email.Value() != "alice@example.com" {
		t.Errorf("Email: %q", got.Email.Value())
	}
	if got.FullName.Value() != "Alice Wonder" {
		t.Errorf("FullName: %q", got.FullName.Value())
	}
	if got.UserType != valueobjects.UserCandidate {
		t.Errorf("UserType: %v", got.UserType)
	}
	if got.CreatedAt.Location() != time.UTC {
		t.Errorf("CreatedAt location: %v", got.CreatedAt.Location())
	}
}

// TestToEntity_InvalidUserTypeFails covers the case where the DB row
// contains a user_type that no longer maps to a known VO value (e.g. after
// a DOWN-migration that re-introduces a 'admin' value).
func TestToEntity_InvalidUserTypeFails(t *testing.T) {
	id := uuid.New()
	now := time.Now().UTC()
	row := makeUserRow(id, "sub-abc", "alice@example.com", "Alice Wonder", "admin", now)
	_, err := toEntity(row)
	if err == nil {
		t.Fatal("expected error for unmapped user_type, got nil")
	}
	if !errors.Is(err, entities.ErrInvalidUserType) {
		t.Errorf("expected ErrInvalidUserType, got: %v", err)
	}
}

// TestUserRepository_GetByIDNotFound ensures the GetByID path maps
// pgx.ErrNoRows to entities.ErrUserNotFound.
func TestUserRepository_GetByIDNotFound(t *testing.T) {
	// We can't synthesize pgx.ErrNoRows through the stub unless we use a
	// sentinel that mirrors its errors.Is behavior. Use the real one.
	stub := &stubQuerier{
		getByID: func(_ context.Context, _ uuid.UUID) (db.User, error) {
			return db.User{}, pgxErrNoRows()
		},
	}
	repo := NewUserRepository(stub)
	_, err := repo.GetByID(context.Background(), uuid.New())
	if err == nil {
		t.Fatal("expected ErrUserNotFound, got nil")
	}
	if !errors.Is(err, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got: %v", err)
	}
}

// pgxErrNoRows returns the real pgx.ErrNoRows through a wrapper so the
// stub's signature is satisfied even if the package import is unused.
func pgxErrNoRows() error {
	return pgx.ErrNoRows
}
