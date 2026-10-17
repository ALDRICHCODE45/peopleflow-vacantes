package board

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrAlreadyDiscarded = errors.New("participation already discarded")
	ErrNotDiscarded     = errors.New("participation not discarded")
	ErrPlacementReentry = errors.New("placement reentry confirmation required")
)

type Reason struct {
	Group string `json:"group"`
	Key   string `json:"key"`
}
type Discard struct {
	Reason          Reason    `json:"reason"`
	DiscardedAt     time.Time `json:"discarded_at"`
	PreviousStageID string    `json:"previous_stage_id"`
}
type DiscardRequest struct {
	Reason               Reason
	Comment              *string
	CandidateMessage     *string
	ConfirmPlacementExit bool
}
type RecoverRequest struct{ ConfirmPlacementReentry bool }

// MarshalJSON keeps intake/move keys unchanged; recovery uses that same shape.
// Only discard events carry the retained private text and reason.
func (e Entry) MarshalJSON() ([]byte, error) {
	type wire Entry
	if e.Kind != "discard" {
		return json.Marshal(wire(e))
	}
	return json.Marshal(struct {
		wire
		Reason           *Reason `json:"reason"`
		Comment          *string `json:"comment"`
		CandidateMessage *string `json:"candidate_message"`
	}{wire(e), e.Reason, e.Comment, e.CandidateMessage})
}

func ValidReason(r Reason) bool {
	switch r.Group {
	case "recruiter":
		switch r.Key {
		case "requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "other":
			return true
		}
	case "candidate":
		switch r.Key {
		case "accepted_other_offer", "no_longer_interested", "unresponsive", "other":
			return true
		}
	}
	return false
}

func optionalText(root map[string]any, key string, limit int) (*string, error) {
	value, present := root[key]
	if !present {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, ErrInvalidRequest
	}
	text = strings.TrimFunc(text, unicode.IsSpace)
	length := utf8.RuneCountInString(text)
	if !utf8.ValidString(text) || length < 1 || length > limit {
		return nil, ErrValidation
	}
	for _, r := range text {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return nil, ErrValidation
		}
	}
	return &text, nil
}

func DecodeDiscard(body []byte, decode JSONDecoder) (DiscardRequest, error) {
	value, err := decode(body)
	if err != nil {
		return DiscardRequest{}, ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return DiscardRequest{}, ErrInvalidRequest
	}
	for k := range root {
		switch k {
		case "reason", "comment", "candidate_message", "confirm_placement_exit":
		default:
			return DiscardRequest{}, ErrInvalidRequest
		}
	}
	reason, ok := root["reason"].(map[string]any)
	if !ok || len(reason) != 2 {
		return DiscardRequest{}, ErrInvalidRequest
	}
	g, ok := reason["group"].(string)
	if !ok {
		return DiscardRequest{}, ErrInvalidRequest
	}
	key, ok := reason["key"].(string)
	if !ok {
		return DiscardRequest{}, ErrInvalidRequest
	}
	req := DiscardRequest{Reason: Reason{Group: g, Key: key}}
	if flag, present := root["confirm_placement_exit"]; present {
		req.ConfirmPlacementExit, ok = flag.(bool)
		if !ok {
			return DiscardRequest{}, ErrInvalidRequest
		}
	}
	if req.Comment, err = optionalText(root, "comment", 1000); err != nil {
		return DiscardRequest{}, err
	}
	if req.CandidateMessage, err = optionalText(root, "candidate_message", 500); err != nil {
		return DiscardRequest{}, err
	}
	if !ValidReason(req.Reason) || (key == "other" && req.Comment == nil) {
		return DiscardRequest{}, ErrValidation
	}
	return req, nil
}

func DecodeRecover(body []byte, decode JSONDecoder) (RecoverRequest, error) {
	value, err := decode(body)
	if err != nil {
		return RecoverRequest{}, ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return RecoverRequest{}, ErrInvalidRequest
	}
	for k := range root {
		if k != "confirm_placement_reentry" {
			return RecoverRequest{}, ErrInvalidRequest
		}
	}
	req := RecoverRequest{}
	if flag, present := root["confirm_placement_reentry"]; present {
		req.ConfirmPlacementReentry, ok = flag.(bool)
		if !ok {
			return RecoverRequest{}, ErrInvalidRequest
		}
	}
	return req, nil
}
