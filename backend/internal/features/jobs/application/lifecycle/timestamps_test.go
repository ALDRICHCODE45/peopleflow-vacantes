package lifecycle

import (
	"testing"
	"time"
)

func TestReopenRetainsLatestHistoricalTimestampsAndReactivates(t *testing.T) {
	pub, process := "closed", "finished"
	original := "2026-10-10T01:00:00.000000Z"
	current := View{Publication: &pub, Process: &process, Version: "9007199254740993", PublishedAt: &original, PausedAt: &original, ClosedAt: &original, ProcessFinishedAt: &original}
	next, err := Transition(current, "reopen", "", time.Date(2026, 10, 16, 18, 0, 0, 0, time.UTC))
	if err != nil || next.Version != "9007199254740994" || *next.Publication != "published" || *next.Process != "active" || *next.PublishedAt != "2026-10-16T18:00:00.000000Z" || *next.PausedAt != original || *next.ClosedAt != original || *next.ProcessFinishedAt != original {
		t.Fatalf("%+v %v", next, err)
	}
	if *current.Publication != "closed" || *current.Process != "finished" || current.Version != "9007199254740993" || *current.PublishedAt != original {
		t.Fatal("transition mutated input")
	}
}
