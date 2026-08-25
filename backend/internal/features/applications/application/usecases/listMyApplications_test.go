package usecases

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
)

// TestListMyApplications_Success: resolves sub → candidateID, calls
// ListByCandidate, returns the slice unchanged.
func TestListMyApplications_Success(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	candidateID := makeCandidateID()
	makeUserStub(t, userRepo, "sub-1", candidateID)

	want := []entities.MyApplication{
		{Job: entities.JobSummary{ID: makeJobID()}},
	}
	repo.listByCandidateApps = want

	svc := NewApplicationService(repo, userRepo)
	got, err := svc.ListMyApplications(context.Background(), "sub-1")
	if err != nil {
		t.Fatalf("ListMyApplications: unexpected err %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("ListMyApplications: want 1 item, got %d", len(got))
	}
	if repo.listByCandidateCalls != 1 {
		t.Errorf("ListByCandidate calls: want 1, got %d", repo.listByCandidateCalls)
	}
	if repo.lastListByCandidate != candidateID {
		t.Errorf("ListByCandidate candidateID: want %v (resolved from sub), got %v", candidateID, repo.lastListByCandidate)
	}
}

// TestListMyApplications_UnknownSub: ErrUserNotFound → ErrUnknownSubject; ListByCandidate NOT called.
func TestListMyApplications_UnknownSub(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{getByCognitoSubErr: identityentities.ErrUserNotFound}
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.ListMyApplications(context.Background(), "sub-unknown")
	if !errors.Is(err, ErrUnknownSubject) {
		t.Errorf("want ErrUnknownSubject, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil slice, got %v", got)
	}
	if repo.listByCandidateCalls != 0 {
		t.Errorf("ListByCandidate MUST NOT be called on unknown sub; got %d calls", repo.listByCandidateCalls)
	}
}

// TestListMyApplications_EmptyListNonNil: empty repo result → non-nil slice
// (JSON renders [] not null).
func TestListMyApplications_EmptyListNonNil(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	makeUserStub(t, userRepo, "sub-1", makeCandidateID())
	// Leave listByCandidateApps as nil (zero value); the use case MUST
	// return a non-nil empty slice.
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.ListMyApplications(context.Background(), "sub-1")
	if err != nil {
		t.Fatalf("ListMyApplications: unexpected err %v", err)
	}
	if got == nil {
		t.Error("want non-nil empty slice, got nil")
	}
	if len(got) != 0 {
		t.Errorf("want empty slice, got %d items", len(got))
	}
}
