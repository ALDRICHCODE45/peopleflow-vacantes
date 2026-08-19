package repositories

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// Compile-time assertion that the in-memory fake implements the port and
// that the port's contract is what this file expects.
var _ UserRepository = (*fakeUserRepository)(nil)

// fakeUserRepository is a hand-rolled stub used solely to lock the port
// signature down. The application tests will reuse the same pattern.
type fakeUserRepository struct {
	mu          sync.Mutex
	createIn    *entities.User
	createOK    error
	getByID     *entities.User
	getErr      error
	createCalls int
}

func (f *fakeUserRepository) Create(_ context.Context, u *entities.User) (*entities.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.createCalls++
	if f.createOK != nil {
		return nil, f.createOK
	}
	f.createIn = u
	return u, nil
}

func (f *fakeUserRepository) GetByID(_ context.Context, _ uuid.UUID) (*entities.User, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.getByID != nil {
		return f.getByID, nil
	}
	return nil, entities.ErrUserNotFound
}

func (f *fakeUserRepository) GetByCognitoSub(_ context.Context, sub string) (*entities.User, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	if f.getByID != nil && f.getByID.CognitoSub == sub {
		return f.getByID, nil
	}
	return nil, entities.ErrUserNotFound
}

// TestUserRepository_PortShape pins the port API. If this test fails to
// compile, the repository contract changed and downstream consumers must be
// updated.
func TestUserRepository_PortShape(t *testing.T) {
	repo := &fakeUserRepository{}
	_ = repo
}

// TestUserRepository_CreateReturnsEntity locks the contract that Create
// returns the persisted entity (not an error) on success.
func TestUserRepository_CreateReturnsEntity(t *testing.T) {
	repo := &fakeUserRepository{}
	u := &entities.User{ID: uuid.New(), CognitoSub: "sub-abc"}
	got, err := repo.Create(context.Background(), u)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil || got.CognitoSub != "sub-abc" {
		t.Errorf("expected entity returned, got: %v", got)
	}
}

// TestUserRepository_GetByIDNotFound asserts the not-found sentinel.
func TestUserRepository_GetByIDNotFound(t *testing.T) {
	repo := &fakeUserRepository{}
	_, err := repo.GetByID(context.Background(), uuid.New())
	if err == nil {
		t.Fatal("expected ErrUserNotFound, got nil")
	}
	if !errors.Is(err, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got: %v", err)
	}
}
