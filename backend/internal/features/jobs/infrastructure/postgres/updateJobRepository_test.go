// Unit tests for the jobs postgres adapter's write-path helpers.
//
// These tests exercise the deterministic Go code (`buildUpdateJobParams`,
// `toJobForUpdateEntity`, `mapUpdateError`) without touching a real
// database. The full SQL coverage lives in
// `jobRepository_write_integration_test.go` (//go:build integration).
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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- buildUpdateJobParams ------------------------------------------------

// TestBuildUpdateJobParams_AllAbsent covers the "no fields touched"
// case: every column patch is either a nil pointer (Title etc.) or an
// unset Optional (Location/SalaryMin/SalaryMax). The adapter must
// produce a params struct where every pgtype is Valid=false (so
// COALESCE/SQL CASE branches degenerate to the column's existing value),
// every SetX flag is false, status is invalid, and the identity columns
// (ID/CompanyID/CasToken) are always populated.
func TestBuildUpdateJobParams_AllAbsent(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	cas := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)

	got := buildUpdateJobParams(id, companyID, repositories.UpdatePatch{}, cas)

	// text pgtypes — Valid=false (not provided)
	for _, p := range []pgtype.Text{
		got.Title, got.Description, got.WorkMode, got.EmploymentType,
		got.Seniority, got.SalaryCurrency,
	} {
		if p.Valid {
			t.Errorf("text pgtype: want invalid, got %+v", p)
		}
	}
	// nullable trio — flag=false, value invalid
	if got.SetLocation {
		t.Errorf("SetLocation: want false, got true")
	}
	if got.Location.Valid {
		t.Errorf("Location: want invalid, got %+v", got.Location)
	}
	if got.SetSalaryMin || got.SalaryMin.Valid {
		t.Errorf("SetSalaryMin/Min: want both false/invalid, got set=%v min=%+v", got.SetSalaryMin, got.SalaryMin)
	}
	if got.SetSalaryMax || got.SalaryMax.Valid {
		t.Errorf("SetSalaryMax/Max: want both false/invalid, got set=%v max=%+v", got.SetSalaryMax, got.SalaryMax)
	}
	if got.Status.Valid {
		t.Errorf("Status: want invalid, got %+v", got.Status)
	}
	// identity columns always populated
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
	if got.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, got.CompanyID)
	}
	if !got.CasToken.Valid || !got.CasToken.Time.Equal(cas) {
		t.Errorf("CasToken: want valid+%v, got %+v", cas, got.CasToken)
	}
}

// TestBuildUpdateJobParams_TitleOnlyPresent covers the "set one column"
// case: a populated Title pointer must produce a Valid pgtype.Text.
func TestBuildUpdateJobParams_TitleOnlyPresent(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	cas := time.Now().UTC()
	title := "New Title"

	got := buildUpdateJobParams(id, companyID, repositories.UpdatePatch{
		Title: &title,
	}, cas)

	if !got.Title.Valid || got.Title.String != "New Title" {
		t.Errorf("Title: want {Valid:true,String:\"New Title\"}, got %+v", got.Title)
	}
	// Other text pgtypes remain invalid.
	if got.Description.Valid {
		t.Errorf("Description: want invalid, got %+v", got.Description)
	}
}

// TestBuildUpdateJobParams_NullLocationClears covers the design's
// null-trio: Optional.Set=true,Valid=false must set SetLocation=true
// AND Location.Valid=false, so the SQL `CASE WHEN set_location THEN
// narg::text` clears the column to NULL.
func TestBuildUpdateJobParams_NullLocationClears(t *testing.T) {
	got := buildUpdateJobParams(uuid.New(), uuid.New(), repositories.UpdatePatch{
		Location: valueobjects.Optional[string]{Set: true, Valid: false},
	}, time.Now())

	if !got.SetLocation {
		t.Errorf("SetLocation: want true on explicit null, got false")
	}
	if got.Location.Valid {
		t.Errorf("Location: want invalid (null), got %+v", got.Location)
	}
}

