package pipelineconfig_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestColumnIDsExactLaterAndInterleavedIdlessOrdinals(t *testing.T) {
	for _, version := range []int64{0, 7} {
		t.Run(map[int64]string{0: "initial", 7: "later version"}[version], func(t *testing.T) {
			base := pc.Defaults(draftID)
			// Existing IDs (including a custom one) do not consume id-less ordinals.
			existing := pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Existing"}
			base.Stages = append(base.Stages[:2:2], append([]pc.Stage{existing}, base.Stages[2:]...)...)
			proposal := pc.Defaults(draftID)
			proposal.Stages = []pc.Stage{proposal.Stages[0], {Name: "First"}, proposal.Stages[1], existing, proposal.Stages[2], {Name: "Second"}, proposal.Stages[3], proposal.Stages[4]}
			raw := replacement(t, proposal)
			// replacement includes empty IDs; wire creation must omit them.
			raw = []byte(strings.ReplaceAll(string(raw), `"id":"",`, ""))
			got, err := pc.Replace(base, raw, draftID, version)
			if err != nil {
				t.Fatal(err)
			}
			for ordinal, position := range []int{1, 5} {
				want := uuid.NewSHA1(draftID, []byte(fmt.Sprintf("pipeline-custom:%d:%d", version, ordinal))).String()
				if got.Stages[position].ID != want {
					t.Fatalf("ordinal %d at position %d: got %s want %s", ordinal, position, got.Stages[position].ID, want)
				}
			}
			if got.Stages[3].ID != existing.ID {
				t.Fatal("existing identity changed")
			}
		})
	}
}

func TestColumnRecoveryReassignedSeveralRetiredStagesOrderedByPositionThenID(t *testing.T) {
	previous := pc.Defaults(draftID)
	a := pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Earlier"}
	b := pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Later"}
	previous.Stages = append(previous.Stages[:2:2], a, previous.Stages[2], b, previous.Stages[3], previous.Stages[4])
	next, err := pc.Replace(previous, replacement(t, pc.Defaults(draftID)), draftID, 4)
	if err != nil {
		t.Fatal(err)
	}
	// IDs deliberately disagree with retired-stage order, input is unsorted.
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"}
	people := []pc.Participation{
		{ID: ids[2], StageID: next.Exit.ID, PreviousStageID: a.ID},
		{ID: ids[0], StageID: next.Exit.ID, PreviousStageID: b.ID},
		{ID: ids[1], StageID: next.Exit.ID, PreviousStageID: a.ID},
	}
	got, err := pc.ComputeImpact(previous, next, people)
	if err != nil {
		t.Fatal(err)
	}
	want := []pc.RecoveryReassigned{
		{ParticipationID: ids[1], RetiredStageID: a.ID, DefaultStageID: next.Stages[1].ID},
		{ParticipationID: ids[2], RetiredStageID: a.ID, DefaultStageID: next.Stages[1].ID},
		{ParticipationID: ids[0], RetiredStageID: b.ID, DefaultStageID: next.Stages[3].ID},
	}
	if !reflect.DeepEqual(got.RecoveryReassigned, want) {
		t.Fatalf("got %+v want %+v", got.RecoveryReassigned, want)
	}
}
