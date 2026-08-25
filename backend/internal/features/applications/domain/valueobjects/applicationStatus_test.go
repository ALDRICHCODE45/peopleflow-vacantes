package valueobjects

import (
	"errors"
	"testing"
)

// TestApplicationStatus_String pins the canonical lowercase wire form per
// design D6 + the spec scenario "status defaults to submitted". Unknown is
// always "unknown_status" so JSON encoding never produces an empty string.
func TestApplicationStatus_String(t *testing.T) {
	cases := []struct {
		s    ApplicationStatus
		want string
	}{
		{UnknownApplicationStatus, "unknown_status"},
		{Submitted, "submitted"},
		{InReview, "in_review"},
		{Rejected, "rejected"},
		{Hired, "hired"},
	}
	for _, c := range cases {
		if got := c.s.String(); got != c.want {
			t.Errorf("ApplicationStatus(%d).String(): want %q, got %q", c.s, c.want, got)
		}
	}
}

// TestParseApplicationStatus covers the closed-set parser (design D6):
//   - valid inputs parse to the right enum (case + whitespace tolerant)
//   - invalid inputs return ErrInvalidStatusTransition (the single sentinel
//     used for both unknown-parse and illegal-matrix per D6)
func TestParseApplicationStatus(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    ApplicationStatus
		wantErr bool
	}{
		{"submitted lowercase", "submitted", Submitted, false},
		{"in_review snake", "in_review", InReview, false},
		{"rejected", "rejected", Rejected, false},
		{"hired", "hired", Hired, false},
		{"SUBMITTED uppercase", "SUBMITTED", Submitted, false},
		{"  In_Review  whitespace + mixed case", "  In_Review  ", InReview, false},
		{"empty string", "", UnknownApplicationStatus, true},
		{"withdrawn (out of vocabulary)", "withdrawn", UnknownApplicationStatus, true},
		{"draft (jobs vocabulary, not applications)", "draft", UnknownApplicationStatus, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseApplicationStatus(c.in)
			if c.wantErr {
				if !errors.Is(err, ErrInvalidStatusTransition) {
					t.Errorf("ParseApplicationStatus(%q): want ErrInvalidStatusTransition, got %v", c.in, err)
				}
				if got != UnknownApplicationStatus {
					t.Errorf("ParseApplicationStatus(%q): want UnknownApplicationStatus on err, got %v", c.in, got)
				}
				return
			}
			if err != nil {
				t.Errorf("ParseApplicationStatus(%q): unexpected err %v", c.in, err)
			}
			if got != c.want {
				t.Errorf("ParseApplicationStatus(%q): want %v, got %v", c.in, c.want, got)
			}
		})
	}
}

// TestApplicationStatus_CanTransitionTo walks the full 4×4 transition
// matrix from design §3 D6 and the spec scenario "Status Transition
// Matrix". The three legal edges are true; every self-transition is
// false; rejected/hired are terminal; submitted → {rejected,hired} is
// false; in_review → submitted is false.
func TestApplicationStatus_CanTransitionTo(t *testing.T) {
	cases := []struct {
		from, to ApplicationStatus
		want     bool
		name     string
	}{
		// Legal edges.
		{Submitted, InReview, true, "submitted → in_review (legal)"},
		{InReview, Rejected, true, "in_review → rejected (legal)"},
		{InReview, Hired, true, "in_review → hired (legal)"},

		// Illegal single-step edges.
		{Submitted, Rejected, false, "submitted → rejected (illegal)"},
		{Submitted, Hired, false, "submitted → hired (illegal)"},
		{InReview, Submitted, false, "in_review → submitted (illegal)"},
		{Rejected, Submitted, false, "rejected → submitted (illegal)"},
		{Rejected, InReview, false, "rejected → in_review (terminal)"},
		{Rejected, Hired, false, "rejected → hired (terminal)"},
		{Hired, Submitted, false, "hired → submitted (terminal)"},
		{Hired, InReview, false, "hired → in_review (terminal)"},
		{Hired, Rejected, false, "hired → rejected (terminal)"},

		// No-op self-transitions.
		{Submitted, Submitted, false, "submitted → submitted (self)"},
		{InReview, InReview, false, "in_review → in_review (self)"},
		{Rejected, Rejected, false, "rejected → rejected (self)"},
		{Hired, Hired, false, "hired → hired (self)"},

		// Unknown from (defense-in-depth).
		{UnknownApplicationStatus, Submitted, false, "unknown → submitted (illegal)"},
		{Submitted, UnknownApplicationStatus, false, "submitted → unknown (illegal)"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.from.CanTransitionTo(c.to); got != c.want {
				t.Errorf("%s: CanTransitionTo: want %v, got %v", c.name, c.want, got)
			}
		})
	}
}
