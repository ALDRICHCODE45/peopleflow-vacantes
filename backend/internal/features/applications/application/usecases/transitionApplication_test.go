package usecases

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
)

// transitionRequestBuilder returns the in-package DTO type via a thin
// accessor (defined in transitionApplication.go) so the test file does not
// import the dtos package directly.

// makeTransitionDetail returns a stub ApplicationWithCandidate carrying the
// given status. Used by the matrix tests to drive the GetByID branch.
func makeTransitionDetail(status valueobjects.ApplicationStatus) *entities.ApplicationWithCandidate {
	return &entities.ApplicationWithCandidate{
		Application: entities.Application{
			ID:     uuid.MustParse("018e0000-0000-7000-8000-000000000555"),
			JobID:  makeJobID(),
			Status: status,
		},
	}
}

// --- TestTransitionApplication_MissingStatus ----------------------------

// TestTransitionApplication_MissingStatus: empty status → ErrStatusRequired.
// GetByID MUST NOT be called.
func TestTransitionApplication_MissingStatus(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.TransitionApplication(context.Background(), uuid.New(), uuid.New(), uuid.New(), transitionRequestDtoFromStatus(""))
	if !errors.Is(err, entities_ErrStatusRequired()) {
		t.Errorf("want ErrStatusRequired, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %v", got)
	}
	if repo.getByIDCalls != 0 {
		t.Errorf("GetByID MUST NOT be called on missing status; got %d calls", repo.getByIDCalls)
	}
	if repo.transitionCalls != 0 {
		t.Errorf("Transition MUST NOT be called on missing status; got %d calls", repo.transitionCalls)
	}
}

// TestTransitionApplication_WhitespaceOnlyStatus: status is whitespace
// only → ErrStatusRequired.
func TestTransitionApplication_WhitespaceOnlyStatus(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.TransitionApplication(context.Background(), uuid.New(), uuid.New(), uuid.New(), transitionRequestDtoFromStatus("   "))
	if !errors.Is(err, entities_ErrStatusRequired()) {
		t.Errorf("want ErrStatusRequired on whitespace, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %v", got)
	}
}

// --- TestTransitionApplication_UnknownStatus ----------------------------

// TestTransitionApplication_UnknownStatus: "withdrawn" → ErrInvalidStatusTransition
// (unwrapped). GetByID MUST NOT be called.
func TestTransitionApplication_UnknownStatus(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.TransitionApplication(context.Background(), uuid.New(), uuid.New(), uuid.New(), transitionRequestDtoFromStatus("withdrawn"))
	if !errors.Is(err, valueobjects_ErrInvalidStatusTransition()) {
		t.Errorf("want ErrInvalidStatusTransition, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %v", got)
	}
	if repo.getByIDCalls != 0 {
		t.Errorf("GetByID MUST NOT be called on unknown status; got %d calls", repo.getByIDCalls)
	}
}

// --- TestTransitionApplication_IllegalMatrix -----------------------------

// TestTransitionApplication_IllegalMatrix walks the full illegal-edge set:
// each row MUST surface ErrInvalidStatusTransition wrapped with
// "<from> -> <to>". The use case reads the current row to learn `from`,
// then enforces the matrix; the test stubs GetByID with the matching
// current status so the matrix branch fires for the (from, to) pair.
//
// GetByID MUST be called (the matrix check needs the current status);
// Transition MUST NOT be called (the illegal edge short-circuits).
func TestTransitionApplication_IllegalMatrix(t *testing.T) {
	cases := []struct {
		from valueobjects.ApplicationStatus
		to   valueobjects.ApplicationStatus
	}{
		{valueobjects.Submitted, valueobjects.Rejected},
		{valueobjects.Submitted, valueobjects.Hired},
		{valueobjects.InReview, valueobjects.Submitted},
		{valueobjects.Rejected, valueobjects.InReview},
		{valueobjects.Hired, valueobjects.Rejected},
		{valueobjects.InReview, valueobjects.InReview}, // no-op self
	}
	for _, c := range cases {
		t.Run(c.from.String()+"_to_"+c.to.String(), func(t *testing.T) {
			repo := &stubApplicationRepo{}
			userRepo := &stubUserRepo{}
			repo.getByIDApp = makeTransitionDetail(c.from)
			svc := NewApplicationService(repo, userRepo)

			got, err := svc.TransitionApplication(
				context.Background(), uuid.New(), uuid.New(), uuid.New(),
				transitionRequestDtoFromStatus(c.to.String()),
			)
			if !errors.Is(err, valueobjects_ErrInvalidStatusTransition()) {
				t.Errorf("want errors.Is(ErrInvalidStatusTransition), got %v", err)
			}
			if !strings.Contains(err.Error(), c.from.String()+" -> "+c.to.String()) {
				t.Errorf("error body %q MUST contain %q", err.Error(), c.from.String()+" -> "+c.to.String())
			}
			if got != nil {
				t.Errorf("want nil on illegal matrix, got %v", got)
			}
			if repo.getByIDCalls != 1 {
				t.Errorf("GetByID calls: want 1 (the matrix check needs current), got %d", repo.getByIDCalls)
			}
			if repo.transitionCalls != 0 {
				t.Errorf("Transition MUST NOT be called on illegal matrix; got %d calls", repo.transitionCalls)
			}
		})
	}
}

