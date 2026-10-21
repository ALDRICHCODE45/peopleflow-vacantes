package draftstore

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestListCandidates_CurrentOrderZerosAndLiveCounts(t *testing.T) {
	c := pipelineconfig.Defaults(uuid.New())
	custom := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Prueba técnica"}
	retired := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Anterior"}
	c.Retired = []pipelineconfig.RetiredStage{{Stage: retired, Position: 2}}
	c.Stages[1], c.Stages[3] = c.Stages[3], c.Stages[1]
	c.Stages = append(c.Stages[:2:2], append([]pipelineconfig.Stage{custom}, c.Stages[2:]...)...)
	for _, tc := range []struct {
		name                             string
		newCount, customCount, discarded int64
	}{
		{"no participations", 0, 0, 0},
		{"new custom discarded", 2, 3, 1},
		{"recovered to custom", 2, 4, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{"total": tc.newCount + tc.customCount + tc.discarded, "discarded": tc.discarded, "by_stage": []map[string]any{
				{"id": c.Exit.ID, "count": int64(0)}, {"id": custom.ID, "count": tc.customCount}, {"id": c.Stages[0].ID, "count": tc.newCount},
			}})
			if err != nil {
				t.Fatal(err)
			}
			got, err := listCandidates(c, raw)
			if err != nil {
				t.Fatal(err)
			}
			want := &draftlist.Candidates{Total: tc.newCount + tc.customCount + tc.discarded, InProcess: tc.customCount, Discarded: tc.discarded, ByStage: make([]draftlist.CandidateStage, len(c.Stages))}
			for i, stage := range c.Stages {
				want.ByStage[i] = draftlist.CandidateStage{ID: stage.ID, Kind: stage.Kind, Name: stage.Name}
				if stage.Kind == "new" {
					want.ByStage[i].Count = tc.newCount
				}
				if stage.ID == custom.ID {
					want.ByStage[i].Count = tc.customCount
				}
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got=%+v want=%+v", got, want)
			}
		})
	}
}

func TestListCandidates_EveryNonNewKindIsInProcess(t *testing.T) {
	c := pipelineconfig.Defaults(uuid.New())
	for _, stage := range c.Stages {
		t.Run(stage.Kind, func(t *testing.T) {
			raw, err := json.Marshal(map[string]any{"total": 1, "discarded": 0, "by_stage": []map[string]any{{"id": stage.ID, "count": 1}}})
			if err != nil {
				t.Fatal(err)
			}
			got, err := listCandidates(c, raw)
			if err != nil {
				t.Fatal(err)
			}
			wantInProcess := int64(1)
			if stage.Kind == "new" {
				wantInProcess = 0
			}
			if got.Total != 1 || got.InProcess != wantInProcess || got.Discarded != 0 {
				t.Fatalf("kind=%s summary=%+v", stage.Kind, got)
			}
		})
	}
}

func TestListCandidates_EmptyAndMalformedAggregate(t *testing.T) {
	c := pipelineconfig.Defaults(uuid.New())
	got, err := listCandidates(c, nil)
	if err != nil || got.Total != 0 || got.Discarded != 0 || got.InProcess != 0 || len(got.ByStage) != 5 {
		t.Fatalf("empty summary=%+v err=%v", got, err)
	}
	if _, err := listCandidates(c, []byte(`{`)); err == nil {
		t.Fatal("malformed SQL aggregate accepted")
	}
}

func TestListCandidates_RejectsActiveParticipationOutsideCurrentStages(t *testing.T) {
	c := pipelineconfig.Defaults(uuid.New())
	retired := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Retirada"}
	c.Retired = []pipelineconfig.RetiredStage{{Stage: retired, Position: 2}}
	for _, tc := range []struct{ name, id string }{
		{"retired", retired.ID}, {"removed unknown", uuid.NewString()}, {"discarded column without discard", c.Exit.ID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(map[string]any{"total": 1, "discarded": 0, "by_stage": []map[string]any{{"id": tc.id, "count": 1}}})
			if got, err := listCandidates(c, raw); err == nil {
				t.Fatalf("invalid active stage silently accepted: %+v", got)
			}
		})
	}
}
