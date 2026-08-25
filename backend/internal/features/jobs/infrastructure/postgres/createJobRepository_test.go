// Unit tests for the jobs postgres adapter's create-path helpers.
//
// These tests exercise the deterministic Go code (`buildCreateJobParams`,
// `intPtrToInt4`, `createRowToGetForUpdateRow`, `mapCreateError`)
// without touching a real database. The full SQL coverage lives in
// `jobRepository_create_integration_test.go` (//go:build integration).
package postgres

import (
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- intPtrToInt4 -----------------------------------------------------

// TestIntPtrToInt4_NilYieldsInvalid proves the nil branch: a nil *int
// must produce a pgtype.Int4 with Valid=false so the SQL `narg(... )`
// collapses to NULL.
func TestIntPtrToInt4_NilYieldsInvalid(t *testing.T) {
	got := intPtrToInt4(nil)
	if got.Valid {
		t.Errorf("nil -> Valid=false, got %+v", got)
	}
	if got.Int32 != 0 {
		t.Errorf("nil -> Int32=0, got %d", got.Int32)
	}
}

// TestIntPtrToInt4_ValueYieldsValid proves the value branch: a non-nil
// *int must produce a pgtype.Int4 with Valid=true and Int32=*v.
func TestIntPtrToInt4_ValueYieldsValid(t *testing.T) {
	v := 42000
	got := intPtrToInt4(&v)
	if !got.Valid {
		t.Errorf("value -> Valid=true, got %+v", got)
	}
	if got.Int32 != 42000 {
		t.Errorf("value -> Int32=%d, got %d", 42000, got.Int32)
	}
}

// TestIntPtrToInt4_ZeroValueStillValid pins the boundary: a non-nil
// *int pointing at 0 must produce a valid pgtype (SQL NULL vs SQL 0
// are distinguishable).
func TestIntPtrToInt4_ZeroValueStillValid(t *testing.T) {
	v := 0
	got := intPtrToInt4(&v)
	if !got.Valid || got.Int32 != 0 {
		t.Errorf("0 -> Valid=true,Int32=0, got %+v", got)
	}
}

// --- buildCreateJobParams --------------------------------------------

// TestBuildCreateJobParams_AllOptionalsAbsent covers the "no optional
// fields" case: Location/SalaryMin/SalaryMax nil pointers produce
// invalid pgtypes. Required fields (Title/Description/VOs/SalaryCurrency)
// always carry their canonical values. Identity columns (ID/CompanyID)
// are always populated.
//
// sqlc maps the required `sqlc.arg` columns (Title/Description/VOs/
// SalaryCurrency) to plain string (NOT pgtype.Text) because they are
// non-nullable on the wire. Only the three optional `sqlc.narg` columns
// (Location/SalaryMin/SalaryMax) carry pgtype wrappers.
func TestBuildCreateJobParams_AllOptionalsAbsent(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	params := repositories.CreateJobParams{
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		SalaryCurrency: valueobjects.MXN,
		// Location/SalaryMin/SalaryMax intentionally nil.
	}

	got := buildCreateJobParams(id, companyID, params)

	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, got.CompanyID)
	}
	// sqlc.arg columns are plain strings (non-nullable on the wire).
	if got.Title != "Backend Engineer" {
		t.Errorf("Title: want %q, got %q", "Backend Engineer", got.Title)
	}
	if got.Description != "Go + Postgres" {
		t.Errorf("Description: want %q, got %q", "Go + Postgres", got.Description)
	}
	if got.WorkMode != "remote" {
		t.Errorf("WorkMode: want %q (canonical), got %q", "remote", got.WorkMode)
	}
	if got.EmploymentType != "full_time" {
		t.Errorf("EmploymentType: want %q, got %q", "full_time", got.EmploymentType)
	}
	if got.Seniority != "senior" {
		t.Errorf("Seniority: want %q, got %q", "senior", got.Seniority)
	}
	if got.SalaryCurrency != "MXN" {
		t.Errorf("SalaryCurrency: want %q, got %q", "MXN", got.SalaryCurrency)
	}
	// sqlc.narg columns are pgtypes — invalid when absent.
	if got.Location.Valid {
		t.Errorf("Location: want invalid (absent), got %+v", got.Location)
	}
	if got.SalaryMin.Valid {
		t.Errorf("SalaryMin: want invalid (absent), got %+v", got.SalaryMin)
	}
	if got.SalaryMax.Valid {
		t.Errorf("SalaryMax: want invalid (absent), got %+v", got.SalaryMax)
	}
}

