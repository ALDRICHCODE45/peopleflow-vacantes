package postgres

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestToEntity_FullRow(t *testing.T) {
	id := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	now := time.Now().UTC()

	row := db.Company{
		ID:            id,
		Name:          "Acme SA de CV",
		Rfc:           "AAA010101AAA",
		IndustryID:    "tech",
		Website:       pgtype.Text{String: "https://acme.com", Valid: true},
		LogoUrl:       pgtype.Text{String: "https://acme.com/logo.png", Valid: true},
		Status:        "active",
		CreatedAt:     pgtype.Timestamptz{Time: now, Valid: true},
		UpdatedAt:     pgtype.Timestamptz{Time: now, Valid: true},
		DeletedAt:     pgtype.Timestamptz{Valid: false},
		Description:   pgtype.Text{String: "Líder en logística", Valid: true},
		Size:          pgtype.Text{String: "medium", Valid: true},
		FoundedYear:   pgtype.Int2{Int16: 2010, Valid: true},
		City:          pgtype.Text{String: "CDMX", Valid: true},
		Country:       pgtype.Text{String: "MX", Valid: true},
		LinkedinUrl:   pgtype.Text{String: "https://linkedin.com/company/acme", Valid: true},
		InstagramUrl:  pgtype.Text{String: "https://instagram.com/acme", Valid: true},
		FacebookUrl:   pgtype.Text{String: "https://facebook.com/acme", Valid: true},
		TwitterUrl:    pgtype.Text{String: "https://twitter.com/acme", Valid: true},
		CoverImageUrl: pgtype.Text{String: "https://acme.com/cover.jpg", Valid: true},
	}

	got, err := toEntity(row)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.Status != valueobjects.Active {
		t.Errorf("Status: want Active, got %v", got.Status)
	}
	if got.Website == nil || *got.Website != "https://acme.com" {
		t.Errorf("Website: want https://acme.com, got %v", got.Website)
	}
	if got.Description == nil || got.Description.Value() != "Líder en logística" {
		t.Errorf("Description: want VO with value %q, got %+v", "Líder en logística", got.Description)
	}
	if got.Size == nil || *got.Size != valueobjects.MediumSize {
		t.Errorf("Size: want MediumSize, got %+v", got.Size)
	}
	if got.FoundedYear == nil || got.FoundedYear.Value() != 2010 {
		t.Errorf("FoundedYear: want 2010, got %+v", got.FoundedYear)
	}
	if got.City == nil || *got.City != "CDMX" {
		t.Errorf("City: want CDMX, got %v", got.City)
	}
	if got.Country == nil || *got.Country != "MX" {
		t.Errorf("Country: want MX, got %v", got.Country)
	}
	if got.LinkedInURL == nil || *got.LinkedInURL != "https://linkedin.com/company/acme" {
		t.Errorf("LinkedInURL: %v", got.LinkedInURL)
	}
	if got.InstagramURL == nil || *got.InstagramURL != "https://instagram.com/acme" {
		t.Errorf("InstagramURL: %v", got.InstagramURL)
	}
	if got.FacebookURL == nil || *got.FacebookURL != "https://facebook.com/acme" {
		t.Errorf("FacebookURL: %v", got.FacebookURL)
	}
	if got.TwitterURL == nil || *got.TwitterURL != "https://twitter.com/acme" {
		t.Errorf("TwitterURL: %v", got.TwitterURL)
	}
	if got.CoverImageURL == nil || *got.CoverImageURL != "https://acme.com/cover.jpg" {
		t.Errorf("CoverImageURL: %v", got.CoverImageURL)
	}
}

