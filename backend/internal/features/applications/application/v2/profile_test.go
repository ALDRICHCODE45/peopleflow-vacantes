package v2_test

import (
	"encoding/json"
	"reflect"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
)

func TestProfileSnapshotNormalization(t *testing.T) {
	for _, tc := range []struct {
		name     string
		location *app.SnapshotLocation
		want     any
	}{
		{"missing", nil, nil},
		{"country", &app.SnapshotLocation{Country: "CO"}, map[string]any{"country": "CO", "state": nil, "municipality": nil}},
		{"state", &app.SnapshotLocation{Country: "MX", State: str("14")}, map[string]any{"country": "MX", "state": "14", "municipality": nil}},
		{"municipality", &app.SnapshotLocation{Country: "MX", State: str("14"), Municipality: str("14039")}, map[string]any{"country": "MX", "state": "14", "municipality": "14039"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			years, education := 0, "bachelor"
			skills := []string{" Go ", "SQL", "Go"}
			got := app.SnapshotProfile(tc.location, skills, &years, &education)
			skills[0] = "edited"
			years, education = 9, "phd"
			if tc.location != nil {
				tc.location.Country = "US"
				if tc.location.State != nil {
					*tc.location.State = "09"
				}
				if tc.location.Municipality != nil {
					*tc.location.Municipality = "09001"
				}
			}
			raw, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err = json.Unmarshal(raw, &obj); err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"location": tc.want, "skills": []any{" Go ", "SQL", "Go"}, "years_of_experience": float64(0), "education_level": "bachelor"}
			if !reflect.DeepEqual(obj, want) {
				t.Fatalf("got %s", raw)
			}
		})
	}
}
func str(s string) *string { return &s }

func TestApplicantCountryGate(t *testing.T) {
	for _, tc := range []struct {
		name, mode    string
		kind, country *string
		want          error
	}{
		{"required", "remote", str("countries"), nil, app.ErrApplicantCountryRequired},
		{"empty", "remote", str("countries"), str(""), app.ErrApplicantCountryRequired},
		{"disallowed", "remote", str("countries"), str("US"), app.ErrApplicantCountryNotAllowed},
		{"first allowed", "remote", str("countries"), str("CO"), nil},
		{"last allowed", "remote", str("countries"), str("MX"), nil},
		{"anywhere", "remote", str("anywhere"), nil, nil},
		{"onsite", "onsite", str("countries"), nil, nil},
		{"hybrid", "hybrid", str("countries"), str("US"), nil},
		{"legacy scope", "remote", nil, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			allowed := []string{"CO", "MX"}
			err := app.CheckApplicantCountry(tc.mode, tc.kind, allowed, tc.country)
			if tc.want == nil {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			restriction, ok := err.(*app.CountryRestriction)
			if !ok || restriction.Cause != tc.want || !reflect.DeepEqual(restriction.Allowed, allowed) {
				t.Fatalf("gate: %#v", err)
			}
			allowed[0] = "US"
			if restriction.Allowed[0] != "CO" {
				t.Fatal("aliased allowed countries")
			}
		})
	}
}
