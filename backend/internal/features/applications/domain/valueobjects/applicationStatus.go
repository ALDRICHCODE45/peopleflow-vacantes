// Package valueobjects holds the closed-set value objects for the
// applications bounded context.
//
// ApplicationStatus is the lifecycle enum (design D6): the wire vocabulary
// is closed at four values (`submitted`/`in_review`/`rejected`/`hired`) and
// the transition matrix is a pure function on (from, to). The single
// ErrInvalidStatusTransition sentinel covers both the unknown-parse case
// and the illegal-matrix case — the HTTP classifier maps both to 400 with
// `err.Error()` as the body, yielding the two spec shapes
// ("invalid status transition" / "invalid status transition: <from> -> <to>").
package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidStatusTransition is the single sentinel for both:
//   - ParseApplicationStatus encountering a value outside the closed set,
//   - the transition matrix rejecting an illegal (from, to) pair (the use
//     case wraps it with `%w: %s -> %s` for the named body shape).
//
// The HTTP layer renders `err.Error()` directly so the wrapped body lands
// on the wire without an additional branch in the classifier.
var ErrInvalidStatusTransition = errors.New("invalid status transition")

// ApplicationStatus is the lifecycle enum for a job application.
// Zero value is UnknownApplicationStatus (invalid) so a never-set field
// fails Parse* loud rather than silently serializing as "submitted".
type ApplicationStatus int

const (
	// UnknownApplicationStatus is the invalid zero value.
	UnknownApplicationStatus ApplicationStatus = iota
	// Submitted is the birth state — every row is born `submitted` (DB
	// DEFAULT) and the only legal next edge is to InReview.
	Submitted
	// InReview is the active-recruitment state; only legal next edges are
	// to Rejected or Hired.
	InReview
	// Rejected is terminal — no outbound edges.
	Rejected
	// Hired is terminal — no outbound edges.
	Hired
)

// String returns the canonical lowercase wire value. Unknown renders as
// "unknown_status" so a corrupted value never serializes as an empty
// string on the wire.
func (s ApplicationStatus) String() string {
	switch s {
	case Submitted:
		return "submitted"
	case InReview:
		return "in_review"
	case Rejected:
		return "rejected"
	case Hired:
		return "hired"
	default:
		return "unknown_status"
	}
}

// ParseApplicationStatus trims + lowercases the input and validates it
// against the closed set. Any value outside the set returns
// ErrInvalidStatusTransition (the spec's "unknown status value" body is
// "invalid status transition" — the same sentinel used for illegal-matrix
// per design D6, so the classifier is a single branch).
func ParseApplicationStatus(raw string) (ApplicationStatus, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "submitted":
		return Submitted, nil
	case "in_review":
		return InReview, nil
	case "rejected":
		return Rejected, nil
	case "hired":
		return Hired, nil
	default:
		return UnknownApplicationStatus, ErrInvalidStatusTransition
	}
}

// CanTransitionTo is the transition matrix as a pure function. The three
// legal edges are:
//
//	submitted → in_review
//	in_review → rejected
//	in_review → hired
//
// Every other edge is false (including every self-transition, every
// rejected/hired outbound edge, submitted → rejected/hired, and
// in_review → submitted). Unknown from/to yields false (defense-in-depth
// — ParseApplicationStatus would have caught unknown input earlier, so a
// caller reaching this with UnknownApplicationStatus has a bug).
func (s ApplicationStatus) CanTransitionTo(to ApplicationStatus) bool {
	switch s {
	case Submitted:
		return to == InReview
	case InReview:
		return to == Rejected || to == Hired
	default:
		// Unknown, Rejected, Hired: no outbound edges.
		return false
	}
}