// TestBuildUpdateJobParams_LocationValueSets mirrors the null case for
// the value side: Optional.Set=true,Valid=true,Value populated must
// set SetLocation=true AND Location.Valid=true,Location.String=value.
func TestBuildUpdateJobParams_LocationValueSets(t *testing.T) {
	got := buildUpdateJobParams(uuid.New(), uuid.New(), repositories.UpdatePatch{
		Location: valueobjects.Optional[string]{Set: true, Valid: true, Value: "CDMX"},
	}, time.Now())

	if !got.SetLocation {
		t.Errorf("SetLocation: want true on value, got false")
	}
	if !got.Location.Valid || got.Location.String != "CDMX" {
		t.Errorf("Location: want {Valid:true,String:\"CDMX\"}, got %+v", got.Location)
	}
}

// TestBuildUpdateJobParams_LocationAbsentUntouched covers the absent
// state: Optional.Set=false must produce SetLocation=false AND
// Location.Valid=false so the SQL CASE branch keeps the existing column.
func TestBuildUpdateJobParams_LocationAbsentUntouched(t *testing.T) {
	got := buildUpdateJobParams(uuid.New(), uuid.New(), repositories.UpdatePatch{}, time.Now())

	if got.SetLocation {
		t.Errorf("SetLocation: want false (absent), got true")
	}
	if got.Location.Valid {
		t.Errorf("Location: want invalid (absent), got %+v", got.Location)
	}
}

// TestBuildUpdateJobParams_SalaryMinAndMax exercises the int pair for
// both null and value cases, mirroring the location pair.
func TestBuildUpdateJobParams_SalaryMinAndMax(t *testing.T) {
	got := buildUpdateJobParams(uuid.New(), uuid.New(), repositories.UpdatePatch{
		SalaryMin: valueobjects.Optional[int]{Set: true, Valid: true, Value: 40000},
		SalaryMax: valueobjects.Optional[int]{Set: true, Valid: false}, // explicit null
	}, time.Now())

	if !got.SetSalaryMin || !got.SalaryMin.Valid || got.SalaryMin.Int32 != 40000 {
		t.Errorf("SalaryMin: want {Set:true,Valid:true,Int32:40000}, got set=%v valid=%v int=%+v",
			got.SetSalaryMin, got.SalaryMin.Valid, got.SalaryMin)
	}
	if !got.SetSalaryMax || got.SalaryMax.Valid {
		t.Errorf("SalaryMax: want {Set:true,Valid:false}, got set=%v valid=%v",
			got.SetSalaryMax, got.SalaryMax.Valid)
	}
}

// TestBuildUpdateJobParams_StatusCanonicalizes covers the closed-set
// status: a *JobStatus must serialize via .String() (canonical wire
// form, e.g. "published", not the iota int).
func TestBuildUpdateJobParams_StatusCanonicalizes(t *testing.T) {
	status := valueobjects.Published
	got := buildUpdateJobParams(uuid.New(), uuid.New(), repositories.UpdatePatch{
		Status: &status,
	}, time.Now())

	if !got.Status.Valid || got.Status.String != "published" {
		t.Errorf("Status: want {Valid:true,String:\"published\"}, got %+v", got.Status)
	}
}

// TestBuildUpdateJobParams_StatusAbsentStaysInvalid covers the
// "no status transition" path: Status == nil (untouched) must produce
// pgtype.Text.Valid=false so the SQL `COALESCE(NULL, status)` keeps
// the column.
func TestBuildUpdateJobParams_StatusAbsentStaysInvalid(t *testing.T) {
	got := buildUpdateJobParams(uuid.New(), uuid.New(), repositories.UpdatePatch{}, time.Now())

	if got.Status.Valid {
		t.Errorf("Status: want invalid, got %+v", got.Status)
	}
}

// --- toJobForUpdateEntity -----------------------------------------------

