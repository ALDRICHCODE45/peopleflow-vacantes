// Package stakeholdervacancies holds the port of the stakeholder's own vacancy list
// (GET /v2/me/company/stakeholder/vacancies, docs/contracts/placement-vacancy-documents-v1.md, P7c): every vacancy of the company,
// never-published drafts included, as a small read-only row. It performs no IO.
//
// The request is the job-drafts list's keyset page without filters: limit bounds, the opaque cursor and the order
// (updated_at DESC, id DESC) are draftlist's, so the two lists cannot drift.
package stakeholdervacancies

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/google/uuid"
)

// Request is one validated page request: the page size (draftlist.DefaultLimit..draftlist.MaxLimit) and the position after
// the last row of the previous page, nil for the first page.
type Request struct {
	Limit int
	After *draftlist.Cursor
}

// Row is one vacancy. Publication, Process and Visibility are the lifecycle's values (GET V/lifecycle and the document overview
// header): publication published|paused|closed, process active|finished, visibility public|private, all nil for a draft that never
// published. Kind is original|replacement. CloseReason is the lifecycle's name of the close reason, nil unless the vacancy is
// closed. Coverage is the job-drafts list row's (nil exactly when the draft has never been published). DocumentsCount is the
// vacancy's documents plus those of its participations, never links.
type Row struct {
	ID             uuid.UUID
	Title          *string
	Publication    *string
	Process        *string
	Kind           string
	Visibility     *string
	CloseReason    *string
	Coverage       *draftlist.Coverage
	DocumentsCount int64
}

// StatusCounts are exact counts over the list's whole scope (audit gap D20), one bucket per tab of the list, derived from the
// row's Publication alone: nil → Draft, published → Active, paused → Paused, closed → Closed (process active or finished).
// All is the scope's size and always equals the sum of the four buckets.
type StatusCounts struct {
	All    int64
	Draft  int64
	Active int64
	Paused int64
	Closed int64
}

// Page is one page of rows; NextCursor is the opaque token of the next page, empty on the last one. CountsByStatus is set on
// the first page (no cursor) only, read in the same statement as the rows; it is nil on every cursor page.
type Page struct {
	Items          []Row
	NextCursor     string
	CountsByStatus *StatusCounts
}

// Lister reads one page for the caller. Implementations authorize the caller as owner or stakeholder of companyID.
type Lister interface {
	ListStakeholderVacancies(ctx context.Context, companyID, actorID uuid.UUID, req Request) (Page, error)
}
