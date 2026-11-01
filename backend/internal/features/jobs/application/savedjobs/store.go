// Package savedjobs defines the candidate's private saved public catalog.
package savedjobs

import (
	"context"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
)

const MaxSaved = 200

var (
	ErrNotFound    = errors.New("saved job not found")
	ErrUnavailable = errors.New("job unavailable")
	ErrLimit       = errors.New("saved jobs limit reached")
)

type Saved struct {
	JobID   uuid.UUID `json:"job_id"`
	SavedAt time.Time `json:"saved_at"`
}
type Application struct {
	ID        uuid.UUID `json:"id"`
	AppliedAt time.Time `json:"applied_at"`
}
type Job struct {
	Source        string                   `json:"source"`
	Title         string                   `json:"title"`
	Company       publicjobs.Company       `json:"company"`
	LocationLabel *string                  `json:"location_label"`
	WorkMode      string                   `json:"work_mode"`
	Compensation  *publicjobs.Compensation `json:"compensation"`
	LegacySalary  *publicjobs.LegacySalary `json:"legacy_salary"`
	PublishedAt   time.Time                `json:"published_at"`
}
type Item struct {
	Saved
	Availability string       `json:"availability"`
	ClosedAt     *time.Time   `json:"closed_at"`
	Application  *Application `json:"application"`
	Job          Job          `json:"job"`
}
type Page struct {
	Items []Item `json:"items"`
	Total int    `json:"total"`
	Limit int    `json:"limit"`
}
type Store interface {
	Save(context.Context, string, uuid.UUID) (Saved, bool, error)
	Remove(context.Context, string, uuid.UUID) error
	RemoveClosed(context.Context, string) (int, error)
	List(context.Context, string) (Page, error)
	IDs(context.Context, string) ([]uuid.UUID, error)
}
