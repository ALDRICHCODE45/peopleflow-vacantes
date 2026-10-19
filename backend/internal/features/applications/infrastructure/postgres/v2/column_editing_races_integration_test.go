//go:build integration

package v2

import (
	"context"
	"errors"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

func TestColumnsForcedConcurrentEditMoveDiscardRecoverApply(t *testing.T) {
	for _, operation := range []string{"move", "discard", "recover", "apply"} {
		for _, first := range []string{"edit", "operation"} {
			t.Run(operation+"/"+first+"_first", func(t *testing.T) {
				m := setupMovement(t)
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				base := pc.Defaults(m.vacancy)
				if operation == "discard" || operation == "recover" {
					out, err := m.move(t, m.item, base.Stages[1].ID, false)
					if err != nil {
						t.Fatal(err)
					}
					m.item = out.Item
					if operation == "recover" {
						out, err = m.discard(t, m.item, discardBody)
						if err != nil {
							t.Fatal(err)
						}
						m.item = out.Item
					}
				}
				editPool, editPID := operationPool(t, ctx, m.pool)
				opPool, opPID := operationPool(t, ctx, m.pool)
				a := audit.NewAuditEventRepository()
				author := draftstore.NewStore(editPool, a)
				mover := boardstore.NewStore(opPool, a, movementContext{draftstore.NewStore(opPool, a)}, m.storage, draftjson.Decode)
				intake := NewStore(opPool, a, testVacancyRules{}, draftstore.NewStore(opPool, a))
				var cvID uuid.UUID
				if operation == "apply" {
					cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1 other"))
					if err != nil {
						t.Fatal(err)
					}
					cvID = cv.ID
				}
				proposal := base
				proposal.Stages = append(base.Stages[:1:1], append([]pc.Stage{{Name: "Inserted"}}, base.Stages[1:]...)...)
				body := columnConfirm(movementPipelineBody(t, proposal))
				blocker, err := m.pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer blocker.Rollback(context.Background())
				var blockerPID int
				if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, m.vacancy).Scan(&blockerPID); err != nil {
					t.Fatal(err)
				}
				edited := make(chan error, 1)
				operated := make(chan error, 1)
				startEdit := func() {
					go func() {
						_, err := author.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, body)
						edited <- err
					}()
				}
				startOperation := func() {
					go func() {
						var err error
						switch operation {
						case "move":
							_, err = mover.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+base.Stages[1].ID+`"}`))
						case "discard":
							_, err = mover.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
						case "recover":
							_, err = mover.Recover(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{}`))
						case "apply":
							_, err = intake.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cvID))
						}
						operated <- err
					}()
				}
				if first == "edit" {
					startEdit()
					waitBlockedBy(t, ctx, m.pool, editPID, blockerPID)
					startOperation()
					waitBlockedBy(t, ctx, m.pool, opPID, editPID)
				} else {
					startOperation()
					waitBlockedBy(t, ctx, m.pool, opPID, blockerPID)
					startEdit()
					waitBlockedBy(t, ctx, m.pool, editPID, opPID)
				}
				if err = blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				await := func(ch <-chan error) error {
					t.Helper()
					select {
					case err := <-ch:
						return err
					case <-ctx.Done():
						t.Fatal("possible draft/process/participation deadlock")
						return ctx.Err()
					}
				}
				if err = await(edited); err != nil {
					t.Fatal(err)
				}
				var want error
				if operation == "move" && first == "edit" {
					want = board.ErrStageSkip
				}
				if err = await(operated); !errors.Is(err, want) {
					t.Fatal(err, want)
				}
				var marks int
				if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM participation_stage_history WHERE participation_id=$1 AND event_kind='not_applicable'`, m.item.ID).Scan(&marks); err != nil {
					t.Fatal(err)
				}
				expected := 0
				if operation == "discard" || operation == "recover" || (operation == "move" && first == "operation") {
					expected = 1
				}
				if marks != expected {
					t.Fatal("impact did not use serialized live position", marks, expected)
				}
				view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				count := 1
				if operation == "apply" {
					count = 2
				}
				if len(view.Participations) != count || len(view.Stages) != 6 {
					t.Fatal(view)
				}
				config, err := m.drafts.GetPipeline(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				var auditMarks int
				if err = m.pool.QueryRow(ctx, `SELECT jsonb_array_length((metadata->>'applied_impact')::jsonb->'not_applicable') FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftPipelineConfigured'`, m.vacancy).Scan(&auditMarks); err != nil || auditMarks != expected {
					t.Fatal(auditMarks, err)
				}
				if columnConfig(t, config.Body).Stages[1].Kind != "custom" {
					t.Fatal(string(config.Body))
				}
			})
		}
	}
}
