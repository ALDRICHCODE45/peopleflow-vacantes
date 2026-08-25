// Package repositories defines the persistence ports for the jobs
// bounded context. The application layer depends only on these
// interfaces; the postgres adapter in infrastructure/postgres is the
// only concrete implementation in this slice.
//
// Read-only slice: only Search and GetByID are exposed. Write flows
// (POST /jobs, status transitions) are out of scope.
package repositories

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// Cursor is the keyset pagination payload. It is intentionally kept in
// the domain layer (rather than application/dtos) so the codec in the
// application layer can depend on a stable domain type, and the port
// below can reference it without dragging in the use case. The
// application codec encodes/decodes this struct to a base64url(JSON)
// string per Decision 3.
//
// Two shapes share the same struct:
//   - Browse mode (Q empty): Rank == nil. The keyset narrows on
//     (PublishedAt, ID) only.
//   - Search mode (Q present): Rank != nil. The keyset narrows on
//     (Rank, PublishedAt, ID) — ts_rank is stable per (doc, query)
//     so the client naturally reuses the same Q and the rank tuple is
//     deterministic (Decision 3 mitigation for deep pagination ties).
type Cursor struct {
	Rank        *float64
	PublishedAt time.Time
	ID          uuid.UUID
}

// SearchParams is the typed input for JobRepository.Search. Every
// filter is a *string so the caller can pass nil to mean "no filter"
// (which the adapter turns into a degenerate TRUE predicate). Limit
// is the page size; the adapter requests limit+1 internally and the
// application layer trims the extra row before encoding the next
// cursor.
//
// Cursor may be nil for the first page.
type SearchParams struct {
	// Q is the full-text search term (browser-passed via `q`).
	Q *string
	// Closed-set filters: each is a *string the adapter maps through
	// valueobjects.Parse* before the SQL predicate.
	Seniority      *string
	WorkMode       *string
	EmploymentType *string
	Location       *string
	SalaryCurrency *string

	// Cursor is the keyset anchor. Nil on first page.
	Cursor *Cursor

	// Limit is the page size. Application layer sets this to 20.
	Limit int
}

// UpdatePatch is the column patch the use case builds and hands to the
// repository's Update method. Three presence states are pinned per field
// so the SQL can express them without a separate flags map:
//
//   - Pointer-typed field (Title, Description, WorkMode, EmploymentType,
//     Seniority, SalaryCurrency, Status): pointer-nil means "leave the
//     column untouched". Pointing at a value means "set this value".
//     Status is a *valueobjects.JobStatus so a parsed value is always
//     canonical.
//   - Optional[T] field (Location, SalaryMin, SalaryMax): the tri-state
//     codec (design D2) distinguishes absent (Set=false, leave column
//     untouched) from explicit null (Set=true,Valid=false, clear to SQL
//     NULL) from a real value (Set=true,Valid=true,Value).
//
// The use case is the single producer of this struct; the adapter is
// the single consumer. No other package touches it.
type UpdatePatch struct {
	Title          *string
	Description    *string
	WorkMode       *valueobjects.WorkMode
	EmploymentType *valueobjects.EmploymentType
	Seniority      *valueobjects.Seniority
	SalaryCurrency *valueobjects.SalaryCurrency
	Location       valueobjects.Optional[string]
	SalaryMin      valueobjects.Optional[int]
	SalaryMax      valueobjects.Optional[int]
	Status         *valueobjects.JobStatus
}

// CreateJobParams is the validated, parsed input the use case hands to
// JobRepository.Create. The use case owns UUID generation (id) and VO
// parsing; the adapter maps VOs to canonical wire strings and optional
// pointers to nullable pgtypes.
//
// SalaryCurrency is always non-nil (the use case defaults nil → MXN per
// design D5); the adapter writes an explicit canonical string and never
// relies on the DB DEFAULT.
type CreateJobParams struct {
	Title          string
	Description    string
	WorkMode       valueobjects.WorkMode
	EmploymentType valueobjects.EmploymentType
	Seniority      valueobjects.Seniority
	Location       *string
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency valueobjects.SalaryCurrency
}

