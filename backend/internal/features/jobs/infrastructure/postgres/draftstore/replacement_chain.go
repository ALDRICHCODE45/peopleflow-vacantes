package draftstore

import (
	"context"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Chain primitives of replacement processes (docs/contracts/replacement-processes-v1.md,
// «Data model» and «Rules»). They are read-only and take the caller's executor,
// so a writer that already holds the root process lock (§Concurrency) reads the
// chain inside its own transaction.

// chainProcess is one process of a logical vacancy; Sequence is 0 for the
// original, which has no vacancy_replacements row, and 1..n for replacements.
type chainProcess struct {
	ID            uuid.UUID
	Sequence      int32
	Status        string
	ProcessStatus string
}

// replacementChain is the logical vacancy: Root is the original process and
// Processes holds the root first, then the replacements by sequence.
type replacementChain struct {
	Root      uuid.UUID
	Processes []chainProcess
}

// latest is the process with the highest sequence: the only one that may start
// or reopen (D14). A chain always holds its root, so it is never empty.
func (c replacementChain) latest() chainProcess {
	var latest chainProcess
	for i, p := range c.Processes {
		if i == 0 || p.Sequence > latest.Sequence {
			latest = p
		}
	}
	return latest
}

// activeReplacement is the replacement still active (process_status = active);
// D15 keeps it unique. The original never counts: it is not a replacement.
func (c replacementChain) activeReplacement() (chainProcess, bool) {
	var found chainProcess
	var ok bool
	for _, p := range c.Processes {
		if p.Sequence >= 1 && p.ProcessStatus == "active" && (!ok || p.Sequence > found.Sequence) {
			found, ok = p, true
		}
	}
	return found, ok
}

// readReplacementChain resolves the root and the chain of the logical vacancy
// `process` belongs to; found is false when the process is not in the company.
func readReplacementChain(ctx context.Context, q db.DBTX, company, process uuid.UUID) (replacementChain, bool, error) {
	rows, err := db.New(q).ListReplacementChain(ctx, db.ListReplacementChainParams{CompanyID: company, ProcessID: process})
	if err != nil || len(rows) == 0 {
		return replacementChain{}, false, err
	}
	chain := replacementChain{Root: rows[0].RootProcessID, Processes: make([]chainProcess, len(rows))}
	for i, row := range rows {
		chain.Processes[i] = chainProcess{ID: row.ProcessID, Sequence: row.Sequence, Status: row.Status, ProcessStatus: row.ProcessStatus}
	}
	return chain, true, nil
}

// readReplacementSuccessor is the replacement started from `process`, if any (A7).
func readReplacementSuccessor(ctx context.Context, q db.DBTX, company, process uuid.UUID) (uuid.UUID, bool, error) {
	id, err := db.New(q).GetReplacementSuccessor(ctx, db.GetReplacementSuccessorParams{ProcessID: process, CompanyID: company})
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	return id, err == nil, err
}

// startableCredit is a fallen placement (did_not_hold) of the chain that no
// replacement has taken yet.
type startableCredit struct {
	ID              uuid.UUID
	ProcessID       uuid.UUID
	ParticipationID uuid.UUID
	HiredAt         time.Time
	ExitReason      *string
}

// readStartableCredits lists, oldest hire first, the credits a new replacement
// of the chain rooted at `root` may take (D2).
func readStartableCredits(ctx context.Context, q db.DBTX, company, root uuid.UUID) ([]startableCredit, error) {
	rows, err := db.New(q).ListStartableReplacementCredits(ctx, db.ListStartableReplacementCreditsParams{CompanyID: company, RootProcessID: root})
	if err != nil {
		return nil, err
	}
	credits := make([]startableCredit, len(rows))
	for i, row := range rows {
		credits[i] = startableCredit{ID: row.ID, ProcessID: row.ProcessID, ParticipationID: row.ParticipationID, HiredAt: row.HiredAt.Time.UTC()}
		if row.ExitReason.Valid {
			reason := row.ExitReason.String
			credits[i].ExitReason = &reason
		}
	}
	return credits, nil
}

// closedCovered is D6: closed AND the latest close event's reason is `filled`
// (a `filled` close was only accepted with live coverage ≥ headcount). It does
// not follow later coverage changes, and a reopened process is not closed.
func closedCovered(status, closeReason string) bool {
	return status == "closed" && closeReason == "filled"
}

// readClosedCovered reports the D6 predicate of `process`; found is false when
// the process is not in the company.
func readClosedCovered(ctx context.Context, q db.DBTX, company, process uuid.UUID) (covered, found bool, err error) {
	state, err := db.New(q).GetProcessCloseState(ctx, db.GetProcessCloseStateParams{ProcessID: process, CompanyID: company})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return closedCovered(state.Status, state.CloseReason), true, nil
}
