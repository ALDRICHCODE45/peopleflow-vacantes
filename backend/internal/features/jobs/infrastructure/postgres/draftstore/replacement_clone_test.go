package draftstore

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestClonePipelineAnchorsBuiltinsToTheNewDraftAndKeepsCustomStages(t *testing.T) {
	source, replacement := uuid.New(), uuid.New()
	config := pipelineconfig.Defaults(source)
	custom := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Entrevista técnica"}
	config.Stages = append(config.Stages[:4:4], custom, config.Stages[4])
	config.Retired = []pipelineconfig.RetiredStage{{Stage: pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Vieja"}, Position: 2}}
	wantFirstSourceStage := config.Stages[0]

	got, entries := clonePipeline(config, replacement)
	defaults := pipelineconfig.Defaults(replacement)
	want := []pipelineconfig.Stage{defaults.Stages[0], defaults.Stages[1], defaults.Stages[2], defaults.Stages[3], custom, defaults.Stages[4]}
	if !reflect.DeepEqual(got.Stages, want) || got.Exit != defaults.Exit || got.SchemaVersion != 2 || got.Retired == nil || len(got.Retired) != 0 {
		t.Fatalf("clone = %+v", got)
	}
	// The result is a valid stored configuration for the new draft (decodeStoredPipeline anchors built-in ids).
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeStoredPipeline(replacement, encoded, 1); err != nil {
		t.Fatalf("stored clone rejected: %v", err)
	}
	if len(entries) != 7 {
		t.Fatalf("entries = %v", entries)
	}
	for i, stage := range append(append([]pipelineconfig.Stage{}, config.Stages...), config.Exit) {
		cloned := append(append([]pipelineconfig.Stage{}, got.Stages...), got.Exit)[i]
		if entries[i] != (stageMapEntry{Kind: stage.Kind, SourceStageID: stage.ID, StageID: cloned.ID}) {
			t.Fatalf("entry %d = %+v", i, entries[i])
		}
	}
	mapping := stageIDMap(entries)
	if mapping[custom.ID] != custom.ID || mapping[config.Stages[3].ID] != defaults.Stages[3].ID {
		t.Fatalf("mapping = %v", mapping)
	}
	// The source configuration is not touched.
	if config.Stages[0] != wantFirstSourceStage || len(config.Retired) != 1 {
		t.Fatal("clonePipeline mutated its input")
	}
}

func TestRemapStageIDs(t *testing.T) {
	mapping := map[string]string{"a": "A", "b": "B"}
	got, err := remapStageIDs([]byte(`{"criteria":[{"id":"x","n":12345678901234567890}],"reminder_stage_ids":["b","gone","a"]}`), "reminder_stage_ids", mapping)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(got, &doc); err != nil {
		t.Fatal(err)
	}
	if string(doc["reminder_stage_ids"]) != `["B","A"]` || string(doc["criteria"]) != `[{"id":"x","n":12345678901234567890}]` {
		t.Fatalf("remapped = %s", got)
	}
	// A retired-only list becomes an empty list, not null; a document without the key is unchanged.
	got, err = remapStageIDs([]byte(`{"auto_send_stage_ids":["gone"],"enabled":true}`), "auto_send_stage_ids", mapping)
	if err != nil || string(got) != `{"auto_send_stage_ids":[],"enabled":true}` {
		t.Fatalf("%s %v", got, err)
	}
	same := []byte(`{"enabled":true}`)
	if got, err = remapStageIDs(same, "auto_send_stage_ids", mapping); err != nil || string(got) != string(same) {
		t.Fatalf("%s %v", got, err)
	}
	for _, bad := range []string{`[]`, `{"reminder_stage_ids":"a"}`, `{`} {
		if _, err := remapStageIDs([]byte(bad), "reminder_stage_ids", mapping); err == nil {
			t.Errorf("%s: want an error", bad)
		}
	}
}
