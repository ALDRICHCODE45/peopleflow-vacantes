package application

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

var ErrSlugTaken = errors.New("slug taken")
var ErrVersionConflict = errors.New("site version conflict")

type PublishBlocked struct{ Issues []Issue }

func (e *PublishBlocked) Error() string { return "site publication blocked" }

type InvalidFields struct{ Fields []Field }

func (e *InvalidFields) Error() string { return "invalid site fields" }

type Published struct {
	Version     int64     `json:"version"`
	Slug        string    `json:"slug"`
	PublishedAt time.Time `json:"published_at"`
}

// Media is one upload as listed to clients. Width and height are null only for
// a hero video whose dimensions are unknown; duration_ms is present only for
// hero videos (image JSON is unchanged).
type Media struct {
	ID         uuid.UUID `json:"id"`
	Kind       string    `json:"kind"`
	URL        string    `json:"url"`
	Width      *int      `json:"width"`
	Height     *int      `json:"height"`
	DurationMS *int64    `json:"duration_ms,omitempty"`
}

// Size returns a pointer to n (image dimensions are always known).
func Size(n int) *int { return &n }

type Current struct {
	Draft                 json.RawMessage `json:"draft"`
	DraftVersion          int64           `json:"draft_version"`
	Published             *Published      `json:"published"`
	HasUnpublishedChanges bool            `json:"has_unpublished_changes"`
	Media                 []Media         `json:"media"`
	UpdatedAt             time.Time       `json:"updated_at"`
}
type Store interface {
	Get(context.Context, uuid.UUID, uuid.UUID) (Current, error)
	Save(context.Context, uuid.UUID, uuid.UUID, int64, *Document) (Current, error)
	SlugAvailable(context.Context, uuid.UUID, string) (bool, error)
	Publish(context.Context, uuid.UUID, uuid.UUID, int64) (Current, error)
	Unpublish(context.Context, uuid.UUID, uuid.UUID) (Current, error)
}
