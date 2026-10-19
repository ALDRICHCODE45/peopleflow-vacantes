package board

import (
	"testing"
	"time"
)

func TestSubstateImplicitClearReservesAnOrderedInstant(t *testing.T) {
	previous := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	at := nextEventAt(previous)
	if !at.Equal(previous.Add(2*time.Microsecond)) || !at.Add(-time.Microsecond).After(previous) {
		t.Fatal("clear must follow previous history and precede move/discard", previous, at)
	}
}
