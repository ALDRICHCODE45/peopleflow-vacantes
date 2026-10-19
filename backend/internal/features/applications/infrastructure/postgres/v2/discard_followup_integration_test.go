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
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestDiscardMoveRecoveryPlacementForcedOneWinner(t *testing.T) {
	for _, winner := range []string{"discard", "move", "recover"} {
		t.Run(winner+" first", func(t *testing.T) {
			m := setupMovement(t)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if _, err := m.pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,1)`, m.vacancy); err != nil {
				t.Fatal(err)
			}
			stages := pc.Defaults(m.vacancy).Stages
			for _, stage := range stages[1:] {
				out, err := m.move(t, m.item, stage.ID, false)
				if err != nil {
					t.Fatal(err)
				}
				m.item = out.Item
			}
			full, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || full.Coverage.Covered != 1 || full.Coverage.FullCoverageReachedAt == nil {
				t.Fatal(full, err)
			}
			if winner == "recover" {
				out, err := m.discard(t, m.item, discardBody)
				if err != nil {
					t.Fatal(err)
				}
				m.item = out.Item
			}
			before, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil {
				t.Fatal(err)
			}
			var auditsBefore int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, m.item.ID).Scan(&auditsBefore); err != nil {
				t.Fatal(err)
			}
			blocker, err := m.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(context.Background())
			var previousPID int
			if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, m.vacancy).Scan(&previousPID); err != nil {
				t.Fatal(err)
			}
			type result struct {
				op  string
				out board.Moved
				err error
			}
			done := make(chan result, 3)
			order := []string{winner}
			for _, op := range []string{"discard", "move", "recover"} {
				if op != winner {
					order = append(order, op)
				}
			}
			for _, op := range order {
				pool, pid := operationPool(t, ctx, m.pool)
				a := audit.NewAuditEventRepository()
				store := boardstore.NewStore(pool, a, movementContext{m.drafts}, m.storage, draftjson.Decode)
				go func(op string) {
					var out board.Moved
					var err error
					switch op {
					case "discard":
						out, err = store.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
					case "move":
						out, err = store.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+stages[0].ID+`","confirm_placement_exit":true}`))
					case "recover":
						out, err = store.Recover(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"confirm_placement_reentry":true}`))
					}
					done <- result{op, out, err}
				}(op)
				waitBlockedBy(t, ctx, m.pool, pid, previousPID)
				previousPID = pid
			}
			if err = blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var won board.Moved
			for range 3 {
				select {
				case r := <-done:
					if r.op == winner {
						if r.err != nil {
							t.Fatal(r.op, r.err)
						}
						won = r.out
					} else if !errors.Is(r.err, board.ErrVersionConflict) {
						t.Fatal("loser must be 412", r.op, r.err)
					}
				case <-ctx.Done():
					t.Fatal("Placement race timed out")
				}
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			covered, wantStage, wantMilestones := int64(0), stages[0].ID, 1
			if winner == "discard" {
				wantStage = pc.Defaults(m.vacancy).Exit.ID
			}
			if winner == "recover" {
				covered, wantStage, wantMilestones = 1, stages[4].ID, 2
			}
			if err != nil || len(view.Participations) != 1 || !reflect.DeepEqual(view.Participations[0], won.Item) || won.Version != incrementVersion(t, m.item.Version) || won.StageID != wantStage || view.Coverage.Covered != covered || !reflect.DeepEqual(view.Coverage.FullCoverageReachedAt, full.Coverage.FullCoverageReachedAt) {
				t.Fatal(view, won, err)
			}
			if (won.Discard != nil) != (winner == "discard") || (view.Exit.Count == 1) != (winner == "discard") {
				t.Fatal("incoherent discard occupancy")
			}
			h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil || len(h.Items) != len(before.Items)+1 {
				t.Fatal(h, err)
			}
			last := h.Items[len(h.Items)-1]
			kind := winner
			if kind == "recover" {
				kind = "recovery"
			}
			if last.Kind != kind || last.Hire != (winner == "recover") || last.Departure != (winner != "recover") {
				t.Fatal(last)
			}
			var audits, milestones int
			if err = m.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM audit_events WHERE entity_id=$1),(SELECT count(*) FROM process_coverage_milestones WHERE process_id=$2 AND covered=1 AND required=1)`, m.item.ID, m.vacancy).Scan(&audits, &milestones); err != nil || audits != auditsBefore+1 || milestones != wantMilestones {
				t.Fatal(audits, milestones, err)
			}
		})
	}
}
