package board

import (
	"errors"

	"github.com/google/uuid"
)

var ErrSubstateRequiresInProcess = errors.New("substate requires in_process")

// DecodeSubstate requires the nullable member explicitly. The injected strict
// decoder rejects duplicate keys, trailing JSON and invalid Unicode as for moves.
func DecodeSubstate(body []byte, decode JSONDecoder) (*string, error) {
	value, err := decode(body)
	if err != nil {
		return nil, ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 1 {
		return nil, ErrInvalidRequest
	}
	raw, ok := root["substate_id"]
	if !ok {
		return nil, ErrInvalidRequest
	}
	if raw == nil {
		return nil, nil
	}
	text, ok := raw.(string)
	if !ok {
		return nil, ErrInvalidRequest
	}
	id, err := uuid.Parse(text)
	if err != nil || id == uuid.Nil {
		return nil, ErrInvalidRequest
	}
	canonical := id.String()
	return &canonical, nil
}

func RequiresInProcess(p Pipeline, stageID string) error {
	for _, s := range p.Stages {
		if s.ID == stageID && s.Kind == "in_process" {
			return nil
		}
	}
	return ErrSubstateRequiresInProcess
}
