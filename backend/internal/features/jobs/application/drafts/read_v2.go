package drafts

import (
	"context"

	"github.com/google/uuid"
)

// V2Reader is an explicit read-only capability, not a partial v2 Store.
// GetV2 fixes the expected schema to 2 on the server; callers cannot select it
// from request input or the stored row. The default Store remains v1.
//
// Authorization precedes schema inspection. Known v1 rows return ErrNotFound;
// corrupt/unknown versions and invalid persisted v2 documents are server errors.
// Every error returns a zero Result. Success contains the employer read envelope
// (including evaluated answer keys), an r2 ETag and Replayed=false. Reads never
// mutate drafts, audit events or idempotency records. This is not a candidate API.
// No HTTP route is wired to this capability yet.
type V2Reader interface {
	GetV2(ctx context.Context, companyID, actorID, id uuid.UUID) (Result, error)
}
