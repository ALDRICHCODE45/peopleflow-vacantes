package drafts

import (
	"context"

	"github.com/google/uuid"
)

// V2Saver is the explicit schema-2 save capability, not a partial Store.
// SaveV2 patches a schema-2 employer draft under a strong r2 If-Match
// precondition. Supplied field groups fully replace the stored groups; absent
// fields, array order and the private evaluated answer keys are preserved.
// Authorization and requester validation are transactional; the schema gate
// and precondition are evaluated after resource authorization. A normalized
// no-op returns the current envelope byte-for-byte without bumping the
// version, changing timestamps or writing an audit event; a real change
// increments the version once under CAS and co-writes the save audit event
// atomically. Save never touches create idempotency records. Every error
// returns a zero Result. No HTTP route is wired to this capability.
type V2Saver interface {
	SaveV2(ctx context.Context, companyID, actorID, id uuid.UUID, ifMatch string, present bool, body []byte) (Result, error)
}
