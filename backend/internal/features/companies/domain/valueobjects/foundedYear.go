package valueobjects

import (
	"errors"
	"time"
)

// ErrFoundedYearOutOfRange is returned when a founding year falls outside the
// accepted domain interval [foundedYearMin, currentYear+1].
var ErrFoundedYearOutOfRange = errors.New("el año de fundación está fuera del rango permitido (1800 a año actual + 1)")

// foundedYearMin is the earliest acceptable founding year. It exists as a named
// constant so the domain rule is grep-able and not magic.
const foundedYearMin = 1800

// FoundedYear is the year a company was founded. The value object is the
// AUTHORITATIVE definition of "valid year": invariant year ∈ [1800, currentYear+1]
// so the HTTP layer and downstream consumers agree on the same rule.
//
// The companion database CHECK constraint in
// db/migrations/00003_companies_profile.sql (`companies_founded_year_check`)
// uses a STATIC upper bound of 2200 instead of `currentYear+1`. That divergence
// is intentional: the CHECK is defense-in-depth with a generous, never-aging
// upper bound so it never needs a migration to roll forward. The VO catches
// anything outside [1800, currentYear+1] before the row reaches the database,
// so on the normal write path the VO is the only constraint that ever fires.
// The DB CHECK is the safety net for any future code path that might bypass the
// domain layer — keep both layers in sync if the interval ever changes.
type FoundedYear struct {
	value int
}

// NewFoundedYear validates a year against the domain interval. The upper
// bound is computed from time.Now().Year()+1 so the rule is "current year
// or one year of leeway for early planning."
func NewFoundedYear(year int) (FoundedYear, error) {
	return newFoundedYearWithUpperBound(year, time.Now().Year()+1)
}

// newFoundedYearWithUpperBound is the deterministic core used by tests; it
// allows the upper bound to be injected so boundary cases stay reproducible
// regardless of when CI runs.
func newFoundedYearWithUpperBound(year, upperBound int) (FoundedYear, error) {
	if year < foundedYearMin || year > upperBound {
		return FoundedYear{}, ErrFoundedYearOutOfRange
	}
	return FoundedYear{value: year}, nil
}

// Value returns the year as a plain int.
func (y FoundedYear) Value() int {
	return y.value
}
