package v2

import (
	"github.com/google/uuid"
	"testing"
)

func TestCandidateStatusHidesStage(t *testing.T) {
	initial := uuid.New()
	for _, tc := range []struct {
		name      string
		stage     uuid.UUID
		want      string
		discarded bool
	}{{"new", initial, "submitted", false}, {"other", uuid.New(), "in_process", false}, {"discarded", uuid.New(), "closed", true}} {
		t.Run(tc.name, func(t *testing.T) {
			if got := CandidateStatus(tc.stage, initial, tc.discarded); got != tc.want {
				t.Fatal(got)
			}
		})
	}
}
