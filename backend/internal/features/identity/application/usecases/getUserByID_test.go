package usecases

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/valueobjects"
	"github.com/google/uuid"
)

// TestGetUserByID_PropagatesErrUserNotFound reproduces the spec scenario
// "GetUserByID propagates ErrUserNotFound": when the repository returns
// ErrUserNotFound, the use case must surface it unchanged so the caller can
// dispatch with errors.Is.
func TestGetUserByID_PropagatesErrUserNotFound(t *testing.T) {
	repo := &stubUserRepository{}
	svc := NewUserService(repo)

	_, err := svc.GetUserByID(context.Background(), uuid.New())
	if err == nil {
		t.Fatal("expected ErrUserNotFound, got nil")
	}
	if !errors.Is(err, entities.ErrUserNotFound) {
		t.Errorf("expected ErrUserNotFound, got: %v", err)
	}
}

// TestGetUserByID_HappyPath proves the use case returns the entity
// returned by the repository without revalidation.
func TestGetUserByID_HappyPath(t *testing.T) {
	id := uuid.New()
	email, _ := valueobjects.NewEmail("alice@example.com")
	name, _ := valueobjects.NewFullName("Alice Wonder")
	ut, _ := valueobjects.NewUserType("recruiter")
	stored := &entities.User{
		ID:         id,
		CognitoSub: "sub-abc",
		Email:      email,
		FullName:   name,
		UserType:   ut,
	}
	repo := &stubUserRepository{getByIDOut: stored}
	svc := NewUserService(repo)

	got, err := svc.GetUserByID(context.Background(), id)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil || got.ID != id {
		t.Errorf("expected entity returned, got: %v", got)
	}
}

// TestGetUserByID_PropagatesOtherError ensures the use case surfaces
// unrelated errors unchanged so the caller can log them.
func TestGetUserByID_PropagatesOtherError(t *testing.T) {
	other := errors.New("connection reset")
	// We need to inject an error into the stub; augment with a small
	// specialized stub below.
	repoErr := &errInjectingRepo{err: other}
	svc := NewUserService(repoErr)

	_, err := svc.GetUserByID(context.Background(), uuid.New())
	if !errors.Is(err, other) {
		t.Errorf("expected %v, got: %v", other, err)
	}
}

// errInjectingRepo returns the programmed error for both Get methods.
type errInjectingRepo struct {
	stubUserRepository
	err error
}

func (e *errInjectingRepo) GetByID(_ context.Context, _ uuid.UUID) (*entities.User, error) {
	return nil, e.err
}

func (e *errInjectingRepo) GetByCognitoSub(_ context.Context, _ string) (*entities.User, error) {
	return nil, e.err
}
