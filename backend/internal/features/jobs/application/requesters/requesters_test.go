package requesters

import (
	"encoding/base64"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestParseKind(t *testing.T) {
	for _, ok := range []string{KindInternalArea, KindClient} {
		if got, err := ParseKind(ok); err != nil || got != ok {
			t.Errorf("ParseKind(%q) = %q, %v; want %q, nil", ok, got, err, ok)
		}
	}
	for _, bad := range []string{"", "Client", "INTERNAL_AREA", "other", " client"} {
		if _, err := ParseKind(bad); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("ParseKind(%q) error = %v, want ErrInvalidRequest", bad, err)
		}
	}
}

func TestParseLimit(t *testing.T) {
	for raw, want := range map[string]int{"": DefaultLimit, "1": 1, "20": 20, "50": 50} {
		if got, err := ParseLimit(raw); err != nil || got != want {
			t.Errorf("ParseLimit(%q) = %d, %v; want %d, nil", raw, got, err, want)
		}
	}
	for _, bad := range []string{"0", "51", "-1", "+5", " 5", "1.5", "abc", "99999999999999999999"} {
		if _, err := ParseLimit(bad); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("ParseLimit(%q) error = %v, want ErrInvalidRequest", bad, err)
		}
	}
}

func TestNormalizeQuery(t *testing.T) {
	empty, err := NormalizeQuery("")
	if err != nil || empty != (Query{}) {
		t.Fatalf("NormalizeQuery(\"\") = %+v, %v; want zero, nil", empty, err)
	}
	blank, err := NormalizeQuery(" \u00a0\t ")
	if err != nil || blank != (Query{}) {
		t.Fatalf("whitespace-only query = %+v, %v; want zero, nil", blank, err)
	}

	q, err := NormalizeQuery("  \u00c1rea   de\u00a0TI ")
	if err != nil {
		t.Fatalf("NormalizeQuery: %v", err)
	}
	if q.Normalized != "\u00c1rea de TI" || q.Key != "\u00e1rea de ti" {
		t.Errorf("query = %+v, want display %q key %q", q, "\u00c1rea de TI", "\u00e1rea de ti")
	}

	// Contract vectors: 'Área' == 'A\u0301REA'; 'Area' is distinct.
	a, _ := NormalizeQuery("\u00c1rea")
	b, _ := NormalizeQuery("A\u0301REA")
	c, _ := NormalizeQuery("Area")
	if a.Key != b.Key {
		t.Errorf("keys %q and %q must be equal", a.Key, b.Key)
	}
	if a.Key == c.Key {
		t.Errorf("accented and unaccented keys must differ: %q", a.Key)
	}

	if _, err := NormalizeQuery(strings.Repeat("\u00f1", 160)); err != nil {
		t.Errorf("160 codepoints: %v, want nil", err)
	}
	for _, bad := range []string{strings.Repeat("\u00f1", 161), "a\x01b", "\xff"} {
		if _, err := NormalizeQuery(bad); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("NormalizeQuery(%q) error = %v, want ErrInvalidRequest", bad, err)
		}
	}
}

var (
	testCompany = uuid.MustParse("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
	testLastID  = uuid.MustParse("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c")
)

func testScope() Scope {
	return Scope{CompanyID: testCompany, Kind: KindInternalArea, QNormalized: "\u00c1rea"}
}

func encodeRaw(json string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(json))
}

const validCursorJSON = `{"version":1,"company_id":"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b","kind":"internal_area","q_normalized":"\u00c1rea","last_name_key":"\u00e1rea de ti","last_id":"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"}`

func TestCursorRoundTrip(t *testing.T) {
	in := Cursor{CompanyID: testCompany, Kind: KindInternalArea, QNormalized: "\u00c1rea", LastNameKey: "\u00e1rea de ti", LastID: testLastID}
	token, err := EncodeCursor(in)
	if err != nil {
		t.Fatalf("EncodeCursor: %v", err)
	}
	if strings.ContainsAny(token, "=+/") {
		t.Errorf("token %q is not unpadded base64url", token)
	}
	out, err := DecodeCursor(token, testScope())
	if err != nil {
		t.Fatalf("DecodeCursor: %v", err)
	}
	if out != in {
		t.Errorf("round trip = %+v, want %+v", out, in)
	}
	if _, err := DecodeCursor(encodeRaw(validCursorJSON), testScope()); err != nil {
		t.Errorf("hand-built valid cursor rejected: %v", err)
	}
}

