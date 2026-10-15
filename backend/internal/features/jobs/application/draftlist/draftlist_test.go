package draftlist

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

var (
	testCompany = uuid.MustParse("0192a000-0000-7000-8000-000000000001")
	testActor   = uuid.MustParse("0192a000-0000-7000-8000-000000000002")
	testDraft   = uuid.MustParse("0192a000-0000-7000-8000-000000000003")
	testScope   = Scope{CompanyID: testCompany, ActorID: testActor}
)

func validCursor() Cursor {
	return Cursor{
		CompanyID:     testCompany,
		ActorID:       testActor,
		LastUpdatedAt: time.Date(2026, 10, 15, 12, 30, 45, 123456000, time.UTC),
		LastID:        testDraft,
	}
}

func TestCursorRoundTrip(t *testing.T) {
	token, err := EncodeCursor(validCursor())
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := DecodeCursor(token, testScope)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := validCursor()
	if got.CompanyID != want.CompanyID || got.ActorID != want.ActorID || got.LastID != want.LastID || !got.LastUpdatedAt.Equal(want.LastUpdatedAt) {
		t.Fatalf("round trip = %+v, want %+v", got, want)
	}
}

func TestCursorWireShape(t *testing.T) {
	token, err := EncodeCursor(validCursor())
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(token)
	if err != nil {
		t.Fatalf("token is not unpadded base64url: %v", err)
	}
	want := `{"version":1,"company_id":"0192a000-0000-7000-8000-000000000001","actor_id":"0192a000-0000-7000-8000-000000000002","last_updated_at":"2026-10-15T12:30:45.123456Z","last_id":"0192a000-0000-7000-8000-000000000003"}`
	if string(raw) != want {
		t.Fatalf("wire = %s\nwant %s", raw, want)
	}
}

// TestCursorTruncatesToMicroseconds pins that the cursor carries PostgreSQL
// timestamptz precision, never finer.
func TestCursorTruncatesToMicroseconds(t *testing.T) {
	c := validCursor()
	c.LastUpdatedAt = time.Date(2026, 10, 15, 12, 30, 45, 123456789, time.FixedZone("x", -6*3600))
	token, err := EncodeCursor(c)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	got, err := DecodeCursor(token, testScope)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := time.Date(2026, 10, 15, 18, 30, 45, 123456000, time.UTC)
	if !got.LastUpdatedAt.Equal(want) {
		t.Fatalf("last_updated_at = %s, want %s", got.LastUpdatedAt, want)
	}
}

func encodeRaw(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }

func TestDecodeCursorRejects(t *testing.T) {
	const (
		c  = `"company_id":"0192a000-0000-7000-8000-000000000001"`
		a  = `"actor_id":"0192a000-0000-7000-8000-000000000002"`
		u  = `"last_updated_at":"2026-10-15T12:30:45.123456Z"`
		id = `"last_id":"0192a000-0000-7000-8000-000000000003"`
	)
	obj := func(parts ...string) string { return encodeRaw("{" + strings.Join(parts, ",") + "}") }
	valid := obj(`"version":1`, c, a, u, id)
	if _, err := DecodeCursor(valid, testScope); err != nil {
		t.Fatalf("baseline cursor rejected: %v", err)
	}
	otherCompany := Scope{CompanyID: uuid.MustParse("0192a000-0000-7000-8000-0000000000ff"), ActorID: testActor}
	otherActor := Scope{CompanyID: testCompany, ActorID: uuid.MustParse("0192a000-0000-7000-8000-0000000000fe")}

	cases := []struct {
		name  string
		token string
		scope Scope
	}{
		{"empty", "", testScope},
		{"too long", strings.Repeat("A", MaxCursorBytes+1), testScope},
		{"padded base64", valid + "=", testScope},
		{"standard base64 alphabet", strings.ReplaceAll(strings.ReplaceAll(base64.RawStdEncoding.EncodeToString([]byte(`{"version":1,`+c+","+a+","+u+","+id+"}")), "-", "+"), "_", "/") + "+", testScope},
		{"not json", encodeRaw("nope"), testScope},
		{"json array", encodeRaw("[]"), testScope},
		{"trailing data", encodeRaw(`{"version":1,` + c + "," + a + "," + u + "," + id + "} {}"), testScope},
		{"invalid utf8", encodeRaw("{\"version\":1," + c + "," + a + "," + u + "," + id + ",\"x\":\"\xff\"}"), testScope},
		{"lone surrogate", obj(`"version":1`, c, a, `"last_updated_at":"\ud800"`, id), testScope},
		{"missing version", obj(c, a, u, id), testScope},
		{"missing company", obj(`"version":1`, a, u, id), testScope},
		{"missing actor", obj(`"version":1`, c, u, id), testScope},
		{"missing updated_at", obj(`"version":1`, c, a, id), testScope},
		{"missing id", obj(`"version":1`, c, a, u), testScope},
		{"extra key", obj(`"version":1`, c, a, u, id, `"x":"y"`), testScope},
		{"duplicate key", obj(`"version":1`, c, a, u, id, id), testScope},
		{"version 2", obj(`"version":2`, c, a, u, id), testScope},
		{"version string", obj(`"version":"1"`, c, a, u, id), testScope},
		{"version fraction", obj(`"version":1.0`, c, a, u, id), testScope},
		{"version exponent", obj(`"version":1e0`, c, a, u, id), testScope},
		{"null company", obj(`"version":1`, `"company_id":null`, a, u, id), testScope},
		{"numeric id", obj(`"version":1`, c, a, u, `"last_id":3`), testScope},
		{"uppercase company", obj(`"version":1`, `"company_id":"0192A000-0000-7000-8000-000000000001"`, a, u, id), testScope},
		{"braced id", obj(`"version":1`, c, a, u, `"last_id":"{0192a000-0000-7000-8000-000000000003}"`), testScope},
		{"urn actor", obj(`"version":1`, c, `"actor_id":"urn:uuid:0192a000-0000-7000-8000-000000000002"`, u, id), testScope},
		{"timestamp without fraction", obj(`"version":1`, c, a, `"last_updated_at":"2026-10-15T12:30:45Z"`, id), testScope},
		{"timestamp nanoseconds", obj(`"version":1`, c, a, `"last_updated_at":"2026-10-15T12:30:45.123456789Z"`, id), testScope},
		{"timestamp offset", obj(`"version":1`, c, a, `"last_updated_at":"2026-10-15T06:30:45.123456-06:00"`, id), testScope},
		{"timestamp invalid date", obj(`"version":1`, c, a, `"last_updated_at":"2026-02-30T12:30:45.123456Z"`, id), testScope},
		{"timestamp garbage", obj(`"version":1`, c, a, `"last_updated_at":"yesterday"`, id), testScope},
		{"other company", valid, otherCompany},
		{"other actor", valid, otherActor},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeCursor(tc.token, tc.scope); !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("DecodeCursor err = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

func TestParseLimit(t *testing.T) {
	for raw, want := range map[string]int{"": DefaultLimit, "1": 1, "20": 20, "50": 50, "07": 7} {
		got, err := ParseLimit(raw)
		if err != nil || got != want {
			t.Fatalf("ParseLimit(%q) = %d, %v; want %d", raw, got, err, want)
		}
	}
	for _, raw := range []string{"0", "51", "-1", "+5", " 5", "5 ", "1e1", "abc", "100", "999999999999999999999"} {
		if _, err := ParseLimit(raw); !errors.Is(err, ErrInvalidRequest) {
			t.Fatalf("ParseLimit(%q) err = %v, want ErrInvalidRequest", raw, err)
		}
	}
}
