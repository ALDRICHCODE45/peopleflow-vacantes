package draftstore

import (
	"testing"

	"github.com/google/uuid"
)

func chainOf(items ...chainProcess) replacementChain {
	return replacementChain{Root: items[0].ID, Processes: items}
}

func TestReplacementChainLatestAndActiveReplacement(t *testing.T) {
	root, first, second := uuid.New(), uuid.New(), uuid.New()
	original := chainProcess{ID: root, Sequence: 0, Status: "closed", ProcessStatus: "active"}
	for _, tc := range []struct {
		name      string
		chain     replacementChain
		latest    uuid.UUID
		active    uuid.UUID
		hasActive bool
	}{
		{"only the original, still active: no replacement is active", chainOf(original), root, uuid.Nil, false},
		{"finished original and an active replacement",
			chainOf(chainProcess{ID: root, Status: "closed", ProcessStatus: "finished"}, chainProcess{ID: first, Sequence: 1, Status: "published", ProcessStatus: "active"}),
			first, first, true},
		{"every replacement finished",
			chainOf(chainProcess{ID: root, Status: "closed", ProcessStatus: "finished"}, chainProcess{ID: first, Sequence: 1, Status: "closed", ProcessStatus: "finished"}, chainProcess{ID: second, Sequence: 2, Status: "closed", ProcessStatus: "finished"}),
			second, uuid.Nil, false},
		{"latest is decided by sequence, not by slice order",
			replacementChain{Root: root, Processes: []chainProcess{{ID: second, Sequence: 2, Status: "published", ProcessStatus: "active"}, original, {ID: first, Sequence: 1, Status: "closed", ProcessStatus: "finished"}}},
			second, second, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.chain.latest().ID; got != tc.latest {
				t.Fatalf("latest=%s want %s", got, tc.latest)
			}
			active, ok := tc.chain.activeReplacement()
			if ok != tc.hasActive || active.ID != tc.active {
				t.Fatalf("active=%s,%v want %s,%v", active.ID, ok, tc.active, tc.hasActive)
			}
		})
	}
}

func TestClosedCoveredNeedsClosedAndFilledReason(t *testing.T) {
	for _, tc := range []struct {
		status, reason string
		want           bool
	}{
		{"closed", "filled", true},
		{"closed", "cancelled", false},
		{"closed", "other", false},
		{"closed", "", false},
		{"published", "filled", false}, // a reopened process keeps its old close events
		{"paused", "filled", false},
		{"published", "", false},
	} {
		if got := closedCovered(tc.status, tc.reason); got != tc.want {
			t.Errorf("closedCovered(%q,%q)=%v want %v", tc.status, tc.reason, got, tc.want)
		}
	}
}

func TestReplacementChainSuccessorFollowsTheSourceLink(t *testing.T) {
	root, first, second, third := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	chain := chainOf(
		chainProcess{ID: root},
		chainProcess{ID: first, Sequence: 1, Source: root},
		chainProcess{ID: second, Sequence: 2, Source: first},
		chainProcess{ID: third, Sequence: 3, Source: root}, // two replacements started from the root: the later one wins
	)
	for process, want := range map[uuid.UUID]uuid.UUID{root: third, first: second, second: uuid.Nil, third: uuid.Nil} {
		if got := chain.successor(process); got != want {
			t.Errorf("successor(%s) = %s, want %s", process, got, want)
		}
	}
	if got := chainOf(chainProcess{ID: root}).successor(root); got != uuid.Nil {
		t.Fatalf("a lone original has no successor: %s", got)
	}
}
