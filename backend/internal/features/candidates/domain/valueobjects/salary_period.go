package valueobjects

import (
	"errors"
	"strings"
)

// ErrInvalidSalaryPeriod is returned when a raw expected_salary_period value
// does not match any member of the closed set {monthly, annual}.
var ErrInvalidSalaryPeriod = errors.New("invalid salary period")

// SalaryPeriod is the closed-set classification of how often a candidate's
// expected salary is quoted. The textual representation is the wire format
// used in HTTP bodies and the database CHECK constraint.
type SalaryPeriod int

const (
	// UnknownSalaryPeriod is the zero value returned for invalid inputs.
	UnknownSalaryPeriod SalaryPeriod = iota
	MonthlySalary
	AnnualSalary
)

// String returns the canonical lowercase wire value for the period.
func (s SalaryPeriod) String() string {
	switch s {
	case MonthlySalary:
		return "monthly"
	case AnnualSalary:
		return "annual"
	default:
		return "unknown_salary_period"
	}
}

// ParseSalaryPeriod normalizes and validates a raw period string. The
// comparison is case-insensitive and trims surrounding whitespace so callers
// can pass user-provided text directly. Unknown values return
// ErrInvalidSalaryPeriod.
func ParseSalaryPeriod(raw string) (SalaryPeriod, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "monthly":
		return MonthlySalary, nil
	case "annual":
		return AnnualSalary, nil
	default:
		return UnknownSalaryPeriod, ErrInvalidSalaryPeriod
	}
}
