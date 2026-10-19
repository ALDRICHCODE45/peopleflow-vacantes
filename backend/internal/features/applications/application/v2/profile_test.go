package v2_test

import (
	"encoding/json"
	"reflect"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
)

func TestProfileSnapshotNormalization(t *testing.T) {
	for _, tc := range []struct {
		name string
		city *string
		want any
	}{
		{"missing", nil, nil}, {"empty", str(""), nil}, {"whitespace", str(" \t\n\u00a0"), nil},
		{"collapsed", str(" \tSan\u00a0  Luis\n Potosí  "), "San Luis Potosí"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			years, education := 0, "bachelor"
			skills := []string{" Go ", "SQL", "Go"}
			got := app.SnapshotProfile(tc.city, skills, &years, &education)
			skills[0] = "edited"
			years, education = 9, "phd"
			raw, err := json.Marshal(got)
			if err != nil {
				t.Fatal(err)
			}
			var obj map[string]any
			if err = json.Unmarshal(raw, &obj); err != nil {
				t.Fatal(err)
			}
			want := map[string]any{"city": tc.want, "skills": []any{" Go ", "SQL", "Go"}, "years_of_experience": float64(0), "education_level": "bachelor"}
			if !reflect.DeepEqual(obj, want) {
				t.Fatalf("got %s", raw)
			}
		})
	}
	raw, err := json.Marshal(app.SnapshotProfile(nil, nil, nil, nil))
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `{"city":null,"skills":[],"years_of_experience":null,"education_level":null}` {
		t.Fatal(string(raw))
	}
}
func str(s string) *string { return &s }
