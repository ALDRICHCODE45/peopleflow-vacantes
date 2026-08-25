package usecases

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/google/uuid"
)

// TestListApplicationsByJob_Success: pass-through to ListByJob with
// (jobID, companyID). Returns the slice unchanged.
func TestListApplicationsByJob_Success(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	want := []entities.ApplicationWithCandidate{
		{Application: entities.Application{Status: 0}},
	}
	repo.listByJobApps = want
	svc := NewApplicationService(repo, userRepo)

	jobID := makeJobID()
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000333")
	got, err := svc.ListApplicationsByJob(context.Background(), companyID, jobID)
	if err != nil {
		t.Fatalf("ListApplicationsByJob: unexpected err %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("ListApplicationsByJob: want 1 item, got %d", len(got))
	}
	if repo.listByJobCalls != 1 {
		t.Errorf("ListByJob calls: want 1, got %d", repo.listByJobCalls)
	}
	if repo.lastListByJob.JobID != jobID {
		t.Errorf("ListByJob.JobID: want %v, got %v", jobID, repo.lastListByJob.JobID)
	}
	if repo.lastListByJob.CompanyID != companyID {
		t.Errorf("ListByJob.CompanyID: want %v, got %v", companyID, repo.lastListByJob.CompanyID)
	}
}

// TestListApplicationsByJob_ScopeErrorPropagates: ErrApplicationNotFound
// from the repo passes through untouched (the adapter turned pgx.ErrNoRows
// into the domain sentinel; the use case must NOT swallow it).
func TestListApplicationsByJob_ScopeErrorPropagates(t *testing.T) {
	repo := &stubApplicationRepo{listByJobErr: entities_ErrApplicationNotFound()}
	userRepo := &stubUserRepo{}
	svc := NewApplicationService(repo, userRepo)

	jobID := makeJobID()
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000333")
	got, err := svc.ListApplicationsByJob(context.Background(), companyID, jobID)
	if !errors.Is(err, entities_ErrApplicationNotFound()) {
		t.Errorf("want ErrApplicationNotFound, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil slice on error, got %v", got)
	}
}