// TestToJobForUpdateEntity_FullRow rebuilds the domain entity from a
// fully-populated sqlc row. Every VO parses, optional DB columns map
// to pointers, UpdatedAt is populated, CompanyRef carries through.
func TestToJobForUpdateEntity_FullRow(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-0000000000aa")
	companyID := uuid.MustParse("018e0000-0000-7000-8000-000000000001")
	pub := time.Date(2026, 8, 24, 12, 0, 0, 0, time.UTC)
	updated := time.Date(2026, 8, 24, 12, 5, 0, 0, time.UTC)

	row := db.GetJobForUpdateRow{
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
		PublishedAt:    pgtype.Timestamptz{Time: pub, Valid: false},
		UpdatedAt:      pgtype.Timestamptz{Time: updated, Valid: true},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
	}

	got, err := toJobForUpdateEntity(row)
	if err != nil {
		t.Fatalf("toJobForUpdateEntity: %v", err)
	}

	if got.ID != id {
		t.Errorf("ID: %v", got.ID)
	}
	if got.Title != "Backend Engineer" {
		t.Errorf("Title: %q", got.Title)
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
	if got.JobStatus != valueobjects.Draft {
		t.Errorf("JobStatus: want Draft, got %v", got.JobStatus)
	}
	if got.SalaryCurrency != valueobjects.MXN {
		t.Errorf("SalaryCurrency: want MXN, got %v", got.SalaryCurrency)
	}
	if got.Location == nil || *got.Location != "CDMX" {
		t.Errorf("Location: want CDMX, got %v", got.Location)
	}
	if got.SalaryMin == nil || *got.SalaryMin != 40000 {
		t.Errorf("SalaryMin: want 40000, got %v", got.SalaryMin)
	}
	if got.SalaryMax == nil || *got.SalaryMax != 60000 {
		t.Errorf("SalaryMax: want 60000, got %v", got.SalaryMax)
	}
	if got.PublishedAt != nil {
		t.Errorf("PublishedAt: want nil, got %v", got.PublishedAt)
	}
	if !got.UpdatedAt.Equal(updated) {
		t.Errorf("UpdatedAt: want %v, got %v", updated, got.UpdatedAt)
	}
	if got.Company.ID != companyID || got.Company.Name != "Acme SA" {
		t.Errorf("Company: want {%v, \"Acme SA\"}, got %+v", companyID, got.Company)
	}
}

// TestToJobForUpdateEntity_NullableFieldsUnset covers the all-NULL
// optional case (a draft with no salary, no location, no publish).
func TestToJobForUpdateEntity_NullableFieldsUnset(t *testing.T) {
	id := uuid.New()
	companyID := uuid.New()
	updated := time.Now().UTC()

	row := db.GetJobForUpdateRow{
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
		Status:         "draft",
		PublishedAt:    pgtype.Timestamptz{Valid: false},
		UpdatedAt:      pgtype.Timestamptz{Time: updated, Valid: true},
		CompanyID:      companyID,
		CompanyName:    "Acme SA",
	}

	got, err := toJobForUpdateEntity(row)
	if err != nil {
		t.Fatalf("toJobForUpdateEntity: %v", err)
	}
	if got.Location != nil {
		t.Errorf("Location: want nil, got %v", got.Location)
	}
	if got.SalaryMin != nil || got.SalaryMax != nil {
		t.Errorf("SalaryMin/Max: want both nil, got %v %v", got.SalaryMin, got.SalaryMax)
	}
	if got.PublishedAt != nil {
		t.Errorf("PublishedAt: want nil, got %v", got.PublishedAt)
	}
}

// TestToJobForUpdateEntity_InvalidStatus_FailsLoud mirrors the read
// path's "fail loud on corrupted row" invariant.
func TestToJobForUpdateEntity_InvalidStatus_FailsLoud(t *testing.T) {
	row := db.GetJobForUpdateRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "remote",
		EmploymentType: "full_time",
		Seniority:      "mid",
		SalaryCurrency: "MXN",
		Status:         "not_a_real_status",
		UpdatedAt:      pgtype.Timestamptz{Valid: true},
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
	}
	_, err := toJobForUpdateEntity(row)
	if !errors.Is(err, valueobjects.ErrInvalidJobStatus) {
		t.Errorf("want ErrInvalidJobStatus, got %v", err)
	}
}

