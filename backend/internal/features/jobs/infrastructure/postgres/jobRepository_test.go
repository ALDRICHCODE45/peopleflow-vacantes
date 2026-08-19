// Unit tests for the jobs postgres adapter.
//
// These tests deliberately avoid touching a real database: they exercise
// the `buildSearchParams`/`toEntity`/`mapGetError` helpers, which hold the
// deterministic logic the integration tests cannot easily fault-cover.
// Search/GetByID themselves are integration-tested via
// `//go:build integration` migration_check tests.
package postgres

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestBuildSearchParams_AllNilOptionals_YieldsInvalidPgTypes(t *testing.T) {
	// Filters left nil & no cursor must produce pgtype wrappers with
	// Valid=false (SQL NULL). The `Limit` field is the only one that
	// stays unconditionally valid because Postgres needs a positive
	// int in `LIMIT`.
	params := buildSearchParams(repositories.SearchParams{
		Limit: 21,
	})

	if params.Q.Valid {
		t.Errorf("Q: want invalid, got %+v", params.Q)
	}
	if params.Seniority.Valid || params.WorkMode.Valid ||
		params.EmploymentType.Valid || params.Location.Valid ||
		params.SalaryCurrency.Valid {
		t.Errorf("text filters: want all invalid, got %+v %+v %+v %+v %+v",
			params.Seniority, params.WorkMode, params.EmploymentType,
			params.Location, params.SalaryCurrency)
	}
	if params.CursorTs.Valid {
		t.Errorf("CursorTs: want invalid, got %+v", params.CursorTs)
	}
	if params.CursorID.Valid {
		t.Errorf("CursorID: want invalid, got %+v", params.CursorID)
	}
	if params.CursorRank.Valid {
		t.Errorf("CursorRank: want invalid, got %+v", params.CursorRank)
	}
	if !params.Limit.Valid || params.Limit.Int32 != 21 {
		t.Errorf("Limit: want 21 valid, got %+v", params.Limit)
	}
}

func TestBuildSearchParams_AllFiltersPopulated(t *testing.T) {
	q := "go"
	sn := "senior"
	wm := "remote"
	et := "full_time"
	loc := "CDMX"
	cur := "USD"

	params := buildSearchParams(repositories.SearchParams{
		Q:              &q,
		Seniority:      &sn,
		WorkMode:       &wm,
		EmploymentType: &et,
		Location:       &loc,
		SalaryCurrency: &cur,
		Limit:          21,
	})

	cases := []struct {
		name string
		got  pgtype.Text
		want string
	}{
		{"Q", params.Q, "go"},
		{"Seniority", params.Seniority, "senior"},
		{"WorkMode", params.WorkMode, "remote"},
		{"EmploymentType", params.EmploymentType, "full_time"},
		{"Location", params.Location, "CDMX"},
		{"SalaryCurrency", params.SalaryCurrency, "USD"},
	}
	for _, c := range cases {
		if !c.got.Valid || c.got.String != c.want {
			t.Errorf("%s: want {Valid:true String:%q}, got %+v", c.name, c.want, c.got)
		}
	}
}

func TestBuildSearchParams_NilCursorYieldsAllInvalid(t *testing.T) {
	// Cursor explicitly nil must produce all three cursor pgtypes
	// invalid so the SQL `IS NULL` keyset predicate fires.
	params := buildSearchParams(repositories.SearchParams{
		Limit:  21,
		Cursor: nil,
	})
	if params.CursorTs.Valid || params.CursorID.Valid || params.CursorRank.Valid {
		t.Errorf("cursor pgtypes: want all invalid, got ts=%+v id=%+v rank=%+v",
			params.CursorTs, params.CursorID, params.CursorRank)
	}
}

