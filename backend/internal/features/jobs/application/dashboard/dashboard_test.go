package dashboard

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"testing"
	"time"
)

type fakeReader struct {
	value Dashboard
	err   error
}

func (f fakeReader) Dashboard(context.Context, uuid.UUID, uuid.UUID) (Dashboard, error) {
	return f.value, f.err
}
func TestServiceEmptyAndMexicoCityDays(t *testing.T) {
	for _, tc := range []struct{ now, last string }{
		{"2026-10-23T05:59:59Z", "2026-10-22"}, {"2026-10-23T06:00:00Z", "2026-10-23"},
	} {
		t.Run(tc.now, func(t *testing.T) {
			now, _ := time.Parse(time.RFC3339, tc.now)
			s := NewService(fakeReader{}, func() time.Time { return now })
			got, err := s.Read(context.Background(), uuid.New(), uuid.New())
			if err != nil {
				t.Fatal(err)
			}
			if len(got.OriginByDay) != 90 || got.OriginByDay[89].Date != tc.last || got.Recent == nil {
				t.Fatalf("invalid empty dashboard: %+v", got)
			}
			for i, d := range got.OriginByDay {
				if d.Organic != 0 || d.Manual != 0 {
					t.Fatal(d)
				}
				if i > 0 && got.OriginByDay[i-1].Date >= d.Date {
					t.Fatal("not oldest first")
				}
			}
			if got.PublishedVacancies != 0 || got.InProcess != 0 || got.PoolAddedLast7Days != 0 || got.Positions.Covered != 0 || got.Positions.Required != 0 {
				t.Fatal(got)
			}
		})
	}
}
func TestServicePreservesCountsAndFillsDays(t *testing.T) {
	now := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	s := NewService(fakeReader{value: Dashboard{PublishedVacancies: 2, InProcess: 3, PoolAddedLast7Days: 4, Positions: Positions{5, 6}, OriginByDay: []Day{{Date: "2026-10-23", Organic: 2, Manual: 3}, {Date: "2025-01-01", Organic: 99}}}}, func() time.Time { return now })
	got, err := s.Read(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if got.OriginByDay[89].Organic != 2 || got.OriginByDay[89].Manual != 3 || got.Positions.Required != 6 || got.InProcess != 3 || got.PoolAddedLast7Days != 4 {
		t.Fatal(got)
	}
}
func TestServicePropagatesFailure(t *testing.T) {
	want := errors.New("database")
	_, err := NewService(fakeReader{err: want}, time.Now).Read(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, want) {
		t.Fatal(err)
	}
}
