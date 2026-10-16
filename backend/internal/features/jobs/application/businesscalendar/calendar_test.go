package businesscalendar

import (
	"reflect"
	"testing"
	"time"
)

func date(t *testing.T, s string) time.Time {
	t.Helper()
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func TestIsBusinessDay_Article74(t *testing.T) {
	for _, s := range []string{"2026-01-01", "2026-02-02", "2026-03-16", "2026-05-01", "2026-09-16", "2026-11-16", "2026-12-25", "2027-01-01", "2027-02-01", "2027-03-15", "2027-11-15", "2030-10-01", "2036-10-01", "2026-10-17", "2026-10-18"} {
		t.Run(s, func(t *testing.T) {
			if IsBusinessDay(date(t, s)) {
				t.Fatal("expected non-business day")
			}
		})
	}
	for _, s := range []string{"2026-02-03", "2026-03-17", "2026-11-17", "2027-02-02", "2027-03-16", "2027-11-16", "2026-10-01", "2024-10-01", "2026-10-16", "2028-02-29"} {
		t.Run(s, func(t *testing.T) {
			if !IsBusinessDay(date(t, s)) {
				t.Fatal("expected business day")
			}
		})
	}
}

func TestNonBusinessDates_InclusiveAscendingUnique(t *testing.T) {
	cases := []struct {
		name, start, end string
		want             []string
	}{
		{"holiday and weekend", "2026-11-13", "2026-11-17", []string{"2026-11-14", "2026-11-15", "2026-11-16"}},
		{"holiday on weekend once", "2027-12-24", "2027-12-27", []string{"2027-12-25", "2027-12-26"}},
		{"year boundary", "2026-12-31", "2027-01-03", []string{"2027-01-01", "2027-01-02", "2027-01-03"}},
		{"single holiday", "2030-10-01", "2030-10-01", []string{"2030-10-01"}},
		{"single business", "2026-10-01", "2026-10-01", []string{}},
		{"reversed", "2026-10-02", "2026-10-01", []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NonBusinessDates(date(t, tc.start), date(t, tc.end)); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}
