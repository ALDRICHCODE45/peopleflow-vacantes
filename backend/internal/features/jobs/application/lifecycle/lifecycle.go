// Package lifecycle owns the two-axis vacancy state machine, independent of
// draft content/configuration versions and of the delivery fulfillment snapshot.
package lifecycle

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
)

type View struct {
	Publication       *string  `json:"publication"`
	Process           *string  `json:"process"`
	Version           string   `json:"version"`
	PublishedAt       *string  `json:"published_at"`
	PausedAt          *string  `json:"paused_at"`
	ClosedAt          *string  `json:"closed_at"`
	ProcessFinishedAt *string  `json:"process_finished_at"`
	AllowedActions    []string `json:"allowed_actions"`
	CloseReason       *string  `json:"close_reason"`
	CloseReasonNote   *string  `json:"close_reason_note"`
}

// CloseReasonNotCovered reports the same live coverage as the board.
type CloseReasonNotCovered struct {
	Covered  int64  `json:"covered"`
	Required *int64 `json:"required"`
}

func (e *CloseReasonNotCovered) Error() string { return "lifecycle: close reason not covered" }

type InvalidTransition struct {
	Action    string `json:"action"`
	Lifecycle View   `json:"lifecycle"`
}

func (e *InvalidTransition) Error() string { return "lifecycle: transition invalid" }

func AllowedActions(v View) []string {
	if v.Publication == nil {
		return []string{"publish"}
	}
	switch *v.Publication {
	case "published":
		return []string{"pause", "close"}
	case "paused":
		return []string{"resume", "close"}
	case "closed":
		if v.Process != nil && *v.Process == "active" {
			return []string{"finish_process", "reopen"}
		}
		return []string{"reopen"}
	default:
		return []string{}
	}
}

// Transition returns a fresh view. Timestamps retain the latest occurrence of
// each kind, even after its state has been left (including process_finished_at).
func Transition(current View, action, choice string, now time.Time) (View, error) {
	valid := false
	for _, allowed := range AllowedActions(current) {
		if action == allowed && action != "publish" {
			valid = true
		}
	}
	if !valid {
		return View{}, &InvalidTransition{Action: action, Lifecycle: current}
	}
	if action == "close" && choice != "continue" && choice != "finish" {
		return View{}, drafts.ErrInvalidRequest
	}
	version, err := strconv.ParseInt(current.Version, 10, 64)
	if err != nil || version < 1 || version == int64(1<<63-1) {
		return View{}, drafts.ErrVersionConflict
	}
	next := current
	pub, process := *current.Publication, *current.Process
	at := now.UTC().Format("2006-01-02T15:04:05.000000Z")
	switch action {
	case "pause":
		pub = "paused"
		next.PausedAt = &at
	case "resume", "reopen":
		pub = "published"
		process = "active"
		next.CloseReason = nil
		next.CloseReasonNote = nil
	case "close":
		pub = "closed"
		next.ClosedAt = &at
		if choice == "finish" {
			process = "finished"
			next.ProcessFinishedAt = &at
		}
	case "finish_process":
		process = "finished"
		next.ProcessFinishedAt = &at
	}
	next.Publication = &pub
	next.Process = &process
	next.Version = strconv.FormatInt(version+1, 10)
	next.AllowedActions = AllowedActions(next)
	return next, nil
}

func ETag(id uuid.UUID, version int64) string {
	return `"vl-` + id.String() + `-v` + strconv.FormatInt(version, 10) + `"`
}

// Reuse the strict draft tag grammar (single strong tag, canonical UUID and
// decimal). Version zero is reserved for never-published drafts.
func CheckPrecondition(id uuid.UUID, version int64, raw string, present bool) error {
	if !present {
		return drafts.ErrPreconditionRequired
	}
	raw = strings.Trim(raw, " \t")
	if raw == ETag(id, version) {
		return nil
	}
	if !strings.HasPrefix(raw, `"vl-`) {
		return drafts.ErrInvalidRequest
	}
	parseable := strings.Replace(raw, `"vl-`, `"jd-r1-`, 1)
	zero := strings.HasSuffix(parseable, `-v0"`)
	if zero {
		parseable = strings.TrimSuffix(parseable, `-v0"`) + `-v1"`
	}
	tag, err := draftversion.ParseIfMatch(parseable, true)
	if err != nil {
		return drafts.ErrInvalidRequest
	}
	if zero {
		tag.Version = 0
	}
	if tag.ID != id.String() || tag.Version != version {
		return drafts.ErrVersionConflict
	}
	return nil
}

type Actor struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Event struct {
	ID         string  `json:"id"`
	Action     string  `json:"action"`
	Process    *string `json:"process"`
	Actor      Actor   `json:"actor"`
	CreatedAt  string  `json:"created_at"`
	Reason     *string `json:"reason"`
	ReasonNote *string `json:"reason_note"`
}

// Store applies publish's live authorization gates before key/replay and
// preconditions. Mutation serializes on the shared draft lock with all writers.
type Store interface {
	GetLifecycle(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
	GetLifecycleHistory(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
	TransitionLifecycle(ctx context.Context, companyID, actorID, id uuid.UUID, action, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error)
}
