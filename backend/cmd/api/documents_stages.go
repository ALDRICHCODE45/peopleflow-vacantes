package main

import (
	"encoding/json"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// documentStages bridges jobs' pipeline vocabulary to the documents feature (which may not import it): stage id → {kind, name} of
// a vacancy's pipeline, from its stored configuration (the defaults when there is none), live, exit and retired stages alike, as
// the participation's stage is named in carry_candidates. It is documents.StageResolver.
func documentStages(draftID uuid.UUID, raw []byte) (map[string]documents.Stage, error) {
	config := pipelineconfig.Defaults(draftID)
	if len(raw) > 0 && string(raw) != "null" {
		var stored pipelineconfig.Configuration
		if err := json.Unmarshal(raw, &stored); err != nil {
			return nil, err
		}
		if err := pipelineconfig.Validate(stored); err != nil {
			return nil, err
		}
		config = stored
	}
	names := map[string]documents.Stage{config.Exit.ID: {Kind: config.Exit.Kind, Name: config.Exit.Name}}
	for _, stage := range config.Stages {
		names[stage.ID] = documents.Stage{Kind: stage.Kind, Name: stage.Name}
	}
	for _, stage := range config.Retired {
		names[stage.ID] = documents.Stage{Kind: stage.Kind, Name: stage.Name}
	}
	return names, nil
}
