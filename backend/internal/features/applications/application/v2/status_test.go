package v2

import (
	"github.com/google/uuid"
	"testing"
)

func TestCandidateStatusHidesStage(t *testing.T) {
	initial := uuid.New()
	for _, tc := range []struct {
		name  string
		stage uuid.UUID
		want  string
	}{{"new", initial, "submitted"}, {"other", uuid.New(), "in_process"}} {
		t.Run(tc.name, func(t *testing.T) {
			if got := CandidateStatus(tc.stage, initial); got != tc.want {
				t.Fatal(got)
			}
		})
	}
}
