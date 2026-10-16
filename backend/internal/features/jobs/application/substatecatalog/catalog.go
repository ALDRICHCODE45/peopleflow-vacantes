// Package substatecatalog owns the cut-2 substate replacement rules without IO.
package substatecatalog

import (
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

const (
	MaxSubstates  = 50
	NameMaxLength = pipelineconfig.NameMaxLength
	MaxBodyBytes  = pipelineconfig.MaxBodyBytes
)

// Substate identity survives rename and display reordering.
type Substate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Catalog order is display order, never a sequence of candidate steps.
type Catalog struct {
	Substates []Substate `json:"substates"`
}

// Empty is the never-configured catalog. It encodes as an array, not null.
func Empty() Catalog { return Catalog{Substates: []Substate{}} }

// Suggestions are examples only. Return a fresh list so callers cannot mutate
// subsequent responses, and never filter it against the saved catalog.
func Suggestions() []string {
	return []string{"Primera entrevista", "Segunda entrevista", "Pruebas psicométricas", "Propuesta entregada"}
}

func (c Catalog) Equal(other Catalog) bool {
	if len(c.Substates) != len(other.Substates) {
		return false
	}
	for i, s := range c.Substates {
		if s != other.Substates[i] {
			return false
		}
	}
	return true
}

// Replace strictly decodes the full write document and validates its normalized
// result. Failures return no partial catalog and never mutate current.
func Replace(current Catalog, body []byte) (Catalog, error) {
	if len(body) > MaxBodyBytes {
		return Catalog{}, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return Catalog{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 1 {
		return Catalog{}, drafts.ErrInvalidRequest
	}
	entries, ok := root["substates"].([]any)
	if !ok {
		return Catalog{}, drafts.ErrInvalidRequest
	}
	known := make(map[string]Substate, len(current.Substates))
	for _, s := range current.Substates {
		known[s.ID] = s
	}
	out := Catalog{Substates: make([]Substate, len(entries))}
	for i, raw := range entries {
		out.Substates[i], err = decodeSubstate(raw, known)
		if err != nil {
			return Catalog{}, err
		}
	}
	if err := Validate(out); err != nil {
		return Catalog{}, err
	}
	return out, nil
}

func decodeSubstate(raw any, known map[string]Substate) (Substate, error) {
	object, ok := raw.(map[string]any)
	if !ok {
		return Substate{}, drafts.ErrInvalidRequest
	}
	for key := range object {
		if key != "id" && key != "name" {
			return Substate{}, drafts.ErrInvalidRequest
		}
	}
	name, ok := object["name"].(string)
	if !ok {
		return Substate{}, drafts.ErrInvalidRequest
	}
	normalized, err := valueobjects.NewRequesterName(name)
	if err != nil || utf8.RuneCountInString(normalized.Value()) > NameMaxLength {
		return Substate{}, drafts.ErrValidation
	}
	if rawID, present := object["id"]; present {
		id, ok := rawID.(string)
		if !ok {
			return Substate{}, drafts.ErrInvalidRequest
		}
		parsed, err := uuid.Parse(id)
		if err != nil {
			return Substate{}, drafts.ErrValidation
		}
		s, exists := known[parsed.String()]
		if !exists {
			return Substate{}, drafts.ErrValidation
		}
		s.Name = normalized.Value()
		return s, nil
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return Substate{}, err
	}
	return Substate{ID: id.String(), Name: normalized.Value()}, nil
}

// Validate also protects reads of stored catalogs: IDs and names are canonical,
// unique, and within limits. A stored catalog must encode an actual array.
func Validate(c Catalog) error {
	if c.Substates == nil || len(c.Substates) > MaxSubstates {
		return drafts.ErrValidation
	}
	ids, names := map[string]bool{}, map[string]bool{}
	for _, s := range c.Substates {
		id, err := uuid.Parse(s.ID)
		if err != nil || id == uuid.Nil || id.String() != s.ID || ids[s.ID] {
			return drafts.ErrValidation
		}
		ids[s.ID] = true
		name, err := valueobjects.NewRequesterName(s.Name)
		if err != nil || name.Value() != s.Name || utf8.RuneCountInString(s.Name) > NameMaxLength || names[name.Key()] {
			return drafts.ErrValidation
		}
		names[name.Key()] = true
	}
	return nil
}
