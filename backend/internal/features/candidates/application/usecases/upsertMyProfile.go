package usecases

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
)

// UpsertMyProfile creates or updates the caller's profile. The DTO carries
// raw strings/primitives; the use case parses them through the domain VOs
// and the entity re-validates before persistence. On any validation failure
// the repository is never invoked (defense-in-depth: the HTTP layer maps
// the error to 400 with a clean message).
func (s *CandidateService) UpsertMyProfile(ctx context.Context, cognitoSub string, params dtos.UpsertMyProfileDto) (*entities.CandidateProfile, error) {
	userID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}

	// Normalize skills at the use-case edge so the canonical list is the
	// same shape the entity would produce; the entity will re-run the
	// normalization on its own copy (defensive duplication is cheap).
	skills, _ := entities.NormalizeAndAssignSkills(params.Skills)

	// Parse typed optional inputs through their VOs. Empty string is the
	// "leave NULL" signal — distinct from a non-nil pointer.
	input := entities.CandidateProfileInput{
		EducationLevel:       emptyAsBlank(params.EducationLevel),
		ExpectedSalaryPeriod: emptyAsBlank(params.ExpectedSalaryPeriod),
		Skills:               skills,
	}

	profile, err := entities.NewCandidateProfile(userID.String(), input)
	if err != nil {
		return nil, err
	}

	// Copy optional fields. We assign AFTER the factory so the use case
	// owns the optional vs required split, matching companies/createCompany.
	if params.Phone != nil {
		profile.Phone = params.Phone
	}
	if params.LinkedInURL != nil {
		profile.LinkedInURL = params.LinkedInURL
	}
	if params.PortfolioURL != nil {
		profile.PortfolioURL = params.PortfolioURL
	}
	if params.ProfessionalTitle != nil {
		profile.ProfessionalTitle = params.ProfessionalTitle
	}
	if params.CurrentCompany != nil {
		profile.CurrentCompany = params.CurrentCompany
	}
	if params.YearsOfExperience != nil {
		y := *params.YearsOfExperience
		profile.YearsOfExperience = &y
	}
	if params.ProfileSummary != nil {
		profile.ProfileSummary = params.ProfileSummary
	}
	if params.BirthDate != nil && *params.BirthDate != "" {
		parsed, err := time.Parse("2006-01-02", *params.BirthDate)
		if err != nil {
			return nil, err
		}
		profile.BirthDate = &parsed
	}
	if params.City != nil {
		profile.City = params.City
	}
	if params.Country != nil {
		profile.Country = params.Country
	}
	if params.FieldOfStudy != nil {
		profile.FieldOfStudy = params.FieldOfStudy
	}
	if params.CurrentSalaryGross != nil {
		v := *params.CurrentSalaryGross
		profile.CurrentSalaryGross = &v
	}
	if params.CurrentSalaryNet != nil {
		v := *params.CurrentSalaryNet
		profile.CurrentSalaryNet = &v
	}
	if params.ExpectedSalary != nil {
		v := *params.ExpectedSalary
		profile.ExpectedSalary = &v
	}
	if params.SalaryCurrency != nil && *params.SalaryCurrency != "" {
		profile.SalaryCurrency = *params.SalaryCurrency
	}
	if params.CVS3Key != nil {
		profile.CVS3Key = params.CVS3Key
	}

	return s.repository.UpsertProfile(ctx, profile)
}

// emptyAsBlank turns a non-nil pointer whose value is "" into the empty
// string the entity factory uses as the "not set" signal. nil pointers
// stay nil so we can distinguish "field omitted" from "field sent as ”".
func emptyAsBlank(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
