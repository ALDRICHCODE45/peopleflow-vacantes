package inbox

import (
	"errors"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func parse(t *testing.T, raw string) (Query, error) {
	t.Helper()
	values, err := url.ParseQuery(raw)
	if err != nil {
		t.Fatalf("test query %q: %v", raw, err)
	}
	return ParseQuery(values)
}

func TestParseQueryDefaults(t *testing.T) {
	q, err := parse(t, "")
	if err != nil {
		t.Fatal(err)
	}
	want := Query{State: StateAll, Limit: 20}
	if !reflect.DeepEqual(q, want) {
		t.Fatalf("got %+v, want %+v", q, want)
	}
}

func TestParseQueryNormalizesLists(t *testing.T) {
	a, b := uuid.MustParse("6f1c0000-0000-4000-8000-000000000001"), uuid.MustParse("0a1c0000-0000-4000-8000-000000000002")
	q, err := parse(t, "state=unread&limit=50&types=delivery_overdue,application_received,delivery_overdue&job_ids="+a.String()+","+strings.ToUpper(b.String()))
	if err != nil {
		t.Fatal(err)
	}
	want := Query{State: StateUnread, Limit: 50, Types: []string{"application_received", "delivery_overdue"}, JobIDs: []uuid.UUID{b, a}}
	if !reflect.DeepEqual(q, want) {
		t.Fatalf("got %+v, want %+v", q, want)
	}
}

func TestParseQueryIgnoresUnknownParams(t *testing.T) {
	if _, err := parse(t, "_=123&state=all"); err != nil {
		t.Fatalf("unknown params must be ignored: %v", err)
	}
}

func TestParseQueryRejectsInvalidFilters(t *testing.T) {
	fourteen := "application_received,delivery_due_soon,delivery_overdue,assignment_deadline_due_soon,assignment_deadline_overdue,vacancy_assigned,vacancy_reassigned,vacancy_unassigned,vacancy_team_added,psychometric_completed,psychometric_pending,candidate_status_changed,candidate_message_received,candidate_test_pending"
	if _, err := parse(t, "types="+fourteen); err != nil {
		t.Fatalf("the 14 types are valid: %v", err)
	}
	ids := make([]string, 21)
	for i := range ids {
		ids[i] = uuid.NewString()
	}
	cases := []struct {
		raw  string
		want []Field
	}{
		{"state=read", []Field{{"state", "invalid"}}},
		{"state=", []Field{{"state", "invalid"}}},
		{"state=all&state=unread", []Field{{"state", "duplicate"}}},
		{"types=bogus", []Field{{"types", "invalid"}}},
		{"types=", []Field{{"types", "invalid"}}},
		{"types=application_received,", []Field{{"types", "invalid"}}},
		{"types=" + fourteen + ",application_received", []Field{{"types", "too_many"}}},
		{"types=application_received&types=delivery_overdue", []Field{{"types", "duplicate"}}},
		{"job_ids=nope", []Field{{"job_ids", "invalid"}}},
		{"job_ids=00000000-0000-0000-0000-000000000000", []Field{{"job_ids", "invalid"}}},
		{"job_ids=" + strings.Join(ids[:20], ","), nil},
		{"job_ids=" + strings.Join(ids, ","), []Field{{"job_ids", "too_many"}}},
		{"limit=0", []Field{{"limit", "invalid"}}},
		{"limit=51", []Field{{"limit", "invalid"}}},
		{"limit=abc", []Field{{"limit", "invalid"}}},
		{"limit=+5", []Field{{"limit", "invalid"}}},
		{"limit=", []Field{{"limit", "invalid"}}},
		{"state=x&limit=0&types=bogus&job_ids=x", []Field{{"job_ids", "invalid"}, {"limit", "invalid"}, {"state", "invalid"}, {"types", "invalid"}}},
	}
	for _, tc := range cases {
		_, err := parse(t, tc.raw)
		if tc.want == nil {
			if err != nil {
				t.Errorf("%q: unexpected error %v", tc.raw, err)
			}
			continue
		}
		var invalid *InvalidFilter
		if !errors.As(err, &invalid) {
			t.Errorf("%q: error = %v, want InvalidFilter", tc.raw, err)
			continue
		}
		if !reflect.DeepEqual(invalid.Fields, tc.want) {
			t.Errorf("%q: fields = %+v, want %+v", tc.raw, invalid.Fields, tc.want)
		}
	}
}

func TestCursorRoundTripIsBoundToTheFilters(t *testing.T) {
	job := uuid.NewString()
	q, err := parse(t, "state=unread&types=application_received,vacancy_assigned&job_ids="+job)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 26, 18, 41, 10, 123456000, time.UTC)
	cursor := EncodeCursor(q, Position{At: at, GroupKey: "applications:" + job + ":2026-11-26"})

	// Same filters in another order and another limit: accepted.
	next, err := parse(t, "limit=5&job_ids="+job+"&types=vacancy_assigned,application_received&state=unread&cursor="+url.QueryEscape(cursor))
	if err != nil {
		t.Fatal(err)
	}
	if next.After == nil || !next.After.At.Equal(at) || next.After.GroupKey != "applications:"+job+":2026-11-26" {
		t.Fatalf("after = %+v", next.After)
	}

	for _, raw := range []string{
		"state=all&types=application_received,vacancy_assigned&job_ids=" + job, // other state
		"state=unread&types=application_received&job_ids=" + job,               // other types
		"state=unread&types=application_received,vacancy_assigned",             // other jobs
	} {
		if _, err := parse(t, raw+"&cursor="+url.QueryEscape(cursor)); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("%q: err = %v, want ErrInvalidCursor", raw, err)
		}
	}
	for _, bad := range []string{"", "@@", "e30", strings.Repeat("A", 5000), cursor + "A"} {
		if _, err := parse(t, "state=unread&types=application_received,vacancy_assigned&job_ids="+job+"&cursor="+url.QueryEscape(bad)); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("cursor %.20q: err = %v, want ErrInvalidCursor", bad, err)
		}
	}
	// A filter error wins over a bad cursor.
	var invalid *InvalidFilter
	if _, err := parse(t, "state=bogus&cursor=@@"); !errors.As(err, &invalid) {
		t.Fatalf("err = %v, want InvalidFilter", err)
	}
}
