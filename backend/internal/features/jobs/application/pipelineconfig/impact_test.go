package pipelineconfig_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestColumnIDsDeterministicAndNeverReused(t *testing.T) {
	base := pc.Defaults(draftID)
	// Insert after Nuevos without duplicating it.
	body := []byte(strings.Replace(string(replacement(t, base)), `{"id":"`+base.Stages[1].ID+`"`, `{"name":"Added"},{"id":"`+base.Stages[1].ID+`"`, 1))
	a, err := pc.Replace(base, body, draftID, 0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := pc.Replace(base, body, draftID, 0)
	if err != nil || !a.Equal(b) || uuid.MustParse(a.Stages[1].ID).Version() != 5 || a.Stages[1].ID != uuid.NewSHA1(draftID, []byte("pipeline-custom:0:0")).String() {
		t.Fatal(a, b, err)
	}
	removed, err := pc.Replace(a, replacement(t, base), draftID, 1)
	if err != nil || len(removed.Retired) != 1 || removed.Retired[0].Position != 1 {
		t.Fatal(removed, err)
	}
	c, err := pc.Replace(removed, body, draftID, 2)
	if err != nil || c.Stages[1].ID == a.Stages[1].ID || len(c.Retired) != 1 {
		t.Fatal(c, err)
	}
	if _, err := pc.Replace(removed, replacement(t, a), draftID, 2); !errors.Is(err, drafts.ErrValidation) {
		t.Fatal("resurrected retired id", err)
	}
	var old pc.Configuration
	raw, _ := json.Marshal(base)
	var obj map[string]any
	_ = json.Unmarshal(raw, &obj)
	delete(obj, "retired")
	delete(obj, "schema_version")
	raw, _ = json.Marshal(obj)
	_ = json.Unmarshal(raw, &old)
	if err := pc.Validate(old); err != nil || len(old.RetiredStages()) != 0 {
		t.Fatal(old, err)
	}
}

func TestColumnNoopDoesNotInventImpact(t *testing.T) {
	c := pc.Defaults(draftID)
	impact, err := pc.ComputeImpact(c, c, []pc.Participation{{ID: uuid.NewString(), StageID: c.Stages[3].ID}})
	if err != nil || impact.HasImpact() {
		t.Fatal("no-op must have empty applied impact", impact, err)
	}
}

func TestColumnImpactReachedMarkedDiscardedAndOrdering(t *testing.T) {
	previous := pc.Defaults(draftID)
	custom := pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Retained name"}
	previous.Stages = append(previous.Stages[:3:3], custom, previous.Stages[3], previous.Stages[4])
	next, err := pc.Replace(previous, replacement(t, pc.Defaults(draftID)), draftID, 3)
	if err != nil {
		t.Fatal(err)
	}
	// Move in_process before screening, now before both candidates.
	next.Stages[1], next.Stages[3] = next.Stages[3], next.Stages[1]
	a, b := "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
	people := []pc.Participation{
		{ID: b, Candidate: pc.Candidate{ID: b, FullName: "B"}, StageID: next.Exit.ID, PreviousStageID: custom.ID, Reached: map[string]bool{next.Stages[0].ID: true}},
		{ID: a, Candidate: pc.Candidate{ID: a, FullName: "A"}, StageID: next.Stages[3].ID, Reached: map[string]bool{next.Stages[0].ID: true, next.Stages[2].ID: true}},
	}
	impact, err := pc.ComputeImpact(previous, next, people)
	if err != nil {
		t.Fatal(err)
	}
	if len(impact.NotApplicable) != 3 || len(impact.RecoveryReassigned) != 1 || impact.NotApplicable[0].StageID != next.Stages[1].ID || impact.NotApplicable[0].ParticipationID != a || impact.NotApplicable[1].ParticipationID != b || impact.NotApplicable[2].StageID != next.Stages[2].ID {
		t.Fatalf("impact %+v", impact)
	}
	recovery := impact.RecoveryReassigned[0]
	if recovery.DefaultStageID != next.Stages[2].ID || recovery.RetiredStageID != custom.ID {
		t.Fatal(recovery)
	}
	for i := range people {
		people[i].Marked = map[string]bool{}
		for _, mark := range impact.NotApplicable {
			if mark.ParticipationID == people[i].ID {
				people[i].Marked[mark.StageID] = true
			}
		}
	}
	again, err := pc.ComputeImpact(next, next, people)
	if err != nil || len(again.NotApplicable) != 0 || len(again.RecoveryReassigned) != 0 {
		t.Fatal("duplicate impact", again, err)
	}
	// Existing retired names/positions survive later edits and source is untouched.
	if len(previous.Retired) != 0 || !reflect.DeepEqual(next.Retired[0].Stage, custom) {
		t.Fatal(previous, next)
	}
}

func TestColumnOccupiedCatalogOrder(t *testing.T) {
	previous := pc.Defaults(draftID)
	a, b := pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "A"}, pc.Stage{ID: uuid.NewString(), Kind: "custom", Name: "B"}
	previous.Stages = append(previous.Stages[:2:2], a, b, previous.Stages[2], previous.Stages[3], previous.Stages[4])
	next, err := pc.Replace(previous, replacement(t, pc.Defaults(draftID)), draftID, 2)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pc.ComputeImpact(previous, next, []pc.Participation{{StageID: b.ID}, {StageID: a.ID}})
	var occupied *pc.Occupied
	if !errors.As(err, &occupied) || !reflect.DeepEqual(occupied.StageIDs, []string{a.ID, b.ID}) {
		t.Fatal(err)
	}
}