func TestToEntity_NullableFieldsUnset(t *testing.T) {
	id := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	now := time.Now().UTC()

	row := db.Company{
		ID:            id,
		Name:          "Minimal SA",
		Rfc:           "BBB020202BBB",
		IndustryID:    "tech",
		Website:       pgtype.Text{Valid: false},
		LogoUrl:       pgtype.Text{Valid: false},
		Status:        "pending_verification",
		CreatedAt:     pgtype.Timestamptz{Time: now, Valid: true},
		UpdatedAt:     pgtype.Timestamptz{Time: now, Valid: true},
		DeletedAt:     pgtype.Timestamptz{Valid: false},
		Description:   pgtype.Text{Valid: false},
		Size:          pgtype.Text{Valid: false},
		FoundedYear:   pgtype.Int2{Valid: false},
		City:          pgtype.Text{Valid: false},
		Country:       pgtype.Text{Valid: false},
		LinkedinUrl:   pgtype.Text{Valid: false},
		InstagramUrl:  pgtype.Text{Valid: false},
		FacebookUrl:   pgtype.Text{Valid: false},
		TwitterUrl:    pgtype.Text{Valid: false},
		CoverImageUrl: pgtype.Text{Valid: false},
	}

	got, err := toEntity(row)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}

	if got.Website != nil {
		t.Errorf("Website: want nil, got %v", got.Website)
	}
	if got.LogoURL != nil {
		t.Errorf("LogoURL: want nil, got %v", got.LogoURL)
	}
	if got.Description != nil {
		t.Errorf("Description: want nil, got %+v", got.Description)
	}
	if got.Size != nil {
		t.Errorf("Size: want nil, got %+v", got.Size)
	}
	if got.FoundedYear != nil {
		t.Errorf("FoundedYear: want nil, got %+v", got.FoundedYear)
	}
	if got.City != nil || got.Country != nil {
		t.Errorf("City/Country: want nil, got city=%v country=%v", got.City, got.Country)
	}
	if got.LinkedInURL != nil || got.InstagramURL != nil || got.FacebookURL != nil || got.TwitterURL != nil {
		t.Errorf("Social URLs: want all nil, got linkedin=%v instagram=%v facebook=%v twitter=%v",
			got.LinkedInURL, got.InstagramURL, got.FacebookURL, got.TwitterURL)
	}
	if got.CoverImageURL != nil {
		t.Errorf("CoverImageURL: want nil, got %v", got.CoverImageURL)
	}
}

func TestToEntity_InvalidStatus(t *testing.T) {
	row := db.Company{
		ID:         uuid.New(),
		Name:       "Foo Bar Inc",
		Rfc:        "CCC030303CCC",
		IndustryID: "tech",
		Status:     "totally_made_up",
		CreatedAt:  pgtype.Timestamptz{Valid: true},
		UpdatedAt:  pgtype.Timestamptz{Valid: true},
	}

	_, err := toEntity(row)
	if err == nil {
		t.Fatal("expected error for invalid status, got nil")
	}
	if err != valueobjects.ErrInvalidCompanyStatus {
		t.Errorf("expected ErrInvalidCompanyStatus, got: %v", err)
	}
}

func TestBuildCreateParams_FullEntity(t *testing.T) {
	web := "https://acme.com"
	logo := "https://acme.com/logo.png"
	city := "CDMX"
	country := "MX"
	linkedin := "https://linkedin.com/company/acme"
	instagram := "https://instagram.com/acme"
	facebook := "https://facebook.com/acme"
	twitter := "https://twitter.com/acme"
	cover := "https://acme.com/cover.jpg"
	desc, _ := valueobjects.NewCompanyDescription("Líder en logística")
	size := valueobjects.LargeSize
	year, _ := valueobjects.NewFoundedYear(1999)

	c := &entities.Company{
		ID:            uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		Name:          valueobjects.CompanyName{},
		Rfc:           valueobjects.CompanyRfc{},
		Status:        valueobjects.Active,
		IndustryID:    "tech",
		Website:       &web,
		LogoURL:       &logo,
		Description:   &desc,
		Size:          &size,
		FoundedYear:   &year,
		City:          &city,
		Country:       &country,
		LinkedInURL:   &linkedin,
		InstagramURL:  &instagram,
		FacebookURL:   &facebook,
		TwitterURL:    &twitter,
		CoverImageURL: &cover,
	}
	// The factory would populate Name/Rfc/Description here; we override after the fact for this test.
	name, _ := valueobjects.NewCompanyName("Acme SA de CV")
	rfc, _ := valueobjects.NewCompanyRfc("AAA010101AAA")
	c.Name = name
	c.Rfc = rfc

	params := buildCreateParams(c)

	if params.ID != c.ID {
		t.Errorf("ID: want %v, got %v", c.ID, params.ID)
	}
	if params.Name != "Acme SA de CV" {
		t.Errorf("Name: %q", params.Name)
	}
	if params.Rfc != "AAA010101AAA" {
		t.Errorf("Rfc: %q", params.Rfc)
	}
	if !params.Website.Valid || params.Website.String != web {
		t.Errorf("Website: %+v", params.Website)
	}
	if !params.LogoUrl.Valid || params.LogoUrl.String != logo {
		t.Errorf("LogoUrl: %+v", params.LogoUrl)
	}
	if !params.Description.Valid || params.Description.String != "Líder en logística" {
		t.Errorf("Description: %+v", params.Description)
	}
	if !params.Size.Valid || params.Size.String != "large" {
		t.Errorf("Size: %+v (want large)", params.Size)
	}
	if !params.FoundedYear.Valid || params.FoundedYear.Int16 != 1999 {
		t.Errorf("FoundedYear: %+v (want 1999)", params.FoundedYear)
	}
	if !params.City.Valid || params.City.String != "CDMX" {
		t.Errorf("City: %+v", params.City)
	}
	if !params.Country.Valid || params.Country.String != "MX" {
		t.Errorf("Country: %+v", params.Country)
	}
	if !params.LinkedinUrl.Valid {
		t.Errorf("LinkedinUrl.Valid: false")
	}
	if !params.InstagramUrl.Valid {
		t.Errorf("InstagramUrl.Valid: false")
	}
	if !params.FacebookUrl.Valid {
		t.Errorf("FacebookUrl.Valid: false")
	}
	if !params.TwitterUrl.Valid {
		t.Errorf("TwitterUrl.Valid: false")
	}
	if !params.CoverImageUrl.Valid {
		t.Errorf("CoverImageUrl.Valid: false")
	}
}

