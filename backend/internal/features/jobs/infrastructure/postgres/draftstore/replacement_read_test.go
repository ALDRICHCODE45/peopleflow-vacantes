package draftstore

import (
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestNamedStageResolvesLiveExitAndRetiredStages(t *testing.T) {
	draft := uuid.New()
	p := pipelineconfig.Defaults(draft)
	retired := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Entrevista vieja"}
	p.Retired = []pipelineconfig.RetiredStage{{Stage: retired, Position: 2}}
	for name, tc := range map[string]struct {
		id   string
		want carryStage
	}{
		"a live stage": {p.Stages[0].ID, carryStage{Kind: p.Stages[0].Kind, Name: p.Stages[0].Name}},
		"the exit":     {p.Exit.ID, carryStage{Kind: p.Exit.Kind, Name: p.Exit.Name}},
		"a retired":    {retired.ID, carryStage{Kind: "custom", Name: "Entrevista vieja"}},
	} {
		got, err := namedStage(p, uuid.MustParse(tc.id))
		if err != nil || got != tc.want {
			t.Fatalf("%s: %+v, %v; want %+v", name, got, err, tc.want)
		}
	}
	// A stage of another process (ids are anchored to the draft) is an invariant failure, never a guess.
	if got, err := namedStage(p, uuid.New()); err == nil {
		t.Fatalf("unknown stage resolved to %+v", got)
	}
}

// The codes Start fills itself never reach publish_ready (contract, point 8).
func TestStartFilledCodesAreTheSixStartFills(t *testing.T) {
	for _, code := range []string{"request_date_missing", "hiring_headcount_missing", "delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing", "commitment_date_past"} {
		if !startFilledCodes[code] {
			t.Fatalf("%s must be start-filled", code)
		}
	}
	for _, code := range []string{"title_missing", "description_missing", "requester_missing", "location_missing"} {
		if startFilledCodes[code] {
			t.Fatalf("%s is the source's content, not Start's", code)
		}
	}
	if len(startFilledCodes) != 6 {
		t.Fatalf("%d codes", len(startFilledCodes))
	}
}
