//go:build integration

package v2

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

func TestFulfillmentCrossingMixedApplyMoveEditExactlyOnce(t *testing.T) {
	orders := [][]string{{"apply", "move", "edit"}, {"apply", "edit", "move"}, {"move", "apply", "edit"}, {"move", "edit", "apply"}, {"edit", "apply", "move"}, {"edit", "move", "apply"}}
	for _, order := range orders {
		t.Run(strings.Join(order, " then "), func(t *testing.T) {
			m := setupMovement(t)
			readyMovementConfiguration(t, m)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			moved, err := m.move(t, m.item, pc.Defaults(m.vacancy).Stages[1].ID, false)
			if err != nil {
				t.Fatal(err)
			}
			m.item = moved.Item
			fulfillmentConfig(t, m, 0, 2)
			cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1 other"))
			if err != nil {
				t.Fatal(err)
			}
			config, err := m.drafts.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
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
			previousPID := blockerPID
			type result struct {
				op  string
				err error
			}
			done := make(chan result, 3)
			for _, op := range order {
				pool, pid := operationPool(t, ctx, m.pool)
				go func(op string) {
					a := audit.NewAuditEventRepository()
					d := draftstore.NewStore(pool, a)
					var e error
					switch op {
					case "apply":
						s := NewStore(pool, a, testVacancyRules{}, d)
						_, e = s.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID))
					case "move":
						s := boardstore.NewStore(pool, a, movementContext{d}, m.storage, draftjson.Decode)
						_, e = s.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+pc.Defaults(m.vacancy).Stages[0].ID+`"}`))
					case "edit":
						_, e = d.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, config.ETag, true, deliveryBody(m, 0, 1, true))
					}
					done <- result{op, e}
				}(op)
				// Shared application locks can wait directly on the blocker or the
				// preceding exclusive tuple waiter. Observe each waiter before launching
				// the next operation; no sleeps determine the ordering.
				waitFulfillmentApplicationBlocked(t, ctx, m.pool, pid, blockerPID, previousPID)
				previousPID = pid
			}
			if err = blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			editFirst := false
			for _, op := range order {
				if op == "edit" {
					editFirst = true
					break
				}
				if op == "apply" {
					break
				}
			}
			for range 3 {
				select {
				case r := <-done:
					var want error
					if r.op == "edit" && !editFirst {
						want = fulfillment.ErrFulfilled
					}
					if !errors.Is(r.err, want) {
						t.Fatal(r.op, r.err, want)
					}
				case <-ctx.Done():
					t.Fatal("mixed fulfillment race deadlocked")
				}
			}
			status := fulfillmentStatus(t, m)
			target := int64(2)
			if editFirst {
				target = 1
			}
			if status.State != "fulfilled" || status.Target != target || status.Fulfillment == nil || len(status.Fulfillment.Candidates) != int(target) || status.Fulfillment.Candidates[0].ParticipationID != m.item.ID {
				t.Fatal(status)
			}
			// Frozen delivered is the count at crossing, not refreshed by later apply.
			if status.Delivered != target {
				t.Fatal("frozen count drifted", status)
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || len(view.Participations) != 2 || view.Stages[0].Count != 2 || view.Delivery.State != "fulfilled" {
				t.Fatal(view, err)
			}
			var edited int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftDeliveryConfigured'`, m.vacancy).Scan(&edited); err != nil || (edited == 1) != editFirst || edited > 1 {
				t.Fatal(edited, err)
			}
			assertOneFulfillment(t, m)
		})
	}
}
