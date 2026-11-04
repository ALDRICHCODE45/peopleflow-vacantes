package auditlog

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func codes(err error) string {
	var f *InvalidFilter
	if !errors.As(err, &f) {
		if err == nil {
			return "ok"
		}
		return err.Error()
	}
	var b strings.Builder
	for _, x := range f.Fields {
		b.WriteString(x.Field + ":" + x.Code + ";")
	}
	return b.String()
}

func TestVerify2b_ParseQueryEdges(t *testing.T) {
	c := uuid.New()
	for q, want := range map[string]string{
		"":            "ok",
		"event_type=": "event_type:invalid;",
		"event_type=SessionEnded&event_type=SessionEnded": "ok",
		"event_type=SessionEnded&event_type=NOPE":         "event_type:invalid;",
		"limit=":    "limit:invalid;",
		"limit=-1":  "limit:invalid;",
		"limit=1e2": "limit:invalid;",
		"limit=100": "ok",
		"actor_id=" + strings.ToUpper(uuid.NewString()): "actor_id:invalid;",
		"actor_id=00000000-0000-0000-0000-000000000000": "actor_id:invalid;",
		"from=2026-02-29":                   "from:invalid;",
		"from=2024-02-29":                   "ok",
		"from=2026-01-02&to=2026-01-01":     "to:range;",
		"from=2026-01-01&to=2026-01-01":     "ok",
		"from=2020-01-01&to=2026-01-01":     "ok", // the list has no span limit
		"to=2026-1-01":                      "to:invalid;",
		"%zz=1":                             "query:invalid;",
		"a%3Cb=1":                           "query:unknown;",
		"cursor=":                           ErrInvalidCursor.Error(),
		"cursor=abc&cursor=def":             "cursor:duplicate;",
		"category=session&category=session": "category:duplicate;",
	} {
		_, err := ParseQuery(c, q)
		if got := codes(err); got != want {
			t.Errorf("%q: got %q want %q", q, got, want)
		}
	}
}

func TestVerify2b_ParseExportSpan(t *testing.T) {
	for body, want := range map[string]string{
		`{"from":"2025-01-01","to":"2026-01-01"}`:                    "ok",        // 366 days
		`{"from":"2025-01-01","to":"2026-01-02"}`:                    "to:range;", // 367
		`{"from":"2024-01-01","to":"2024-12-31"}`:                    "ok",        // leap year
		`{"from":"2023-12-31","to":"2024-12-31"}`:                    "to:range;", // 367
		`{"from":"2024-03-01","to":"2025-03-01"}`:                    "ok",        // 366 across Feb 29
		`{"from":"2026-01-01","to":"2026-01-01"}`:                    "ok",
		`{"from":"2026-01-01","to":"2026-01-01","event_types":[]}`:   "ok",
		`{"from":"2026-01-01","to":"2026-01-01","event_types":[""]}`: "event_types:invalid;",
		`{"from":"2026-01-01","to":"2026-01-01","category":""}`:      "category:invalid;",
		`{"from":"","to":"2026-01-01"}`:                              "from:invalid;",
		`{"from":"2026-01-01","to":"2026-01-01","SECRETKEY":1}`:      "SECRETKEY:unknown;",
	} {
		_, err := ParseExport([]byte(body))
		if got := codes(err); got != want {
			t.Errorf("%s: got %q want %q", body, got, want)
		}
	}
}

func TestVerify2b_CursorBinding(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	q, _ := ParseQuery(a, "category=session")
	tok, _ := encodeCursor(a, q.Filters, Position{ID: uuid.New()})
	if _, err := ParseQuery(a, "category=session&cursor="+tok); err != nil {
		t.Fatalf("own cursor rejected: %v", err)
	}
	for _, raw := range []string{"category=team&cursor=" + tok, "cursor=" + tok} {
		if _, err := ParseQuery(a, raw); !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("%q: %v", raw, err)
		}
	}
	if _, err := ParseQuery(b, "category=session&cursor="+tok); !errors.Is(err, ErrInvalidCursor) {
		t.Errorf("foreign company cursor: %v", err)
	}
	// Filter order and duplicates do not change the hash.
	q1, _ := ParseQuery(a, "event_type=SessionEnded&event_type=SessionStarted")
	t2, _ := encodeCursor(a, q1.Filters, Position{ID: uuid.New()})
	if _, err := ParseQuery(a, "event_type=SessionStarted&event_type=SessionEnded&event_type=SessionEnded&cursor="+t2); err != nil {
		t.Errorf("reordered filters: %v", err)
	}
}
