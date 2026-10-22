package usecases

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	sharedvo "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
)

// ErrInvalidBirthDate is returned when birth_date does not parse as
// YYYY-MM-DD. It wraps the raw parse error so the HTTP layer maps it to
// 400 with a readable validation message instead of a 500.
var ErrInvalidBirthDate = errors.New("invalid birth_date")

// ProfileWriteResult carries the persisted profile and the location expanded
// before persistence. Transports must use this prepared shape, not re-read the
// catalog after the write has committed.
type ProfileWriteResult struct {
	*entities.CandidateProfile
	LocationRead *geo.ReadLocation
}

// UpsertMyProfile creates or replaces the caller's profile. PUT has
// full-replacement semantics: a fresh profile entity is built from the
// DTO, so an omitted or JSON-null optional field persists as SQL NULL
// (there is no PATCH-style "leave unchanged" tri-state). The DTO carries
// raw strings/primitives; the use case parses them through the domain VOs
// and the entity re-validates before persistence. On any validation
// failure the repository is never invoked (defense-in-depth: the HTTP
// layer maps the error to 400 with a clean message).
func (s *CandidateService) UpsertMyProfile(ctx context.Context, cognitoSub string, params dtos.UpsertMyProfileDto) (*ProfileWriteResult, error) {
	userID, err := s.resolveUserID(ctx, cognitoSub)
	if err != nil {
		return nil, err
	}

	phone, phoneErr := validateProfilePhone(params.Phone)
	years, seniority, education, err := ValidateProfileFields(params.YearsOfExperience, params.Seniority, params.Education)
	var fieldErrs *ValidationError
	if err != nil && !errors.As(err, &fieldErrs) {
		return nil, err
	}
	if phoneErr != nil {
		if fieldErrs == nil {
			fieldErrs = &ValidationError{}
		}
		fieldErrs.Fields = append([]FieldError{*phoneErr}, fieldErrs.Fields...)
	}
	if fieldErrs != nil {
		return nil, fieldErrs
	}
	if err := geo.ValidateLocation(ctx, s.geography, params.Location, false); err != nil {
		return nil, err
	}

	// Normalize skills at the use-case edge so the canonical list is the
	// same shape the entity would produce; the entity will re-run the
	// normalization on its own copy (defensive duplication is cheap).
	skills, _ := entities.NormalizeAndAssignSkills(params.Skills)

	// Parse typed optional inputs through their VOs. Empty string is the
	// "leave NULL" signal — distinct from a non-nil pointer.
	input := entities.CandidateProfileInput{
		ExpectedSalaryPeriod: emptyAsBlank(params.ExpectedSalaryPeriod),
		Skills:               skills,
	}

	profile, err := entities.NewCandidateProfile(userID.String(), input)
	if err != nil {
		return nil, err
	}

	// Copy optional fields. We assign AFTER the factory so the use case
	// owns the optional vs required split, matching companies/createCompany.
	profile.Phone = phone
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
	profile.YearsOfExperience = years
	profile.Seniority = seniority
	profile.Education = education
	if params.ProfileSummary != nil {
		profile.ProfileSummary = params.ProfileSummary
	}
	if params.BirthDate != nil && *params.BirthDate != "" {
		parsed, err := time.Parse("2006-01-02", *params.BirthDate)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidBirthDate, err)
		}
		profile.BirthDate = &parsed
	}
	profile.Location = params.Location.Value()
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

	// CVS3Key is deliberately not copied: the reserved column has no
	// candidate-API write path, so a preexisting reserved value can never
	// be overwritten through the upsert.

	location, err := s.ReadLocation(ctx, profile.Location)
	if err != nil {
		return nil, err
	}
	persisted, err := s.repository.UpsertProfile(ctx, profile)
	if err != nil {
		return nil, err
	}
	return &ProfileWriteResult{CandidateProfile: persisted, LocationRead: location}, nil
}

// validateProfilePhone applies the manual-intake E.164 rule (sharedvo.NewPhone)
// to the profile phone. nil and "" clear the phone; any other value must be
// exact E.164, with no whitespace or separator normalization.
func validateProfilePhone(raw *string) (*string, *FieldError) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	if _, err := sharedvo.NewPhone(*raw); err != nil {
		return nil, &FieldError{Field: "phone", Code: "invalid"}
	}
	phone := *raw
	return &phone, nil
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
