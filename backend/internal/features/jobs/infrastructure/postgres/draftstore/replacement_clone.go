package draftstore

import (
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Cloning a process' configuration into a replacement (docs/contracts/replacement-processes-v1.md,
// «What is cloned and what is fresh», D11). Pure functions: the store reads the
// source rows and writes the results.

// stageMapEntry pairs a source stage with the same stage of the replacement.
type stageMapEntry struct {
	Kind          string `json:"kind"`
	SourceStageID string `json:"source_stage_id"`
	StageID       string `json:"stage_id"`
}

// clonePipeline gives the replacement the source's stages, kinds, names and order.
// Built-in stages must carry ids anchored to their own draft (decodeStoredPipeline
// rejects anything else), so they get new ids derived from newID; custom stages
// keep their ids, which are only unique per process. The retired list is dropped.
// The entries follow the progression order, then the exit stage.
func clonePipeline(source pipelineconfig.Configuration, newID uuid.UUID) (pipelineconfig.Configuration, []stageMapEntry) {
	defaults := pipelineconfig.Defaults(newID)
	builtin := map[string]string{defaults.Exit.Kind: defaults.Exit.ID}
	for _, stage := range defaults.Stages {
		builtin[stage.Kind] = stage.ID
	}
	var entries []stageMapEntry
	clone := func(stage pipelineconfig.Stage) pipelineconfig.Stage {
		next := stage
		if id, ok := builtin[stage.Kind]; ok {
			next.ID = id
		}
		entries = append(entries, stageMapEntry{Kind: stage.Kind, SourceStageID: stage.ID, StageID: next.ID})
		return next
	}
	out := pipelineconfig.Configuration{SchemaVersion: 2, Stages: make([]pipelineconfig.Stage, len(source.Stages)), Retired: []pipelineconfig.RetiredStage{}}
	for i, stage := range source.Stages {
		out.Stages[i] = clone(stage)
	}
	out.Exit = clone(source.Exit)
	return out, entries
}

// stageIDMap indexes a stage map by source stage id.
func stageIDMap(entries []stageMapEntry) map[string]string {
	out := make(map[string]string, len(entries))
	for _, e := range entries {
		out[e.SourceStageID] = e.StageID
	}
	return out
}

// remapStageIDs rewrites the stage-id list stored under `key` of a JSON document
// (checklist `reminder_stage_ids`, psychometric profile `auto_send_stage_ids`)
// through the stage map. An id with no counterpart (a retired stage) is dropped,
// as the reads' Visible views already hide it. Every other key is kept verbatim.
func remapStageIDs(document []byte, key string, mapping map[string]string) ([]byte, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(document, &root); err != nil {
		return nil, fmt.Errorf("decode stage list document: %w", err)
	}
	raw, ok := root[key]
	if !ok {
		return document, nil
	}
	var ids []string
	if err := json.Unmarshal(raw, &ids); err != nil {
		return nil, fmt.Errorf("decode %s: %w", key, err)
	}
	mapped := make([]string, 0, len(ids))
	for _, id := range ids {
		if next, ok := mapping[id]; ok {
			mapped = append(mapped, next)
		}
	}
	encoded, err := json.Marshal(mapped)
	if err != nil {
		return nil, err
	}
	root[key] = encoded
	return json.Marshal(root)
}
