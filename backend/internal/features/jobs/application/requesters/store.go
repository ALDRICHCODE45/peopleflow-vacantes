package requesters

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// Entry is one catalog requester as exposed by the API.
type Entry struct {
	ID   uuid.UUID
	Kind string
	Name string
}

// ListRequest is a validated list request. After is nil on the first page.
type ListRequest struct {
	Kind  string
	Query Query
	Limit int
	After *Cursor
}

// Page is one keyset page. NextCursor is empty on the last page.
type Page struct {
	Items      []Entry
	NextCursor string
}

// AlreadyExistsError reports a duplicate (company, kind, name key). Existing
// is the already-stored entry the caller may select instead; it never crosses
// companies or kinds.
type AlreadyExistsError struct {
	Existing Entry
}

func (e *AlreadyExistsError) Error() string {
	return fmt.Sprintf("requesters: %s %q already exists", e.Existing.Kind, e.Existing.Name)
}

// Store is the persistence port. Authorization (live user, live active
// company, current membership) is re-evaluated inside each operation's
// transaction; no actor or company is ever taken from request bodies.
type Store interface {
	CreateRequester(ctx context.Context, companyID, actorID uuid.UUID, kind string, name valueobjects.RequesterName) (Entry, error)
	ListRequesters(ctx context.Context, companyID, actorID uuid.UUID, req ListRequest) (Page, error)
}
