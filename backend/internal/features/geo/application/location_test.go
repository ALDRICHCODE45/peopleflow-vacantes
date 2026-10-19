package application

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
)

func TestLocationInputStrictShape(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		valid     bool
	}{
		{"country", `{"country":"MX"}`, true},
		{"empty", `{}`, true},
		{"unknown", `{"country":"MX","name":"México"}`, false},
		{"wrong type", `{"country":4}`, false},
		{"null level", `{"country":null}`, false},
		{"string", `"MX"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var got LocationInput
			err := json.Unmarshal([]byte(tc.raw), &got)
			if (err == nil) != tc.valid {
				t.Fatalf("decode: %v", err)
			}
		})
	}
}

func TestCandidatePostalPresenceNotAllowed(t *testing.T) {
	for _, postal := range []string{`"44100"`, `""`, `null`} {
		t.Run(postal, func(t *testing.T) {
			var value LocationInput
			if err := json.Unmarshal([]byte(`{"country":"MX","postal_code":`+postal+`}`), &value); err != nil {
				t.Fatal(err)
			}
			err := ValidateLocation(context.Background(), nil, &value, false)
			invalid, ok := err.(*InvalidLocation)
			if !ok || len(invalid.Details) != 1 || invalid.Details[0].Field != "location.postal_code" || invalid.Details[0].Reason != "not_allowed" {
				t.Fatalf("got %#v", err)
			}
		})
	}
}

func TestReadLocationOptional(t *testing.T) {
	got, err := ExpandLocation(context.Background(), nil, nil)
	if err != nil || got != nil {
		t.Fatalf("null: %+v %v", got, err)
	}
	if _, err := ExpandLocation(context.Background(), nil, &domain.Value{Country: "MX"}); err == nil {
		t.Fatal("missing catalog must fail closed")
	}
}