// JobRepository is the persistence port for the jobs slice. It exposes
// the read surface (visibility-narrowed) and the write surface
// (company-scoped, non-visibility-narrowed, gated by design D1-D10).
//
// Read methods:
//
//	Search    — public listing (status='published', deleted_at IS NULL,
//	            owning company.status='active'), keyset-paginated.
//	GetByID   — public detail by id (same visibility rule).
//
// Write methods:
//
//	GetForUpdate — non-visibility-narrowed, company-scoped read used
//	               ONLY by the gated write path. 0 rows (non-existent,
//	               cross-company, soft-deleted) → entities.ErrJobNotFound.
//	Update       — applies the patch atomically, guarded by
//	               (id, company_id, deleted_at IS NULL) and a CAS
//	               `updated_at = casUpdatedAt` in the WHERE clause.
//	               0 rows → entities.ErrJobNotFound (the adapter is
//	               dumb); the use case re-interprets that as
//	               ErrConcurrencyConflict because it already read the
//	               row via GetForUpdate (design D4).
//	Create       — atomically inserts a draft job owned by companyID,
//	               guarded by the active-company predicate inside the
//	               same SQL statement (no TOCTOU). The use case owns
//	               UUID generation; the adapter maps VOs to canonical
//	               wire strings and optional pointers to pgtypes.
//
// Errors.Is(entities.ErrJobNotFound) is the single "no such row" signal
// every READ method emits, so the HTTP layer can map to 404 with a
// single branch. The Create method emits a distinct sentinel pair
// (entities.ErrCompanyNotActive / entities.ErrCompanyGone) per design D7.
type JobRepository interface {
	Search(ctx context.Context, p SearchParams) ([]entities.Job, error)
	GetByID(ctx context.Context, id uuid.UUID) (*entities.Job, error)

	// GetForUpdate is the non-visibility-narrowed, company-scoped read
	// used ONLY by the gated write path (design D1). 0 rows (non-existent,
	// cross-company, soft-deleted) → entities.ErrJobNotFound.
	GetForUpdate(ctx context.Context, id, companyID uuid.UUID) (*entities.JobForUpdate, error)

	// Update applies the patch atomically, guarded by (id, company_id,
	// deleted_at IS NULL) and CAS `updated_at = casUpdatedAt`. 0 rows
	// → entities.ErrJobNotFound (the adapter is dumb); the use case
	// re-interprets that as ErrConcurrencyConflict because it already read
	// the row via GetForUpdate.
	Update(ctx context.Context, id, companyID uuid.UUID, patch UpdatePatch, casUpdatedAt time.Time) error

	// Create atomically inserts a draft job owned by `companyID`,
	// guarded by the active-company predicate inside the same SQL
	// statement (design D1/D2/D3). The use case owns UUID generation
	// (id) and VO parsing; the adapter maps parsed VOs to canonical
	// wire strings and optional pointers to nullable pgtypes.
	//
	// Returns the created row mapped to *entities.JobForUpdate so the
	// use case can reuse `toEditorView` verbatim (design D2 — no
	// parallel projection).
	//
	// Error contract:
	//
	//   - entities.ErrCompanyNotActive       on 0 rows (non-active or
	//                                          — defensively — missing
	//                                          company; the CTE guard
	//                                          surfaces pgx.ErrNoRows
	//                                          and the adapter maps it
	//                                          here).
	//   - entities.ErrCompanyGone            on SQLSTATE 23503 (FK
	//                                          violation on
	//                                          jobs.company_id;
	//                                          defense-in-depth —
	//                                          unreachable via the
	//                                          designed flow).
	//   - entities.ErrInvalidStatusTransition on SQLSTATE 23514
	//                                          (CHECK violation;
	//                                          defense-in-depth — use
	//                                          case parses VOs before
	//                                          SQL).
	//   - any other error                    propagated untouched
	//                                          (HTTP 500).
	Create(ctx context.Context, id, companyID uuid.UUID, params CreateJobParams) (*entities.JobForUpdate, error)
}
