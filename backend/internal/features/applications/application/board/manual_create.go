package board

import (
	"context"
	"errors"
	"github.com/google/uuid"
)

// ManualCVInspector is adapted to the candidate CV inspector at composition time.
// Adapters translate its errors to these feature-owned sentinels.
type ManualCVInspector interface {
	Inspect(name string, content []byte) (string, error)
}
type ManualFileStorage interface {
	Put(content []byte) (string, error)
	Delete(key string) error
}

var (
	ErrManualCVContentMismatch   = errors.New("cv_content_mismatch")
	ErrManualCVUnsupportedType   = errors.New("cv_unsupported_type")
	ErrManualCVTooLarge          = errors.New("cv_too_large")
	ErrManualIdempotencyConflict = errors.New("idempotency_conflict")
)

type ManualInput struct {
	Data, CV       []byte
	FileName       string
	IdempotencyKey uuid.UUID
}

// ManualCreatedBody uses the full GET-board item, not Moved's deliberately
// restricted mutation serialization. Keep Item first to preserve GET key order.
type ManualCreatedBody struct {
	Item
	Coverage Coverage `json:"coverage"`
	Delivery Delivery `json:"delivery"`
}

// ManualCreated retains the exact original 201 representation, including its ETag.
type ManualCreated struct {
	Body     []byte
	ETag     string
	Replayed bool
}
type ManualCreateStore interface {
	CreateManual(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, ManualInput, ManualCVInspector, ManualFileStorage) (ManualCreated, error)
}
type PossibleDuplicates struct {
	Matches []DuplicateMatch `json:"matches"`
}

func (*PossibleDuplicates) Error() string { return "possible_duplicates" }

type CandidateAlreadyInProcess struct {
	ParticipationID uuid.UUID `json:"participation_id"`
}

func (*CandidateAlreadyInProcess) Error() string { return "candidate_already_in_process" }
