package board_test

import (
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"testing"
)

func TestCoverageMilestoneRequiresHireAndFirstOrRenewedReach(t *testing.T) {
	required := int64(2)
	for _, tc := range []struct {
		name               string
		hire               bool
		before, after      int64
		required           *int64
		hasMilestone, want bool
	}{
		{"below", true, 0, 1, &required, false, false},
		{"first reach", true, 1, 2, &required, false, true},
		{"first hire after headcount change", true, 2, 3, &required, false, true},
		{"already covered", true, 2, 3, &required, true, false},
		{"renewed reach", true, 1, 2, &required, true, true},
		{"departure", false, 2, 1, &required, true, false},
		{"no headcount", true, 1, 2, nil, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := app.RecordCoverageMilestone(tc.hire, tc.before, tc.after, tc.required, tc.hasMilestone); got != tc.want {
				t.Fatal(got)
			}
		})
	}
}
