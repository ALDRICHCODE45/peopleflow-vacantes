package v2

import (
	"time"

	"github.com/google/uuid"
)

// VisibleEvent is one participation history entry, ordered by time.
// Message is the candidate-facing message of a discard event.
type VisibleEvent struct {
	Kind    string
	Stage   uuid.UUID
	Message *string
	At      time.Time
}

// LastVisibleChange returns when the candidate-visible status or closing
// message last changed. Internal moves that keep the visible status, substate
// changes and not-applicable marks never count, so no pipeline activity leaks.
// It never precedes applied.
func LastVisibleChange(applied time.Time, initial uuid.UUID, events []VisibleEvent) time.Time {
	last := applied
	visibleChanges(initial, events, func(_ string, at time.Time) {
		if at.After(last) {
			last = at
		}
	})
	return last
}

// FirstResponse returns the first candidate-visible change away from
// submitted (to in_process or closed), or nil while the application is still
// untouched. Later recoveries or moves back to new never reset it. It never
// precedes applied.
func FirstResponse(applied time.Time, initial uuid.UUID, events []VisibleEvent) *time.Time {
	var first *time.Time
	visibleChanges(initial, events, func(status string, at time.Time) {
		if first == nil && status != "submitted" {
			if at.Before(applied) {
				at = applied
			}
			first = &at
		}
	})
	return first
}

// visibleChanges replays events in order and reports each change of the
// candidate-visible status or closing message with the new status.
func visibleChanges(initial uuid.UUID, events []VisibleEvent, changed func(status string, at time.Time)) {
	status, message, discarded := "submitted", "", false
	for _, e := range events {
		stage := initial
		switch e.Kind {
		case "intake", "move", "recovery":
			stage = e.Stage
			if e.Kind == "recovery" {
				discarded = false
			}
		case "discard":
			discarded = true
		default:
			continue
		}
		next, nextMessage := CandidateStatus(stage, initial, discarded), ""
		if discarded {
			if e.Kind != "discard" {
				continue
			}
			if e.Message != nil {
				nextMessage = *e.Message
			}
		}
		if next != status || nextMessage != message {
			changed(next, e.At)
		}
		status, message = next, nextMessage
	}
}
