package application

import (
	"time"
	_ "time/tzdata" // America/Mexico_City must resolve in minimal containers
)

// zone is the Mexico City location every calendar rule uses (§2.0).
var zone = func() *time.Location {
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		panic(err)
	}
	return loc
}()

// Period is the inclusive [From, To] local date range as the half-open
// instant window [Start, End) (§2.0).
type Period struct {
	From, To   string
	Start, End time.Time
}

// PeriodJSON is the echoed period of every response.
type PeriodJSON struct {
	From     string `json:"from"`
	To       string `json:"to"`
	TimeZone string `json:"time_zone"`
}

// Month is one calendar month touched by the period, clipped to it.
type Month struct {
	Key        string
	Start, End time.Time
}

// NewPeriod builds the window of two validated dates.
func NewPeriod(from, to string) (Period, error) {
	f, err := time.ParseInLocation(time.DateOnly, from, zone)
	if err != nil {
		return Period{}, err
	}
	t, err := time.ParseInLocation(time.DateOnly, to, zone)
	if err != nil {
		return Period{}, err
	}
	return Period{From: from, To: to, Start: f, End: t.AddDate(0, 0, 1)}, nil
}

func (p Period) JSON() PeriodJSON { return PeriodJSON{p.From, p.To, TimeZone} }

// Contains reports whether an instant's local date falls in the period.
func (p Period) Contains(at time.Time) bool { return !at.Before(p.Start) && at.Before(p.End) }

// ContainsDate reports whether a YYYY-MM-DD date falls in the period.
func (p Period) ContainsDate(date string) bool { return date >= p.From && date <= p.To }

// Overlaps reports whether the stay [start, end) (end nil = open) touches the
// window [from, to): the stay started before the window ends and had not ended
// before it began.
func Overlaps(start time.Time, end *time.Time, from, to time.Time) bool {
	return start.Before(to) && (end == nil || !end.Before(from))
}

// Months lists every month the period touches, ascending, clipped to it.
func (p Period) Months() []Month {
	out := []Month{}
	for cur := time.Date(p.Start.Year(), p.Start.Month(), 1, 0, 0, 0, 0, zone); cur.Before(p.End); cur = cur.AddDate(0, 1, 0) {
		m := Month{Key: cur.Format("2006-01"), Start: cur, End: cur.AddDate(0, 1, 0)}
		if m.Start.Before(p.Start) {
			m.Start = p.Start
		}
		if m.End.After(p.End) {
			m.End = p.End
		}
		out = append(out, m)
	}
	return out
}

// LocalDate is the Mexico City date of an instant.
func LocalDate(at time.Time) string { return at.In(zone).Format(time.DateOnly) }

// civilDate parses a YYYY-MM-DD date or the local date of an instant into a
// UTC midnight, the calendar's input.
func civilDate(date string) time.Time {
	d, _ := time.Parse(time.DateOnly, date)
	return d
}

func civilOf(at time.Time) time.Time { return civilDate(LocalDate(at)) }
