package drafts

import (
	"context"
	"github.com/google/uuid"
)

// V2Writer is the explicit create-only schema-2 capability, not a partial Store.
// CreateV2 fixes the schema server-side and uses the create:v2 idempotency
// namespace. Authorization and requester validation are transactional; replay
// re-authorizes the addressed draft and returns its frozen response unchanged.
// Every error returns a zero Result. No HTTP route is wired to this capability.
type V2Writer interface {
	CreateV2(ctx context.Context, companyID, actorID uuid.UUID, key string, body []byte) (Result, error)
}
