package application

import (
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

func fieldsOf(t *testing.T, err error) []Field {
	t.Helper()
	var invalid *InvalidFilter
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v, want *InvalidFilter", err)
	}
	return invalid.Fields
}

func TestParseQuery_Valid(t *testing.T) {
	id := uuid.NewString()
	q, err := ParseQuery("from=2026-01-01&to=2026-12-31&recruiter_id="+id+"&requester_kind=client&requester_id=none", RouteSummary)
	if err != nil {
		t.Fatal(err)
	}
	if q.From != "2026-01-01" || q.To != "2026-12-31" || q.RecruiterID == nil || q.RecruiterID.String() != id {
		t.Fatalf("%+v", q)
	}
	if q.Requester != (RequesterFilter{Kind: "client", None: true}) {
		t.Fatalf("requester %+v", q.Requester)
	}
	if q.Limit != DefaultLimit {
		t.Fatalf("limit %d", q.Limit)
	}
}

func TestParseQuery_RequesterSemantics(t *testing.T) {
	id := uuid.NewString()
	for _, tc := range []struct {
		query string
		want  RequesterFilter
	}{
		{"", RequesterFilter{}},
		{"&requester_id=none", RequesterFilter{None: true}},
		{"&requester_kind=internal_area", RequesterFilter{Kind: "internal_area"}},
		{"&requester_kind=client&requester_id=none", RequesterFilter{Kind: "client", None: true}},
		{"&requester_kind=client&requester_id=" + id, RequesterFilter{Kind: "client", ID: uuid.MustParse(id)}},
	} {
		q, err := ParseQuery("from=2026-01-01&to=2026-01-31"+tc.query, RouteSummary)
		if err != nil {
			t.Fatalf("%s: %v", tc.query, err)
		}
		if q.Requester != tc.want {
			t.Fatalf("%s: %+v, want %+v", tc.query, q.Requester, tc.want)
		}
	}
}

func TestParseQuery_Rejections(t *testing.T) {
	for _, tc := range []struct {
		query string
		route Route
		want  []Field
	}{
		{"", RouteSummary, []Field{{"from", "required"}, {"to", "required"}}},
		{"from=2026-02-30&to=2026-03-01", RouteSummary, []Field{{"from", "invalid"}}},
		{"from=2026-3-01&to=2026-03-01", RouteSummary, []Field{{"from", "invalid"}}},
		{"from=2026-03-02&to=2026-03-01", RouteSummary, []Field{{"to", "range"}}},
		// to - from ≤ 365 (M7): 2024 is a leap year, 2024-01-01..2024-12-31 is 365.
		{"from=2024-01-01&to=2024-12-31", RouteSummary, nil},
		{"from=2024-01-01&to=2025-01-01", RouteSummary, []Field{{"to", "range"}}},
		{"from=2026-01-01&to=2026-01-02&recruiter_id=abc", RouteSummary, []Field{{"recruiter_id", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&requester_kind=vendor", RouteSummary, []Field{{"requester_kind", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&requester_id=" + uuid.NewString(), RouteSummary, []Field{{"requester_kind", "required"}}},
		{"from=2026-01-01&to=2026-01-02&requester_id=nope", RouteSummary, []Field{{"requester_id", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&from=2026-01-01", RouteSummary, []Field{{"from", "duplicate"}}},
		{"from=2026-01-01&to=2026-01-02&foo=1", RouteSummary, []Field{{"foo", "unknown"}}},
		{"from=2026-01-01&to=2026-01-02&limit=10", RouteSummary, []Field{{"limit", "unknown"}}},
		{"from=2026-01-01&to=2026-01-02&limit=0", RouteRecruiters, []Field{{"limit", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&limit=101", RouteRecruiters, []Field{{"limit", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&outcome=open", RouteRecruiters, []Field{{"outcome", "unknown"}}},
		{"from=2026-01-01&to=2026-01-02&outcome=won", RouteVacancies, []Field{{"outcome", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&delivery_result=early", RouteVacancies, []Field{{"delivery_result", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&recruiter_id=", RouteSummary, []Field{{"recruiter_id", "invalid"}}},
		{"from=2026-01-01&to=2026-01-02&cursor=x", RouteDetail, []Field{{"cursor", "unknown"}}},
	} {
		_, err := ParseQuery(tc.query, tc.route)
		if tc.want == nil {
			if err != nil {
				t.Fatalf("%q: %v", tc.query, err)
			}
			continue
		}
		if got := fieldsOf(t, err); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%q: %v, want %v", tc.query, got, tc.want)
		}
	}
}

func TestParseQuery_ListExtras(t *testing.T) {
	q, err := ParseQuery("from=2026-01-01&to=2026-01-02&limit=7&cursor=abc&outcome=open&delivery_result=not_configured", RouteVacancies)
	if err != nil {
		t.Fatal(err)
	}
	if q.Limit != 7 || q.Cursor == nil || *q.Cursor != "abc" || q.Outcome != "open" || q.DeliveryResult != "not_configured" {
		t.Fatalf("%+v", q)
	}
}