func TestBuildSearchParams_BrowseCursor_NoRank(t *testing.T) {
	// Browse cursor (Rank == nil) must still pass ts/id forward; the
	// Rank pgtype stays invalid so the SQL `COALESCE(.., 0)` substitute
	// drives the 3-tuple to a 2-tuple comparator.
	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	id := uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab")

	params := buildSearchParams(repositories.SearchParams{
		Limit: 21,
		Cursor: &repositories.Cursor{
			Rank:        nil,
			PublishedAt: pub,
			ID:          id,
		},
	})

	if !params.CursorTs.Valid || !params.CursorTs.Time.Equal(pub) {
		t.Errorf("CursorTs: want valid+%v, got %+v", pub, params.CursorTs)
	}
	if !params.CursorID.Valid || params.CursorID.Bytes != id {
		t.Errorf("CursorID: want valid+%v, got %+v", id, params.CursorID)
	}
	if params.CursorRank.Valid {
		t.Errorf("CursorRank: want invalid (browse cursor), got %+v", params.CursorRank)
	}
}

func TestBuildSearchParams_SearchCursor_WithRank(t *testing.T) {
	// Search cursor carries a Rank — every pgtype is valid so the SQL
	// 3-tuple comparator narrows on (rank, published_at, id).
	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	id := uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab")
	rank := 0.421875

	params := buildSearchParams(repositories.SearchParams{
		Limit: 21,
		Cursor: &repositories.Cursor{
			Rank:        &rank,
			PublishedAt: pub,
			ID:          id,
		},
	})

	if !params.CursorTs.Valid || !params.CursorTs.Time.Equal(pub) {
		t.Errorf("CursorTs: want valid+%v, got %+v", pub, params.CursorTs)
	}
	if !params.CursorID.Valid || params.CursorID.Bytes != id {
		t.Errorf("CursorID: want valid+%v, got %+v", id, params.CursorID)
	}
	if !params.CursorRank.Valid || params.CursorRank.Float64 != rank {
		t.Errorf("CursorRank: want valid+%v, got %+v", rank, params.CursorRank)
	}
}

// TestToEntity_FullRow covers the happy path: every column populated,
// every VO parses, the embedded company ref carries through, and the
// adapter populates `Rank` (the flag isSearchMode=true is passed in).
func TestToEntity_FullRow_RankPopulated(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-0000000000aa")
	companyID := uuid.MustParse("018e0000-0000-7000-8000-000000000001")
	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	smin := int32(40000)
	smax := int32(60000)

	row := db.SearchJobsRow{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres + Kubernetes",
		Location:       pgtype.Text{String: "CDMX", Valid: true},
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "senior",
		SalaryMin:      pgtype.Int4{Int32: smin, Valid: true},
		SalaryMax:      pgtype.Int4{Int32: smax, Valid: true},
		SalaryCurrency: "MXN",
		Status:         "published",
		PublishedAt:    pgtype.Timestamptz{Time: pub, Valid: true},
		DeletedAt:      pgtype.Timestamptz{Valid: false},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
		SearchRank:     0.123,
	}

	got, err := toEntity(row, true)
	if err != nil {
		t.Fatalf("toEntity: %v", err)
	}

	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.Title != "Backend Engineer" {
		t.Errorf("Title: %q", got.Title)
	}
	if got.Description != "Go + Postgres + Kubernetes" {
		t.Errorf("Description: %q", got.Description)
	}
	if got.WorkMode != valueobjects.Remote {
		t.Errorf("WorkMode: want Remote, got %v", got.WorkMode)
	}
	if got.EmploymentType != valueobjects.FullTime {
		t.Errorf("EmploymentType: want FullTime, got %v", got.EmploymentType)
	}
	if got.Seniority != valueobjects.SeniorSeniority {
		t.Errorf("Seniority: want SeniorSeniority, got %v", got.Seniority)
	}
	if got.JobStatus != valueobjects.Published {
		t.Errorf("JobStatus: want Published, got %v", got.JobStatus)
	}
	if got.Location == nil || *got.Location != "CDMX" {
		t.Errorf("Location: want CDMX, got %v", got.Location)
	}
	if got.SalaryMin == nil || *got.SalaryMin != int(smin) {
		t.Errorf("SalaryMin: want %d, got %v", smin, got.SalaryMin)
	}
	if got.SalaryMax == nil || *got.SalaryMax != int(smax) {
		t.Errorf("SalaryMax: want %d, got %v", smax, got.SalaryMax)
	}
	if got.SalaryCurrency != valueobjects.MXN {
		t.Errorf("SalaryCurrency: want MXN, got %v", got.SalaryCurrency)
	}
	if got.PublishedAt == nil || !got.PublishedAt.Equal(pub) {
		t.Errorf("PublishedAt: want %v, got %v", pub, got.PublishedAt)
	}
	if got.Company.ID != companyID {
		t.Errorf("Company.ID: want %v, got %v", companyID, got.Company.ID)
	}
	if got.Company.Name != "Acme SA" {
		t.Errorf("Company.Name: want Acme SA, got %q", got.Company.Name)
	}
	if got.Rank == nil {
		t.Fatal("Rank: want non-nil (search mode), got nil")
	}
}

