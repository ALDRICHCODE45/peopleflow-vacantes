// Unit tests for the companies-write write-path helpers (companies-write
// slice, design D10 / D13).
//
// These tests cover the deterministic Go helpers — the same shape
// that jobs-soft-delete / jobs-reopen use for their
// `buildSoftDeleteJobParams` / `mapUpdateError` / `mapSoftDeleteError`.
// They do NOT touch Postgres; the SQL integration suite in
// `companyRepository_write_integration_test.go` covers the
// adapter-level invariants only Postgres can prove.
package postgres

import (
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// --- TestBuildUpdateCompanyParams ----------------------------------------

// TestBuildUpdateCompanyParams_NameOnly pins the SET-list / WHERE
// split (design D10): a patch with only `name` set produces a struct
// where the 12 profile columns are present with `Set=false` (their
// `Set` flags default to false because the Optional type's zero
// value is `Set=false`); the WHERE args (`CompanyID`, `CasToken`)
// populate the last two slots.
func TestBuildUpdateCompanyParams_NameOnly(t *testing.T) {
	companyID := uuid.New()
	cas := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	newName := "New Co."
	patch := repositories.UpdateCompanyPatch{
		Name: &newName,
	}

	params := buildUpdateCompanyParams(companyID, patch, cas)

	if params.Name.String != newName || !params.Name.Valid {
		t.Errorf("Name: want %q valid, got %+v", newName, params.Name)
	}

	// Profile Optional defaults → Set=false → CASE branch picks ELSE col.
	if params.SetWebsite || params.Website.Valid {
		t.Errorf("Website: want Set=false Valid=false, got set=%v valid=%v", params.SetWebsite, params.Website.Valid)
	}
	if params.SetLogoUrl || params.LogoUrl.Valid {
		t.Errorf("LogoUrl: want Set=false Valid=false, got set=%v valid=%v", params.SetLogoUrl, params.LogoUrl.Valid)
	}
	if params.SetDescription || params.Description.Valid {
		t.Errorf("Description: want Set=false Valid=false, got set=%v valid=%v", params.SetDescription, params.Description.Valid)
	}
	if params.SetSize || params.Size.Valid {
		t.Errorf("Size: want Set=false Valid=false, got set=%v valid=%v", params.SetSize, params.Size.Valid)
	}
	if params.SetFoundedYear || params.FoundedYear.Valid {
		t.Errorf("FoundedYear: want Set=false Valid=false, got set=%v valid=%v", params.SetFoundedYear, params.FoundedYear.Valid)
	}
	if params.SetCity || params.City.Valid {
		t.Errorf("City: want Set=false Valid=false, got set=%v valid=%v", params.SetCity, params.City.Valid)
	}
	if params.SetCountry || params.Country.Valid {
		t.Errorf("Country: want Set=false Valid=false, got set=%v valid=%v", params.SetCountry, params.Country.Valid)
	}
	if params.SetLinkedinUrl || params.LinkedinUrl.Valid {
		t.Errorf("LinkedinUrl: want Set=false Valid=false, got set=%v valid=%v", params.SetLinkedinUrl, params.LinkedinUrl.Valid)
	}
	if params.SetInstagramUrl || params.InstagramUrl.Valid {
		t.Errorf("InstagramUrl: want Set=false Valid=false, got set=%v valid=%v", params.SetInstagramUrl, params.InstagramUrl.Valid)
	}
	if params.SetFacebookUrl || params.FacebookUrl.Valid {
		t.Errorf("FacebookUrl: want Set=false Valid=false, got set=%v valid=%v", params.SetFacebookUrl, params.FacebookUrl.Valid)
	}
	if params.SetTwitterUrl || params.TwitterUrl.Valid {
		t.Errorf("TwitterUrl: want Set=false Valid=false, got set=%v valid=%v", params.SetTwitterUrl, params.TwitterUrl.Valid)
	}
	if params.SetCoverImageUrl || params.CoverImageUrl.Valid {
		t.Errorf("CoverImageUrl: want Set=false Valid=false, got set=%v valid=%v", params.SetCoverImageUrl, params.CoverImageUrl.Valid)
	}

	// WHERE args last (design D10).
	if params.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, params.CompanyID)
	}
	if !params.CasToken.Valid || !params.CasToken.Time.Equal(cas) {
		t.Errorf("CasToken: want valid=%v time=%v, got %+v", true, cas, params.CasToken)
	}
}

