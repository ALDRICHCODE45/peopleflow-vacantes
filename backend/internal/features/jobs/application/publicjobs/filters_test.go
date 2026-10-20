package publicjobs

import (
	"context"
	"errors"
	"testing"
)

type filterLookupStub struct{ err error }

func (l filterLookupStub) CountryExists(_ context.Context, country string) (bool, error) {
	return country == "MX" || country == "CO", l.err
}
func (l filterLookupStub) StateExists(_ context.Context, country, state string) (bool, error) {
	return country == "MX" && (state == "09" || state == "14"), l.err
}
func (l filterLookupStub) MunicipalityState(_ context.Context, country, municipality string) (string, error) {
	if country == "MX" && municipality == "14039" {
		return "14", l.err
	}
	return "", l.err
}
func TestValidateFiltersCatalogMembership(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		valid     bool
	}{
		{"no filters", "", true}, {"all dimensions", "state=09&state=14&municipality=14039&applicant_country=CO", true},
		{"independent dimensions", "state=09&municipality=14039", true},
		{"unknown state", "state=99", false}, {"unknown municipality", "municipality=99999", false}, {"unknown country", "applicant_country=ZZ", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q, err := ParseQuery(tc.raw)
			if err != nil {
				t.Fatal(err)
			}
			err = ValidateFilters(context.Background(), filterLookupStub{}, q)
			if tc.valid && err != nil || !tc.valid && !errors.Is(err, ErrInvalidFilter) {
				t.Fatalf("validation=%v", err)
			}
		})
	}
	outage := errors.New("catalog unavailable")
	for _, raw := range []string{"state=09", "municipality=14039", "applicant_country=MX"} {
		t.Run("outage "+raw, func(t *testing.T) {
			q, _ := ParseQuery(raw)
			if err := ValidateFilters(context.Background(), filterLookupStub{outage}, q); !errors.Is(err, outage) {
				t.Fatalf("outage=%v", err)
			}
		})
	}
}