// The casefolded key may expand beyond 160 codepoints (ß -> ss); it is not
// length-limited.
func TestCursorAcceptsExpandedKey(t *testing.T) {
	key := strings.Repeat("ss", 160)
	scope := Scope{CompanyID: testCompany, Kind: KindClient}
	token, err := EncodeCursor(Cursor{CompanyID: testCompany, Kind: KindClient, LastNameKey: key, LastID: testLastID})
	if err != nil {
		t.Fatalf("EncodeCursor: %v", err)
	}
	if _, err := DecodeCursor(token, scope); err != nil {
		t.Errorf("expanded key rejected: %v", err)
	}
}

// Every field must be a JSON string of the canonical shape: null is not an
// empty string, invalid UTF-8 and lone surrogates are never repaired, and the
// key must be one a normalized name can produce (verification finding S9).
func TestDecodeCursorRejectsWrongTypesAndUnreachableKeys(t *testing.T) {
	scope := Scope{CompanyID: testCompany, Kind: KindClient}
	cursor := func(q, key string) string {
		return encodeRaw(`{"version":1,"company_id":"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b","kind":"client",` +
			`"q_normalized":` + q + `,"last_name_key":` + key + `,"last_id":"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"}`)
	}
	if _, err := DecodeCursor(cursor(`""`, `"acme"`), scope); err != nil {
		t.Fatalf("baseline cursor rejected: %v", err)
	}
	cases := map[string]string{
		"null query":            cursor(`null`, `"acme"`),
		"null key":              cursor(`""`, `null`),
		"numeric query":         cursor(`0`, `"acme"`),
		"lone surrogate key":    cursor(`""`, `"\ud800"`),
		"invalid utf-8 key":     cursor(`""`, "\"a\xffb\""),
		"lone surrogate query":  cursor(`"\udc00"`, `"acme"`),
		"control in key":        cursor(`""`, `"a\u0001b"`),
		"nbsp in key":           cursor(`""`, `"a\u00a0b"`),
		"leading space in key":  cursor(`""`, `" acme"`),
		"trailing space in key": cursor(`""`, `"acme "`),
		"double space in key":   cursor(`""`, `"a  b"`),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeCursor(token, scope); !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("DecodeCursor error = %v, want ErrInvalidRequest", err)
			}
		})
	}
}

func TestDecodeCursorRejects(t *testing.T) {
	replace := func(old, repl string) string {
		return encodeRaw(strings.Replace(validCursorJSON, old, repl, 1))
	}
	cases := map[string]string{
		"empty":              "",
		"oversized":          strings.Repeat("A", MaxCursorBytes+1),
		"not base64url":      "!!!",
		"padded base64":      base64.URLEncoding.EncodeToString([]byte(validCursorJSON + " ")),
		"not json":           encodeRaw("nope"),
		"json array":         encodeRaw(`[1]`),
		"trailing data":      encodeRaw(validCursorJSON + `{}`),
		"extra key":          encodeRaw(strings.Replace(validCursorJSON, `{"version":1,`, `{"version":1,"x":1,`, 1)),
		"duplicate key":      encodeRaw(strings.Replace(validCursorJSON, `{"version":1,`, `{"version":1,"version":1,`, 1)),
		"missing key":        encodeRaw(strings.Replace(validCursorJSON, `"version":1,`, ``, 1)),
		"version 2":          replace(`"version":1`, `"version":2`),
		"version string":     replace(`"version":1`, `"version":"1"`),
		"version float":      replace(`"version":1`, `"version":1.0`),
		"other company":      replace(`0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`, `0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d`),
		"uppercase uuid":     replace(`0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b`, `0190A1B2-C3D4-7E5F-8A9B-0C1D2E3F4A5B`),
		"other kind":         replace(`"kind":"internal_area"`, `"kind":"client"`),
		"invalid kind":       replace(`"kind":"internal_area"`, `"kind":"other"`),
		"other query":        replace(`"q_normalized":"\u00c1rea"`, `"q_normalized":"Area"`),
		"unnormalized query": replace(`"q_normalized":"\u00c1rea"`, `"q_normalized":" \u00c1rea"`),
		"empty key":          replace(`"last_name_key":"\u00e1rea de ti"`, `"last_name_key":""`),
		"unfolded key":       replace(`"last_name_key":"\u00e1rea de ti"`, `"last_name_key":"\u00c1REA DE TI"`),
		"key outside prefix": replace(`"last_name_key":"\u00e1rea de ti"`, `"last_name_key":"zona"`),
		"bad last id":        replace(`"last_id":"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"`, `"last_id":"x"`),
		"null last id":       replace(`"last_id":"0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"`, `"last_id":null`),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := DecodeCursor(token, testScope()); !errors.Is(err, ErrInvalidRequest) {
				t.Errorf("DecodeCursor error = %v, want ErrInvalidRequest", err)
			}
		})
	}
}
