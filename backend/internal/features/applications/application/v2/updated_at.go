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
	status, message, discarded := "submitted", "", false
	last := applied
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
		if (next != status || nextMessage != message) && e.At.After(last) {
			last = e.At
		}
		status, message = next, nextMessage
	}
	return last
}
