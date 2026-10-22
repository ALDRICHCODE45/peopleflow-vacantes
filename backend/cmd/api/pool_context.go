package main

import (
	"encoding/json"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// poolStageNames bridges jobs' current pipeline projection, without the board's
// owner-or-principal authorization. The list's SQL already scopes every row.
func poolStageNames(id uuid.UUID, raw json.RawMessage) (map[string]string, error) {
	config := pipelineconfig.Defaults(id)
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &config); err != nil {
			return nil, err
		}
		if err := pipelineconfig.Validate(config); err != nil {
			return nil, err
		}
	}
	names := map[string]string{config.Exit.ID: config.Exit.Name}
	for _, stage := range config.Stages {
		names[stage.ID] = stage.Name
	}
	for _, stage := range config.Retired {
		names[stage.ID] = stage.Name
	}
	return names, nil
}
