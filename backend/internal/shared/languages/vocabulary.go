package languages

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
)

var languageLevels = []string{"A1", "A2", "B1", "B2", "C1", "C2", "native"}
var seniorities = []string{"intern", "junior", "semi_senior", "senior", "lead", "manager", "director"}
var educationLevels = []string{"secondary", "high_school", "technical", "tsu", "bachelor", "specialty", "master", "phd"}
var educationStatuses = []string{"in_progress", "paused", "completed", "incomplete"}

func LanguageLevels() []string               { return slices.Clone(languageLevels) }
func Seniorities() []string                  { return slices.Clone(seniorities) }
func EducationLevels() []string              { return slices.Clone(educationLevels) }
func EducationStatuses() []string            { return slices.Clone(educationStatuses) }
func ValidLanguageLevel(value string) bool   { return slices.Contains(languageLevels, value) }
func ValidSeniority(value string) bool       { return slices.Contains(seniorities, value) }
func ValidEducationLevel(value string) bool  { return slices.Contains(educationLevels, value) }
func ValidEducationStatus(value string) bool { return slices.Contains(educationStatuses, value) }

// CompareLanguageLevels returns a negative/zero/positive order and validity.
// Both operands must be exact vocabulary literals; native ranks above C2.
func CompareLanguageLevels(a, b string) (int, bool) { return compare(languageLevels, a, b) }

// CompareEducationLevels orders qualifications, not study statuses. Callers must
// exclude non-completed studies when calculating the highest completed level.
func CompareEducationLevels(a, b string) (int, bool) { return compare(educationLevels, a, b) }
func compare(values []string, a, b string) (int, bool) {
	i, j := slices.Index(values, a), slices.Index(values, b)
	if i < 0 || j < 0 {
		return 0, false
	}
	return i - j, true
}

var yearsPattern = regexp.MustCompile(`^(0|[1-9][0-9]?)(\.[0-9])?$`)

// ValidYears accepts only decimal strings with at most one fractional digit,
// no leading zeroes or whitespace, and values in the inclusive range 0–60.
func ValidYears(value string) bool { _, ok := NormalizeYears(value); return ok }

// NormalizeYears uses the same strict validation as writes. Canonical form is
// an integer if the fraction is absent or zero ("2.0" -> "2"), otherwise exactly
// one fractional digit ("1.5" -> "1.5"). It is idempotent and never uses floats.
// Invalid input returns ("", false), never a coerced value.
func NormalizeYears(value string) (string, bool) {
	if !yearsPattern.MatchString(value) {
		return "", false
	}
	whole, fraction, _ := strings.Cut(value, ".")
	n, _ := strconv.Atoi(whole) // Regex already guarantees one or two ASCII digits.
	if n > 60 || (n == 60 && fraction != "" && fraction != "0") {
		return "", false
	}
	if fraction == "" || fraction == "0" {
		return whole, true
	}
	return value, true
}
