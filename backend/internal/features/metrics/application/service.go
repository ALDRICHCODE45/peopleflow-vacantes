package application

import (
	"time"

	"github.com/google/uuid"
)

// Service answers the §3 routes. Every number is computed on request (§3.6).
type Service struct {
	store    Store
	calendar Calendar
	now      func() time.Time
}

// NewService needs the fulfillment business-day calendar; now is the clock of
// overdue/pending and of open tramos.
func NewService(store Store, calendar Calendar, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{store: store, calendar: calendar, now: now}
}

// WithClock replaces the clock (tests only).
func (s *Service) WithClock(now func() time.Time) *Service {
	s.now = now
	return s
}

// header is the part every response shares (§3.0).
type header struct {
	DefinitionsVersion string     `json:"definitions_version"`
	Period             PeriodJSON `json:"period"`
}

func newHeader(p Period) header { return header{DefinitionsVersion, p.JSON()} }

// prepare parses the query and builds its period.
func prepare(raw string, route Route) (Query, Period, error) {
	q, err := ParseQuery(raw, route)
	if err != nil {
		return Query{}, Period{}, err
	}
	p, err := NewPeriod(q.From, q.To)
	return q, p, err
}

// after decodes the page cursor, when one was sent.
func after(company uuid.UUID, route Route, q Query) (*Position, error) {
	if q.Cursor == nil {
		return nil, nil
	}
	p, err := DecodeCursor(company, route, q, *q.Cursor)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// page cuts the sorted items after the cursor position and returns the next
// cursor, null at the end. key and id read an item's sort position.
func page[T any](company uuid.UUID, route Route, q Query, items []T, from *Position, less func(Position, Position) bool, at func(T) Position) ([]T, *string, error) {
	start := 0
	if from != nil {
		for start < len(items) && !less(*from, at(items[start])) {
			start++
		}
	}
	items = items[start:]
	if len(items) <= q.Limit {
		return items, nil, nil
	}
	items = items[:q.Limit]
	token, err := EncodeCursor(company, route, q, at(items[len(items)-1]))
	if err != nil {
		return nil, nil, err
	}
	return items, &token, nil
}
