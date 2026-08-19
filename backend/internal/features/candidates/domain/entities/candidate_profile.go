// Package entities holds the candidates bounded-context domain entities.
// The aggregate root is CandidateProfile; Language is a child value object
// stored in candidate_languages and never referenced on its own.
package entities

import (
	"errors"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
)

// Sentinel errors. Each maps to exactly one HTTP status in the HTTP layer's
// classifyCandidateError, so the dispatch is a flat errors.Is chain.
var (
	// ErrEmptyUserIDForProfile protects against an accidental orphan-profile
	// foot-gun: the use case edge resolves cognito_sub → users.id and never
	// reaches the entity with an empty id, but the entity must refuse so the
	// invariant is enforced even if a future caller bypasses the use case.
	ErrEmptyUserIDForProfile = errors.New("candidate profile user_id is required")
	// ErrDuplicateLanguage is returned when the same language appears twice
	// in a Languages slice. The spec scenario "duplicate language in payload
	// is rejected" maps this to a 400.
	ErrDuplicateLanguage = errors.New("duplicate language in candidate profile")
	// ErrProfileNotFound is returned by the repository when no row exists
	// for the requested user_id. The HTTP layer maps this to 404 per the
	// "GET without a profile returns 404" scenario.
	ErrProfileNotFound = errors.New("candidate profile not found")
)

// Language pairs an ISO-style language name with a CEFR level. The level is
// a typed VO so the DB CHECK and the application validator never disagree.
type Language struct {
	Name  string
	Level valueobjects.CefrLevel
}

// CandidateProfileInput is the typed, pre-parsed shape the factory takes.
// The use case owns VO parsing (so the transport layer stays VO-free), and
// the entity owns re-validation (so the invariant holds even if a future
// caller skips the use case).
type CandidateProfileInput struct {
	// EducationLevel is a raw string the factory validates through the VO.
	// Empty string is treated as "not set" and the column is left NULL.
	EducationLevel string
	// ExpectedSalaryPeriod is a raw string the factory validates through
	// the VO. Empty string is treated as "not set".
	ExpectedSalaryPeriod string
	// Skills is the raw list — the factory calls NormalizeSkills so the
	// stored row matches what the GIN index will find.
	Skills []string
	// Languages is the list to write atomically in ReplaceLanguages.
	Languages []Language
}

// NormalizeAndAssignSkills is the helper the use case calls before
// constructing a CandidateProfileInput. It mirrors valueobjects.NormalizeSkills
// and exists here so the entity contract stays self-contained.
func NormalizeAndAssignSkills(in []string) ([]string, error) {
	return valueobjects.NormalizeSkills(in), nil
}

// CandidateProfile is the aggregate root. It carries the entire row's worth
// of typed fields; the postgres adapter maps to and from the sqlc row. PK is
// UserID (1:1 with users.id), so there is no surrogate UUID.
type CandidateProfile struct {
	UserID string

	// Optional contact / profile fields.
	Phone             *string
	LinkedInURL       *string
	PortfolioURL      *string
	ProfessionalTitle *string
	CurrentCompany    *string
	YearsOfExperience *int
	ProfileSummary    *string

	// Personal. BirthDate is intentionally nullable per §1.9.
	BirthDate *time.Time
	City      *string
	Country   *string

	// Education.
	EducationLevel *valueobjects.EducationLevel
	FieldOfStudy   *string

	// Skills is the canonical (normalized) form. The DB stores it verbatim
	// so the GIN index sees what the application wrote.
	Skills []string

	// Compensation.
	CurrentSalaryGross   *int
	CurrentSalaryNet     *int
	ExpectedSalary       *int
	SalaryCurrency       string
	ExpectedSalaryPeriod *valueobjects.SalaryPeriod

	// CV S3 key — populated when the candidate uploads a CV (out of scope
	// for this slice).
	CVS3Key *string

	CreatedAt time.Time
	UpdatedAt time.Time

	// Languages is the list of CEFR-typed child entities. The adapter
	// persists them via the atomic ReplaceLanguagesByUserID path.
	Languages []Language
}

// NewCandidateProfile is the factory. It validates all typed inputs and
// returns a profile ready for persistence. EducationLevel and
// ExpectedSalaryPeriod are validated through their VOs so the column-shape
// the entity carries matches the DB CHECK constraints.
//
// Skills are normalized here so the canonical list lives on the entity from
// day one. The HTTP boundary still runs the same normalize call before
// reaching the use case so error messages stay close to the user's input.
func NewCandidateProfile(userID string, in CandidateProfileInput) (*CandidateProfile, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, ErrEmptyUserIDForProfile
	}

	now := time.Now().UTC()

	profile := &CandidateProfile{
		UserID:         userID,
		Skills:         valueobjects.NormalizeSkills(in.Skills),
		SalaryCurrency: "MXN",
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	if in.EducationLevel != "" {
		lvl, err := valueobjects.ParseEducationLevel(in.EducationLevel)
		if err != nil {
			return nil, err
		}
		profile.EducationLevel = &lvl
	}

	if in.ExpectedSalaryPeriod != "" {
		period, err := valueobjects.ParseSalaryPeriod(in.ExpectedSalaryPeriod)
		if err != nil {
			return nil, err
		}
		profile.ExpectedSalaryPeriod = &period
	}

	if len(in.Languages) > 0 {
		languages, err := validateAndCopyLanguages(in.Languages)
		if err != nil {
			return nil, err
		}
		profile.Languages = languages
	}

	return profile, nil
}

// validateAndCopyLanguages enforces the spec invariant "the pair
// (user_id, language) SHALL be unique": duplicate names in the same payload
// are rejected at the entity so the HTTP layer can map to 400 without ever
// hitting the DB. Each entry's Level VO is also re-checked.
func validateAndCopyLanguages(in []Language) ([]Language, error) {
	seen := make(map[string]struct{}, len(in))
	out := make([]Language, 0, len(in))
	for _, l := range in {
		// Skip entries whose Level is the zero/unknown value — they
		// represent an unparseable input the use case should have caught,
		// but the entity is the last line of defense.
		if l.Level == valueobjects.UnknownCefrLevel {
			return nil, valueobjects.ErrInvalidCefrLevel
		}
		name := strings.ToLower(strings.TrimSpace(l.Name))
		if name == "" {
			return nil, valueobjects.ErrInvalidCefrLevel
		}
		if _, dup := seen[name]; dup {
			return nil, ErrDuplicateLanguage
		}
		seen[name] = struct{}{}
		out = append(out, Language{Name: name, Level: l.Level})
	}
	return out, nil
}
