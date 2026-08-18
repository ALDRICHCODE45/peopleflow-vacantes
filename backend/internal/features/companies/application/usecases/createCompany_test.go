package usecases

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// stubCompanyRepository captures the last saved company and returns whatever
// error is programmed into it. Tests use it to drive the use case through
// its real branching without touching sqlc or Postgres.
type stubCompanyRepository struct {
	mu       sync.Mutex
	saved    *entities.Company
	saveErr  error
	getByID  *entities.Company
	getErr   error
	calls    int
}

func (s *stubCompanyRepository) Create(_ context.Context, c *entities.Company) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.saveErr != nil {
		return s.saveErr
	}
	s.saved = c
	return nil
}

func (s *stubCompanyRepository) GetByID(_ context.Context, id uuid.UUID) (*entities.Company, error) {
	if s.getErr != nil {
		return nil, s.getErr
	}
	if s.getByID != nil {
		return s.getByID, nil
	}
	return nil, entities.ErrCompanyNotFound
}

func TestCreateCompany_RequiredFields(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	got, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "tech",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected company to be non-nil")
	}
	if repo.saved == nil {
		t.Fatal("expected repository.Create to be called, got no save")
	}
	if repo.saved.Name.Value() != "Acme SA de CV" {
		t.Errorf("expected saved name %q, got: %q", "Acme SA de CV", repo.saved.Name.Value())
	}
}

func TestCreateCompany_ForwardsProfileURLs(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	web := "https://acme.com"
	logo := "https://acme.com/logo.png"

	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "tech",
		Website:    &web,
		LogoURL:    &logo,
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil || repo.saved.Website == nil || *repo.saved.Website != web {
		t.Errorf("expected website %q on saved company, got: %v", web, repo.saved.Website)
	}
}

func TestCreateCompany_ForwardsDescriptionSizeAndYear(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	desc := "Empresa líder en logística"
	size := "medium"
	year := 2010

	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:        "Acme SA de CV",
		Rfc:         "AAA010101AAA",
		IndustryID:  "tech",
		Description: &desc,
		Size:        &size,
		FoundedYear: &year,
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil || repo.saved.Description == nil || repo.saved.Description.Value() != desc {
		t.Errorf("expected description %q, got: %+v", desc, repo.saved.Description)
	}
	if repo.saved == nil || repo.saved.Size == nil || *repo.saved.Size != valueobjects.MediumSize {
		t.Errorf("expected size MediumSize, got: %+v", repo.saved.Size)
	}
	if repo.saved == nil || repo.saved.FoundedYear == nil || repo.saved.FoundedYear.Value() != 2010 {
		t.Errorf("expected foundedYear 2010, got: %+v", repo.saved.FoundedYear)
	}
}

func TestCreateCompany_InvalidSize(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	badSize := "huge"
	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "tech",
		Size:       &badSize,
	})
	if err == nil {
		t.Fatal("expected error for invalid size, got nil")
	}
	if !errors.Is(err, valueobjects.ErrInvalidCompanySize) {
		t.Errorf("expected ErrInvalidCompanySize, got: %v", err)
	}
}

func TestCreateCompany_InvalidYear(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	badYear := 1500
	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:        "Acme SA de CV",
		Rfc:         "AAA010101AAA",
		IndustryID:  "tech",
		FoundedYear: &badYear,
	})
	if err == nil {
		t.Fatal("expected error for invalid year, got nil")
	}
	if !errors.Is(err, valueobjects.ErrFoundedYearOutOfRange) {
		t.Errorf("expected ErrFoundedYearOutOfRange, got: %v", err)
	}
}

func TestCreateCompany_EmptyIndustry(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "   ",
	})
	if err == nil {
		t.Fatal("expected ErrEmptyIndustry, got nil")
	}
	if !errors.Is(err, entities.ErrEmptyIndustry) {
		t.Errorf("expected ErrEmptyIndustry, got: %v", err)
	}
}

func TestCreateCompany_PropagatesRepoError(t *testing.T) {
	repoErr := entities.ErrDuplicateCompany
	repo := &stubCompanyRepository{saveErr: repoErr}
	svc := NewCompanyService(repo)

	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "tech",
	})
	if !errors.Is(err, repoErr) {
		t.Errorf("expected propagated repo error %v, got: %v", repoErr, err)
	}
}

// Sanity: stub repository assertions don't hinge on time-of-day; the use case
// constructs Company.CreatedAt via time.Now().UTC(). This test locks down
// the contract that the saved company carries a non-zero UTC timestamp.
func TestCreateCompany_SetsTimestamp(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	before := time.Now().UTC()
	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "tech",
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if repo.saved == nil {
		t.Fatal("expected saved company, got nil")
	}
	got := repo.saved.CreatedAt
	if got.IsZero() {
		t.Fatal("expected non-zero CreatedAt")
	}
	if got.Location() != time.UTC {
		t.Errorf("expected UTC timestamp, got location %v", got.Location())
	}
	if got.Before(before.Add(-time.Second)) || got.After(time.Now().UTC().Add(time.Second)) {
		// generous window to avoid CI flake
		t.Errorf("CreatedAt %v out of expected window around %v", got, before)
	}
}

// Test that an oversized description surfaces ErrCompanyDescriptionTooLong.
func TestCreateCompany_DescriptionTooLong(t *testing.T) {
	repo := &stubCompanyRepository{}
	svc := NewCompanyService(repo)

	longDesc := strings.Repeat("a", 3001)
	_, err := svc.CreateCompany(context.Background(), dtos.CreateCompanyDto{
		Name:        "Acme SA de CV",
		Rfc:         "AAA010101AAA",
		IndustryID:  "tech",
		Description: &longDesc,
	})
	if err == nil {
		t.Fatal("expected error for too-long description, got nil")
	}
	if !errors.Is(err, valueobjects.ErrCompanyDescriptionTooLong) {
		t.Errorf("expected ErrCompanyDescriptionTooLong, got: %v", err)
	}
}
