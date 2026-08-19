package entities

import (
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// TestJob_FieldsAreAccessible proves the spec scenario "GET /jobs/{id}
// returns a published job": every field the HTTP layer reads from the
// entity must be addressable, and the VOs must hold the canonical
// values. The entity is a pure read model — no factory, no UUID
// generation — so we build one inline and verify the shape.
func TestJob_FieldsAreAccessible(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	title := "Backend Engineer"
	description := "Build services in Go."
	location := "CDMX"
	salaryMin := 40000
	salaryMax := 60000
	publishedAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)

	wm, _ := valueobjects.ParseWorkMode("remote")
	et, _ := valueobjects.ParseEmploymentType("full_time")
	sn, _ := valueobjects.ParseSeniority("senior")
	js, _ := valueobjects.ParseJobStatus("published")
	sc, _ := valueobjects.ParseSalaryCurrency("MXN")

	job := Job{
		ID:             id,
		Title:          title,
		Description:    description,
		WorkMode:       wm,
		EmploymentType: et,
		Seniority:      sn,
		JobStatus:      js,
		Location:       &location,
		SalaryMin:      &salaryMin,
		SalaryMax:      &salaryMax,
		SalaryCurrency: sc,
		PublishedAt:    &publishedAt,
		Company: CompanyRef{
			ID:   companyID,
			Name: "Acme SA",
		},
	}

	if job.ID != id {
		t.Errorf("ID: got %v, want %v", job.ID, id)
	}
	if job.Title != title {
		t.Errorf("Title: got %q, want %q", job.Title, title)
	}
	if job.Description != description {
		t.Errorf("Description: got %q, want %q", job.Description, description)
	}
	if job.WorkMode != wm {
		t.Errorf("WorkMode: got %v, want %v", job.WorkMode, wm)
	}
	if job.EmploymentType != et {
		t.Errorf("EmploymentType: got %v, want %v", job.EmploymentType, et)
	}
	if job.Seniority != sn {
		t.Errorf("Seniority: got %v, want %v", job.Seniority, sn)
	}
	if job.JobStatus != js {
		t.Errorf("JobStatus: got %v, want %v", job.JobStatus, js)
	}
	if job.Location == nil || *job.Location != location {
		t.Errorf("Location: got %v, want %v", job.Location, &location)
	}
	if job.SalaryMin == nil || *job.SalaryMin != salaryMin {
		t.Errorf("SalaryMin: got %v, want %v", job.SalaryMin, &salaryMin)
	}
	if job.SalaryMax == nil || *job.SalaryMax != salaryMax {
		t.Errorf("SalaryMax: got %v, want %v", job.SalaryMax, &salaryMax)
	}
	if job.SalaryCurrency != sc {
		t.Errorf("SalaryCurrency: got %v, want %v", job.SalaryCurrency, sc)
	}
	if job.PublishedAt == nil || !job.PublishedAt.Equal(publishedAt) {
		t.Errorf("PublishedAt: got %v, want %v", job.PublishedAt, &publishedAt)
	}
	if job.Company.ID != companyID {
		t.Errorf("Company.ID: got %v, want %v", job.Company.ID, companyID)
	}
	if job.Company.Name != "Acme SA" {
		t.Errorf("Company.Name: got %q, want %q", job.Company.Name, "Acme SA")
	}
}

// TestJob_NullableFieldsAcceptNil covers the spec scenario "optional
// fields accept NULL": the postgres adapter will hand the entity `nil`
// pointers for any of Location/SalaryMin/SalaryMax/PublishedAt. The
// entity must accept those as the absence signal — no defensive zeroing
// that would lose information about what the row actually said.
func TestJob_NullableFieldsAcceptNil(t *testing.T) {
	wm, _ := valueobjects.ParseWorkMode("onsite")
	et, _ := valueobjects.ParseEmploymentType("contract")
	sn, _ := valueobjects.ParseSeniority("mid")
	js, _ := valueobjects.ParseJobStatus("published")
	sc, _ := valueobjects.ParseSalaryCurrency("USD")

	job := Job{
		ID:             uuid.New(),
		Title:          "Untitled",
		Description:    "n/a",
		WorkMode:       wm,
		EmploymentType: et,
		Seniority:      sn,
		JobStatus:      js,
		// Location, SalaryMin, SalaryMax, PublishedAt deliberately nil.
		SalaryCurrency: sc,
		Company:        CompanyRef{ID: uuid.New(), Name: "Acme"},
	}

	if job.Location != nil {
		t.Errorf("Location must be nil, got %v", *job.Location)
	}
	if job.SalaryMin != nil {
		t.Errorf("SalaryMin must be nil, got %v", *job.SalaryMin)
	}
	if job.SalaryMax != nil {
		t.Errorf("SalaryMax must be nil, got %v", *job.SalaryMax)
	}
	if job.PublishedAt != nil {
		t.Errorf("PublishedAt must be nil, got %v", *job.PublishedAt)
	}
}

// TestCompanyRef_HoldsIDAndName is the smallest possible anchor for the
// embedded-company shape: the API response wraps the job with
// `company: { id, name }`, so CompanyRef must be reachable as a single
// value (not a pointer) and carry both fields.
func TestCompanyRef_HoldsIDAndName(t *testing.T) {
	id := uuid.New()
	ref := CompanyRef{ID: id, Name: "Acme"}
	if ref.ID != id {
		t.Errorf("ID: got %v, want %v", ref.ID, id)
	}
	if ref.Name != "Acme" {
		t.Errorf("Name: got %q, want %q", ref.Name, "Acme")
	}
}

// TestErrJobNotFoundSentinel proves the spec scenario "GET /jobs/{id}
// hides non-visible jobs": the HTTP layer's classifyError must be able
// to detect the not-found case via errors.Is(ErrJobNotFound), so the
// sentinel must be a stable, non-nil, distinct error value.
func TestErrJobNotFoundSentinel(t *testing.T) {
	if ErrJobNotFound == nil {
		t.Fatal("ErrJobNotFound must be non-nil")
	}
	other := errors.New("not found")
	if errors.Is(other, ErrJobNotFound) {
		t.Error("a foreign error must not satisfy errors.Is(ErrJobNotFound)")
	}
}