// TestBuildCreateJobParams_AllOptionalsPresent covers the "all optional
// fields set" case: every optional pointer is non-nil and must
// produce a valid pgtype.
func TestBuildCreateJobParams_AllOptionalsPresent(t *testing.T) {
	loc := "CDMX"
	smin := 40000
	smax := 60000
	params := repositories.CreateJobParams{
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		Location:       &loc,
		SalaryMin:      &smin,
		SalaryMax:      &smax,
		SalaryCurrency: valueobjects.USD,
	}

	got := buildCreateJobParams(uuid.New(), uuid.New(), params)

	if !got.Location.Valid || got.Location.String != "CDMX" {
		t.Errorf("Location: want valid+CDMX, got %+v", got.Location)
	}
	if !got.SalaryMin.Valid || got.SalaryMin.Int32 != 40000 {
		t.Errorf("SalaryMin: want valid+40000, got %+v", got.SalaryMin)
	}
	if !got.SalaryMax.Valid || got.SalaryMax.Int32 != 60000 {
		t.Errorf("SalaryMax: want valid+60000, got %+v", got.SalaryMax)
	}
	if got.SalaryCurrency != "USD" {
		t.Errorf("SalaryCurrency: want %q, got %q", "USD", got.SalaryCurrency)
	}
}

// TestBuildCreateJobParams_VOsCanonicalize pins D7: VO .String()
// canonicalizes the wire form. The use case parsed via Parse* so the
// incoming VOs are always valid; the adapter never trusts a raw string.
func TestBuildCreateJobParams_VOsCanonicalize(t *testing.T) {
	params := repositories.CreateJobParams{
		Title:          "X",
		Description:    "Y",
		WorkMode:       valueobjects.Hybrid,
		EmploymentType: valueobjects.Contract,
		Seniority:      valueobjects.LeadSeniority,
		SalaryCurrency: valueobjects.USD,
	}

	got := buildCreateJobParams(uuid.New(), uuid.New(), params)

	for _, c := range []struct {
		field string
		got   string
		want  string
	}{
		{"WorkMode", got.WorkMode, "hybrid"},
		{"EmploymentType", got.EmploymentType, "contract"},
		{"Seniority", got.Seniority, "lead"},
		{"SalaryCurrency", got.SalaryCurrency, "USD"},
	} {
		if c.got != c.want {
			t.Errorf("%s: want %q, got %q", c.field, c.want, c.got)
		}
	}
}

// --- createRowToGetForUpdateRow --------------------------------------

