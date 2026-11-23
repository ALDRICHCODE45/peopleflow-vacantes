package main

import (
	"encoding/json"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// documentStages names the stages of a vacancy's pipeline by kind and name for participations[].stage of the document overview:
// the stored configuration when there is one, the defaults otherwise; live, exit and retired stages alike.
func TestDocumentStagesNamesDefaultsExitAndRetiredStages(t *testing.T) {
	draft := uuid.New()
	defaults := pipelineconfig.Defaults(draft)

	names, err := documentStages(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 6 {
		t.Fatalf("default pipeline: %v", names)
	}
	for _, stage := range append(append([]pipelineconfig.Stage{}, defaults.Stages...), defaults.Exit) {
		if got := names[stage.ID]; got != (documents.Stage{Kind: stage.Kind, Name: stage.Name}) {
			t.Errorf("stage %s: %+v", stage.Kind, got)
		}
	}
	if got := names[defaults.Exit.ID]; got != (documents.Stage{Kind: "discarded", Name: "Descartados"}) {
		t.Errorf("exit: %+v", got)
	}
	// a stored `null` is the default too
	if again, err := documentStages(draft, json.RawMessage("null")); err != nil || len(again) != 6 {
		t.Fatalf("null configuration: %v %v", again, err)
	}
}

func TestDocumentStagesReadsTheStoredConfigurationAndRejectsAnInvalidOne(t *testing.T) {
	draft := uuid.New()
	config := pipelineconfig.Defaults(draft)
	custom := uuid.NewString()
	// a custom stage between screening_ok and in_process, and a retired one
	config.Stages = append(config.Stages[:3:3], append([]pipelineconfig.Stage{{ID: custom, Kind: "custom", Name: "Entrevista técnica"}}, config.Stages[3:]...)...)
	retired := uuid.NewString()
	config.Retired = []pipelineconfig.RetiredStage{{Stage: pipelineconfig.Stage{ID: retired, Kind: "custom", Name: "Prueba vieja"}, Position: 2}}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	names, err := documentStages(draft, raw)
	if err != nil {
		t.Fatal(err)
	}
	if names[custom] != (documents.Stage{Kind: "custom", Name: "Entrevista técnica"}) || names[retired] != (documents.Stage{Kind: "custom", Name: "Prueba vieja"}) {
		t.Fatalf("custom and retired: %v", names)
	}
	if _, err := documentStages(draft, []byte(`{"stages":[]}`)); err == nil {
		t.Fatal("an invalid stored pipeline must fail the read")
	}
	if _, err := documentStages(draft, []byte(`not json`)); err == nil {
		t.Fatal("an undecodable pipeline must fail the read")
	}
}