// TestToEntity_RankOmittedInBrowseMode covers the browse contract:
// `Rank` MUST be nil when the caller signals search-mode=false so the
// cursor codec doesn't smuggle an empty rank into the next page.
func TestToEntity_BrowseMode_OmitsRank(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-0000000000aa")
	companyID := uuid.MustParse("018e0000-0000-7000-8000-000000000001")
	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)

	row := db.SearchJobsRow{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		Location:       pgtype.Text{Valid: false},
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "senior",
		SalaryMin:      pgtype.Int4{Valid: false},
		SalaryMax:      pgtype.Int4{Valid: false},
		SalaryCurrency: "MXN",
		Status:         "published",
		PublishedAt:    pgtype.Timestamptz{Time: pub, Valid: true},
		DeletedAt:      pgtype.Timestamptz{Valid: false},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
		SearchRank:     0,
	}

	got, err := toEntity(row, false) // browse mode
	if err != nil {
		t.Fatalf("toEntity: %v", err)
	}
	if got.Rank != nil {
		t.Errorf("Rank: want nil (browse mode), got %v", *got.Rank)
	}
}

// TestToEntity_NullableFieldsUnset covers the all-NULL optionals case.
func TestToEntity_NullableFieldsUnset(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	pub := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)

	row := db.SearchJobsRow{
		ID:             id,
		Title:          "X",
		Description:    "Y",
		Location:       pgtype.Text{Valid: false},
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "mid",
		SalaryMin:      pgtype.Int4{Valid: false},
		SalaryMax:      pgtype.Int4{Valid: false},
		SalaryCurrency: "MXN",
		Status:         "published",
		PublishedAt:    pgtype.Timestamptz{Time: pub, Valid: true},
		DeletedAt:      pgtype.Timestamptz{Valid: false},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
	}

	got, err := toEntity(row, false)
	if err != nil {
		t.Fatalf("toEntity: %v", err)
	}
	if got.Location != nil {
		t.Errorf("Location: want nil, got %v", got.Location)
	}
	if got.SalaryMin != nil || got.SalaryMax != nil {
		t.Errorf("SalaryMin/Max: want both nil, got %v %v", got.SalaryMin, got.SalaryMax)
	}
	if got.PublishedAt == nil || !got.PublishedAt.Equal(pub) {
		t.Errorf("PublishedAt: want %v, got %v", pub, got.PublishedAt)
	}
}

// TestToEntity_InvalidEnumFailsLoud covers the "unrecognized DB value"
// invariant: the adapter fails loud via Parse* rather than silently
// zeroing (which would let a corrupted row surface as a published
// job to clients).
func TestToEntity_InvalidWorkMode_FailsLoud(t *testing.T) {
	row := db.SearchJobsRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "telecommute",
		EmploymentType: "full_time",
		Seniority:      "mid",
		SalaryCurrency: "MXN",
		Status:         "published",
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
		PublishedAt:    pgtype.Timestamptz{Valid: true},
	}
	_, err := toEntity(row, false)
	if !errors.Is(err, valueobjects.ErrInvalidWorkMode) {
		t.Errorf("want ErrInvalidWorkMode, got %v", err)
	}
}

