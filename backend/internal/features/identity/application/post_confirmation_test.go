package application

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

// stubUserRepository captures the user created in the PostConfirmation
// handler. It's a small copy of the application-level stub to keep the
// test self-contained.
type stubUserRepository struct {
	mu          sync.Mutex
	saved       *entities.User
	saveErr     error
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

func (s *stubUserRepository) GetByID(_ context.Context, _ uuid.UUID) (*entities.User, error) {
	return nil, entities.ErrUserNotFound
}

func (s *stubUserRepository) GetByCognitoSub(_ context.Context, _ string) (*entities.User, error) {
	return nil, entities.ErrUserNotFound
}

var _ repositories.UserRepository = (*stubUserRepository)(nil)

// TestPostConfirmation_GroupMapping_Candidates proves the spec scenario
// "group mapping and env-flag gating": with the env flag set to "true" and
// the userAttributes carrying the cognito:groups=[\"candidates\"], the
// handler must create a UserCandidate.
func TestPostConfirmation_GroupMapping_Candidates(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-cand-1",
			"email":          "alice@example.com",
			"name":           "Alice Wonder",
			"cognito:groups": "candidates",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil {
		t.Fatal("expected repository.Create to be called, got no save")
	}
	if repo.saved.UserType != valueobjects.UserCandidate {
		t.Errorf("UserType: want UserCandidate, got %v", repo.saved.UserType)
	}
	if repo.saved.CognitoSub != "sub-cand-1" {
		t.Errorf("CognitoSub: want %q, got %q", "sub-cand-1", repo.saved.CognitoSub)
	}
}

// TestPostConfirmation_GroupMapping_Recruiters covers the recruiter path.
func TestPostConfirmation_GroupMapping_Recruiters(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-rec-1",
			"email":          "bob@example.com",
			"name":           "Bob Recruiter",
			"cognito:groups": "recruiters",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil || repo.saved.UserType != valueobjects.UserRecruiter {
		t.Errorf("expected UserRecruiter, got: %+v", repo.saved)
	}
}

// TestPostConfirmation_GroupMapping_CompanyAdmins covers the company_admins
// alias mapping to UserRecruiter.
func TestPostConfirmation_GroupMapping_CompanyAdmins(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-ca-1",
			"email":          "carol@example.com",
			"name":           "Carol Admin",
			"cognito:groups": "company_admins",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil || repo.saved.UserType != valueobjects.UserRecruiter {
		t.Errorf("expected UserRecruiter (company_admins alias), got: %+v", repo.saved)
	}
}

// TestPostConfirmation_EnvFlagUnsetShortCircuits proves the gating: when
// the env flag is unset, the handler must NOT invoke CreateUser.
func TestPostConfirmation_EnvFlagUnsetShortCircuits(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	// Do NOT set the env flag.
	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-abc",
			"email":          "alice@example.com",
			"name":           "Alice Wonder",
			"cognito:groups": "candidates",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("expected CreateUser to NOT be called, got %d calls", repo.createCalls)
	}
}

// TestPostConfirmation_EnvFlagFalseShortCircuits proves the same gating
// applies when the flag is explicitly set to "false".
func TestPostConfirmation_EnvFlagFalseShortCircuits(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "false")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-abc",
			"email":          "alice@example.com",
			"name":           "Alice Wonder",
			"cognito:groups": "candidates",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("expected CreateUser to NOT be called, got %d calls", repo.createCalls)
	}
}

// TestPostConfirmation_NoMatchingGroupSkips proves the no-match path: the
// handler must skip CreateUser and log, returning no error.
func TestPostConfirmation_NoMatchingGroupSkips(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-abc",
			"email":          "alice@example.com",
			"name":           "Alice Wonder",
			"cognito:groups": "admins",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("expected CreateUser to NOT be called for non-mapped group, got %d calls", repo.createCalls)
	}
}

// TestPostConfirmation_RepeatedDeliveryLeavesOneRow mocks the idempotency
// contract: the first call creates, the second returns the existing user
// (ErrUserExists / GetByCognitoSub path). Both calls return no error.
func TestPostConfirmation_RepeatedDeliveryLeavesOneRow(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	event := PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-dup",
			"email":          "alice@example.com",
			"name":           "Alice Wonder",
			"cognito:groups": "candidates",
		},
	}

	// First call: simulate a save.
	repo.saveErr = nil
	if err := h.Handle(context.Background(), event); err != nil {
		t.Fatalf("first call: expected no error, got: %v", err)
	}
	firstCalls := repo.createCalls
	if firstCalls != 1 {
		t.Fatalf("expected 1 create call after first handle, got %d", firstCalls)
	}

	// Second call: simulate the idempotent path (repo returns ErrUserExists).
	repo.saveErr = entities.ErrUserExists
	if err := h.Handle(context.Background(), event); err != nil {
		t.Fatalf("second call: expected no error (idempotent), got: %v", err)
	}
	if repo.createCalls != firstCalls+1 {
		t.Errorf("expected 2 create calls, got %d", repo.createCalls)
	}
}

// TestPostConfirmation_InvalidEmailReturnsError ensures the handler
// surfaces VO errors from the underlying use case.
func TestPostConfirmation_InvalidEmailReturnsError(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-bad",
			"email":          "",
			"name":           "Alice Wonder",
			"cognito:groups": "candidates",
		},
	})
	if err == nil {
		t.Fatal("expected ErrInvalidEmail, got nil")
	}
	if !errors.Is(err, entities.ErrInvalidEmail) {
		t.Errorf("expected ErrInvalidEmail, got: %v", err)
	}
	if repo.createCalls != 0 {
		t.Errorf("expected CreateUser to NOT be called, got %d", repo.createCalls)
	}
}

// TestPostConfirmation_CognitoGroupsCSV proves the comma-separated wire
// format is normalized correctly.
func TestPostConfirmation_CognitoGroupsCSV(t *testing.T) {
	repo := &stubUserRepository{}
	h := NewPostConfirmationHandler(repo)

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	err := h.Handle(context.Background(), PostConfirmationEvent{
		UserAttributes: map[string]string{
			"sub":            "sub-csv",
			"email":          "alice@example.com",
			"name":           "Alice Wonder",
			"cognito:groups": "company_admins,other_group",
		},
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil || repo.saved.UserType != valueobjects.UserRecruiter {
		t.Errorf("expected CSV-format group with company_admins to map to UserRecruiter, got: %+v", repo.saved)
	}
}
