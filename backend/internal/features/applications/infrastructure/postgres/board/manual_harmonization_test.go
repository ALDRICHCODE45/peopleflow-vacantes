package board

import (
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
)

func TestManualLegacyProfileProjection(t *testing.T) {
	for _, tc := range []struct {
		years string
		want  int
	}{{"0", 0}, {"0.9", 0}, {"7.9", 7}, {"60", 60}} {
		got := manualLegacyYears(&tc.years)
		if got == nil || *got != tc.want {
			t.Fatalf("years %q: %v", tc.years, got)
		}
	}
	if manualLegacyYears(nil) != nil {
		t.Fatal("null years became non-null")
	}
	for _, tc := range []struct {
		name      string
		education []app.ManualEducation
		want      string
	}{
		{"none", nil, ""},
		{"ongoing doctorate", []app.ManualEducation{{Level: "phd", Status: "in_progress"}}, ""},
		{"new levels", []app.ManualEducation{{Level: "tsu", Status: "completed"}, {Level: "specialty", Status: "completed"}}, ""},
		{"highest completed legacy", []app.ManualEducation{{Level: "master", Status: "completed"}, {Level: "phd", Status: "in_progress"}, {Level: "bachelor", Status: "completed"}, {Level: "specialty", Status: "completed"}}, "master"},
		{"paused and incomplete", []app.ManualEducation{{Level: "master", Status: "paused"}, {Level: "phd", Status: "incomplete"}, {Level: "high_school", Status: "completed"}}, "high_school"},
		{"completed doctorate", []app.ManualEducation{{Level: "phd", Status: "completed"}, {Level: "master", Status: "completed"}}, "phd"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := manualLegacyEducation(tc.education)
			if tc.want == "" {
				if got != nil {
					t.Fatal(*got)
				}
			} else if got == nil || *got != tc.want {
				t.Fatal(got)
			}
		})
	}
}
