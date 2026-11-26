package schedule

import (
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

// D20: today is the local date in America/Mexico_City, not the UTC date.
func TestTodayIsTheMexicoCityDate(t *testing.T) {
	cases := map[string]struct {
		now  time.Time
		want time.Time
	}{
		"23:30 MX on the 26th is 05:30Z on the 27th": {time.Date(2026, 11, 27, 5, 30, 0, 0, time.UTC), day(2026, 11, 26)},
		"00:30 MX on the 27th is 06:30Z":             {time.Date(2026, 11, 27, 6, 30, 0, 0, time.UTC), day(2026, 11, 27)},
		"midday":                                     {time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC), day(2026, 11, 26)},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if got := Today(c.now); !got.Equal(c.want) || got.Location() != time.UTC {
				t.Fatalf("Today(%s) = %s, want %s", c.now, got, c.want)
			}
		})
	}
}

// §Scheduler date rule: today and today+1 → due soon; before today →
// overdue; later → nothing.
func TestClassifyDateRule(t *testing.T) {
	today := day(2026, 11, 26)
	cases := map[string]struct {
		date time.Time
		want Window
		ok   bool
	}{
		"yesterday":   {day(2026, 11, 25), WindowOverdue, true},
		"long ago":    {day(2025, 1, 1), WindowOverdue, true},
		"today":       {day(2026, 11, 26), WindowDueSoon, true},
		"tomorrow":    {day(2026, 11, 27), WindowDueSoon, true},
		"in two days": {day(2026, 11, 28), "", false},
		"month edge":  {day(2026, 12, 1), "", false},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got, ok := Classify(c.date, today)
			if got != c.want || ok != c.ok {
				t.Fatalf("Classify(%s) = %q,%v want %q,%v", c.date.Format(time.DateOnly), got, ok, c.want, c.ok)
			}
		})
	}
	// A DATE scanned from Postgres can come in another location; only the calendar day counts.
	if got, ok := Classify(time.Date(2026, 11, 27, 0, 0, 0, 0, time.FixedZone("x", -6*3600)), today); got != WindowDueSoon || !ok {
		t.Fatalf("zoned date: %q %v", got, ok)
	}
}

func TestWindowTypesAreTheScheduledTypes(t *testing.T) {
	cases := []struct {
		got, want domain.Type
	}{
		{WindowDueSoon.DeliveryType(), domain.TypeDeliveryDueSoon},
		{WindowOverdue.DeliveryType(), domain.TypeDeliveryOverdue},
		{WindowDueSoon.AssignmentType(), domain.TypeAssignmentDeadlineDueSoon},
		{WindowOverdue.AssignmentType(), domain.TypeAssignmentDeadlineOverdue},
	}
	for _, c := range cases {
		spec, ok := domain.Lookup(c.got)
		if c.got != c.want || !ok || !spec.Scheduled {
			t.Fatalf("type %q want %q (scheduled=%v)", c.got, c.want, spec.Scheduled)
		}
	}
}