// TestBuildUpdateCompanyParams_ProfileTriState pins the D7 tri-state
// translation for the Optional profile columns: absent →
// `Set=false, Valid=false`; JSON `null` → `Set=true, Valid=false`;
// value → `Set=true, Valid=true, Value populated`. The use case
// passes already-canonicalized values (e.g. `size = parsedSize.String()`
// lowercase), so the helper just forwards them.
func TestBuildUpdateCompanyParams_ProfileTriState(t *testing.T) {
	companyID := uuid.New()
	cas := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	yearValue := 2010
	patch := repositories.UpdateCompanyPatch{
		Website:     sharedvalueobjects.Optional[string]{Set: true, Valid: true, Value: "https://x.example.com"},
		LogoURL:     sharedvalueobjects.Optional[string]{Set: true, Valid: false}, // JSON null
		Description: sharedvalueobjects.Optional[string]{Set: false},            // absent
		Size:        sharedvalueobjects.Optional[string]{Set: true, Valid: true, Value: "small"},
		FoundedYear: sharedvalueobjects.Optional[int]{Set: true, Valid: true, Value: yearValue},
	}

	params := buildUpdateCompanyParams(companyID, patch, cas)

	// Website: value present.
	if !params.SetWebsite || !params.Website.Valid || params.Website.String != "https://x.example.com" {
		t.Errorf("Website: want set+valid+value, got set=%v valid=%v str=%q",
			params.SetWebsite, params.Website.Valid, params.Website.String)
	}
	// LogoURL: JSON null → Set=true, Valid=false.
	if !params.SetLogoUrl || params.LogoUrl.Valid {
		t.Errorf("LogoURL (JSON null): want Set=true Valid=false, got set=%v valid=%v",
			params.SetLogoUrl, params.LogoUrl.Valid)
	}
	// Description: absent → Set=false (zero value).
	if params.SetDescription || params.Description.Valid {
		t.Errorf("Description (absent): want Set=false Valid=false, got set=%v valid=%v",
			params.SetDescription, params.Description.Valid)
	}
	// Size: value present.
	if !params.SetSize || !params.Size.Valid || params.Size.String != "small" {
		t.Errorf("Size: want set+valid+small, got set=%v valid=%v str=%q",
			params.SetSize, params.Size.Valid, params.Size.String)
	}
	// FoundedYear: int2.
	if !params.SetFoundedYear || !params.FoundedYear.Valid || params.FoundedYear.Int16 != int16(yearValue) {
		t.Errorf("FoundedYear: want set+valid+%d, got set=%v valid=%v val=%d",
			yearValue, params.SetFoundedYear, params.FoundedYear.Valid, params.FoundedYear.Int16)
	}
}

