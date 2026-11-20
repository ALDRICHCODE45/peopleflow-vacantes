package lifecycle

import "github.com/google/uuid"

// ReplacementFacts are the chain facts the replacement keys of a View derive
// from (docs/contracts/replacement-processes-v1.md, D6, D14, A1, A7). The store
// reads them; nothing here does IO.
type ReplacementFacts struct {
	ProcessID uuid.UUID
	RootID    uuid.UUID
	// Sequence is 0 for the original; SourceID is uuid.Nil for it.
	Sequence int32
	SourceID uuid.UUID
	// LatestID is the process with the highest sequence of the chain.
	LatestID uuid.UUID
	// ActiveID is the replacement with process_status = active, uuid.Nil when none.
	ActiveID uuid.UUID
	// SuccessorID is the replacement started from this process, uuid.Nil when none.
	SuccessorID uuid.UUID
	// Published is false for a draft without a process row.
	Published     bool
	HasProjection bool
	// ClosedCovered is D6: closed and the latest close reason is `filled`.
	ClosedCovered    bool
	StartableCredits int
}

// Start blockers, in the order they are checked.
const (
	BlockerSourceNotClosed   = "source_not_closed"
	BlockerNotLatest         = "not_latest"
	BlockerReplacementActive = "replacement_active"
	BlockerNoStartableCredit = "no_startable_credits"
)

// ApplyReplacement fills the replacement keys of v, which must already hold its
// publication/process axes and close reason, and recomputes AllowedActions.
func (v *View) ApplyReplacement(f ReplacementFacts) {
	nilable := func(id uuid.UUID) *string {
		if id == uuid.Nil {
			return nil
		}
		s := id.String()
		return &s
	}
	v.Kind = "original"
	v.Sequence = nil
	if f.Sequence >= 1 {
		v.Kind = "replacement"
		seq := int(f.Sequence)
		v.Sequence = &seq
	}
	v.ReplacementOf = nilable(f.SourceID)
	v.RootProcessID = f.RootID.String()
	v.Visibility = nil
	if f.Published {
		visibility := "private"
		if f.HasProjection {
			visibility = "public"
		}
		v.Visibility = &visibility
	}
	v.ClosedCovered = f.ClosedCovered
	v.StartableCreditsCount = f.StartableCredits
	v.ActiveReplacementID = nilable(f.ActiveID)
	v.otherActive = f.ActiveID != uuid.Nil && f.ActiveID != f.ProcessID
	v.successorID = ""
	if f.SuccessorID != uuid.Nil {
		v.successorID = f.SuccessorID.String()
	}

	closed := v.Publication != nil && *v.Publication == "closed"
	latest := f.ProcessID == f.LatestID
	blocker := ""
	switch {
	case !closed:
		blocker = BlockerSourceNotClosed
	case !latest && f.ActiveID != uuid.Nil:
		blocker = BlockerReplacementActive
	case !latest:
		blocker = BlockerNotLatest
	case v.otherActive:
		blocker = BlockerReplacementActive
	case f.StartableCredits == 0:
		blocker = BlockerNoStartableCredit
	}
	v.CanStartReplacement = blocker == ""
	v.StartReplacementBlocker = nil
	if blocker != "" {
		v.StartReplacementBlocker = &blocker
	}
	v.AllowedActions = AllowedActions(*v)
}

func (v View) reopenBlocked() bool {
	return v.ClosedCovered || v.otherActive || v.successorID != ""
}

// ReopenRequiresReplacement is the 409 of reopening a process that closed covered (D6).
type ReopenRequiresReplacement struct {
	Action    string `json:"action"`
	Lifecycle View   `json:"lifecycle"`
}

func (e *ReopenRequiresReplacement) Error() string { return "lifecycle: reopen requires replacement" }

// ReplacementAlreadyActive is the 409 for a chain whose replacement is still active (A1).
type ReplacementAlreadyActive struct {
	ProcessID     string `json:"process_id"`
	RootProcessID string `json:"root_process_id"`
	Lifecycle     View   `json:"lifecycle"`
}

func (e *ReplacementAlreadyActive) Error() string { return "lifecycle: replacement already active" }

// ReopenSuperseded is the 409 of reopening a process whose logical vacancy moved on (A7).
type ReopenSuperseded struct {
	SuccessorProcessID string `json:"successor_process_id"`
	RootProcessID      string `json:"root_process_id"`
	Lifecycle          View   `json:"lifecycle"`
}

func (e *ReopenSuperseded) Error() string { return "lifecycle: reopen superseded" }

// ReopenGuard names why a closed process cannot be reopened, in the contract's
// order: closed covered, another active replacement, a successor. It returns nil
// when no replacement rule applies (the generic invalid-transition check decides).
func (v View) ReopenGuard() error {
	if v.Publication == nil || *v.Publication != "closed" {
		return nil
	}
	switch {
	case v.ClosedCovered:
		return &ReopenRequiresReplacement{Action: "reopen", Lifecycle: v}
	case v.otherActive && v.ActiveReplacementID != nil:
		return &ReplacementAlreadyActive{ProcessID: *v.ActiveReplacementID, RootProcessID: v.RootProcessID, Lifecycle: v}
	case v.successorID != "":
		return &ReopenSuperseded{SuccessorProcessID: v.successorID, RootProcessID: v.RootProcessID, Lifecycle: v}
	}
	return nil
}
