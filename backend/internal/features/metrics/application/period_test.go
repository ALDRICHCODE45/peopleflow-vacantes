package application

import (
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPeriod_WindowAndMonths(t *testing.T) {
	p, err := NewPeriod("2026-01-15", "2026-03-02")
	if err != nil {
		t.Fatal(err)
	}
	// Mexico City is UTC-6 all year since 2023.
	if got := p.Start.UTC().Format(time.RFC3339); got != "2026-01-15T06:00:00Z" {
		t.Fatalf("start %s", got)
	}
	if got := p.End.UTC().Format(time.RFC3339); got != "2026-03-03T06:00:00Z" {
		t.Fatalf("end %s", got)
	}
	var months []string
	for _, m := range p.Months() {
		months = append(months, m.Key)
	}
	if !reflect.DeepEqual(months, []string{"2026-01", "2026-02", "2026-03"}) {
		t.Fatalf("months %v", months)
	}
	first := p.Months()[0]
	if !first.Start.Equal(p.Start) || first.End.UTC().Format(time.RFC3339) != "2026-02-01T06:00:00Z" {
		t.Fatalf("first month window %v %v", first.Start, first.End)
	}
	if last := p.Months()[2]; !last.End.Equal(p.End) {
		t.Fatalf("last month end %v", last.End)
	}
	// 05:59Z on the 15th is still the 14th in Mexico City.
	if p.Contains(time.Date(2026, 1, 15, 5, 59, 0, 0, time.UTC)) || !p.Contains(time.Date(2026, 1, 15, 6, 0, 0, 0, time.UTC)) {
		t.Fatal("contains boundary")
	}
	if !p.ContainsDate("2026-03-02") || p.ContainsDate("2026-03-03") || p.ContainsDate("2026-01-14") {
		t.Fatal("contains date")
	}
}

func TestBusinessDays(t *testing.T) {
	// A Mon–Fri calendar with Jan 1 off, enough to pin the endpoint rule.
	cal := func(d time.Time) bool {
		return d.Weekday() != time.Saturday && d.Weekday() != time.Sunday && !(d.Month() == time.January && d.Day() == 1)
	}
	b := Calendar(cal)
	day := func(s string) time.Time { d, _ := time.Parse(time.DateOnly, s); return d }
	for _, tc := range []struct {
		from, to string
		want     int
	}{
		{"2026-01-05", "2026-01-05", 0}, // same day
		{"2026-01-05", "2026-01-09", 4}, // Mon→Fri excludes Monday
		{"2026-01-09", "2026-01-12", 1}, // Fri→Mon skips the weekend
		{"2025-12-31", "2026-01-02", 1}, // Jan 1 excluded
		{"2026-01-09", "2026-01-05", 0}, // reversed clamps to 0
	} {
		if got := b.Between(day(tc.from), day(tc.to)); got != tc.want {
			t.Fatalf("%s→%s = %d, want %d", tc.from, tc.to, got, tc.want)
		}
	}
}

func TestShapes(t *testing.T) {
	if r := NewRate(0, 0); r.Value != nil || r.Numerator != 0 || r.Denominator != 0 {
		t.Fatalf("%+v", r)
	}
	if r := NewRate(2, 3); r.Value == nil || *r.Value != 0.6667 {
		t.Fatalf("%+v", r)
	}
	if m := Median(nil); m != nil {
		t.Fatal("median of nothing")
	}
	if m := Median([]int{5, 1, 3}); m == nil || *m != 3 {
		t.Fatal("odd median")
	}
	if m := Median([]int{4, 1, 3, 2}); m == nil || *m != 2.5 {
		t.Fatal("even median")
	}
}

func TestCursor_RoundTripAndScope(t *testing.T) {
	company := uuid.New()
	q, err := ParseQuery("from=2026-01-01&to=2026-01-31", RouteRecruiters)
	if err != nil {
		t.Fatal(err)
	}
	name := "Ana"
	id := uuid.New()
	token, err := EncodeCursor(company, RouteRecruiters, q, Position{Key: &name, ID: id})
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeCursor(company, RouteRecruiters, q, token)
	if err != nil || got.Key == nil || *got.Key != name || got.ID != id {
		t.Fatalf("%+v %v", got, err)
	}
	nilKey, _ := EncodeCursor(company, RouteRecruiters, q, Position{ID: id})
	if got, err := DecodeCursor(company, RouteRecruiters, q, nilKey); err != nil || got.Key != nil {
		t.Fatalf("nil key: %+v %v", got, err)
	}
	other, _ := ParseQuery("from=2026-01-01&to=2026-02-01", RouteRecruiters)
	for name, decode := range map[string]func() (Position, error){
		"other company": func() (Position, error) { return DecodeCursor(uuid.New(), RouteRecruiters, q, token) },
		"other filters": func() (Position, error) { return DecodeCursor(company, RouteRecruiters, other, token) },
		"other route":   func() (Position, error) { return DecodeCursor(company, RouteVacancies, q, token) },
		"garbage":       func() (Position, error) { return DecodeCursor(company, RouteRecruiters, q, "!!") },
		"empty":         func() (Position, error) { return DecodeCursor(company, RouteRecruiters, q, "") },
	} {
		if _, err := decode(); err != ErrInvalidCursor {
			t.Fatalf("%s: %v", name, err)
		}
	}
}
