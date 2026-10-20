package application

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

// LocationInput accepts codes only. Postal presence is tracked separately so a
// candidate cannot submit postal_code even as an empty string or JSON null.
type LocationInput struct {
	Country       string `json:"country"`
	State         string `json:"state,omitempty"`
	Municipality  string `json:"municipality,omitempty"`
	PostalCode    string `json:"postal_code,omitempty"`
	postalPresent bool
}

func (v *LocationInput) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if fields == nil {
		return errors.New("location must be an object")
	}
	*v = LocationInput{}
	for key, raw := range fields {
		var dst *string
		switch key {
		case "country":
			dst = &v.Country
		case "state":
			dst = &v.State
		case "municipality":
			dst = &v.Municipality
		case "postal_code":
			dst = &v.PostalCode
			v.postalPresent = true
			// Presence is validated by context; null is still a submitted postal key.
			if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				continue
			}
		default:
			return fmt.Errorf("unknown location key %q", key)
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("location %s must be a string", key)
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			return err
		}
	}
	return nil
}

func (v *LocationInput) Value() *domain.Value {
	if v == nil {
		return nil
	}
	return &domain.Value{Country: v.Country, State: v.State, Municipality: v.Municipality, PostalCode: v.PostalCode}
}

type LocationDetail struct {
	Field  string `json:"field"`
	Reason string `json:"reason"`
}
type InvalidLocation struct{ Details []LocationDetail }

func (e *InvalidLocation) Error() string { return "invalid location" }

// ValidateLocation reuses G1's consistency validator with context-specific rules.
func ValidateLocation(ctx context.Context, lookup Lookup, v *LocationInput, allowPostal bool) error {
	if v != nil && !allowPostal && (v.postalPresent || v.PostalCode != "") {
		return &InvalidLocation{Details: []LocationDetail{{Field: "location.postal_code", Reason: "not_allowed"}}}
	}
	if v != nil && lookup == nil {
		return errors.New("location catalog is not configured")
	}
	violations, err := NewValidator(lookup).Validate(ctx, v.Value(), domain.Rules{AllowPostalCode: allowPostal})
	if err != nil {
		return fmt.Errorf("validate location: %w", err)
	}
	if len(violations) > 0 {
		details := make([]LocationDetail, 0, len(violations))
		for _, v := range violations {
			details = append(details, LocationDetail{Field: v.Field, Reason: v.Reason})
		}
		return &InvalidLocation{Details: details}
	}
	return nil
}

type LocationReference struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type ReadLocation struct {
	Country      LocationReference  `json:"country"`
	State        *LocationReference `json:"state"`
	Municipality *LocationReference `json:"municipality"`
	PostalCode   *string            `json:"postal_code"`
	Label        string             `json:"label"`
}

// ExpandLocation resolves display names through the existing catalog port. Never
// substitute a code for a missing name: a broken catalog is a storage error.
func ExpandLocation(ctx context.Context, reader Reader, v *domain.Value) (*ReadLocation, error) {
	if v == nil {
		return nil, nil
	}
	if reader == nil {
		return nil, errors.New("location catalog is not configured")
	}
	find := func(items []domain.Item, id string) (*LocationReference, error) {
		for _, item := range items {
			if item.Code == id {
				return &LocationReference{ID: id, Name: item.Name}, nil
			}
		}
		return nil, fmt.Errorf("location catalog reference %q not found", id)
	}
	countries, err := reader.Countries(ctx)
	if err != nil {
		return nil, fmt.Errorf("read location countries: %w", err)
	}
	country, err := find(countries, v.Country)
	if err != nil {
		return nil, err
	}
	out := &ReadLocation{Country: *country, Label: country.Name}
	if v.State != "" {
		states, err := reader.States(ctx, v.Country)
		if err != nil {
			return nil, fmt.Errorf("read location states: %w", err)
		}
		out.State, err = find(states, v.State)
		if err != nil {
			return nil, err
		}
		out.Label = out.State.Name
	}
	if v.Municipality != "" {
		municipalities, err := reader.Municipalities(ctx, v.Country, v.State)
		if err != nil {
			return nil, fmt.Errorf("read location municipalities: %w", err)
		}
		out.Municipality, err = find(municipalities, v.Municipality)
		if err != nil {
			return nil, err
		}
		if out.State == nil {
			return nil, errors.New("location municipality has no state")
		}
		out.Label = out.Municipality.Name + ", " + out.State.Name
	}
	if v.PostalCode != "" {
		postal := v.PostalCode
		out.PostalCode = &postal
	}
	return out, nil
}
