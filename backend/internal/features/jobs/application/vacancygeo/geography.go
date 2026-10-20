// Package vacancygeo owns the vacancy geography wire values. Catalog consistency
// is delegated to G1; canonical drafts contain codes, never display names.
package vacancygeo

import (
	"context"
	"fmt"
	"regexp"

	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

type Location struct {
	Country      string `json:"country"`
	State        string `json:"state,omitempty"`
	Municipality string `json:"municipality,omitempty"`
	PostalCode   string `json:"postal_code,omitempty"`
}
type RemoteScope struct {
	Kind      string   `json:"kind"`
	Countries []string `json:"countries,omitempty"`
}
type Reference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type ReadLocation struct {
	Country      Reference  `json:"country"`
	State        *Reference `json:"state"`
	Municipality *Reference `json:"municipality"`
	PostalCode   *string    `json:"postal_code"`
	Label        string     `json:"label"`
}
type ReadRemoteScope struct {
	Kind      string      `json:"kind"`
	Countries []Reference `json:"countries,omitempty"`
}
type Detail struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}
type Invalid struct {
	Remote  bool
	Details []Detail
}

func (e *Invalid) Error() string {
	if e.Remote {
		return "invalid remote scope"
	}
	return "invalid location"
}
func invalid(remote bool, field, reason string) error {
	return &Invalid{Remote: remote, Details: []Detail{{Field: field, Reason: reason}}}
}

// ParseLocation handles only wire types; unknown keys are rejected by the
// request structural preflight. G1 validates required levels and catalog codes.
func ParseLocation(raw any) (*Location, error) {
	if raw == nil {
		return nil, nil
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return nil, invalid(false, "fields.location.country", "required")
	}
	out := &Location{}
	for _, f := range []struct {
		key string
		dst *string
	}{{"country", &out.Country}, {"state", &out.State}, {"municipality", &out.Municipality}, {"postal_code", &out.PostalCode}} {
		if v, present := obj[f.key]; present {
			s, ok := v.(string)
			if !ok {
				return nil, invalid(false, "fields.location."+f.key, "unknown")
			}
			*f.dst = s
		}
	}
	return out, nil
}
func ParseRemoteScope(raw any) (*RemoteScope, error) {
	if raw == nil {
		return nil, nil
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return nil, invalid(true, "fields.remote_scope", "empty")
	}
	kind, _ := obj["kind"].(string)
	out := &RemoteScope{Kind: kind}
	if kind == "anywhere" {
		if _, present := obj["countries"]; present {
			return nil, invalid(true, "fields.remote_scope.countries", "empty")
		}
		return out, nil
	}
	if kind != "countries" {
		return nil, invalid(true, "fields.remote_scope", "empty")
	}
	values, ok := obj["countries"].([]any)
	if !ok || len(values) == 0 {
		return nil, invalid(true, "fields.remote_scope.countries", "empty")
	}
	if len(values) > 50 {
		return nil, invalid(true, "fields.remote_scope.countries", "too_many")
	}
	seen := map[string]bool{}
	for i, v := range values {
		c, ok := v.(string)
		field := fmt.Sprintf("fields.remote_scope.countries[%d]", i)
		if !ok || !countryFormat.MatchString(c) {
			return nil, invalid(true, field, "unknown_country")
		}
		if seen[c] {
			return nil, invalid(true, field, "duplicate")
		}
		seen[c] = true
		out.Countries = append(out.Countries, c)
	}
	return out, nil
}

var countryFormat = regexp.MustCompile(`^[A-Z]{2}$`)

func Validate(ctx context.Context, lookup geo.Lookup, location *Location, scope *RemoteScope) error {
	var value *domain.Value
	if location != nil {
		value = &domain.Value{Country: location.Country, State: location.State, Municipality: location.Municipality, PostalCode: location.PostalCode}
	}
	violations, err := geo.NewValidator(lookup).Validate(ctx, value, domain.Rules{FieldPrefix: "fields.location", AllowPostalCode: true})
	if err != nil {
		return fmt.Errorf("validate vacancy location: %w", err)
	}
	if len(violations) > 0 {
		details := make([]Detail, 0, len(violations))
		for _, v := range violations {
			details = append(details, Detail{Field: v.Field, Reason: v.Reason})
		}
		return &Invalid{Details: details}
	}
	if scope != nil && scope.Kind == "countries" {
		for i, c := range scope.Countries {
			ok, err := lookup.CountryExists(ctx, c)
			if err != nil {
				return fmt.Errorf("validate remote country: %w", err)
			}
			if !ok {
				return invalid(true, fmt.Sprintf("fields.remote_scope.countries[%d]", i), "unknown_country")
			}
		}
	}
	return nil
}
func LocationValue(v *Location) any {
	if v == nil {
		return nil
	}
	out := map[string]any{"country": v.Country}
	for _, f := range []struct{ k, v string }{{"state", v.State}, {"municipality", v.Municipality}, {"postal_code", v.PostalCode}} {
		if f.v != "" {
			out[f.k] = f.v
		}
	}
	return out
}
func RemoteValue(v *RemoteScope) any {
	if v == nil {
		return nil
	}
	out := map[string]any{"kind": v.Kind}
	if v.Kind == "countries" {
		items := make([]any, 0, len(v.Countries))
		for _, c := range v.Countries {
			items = append(items, c)
		}
		out["countries"] = items
	}
	return out
}
