package v2

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLastVisibleChangeIgnoresInternalActivity(t *testing.T) {
	initial, review, interview := uuid.New(), uuid.New(), uuid.New()
	applied := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	at := func(h int) time.Time { return applied.Add(time.Duration(h) * time.Hour) }
	msg, other := "Thank you", "Another message"
	intake := VisibleEvent{Kind: "intake", Stage: initial, At: applied}
	for _, tc := range []struct {
		name   string
		events []VisibleEvent
		want   time.Time
	}{
		{"no events", nil, applied},
		{"intake only", []VisibleEvent{intake}, applied},
		{"submitted to in_process", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}}, at(1)},
		{"internal move keeps in_process", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}, {Kind: "move", Stage: interview, At: at(2)}}, at(1)},
		{"back to new is visible", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}, {Kind: "move", Stage: initial, At: at(3)}}, at(3)},
		{"substate and not_applicable ignored", []VisibleEvent{intake, {Kind: "substate", Stage: initial, At: at(1)}, {Kind: "not_applicable", Stage: review, At: at(2)}}, applied},
		{"discard without message", []VisibleEvent{intake, {Kind: "discard", Stage: uuid.New(), At: at(4)}}, at(4)},
		{"discard with message", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}, {Kind: "discard", Stage: uuid.New(), Message: &msg, At: at(4)}}, at(4)},
		{"move while discarded stays closed", []VisibleEvent{intake, {Kind: "discard", Stage: uuid.New(), Message: &msg, At: at(4)}, {Kind: "move", Stage: review, At: at(5)}}, at(4)},
		{"new closing message is visible", []VisibleEvent{intake, {Kind: "discard", Stage: uuid.New(), Message: &msg, At: at(4)}, {Kind: "discard", Stage: uuid.New(), Message: &other, At: at(5)}}, at(5)},
		{"recovery is visible", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}, {Kind: "discard", Stage: uuid.New(), Message: &msg, At: at(4)}, {Kind: "recovery", Stage: review, At: at(6)}}, at(6)},
		{"never before applied_at", []VisibleEvent{{Kind: "move", Stage: review, At: applied.Add(-time.Hour)}}, applied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := LastVisibleChange(applied, initial, tc.events); !got.Equal(tc.want) {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}

func TestFirstResponseIsTheFirstVisibleChangeAwayFromSubmitted(t *testing.T) {
	initial, review, interview := uuid.New(), uuid.New(), uuid.New()
	applied := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	at := func(h int) time.Time { return applied.Add(time.Duration(h) * time.Hour) }
	msg := "Thank you"
	intake := VisibleEvent{Kind: "intake", Stage: initial, At: applied}
	none := time.Time{}
	for _, tc := range []struct {
		name   string
		events []VisibleEvent
		want   time.Time
	}{
		{"no events", nil, none},
		{"untouched intake", []VisibleEvent{intake}, none},
		{"substate and not_applicable are no response", []VisibleEvent{intake, {Kind: "substate", Stage: initial, At: at(1)}, {Kind: "not_applicable", Stage: review, At: at(2)}}, none},
		{"move to in_process", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}, {Kind: "move", Stage: interview, At: at(2)}}, at(1)},
		{"discard from submitted", []VisibleEvent{intake, {Kind: "discard", Stage: uuid.New(), Message: &msg, At: at(3)}}, at(3)},
		{"back to new keeps it", []VisibleEvent{intake, {Kind: "move", Stage: review, At: at(1)}, {Kind: "move", Stage: initial, At: at(2)}}, at(1)},
		{"recovery keeps it", []VisibleEvent{intake, {Kind: "discard", Stage: uuid.New(), At: at(3)}, {Kind: "recovery", Stage: initial, At: at(4)}, {Kind: "move", Stage: review, At: at(5)}}, at(3)},
		{"never before applied_at", []VisibleEvent{{Kind: "move", Stage: review, At: applied.Add(-time.Hour)}}, applied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := FirstResponse(applied, initial, tc.events)
			if tc.want.IsZero() {
				if got != nil {
					t.Fatalf("got %s want nil", got)
				}
				return
			}
			if got == nil || !got.Equal(tc.want) {
				t.Fatalf("got %v want %s", got, tc.want)
			}
		})
	}
}
