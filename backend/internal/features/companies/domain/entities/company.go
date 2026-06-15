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
	ErrEmptyIndustry   = errors.New("industry is required")
	ErrCompanyNotFound = errors.New("company not found")
)

type Company struct {
	ID         uuid.UUID
	Name       valueobjects.CompanyName
	Rfc        valueobjects.CompanyRfc
	Status     valueobjects.CompanyStatus
	IndustryID string

	Website   *string
	LogoURL   *string
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

func NewCompany(name, rfc, industryID string, website, logoURL *string) (*Company, error) {
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
		ID:         id,
		Name:       companyName,
		Rfc:        companyRfc,
		Status:     valueobjects.PendingVerification,
		IndustryID: industryID,
		Website:    website,
		LogoURL:    logoURL,
		CreatedAt:  now,
		UpdatedAt:  now,
	}, nil
}