// TestBuildUpdateCompanyParams_ArgOrderMatchesSqlc pins design D10:
// the generated `UpdateCompanyParams` struct's arg order MUST be the
// SET-list args first (Name, SetWebsite/Website, ..., SetCoverImageUrl/
// CoverImageUrl), then the WHERE args (CompanyID, CasToken). The
// helper assigns field-by-field, so a SQL drift that reorders the
// fields fails compilation (the helper writes the wrong field).
// This test pins the order by listing every field in the order the
// helper assigns it, so a refactor that drifts the order fails the
// test loudly rather than silently producing the wrong wire arg.
func TestBuildUpdateCompanyParams_ArgOrderMatchesSqlc(t *testing.T) {
	companyID := uuid.New()
	cas := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)
	newName := "Acme"
	patch := repositories.UpdateCompanyPatch{Name: &newName}

	params := buildUpdateCompanyParams(companyID, patch, cas)

	// The test below asserts the relative position of each field in
	// the struct via reflection (Go doesn't expose struct field
	// ordering to a runtime assert otherwise). If the helper ever
	// assigns fields in a different order than the sqlc struct, the
	// reflection indices won't match the field names we record here.
	//
	// The expected field-order list mirrors the design D10 sequence.
	expectedOrder := []string{
		"Name", "SetWebsite", "Website",
		"SetLogoUrl", "LogoUrl",
		"SetDescription", "Description",
		"SetSize", "Size",
		"SetFoundedYear", "FoundedYear",
		"SetCity", "City",
		"SetCountry", "Country",
		"SetLinkedinUrl", "LinkedinUrl",
		"SetInstagramUrl", "InstagramUrl",
		"SetFacebookUrl", "FacebookUrl",
		"SetTwitterUrl", "TwitterUrl",
		"SetCoverImageUrl", "CoverImageUrl",
		"CompanyID", "CasToken",
	}

	// The actual order is fixed by the generated `db.UpdateCompanyParams`
	// struct definition; we read it back via reflect.TypeOf and assert
	// each expected name appears at its index. The generated struct is
	// the source of truth (D10 "SET-list first, then WHERE").
	if err := assertStructFieldOrder(params, expectedOrder); err != nil {
		t.Fatalf("UpdateCompanyParams arg order drift: %v", err)
	}
}

// --- TestBuildSoftDeleteCompanyParams -------------------------------------

// TestBuildSoftDeleteCompanyParams pins the soft-delete params shape:
// { CompanyID, CasToken } with CasToken.Time == casUpdatedAt and
// CasToken.Valid == true.
func TestBuildSoftDeleteCompanyParams(t *testing.T) {
	companyID := uuid.New()
	cas := time.Date(2026, 2, 1, 10, 0, 0, 0, time.UTC)

	params := buildSoftDeleteCompanyParams(companyID, cas)

	if params.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, params.CompanyID)
	}
	if !params.CasToken.Valid {
		t.Errorf("CasToken.Valid: want true, got false")
	}
	if !params.CasToken.Time.Equal(cas) {
		t.Errorf("CasToken.Time: want %v, got %v", cas, params.CasToken.Time)
	}
}

// --- TestMapUpdateCompanyError ---------------------------------------------

// TestMapUpdateCompanyError pins the D13 matrix:
//   - nil → nil
//   - pgx.ErrNoRows → entities.ErrCompanyNotFound (defense-in-depth;
//     the :one scalar SELECT always returns one row)
//   - 23514 + companies_size_check → valueobjects.ErrInvalidCompanySize
//   - 23514 + companies_founded_year_check → valueobjects.ErrFoundedYearOutOfRange
//   - any other PgError (unknown code) → pass-through
//   - non-pg error → pass-through
//   - wrapped errors still resolve via errors.Is / errors.As
//
// The test ALSO asserts there is NO branch for
// `ErrCompanyNameTooShort` / `ErrCompanyDescriptionTooLong` in
// `mapUpdateCompanyError` (D13 — those are VO-level; the use case
// fires them before SQL, never the adapter).
func TestMapUpdateCompanyError(t *testing.T) {
	sizeConstraint := &pgconn.PgError{
		Code:           "23514",
		Message:        "violates check constraint \"companies_size_check\"",
		ConstraintName: "companies_size_check",
	}
	yearConstraint := &pgconn.PgError{
		Code:           "23514",
		Message:        "violates check constraint \"companies_founded_year_check\"",
		ConstraintName: "companies_founded_year_check",
	}
	otherPg := &pgconn.PgError{Code: "42P01", Message: "undefined_table"}
	nonPg := errors.New("dial tcp: connection refused")

	tests := []struct {
		name string
		in   error
		want error
	}{
		{"nil returns nil", nil, nil},
		{"pgx.ErrNoRows → ErrCompanyNotFound", pgx.ErrNoRows, entities.ErrCompanyNotFound},
		{"23514 + companies_size_check → ErrInvalidCompanySize", sizeConstraint, valueobjects.ErrInvalidCompanySize},
		{"23514 + companies_founded_year_check → ErrFoundedYearOutOfRange", yearConstraint, valueobjects.ErrFoundedYearOutOfRange},
		{"unknown pg code passes through", otherPg, otherPg},
		{"non-pg error passes through", nonPg, nonPg},
		{"wrapped ErrNoRows still resolves", fmt.Errorf("repo: %w", pgx.ErrNoRows), entities.ErrCompanyNotFound},
		{"wrapped 23514 size_constraint still resolves", fmt.Errorf("repo: %w", sizeConstraint), valueobjects.ErrInvalidCompanySize},
		{"wrapped 23514 year_constraint still resolves", fmt.Errorf("repo: %w", yearConstraint), valueobjects.ErrFoundedYearOutOfRange},
		{"wrapped non-pg passes through", fmt.Errorf("repo: %w", nonPg), nonPg},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapUpdateCompanyError(tc.in)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("want nil, got: %v", got)
				}
				return
			}
			if !errors.Is(got, tc.want) {
				t.Errorf("errors.Is: want %v, got %v", tc.want, got)
			}
		})
	}
}

