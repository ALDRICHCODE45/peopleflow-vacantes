package v2

import "errors"

var (
	ErrApplicantCountryRequired   = errors.New("applicant country required")
	ErrApplicantCountryNotAllowed = errors.New("applicant country not allowed")
)

type CountryRestriction struct {
	Cause   error
	Allowed []string
}

func (e *CountryRestriction) Error() string { return e.Cause.Error() }
func (e *CountryRestriction) Unwrap() error { return e.Cause }

// CheckApplicantCountry uses the published scope, not the mutable authoring data.
func CheckApplicantCountry(mode string, kind *string, allowed []string, country *string) error {
	if mode != "remote" || kind == nil || *kind != "countries" {
		return nil
	}
	var cause error
	if country == nil || *country == "" {
		cause = ErrApplicantCountryRequired
	} else {
		for _, c := range allowed {
			if c == *country {
				return nil
			}
		}
		cause = ErrApplicantCountryNotAllowed
	}
	return &CountryRestriction{Cause: cause, Allowed: append([]string{}, allowed...)}
}