// TestToJobForUpdateEntity_InvalidWorkMode_FailsLoud mirrors the
// read-path invalid-WO invariant for the write projection.
func TestToJobForUpdateEntity_InvalidWorkMode_FailsLoud(t *testing.T) {
	row := db.GetJobForUpdateRow{
		ID:             uuid.New(),
		Title:          "X",
		Description:    "Y",
		WorkMode:       "telecommute",
		EmploymentType: "full_time",
		Seniority:      "mid",
		SalaryCurrency: "MXN",
		Status:         "draft",
		UpdatedAt:      pgtype.Timestamptz{Valid: true},
		CompanyID:      uuid.New(),
		CompanyName:    "Acme SA",
	}
	_, err := toJobForUpdateEntity(row)
	if !errors.Is(err, valueobjects.ErrInvalidWorkMode) {
		t.Errorf("want ErrInvalidWorkMode, got %v", err)
	}
}

// --- mapUpdateError -----------------------------------------------------

// TestMapUpdateError_NilReturnsNil covers the trivial pass-through.
func TestMapUpdateError_NilReturnsNil(t *testing.T) {
	if got := mapUpdateError(nil); got != nil {
		t.Errorf("nil in: want nil out, got %v", got)
	}
}

// TestMapUpdateError_CheckViolationMapsToErrInvalidStatusTransition is
// the SQLSTATE 23514 → ErrInvalidStatusTransition mapping. The use case
// is the primary gate (it blocks illegal transitions), so this branch
// is unreachable in the designed flow; the test exists so a future
// regression still produces a domain sentinel instead of a leaked
// pgconn.PgError (which the HTTP layer would map to 500).
func TestMapUpdateError_CheckViolationMapsToErrInvalidStatusTransition(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "23514", Message: "jobs_published_integrity_check"}
	got := mapUpdateError(pgErr)
	if !errors.Is(got, entities.ErrInvalidStatusTransition) {
		t.Errorf("want ErrInvalidStatusTransition, got %v", got)
	}
}

// TestMapUpdateError_WrappedPgErrorStillMaps covers the
// `fmt.Errorf("...: %w", pgErr)` case: errors.As must reach the
// PgError so the SQLSTATE classification still runs.
func TestMapUpdateError_WrappedPgErrorStillMaps(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "23514", Message: "jobs_published_integrity_check"}
	wrapped := errors.Join(errors.New("driver: "), pgErr)
	got := mapUpdateError(wrapped)
	if !errors.Is(got, entities.ErrInvalidStatusTransition) {
		t.Errorf("want ErrInvalidStatusTransition, got %v", got)
	}
}

// TestMapUpdateError_UnknownPgCodePassesThrough covers a PgError with
// an unrelated code: the adapter must NOT coerce it to a sentinel;
// pass-through is the safe default (HTTP 500 with a generic body).
func TestMapUpdateError_UnknownPgCodePassesThrough(t *testing.T) {
	pgErr := &pgconn.PgError{Code: "42P01", Message: "undefined_table"}
	got := mapUpdateError(pgErr)
	if !errors.Is(got, pgErr) {
		t.Errorf("want passthrough (errors.Is pgErr), got %v", got)
	}
}

// TestMapUpdateError_NonPgErrorPassesThrough covers the "not a pg
// error" case: the adapter must not coerce connection failures,
// context cancellations, etc., into 4xx sentinels.
func TestMapUpdateError_NonPgErrorPassesThrough(t *testing.T) {
	plain := errors.New("dial tcp: connection refused")
	got := mapUpdateError(plain)
	if !errors.Is(got, plain) {
		t.Errorf("want passthrough (errors.Is plain), got %v", got)
	}
}
