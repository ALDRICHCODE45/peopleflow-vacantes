//go:build integration

package draftstore

import (
	"context"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/google/uuid"
)

// The replacement keys of the lifecycle view over seeded chains: the store-level
// counterpart of the cmd/api flow tests.
func TestReadLifecycleReplacementKeys(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	f := newChainFixture(t, pool)
	root := f.process("closed", "finished")
	f.lifecycle(root, "close", "filled")
	first := f.replacement(root, root, 1, "closed", "active")
	f.lifecycle(first, "close", "cancelled")
	fallen := f.credit(root, "did_not_hold", time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	f.credit(root, "voided", time.Date(2026, 10, 2, 12, 0, 0, 0, time.UTC))
	foreign := newChainFixture(t, pool)
	foreign.credit(foreign.process("closed", "finished"), "did_not_hold", time.Now())

	read := func(id uuid.UUID) lifecycle.View {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()
		view, _, err := readLifecycle(ctx, tx, id)
		if err != nil {
			t.Fatal(err)
		}
		return view
	}
	str := func(p *string) string {
		if p == nil {
			return "<nil>"
		}
		return *p
	}

	original := read(root)
	if original.Kind != "original" || original.Sequence != nil || original.ReplacementOf != nil || original.RootProcessID != root.String() ||
		!original.ClosedCovered || original.CanStartReplacement || str(original.StartReplacementBlocker) != lifecycle.BlockerReplacementActive ||
		original.StartableCreditsCount != 1 || str(original.ActiveReplacementID) != first.String() || len(original.AllowedActions) != 0 {
		t.Fatalf("original = %+v", original)
	}
	// No projection row in this fixture: only the replacement is private, an original
	// with a process row is public (F1).
	if original.Visibility == nil || *original.Visibility != "public" {
		t.Fatalf("visibility = %s", str(original.Visibility))
	}
	replacement := read(first)
	if replacement.Visibility == nil || *replacement.Visibility != "private" {
		t.Fatalf("replacement visibility = %s", str(replacement.Visibility))
	}
	if replacement.Kind != "replacement" || replacement.Sequence == nil || *replacement.Sequence != 1 || str(replacement.ReplacementOf) != root.String() ||
		replacement.RootProcessID != root.String() || replacement.ClosedCovered || !replacement.CanStartReplacement || replacement.StartReplacementBlocker != nil ||
		replacement.StartableCreditsCount != 1 || str(replacement.ActiveReplacementID) != first.String() {
		t.Fatalf("replacement = %+v", replacement)
	}
	if got := replacement.AllowedActions; len(got) != 2 || got[0] != "finish_process" || got[1] != "reopen" {
		t.Fatalf("closed-active replacement actions = %v", got)
	}
	if guard := replacement.ReopenGuard(); guard != nil {
		t.Fatalf("the latest, closed not covered, reopens: %v", guard)
	}
	if guard := original.ReopenGuard(); guard == nil {
		t.Fatal("the covered original must not reopen")
	}

	// Once a replacement took the credit, nothing is startable; the count is per chain, not per company.
	f.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, first, fallen)
	if got := read(first); got.StartableCreditsCount != 0 || got.CanStartReplacement || str(got.StartReplacementBlocker) != lifecycle.BlockerNoStartableCredit {
		t.Fatalf("after the credit was taken: %+v", got)
	}

	// A draft without a process row is an original rooted at itself, never published.
	draft := uuid.New()
	f.exec(`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, draft, f.company, f.actor)
	if got := read(draft); got.Kind != "original" || got.RootProcessID != draft.String() || got.Visibility != nil || got.Publication != nil ||
		got.CanStartReplacement || str(got.StartReplacementBlocker) != lifecycle.BlockerSourceNotClosed || str(got.ActiveReplacementID) != "<nil>" {
		t.Fatalf("never published = %+v", got)
	}
}
