package entities

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
)

// TestNewCandidateProfile_RequiredFieldsOnly proves the spec scenario
// "PUT creates on first call": an authenticated user with no profile row
// supplies a valid body and the factory returns a non-nil profile with
// sensible defaults.
func TestNewCandidateProfile_RequiredFieldsOnly(t *testing.T) {
	skills, _ := NormalizeAndAssignSkills(nil)
	profile, err := NewCandidateProfile("user-123", CandidateProfileInput{
		Skills: skills,
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if profile == nil {
		t.Fatal("expected non-nil profile")
	}
	if profile.UserID != "user-123" {
		t.Errorf("UserID: want user-123, got %q", profile.UserID)
	}
	// Skills default to empty slice (not nil) so the JSON wire is "[]" not "null".
	if profile.Skills == nil {
		t.Error("expected non-nil Skills")
	}
	if len(profile.Skills) != 0 {
		t.Errorf("expected empty Skills, got %v", profile.Skills)
	}
	// Currency defaults to MXN.
	if profile.SalaryCurrency != "MXN" {
		t.Errorf("SalaryCurrency: want MXN, got %q", profile.SalaryCurrency)
	}
	// Timestamps must be non-zero UTC.
	if profile.CreatedAt.IsZero() {
		t.Error("CreatedAt must be set")
	}
	if profile.CreatedAt.Location() != time.UTC {
		t.Errorf("CreatedAt location: want UTC, got %v", profile.CreatedAt.Location())
	}
}

// TestNewCandidateProfile_SkillsNormalizedOnBuild covers the spec scenario
// "skills are lowercased on write": callers pass raw user input, the entity
// returns the canonical lowercase form.
func TestNewCandidateProfile_SkillsNormalizedOnBuild(t *testing.T) {
	skills, _ := NormalizeAndAssignSkills([]string{"Go", "AWS", "React"})
	profile, err := NewCandidateProfile("user-123", CandidateProfileInput{Skills: skills})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	want := []string{"go", "aws", "react"}
	if !reflect.DeepEqual(profile.Skills, want) {
		t.Errorf("Skills: want %v, got %v", want, profile.Skills)
	}
}

// TestNewCandidateProfile_DropsEmptyAndDuplicateSkills triangulates: an
// input with whitespace-only entries and duplicates collapses to the
// canonical set without losing order.
func TestNewCandidateProfile_DropsEmptyAndDuplicateSkills(t *testing.T) {
	skills, _ := NormalizeAndAssignSkills([]string{"Go", "  ", "go", "AWS"})
	profile, err := NewCandidateProfile("user-123", CandidateProfileInput{Skills: skills})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	want := []string{"go", "aws"}
	if !reflect.DeepEqual(profile.Skills, want) {
		t.Errorf("Skills: want %v, got %v", want, profile.Skills)
	}
}

// TestNewCandidateProfile_RejectsInvalidEducationLevel covers the spec
// scenario "invalid education_level is rejected". The HTTP layer must
// surface a 400 with the same sentinel the use case returns.
func TestNewCandidateProfile_RejectsInvalidEducationLevel(t *testing.T) {
	_, err := NewCandidateProfile("user-123", CandidateProfileInput{
		EducationLevel: "vocational",
		Skills:         []string{},
	})
	if err == nil {
		t.Fatal("expected error for invalid education level, got nil")
	}
	if !errors.Is(err, valueobjects.ErrInvalidEducationLevel) {
		t.Errorf("expected ErrInvalidEducationLevel, got: %v", err)
	}
}

// TestNewCandidateProfile_RejectsInvalidSalaryPeriod covers the spec
// scenario "invalid salary_period is rejected".
func TestNewCandidateProfile_RejectsInvalidSalaryPeriod(t *testing.T) {
	_, err := NewCandidateProfile("user-123", CandidateProfileInput{
		ExpectedSalaryPeriod: "weekly",
		Skills:               []string{},
	})
	if err == nil {
		t.Fatal("expected error for invalid salary period, got nil")
	}
	if !errors.Is(err, valueobjects.ErrInvalidSalaryPeriod) {
		t.Errorf("expected ErrInvalidSalaryPeriod, got: %v", err)
	}
}

// TestNewCandidateProfile_EmptyUserIDIsRejected protects against the
// accidental "empty subject → orphan profile" foot-gun: the use case edge
// always has a resolved user_id, so the entity assumes a non-empty input.
func TestNewCandidateProfile_EmptyUserIDIsRejected(t *testing.T) {
	_, err := NewCandidateProfile("   ", CandidateProfileInput{Skills: []string{}})
	if !errors.Is(err, ErrEmptyUserIDForProfile) {
		t.Errorf("expected ErrEmptyUserIDForProfile, got: %v", err)
	}
}

// TestNewCandidateProfile_DuplicateLanguageRejected covers the spec
// scenario "duplicate language in payload is rejected" at the entity layer:
// the use case pre-flattens the DTO, but the entity is the last guard so
// the language validation lives next to the language type.
func TestNewCandidateProfile_DuplicateLanguageRejected(t *testing.T) {
	english := Language{Name: "english", Level: valueobjects.B1}
	_, err := NewCandidateProfile("user-123", CandidateProfileInput{
		Skills:    []string{},
		Languages: []Language{english, english},
	})
	if !errors.Is(err, ErrDuplicateLanguage) {
		t.Errorf("expected ErrDuplicateLanguage, got: %v", err)
	}
}

// TestNewCandidateProfile_InvalidCefrLevelRejected covers the spec scenario
// "invalid CEFR level is rejected" at the entity layer.
func TestNewCandidateProfile_InvalidCefrLevelRejected(t *testing.T) {
	_, err := NewCandidateProfile("user-123", CandidateProfileInput{
		Skills: []string{},
		Languages: []Language{
			{Name: "english", Level: valueobjects.UnknownCefrLevel},
		},
	})
	if !errors.Is(err, valueobjects.ErrInvalidCefrLevel) {
		t.Errorf("expected ErrInvalidCefrLevel, got: %v", err)
	}
}

// TestNormalizeAndAssignSkills_TrimAndDedup is a thin sanity check that the
// helper used by the HTTP/use-case layer produces the same canonical form
// the entity uses internally. Triangulation: a value with both mixed-case
// and whitespace produces the same single canonical entry.
func TestNormalizeAndAssignSkills_TrimAndDedup(t *testing.T) {
	got, err := NormalizeAndAssignSkills([]string{"  GO  ", "go", "Go "})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(got, []string{"go"}) {
		t.Errorf("want [go], got %v", got)
	}
}
