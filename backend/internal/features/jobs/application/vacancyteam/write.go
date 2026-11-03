package vacancyteam

import (
	"context"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/google/uuid"
	"strings"
	"time"
	"unicode/utf8"
)

type RuleError string

func (e RuleError) Error() string { return string(e) }

const (
	ErrForbidden                RuleError = "team_action_forbidden"
	ErrVersionConflict          RuleError = "team_version_conflict"
	ErrNotCompanyMember         RuleError = "not_company_member"
	ErrAlreadyActive            RuleError = "team_member_already_active"
	ErrMemberNotFound           RuleError = "team_member_not_found"
	ErrLastMember               RuleError = "team_last_member"
	ErrResponsibleCannotLeave   RuleError = "responsible_cannot_leave"
	ErrUseReassign              RuleError = "use_reassign_responsible"
	ErrTargetResponsible        RuleError = "reassign_target_is_responsible"
	ErrNoteRequired             RuleError = "reassignment_note_required"
	ErrModeMismatch             RuleError = "team_mode_mismatch"
	ErrResponsibleNotOnTeam     RuleError = "responsible_not_on_team"
	ErrModeUnchanged            RuleError = "team_mode_unchanged"
	ErrDeadlineNotApplicable    RuleError = "recruiter_deadline_not_applicable"
	ErrResponsibleNotApplicable RuleError = "responsible_not_applicable"
)
const (
	Add      = "add"
	Remove   = "remove"
	Leave    = "leave"
	Deadline = "deadline"
	Reassign = "reassign"
	Mode     = "mode"
)

type Write struct {
	Action       string
	Target       uuid.UUID
	Key          string
	KeyPresent   bool
	IfMatch      string
	MatchPresent bool
	Body         []byte
}
type WriteStore interface {
	WriteTeam(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, Write) (drafts.Result, error)
}
type Input struct {
	UserID   uuid.UUID `json:"user_id"`
	Deadline *string   `json:"recruiter_deadline"`
	Reason   string    `json:"reason"`
	Note     *string   `json:"note"`
	Previous string    `json:"previous_responsible"`
	Mode     string    `json:"mode"`
}

func DecodeWrite(action string, body []byte) (Input, error) {
	var out Input
	if len(body) > draftinput.MaxBodyBytes {
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
	allowed := map[string]bool{}
	switch action {
	case Add:
		allowed["user_id"] = true
		allowed["recruiter_deadline"] = true
	case Remove, Leave:
	case Deadline:
		allowed["recruiter_deadline"] = true
	case Reassign:
		for _, k := range []string{"to_user_id", "reason", "note", "previous_responsible", "recruiter_deadline"} {
			allowed[k] = true
		}
	case Mode:
		allowed["mode"] = true
		allowed["responsible_user_id"] = true
	default:
		return out, drafts.ErrInvalidRequest
	}
	for k := range root {
		if !allowed[k] {
			return out, drafts.ErrInvalidRequest
		}
	}
	if action == Mode {
		mode, _ := root["mode"].(string)
		if _, present := root["responsible_user_id"]; mode == "shared" && present {
			return out, ErrResponsibleNotApplicable
		}
	}
	key := ""
	if action == Add {
		key = "user_id"
	}
	if action == Reassign {
		key = "to_user_id"
	}
	if action == Mode {
		key = "responsible_user_id"
	}
	if key != "" {
		if raw, present := root[key]; present {
			s, ok := raw.(string)
			if !ok {
				return out, drafts.ErrInvalidRequest
			}
			out.UserID, err = uuid.Parse(s)
			if err != nil || out.UserID == uuid.Nil {
				return out, drafts.ErrInvalidRequest
			}
		} else if action != Mode {
			return out, drafts.ErrInvalidRequest
		}
	}
	if raw, present := root["recruiter_deadline"]; present {
		if raw != nil {
			s, ok := raw.(string)
			if !ok {
				return out, drafts.ErrInvalidRequest
			}
			date, err := time.Parse(time.DateOnly, s)
			if err != nil || date.Format(time.DateOnly) != s {
				return out, drafts.ErrInvalidRequest
			}
			out.Deadline = &s
		}
	} else if action == Deadline {
		return out, drafts.ErrInvalidRequest
	}
	if action == Mode {
		out.Mode, ok = root["mode"].(string)
		if !ok || out.Mode != "shared" && out.Mode != "with_responsible" {
			return out, drafts.ErrInvalidRequest
		}
	}
	if action == Reassign {
		out.Reason, ok = root["reason"].(string)
		if !ok {
			return out, drafts.ErrInvalidRequest
		}
		switch out.Reason {
		case "workload", "recruiter_departure", "performance", "client_request", "other":
		default:
			return out, drafts.ErrInvalidRequest
		}
		out.Previous = "remove"
		if raw, present := root["previous_responsible"]; present {
			out.Previous, ok = raw.(string)
			if !ok || out.Previous != "remove" && out.Previous != "keep_as_collaborator" {
				return out, drafts.ErrInvalidRequest
			}
		}
		if raw, present := root["note"]; present && raw != nil {
			s, ok := raw.(string)
			if !ok {
				return out, drafts.ErrInvalidRequest
			}
			s = strings.TrimSpace(s)
			out.Note = &s
		}
		invalid := out.Note != nil && (utf8.RuneCountInString(*out.Note) < 1 || utf8.RuneCountInString(*out.Note) > 500)
		if out.Reason == "other" && (out.Note == nil || invalid) {
			return out, ErrNoteRequired
		}
		if invalid {
			return out, drafts.ErrInvalidRequest
		}
	}
	return out, nil
}

type TramoSnapshot struct {
	StartedAt           time.Time `json:"started_at"`
	EffectiveDeadline   *string   `json:"effective_deadline"`
	DeadlineSource      string    `json:"deadline_source"`
	BusinessDaysElapsed int       `json:"business_days_elapsed"`
	BusinessDaysTotal   *int      `json:"business_days_total"`
}

func SnapshotTramo(start, at time.Time, recruiter, commitment *string, zone *time.Location) TramoSnapshot {
	out := TramoSnapshot{StartedAt: start.UTC(), DeadlineSource: "none"}
	out.EffectiveDeadline = commitment
	if commitment != nil {
		out.DeadlineSource = "commitment"
	}
	if recruiter != nil {
		out.EffectiveDeadline = recruiter
		out.DeadlineSource = "recruiter"
	}
	out.BusinessDaysElapsed = fulfillment.Remaining(start, at.In(zone).Format(time.DateOnly), zone)
	if out.BusinessDaysElapsed < 0 {
		out.BusinessDaysElapsed = 0
	}
	if out.EffectiveDeadline != nil {
		n := fulfillment.Remaining(start, *out.EffectiveDeadline, zone)
		if n < 0 {
			n = 0
		}
		out.BusinessDaysTotal = &n
	}
	return out
}
