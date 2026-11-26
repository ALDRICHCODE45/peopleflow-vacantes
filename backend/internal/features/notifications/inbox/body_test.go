package inbox

import (
	"errors"
	"fmt"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

const (
	tJob  = "6f1c0000-0000-4000-8000-000000000001"
	tNote = "01937b2e-6b1a-7c2e-9f10-0a1b2c3d4e5f"
)

func wantInvalidBody(t *testing.T, err error) []Field {
	t.Helper()
	var invalid *InvalidBody
	if !errors.As(err, &invalid) {
		t.Fatalf("err = %v, want *InvalidBody", err)
	}
	return invalid.Fields
}

func TestParseMarkSelections(t *testing.T) {
	at := time.Date(2026, 11, 26, 18, 45, 2, 123456000, time.UTC)
	cases := []struct {
		body   string
		unread bool
		want   MarkRequest
	}{
		{`{"group_keys":["applications:` + tJob + `:2026-11-26","n:` + tNote + `","applications:` + tJob + `:2026-11-26"]}`, false,
			MarkRequest{GroupKeys: []string{"applications:" + tJob + ":2026-11-26", "n:" + tNote}}},
		{`{"group_keys":["psychometrics_pending:` + strings.ToUpper(tJob) + `:2026-02-28","psychometrics:` + tJob + `:2026-11-26"]}`, false,
			MarkRequest{GroupKeys: []string{"psychometrics:" + tJob + ":2026-11-26", "psychometrics_pending:" + tJob + ":2026-02-28"}}},
		{`{"ids":["` + strings.ToUpper(tNote) + `","` + tJob + `","` + tNote + `"]}`, true,
			MarkRequest{IDs: []uuid.UUID{uuid.MustParse(tNote), uuid.MustParse(tJob)}}},
		{` {"marked_at":"2026-11-26T18:45:02.123456Z"} `, true, MarkRequest{MarkedAt: &at}},
		{`{"marked_at":"2026-11-26T12:45:02.123456-06:00"}`, true, MarkRequest{MarkedAt: &at}},
		// An explicit null is the same as an absent member.
		{`{"ids":["` + tNote + `"],"group_keys":null}`, false, MarkRequest{IDs: []uuid.UUID{uuid.MustParse(tNote)}}},
	}
	for _, tc := range cases {
		got, err := ParseMark([]byte(tc.body), tc.unread)
		if err != nil {
			t.Fatalf("%s: %v", tc.body, err)
		}
		if got.MarkedAt != nil {
			if !got.MarkedAt.Equal(*tc.want.MarkedAt) {
				t.Fatalf("%s: marked_at %v", tc.body, got.MarkedAt)
			}
			got.MarkedAt = tc.want.MarkedAt
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s:\n got %+v\nwant %+v", tc.body, got, tc.want)
		}
	}
}

func TestParseMarkValidation(t *testing.T) {
	keys := func(n int) string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf(`"n:%s"`, uuid.Must(uuid.NewV7()))
		}
		return strings.Join(out, ",")
	}
	ids := func(n int) string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf(`"%s"`, uuid.New())
		}
		return strings.Join(out, ",")
	}
	cases := []struct {
		body   string
		unread bool
		want   []Field
	}{
		{`{}`, false, []Field{{"body", "required"}}},
		{`null`, true, []Field{{"body", "required"}}},
		{`{"group_keys":null,"ids":null}`, true, []Field{{"body", "required"}}},
		{`{"group_keys":["n:` + tNote + `"],"ids":["` + tNote + `"]}`, false, []Field{{"body", "invalid"}}},
		{`{"ids":["` + tNote + `"],"marked_at":"2026-11-26T18:45:02Z"}`, true, []Field{{"body", "invalid"}}},
		{`{"marked_at":"2026-11-26T18:45:02Z"}`, false, []Field{{"marked_at", "not_allowed"}}},
		{`{"group_keys":[]}`, false, []Field{{"group_keys", "empty"}}},
		{`{"ids":[]}`, true, []Field{{"ids", "empty"}}},
		{`{"group_keys":[` + keys(101) + `]}`, false, []Field{{"group_keys", "too_many"}}},
		{`{"ids":[` + ids(201) + `]}`, false, []Field{{"ids", "too_many"}}},
		{`{"ids":["not-a-uuid"]}`, false, []Field{{"ids", "invalid"}}},
		{`{"ids":["00000000-0000-0000-0000-000000000000"]}`, false, []Field{{"ids", "invalid"}}},
		{`{"ids":["{` + tNote + `}"]}`, false, []Field{{"ids", "invalid"}}},
		{`{"marked_at":"yesterday"}`, true, []Field{{"marked_at", "invalid"}}},
		{`{"marked_at":""}`, true, []Field{{"marked_at", "invalid"}}},
	}
	for _, bad := range []string{"bogus", "n:", "n:not-a-uuid", "applications:" + tJob, "applications:" + tJob + ":2026-13-01",
		"applications:" + tJob + ":2026-1-01", "unknown:" + tJob + ":2026-11-26", "n:" + tJob + ":2026-11-26", "applications:not-a-uuid:2026-11-26",
		"n:00000000-0000-0000-0000-000000000000", "applications:" + tJob + ":2026-11-26:x"} {
		cases = append(cases, struct {
			body   string
			unread bool
			want   []Field
		}{`{"group_keys":["n:` + tNote + `","` + bad + `"]}`, false, []Field{{"group_keys", "invalid"}}})
	}
	for _, tc := range cases {
		_, err := ParseMark([]byte(tc.body), tc.unread)
		if got := wantInvalidBody(t, err); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%.80s: fields %v, want %v", tc.body, got, tc.want)
		}
	}
}

