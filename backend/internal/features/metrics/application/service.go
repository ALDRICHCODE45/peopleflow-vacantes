package application

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Service answers the metrics routes from shared snapshots (v2 §2): one load
// per company and period, filtered in Go per request.
type Service struct {
	store     Store
	calendar  Calendar
	now       func() time.Time
	snapshots *snapshots
	// pipelines caches the pipeline snapshot per company (v2 §2).
	pipelines *cache[uuid.UUID, *PipelineData]
	// exportLimit bounds a CSV export (ExportLimit; WithExportLimit in tests).
	exportLimit int
}

// NewService needs the fulfillment business-day calendar; now is the clock of
// the snapshots' as_of (overdue/pending, open tramos) and of their TTL.
func NewService(store Store, calendar Calendar, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	s := &Service{store: store, calendar: calendar, now: now, exportLimit: ExportLimit}
	load := func(ctx context.Context, company uuid.UUID, p Period) (*Dataset, error) {
		return store.Load(ctx, company, Scope{Period: p})
	}
	clock := func() time.Time { return s.now() }
	s.snapshots = newSnapshots(load, clock, SnapshotTTL, SnapshotCapacity, SnapshotTimeout)
	s.pipelines = newCache[uuid.UUID, *PipelineData](clock, SnapshotTTL, SnapshotCapacity, SnapshotTimeout)
	return s
}

// WithClock replaces the clock (tests only).
func (s *Service) WithClock(now func() time.Time) *Service {
	s.now = now
	return s
}

// header is the part every response shares (v2 §3).
type header struct {
	DefinitionsVersion string     `json:"definitions_version"`
	Period             PeriodJSON `json:"period"`
	AsOf               time.Time  `json:"as_of"`
}

// newHeader echoes the period and the snapshot's load instant, in UTC to the
// second.
func newHeader(p Period, asOf time.Time) header {
	return header{DefinitionsVersion, p.JSON(), asOf.UTC().Truncate(time.Second)}
}

// view is a snapshot narrowed by the request's filters; all is the whole
// snapshot (applied_filters names people and vacancies from it).
type view struct {
	data *Dataset
	all  *Dataset
	asOf time.Time
}

// view loads (or reuses) the period's snapshot and applies the requester
// filter and, when recruiter is set, keeps the vacancies where that user has a
// tramo overlapping the period: the loader's scope rules, in Go.
func (s *Service) view(ctx context.Context, company uuid.UUID, p Period, requester RequesterFilter, recruiter *uuid.UUID) (view, error) {
	snap, err := s.snapshots.get(ctx, company, p)
	if err != nil {
		return view{}, err
	}
	return view{snap.Data.narrow(p, requester, recruiter), snap.Data, snap.AsOf}, nil
}

// views loads the period and its previous period in parallel (v2 §4.1), so the
// latency is the slower load, not the sum.
func (s *Service) views(ctx context.Context, company uuid.UUID, p Period, q Query) (current, previous view, err error) {
	var prevErr error
	done := make(chan struct{})
	go func() {
		defer close(done)
		previous, prevErr = s.view(ctx, company, p.Previous(), q.Requester, q.RecruiterID)
	}()
	current, err = s.view(ctx, company, p, q.Requester, q.RecruiterID)
	<-done
	if err == nil {
		err = prevErr
	}
	return current, previous, err
}

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
