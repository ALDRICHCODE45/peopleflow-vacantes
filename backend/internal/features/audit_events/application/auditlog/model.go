// Package auditlog is the read side of the audit log: the owner's audit screen
// list, its filter catalogs and the audited CSV export (audit-log-v1 §8). The
// write side is the append-only AuditEventRepository port; nothing here
// appends except the export's own AuditLogExported row.
package auditlog

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

const (
	DefaultLimit = 50
	MaxLimit     = 100
	// ExportRowLimit is the production export cap (audit-log-v1 §8.5, D7); the
	// service takes it as a value so tests do not insert 50,000 rows.
	ExportRowLimit = 50_000
	// MaxExportDays bounds an export range, both ends inclusive.
	MaxExportDays = 366
	// TimeZone is the zone of the `from`/`to` days and of occurred_at_mx.
	TimeZone = "America/Mexico_City"
)

var (
	// ErrInvalidCursor: the cursor is malformed, oversized, or bound to another
	// company or filter set.
	ErrInvalidCursor = errors.New("invalid audit cursor")
	// ErrInvalidBody: the export body is not a single JSON object.
	ErrInvalidBody = errors.New("invalid audit export body")
)

// Field is transport-independent validation metadata; the HTTP adapter owns
// its wire shape. Codes: invalid, unknown, duplicate, range, required.
type Field struct {
	Field string
	Code  string
}

// InvalidFilter carries field codes only, never a rejected value.
type InvalidFilter struct{ Fields []Field }

func (*InvalidFilter) Error() string { return "invalid audit filter" }

// TooLarge is the refusal of an export above the row limit; nothing is exported.
type TooLarge struct{ RowCount, Limit int }

func (*TooLarge) Error() string { return "audit export too large" }

// Timestamp marshals as UTC with milliseconds, the shape of the §8.1 example.
type Timestamp struct{ time.Time }

func (t Timestamp) MarshalJSON() ([]byte, error) {
	return json.Marshal(t.UTC().Format("2006-01-02T15:04:05.000Z"))
}

// Actor is {"type":"system"} or a user with the name and email resolved at
// read time (null for a deleted user).
type Actor struct {
	System          bool
	UserID          uuid.UUID
	Name, Email     *string
	IsCurrentMember bool
}

func (a Actor) MarshalJSON() ([]byte, error) {
	if a.System {
		return []byte(`{"type":"system"}`), nil
	}
	return json.Marshal(struct {
		Type            string    `json:"type"`
		UserID          uuid.UUID `json:"user_id"`
		Name            *string   `json:"name"`
		Email           *string   `json:"email"`
		IsCurrentMember bool      `json:"is_current_member"`
	}{"user", a.UserID, a.Name, a.Email, a.IsCurrentMember})
}

type Entity struct {
	Type  string    `json:"type"`
	ID    uuid.UUID `json:"id"`
	Label *string   `json:"label"`
}

type VacancyRef struct {
	ID    uuid.UUID `json:"id"`
	Title *string   `json:"title"`
}

// Item is one row of the list. The shape is closed (audit-log-v1 §8.1).
type Item struct {
	ID         uuid.UUID       `json:"id"`
	OccurredAt Timestamp       `json:"occurred_at"`
	EventType  string          `json:"event_type"`
	Category   string          `json:"category"`
	Actor      Actor           `json:"actor"`
	Entity     Entity          `json:"entity"`
	Vacancy    *VacancyRef     `json:"vacancy"`
	Metadata   json.RawMessage `json:"metadata"`
	IP         *string         `json:"ip"`
	IPSource   *string         `json:"ip_source"`
	UserAgent  *string         `json:"user_agent"`
}

type Page struct {
	Items      []Item  `json:"items"`
	Total      int64   `json:"total"`
	NextCursor *string `json:"next_cursor"`
}

type TypeItem struct {
	EventType string `json:"event_type"`
	Category  string `json:"category"`
}

type TypesResponse struct {
	Items []TypeItem `json:"items"`
}

type ActorOption struct {
	UserID          uuid.UUID `json:"user_id"`
	Name            *string   `json:"name"`
	Email           *string   `json:"email"`
	IsCurrentMember bool      `json:"is_current_member"`
}

type ActorsResponse struct {
	Items []ActorOption `json:"items"`
}

type VacancyOption struct {
	VacancyID uuid.UUID `json:"vacancy_id"`
	Title     *string   `json:"title"`
}

type VacanciesResponse struct {
	Items []VacancyOption `json:"items"`
}

// ExportRow is one CSV row.
type ExportRow struct {
	OccurredAt   time.Time
	EventType    string
	Category     string
	ActorUserID  *uuid.UUID
	ActorName    *string
	ActorEmail   *string
	EntityType   string
	EntityID     uuid.UUID
	EntityLabel  *string
	VacancyID    *uuid.UUID
	VacancyTitle *string
	IP           *string
	UserAgent    *string
	Metadata     json.RawMessage
}

// ExportStream yields the rows counted by RowCount, from the snapshot the
// count ran on. Next returns an empty batch at the end. Close is idempotent
// and must always be called.
type ExportStream interface {
	RowCount() int
	Next(ctx context.Context) ([]ExportRow, error)
	Close() error
}

// ExportRequest asks the store to count, refuse above Limit, otherwise record
// the export (Audit builds the AuditLogExported event from the final row
// count) and commit that record before returning the stream.
type ExportRequest struct {
	Company uuid.UUID
	Filters Filters
	Limit   int
	Audit   func(rowCount int) entities.AuditEvent
}

// Reader is the read port of the audit log.
type Reader interface {
	// List returns up to q.Limit+1 items (the extra one signals a next page)
	// and the exact total for the filters, from one snapshot.
	List(ctx context.Context, company uuid.UUID, q Query) (Page, error)
	Actors(ctx context.Context, company uuid.UUID) ([]ActorOption, error)
	Vacancies(ctx context.Context, company uuid.UUID) ([]VacancyOption, error)
	// Export returns *TooLarge above the limit, writing nothing.
	Export(ctx context.Context, req ExportRequest) (ExportStream, error)
}
