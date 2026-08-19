// Package cursor encodes/decodes the opaque keyset cursor used by
// GET /jobs (Decision 3). The wire format is intentionally
// base64url(JSON): the JSON lets us evolve fields (rank, ids, future
// tie-breakers) without bumping the cursor version, and base64url is
// safe to round-trip through query strings without URL escaping.
//
// Decode is intentionally tolerant — every malformed input returns nil
// so the HTTP layer can serve the first page instead of 400-ing (per
// the spec scenario "unknown query param is ignored" / design decision
// "malformed cursor → tolerant first page"). Encode mirrors the same
// shape: nil in, "" out, so callers can pass the result through
// unconditionally.
package cursor

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/google/uuid"
)

// TestEncodeDecode_Browse covers the no-Q branch: only PublishedAt and
// ID survive the round-trip; Rank stays nil.
func TestEncodeDecode_Browse(t *testing.T) {
	id := uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab")
	pubAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	orig := &repositories.Cursor{
		Rank:        nil,
		PublishedAt: pubAt,
		ID:          id,
	}

	encoded := Encode(orig)
	if encoded == "" {
		t.Fatal("Encode returned empty string for non-nil cursor")
	}

	got := Decode(encoded)
	if got == nil {
		t.Fatal("Decode returned nil for freshly encoded cursor")
	}
	if got.Rank != nil {
		t.Errorf("Rank: want nil, got %v", *got.Rank)
	}
	if !got.PublishedAt.Equal(pubAt) {
		t.Errorf("PublishedAt: want %v, got %v", pubAt, got.PublishedAt)
	}
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
}

// TestEncodeDecode_Search covers the Q branch: Rank is preserved across
// the round-trip alongside PublishedAt and ID. This is the cursor the
// ts_rank-aware search page uses to walk deep result sets.
func TestEncodeDecode_Search(t *testing.T) {
	id := uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab")
	pubAt := time.Date(2026, 8, 19, 12, 0, 0, 123_000_000, time.UTC)
	rank := 0.421875
	orig := &repositories.Cursor{
		Rank:        &rank,
		PublishedAt: pubAt,
		ID:          id,
	}

	encoded := Encode(orig)
	if encoded == "" {
		t.Fatal("Encode returned empty string for non-nil cursor")
	}

	got := Decode(encoded)
	if got == nil {
		t.Fatal("Decode returned nil for freshly encoded cursor")
	}
	if got.Rank == nil {
		t.Fatal("Rank: want non-nil, got nil")
	}
	if *got.Rank != rank {
		t.Errorf("Rank: want %v, got %v", rank, *got.Rank)
	}
	if !got.PublishedAt.Equal(pubAt) {
		t.Errorf("PublishedAt: want %v, got %v", pubAt, got.PublishedAt)
	}
	if got.ID != id {
		t.Errorf("ID: want %v, got %v", id, got.ID)
	}
}

// TestEncode_NilCursorIsEmpty: nil in → empty string out so the HTTP
// layer can pass the cursor through unconditionally (no first-page
// signal needed; empty string IS the first-page signal).
func TestEncode_NilCursorIsEmpty(t *testing.T) {
	if got := Encode(nil); got != "" {
		t.Errorf("Encode(nil): want %q, got %q", "", got)
	}
}

// TestDecode_EmptyStringIsNil mirrors Encode(nil): empty in → nil out.
// Tolerant first page, never error.
func TestDecode_EmptyStringIsNil(t *testing.T) {
	if got := Decode(""); got != nil {
		t.Errorf(`Decode(""): want nil, got %+v`, got)
	}
}

// TestDecode_MalformedIsNil proves the codec never errors. Each input
// below is structurally invalid: the caller treats nil as "first page",
// not "bad request".
func TestDecode_MalformedIsNil(t *testing.T) {
	cases := []struct {
		name string
		in   string
	}{
		{name: "not base64 at all", in: "not-a-cursor!!!@@@"},
		{name: "valid base64 but not JSON", in: "aGVsbG8gd29ybGQ"},
		{name: "empty JSON object", in: "e30"},                                                                               // {}
		{name: "missing t", in: "eyJpIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAwIn0"},                               // {"i":"…"}
		{name: "missing i", in: "eyJ0IjoiMjAyNi0wOC0xOVQxMjowMDowMFoifQ"},                                                    // {"t":"…"}
		{name: "t is not RFC3339", in: "eyJ0Ijoibm90LWEtdGltZSIsImkiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ"}, // {"t":"not-a-time","i":"…"}
		{name: "i is not a uuid", in: "eyJ0IjoiMjAyNi0wOC0xOVQxMjowMDowMFoiLCJpIjoibm90LWEtdXVpZCJ9"},                        // {"t":"…","i":"not-a-uuid"}
		{name: "garbage bytes", in: "!!!!"},
		{name: "empty bytes decoded", in: ""}, // covered above but kept here for completeness
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.in == "" {
				// already covered by TestDecode_EmptyStringIsNil
				return
			}
			if got := Decode(tc.in); got != nil {
				t.Errorf("Decode(%q): want nil, got %+v", tc.in, got)
			}
		})
	}
}

// TestEncodeDecode_RoundTripProperty: encoding then decoding then
// re-encoding produces the same string. The cursor is stable under
// round-trips even with a non-zero Rank.
func TestEncodeDecode_RoundTripProperty(t *testing.T) {
	id := uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab")
	rank := 0.123456789
	cursor := &repositories.Cursor{
		Rank:        &rank,
		PublishedAt: time.Date(2026, 1, 2, 3, 4, 5, 6, time.UTC),
		ID:          id,
	}

	first := Encode(cursor)
	decoded := Decode(first)
	if decoded == nil {
		t.Fatal("first decode returned nil")
	}
	second := Encode(decoded)
	if first != second {
		t.Errorf("round-trip not stable:\n  first=%q\n  second=%q", first, second)
	}
}

// TestEncode_JSONShape documents the wire format. The HTTP boundary
// hands the cursor back verbatim; this test pins the JSON keys so
// future codec edits stay backward-compatible with running clients.
func TestEncode_JSONShape(t *testing.T) {
	id := uuid.MustParse("018e9b9c-1234-7def-9abc-0123456789ab")
	pubAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)

	t.Run("browse: only t and i", func(t *testing.T) {
		encoded := Encode(&repositories.Cursor{PublishedAt: pubAt, ID: id})
		raw, err := decodeRaw(encoded)
		if err != nil {
			t.Fatalf("decode raw: %v", err)
		}
		if _, ok := raw["r"]; ok {
			t.Errorf("browse cursor must NOT include r, got %v", raw["r"])
		}
		if _, ok := raw["t"]; !ok {
			t.Error("browse cursor must include t")
		}
		if _, ok := raw["i"]; !ok {
			t.Error("browse cursor must include i")
		}
	})

	t.Run("search: r, t, and i all present", func(t *testing.T) {
		rank := 0.5
		encoded := Encode(&repositories.Cursor{Rank: &rank, PublishedAt: pubAt, ID: id})
		raw, err := decodeRaw(encoded)
		if err != nil {
			t.Fatalf("decode raw: %v", err)
		}
		r, ok := raw["r"]
		if !ok {
			t.Fatal("search cursor must include r")
		}
		if r != 0.5 {
			t.Errorf("r: want 0.5, got %v", r)
		}
	})
}

// decodeRaw is a tiny helper for the shape test: base64url → map so
// the test reads the wire format directly without going through
// Decode (which would lose field-level precision for the assertion).
func decodeRaw(s string) (map[string]any, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}