// TestCreateRowToGetForUpdateRow_AllFieldsLifted pins D2: every
// CreateJobRow field MUST be projected onto GetJobForUpdateRow
// field-for-field. The shape parity is what lets toJobForUpdateEntity
// stay untouched.
func TestCreateRowToGetForUpdateRow_AllFieldsLifted(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	publishedAt := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	updatedAt := time.Date(2026, 8, 24, 12, 0, 1, 0, time.UTC)

	src := db.CreateJobRow{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		Location:       pgtype.Text{String: "CDMX", Valid: true},
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "senior",
		SalaryMin:      pgtype.Int4{Int32: 40000, Valid: true},
		SalaryMax:      pgtype.Int4{Int32: 60000, Valid: true},
		SalaryCurrency: "MXN",
		Status:         "draft",
		PublishedAt:    pgtype.Timestamptz{Time: publishedAt, Valid: false}, // NULL for draft
		UpdatedAt:      pgtype.Timestamptz{Time: updatedAt, Valid: true},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
	}

	got := createRowToGetForUpdateRow(src)

	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.Title != "Backend Engineer" {
		t.Errorf("Title: want %q, got %q", "Backend Engineer", got.Title)
	}
	if got.Description != "Go + Postgres" {
		t.Errorf("Description: want %q, got %q", "Go + Postgres", got.Description)
	}
	if !got.Location.Valid || got.Location.String != "CDMX" {
		t.Errorf("Location: want valid+CDMX, got %+v", got.Location)
	}
	if got.WorkMode != "remote" {
		t.Errorf("WorkMode: want %q, got %q", "remote", got.WorkMode)
	}
	if got.EmploymentType != "full_time" {
		t.Errorf("EmploymentType: want %q, got %q", "full_time", got.EmploymentType)
	}
	if got.Seniority != "senior" {
		t.Errorf("Seniority: want %q, got %q", "senior", got.Seniority)
	}
	if !got.SalaryMin.Valid || got.SalaryMin.Int32 != 40000 {
		t.Errorf("SalaryMin: want valid+40000, got %+v", got.SalaryMin)
	}
	if !got.SalaryMax.Valid || got.SalaryMax.Int32 != 60000 {
		t.Errorf("SalaryMax: want valid+60000, got %+v", got.SalaryMax)
	}
	if got.SalaryCurrency != "MXN" {
		t.Errorf("SalaryCurrency: want %q, got %q", "MXN", got.SalaryCurrency)
	}
	if got.Status != "draft" {
		t.Errorf("Status: want %q, got %q", "draft", got.Status)
	}
	if !got.UpdatedAt.Valid || !got.UpdatedAt.Time.Equal(updatedAt) {
		t.Errorf("UpdatedAt: want valid+%v, got %+v", updatedAt, got.UpdatedAt)
	}
	if got.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, got.CompanyID)
	}
	if got.CompanyName != "Acme SA" {
		t.Errorf("CompanyName: want %q, got %q", "Acme SA", got.CompanyName)
	}
}

// --- mapCreateError --------------------------------------------------

// TestMapCreateError_NilPassesThrough covers the trivial pass-through:
// a nil error returns nil.
func TestMapCreateError_NilPassesThrough(t *testing.T) {
	if got := mapCreateError(nil); got != nil {
		t.Errorf("nil -> nil, got %v", got)
	}
}

// TestMapCreateError_PgxErrNoRowsReturnsErrCompanyNotActive pins D7:
// the active-company guard producing 0 rows surfaces as
// entities.ErrCompanyNotActive. The adapter is the only place that
// translates pgx.ErrNoRows to this domain sentinel.
func TestMapCreateError_PgxErrNoRowsReturnsErrCompanyNotActive(t *testing.T) {
	got := mapCreateError(pgx.ErrNoRows)
	if !errors.Is(got, entities.ErrCompanyNotActive) {
		t.Errorf("pgx.ErrNoRows -> ErrCompanyNotActive, got %v", got)
	}
}

// TestMapCreateError_FKViolationReturnsErrCompanyGone pins D7:
// SQLSTATE 23503 (foreign_key_violation on jobs.company_id) is
// defense-in-depth (the CTE filter prevents it via the designed
// flow). The adapter still maps it to ErrCompanyGone so the HTTP
// layer renders a typed 409 body.
func TestMapCreateError_FKViolationReturnsErrCompanyGone(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "23503", Message: "fk violation"}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrCompanyGone) {
		t.Errorf("23503 -> ErrCompanyGone, got %v", got)
	}
}

// TestMapCreateError_CheckViolationReturnsErrInvalidStatusTransition
// pins D7: SQLSTATE 23514 (check_violation on the jobs CHECK
// constraints -- e.g. an unknown work_mode sneaking past the use case
// parse) maps to ErrInvalidStatusTransition. The use case parses VOs
// before SQL, so this branch is unreachable via the designed flow.
func TestMapCreateError_CheckViolationReturnsErrInvalidStatusTransition(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "23514", Message: "check violation"}
	got := mapCreateError(pgErr)
	if !errors.Is(got, entities.ErrInvalidStatusTransition) {
		t.Errorf("23514 -> ErrInvalidStatusTransition, got %v", got)
	}
}

