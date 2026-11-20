package draftlist

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

var testRoot = uuid.MustParse("0192a000-0000-7000-8000-0000000000aa")

func TestFilteredCursorCarriesItsRootAndKeepsTheLegacyShapeWithout(t *testing.T) {
	filtered := validCursor()
	filtered.RootProcessID = &testRoot
	token, err := EncodeCursor(filtered)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeCursor(token, Scope{CompanyID: testCompany, ActorID: testActor, RootProcessID: &testRoot})
	if err != nil || got.RootProcessID == nil || *got.RootProcessID != testRoot || got.LastID != testDraft {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	if raw := encodeRaw(`{"version":1,"company_id":"0192a000-0000-7000-8000-000000000001","actor_id":"0192a000-0000-7000-8000-000000000002","last_updated_at":"2026-10-15T12:30:45.123456Z","last_id":"0192a000-0000-7000-8000-000000000003","root_process_id":"0192a000-0000-7000-8000-0000000000aa"}`); raw != token {
		t.Fatalf("filtered wire = %s", raw)
	}
	plain, err := EncodeCursor(validCursor())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeCursor(plain, testScope); err != nil {
		t.Fatalf("unfiltered cursor: %v", err)
	}
}

func TestCursorIsBoundToItsFilter(t *testing.T) {
	other := uuid.MustParse("0192a000-0000-7000-8000-0000000000bb")
	filtered := validCursor()
	filtered.RootProcessID = &testRoot
	filteredToken, _ := EncodeCursor(filtered)
	plainToken, _ := EncodeCursor(validCursor())
	withRoot := func(id *uuid.UUID) Scope { return Scope{CompanyID: testCompany, ActorID: testActor, RootProcessID: id} }
	for name, tc := range map[string]struct {
		token string
		scope Scope
	}{
		"filtered cursor, no filter":      {filteredToken, testScope},
		"filtered cursor, another filter": {filteredToken, withRoot(&other)},
		"plain cursor, a filter":          {plainToken, withRoot(&testRoot)},
	} {
		if _, err := DecodeCursor(tc.token, tc.scope); !errors.Is(err, ErrCursorFilter) {
			t.Errorf("%s: err = %v, want ErrCursorFilter", name, err)
		}
	}
	// Malformed input and a foreign session stay plain invalid requests, never a filter mismatch.
	foreign := Scope{CompanyID: uuid.New(), ActorID: testActor, RootProcessID: &testRoot}
	for name, tc := range map[string]struct {
		token string
		scope Scope
	}{
		"other company":     {filteredToken, foreign},
		"bad root":          {encodeRaw(`{"version":1,"company_id":"0192a000-0000-7000-8000-000000000001","actor_id":"0192a000-0000-7000-8000-000000000002","last_updated_at":"2026-10-15T12:30:45.123456Z","last_id":"0192a000-0000-7000-8000-000000000003","root_process_id":"nope"}`), withRoot(&testRoot)},
		"root not a string": {encodeRaw(`{"version":1,"company_id":"0192a000-0000-7000-8000-000000000001","actor_id":"0192a000-0000-7000-8000-000000000002","last_updated_at":"2026-10-15T12:30:45.123456Z","last_id":"0192a000-0000-7000-8000-000000000003","root_process_id":7}`), withRoot(&testRoot)},
		"unknown sixth key": {encodeRaw(`{"version":1,"company_id":"0192a000-0000-7000-8000-000000000001","actor_id":"0192a000-0000-7000-8000-000000000002","last_updated_at":"2026-10-15T12:30:45.123456Z","last_id":"0192a000-0000-7000-8000-000000000003","extra":"x"}`), testScope},
		"uppercase root":    {encodeRaw(`{"version":1,"company_id":"0192a000-0000-7000-8000-000000000001","actor_id":"0192a000-0000-7000-8000-000000000002","last_updated_at":"2026-10-15T12:30:45.123456Z","last_id":"0192a000-0000-7000-8000-000000000003","root_process_id":"0192A000-0000-7000-8000-0000000000AA"}`), withRoot(&testRoot)},
	} {
		if _, err := DecodeCursor(tc.token, tc.scope); !errors.Is(err, ErrInvalidRequest) || errors.Is(err, ErrCursorFilter) {
			t.Errorf("%s: err = %v, want ErrInvalidRequest", name, err)
		}
	}
}

func TestParseRootProcessID(t *testing.T) {
	if got, err := ParseRootProcessID(testRoot.String()); err != nil || got != testRoot {
		t.Fatalf("%v %v", got, err)
	}
	for _, bad := range []string{"", "abc", "0192A000-0000-7000-8000-0000000000AA", "{" + testRoot.String() + "}", "urn:uuid:" + testRoot.String(), " " + testRoot.String(), testRoot.String() + "x"} {
		if _, err := ParseRootProcessID(bad); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("%q: err = %v", bad, err)
		}
	}
}
