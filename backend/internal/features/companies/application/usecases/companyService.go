// Package usecases orchestrates the companies application logic.
package usecases

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
)

type CompanyService struct {
	repository repositories.CompanyRepository
}

func NewCompanyService(repository repositories.CompanyRepository) *CompanyService {
	return &CompanyService{
		repository: repository,
	}
}