// TestMapCreateError_UnknownPgErrorPassesThrough: any other PgError
// (e.g. 23505 unique_violation, 08001 connection) returns untouched so
// the HTTP layer can log + 500. Note: 23505 is INTENTIONALLY not
// mapped -- no dedupe on jobs per locked decision #4.
func TestMapCreateError_UnknownPgErrorPassesThrough(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "42P01", Message: "undefined_table"}
	got := mapCreateError(pgErr)
	if !errors.Is(got, pgErr) {
		t.Errorf("unknown PgError -> pass-through, got %v (lost original)", got)
	}
}

// TestMapCreateError_NonPgErrorPassesThrough: a connection error or
// context-cancellation returns untouched. The HTTP layer maps to 500.
func TestMapCreateError_NonPgErrorPassesThrough(t *testing.T) {
	connErr := errors.New("connection refused")
	got := mapCreateError(connErr)
	if !errors.Is(got, connErr) {
		t.Errorf("non-pg error -> pass-through, got %v (lost original)", got)
	}
}

// --- adapter Create (round-trip via mapCreateError + CreateJob) -----

// TestCreate_RowMappingExercisesToJobForUpdateEntity pins D2: the
// returned *JobForUpdate carries the exact fields CreateJobRow lifted
// onto GetJobForUpdateRow and toJobForUpdateEntity parsed. The test
// uses a real db.CreateJobRow -> createRowToGetForUpdateRow ->
// toJobForUpdateEntity chain to prove the seam compiles and produces
// the right entity.
func TestCreate_RowMappingExercisesToJobForUpdateEntity(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	updatedAt := time.Date(2026, 8, 24, 12, 0, 1, 0, time.UTC)

	src := db.CreateJobRow{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		Location:       pgtype.Text{Valid: false}, // NULL
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "senior",
		SalaryMin:      pgtype.Int4{Valid: false}, // NULL
		SalaryMax:      pgtype.Int4{Valid: false}, // NULL
		SalaryCurrency: "MXN",
		Status:         "draft",
		PublishedAt:    pgtype.Timestamptz{Valid: false}, // NULL for draft
		UpdatedAt:      pgtype.Timestamptz{Time: updatedAt, Valid: true},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
	}

	got, err := toJobForUpdateEntity(createRowToGetForUpdateRow(src))
	if err != nil {
		t.Fatalf("toJobForUpdateEntity: %v", err)
	}
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.Title != "Backend Engineer" {
		t.Errorf("Title: want %q, got %q", "Backend Engineer", got.Title)
	}
	if got.JobStatus != valueobjects.Draft {
		t.Errorf("JobStatus: want Draft, got %v", got.JobStatus)
	}
	if got.Location != nil {
		t.Errorf("Location: want nil (NULL for absent), got %v", *got.Location)
	}
	if got.SalaryMin != nil {
		t.Errorf("SalaryMin: want nil (NULL for absent), got %v", *got.SalaryMin)
	}
	if got.SalaryMax != nil {
		t.Errorf("SalaryMax: want nil (NULL for absent), got %v", *got.SalaryMax)
	}
	if got.PublishedAt != nil {
		t.Errorf("PublishedAt: want nil (drafts have no publish time), got %v", *got.PublishedAt)
	}
	if !got.UpdatedAt.Equal(updatedAt) {
		t.Errorf("UpdatedAt: want %v, got %v", updatedAt, got.UpdatedAt)
	}
	if got.SalaryCurrency != valueobjects.MXN {
		t.Errorf("SalaryCurrency: want MXN, got %v", got.SalaryCurrency)
	}
	if got.Company.ID != companyID {
		t.Errorf("Company.ID: want %v, got %v", companyID, got.Company.ID)
	}
	if got.Company.Name != "Acme SA" {
		t.Errorf("Company.Name: want %q, got %q", "Acme SA", got.Company.Name)
	}
}

