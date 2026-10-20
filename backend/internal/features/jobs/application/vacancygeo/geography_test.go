package vacancygeo

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

type lookupStub struct{ err error }

func (s lookupStub) CountryExists(_ context.Context, c string) (bool, error) {
	return c == "MX" || c == "CO", s.err
}
func (s lookupStub) StateExists(_ context.Context, c, state string) (bool, error) {
	return c == "MX" && (state == "14" || state == "09"), s.err
}
func (s lookupStub) MunicipalityState(_ context.Context, c, m string) (string, error) {
	if c == "MX" && m == "14039" {
		return "14", s.err
	}
	return "", s.err
}
func (s lookupStub) PostalMatches(_ context.Context, c, p string) ([]domain.PostalMatch, error) {
	if c == "MX" && p == "44100" {
		return []domain.PostalMatch{{Municipality: domain.Item{Code: "14039"}}}, s.err
	}
	return nil, s.err
}
func TestValidateCatalogConsistencyAndFailureSeparation(t *testing.T) {
	for _, tc := range []struct {
		name          string
		location      *Location
		scope         *RemoteScope
		field, reason string
		remote        bool
	}{
		{name: "null allowed"},
		{name: "MX partial allowed", location: &Location{Country: "MX"}},
		{name: "postal valid", location: &Location{Country: "MX", State: "14", Municipality: "14039", PostalCode: "44100"}},
		{name: "unknown country", location: &Location{Country: "ZZ"}, field: "fields.location.country", reason: "unknown"},
		{name: "required country", location: &Location{}, field: "fields.location.country", reason: "required"},
		{name: "state outside MX", location: &Location{Country: "CO", State: "14"}, field: "fields.location.state", reason: "not_allowed"},
		{name: "parent mismatch", location: &Location{Country: "MX", State: "09", Municipality: "14039"}, field: "fields.location.municipality", reason: "mismatch"},
		{name: "unknown postal", location: &Location{Country: "MX", State: "14", Municipality: "14039", PostalCode: "00000"}, field: "fields.location.postal_code", reason: "unknown"},
		{name: "unknown remote country", scope: &RemoteScope{Kind: "countries", Countries: []string{"MX", "ZZ"}}, field: "fields.remote_scope.countries[1]", reason: "unknown_country", remote: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := Validate(context.Background(), lookupStub{}, tc.location, tc.scope)
			if tc.reason == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var invalid *Invalid
			if !errors.As(err, &invalid) || invalid.Remote != tc.remote || !reflect.DeepEqual(invalid.Details, []Detail{{tc.field, tc.reason}}) {
				t.Fatalf("%+v %v", invalid, err)
			}
		})
	}
	storage := errors.New("storage unavailable")
	if err := Validate(context.Background(), lookupStub{storage}, &Location{Country: "MX"}, nil); !errors.Is(err, storage) {
		t.Fatal(err)
	}
}
func TestRemoteScopeValidationOrderAndLimits(t *testing.T) {
	tooMany := make([]any, 51)
	for i := range tooMany {
		tooMany[i] = "MX"
	}
	for _, tc := range []struct {
		name   string
		raw    any
		reason string
	}{
		{"empty", map[string]any{"kind": "countries", "countries": []any{}}, "empty"},
		{"too many before duplicate", map[string]any{"kind": "countries", "countries": tooMany}, "too_many"},
		{"duplicate", map[string]any{"kind": "countries", "countries": []any{"MX", "MX"}}, "duplicate"},
		{"lowercase", map[string]any{"kind": "countries", "countries": []any{"mx"}}, "unknown_country"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseRemoteScope(tc.raw)
			var invalid *Invalid
			if !errors.As(err, &invalid) || !invalid.Remote || invalid.Details[0].Reason != tc.reason {
				t.Fatal(err)
			}
		})
	}
	for _, size := range []int{1, 50} {
		t.Run(fmt.Sprint(size)+" unique", func(t *testing.T) {
			values := make([]any, size)
			for i := range values {
				values[i] = string([]byte{'A' + byte(i/26), 'A' + byte(i%26)})
			}
			scope, err := ParseRemoteScope(map[string]any{"kind": "countries", "countries": values})
			if err != nil || len(scope.Countries) != size || scope.Countries[size-1] != values[size-1] {
				t.Fatal(scope, err)
			}
		})
	}
	scope, err := ParseRemoteScope(map[string]any{"kind": "countries", "countries": []any{"CO", "MX"}})
	if err != nil || !reflect.DeepEqual(scope.Countries, []string{"CO", "MX"}) {
		t.Fatal(scope, err)
	}
}
