package profile

import (
	"context"
	"github.com/google/uuid"
)

type Result struct {
	Body []byte
	ETag string
}
type Store interface {
	GetProfile(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (Result, error)
	PutProfile(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (Result, error)
}
