package entities

import (
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

// reference uuid package used indirectly via u.ID.Version(); guard against
// the linter dropping the import while the test is being maintained.
var _ = uuid.Nil

// TestNewUser_FactoryPopulatesIDAndTimestamps pins the spec scenario "factory
// populates id and timestamps": a freshly-built user must carry a non-zero
// UUID v7 and CreatedAt == UpdatedAt within a 1s window of UTC now.
func TestNewUser_FactoryPopulatesIDAndTimestamps(t *testing.T) {
	before := time.Now().UTC()

	email, err := valueobjects.NewEmail("alice@example.com")
	if err != nil {
		t.Fatalf("setup NewEmail: %v", err)
	}
	fullName, err := valueobjects.NewFullName("Alice Wonder")
	if err != nil {
		t.Fatalf("setup NewFullName: %v", err)
	}
	userType, err := valueobjects.NewUserType("candidate")
	if err != nil {
		t.Fatalf("setup NewUserType: %v", err)
	}

	u, err := NewUser("sub-abc", email, fullName, userType)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if u == nil {
		t.Fatal("expected user to be non-nil")
	}

	if u.ID.String() == "" || u.ID == uuid.Nil {
		t.Errorf("expected a non-zero UUID, got %v", u.ID)
	}
	// UUID v7 sanity: bits 48..50 of the time-low field must be 0b111 (version 7).
	if u.ID.Version() != 7 {
		t.Errorf("expected UUID v7, got version %d", u.ID.Version())
	}

	if u.CreatedAt.IsZero() {
		t.Error("expected CreatedAt to be set")
	}
	if u.UpdatedAt.IsZero() {
		t.Error("expected UpdatedAt to be set")
	}
	if !u.CreatedAt.Equal(u.UpdatedAt) {
		t.Errorf("expected CreatedAt == UpdatedAt, got %v vs %v", u.CreatedAt, u.UpdatedAt)
	}
	if u.CreatedAt.Location() != time.UTC {
		t.Errorf("expected UTC timestamp, got location %v", u.CreatedAt.Location())
	}
	delta := time.Since(before)
	if delta > time.Second {
		t.Errorf("expected CreatedAt within 1s of now, but construction took %v", delta)
	}
}

// TestNewUser_EmptyCognitoSubReturnsSentinel pins the spec contract that an
// empty cognito_sub must short-circuit before any other validation, returning
// the ErrEmptyCognitoSub sentinel.
func TestNewUser_EmptyCognitoSubReturnsSentinel(t *testing.T) {
	email, _ := valueobjects.NewEmail("alice@example.com")
	fullName, _ := valueobjects.NewFullName("Alice Wonder")
	userType, _ := valueobjects.NewUserType("candidate")

	_, err := NewUser("", email, fullName, userType)
	if err == nil {
		t.Fatal("expected ErrEmptyCognitoSub, got nil")
	}
	if !errors.Is(err, ErrEmptyCognitoSub) {
		t.Errorf("expected ErrEmptyCognitoSub, got: %v", err)
	}
}

// TestNewUser_WrappedCognitoSubReturnsSentinel covers the wrapping case so
// callers can rely on errors.Is rather than === to dispatch.
func TestNewUser_WhitespaceCognitoSubReturnsSentinel(t *testing.T) {
	email, _ := valueobjects.NewEmail("alice@example.com")
	fullName, _ := valueobjects.NewFullName("Alice Wonder")
	userType, _ := valueobjects.NewUserType("candidate")

	_, err := NewUser("   ", email, fullName, userType)
	if err == nil {
		t.Fatal("expected ErrEmptyCognitoSub for whitespace-only sub, got nil")
	}
	if !errors.Is(err, ErrEmptyCognitoSub) {
		t.Errorf("expected ErrEmptyCognitoSub, got: %v", err)
	}
}

// TestNewUser_PropagatesVOErrors ensures VO validation errors from the
// constructor inputs flow through unchanged.
func TestNewUser_PropagatesVOErrors(t *testing.T) {
	email, _ := valueobjects.NewEmail("alice@example.com")
	fullName, _ := valueobjects.NewFullName("Alice Wonder")

	_, err := NewUser("sub-abc", email, fullName, valueobjects.UnknownUserType)
	if err == nil {
		t.Fatal("expected ErrInvalidUserType, got nil")
	}
	if !errors.Is(err, valueobjects.ErrInvalidUserType) {
		t.Errorf("expected ErrInvalidUserType, got: %v", err)
	}
}
