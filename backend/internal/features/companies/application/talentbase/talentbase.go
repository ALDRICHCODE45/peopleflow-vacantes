// Package talentbase holds the company talent base visibility setting: who, among
// the company members, may use the company-wide candidate pool.
// Contract: docs/contracts/talent-base-visibility-v1.md.
package talentbase

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// EventVisibilityChanged is the audit event co-written with every accepted PUT.
// The type itself lives in the audit_events catalog.
const EventVisibilityChanged = audit.EventTalentBaseVisibilityChanged

type Mode string

const (
	ModeAllRecruiters Mode = "all_recruiters"
	ModeSelectedUsers Mode = "selected_users"
)

type Viewer struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	AddedAt  time.Time `json:"added_at"`
}

type Editor struct {
	UserID   uuid.UUID `json:"user_id"`
	FullName string    `json:"full_name"`
}

// Document is the GET body. A company that never saved the setting reads as
// all_recruiters, version 1, with no editor.
type Document struct {
	Mode      Mode       `json:"mode"`
	Viewers   []Viewer   `json:"viewers"`
	Version   int64      `json:"version"`
	UpdatedAt *time.Time `json:"updated_at"`
	UpdatedBy *Editor    `json:"updated_by"`
}

// Replacement is a validated PUT body.
type Replacement struct {
	Mode    Mode
	UserIDs []uuid.UUID
}

type Store interface {
	Get(ctx context.Context, company uuid.UUID) (Document, error)
	// Replace applies the replacement when version is current. A stale version
	// returns the current document with ErrVersionConflict; a member rule
	// violation returns *RuleError; neither changes any state.
	Replace(ctx context.Context, company, actor uuid.UUID, version int64, r Replacement) (Document, error)
}

// Access answers whether a member may use the talent base right now.
type Access interface {
	CanView(ctx context.Context, company, user uuid.UUID, role string) (bool, error)
}

var (
	ErrInvalidRequest  = errors.New("invalid talent base visibility request")
	ErrVersionConflict = errors.New("talent base visibility version conflict")
)

// Field codes reported in validation_error and rule errors.
const (
	FieldRequired      = "required"
	FieldInvalid       = "invalid"
	FieldDuplicate     = "duplicate"
	FieldNotApplicable = "not_applicable"
	FieldNotMember     = "not_member"
	FieldIsOwner       = "is_owner"
)

type Field struct{ Field, Code string }

// InvalidFields is the 400 validation_error of the request shape.
type InvalidFields struct{ Fields []Field }

func (e *InvalidFields) Error() string { return "invalid talent base visibility fields" }

type Rule int

const (
	RuleUsersNotApplicable Rule = iota + 1
	RuleViewerNotMember
	RuleViewerIsOwner
)

// RuleError is one of the 422 rules; Field is the offending request field.
type RuleError struct {
	Rule  Rule
	Field string
}

func (e *RuleError) Error() string { return fmt.Sprintf("talent base rule %d on %s", e.Rule, e.Field) }

// UserIDField names the i-th element of user_ids.
func UserIDField(i int) string { return fmt.Sprintf("user_ids[%d]", i) }

type Service struct{ store Store }

func NewService(store Store) *Service { return &Service{store: store} }

func (s *Service) Get(ctx context.Context, company uuid.UUID) (Document, error) {
	return s.store.Get(ctx, company)
}

func (s *Service) Replace(ctx context.Context, company, actor uuid.UUID, version int64, body []byte) (Document, error) {
	r, err := Parse(body)
	if err != nil {
		return Document{}, err
	}
	return s.store.Replace(ctx, company, actor, version, r)
}

// Parse validates the PUT body shape and the mode/list consistency, in that
// order. Unknown or repeated keys are an invalid request, not a field error.
func Parse(body []byte) (Replacement, error) {
	raw, err := topLevelKeys(body)
	if err != nil {
		return Replacement{}, err
	}
	var out Replacement
	var fields []Field
	if value, ok := raw["mode"]; !ok {
		fields = append(fields, Field{"mode", FieldRequired})
	} else {
		var mode string
		if json.Unmarshal(value, &mode) != nil || (Mode(mode) != ModeAllRecruiters && Mode(mode) != ModeSelectedUsers) {
			fields = append(fields, Field{"mode", FieldInvalid})
		}
		out.Mode = Mode(mode)
	}
	ids, idFields := parseUserIDs(raw)
	out.UserIDs = ids
	fields = append(fields, idFields...)
	if len(fields) > 0 {
		return Replacement{}, &InvalidFields{Fields: fields}
	}
	if out.Mode == ModeAllRecruiters && len(out.UserIDs) > 0 {
		return Replacement{}, &RuleError{Rule: RuleUsersNotApplicable, Field: "user_ids"}
	}
	return out, nil
}

func parseUserIDs(raw map[string]json.RawMessage) ([]uuid.UUID, []Field) {
	value, ok := raw["user_ids"]
	if !ok {
		return nil, []Field{{"user_ids", FieldRequired}}
	}
	var items []any
	if json.Unmarshal(value, &items) != nil || items == nil {
		return nil, []Field{{"user_ids", FieldInvalid}}
	}
	ids := make([]uuid.UUID, 0, len(items))
	for _, item := range items {
		text, isText := item.(string)
		id, err := uuid.Parse(text)
		if !isText || err != nil {
			return nil, []Field{{"user_ids", FieldInvalid}}
		}
		ids = append(ids, id)
	}
	seen := make(map[uuid.UUID]bool, len(ids))
	var duplicates []Field
	for i, id := range ids {
		if seen[id] {
			duplicates = append(duplicates, Field{UserIDField(i), FieldDuplicate})
		}
		seen[id] = true
	}
	return ids, duplicates
}

// topLevelKeys reads a JSON object, rejecting repeated and unknown keys.
func topLevelKeys(body []byte) (map[string]json.RawMessage, error) {
	d := json.NewDecoder(bytes.NewReader(body))
	if token, err := d.Token(); err != nil || token != json.Delim('{') {
		return nil, ErrInvalidRequest
	}
	out := map[string]json.RawMessage{}
	for d.More() {
		token, err := d.Token()
		key, isKey := token.(string)
		if err != nil || !isKey || (key != "mode" && key != "user_ids") {
			return nil, ErrInvalidRequest
		}
		if _, repeated := out[key]; repeated {
			return nil, ErrInvalidRequest
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, ErrInvalidRequest
		}
		out[key] = value
	}
	if token, err := d.Token(); err != nil || token != json.Delim('}') {
		return nil, ErrInvalidRequest
	}
	if _, err := d.Token(); !errors.Is(err, io.EOF) {
		return nil, ErrInvalidRequest
	}
	return out, nil
}
