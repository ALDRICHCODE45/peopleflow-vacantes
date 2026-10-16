// Package pipelineconfig owns the cut-1 pipeline replacement rules. It performs
// no IO: defaults and normalization are independent of HTTP and persistence.
package pipelineconfig

import (
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

const (
	MaxCustomStages = 3
	NameMaxLength   = 40
	MaxBodyBytes    = draftinput.MaxBodyBytes
)

// Stage identity and kind survive rename and reorder.
type Stage struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// Configuration separates progression order from the one exit stage.
type Configuration struct {
	Stages []Stage `json:"stages"`
	Exit   Stage   `json:"exit"`
}

// Defaults uses the draft UUID as the UUIDv5 namespace and the semantic kind
// as its name. Reads need neither random identities nor a backfill.
func Defaults(draftID uuid.UUID) Configuration {
	kinds := []string{"new", "screening", "screening_ok", "in_process", "placement", "discarded"}
	names := []string{"Nuevos", "Screening", "Screening OK", "En proceso", "Placement", "Descartados"}
	stages := make([]Stage, len(kinds))
	for i, kind := range kinds {
		stages[i] = Stage{ID: uuid.NewSHA1(draftID, []byte(kind)).String(), Kind: kind, Name: names[i]}
	}
	return Configuration{Stages: stages[:5:5], Exit: stages[5]}
}

// Equal compares normalized identities, names, kinds and progression order.
func (c Configuration) Equal(other Configuration) bool {
	if c.Exit != other.Exit || len(c.Stages) != len(other.Stages) {
		return false
	}
	for i, stage := range c.Stages {
		if stage != other.Stages[i] {
			return false
		}
	}
	return true
}

// Replace strictly decodes the full write document, derives kinds only from
// current IDs, then validates the entire normalized result before returning it.
// A failure never returns a partial configuration or mutates current.
func Replace(current Configuration, body []byte) (Configuration, error) {
	if len(body) > MaxBodyBytes {
		return Configuration{}, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 2 {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	stages, ok := root["stages"].([]any)
	if !ok {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	exit, exists := root["exit"]
	if !exists {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	known := make(map[string]Stage, len(current.Stages)+1)
	for _, s := range append(append([]Stage{}, current.Stages...), current.Exit) {
		known[s.ID] = s
	}
	out := Configuration{Stages: make([]Stage, len(stages))}
	for i, raw := range stages {
		out.Stages[i], err = decodeStage(raw, known)
		if err != nil {
			return Configuration{}, err
		}
	}
	out.Exit, err = decodeStage(exit, known)
	if err != nil {
		return Configuration{}, err
	}
	if err := Validate(out); err != nil {
		return Configuration{}, err
	}
	return out, nil
}

func decodeStage(raw any, known map[string]Stage) (Stage, error) {
	object, ok := raw.(map[string]any)
	if !ok {
		return Stage{}, drafts.ErrInvalidRequest
	}
	for key := range object {
		if key != "id" && key != "name" {
			return Stage{}, drafts.ErrInvalidRequest
		}
	}
	name, ok := object["name"].(string)
	if !ok {
		return Stage{}, drafts.ErrInvalidRequest
	}
	// Reuse the requester value object without changing its code or tests.
	normalized, err := valueobjects.NewRequesterName(name)
	if err != nil || utf8.RuneCountInString(normalized.Value()) > NameMaxLength {
		return Stage{}, drafts.ErrValidation
	}
	if rawID, present := object["id"]; present {
		id, ok := rawID.(string)
		if !ok {
			return Stage{}, drafts.ErrInvalidRequest
		}
		parsed, err := uuid.Parse(id)
		if err != nil {
			return Stage{}, drafts.ErrValidation
		}
		stage, exists := known[parsed.String()]
		if !exists {
			return Stage{}, drafts.ErrValidation
		}
		stage.Name = normalized.Value()
		return stage, nil
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return Stage{}, err
	}
	return Stage{ID: id.String(), Kind: "custom", Name: normalized.Value()}, nil
}

// Validate also protects the persistence read boundary: stored configurations
// must have canonical names, unique IDs and the same complete built-in set.
func Validate(c Configuration) error {
	if len(c.Stages) < 5 || len(c.Stages) > 5+MaxCustomStages || c.Stages[0].Kind != "new" || c.Stages[len(c.Stages)-1].Kind != "placement" || c.Exit.Kind != "discarded" {
		return drafts.ErrValidation
	}
	ids, names, counts := map[string]bool{}, map[string]bool{}, map[string]int{}
	for i, stage := range append(append([]Stage{}, c.Stages...), c.Exit) {
		id, err := uuid.Parse(stage.ID)
		if err != nil || id == uuid.Nil || id.String() != stage.ID || ids[stage.ID] {
			return drafts.ErrValidation
		}
		ids[stage.ID] = true
		name, err := valueobjects.NewRequesterName(stage.Name)
		if err != nil || name.Value() != stage.Name || utf8.RuneCountInString(stage.Name) > NameMaxLength || names[name.Key()] {
			return drafts.ErrValidation
		}
		names[name.Key()] = true
		if stage.Kind == "discarded" && i < len(c.Stages) {
			return drafts.ErrValidation
		}
		switch stage.Kind {
		case "new", "screening", "screening_ok", "in_process", "placement", "discarded", "custom":
			counts[stage.Kind]++
		default:
			return drafts.ErrValidation
		}
	}
	for _, kind := range []string{"new", "screening", "screening_ok", "in_process", "placement", "discarded"} {
		if counts[kind] != 1 {
			return drafts.ErrValidation
		}
	}
	if counts["custom"] > MaxCustomStages {
		return drafts.ErrValidation
	}
	return nil
}
