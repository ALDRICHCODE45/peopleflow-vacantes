package usecases

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

// stubUserRepository captures the last saved user and returns whatever
// error is programmed into it. Used for RED-first use-case tests.
type stubUserRepository struct {
	mu          sync.Mutex
	saved       *entities.User
	getByIDOut  *entities.User
	saveErr     error
	loginErr    error
	createCalls int
}

func (s *stubUserRepository) Create(_ context.Context, u *entities.User) (*entities.User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	if s.saveErr != nil {
		return nil, s.saveErr
	}
	s.saved = u
	return u, nil
}

func (s *stubUserRepository) GetByID(_ context.Context, id uuid.UUID) (*entities.User, error) {
	if s.getByIDOut != nil && s.getByIDOut.ID == id {
		return s.getByIDOut, nil
	}
	return nil, entities.ErrUserNotFound
}

func (s *stubUserRepository) GetByCognitoSub(_ context.Context, sub string) (*entities.User, error) {
	if s.getByIDOut != nil && s.getByIDOut.CognitoSub == sub {
		return s.getByIDOut, nil
	}
	return nil, entities.ErrUserNotFound
}

// Compile-time guard: the stub honors the port.
var _ repositories.UserRepository = (*stubUserRepository)(nil)

// TestCreateUser_ShortCircuitsOnBadEmail proves the spec scenario
// "CreateUser short-circuits on bad VO": an empty email must return
// ErrInvalidEmail and the repository must NOT be called.
func TestCreateUser_ShortCircuitsOnBadEmail(t *testing.T) {
	repo := &stubUserRepository{}
	svc := NewUserService(repo)

	_, err := svc.CreateUser(context.Background(), CreateUserParams{
		CognitoSub: "sub-abc",
		Email:      "",
		FullName:   "Alice Wonder",
		UserType:   "candidate",
	})
	if err == nil {
		t.Fatal("expected ErrInvalidEmail, got nil")
	}
	if !errors.Is(err, entities.ErrInvalidEmail) {
		t.Errorf("expected ErrInvalidEmail, got: %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("expected repository to NOT be called, got %d calls", repo.createCalls)
	}
}

// TestCreateUser_ShortCircuitsOnEmptyCognitoSub proves the factory-level
// guard fires before the VOs.
func TestCreateUser_ShortCircuitsOnEmptyCognitoSub(t *testing.T) {
	repo := &stubUserRepository{}
	svc := NewUserService(repo)

	_, err := svc.CreateUser(context.Background(), CreateUserParams{
		CognitoSub: "",
		Email:      "alice@example.com",
		FullName:   "Alice Wonder",
		UserType:   "candidate",
	})
	if err == nil {
		t.Fatal("expected ErrEmptyCognitoSub, got nil")
	}
	if !errors.Is(err, entities.ErrEmptyCognitoSub) {
		t.Errorf("expected ErrEmptyCognitoSub, got: %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("expected repository to NOT be called, got %d calls", repo.createCalls)
	}
}

// TestCreateUser_HappyPath proves the use case creates the entity and
// hands it to the repository.
func TestCreateUser_HappyPath(t *testing.T) {
	repo := &stubUserRepository{}
	svc := NewUserService(repo)

	got, err := svc.CreateUser(context.Background(), CreateUserParams{
		CognitoSub: "sub-abc",
		Email:      "alice@example.com",
		FullName:   "Alice Wonder",
		UserType:   "candidate",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil user")
	}
	if repo.saved == nil {
		t.Fatal("expected repository to be called")
	}
	if repo.saved.Email.Value() != "alice@example.com" {
		t.Errorf("Email: want %q, got %q", "alice@example.com", repo.saved.Email.Value())
	}
	if repo.saved.UserType != valueobjects.UserCandidate {
		t.Errorf("UserType: want UserCandidate, got %v", repo.saved.UserType)
	}
}

// TestCreateUser_PropagatesRepoError locks the contract that the
// repository's error flows through unchanged.
func TestCreateUser_PropagatesRepoError(t *testing.T) {
	want := entities.ErrUserExists
	repo := &stubUserRepository{saveErr: want}
	svc := NewUserService(repo)

	_, err := svc.CreateUser(context.Background(), CreateUserParams{
		CognitoSub: "sub-abc",
		Email:      "alice@example.com",
		FullName:   "Alice Wonder",
		UserType:   "candidate",
	})
	if !errors.Is(err, want) {
		t.Errorf("expected %v, got: %v", want, err)
	}
}
