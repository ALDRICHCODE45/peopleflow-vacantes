//go:build integration

package v2

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestDiscardMoveRecoveryConcurrentOneWinner(t *testing.T) {
	for _, winner := range []string{"discard", "move", "recover"} {
		t.Run(winner+" first", func(t *testing.T) {
			m := setupMovement(t)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			item := m.item
			if winner == "recover" {
				out, err := m.discard(t, item, discardBody)
				if err != nil {
					t.Fatal(err)
				}
				item = out.Item
			}
			history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, item.ID)
			if err != nil {
				t.Fatal(err)
			}
			var auditsBefore int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, item.ID).Scan(&auditsBefore); err != nil {
				t.Fatal(err)
			}
			blocker, err := m.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(context.Background())
			var blockerPID int
			if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, m.vacancy).Scan(&blockerPID); err != nil {
				t.Fatal(err)
			}
			order := []string{winner}
			for _, op := range []string{"discard", "move", "recover"} {
				if op != winner {
					order = append(order, op)
				}
			}
			type result struct {
				op  string
				out board.Moved
				err error
			}
			done := make(chan result, 3)
			previousPID := blockerPID
			for _, op := range order {
				pool, pid := operationPool(t, ctx, m.pool)
				a := audit.NewAuditEventRepository()
				store := boardstore.NewStore(pool, a, movementContext{m.drafts}, m.storage, draftjson.Decode)
				go func(op string, store *boardstore.Store) {
					var out board.Moved
					var err error
					switch op {
					case "discard":
						out, err = store.Discard(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(discardBody))
					case "move":
						out, err = store.Move(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{"to_stage_id":"`+pipelineconfig.Defaults(m.vacancy).Stages[1].ID+`"}`))
					case "recover":
						out, err = store.Recover(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{}`))
					}
					done <- result{op, out, err}
				}(op, store)
				waitBlockedBy(t, ctx, m.pool, pid, previousPID)
				previousPID = pid
			}
			if err = blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var winning board.Item
			for i := 0; i < 3; i++ {
				select {
				case r := <-done:
					if r.op == winner {
						if r.err != nil {
							t.Fatal(r.op, r.err)
						}
						winning = r.out.Item
					} else if !errors.Is(r.err, board.ErrVersionConflict) {
						t.Fatal("loser must see stale precondition, not a state/body error", r.op, r.err)
					}
				case <-ctx.Done():
					t.Fatal("possible deadlock: concurrent operations timed out")
				}
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || len(view.Participations) != 1 || view.Participations[0].Version != incrementVersion(t, item.Version) || !reflect.DeepEqual(view.Participations[0], winning) || view.Coverage.Covered != 0 || view.Coverage.FullCoverageReachedAt != nil {
				t.Fatal(view, err)
			}
			wantStage := pipelineconfig.Defaults(m.vacancy).Stages[0].ID
			if winner == "move" {
				wantStage = pipelineconfig.Defaults(m.vacancy).Stages[1].ID
			}
			if winner == "discard" {
				wantStage = pipelineconfig.Defaults(m.vacancy).Exit.ID
			}
			if winning.StageID != wantStage || (winning.Discard != nil) != (winner == "discard") || (view.Exit.Count == 1) != (winner == "discard") {
				t.Fatal("incoherent winner", winning, view)
			}
			h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, item.ID)
			if err != nil || len(h.Items) != len(history.Items)+1 {
				t.Fatal(h, err)
			}
			wantKind := winner
			if winner == "recover" {
				wantKind = "recovery"
			}
			if h.Items[len(h.Items)-1].Kind != wantKind {
				t.Fatal(h)
			}
			var audits, milestones int
			if err = m.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM audit_events WHERE entity_id=$1),(SELECT count(*) FROM process_coverage_milestones WHERE process_id=$2)`, item.ID, m.vacancy).Scan(&audits, &milestones); err != nil || audits != auditsBefore+1 || milestones != 0 {
				t.Fatal(audits, milestones, err)
			}
		})
	}
}
