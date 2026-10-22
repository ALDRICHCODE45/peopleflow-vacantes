package board

import (
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"testing"
)

func TestManualHarmonizedEducation(t *testing.T) {
	for _, tc := range []struct {
		name               string
		education          []app.ManualEducation
		completed, ongoing string
	}{
		{"none", nil, "", ""},
		{"ongoing doctorate", []app.ManualEducation{{Level: "phd", Status: "in_progress"}}, "", "phd"},
		{"new levels", []app.ManualEducation{{Level: "tsu", Status: "completed"}, {Level: "specialty", Status: "completed"}}, "specialty", ""},
		{"highest completed", []app.ManualEducation{{Level: "master", Status: "completed"}, {Level: "phd", Status: "in_progress"}, {Level: "bachelor", Status: "completed"}, {Level: "specialty", Status: "completed"}}, "master", "phd"},
		{"paused and incomplete", []app.ManualEducation{{Level: "master", Status: "paused"}, {Level: "phd", Status: "incomplete"}, {Level: "high_school", Status: "completed"}}, "high_school", ""},
		{"highest ongoing", []app.ManualEducation{{Level: "technical", Status: "in_progress"}, {Level: "master", Status: "in_progress"}, {Level: "phd", Status: "paused"}, {Level: "specialty", Status: "in_progress"}}, "", "master"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := manualEducation(tc.education)
			assertLevel(t, got.HighestCompleted, tc.completed)
			assertLevel(t, got.InProgress, tc.ongoing)
		})
	}
	// Both summaries use the entire ordered vocabulary, independently of record order.
	for _, status := range []string{"completed", "in_progress"} {
		var records []app.ManualEducation
		for _, level := range languages.EducationLevels() {
			records = append([]app.ManualEducation{{Level: level, Status: status}}, records...)
			got := manualEducation(records)
			if status == "completed" {
				assertLevel(t, got.HighestCompleted, level)
				assertLevel(t, got.InProgress, "")
			} else {
				assertLevel(t, got.InProgress, level)
				assertLevel(t, got.HighestCompleted, "")
			}
		}
	}
}

func assertLevel(t *testing.T, got *string, want string) {
	t.Helper()
	if want == "" {
		if got != nil {
			t.Fatalf("want null, got %s", *got)
		}
		return
	}
	if got == nil || *got != want {
		t.Fatalf("want %s, got %v", want, got)
	}
}
