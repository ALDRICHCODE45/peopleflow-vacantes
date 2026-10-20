package publicjobs

import "context"

// FilterLookup checks imported G1 catalog membership, independently per
// dimension. A municipality outside selected states is valid (an empty AND),
// not an invalid location hierarchy.
type FilterLookup interface {
	CountryExists(context.Context, string) (bool, error)
	StateExists(context.Context, string, string) (bool, error)
	MunicipalityState(context.Context, string, string) (string, error)
}

// ValidateFilters runs before reading search results. Catalog outages must not
// masquerade as unknown user codes, even when the result set would be empty.
func ValidateFilters(ctx context.Context, lookup FilterLookup, q Query) error {
	for _, state := range q.States {
		ok, err := lookup.StateExists(ctx, "MX", state)
		if err != nil {
			return err
		}
		if !ok {
			return ErrInvalidFilter
		}
	}
	for _, municipality := range q.Municipalities {
		state, err := lookup.MunicipalityState(ctx, "MX", municipality)
		if err != nil {
			return err
		}
		if state == "" {
			return ErrInvalidFilter
		}
	}
	if q.ApplicantCountry != "" {
		ok, err := lookup.CountryExists(ctx, q.ApplicantCountry)
		if err != nil {
			return err
		}
		if !ok {
			return ErrInvalidFilter
		}
	}
	return nil
}
