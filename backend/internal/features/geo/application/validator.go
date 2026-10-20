// Package application owns location consistency; it is not wired to writes in G1.
package application

import (
	"context"
	"regexp"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

type Lookup interface {
	CountryExists(context.Context, string) (bool, error)
	StateExists(context.Context, string, string) (bool, error)
	MunicipalityState(context.Context, string, string) (string, error)
	PostalMatches(context.Context, string, string) ([]domain.PostalMatch, error)
}
type Reader interface {
	Lookup
	Countries(context.Context) ([]domain.Item, error)
	States(context.Context, string) ([]domain.Item, error)
	Municipalities(context.Context, string, string) ([]domain.Item, error)
	Version(context.Context) (string, error)
}

type Validator struct{ lookup Lookup }

func NewValidator(lookup Lookup) *Validator { return &Validator{lookup: lookup} }

var postalFormat = regexp.MustCompile(`^[0-9]{5}$`)
var countryFormat = regexp.MustCompile(`^[A-Z]{2}$`)

func ValidPostalCode(value string) bool { return postalFormat.MatchString(value) }

// Validate returns a deterministic field/reason detail (first inconsistent level).
// Storage failures remain errors, never user validation failures. Null is optional
// unless Required; RequireState/RequireMunicipality apply only to MX today.
func (v *Validator) Validate(ctx context.Context, value *domain.Value, rules domain.Rules) ([]domain.Violation, error) {
	prefix := rules.FieldPrefix
	if prefix == "" {
		prefix = "location"
	}
	fail := func(field, reason string) ([]domain.Violation, error) {
		if field != "" {
			field = "." + field
		}
		return []domain.Violation{{Field: prefix + field, Reason: reason}}, nil
	}
	if value == nil {
		if rules.Required {
			return fail("", "required")
		}
		return nil, nil
	}
	if value.Country == "" {
		return fail("country", "required")
	}
	// CHAR(2) comparisons can otherwise accept padded input; do not normalize.
	if !countryFormat.MatchString(value.Country) {
		return fail("country", "unknown")
	}
	ok, err := v.lookup.CountryExists(ctx, value.Country)
	if err != nil {
		return nil, err
	}
	if !ok {
		return fail("country", "unknown")
	}
	if value.State != "" {
		if value.Country != "MX" {
			return fail("state", "not_allowed")
		}
		ok, err = v.lookup.StateExists(ctx, value.Country, value.State)
		if err != nil {
			return nil, err
		}
		if !ok {
			return fail("state", "unknown")
		}
	} else if value.Municipality != "" || (value.Country == "MX" && (rules.RequireState || rules.RequireMunicipality)) {
		return fail("state", "required")
	}
	if value.Municipality != "" {
		state, err := v.lookup.MunicipalityState(ctx, value.Country, value.Municipality)
		if err != nil {
			return nil, err
		}
		if state == "" {
			return fail("municipality", "unknown")
		}
		if state != value.State {
			return fail("municipality", "mismatch")
		}
	} else if value.Country == "MX" && rules.RequireMunicipality {
		return fail("municipality", "required")
	}
	if value.PostalCode != "" {
		if !rules.AllowPostalCode {
			return fail("postal_code", "not_allowed")
		}
		if value.Municipality == "" {
			return fail("municipality", "required")
		}
		if !ValidPostalCode(value.PostalCode) {
			return fail("postal_code", "unknown")
		}
		matches, err := v.lookup.PostalMatches(ctx, value.Country, value.PostalCode)
		if err != nil {
			return nil, err
		}
		if len(matches) == 0 {
			return fail("postal_code", "unknown")
		}
		for _, match := range matches {
			if match.Municipality.Code == value.Municipality {
				return nil, nil
			}
		}
		return fail("postal_code", "mismatch")
	}
	return nil, nil
}
