package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// TestGetJobByID_Found covers the spec scenario "GET /jobs/{id} returns
// a published job": the use case forwards the call to the repo and
// returns the entity to the HTTP layer untouched.
func TestGetJobByID_Found(t *testing.T) {
	id := uuid.New()
	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	want := &entities.Job{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      valueobjects.Published,
		SalaryCurrency: valueobjects.MXN,
		PublishedAt:    &pub,
		Company: entities.CompanyRef{
			ID:   uuid.MustParse("018e0000-0000-7000-8000-000000000001"),
			Name: "Acme SA",
		},
	}
	repo := &stubJobRepository{getByIDOut: want}
	svc := NewJobService(repo)

	got, err := svc.GetJobByID(context.Background(), id)
	if err != nil {
		t.Fatalf("GetJobByID: %v", err)
	}
	if got == nil {
		t.Fatal("GetJobByID: want non-nil, got nil")
	}
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.Title != want.Title {
		t.Errorf("Title: want %q, got %q", want.Title, got.Title)
	}
}

// TestGetJobByID_NotFound covers the spec scenario "GET /jobs/{id}
// hides non-visible jobs": the repo returns ErrJobNotFound for any
// non-visible row (draft, closed, soft-deleted, non-active company).
// The use case propagates the sentinel so the HTTP layer maps to 404.
func TestGetJobByID_NotFound(t *testing.T) {
	repo := &stubJobRepository{getByIDErr: entities.ErrJobNotFound}
	svc := NewJobService(repo)

	got, err := svc.GetJobByID(context.Background(), uuid.New())
	if !errors.Is(err, entities.ErrJobNotFound) {
		t.Errorf("want ErrJobNotFound, got %v", err)
	}
	if got != nil {
		t.Errorf("want nil on not-found, got %+v", got)
	}
}

// TestGetJobByID_OtherErrorPropagates covers the generic error path:
// anything other than ErrJobNotFound flows up unchanged so the HTTP
// layer can map to 500.
func TestGetJobByID_OtherErrorPropagates(t *testing.T) {
	want := errors.New("db is on fire")
	repo := &stubJobRepository{getByIDErr: want}
	svc := NewJobService(repo)

	got, err := svc.GetJobByID(context.Background(), uuid.New())
	if !errors.Is(err, want) {
		t.Errorf("want %v, got %v", want, err)
	}
	if got != nil {
		t.Errorf("want nil on error, got %+v", got)
	}
}
