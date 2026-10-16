package publication

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

var ErrAlreadyPublished = errors.New("publication: already published")

// Incomplete is the only error carrying the ordered readiness list.
type Incomplete struct{ Missing []string }

func (e *Incomplete) Error() string { return "publication: incomplete" }

// Store serializes publication with every draft/configuration writer.
// keyPresent distinguishes a missing key from a present empty key; multiple
// header values are joined with commas and fail the UUID shape check.
type Store interface {
	GetPublication(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error)
	Publish(ctx context.Context, companyID, actorID, id uuid.UUID, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error)
}