func TestBuildCreateParams_NilProfileFields(t *testing.T) {
	c := &entities.Company{
		ID:         uuid.New(),
		Name:       valueobjects.CompanyName{},
		Rfc:        valueobjects.CompanyRfc{},
		IndustryID: "tech",
	}

	params := buildCreateParams(c)

	// Each optional field, when nil on the entity, must produce an invalid pgtype (SQL NULL).
	if params.Website.Valid {
		t.Errorf("Website: want invalid (NULL), got %+v", params.Website)
	}
	if params.LogoUrl.Valid {
		t.Errorf("LogoUrl: want invalid, got %+v", params.LogoUrl)
	}
	if params.Description.Valid {
		t.Errorf("Description: want invalid, got %+v", params.Description)
	}
	if params.Size.Valid {
		t.Errorf("Size: want invalid, got %+v", params.Size)
	}
	if params.FoundedYear.Valid {
		t.Errorf("FoundedYear: want invalid, got %+v", params.FoundedYear)
	}
	if params.City.Valid || params.Country.Valid {
		t.Errorf("City/Country: want invalid, got %+v %+v", params.City, params.Country)
	}
	if params.LinkedinUrl.Valid || params.InstagramUrl.Valid || params.FacebookUrl.Valid || params.TwitterUrl.Valid {
		t.Errorf("Social URLs: want all invalid, got linkedin=%+v instagram=%+v facebook=%+v twitter=%+v",
			params.LinkedinUrl, params.InstagramUrl, params.FacebookUrl, params.TwitterUrl)
	}
	if params.CoverImageUrl.Valid {
		t.Errorf("CoverImageUrl: want invalid, got %+v", params.CoverImageUrl)
	}
}

