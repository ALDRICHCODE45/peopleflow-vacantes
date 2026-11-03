package deliveryconfig

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

var (
	ErrCommitmentChangeRequiresRenegotiation = errors.New("commitment change requires renegotiation")
	ErrCommitmentUnchanged                   = errors.New("commitment unchanged")
	ErrCommitmentNoteRequired                = errors.New("commitment note required")
	ErrDeliveryNotConfigured                 = errors.New("delivery not configured")
)

type Commitment struct {
	Date   string  `json:"commitment_date"`
	Reason string  `json:"reason"`
	Note   *string `json:"note,omitempty"`
}

type CommitmentStore interface {
	RenegotiateCommitment(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, string, bool, []byte) (drafts.Result, error)
}

// DecodeCommitment uses the same strict JSON intake as delivery writes.
func DecodeCommitment(body []byte) (Commitment, error) {
	var out Commitment
	if len(body) > MaxBodyBytes {
		return out, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return out, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return out, drafts.ErrInvalidRequest
	}
	for key := range root {
		if key != "commitment_date" && key != "reason" && key != "note" {
			return out, drafts.ErrInvalidRequest
		}
	}
	out.Date, ok = root["commitment_date"].(string)
	if !ok {
		return out, drafts.ErrInvalidRequest
	}
	date, err := time.Parse(time.DateOnly, out.Date)
	if err != nil || date.Format(time.DateOnly) != out.Date {
		return out, drafts.ErrInvalidRequest
	}
	out.Reason, ok = root["reason"].(string)
	if !ok {
		return out, drafts.ErrInvalidRequest
	}
	switch out.Reason {
	case "client_request", "scope_change", "internal_delay", "other":
	default:
		return out, drafts.ErrInvalidRequest
	}
	if raw, present := root["note"]; present {
		text, ok := raw.(string)
		if !ok {
			return out, drafts.ErrInvalidRequest
		}
		text = strings.TrimSpace(text)
		out.Note = &text
	}
	if out.Note != nil && (utf8.RuneCountInString(*out.Note) < 1 || utf8.RuneCountInString(*out.Note) > 500) || out.Reason == "other" && out.Note == nil {
		if out.Reason == "other" {
			return out, ErrCommitmentNoteRequired
		}
		return out, drafts.ErrInvalidRequest
	}
	return out, nil
}
