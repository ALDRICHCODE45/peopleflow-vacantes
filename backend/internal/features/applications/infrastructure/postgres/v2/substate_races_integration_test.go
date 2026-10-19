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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
)

func TestSubstateCatalogRemovalBothLockOrderings(t *testing.T) {
	for _, winner := range []string{"set", "remove"} {
		t.Run(winner+" first", func(t *testing.T) {
			m, id := activeSubstateFixture(t)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			c, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
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
			type result struct {
				op  string
				err error
			}
			done := make(chan result, 2)
			order := []string{winner, "set"}
			if winner == "set" {
				order[1] = "remove"
			}
			previousPID := blockerPID
			for _, op := range order {
				pool, pid := operationPool(t, ctx, m.pool)
				go func(op string) {
					a := audit.NewAuditEventRepository()
					var e error
					if op == "set" {
						s := boardstore.NewStore(pool, a, movementContext{m.drafts}, m.storage, draftjson.Decode)
						_, e = s.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":"`+id+`"}`))
					} else {
						s := draftstore.NewStore(pool, a)
						_, e = s.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, c.ETag, true, []byte(`{"substates":[]}`))
					}
					done <- result{op, e}
				}(op)
				waitBlockedBy(t, ctx, m.pool, pid, previousPID)
				previousPID = pid
			}
			if err = blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			for i := 0; i < 2; i++ {
				select {
				case r := <-done:
					if r.op == winner {
						if r.err != nil {
							t.Fatal(r.op, r.err)
						}
					} else if winner == "remove" {
						if !errors.Is(r.err, board.ErrValidation) {
							t.Fatal(r.err)
						}
					} else {
						var used *substatecatalog.InUseError
						if !errors.As(r.err, &used) || !reflect.DeepEqual(used.IDs, []string{id}) {
							t.Fatal(r.err)
						}
					}
				case <-ctx.Done():
					t.Fatal("possible set/catalog deadlock")
				}
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			if winner == "set" {
				if len(view.Substates) != 2 || view.Participations[0].SubstateID == nil || *view.Participations[0].SubstateID != id || view.Participations[0].Version != incrementVersion(t, m.item.Version) {
					t.Fatal(view)
				}
			} else {
				if len(view.Substates) != 0 || view.Participations[0].SubstateID != nil || view.Participations[0].Version != m.item.Version {
					t.Fatal(view)
				}
			}
			history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil {
				t.Fatal(err)
			}
			want := 4
			if winner == "set" {
				want++
			}
			if len(history.Items) != want {
				t.Fatal(history)
			}
			saved, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			if (saved.ETag == c.ETag) != (winner == "set") {
				t.Fatal("rejected operation changed catalog version")
			}
		})
	}
}
