package board

import (
	"bytes"
	"encoding/json"
	"io"

	"github.com/google/uuid"
)

// ManualFieldError is a public, non-PII field validation result.
type ManualFieldError struct {
	Field string
	Code  string
}

// ManualRequest retains field values until field validation, which runs after
// envelope validation and before process-state and stage-eligibility checks.
type ManualRequest struct {
	Stage             json.RawMessage
	Existing          json.RawMessage
	ConfirmedDistinct json.RawMessage
	Candidate         json.RawMessage
}

// ParseManualRequest enforces the four-key envelope without interpreting fields.
// In particular, a present but non-string stage is a field error, not a shape
// error. Duplicate keys are rejected rather than silently taking the last value.
func ParseManualRequest(body []byte) (ManualRequest, error) {
	var out ManualRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return out, ErrInvalidRequest
	}
	fields := map[string]*json.RawMessage{
		"stage_id":           &out.Stage,
		"existing":           &out.Existing,
		"confirmed_distinct": &out.ConfirmedDistinct,
		"candidate":          &out.Candidate,
	}
	seen := make(map[string]bool, len(fields))
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return ManualRequest{}, ErrInvalidRequest
		}
		key, ok := token.(string)
		target, allowed := fields[key]
		if !ok || !allowed || seen[key] {
			return ManualRequest{}, ErrInvalidRequest
		}
		seen[key] = true
		if decoder.Decode(target) != nil {
			return ManualRequest{}, ErrInvalidRequest
		}
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') || len(seen) != len(fields) {
		return ManualRequest{}, ErrInvalidRequest
	}
	if _, err = decoder.Token(); err != io.EOF {
		return ManualRequest{}, ErrInvalidRequest
	}
	return out, nil
}

// StageID validates only the supplied value. The client, never this server,
// chooses the first stage by default. Membership is checked after process state.
func (r ManualRequest) StageID() (uuid.UUID, *ManualFieldError) {
	if bytes.Equal(bytes.TrimSpace(r.Stage), []byte("null")) {
		return uuid.Nil, &ManualFieldError{Field: "stage_id", Code: "required"}
	}
	var value string
	if json.Unmarshal(r.Stage, &value) != nil || value == "" {
		return uuid.Nil, &ManualFieldError{Field: "stage_id", Code: "invalid"}
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, &ManualFieldError{Field: "stage_id", Code: "invalid"}
	}
	return id, nil
}

// ValidateManualStage checks the current pipeline only; retired, Placement and
// exit stages cannot be used for intake. Call only after process-state checks.
func ValidateManualStage(id string, pipeline Pipeline) *ManualFieldError {
	if id == pipeline.Exit.ID {
		return &ManualFieldError{Field: "stage_id", Code: "not_allowed"}
	}
	for _, stage := range pipeline.Stages {
		if stage.ID != id {
			continue
		}
		if stage.Kind == "placement" {
			return &ManualFieldError{Field: "stage_id", Code: "not_allowed"}
		}
		return nil
	}
	return &ManualFieldError{Field: "stage_id", Code: "invalid"}
}
