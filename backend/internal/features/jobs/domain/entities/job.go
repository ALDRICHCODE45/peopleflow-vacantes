// Package entities holds the jobs bounded-context domain entities.
//
// The jobs slice is read-only on the public API surface (GET /jobs and
// GET /jobs/{id}); publish/close transitions and write endpoints are
// out of scope for this slice. The entity is therefore a pure read
// model — no factory, no UUID generation — rebuilt by the postgres
// adapter from sqlc rows. Optional DB columns surface as pointers so
// absence (NULL) is distinguishable from a zero value.
package entities

import (
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// ErrJobNotFound is returned by the persistence port when no visible
// row exists for the requested id. The HTTP layer maps this to 404
// per the spec scenario "GET /jobs/{id} hides non-visible jobs".
//
// For the write path (GetForUpdate / Update), ErrJobNotFound surfaces
// non-existent, cross-company, and soft-deleted rows indistinguishably
// per the same-company invariant (D4). The 0-rows case of Update is
// re-interpreted by the use case as ErrConcurrencyConflict, NOT as
// ErrJobNotFound.
var ErrJobNotFound = errors.New("job not found")

// ErrConcurrencyConflict is returned by the EditJob use case when the
// `If-Unmodified-Since` header does not match the row's current
// `updated_at`, OR when the in-flight Update returned 0 rows because
// the row changed between read and write (CAS mismatch in SQL).
//
// The HTTP layer special-cases this sentinel BEFORE classifyError so the
// 409 body is the editor view of the latest row (not a generic 409
// error envelope). The body MUST use the same shape as the 200 response
// so the client can re-read without a second round-trip.
var ErrConcurrencyConflict = errors.New("concurrency conflict")

// ErrInvalidStatusTransition is returned by the EditJob use case when
// the requested `status` is not reachable from the current `status`
// (the D5 transition table) OR when the row is already closed (the
// closed-terminal rule: a closed row rejects ANY body, even with no
// status field).
//
// The HTTP layer maps this sentinel to 400 with the message
// "invalid status transition". The DB CHECK (jobs_published_integrity)
// ALSO produces this sentinel via SQLSTATE 23514 in `mapUpdateError`
// as defense-in-depth: the use case blocks illegal transitions before
// the SQL runs, so this branch is unreachable via the designed flow.
var ErrInvalidStatusTransition = errors.New("invalid status transition")

// ErrEmptyTitle is returned by EditJob when the body's `title` (when
// present) is empty after trim. The HTTP layer maps to 400 with the
// message "title must not be empty". The DB does NOT enforce this rule
// (no schema hardening in this change); the use case is the single
// validation gate.
var ErrEmptyTitle = errors.New("title must not be empty")

// ErrEmptyDescription mirrors ErrEmptyTitle for the `description` field.
var ErrEmptyDescription = errors.New("description must not be empty")

// ErrInvalidSalaryRange is returned by EditJob when BOTH `salary_min`
// and `salary_max` are present and non-null and `salary_min > salary_max`.
// The HTTP layer maps to 400 with the message
// "salary_min must be less than or equal to salary_max". The DB does
// NOT enforce this rule; the use case is the single validation gate.
var ErrInvalidSalaryRange = errors.New("salary_min must be less than or equal to salary_max")

// ErrCompanyNotActive is returned when the owning company is not `active`
// at INSERT time (suspended / pending_verification) or — defensively —
// when the atomic guard yields zero rows because the company is missing.
// The HTTP layer maps this to 409 Conflict ("company is not active").
var ErrCompanyNotActive = errors.New("company is not active")

// ErrCompanyGone is the defense-in-depth sentinel for SQLSTATE 23503
// (foreign_key_violation on jobs.company_id). It is unreachable via the
// designed flow: the `active` CTE filters by `companies.id = $company_id`,
// so a missing company yields zero rows (→ ErrCompanyNotActive), never a
// FK violation. It exists to keep the adapter boundary typed if a future
// query shape drifts. The HTTP layer maps it to 409 Conflict.
var ErrCompanyGone = errors.New("company is gone")

// CompanyRef is the embedded company identity carried in every job
// response: {id, name}. The adapter joins `companies` in the same
// query (Decision 5) so this comes back populated in every row.
type CompanyRef struct {
	ID   uuid.UUID
	Name string
}

// Job is the read model for a public job. The entity holds:
//   - typed VOs for closed-set fields (WorkMode, EmploymentType,
//     Seniority, JobStatus, SalaryCurrency) so unrecognized DB values
//     surface as Parse* sentinels instead of silent zeroing;
//   - pointers for nullable DB columns (Location, SalaryMin,
//     SalaryMax, PublishedAt) so absence is preserved;
//   - the embedded CompanyRef the API serializes as
//     `company: {id, name}`.
//
// The struct has no factory: the adapter populates it directly from
// sqlc rows. There is no `toEntity` here — that mapping lives in the
// postgres adapter (task 7.2), matching the `companies` pattern, and
// the domain package does not import `internal/db`.
type Job struct {
	ID             uuid.UUID
	Title          string
	Description    string
	WorkMode       valueobjects.WorkMode
	EmploymentType valueobjects.EmploymentType
	Seniority      valueobjects.Seniority
	JobStatus      valueobjects.JobStatus

	// Optional DB columns (NULL → nil pointer).
	Location       *string
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency valueobjects.SalaryCurrency

	// PublishedAt is the published timestamp from the row; nil for
	// draft/closed rows (which the read path never returns, but the
	// pointer shape matches the column).
	PublishedAt *time.Time

	// Rank is the ts_rank score from the full-text search predicate.
	// Populated only by JobRepository.Search when `q` is non-empty,
	// so the application layer can encode it into the keyset cursor
	// (Decision 3: search-mode cursor is (rank, published_at, id)).
	// Nil for GetByID and for browse-mode (q absent) Search calls,
	// where the cursor narrows on (published_at, id) only.
	Rank *float64

	Company CompanyRef
}