// TestMapCreateError drives the pg-error → domain-error classifier through a
// table of synthetic *pgconn.PgError values and asserts the exact domain
// sentinel each one resolves to. This is the test the verify report flagged as
// missing: mapCreateError is a pure function but it sat at 0% coverage because
// it only runs when Postgres rejects a row.
//
// Sentinels must match the public contract documented in
// infrastructure/http/handler.go::classifyCreateCompanyError — if a new pg code
// is mapped here, the HTTP classifier must learn about it in lockstep.
func TestMapCreateError(t *testing.T) {
	// uniqueSentinel and fkSentinel are declared once so we can capture the
	// exact instance mapCreateError is expected to return; the assertion is
	// pointer-equality via errors.Is, which also exercises the wrapped-error
	// branch in the table below.
	uniqueSentinel := &pgconn.PgError{
		Code:           "23505",
		Message:        "duplicate key value violates unique constraint \"companies_rfc_key\"",
		ConstraintName: "companies_rfc_key",
	}
	fkSentinel := &pgconn.PgError{
		Code:           "23503",
		Message:        "insert or update on table \"companies\" violates foreign key constraint \"companies_industry_id_fkey\"",
		ConstraintName: "companies_industry_id_fkey",
	}
	otherPg := &pgconn.PgError{
		Code:    "42P01", // undefined_table — should fall through untouched.
		Message: "relation \"missing\" does not exist",
	}
	// nonPg captures the "not a PgError at all" branch (e.g. driver connection
	// error, context cancellation). mapCreateError must hand the original
	// error back so callers can log/inspect it; it must never coerce it into
	// a domain sentinel that would mislead the HTTP layer.
	nonPg := errors.New("dial tcp: connection refused")

	tests := []struct {
		name    string
		in      error
		want    error  // sentinel to assert via errors.Is
		wantMsg string // optional: if non-empty, also assert the returned error carries this message
	}{
		{
			name: "nil returns nil (no error to map)",
			in:   nil,
			want: nil,
		},
		{
			name: "23505 unique_violation maps to ErrDuplicateCompany",
			in:   uniqueSentinel,
			want: entities.ErrDuplicateCompany,
		},
		{
			name: "23503 foreign_key_violation maps to ErrIndustryNotFound",
			in:   fkSentinel,
			want: entities.ErrIndustryNotFound,
		},
		{
			name:    "unrelated pg code falls back to the original pg error",
			in:      otherPg,
			want:    otherPg,
			wantMsg: otherPg.Message,
		},
		{
			name:    "non-pg error falls back to the original error unchanged",
			in:      nonPg,
			want:    nonPg,
			wantMsg: nonPg.Error(),
		},
		{
			name: "wrapped 23505 still resolves via errors.As to ErrDuplicateCompany",
			in:   fmt.Errorf("repo: %w", uniqueSentinel),
			want: entities.ErrDuplicateCompany,
		},
		{
			name: "wrapped 23503 still resolves via errors.As to ErrIndustryNotFound",
			in:   fmt.Errorf("repo: %w", fkSentinel),
			want: entities.ErrIndustryNotFound,
		},
		{
			name:    "wrapped unrelated pg error falls back to the wrapped error (preserves chain)",
			in:      fmt.Errorf("repo: %w", otherPg),
			want:    otherPg,
			wantMsg: otherPg.Message,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapCreateError(tc.in)

			if tc.want == nil {
				if got != nil {
					t.Fatalf("expected nil, got: %v", got)
				}
				return
			}

			if !errors.Is(got, tc.want) {
				t.Errorf("errors.Is(got, want) = false; want %v, got %v", tc.want, got)
			}
			// Substring match — pgconn.PgError.Error() wraps the message with
			// a ": " prefix and a "(SQLSTATE ...)" suffix, so an exact
			// equality check would be brittle. The intent here is just to
			// prove the original message survives the round-trip.
			if tc.wantMsg != "" && !strings.Contains(got.Error(), tc.wantMsg) {
				t.Errorf("expected message to contain %q, got %q", tc.wantMsg, got.Error())
			}
		})
	}
}

// Ensure mapCreateError preserves the original non-pg error (no domain
// coercion). This is the regression guard for the "do not coerce non-pg
// errors" invariant: a previous refactor accidentally wrapped every error into
// a generic sentinel and the HTTP layer started returning 500s with messages
// that meant nothing to the operator.
func TestMapCreateError_NonPgErrorIsNotCoerced(t *testing.T) {
	original := errors.New("driver: connection reset by peer")
	got := mapCreateError(original)

	if got == nil {
		t.Fatal("expected the original error back, got nil")
	}
	if errors.Is(got, entities.ErrDuplicateCompany) {
		t.Errorf("non-pg error must not be coerced to ErrDuplicateCompany")
	}
	if errors.Is(got, entities.ErrIndustryNotFound) {
		t.Errorf("non-pg error must not be coerced to ErrIndustryNotFound")
	}
	if got.Error() != original.Error() {
		t.Errorf("expected original message %q, got %q", original.Error(), got.Error())
	}
}
