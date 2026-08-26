// Package entities: companies-write sentinels (design D9).
//
// Two new sentinels land in this file so company.go can stay
// byte-for-byte unchanged (the proposal's "NO CHANGE" is honored
// literally — a new file is additive):
//
//   - ErrConcurrencyConflict is the 409-with-view (PATCH) and
//     409-empty-body (DELETE) signal the use case returns on a CAS
//     mismatch.
//   - ErrInvalidCompanyStatusTransition is defense-in-depth for
//     SQLSTATE 23514 surfaced by mapSoftDeleteCompanyError (the only
//     plausible CHECK is jobs_status_check, and 'closed' satisfies it,
//     so this branch is unreachable via the designed flow but kept as
//     a safety net).
//
// Companies defines its OWN ErrConcurrencyConflict rather than
// importing jobs/domain/entities.ErrConcurrencyConflict (cross-feature
// sentinel reuse couples the slices: the companies HTTP classifier
// would have to import the jobs entities package, inverting the
// hexagonal boundary and dragging the jobs vocabulary into
// companies). Jobs already owns its own ErrConcurrencyConflict;
// each feature owning its sentinels is the established convention.
package entities

import "errors"

var (
	// ErrConcurrencyConflict is the use-case sentinel for a stale /
	// missing / malformed CAS token. PATCH surfaces it together with
	// the latest editor view (handler writes 409 + body); DELETE
	// surfaces it alone (handler writes 409 with an empty body per
	// the spec R4 asymmetry).
	ErrConcurrencyConflict = errors.New("concurrency conflict")

	// ErrInvalidCompanyStatusTransition is the defense-in-depth
	// sentinel for SQLSTATE 23514 surfaced by the inline close
	// (jobs.status='closed' is always valid; the only way to trip a
	// CHECK on this path is a CHECK-violation on the companies row
	// itself, which the minimal SET list cannot produce). Kept as a
	// safety net so a future refactor that adds a column to the
	// SET list does not silently leak a 500.
	ErrInvalidCompanyStatusTransition = errors.New("invalid company status transition")
)
