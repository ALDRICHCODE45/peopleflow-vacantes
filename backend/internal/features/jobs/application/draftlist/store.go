package draftlist

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Request is one validated list page request.
type Request struct {
	Limit int
	After *Cursor
}

// Requester is the draft requester reference. ID is nil when the draft names
// only a kind; Name is the catalog name and is nil exactly when ID is nil.
type Requester struct {
	Kind string
	ID   *string
	Name *string
}

// Principal is the draft principal recruiter. Name is nil when the user row
// is soft-deleted.
type Principal struct {
	ID   uuid.UUID
	Name *string
}

// Item is one draft row of the list. Title, WorkMode and Schedule are nil
// when the draft has none; their values are the draft field codes.
type Item struct {
	ID        uuid.UUID
	Title     *string
	WorkMode  *string
	Schedule  *string
	Requester *Requester
	Principal Principal
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Page is one list page. NextCursor is empty on the last page.
type Page struct {
	Items      []Item
	NextCursor string
}

// Lister lists the schema-2 drafts the actor may read in the session company:
// every draft for the owner, only the actor's principal drafts otherwise.
// Gate failures return the shared drafts sentinels.
type Lister interface {
	ListV2(ctx context.Context, companyID, actorID uuid.UUID, req Request) (Page, error)
}
