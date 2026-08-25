package usecases

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
)

// TestGetApplicationDetail_Success: pass-through to GetByID with
// (id, jobID, companyID). Returns the entity unchanged.
func TestGetApplicationDetail_Success(t *testing.T) {
	repo := &stubApplicationRepo{}
	userRepo := &stubUserRepo{}
	want := &entities.ApplicationWithCandidate{
		Application: entities.Application{
			Status: valueobjects.InReview,
		},
	}
	repo.getByIDApp = want
	svc := NewApplicationService(repo, userRepo)

	appID := uuid.MustParse("018e0000-0000-7000-8000-000000000444")
	jobID := makeJobID()
	companyID := uuid.MustParse("018f0000-0000-7000-8000-000000000333")
	got, err := svc.GetApplicationDetail(context.Background(), companyID, jobID, appID)
	if err != nil {
		t.Fatalf("GetApplicationDetail: unexpected err %v", err)
	}
	if got == nil {
		t.Fatal("GetApplicationDetail: want non-nil")
	}
	if got.Status != valueobjects.InReview {
		t.Errorf("Status: want in_review, got %v", got.Status)
	}
	if repo.getByIDCalls != 1 {
		t.Errorf("GetByID calls: want 1, got %d", repo.getByIDCalls)
	}
	if repo.lastGetByID.ID != appID {
		t.Errorf("GetByID.ID: want %v, got %v", appID, repo.lastGetByID.ID)
	}
	if repo.lastGetByID.JobID != jobID {
		t.Errorf("GetByID.JobID: want %v, got %v", jobID, repo.lastGetByID.JobID)
	}
	if repo.lastGetByID.CompanyID != companyID {
		t.Errorf("GetByID.CompanyID: want %v, got %v", companyID, repo.lastGetByID.CompanyID)
	}
}

// TestGetApplicationDetail_NotFoundPropagates: ErrApplicationNotFound passes through.
func TestGetApplicationDetail_NotFoundPropagates(t *testing.T) {
	repo := &stubApplicationRepo{getByIDErr: entities_ErrApplicationNotFound()}
	userRepo := &stubUserRepo{}
	svc := NewApplicationService(repo, userRepo)

	got, err := svc.GetApplicationDetail(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if !errors.Is(err, entities_ErrApplicationNotFound()) {
		t.Errorf("want ErrApplicationNotFound, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %v", got)
	}
}