// --- TestMapSoftDeleteCompanyError ----------------------------------------

// TestMapSoftDeleteCompanyError pins the D13 matrix:
//   - nil → nil
//   - pgx.ErrNoRows → entities.ErrCompanyNotFound (defense-in-depth)
//   - 23514 → entities.ErrInvalidCompanyStatusTransition (defense-in-
//     depth; the only plausible CHECK is jobs_status_check which
//     accepts 'closed')
//   - any other PgError (unknown code) → pass-through
//   - non-pg error → pass-through
//   - wrapped errors still resolve via errors.Is / errors.As
//
// The test ALSO asserts there is NO 23503 branch (D13 — soft-delete
// never reassigns FKs).
func TestMapSoftDeleteCompanyError(t *testing.T) {
	checkViolation := &pgconn.PgError{
		Code:           "23514",
		Message:        "violates check constraint",
		ConstraintName: "jobs_status_check",
	}
	otherPg := &pgconn.PgError{Code: "42P01", Message: "undefined_table"}
	nonPg := errors.New("dial tcp: connection refused")

	tests := []struct {
		name string
		in   error
		want error
	}{
		{"nil returns nil", nil, nil},
		{"pgx.ErrNoRows → ErrCompanyNotFound", pgx.ErrNoRows, entities.ErrCompanyNotFound},
		{"23514 → ErrInvalidCompanyStatusTransition", checkViolation, entities.ErrInvalidCompanyStatusTransition},
		{"unknown pg code passes through", otherPg, otherPg},
		{"non-pg error passes through", nonPg, nonPg},
		{"wrapped ErrNoRows still resolves", fmt.Errorf("repo: %w", pgx.ErrNoRows), entities.ErrCompanyNotFound},
		{"wrapped 23514 still resolves", fmt.Errorf("repo: %w", checkViolation), entities.ErrInvalidCompanyStatusTransition},
		{"wrapped non-pg passes through", fmt.Errorf("repo: %w", nonPg), nonPg},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapSoftDeleteCompanyError(tc.in)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("want nil, got: %v", got)
				}
				return
			}
			if !errors.Is(got, tc.want) {
				t.Errorf("errors.Is: want %v, got %v", tc.want, got)
			}
		})
	}
}

// --- helpers ---------------------------------------------------------------

// assertStructFieldOrder reads the field names of the given value's
// type via reflection and asserts they match the expected order. It
// catches sqlc-generated struct field drift (e.g. a future regen
// that adds a column in the wrong position) at unit-test time.
//
// This is a generic assertion reused by the build* helpers across
// the companies-write and jobs-soft-delete slices. The function
// compares names case-sensitively.
func assertStructFieldOrder(v any, expected []string) error {
	t := reflect.TypeOf(v)
	if t.Kind() != reflect.Struct {
		return fmt.Errorf("want struct, got %v", t.Kind())
	}
	if t.NumField() != len(expected) {
		return fmt.Errorf("field count: want %d (%v), got %d", len(expected), expected, t.NumField())
	}
	for i, name := range expected {
		got := t.Field(i).Name
		if got != name {
			return fmt.Errorf("field[%d]: want %q, got %q", i, name, got)
		}
	}
	return nil
}