// --- TestTransitionApplication_LegalMatrix ------------------------------

// TestTransitionApplication_LegalMatrix: each legal edge passes the matrix
// (GetByID returns the matching current status; Transition is invoked
// with (from, to)).
func TestTransitionApplication_LegalMatrix(t *testing.T) {
	cases := []struct {
		from valueobjects.ApplicationStatus
		to   valueobjects.ApplicationStatus
	}{
		{valueobjects.Submitted, valueobjects.InReview},
		{valueobjects.InReview, valueobjects.Rejected},
		{valueobjects.InReview, valueobjects.Hired},
	}
	for _, c := range cases {
		t.Run(c.from.String()+"_to_"+c.to.String(), func(t *testing.T) {
			repo := &stubApplicationRepo{}
			userRepo := &stubUserRepo{}
			repo.getByIDApp = makeTransitionDetail(c.from)
			svc := NewApplicationService(repo, userRepo)

			got, err := svc.TransitionApplication(
				context.Background(), uuid.New(), uuid.New(), uuid.New(),
				transitionRequestDtoFromStatus(c.to.String()),
			)
			if err != nil {
				t.Fatalf("legal edge %s -> %s: unexpected err %v", c.from, c.to, err)
			}
			if got == nil {
				t.Fatal("want non-nil application")
			}
			if got.Status != c.to {
				t.Errorf("Status: want %s, got %s", c.to, got.Status)
			}
			if repo.getByIDCalls != 1 {
				t.Errorf("GetByID calls: want 1, got %d", repo.getByIDCalls)
			}
			if repo.transitionCalls != 1 {
				t.Errorf("Transition calls: want 1, got %d", repo.transitionCalls)
			}
			if repo.lastTransition.From != c.from {
				t.Errorf("Transition.From: want %s, got %s", c.from, repo.lastTransition.From)
			}
			if repo.lastTransition.To != c.to {
				t.Errorf("Transition.To: want %s, got %s", c.to, repo.lastTransition.To)
			}
		})
	}
}

// --- TestTransitionApplication_GetByIDNotFoundPropagates ----------------

// TestTransitionApplication_GetByIDNotFoundPropagates: 404 on read-for-update.
func TestTransitionApplication_GetByIDNotFoundPropagates(t *testing.T) {
	repo := &stubApplicationRepo{getByIDErr: entities_ErrApplicationNotFound()}
	userRepo := &stubUserRepo{}
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.TransitionApplication(
		context.Background(), uuid.New(), uuid.New(), uuid.New(),
		transitionRequestDtoFromStatus("in_review"),
	)
	if !errors.Is(err, entities_ErrApplicationNotFound()) {
		t.Errorf("want ErrApplicationNotFound, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %v", got)
	}
	if repo.transitionCalls != 0 {
		t.Errorf("Transition MUST NOT be called when GetByID errors; got %d calls", repo.transitionCalls)
	}
}

// --- TestTransitionApplication_TransitionLostRacePropagates -------------

// TestTransitionApplication_TransitionLostRacePropagates: repo.Transition
// returns ErrApplicationNotFound (the SQL WHERE status=from yielded 0
// rows — concurrent transition). Use case MUST propagate it (404 on
// the wire; no CAS, no re-read).
func TestTransitionApplication_TransitionLostRacePropagates(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	repo.getByIDApp = makeTransitionDetail(valueobjects.Submitted)
	repo.transitionErr = entities_ErrApplicationNotFound()
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.TransitionApplication(
		context.Background(), uuid.New(), uuid.New(), uuid.New(),
		transitionRequestDtoFromStatus("in_review"),
	)
	if !errors.Is(err, entities_ErrApplicationNotFound()) {
		t.Errorf("want ErrApplicationNotFound on lost race, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %v", got)
	}
	if repo.transitionCalls != 1 {
		t.Errorf("Transition calls: want 1 (the call that lost), got %d", repo.transitionCalls)
	}
}
