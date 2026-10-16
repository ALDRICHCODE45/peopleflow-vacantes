// Package businesscalendar computes Mexican business dates under art. 74 LFT.
// Inputs are civil dates: their time of day and time zone do not affect the rule.
package businesscalendar

import "time"

func IsBusinessDay(date time.Time) bool {
	d := civil(date)
	if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
		return false
	}
	year, month, day := d.Date()
	switch month {
	case time.January:
		return day != 1
	case time.February:
		return day != monday(year, month, 1)
	case time.March, time.November:
		return day != monday(year, month, 3)
	case time.May:
		return day != 1
	case time.September:
		return day != 16
	case time.October:
		return !(day == 1 && year > 2024 && (year-2024)%6 == 0)
	case time.December:
		return day != 25
	default:
		return true
	}
}

// NonBusinessDates returns every excluded date in the inclusive civil range,
// ascending and once each. Empty and reversed ranges encode as [], never null.
func NonBusinessDates(start, end time.Time) []string {
	out := []string{}
	last := civil(end)
	for d := civil(start); !d.After(last); d = d.AddDate(0, 0, 1) {
		if !IsBusinessDay(d) {
			out = append(out, d.Format(time.DateOnly))
		}
	}
	return out
}

func civil(d time.Time) time.Time {
	y, m, day := d.Date()
	return time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
}

func monday(year int, month time.Month, nth int) int {
	first := time.Date(year, month, 1, 0, 0, 0, 0, time.UTC)
	return 1 + (int(time.Monday)-int(first.Weekday())+7)%7 + 7*(nth-1)
}
