package valueobjects

import (
	"errors"
	"testing"
)

// TestJobStatus_ZeroValueIsDraft enforces the spec invariant "Jobs MUST be
// born `status='draft'`" (DB DEFAULT 'draft', zero value of the VO). A
// freshly-declared JobStatus must read back as Draft so any code path
// that skips ParseJobStatus (and reaches the entity with a zero-valued VO)
// still maps to the canonical "draft" wire value when serialized.
func TestJobStatus_ZeroValueIsDraft(t *testing.T) {
	var zero JobStatus
	if zero != Draft {
		t.Errorf("zero-value JobStatus: got %v, want %v (Draft)", zero, Draft)
	}
	if zero.String() != "draft" {
		t.Errorf("zero-value JobStatus.String(): got %q, want %q", zero.String(), "draft")
	}
}

func TestJobStatus_String(t *testing.T) {
	cases := []struct {
		name string
		js   JobStatus
		want string
	}{
		{"draft returns draft", Draft, "draft"},
		{"published returns published", Published, "published"},
		{"closed returns closed", Closed, "closed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.js.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestJobStatus_ParseValid(t *testing.T) {
	cases := []struct {
		raw  string
		want JobStatus
	}{
		{"draft", Draft},
		{"published", Published},
		{"closed", Closed},
		{"DRAFT", Draft},
		{" Published ", Published},
		{"Closed", Closed},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseJobStatus(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseJobStatus(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestJobStatus_ParseUnknown(t *testing.T) {
	raw := "archived"
	_, err := ParseJobStatus(raw)
	if err == nil {
		t.Fatalf("expected error for unknown job status %q, got nil", raw)
	}
	if !errors.Is(err, ErrInvalidJobStatus) {
		t.Errorf("expected ErrInvalidJobStatus, got: %v", err)
	}
}

func TestJobStatus_ParseEmpty(t *testing.T) {
	// An empty raw value must NOT silently coerce to Draft: the DB column
	// is NOT NULL DEFAULT 'draft', so an empty string only arrives here if
	// something bypassed the schema. Reject it as invalid so the caller
	// fails loud instead of writing an out-of-domain row.
	_, err := ParseJobStatus("")
	if err == nil {
		t.Fatal("expected error for empty job status, got nil")
	}
	if !errors.Is(err, ErrInvalidJobStatus) {
		t.Errorf("expected ErrInvalidJobStatus, got: %v", err)
	}
}

func TestJobStatus_RoundTrip(t *testing.T) {
	for _, js := range []JobStatus{Draft, Published, Closed} {
		t.Run(js.String(), func(t *testing.T) {
			got, err := ParseJobStatus(js.String())
			if err != nil {
				t.Fatalf("round-trip ParseJobStatus(%q) errored: %v", js.String(), err)
			}
			if got != js {
				t.Errorf("round-trip ParseJobStatus(%q) = %v, want %v", js.String(), got, js)
			}
		})
	}
}
