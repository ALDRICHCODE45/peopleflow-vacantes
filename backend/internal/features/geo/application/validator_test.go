package application

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

type lookupStub struct{ err error }

func (s lookupStub) CountryExists(_ context.Context, country string) (bool, error) {
	return country == "MX" || country == "US", s.err
}
func (s lookupStub) StateExists(_ context.Context, _, state string) (bool, error) {
	return state == "14" || state == "15", s.err
}
func (s lookupStub) MunicipalityState(_ context.Context, _, municipality string) (string, error) {
	if municipality == "99999" {
		return "", s.err
	}
	return "14", s.err
}
func (s lookupStub) PostalMatches(_ context.Context, _, postal string) ([]domain.PostalMatch, error) {
	if postal == "00000" {
		return nil, s.err
	}
	return []domain.PostalMatch{{Municipality: domain.Item{Code: "14039"}}}, s.err
}
func TestValidator(t *testing.T) {
	full := domain.Value{Country: "MX", State: "14", Municipality: "14039", PostalCode: "44100"}
	for _, tc := range []struct {
		name  string
		value *domain.Value
		rules domain.Rules
		want  []domain.Violation
	}{
		{name: "optional null"},
		{name: "required null", rules: domain.Rules{Required: true}, want: []domain.Violation{{Field: "location", Reason: "required"}}},
		{name: "country required", value: &domain.Value{}, want: []domain.Violation{{Field: "location.country", Reason: "required"}}},
		{name: "full Mexico", value: &full, rules: domain.Rules{AllowPostalCode: true}},
		{name: "unknown country", value: &domain.Value{Country: "ZZ"}, want: []domain.Violation{{Field: "location.country", Reason: "unknown"}}},
		{name: "padded country", value: &domain.Value{Country: "MX "}, want: []domain.Violation{{Field: "location.country", Reason: "unknown"}}},
		{name: "unknown state", value: &domain.Value{Country: "MX", State: "99"}, want: []domain.Violation{{Field: "location.state", Reason: "unknown"}}},
		{name: "unknown municipality", value: &domain.Value{Country: "MX", State: "14", Municipality: "99999"}, want: []domain.Violation{{Field: "location.municipality", Reason: "unknown"}}},
		{name: "required municipality", value: &domain.Value{Country: "MX", State: "14"}, rules: domain.Rules{RequireMunicipality: true}, want: []domain.Violation{{Field: "location.municipality", Reason: "required"}}},
		{name: "postal requires municipality", value: &domain.Value{Country: "MX", State: "14", PostalCode: "44100"}, rules: domain.Rules{AllowPostalCode: true}, want: []domain.Violation{{Field: "location.municipality", Reason: "required"}}},
		{name: "unknown postal", value: &domain.Value{Country: "MX", State: "14", Municipality: "14039", PostalCode: "00000"}, rules: domain.Rules{AllowPostalCode: true}, want: []domain.Violation{{Field: "location.postal_code", Reason: "unknown"}}},
		{name: "country only international", value: &domain.Value{Country: "US"}},
		{name: "non Mexico state", value: &domain.Value{Country: "US", State: "14"}, want: []domain.Violation{{Field: "location.state", Reason: "not_allowed"}}},
		{name: "required state", value: &domain.Value{Country: "MX"}, rules: domain.Rules{RequireState: true}, want: []domain.Violation{{Field: "location.state", Reason: "required"}}},
		{name: "missing parent", value: &domain.Value{Country: "MX", Municipality: "14039"}, want: []domain.Violation{{Field: "location.state", Reason: "required"}}},
		{name: "municipality mismatch", value: &domain.Value{Country: "MX", State: "15", Municipality: "14039"}, want: []domain.Violation{{Field: "location.municipality", Reason: "mismatch"}}},
		{name: "postal disallowed", value: &full, want: []domain.Violation{{Field: "location.postal_code", Reason: "not_allowed"}}},
		{name: "postal invalid", value: &domain.Value{Country: "MX", State: "14", Municipality: "14039", PostalCode: "4410"}, rules: domain.Rules{AllowPostalCode: true}, want: []domain.Violation{{Field: "location.postal_code", Reason: "unknown"}}},
		{name: "postal mismatch", value: &domain.Value{Country: "MX", State: "14", Municipality: "14040", PostalCode: "44100"}, rules: domain.Rules{AllowPostalCode: true, FieldPrefix: "fields.location"}, want: []domain.Violation{{Field: "fields.location.postal_code", Reason: "mismatch"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NewValidator(lookupStub{}).Validate(context.Background(), tc.value, tc.rules)
			if err != nil || !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got=%v err=%v want=%v", got, err, tc.want)
			}
		})
	}
	sentinel := errors.New("db unavailable")
	if _, err := NewValidator(lookupStub{sentinel}).Validate(context.Background(), &full, domain.Rules{}); !errors.Is(err, sentinel) {
		t.Fatal("database failure must not become invalid location", err)
	}
}
