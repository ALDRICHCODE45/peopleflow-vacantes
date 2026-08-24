package usecases

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/google/uuid"
)

// stubBootstrapRepository captures the (company, member) pair handed to the
// transactional CreateWithOwner so the use case can be driven through its full
// branching without touching pgx or Postgres.
type stubBootstrapRepository struct {
	company    *entities.Company
	owner      *entities.CompanyMember
	createErr  error
	createCall int
}

func (s *stubBootstrapRepository) CreateWithOwner(_ context.Context, c *entities.Company, m *entities.CompanyMember) error {
	s.createCall++
	if s.createErr != nil {
		return s.createErr
	}
	s.company = c
	s.owner = m
	return nil
}

func validCreateDto() dtos.CreateCompanyDto {
	return dtos.CreateCompanyDto{
		Name:       "Acme SA de CV",
		Rfc:        "AAA010101AAA",
		IndustryID: "tech",
	}
}

func TestCreateCompanyWithOwner_Success(t *testing.T) {
	userID := uuid.MustParse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	bootstrap := &stubBootstrapRepository{}
	users := &stubUserRepository{
		resolved: &identityentities.User{ID: userID, CognitoSub: "sub-1"},
	}

	svc := NewCompanyServiceWithBootstrap(&stubCompanyRepository{}, users, bootstrap)

	got, err := svc.CreateCompanyWithOwner(context.Background(), "sub-1", validCreateDto())
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got == nil {
		t.Fatal("expected company, got nil")
	}
	if bootstrap.createCall != 1 {
		t.Fatalf("expected CreateWithOwner called once, got %d", bootstrap.createCall)
	}
	if bootstrap.company == nil || bootstrap.company.ID != got.ID {
		t.Fatalf("expected repository to receive the same company, got %+v vs %+v", bootstrap.company, got)
	}
	if bootstrap.owner == nil {
		t.Fatal("expected member to be persisted, got nil")
	}
	if bootstrap.owner.UserID != userID {
		t.Errorf("owner UserID: want %v, got %v", userID, bootstrap.owner.UserID)
	}
	if bootstrap.owner.CompanyID != got.ID {
		t.Errorf("owner CompanyID: want %v, got %v", got.ID, bootstrap.owner.CompanyID)
	}
	if bootstrap.owner.Role != valueobjects.OwnerRole {
		t.Errorf("owner Role: want OwnerRole, got %v", bootstrap.owner.Role)
	}
}

func TestCreateCompanyWithOwner_UnknownSubject(t *testing.T) {
	users := &stubUserRepository{resolveErr: identityentities.ErrUserNotFound}
	svc := NewCompanyServiceWithBootstrap(&stubCompanyRepository{}, users, &stubBootstrapRepository{})

	_, err := svc.CreateCompanyWithOwner(context.Background(), "ghost", validCreateDto())
	if !errors.Is(err, entities.ErrUnknownSubject) {
		t.Fatalf("expected ErrUnknownSubject, got: %v", err)
	}
}

func TestCreateCompanyWithOwner_InvalidCompany(t *testing.T) {
	userID := uuid.MustParse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	users := &stubUserRepository{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-1"}}
	svc := NewCompanyServiceWithBootstrap(&stubCompanyRepository{}, users, &stubBootstrapRepository{})

	dto := validCreateDto()
	dto.IndustryID = "   " // triggers ErrEmptyIndustry
	_, err := svc.CreateCompanyWithOwner(context.Background(), "sub-1", dto)
	if !errors.Is(err, entities.ErrEmptyIndustry) {
		t.Fatalf("expected ErrEmptyIndustry, got: %v", err)
	}
}

func TestCreateCompanyWithOwner_PropagatesBootstrapError(t *testing.T) {
	userID := uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc")
	users := &stubUserRepository{resolved: &identityentities.User{ID: userID, CognitoSub: "sub-1"}}
	bootstrap := &stubBootstrapRepository{createErr: entities.ErrDuplicateCompany}
	svc := NewCompanyServiceWithBootstrap(&stubCompanyRepository{}, users, bootstrap)

	_, err := svc.CreateCompanyWithOwner(context.Background(), "sub-1", validCreateDto())
	if !errors.Is(err, entities.ErrDuplicateCompany) {
		t.Fatalf("expected ErrDuplicateCompany, got: %v", err)
	}
}
