// Package dtos defines the input shapes the candidates HTTP boundary hands
// to the application layer. Values stay as raw strings/primitives so the
// use case owns parsing and validation through the domain VOs.
package dtos

// UpsertMyProfileDto is the PUT /me/profile body. Every field is optional;
// nil means "leave unchanged on update" / "leave NULL on insert". Skills is
// normalized (lowercase, trimmed, deduped) inside the use case.
type UpsertMyProfileDto struct {
	Phone             *string
	LinkedInURL       *string
	PortfolioURL      *string
	ProfessionalTitle *string
	CurrentCompany    *string
	YearsOfExperience *int
	ProfileSummary    *string

	BirthDate *string // ISO-8601 (YYYY-MM-DD); parsed by the use case.

	City    *string
	Country *string

	EducationLevel *string // validated by valueobjects.ParseEducationLevel
	FieldOfStudy   *string

	Skills []string

	CurrentSalaryGross   *int
	CurrentSalaryNet     *int
	ExpectedSalary       *int
	SalaryCurrency       *string
	ExpectedSalaryPeriod *string // validated by valueobjects.ParseSalaryPeriod

	CVS3Key *string
}

// LanguageDto is a single language entry on PUT /me/profile/languages. The
// Level is a raw string the use case validates via valueobjects.ParseCefrLevel.
type LanguageDto struct {
	Name  string
	Level string
}

// ReplaceMyLanguagesDto is the PUT /me/profile/languages body. The full
// list replaces the stored rows atomically; an empty Languages slice
// clears the user's languages.
type ReplaceMyLanguagesDto struct {
	Languages []LanguageDto
}
