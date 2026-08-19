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

// JobRepository is the persistence port for the public-read jobs
// slice. Search returns visible jobs (status='published',
// deleted_at IS NULL, owning company.status='active') sorted by
// (rank DESC, published_at DESC, id DESC). GetByID returns the same
// visibility-narrowed view by id. Errors.Is(entities.ErrJobNotFound)
// signals "no such visible job" so the HTTP layer can map to 404.
type JobRepository interface {
	Search(ctx context.Context, p SearchParams) ([]entities.Job, error)
	GetByID(ctx context.Context, id uuid.UUID) (*entities.Job, error)
}