func TestParseBodiesRejectMalformedJSON(t *testing.T) {
	for _, body := range []string{``, `not json`, `[]`, `"x"`, `{"foo":1}`, `{"ids":"x"}`, `{"ids":[1]}`, `{} {}`, `{"ids":["` + tNote + `"]}x`, `{"marked_at":1}`} {
		if _, err := ParseMark([]byte(body), true); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("mark %q: err = %v, want ErrInvalidRequest", body, err)
		}
	}
	for _, body := range []string{`not json`, `[]`, `{"group_keys":["n:` + tNote + `"]}`, `{"types":"x"}`, `{"before":1}`, `{} {}`} {
		if _, err := ParseReadAll([]byte(body)); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("read-all %q: err = %v, want ErrInvalidRequest", body, err)
		}
	}
}

func TestParseReadAll(t *testing.T) {
	before := time.Date(2026, 11, 26, 18, 44, 0, 0, time.UTC)
	cases := []struct {
		body string
		want ReadAllRequest
	}{
		{``, ReadAllRequest{}},
		{"  \n", ReadAllRequest{}},
		{`{}`, ReadAllRequest{}},
		{`null`, ReadAllRequest{}},
		{`{"types":["delivery_overdue","application_received","delivery_overdue"],"job_ids":["` + strings.ToUpper(tNote) + `","` + tJob + `"],"before":"2026-11-26T18:44:00Z"}`,
			ReadAllRequest{Types: []string{"application_received", "delivery_overdue"}, JobIDs: []uuid.UUID{uuid.MustParse(tNote), uuid.MustParse(tJob)}, Before: &before}},
	}
	for _, tc := range cases {
		got, err := ParseReadAll([]byte(tc.body))
		if err != nil {
			t.Fatalf("%q: %v", tc.body, err)
		}
		if got.Before != nil && tc.want.Before != nil && got.Before.Equal(*tc.want.Before) {
			got.Before = tc.want.Before
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%q:\n got %+v\nwant %+v", tc.body, got, tc.want)
		}
	}

	jobs := make([]string, 21)
	for i := range jobs {
		jobs[i] = `"` + uuid.NewString() + `"`
	}
	all := `"application_received","delivery_due_soon","delivery_overdue","assignment_deadline_due_soon","assignment_deadline_overdue","vacancy_assigned","vacancy_reassigned","vacancy_unassigned","vacancy_team_added","psychometric_completed","psychometric_pending","candidate_status_changed","candidate_message_received","candidate_test_pending"`
	invalid := []struct {
		body string
		want []Field
	}{
		{`{"types":["bogus"]}`, []Field{{"types", "invalid"}}},
		{`{"types":[]}`, []Field{{"types", "empty"}}},
		{`{"types":[` + all + `,"vacancy_assigned"]}`, []Field{{"types", "too_many"}}},
		{`{"job_ids":["nope"]}`, []Field{{"job_ids", "invalid"}}},
		{`{"job_ids":[]}`, []Field{{"job_ids", "empty"}}},
		{`{"job_ids":[` + strings.Join(jobs, ",") + `]}`, []Field{{"job_ids", "too_many"}}},
		{`{"before":"2026-11-26"}`, []Field{{"before", "invalid"}}},
		{`{"before":"x","types":["bogus"],"job_ids":[]}`, []Field{{"before", "invalid"}, {"job_ids", "empty"}, {"types", "invalid"}}},
	}
	for _, tc := range invalid {
		_, err := ParseReadAll([]byte(tc.body))
		if got := wantInvalidBody(t, err); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%.80s: fields %v, want %v", tc.body, got, tc.want)
		}
	}
}

func TestParseFacetsQuery(t *testing.T) {
	for raw, want := range map[string]string{"": StateUnread, "state=unread": StateUnread, "state=all": StateAll, "state=all&types=bogus&job_ids=x&limit=0": StateAll} {
		values, _ := url.ParseQuery(raw)
		got, err := ParseFacetsQuery(values)
		if err != nil || got != want {
			t.Fatalf("%q: got %q, %v; want %q", raw, got, err, want)
		}
	}
	for raw, code := range map[string]string{"state=read": "invalid", "state=": "invalid", "state=all&state=unread": "duplicate"} {
		values, _ := url.ParseQuery(raw)
		_, err := ParseFacetsQuery(values)
		var invalid *InvalidFilter
		if !errors.As(err, &invalid) || !reflect.DeepEqual(invalid.Fields, []Field{{"state", code}}) {
			t.Fatalf("%q: err = %v", raw, err)
		}
	}
}

func TestAttentionTypesFromTypeTable(t *testing.T) {
	want := []string{"assignment_deadline_due_soon", "assignment_deadline_overdue", "delivery_due_soon", "delivery_overdue"}
	if got := AttentionTypes(); !reflect.DeepEqual(got, want) {
		t.Fatalf("AttentionTypes() = %v, want %v", got, want)
	}
}
