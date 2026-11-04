package auditlog

import (
	"errors"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

var (
	company = uuid.MustParse("11111111-1111-7111-8111-111111111111")
	actorID = uuid.MustParse("2222222a-2222-7222-8222-22222222222b")
	vacID   = uuid.MustParse("33333333-3333-7333-8333-333333333333")
)

func fieldsOf(t *testing.T, err error) map[string]string {
	t.Helper()
	var invalid *InvalidFilter
	if !errors.As(err, &invalid) {
		t.Fatalf("want *InvalidFilter, got %v", err)
	}
	out := map[string]string{}
	for _, f := range invalid.Fields {
		out[f.Field] = f.Code
	}
	if len(out) != len(invalid.Fields) {
		t.Fatalf("a field is reported twice: %v", invalid.Fields)
	}
	return out
}

func TestParseQueryAcceptsEveryFilter(t *testing.T) {
	q, err := ParseQuery(company, "actor_id="+actorID.String()+"&event_type=SessionEnded&event_type=SessionStarted&event_type=SessionEnded&category=session&vacancy_id="+vacID.String()+"&from=2026-11-01&to=2026-11-04&limit=100")
	if err != nil {
		t.Fatal(err)
	}
	if q.Limit != 100 || q.ActorID == nil || *q.ActorID != actorID || q.VacancyID == nil || *q.VacancyID != vacID ||
		q.Category != "session" || q.From != "2026-11-01" || q.To != "2026-11-04" || q.After != nil {
		t.Fatalf("%+v", q)
	}
	if want := []string{"SessionEnded", "SessionStarted"}; !reflect.DeepEqual(q.EventTypes, want) {
		t.Fatalf("event types must be sorted and unique: %v", q.EventTypes)
	}
	empty, err := ParseQuery(company, "")
	if err != nil || empty.Limit != 50 {
		t.Fatalf("defaults: %+v %v", empty, err)
	}
}

func TestParseQueryCodes(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		want      map[string]string
	}{
		{"unknown param", "foo=bar", map[string]string{"foo": "unknown"}},
		{"duplicate single", "category=session&category=team", map[string]string{"category": "duplicate"}},
		{"duplicate limit", "limit=1&limit=2", map[string]string{"limit": "duplicate"}},
		{"duplicate cursor", "cursor=a&cursor=b", map[string]string{"cursor": "duplicate"}},
		{"bad actor", "actor_id=nope", map[string]string{"actor_id": "invalid"}},
		{"upper-case uuid is not canonical", "actor_id=" + strings.ToUpper(actorID.String()), map[string]string{"actor_id": "invalid"}},
		{"nil uuid", "vacancy_id=" + uuid.Nil.String(), map[string]string{"vacancy_id": "invalid"}},
		{"empty value", "actor_id=", map[string]string{"actor_id": "invalid"}},
		{"unknown type", "event_type=Nope", map[string]string{"event_type": "invalid"}},
		{"one bad type among good", "event_type=SessionEnded&event_type=Nope", map[string]string{"event_type": "invalid"}},
		{"bad category", "category=nope", map[string]string{"category": "invalid"}},
		{"bad date", "from=2026-13-01", map[string]string{"from": "invalid"}},
		{"non padded date", "to=2026-1-1", map[string]string{"to": "invalid"}},
		{"timestamp instead of date", "from=2026-11-01T00:00:00Z", map[string]string{"from": "invalid"}},
		{"from after to", "from=2026-11-05&to=2026-11-04", map[string]string{"to": "range"}},
		{"limit 0", "limit=0", map[string]string{"limit": "invalid"}},
		{"limit 101", "limit=101", map[string]string{"limit": "invalid"}},
		{"limit sign", "limit=%2B5", map[string]string{"limit": "invalid"}},
		{"limit text", "limit=ten", map[string]string{"limit": "invalid"}},
		{"semicolon", "limit=5;x=1", map[string]string{"limit": "invalid"}},
		{"bad escape in value", "category=%zz", map[string]string{"category": "invalid"}},
		{"bad escape in key", "%zz=1", map[string]string{"query": "invalid"}},
		{"several at once", "foo=1&category=nope&from=x", map[string]string{"foo": "unknown", "category": "invalid", "from": "invalid"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseQuery(company, tc.raw)
			if got := fieldsOf(t, err); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestInvalidFilterNeverEchoesTheValue(t *testing.T) {
	_, err := ParseQuery(company, "actor_id=SECRET-VALUE&event_type=SECRET-TYPE")
	if err == nil || strings.Contains(err.Error(), "SECRET") {
		t.Fatalf("%v", err)
	}
	var invalid *InvalidFilter
	errors.As(err, &invalid)
	for _, f := range invalid.Fields {
		if strings.Contains(f.Field+f.Code, "SECRET") {
			t.Fatalf("%+v", f)
		}
	}
	// An unknown key is reported by name, but a key that is not a short ASCII
	// name is never echoed.
	_, err = ParseQuery(company, url.QueryEscape(strings.Repeat("k", 80))+"=1")
	if got := fieldsOf(t, err); !reflect.DeepEqual(got, map[string]string{"query": "unknown"}) {
		t.Fatalf("%v", got)
	}
}

func TestCursorIsBoundToCompanyAndFilters(t *testing.T) {
	base, err := ParseQuery(company, "category=session")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 4, 17, 3, 12, 441123000, time.UTC)
	id := uuid.MustParse("44444444-4444-7444-8444-444444444444")
	token, err := encodeCursor(company, base.Filters, Position{At: at, ID: id})
	if err != nil {
		t.Fatal(err)
	}
	q, err := ParseQuery(company, "category=session&limit=7&cursor="+token)
	if err != nil || q.After == nil || !q.After.At.Equal(at) || q.After.ID != id || q.Limit != 7 {
		t.Fatalf("%+v %v", q, err)
	}
	// Limit is not part of the filter hash; filters and company are.
	for name, raw := range map[string]string{
		"other filters": "category=team&cursor=" + token,
		"no filters":    "cursor=" + token,
		"garbage":       "cursor=!!!",
		"empty":         "cursor=",
		"truncated":     "cursor=" + token[:len(token)-4],
	} {
		if _, err := ParseQuery(company, raw); !errors.Is(err, ErrInvalidCursor) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	if _, err := ParseQuery(uuid.New(), "category=session&cursor="+token); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("foreign company: %v", err)
	}
	if _, err := ParseQuery(company, "cursor="+strings.Repeat("A", MaxCursorBytes+1)); !errors.Is(err, ErrInvalidCursor) {
		t.Fatalf("oversized: %v", err)
	}
	// A filter error wins over the cursor.
	if _, err := ParseQuery(company, "cursor=!!!&bogus=1"); !errors.As(err, new(*InvalidFilter)) {
		t.Fatalf("%v", err)
	}
}

func TestEffectiveTypes(t *testing.T) {
	all := len(entities.Catalog())
	if got := (Filters{}).Types(); len(got) != all {
		t.Fatalf("no filter lists every catalog type, got %d of %d", len(got), all)
	}
	if got := (Filters{Category: "audit"}).Types(); !reflect.DeepEqual(got, []string{"AuditLogExported"}) {
		t.Fatalf("%v", got)
	}
	if got := (Filters{EventTypes: []string{"SessionEnded", "ParticipationMoved"}}).Types(); !reflect.DeepEqual(got, []string{"SessionEnded", "ParticipationMoved"}) {
		t.Fatalf("%v", got)
	}
	// category AND event_type: the intersection, possibly empty (never nil).
	got := (Filters{Category: "session", EventTypes: []string{"SessionEnded", "ParticipationMoved"}}).Types()
	if !reflect.DeepEqual(got, []string{"SessionEnded"}) {
		t.Fatalf("%v", got)
	}
	if got := (Filters{Category: "team", EventTypes: []string{"SessionEnded"}}).Types(); got == nil || len(got) != 0 {
		t.Fatalf("%#v", got)
	}
}

func TestWindowIsWholeMexicoCityDays(t *testing.T) {
	from, to, err := (Filters{From: "2026-11-04", To: "2026-11-04"}).Window()
	if err != nil {
		t.Fatal(err)
	}
	// Mexico City is UTC-6 in November (no DST since 2022).
	if !from.Equal(time.Date(2026, 11, 4, 6, 0, 0, 0, time.UTC)) || !to.Equal(time.Date(2026, 11, 5, 6, 0, 0, 0, time.UTC)) {
		t.Fatalf("%v %v", from, to)
	}
	f, _, _ := (Filters{}).Window()
	if !f.IsZero() {
		t.Fatal("no from means no lower bound")
	}
}

func TestParseExportBody(t *testing.T) {
	ok := `{"actor_id":"` + actorID.String() + `","event_types":["SessionEnded"],"category":"session","vacancy_id":"` + vacID.String() + `","from":"2026-01-01","to":"2026-12-31"}`
	f, err := ParseExport([]byte(ok))
	if err != nil || f.From != "2026-01-01" || f.To != "2026-12-31" || len(f.EventTypes) != 1 || f.Category != "session" {
		t.Fatalf("%+v %v", f, err)
	}
	if _, err := ParseExport([]byte(`{"from":"2024-01-01","to":"2024-12-31"}`)); err != nil {
		t.Fatalf("1 Jan–31 Dec of a leap year (366 days) passes: %v", err)
	}
	for _, tc := range []struct {
		name, body string
		want       map[string]string
	}{
		{"both missing", `{}`, map[string]string{"from": "required", "to": "required"}},
		{"from missing", `{"to":"2026-01-02"}`, map[string]string{"from": "required"}},
		{"null is missing", `{"from":null,"to":"2026-01-02"}`, map[string]string{"from": "required"}},
		{"malformed date", `{"from":"01/02/2026","to":"2026-01-02"}`, map[string]string{"from": "invalid"}},
		{"number date", `{"from":20260101,"to":"2026-01-02"}`, map[string]string{"from": "invalid"}},
		{"from after to", `{"from":"2026-02-02","to":"2026-02-01"}`, map[string]string{"to": "range"}},
		{"367 days", `{"from":"2025-01-01","to":"2026-01-02"}`, map[string]string{"to": "range"}},
		{"unknown field", `{"from":"2026-01-01","to":"2026-01-02","limit":5}`, map[string]string{"limit": "unknown"}},
		{"duplicate field", `{"from":"2026-01-01","from":"2026-01-01","to":"2026-01-02"}`, map[string]string{"from": "duplicate"}},
		{"unknown type", `{"from":"2026-01-01","to":"2026-01-02","event_types":["Nope"]}`, map[string]string{"event_types": "invalid"}},
		{"types not an array", `{"from":"2026-01-01","to":"2026-01-02","event_types":"SessionEnded"}`, map[string]string{"event_types": "invalid"}},
		{"bad actor", `{"from":"2026-01-01","to":"2026-01-02","actor_id":"x"}`, map[string]string{"actor_id": "invalid"}},
		{"bad category", `{"from":"2026-01-01","to":"2026-01-02","category":"x"}`, map[string]string{"category": "invalid"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseExport([]byte(tc.body))
			if got := fieldsOf(t, err); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
	for _, body := range []string{`[]`, `"x"`, `null`, `{"from":`, `{} {}`} {
		if _, err := ParseExport([]byte(body)); !errors.Is(err, ErrInvalidBody) {
			t.Fatalf("%q: %v", body, err)
		}
	}
}

func TestExportAuditMetadataHoldsOnlyIDsEnumsAndDates(t *testing.T) {
	f := Filters{ActorID: &actorID, EventTypes: []string{"SessionEnded"}, Category: "session", VacancyID: &vacID, From: "2026-01-01", To: "2026-01-02"}
	want := map[string]any{"actor_id": actorID.String(), "event_types": []string{"SessionEnded"}, "category": "session", "vacancy_id": vacID.String(), "from": "2026-01-01", "to": "2026-01-02"}
	if got := f.AuditMetadata(); !reflect.DeepEqual(got, want) {
		t.Fatalf("%v", got)
	}
	if got := (Filters{From: "2026-01-01", To: "2026-01-02"}).AuditMetadata(); !reflect.DeepEqual(got, map[string]any{"from": "2026-01-01", "to": "2026-01-02"}) {
		t.Fatalf("unset filters are omitted: %v", got)
	}
}
