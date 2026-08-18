// Package entities holds the companies bounded-context domain entities.
package entities

import (
	"errors"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

var (
	ErrEmptyIndustry    = errors.New("industry is required")
	ErrCompanyNotFound  = errors.New("company not found")
	ErrDuplicateCompany = errors.New("a company with the same RFC already exists")
	ErrIndustryNotFound = errors.New("industry does not exist")
)

// CompanyProfile bundles the optional, publicly-visible attributes of a
// company. It is the input shape for NewCompany so the constructor signature
// stays stable as we add new optional fields.
type CompanyProfile struct {
	Website *string
	LogoURL *string

	Description *valueobjects.CompanyDescription
	Size        *valueobjects.CompanySize
	FoundedYear *valueobjects.FoundedYear

	City        *string
	Country     *string
	LinkedInURL *string

	InstagramURL  *string
	FacebookURL   *string
	TwitterURL    *string
	CoverImageURL *string
}

// Company is the aggregate root of the companies bounded context. Required
// fields are encoded as value objects (Name, Rfc, Status); optional profile
// attributes are exposed as pointers so absence is distinguishable from a
// zero value.
type Company struct {
	ID         uuid.UUID
	Name       valueobjects.CompanyName
	Rfc        valueobjects.CompanyRfc
	Status     valueobjects.CompanyStatus
	IndustryID string

	Website *string
	LogoURL *string

	Description *valueobjects.CompanyDescription
	Size        *valueobjects.CompanySize
	FoundedYear *valueobjects.FoundedYear

	City        *string
	Country     *string
	LinkedInURL *string

	InstagramURL  *string
	FacebookURL   *string
	TwitterURL    *string
	CoverImageURL *string

	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

// NewCompany creates a new Company aggregate in its initial state. The required
// fields (name, rfc, industry) are validated through their value objects; the
// optional profile is copied verbatim. The caller is expected to have already
// parsed string inputs into their VOs so the entity stays free of formatting
// concerns.
func NewCompany(name, rfc, industryID string, p CompanyProfile) (*Company, error) {
	companyName, err := valueobjects.NewCompanyName(name)
	if err != nil {
		return nil, err
	}

	companyRfc, err := valueobjects.NewCompanyRfc(rfc)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(industryID) == "" {
		return nil, ErrEmptyIndustry
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	return &Company{
		ID:            id,
		Name:          companyName,
		Rfc:           companyRfc,
		Status:        valueobjects.PendingVerification,
		IndustryID:    industryID,
		Website:       p.Website,
		LogoURL:       p.LogoURL,
		Description:   p.Description,
		Size:          p.Size,
		FoundedYear:   p.FoundedYear,
		City:          p.City,
		Country:       p.Country,
		LinkedInURL:   p.LinkedInURL,
		InstagramURL:  p.InstagramURL,
		FacebookURL:   p.FacebookURL,
		TwitterURL:    p.TwitterURL,
		CoverImageURL: p.CoverImageURL,
		CreatedAt:     now,
		UpdatedAt:     now,
	}, nil
}