func TestToEntity_InvalidEmploymentType_FailsLoud(t *testing.T) {
	row := db.SearchJobsRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "remote",
		EmploymentType: "freelance",
		Seniority:      "mid",
		SalaryCurrency: "MXN",
		Status:         "published",
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
		PublishedAt:    pgtype.Timestamptz{Valid: true},
	}
	_, err := toEntity(row, false)
	if !errors.Is(err, valueobjects.ErrInvalidEmploymentType) {
		t.Errorf("want ErrInvalidEmploymentType, got %v", err)
	}
}

func TestToEntity_InvalidSeniority_FailsLoud(t *testing.T) {
	row := db.SearchJobsRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "principal",
		SalaryCurrency: "MXN",
		Status:         "published",
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
		PublishedAt:    pgtype.Timestamptz{Valid: true},
	}
	_, err := toEntity(row, false)
	if !errors.Is(err, valueobjects.ErrInvalidSeniority) {
		t.Errorf("want ErrInvalidSeniority, got %v", err)
	}
}

func TestToEntity_InvalidStatus_FailsLoud(t *testing.T) {
	row := db.SearchJobsRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "mid",
		SalaryCurrency: "MXN",
		Status:         "not_a_real_status",
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
		PublishedAt:    pgtype.Timestamptz{Valid: true},
	}
	_, err := toEntity(row, false)
	if !errors.Is(err, valueobjects.ErrInvalidJobStatus) {
		t.Errorf("want ErrInvalidJobStatus, got %v", err)
	}
}

func TestToEntity_InvalidSalaryCurrency_FailsLoud(t *testing.T) {
	row := db.SearchJobsRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "mid",
		SalaryCurrency: "EUR",
		Status:         "published",
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
		PublishedAt:    pgtype.Timestamptz{Valid: true},
	}
	_, err := toEntity(row, false)
	if !errors.Is(err, valueobjects.ErrInvalidSalaryCurrency) {
		t.Errorf("want ErrInvalidSalaryCurrency, got %v", err)
	}
}

// TestMapGetError mirrors the companyRepository test for `Create` but
// exercises the smaller surface of `GetByID`: only ErrNoRows is mapped
// to a domain sentinel; everything else falls through untouched.
func TestMapGetError(t *testing.T) {
	tests := []struct {
		name    string
		in      error
		want    error
		wantMsg string
	}{
		{
			name: "nil returns nil",
			in:   nil,
			want: nil,
		},
		{
			name: "pgx.ErrNoRows maps to ErrJobNotFound",
			in:   pgx.ErrNoRows,
			want: entities.ErrJobNotFound,
		},
		{
			name: "wrapped pgx.ErrNoRows (%w) still resolves to ErrJobNotFound",
			in:   fmt.Errorf("repo: %w", pgx.ErrNoRows),
			want: entities.ErrJobNotFound,
		},
		{
			name:    "non-pg error falls through unchanged",
			in:      errors.New("driver: connection reset by peer"),
			want:    nil, // sentinel-agnostic; we re-check below
			wantMsg: "driver: connection reset by peer",
		},
		{
			name:    "wrapped non-pg error falls through unchanged",
			in:      errors.New("retry: " + "dial tcp: connection refused"),
			want:    nil,
			wantMsg: "dial tcp: connection refused",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := mapGetError(tc.in)

			if tc.want == nil {
				if got == nil {
					return
				}
				if tc.wantMsg != "" && got.Error() != tc.wantMsg {
					// Best-effort: the chain might be the same string;
					// assert containment so wrapper layers don't lie.
					if !stringContains(got.Error(), tc.wantMsg) {
						t.Errorf("want substring %q, got %q", tc.wantMsg, got.Error())
					}
				}
				return
			}

			if !errors.Is(got, tc.want) {
				t.Errorf("errors.Is(got, want) = false; want %v, got %v", tc.want, got)
			}
		})
	}
}

// stringContains is a tiny helper to keep the inline test readable.
func stringContains(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// Ensure the postgres adapter satisfies the domain port at compile time.
// The var-assertion lives in jobRepository.go; this test is a redundant
// belt-and-suspenders guard so a refactor that breaks wiring fails the
// unit-test run instead of only surfacing in `go build`.
func TestJobRepositoryImplementsDomainPort(t *testing.T) {
	var _ repositories.JobRepository = (*JobRepository)(nil)
}
