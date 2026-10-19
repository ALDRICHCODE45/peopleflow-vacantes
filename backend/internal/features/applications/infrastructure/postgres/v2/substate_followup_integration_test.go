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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

func TestSubstateRemovalRacingMoveDiscardBothOrderings(t *testing.T) {
	for _, operation := range []string{"move", "discard"} {
		for _, first := range []string{"remove", "leave"} {
			t.Run(operation+"/"+first+" first", func(t *testing.T) {
				m, id := activeSubstateFixture(t)
				m.item = setSubstateHTTP(t, m, id)
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				catalog, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
				if err != nil {
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
					err error
				}
				done := make(chan result, 2)
				order := []string{first, "leave"}
				if first == "leave" {
					order[1] = "remove"
				}
				for _, op := range order {
					pool, pid := operationPool(t, ctx, m.pool)
					go func(op string) {
						a := audit.NewAuditEventRepository()
						d := draftstore.NewStore(pool, a)
						var e error
						if op == "remove" {
							_, e = d.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, catalog.ETag, true, []byte(`{"substates":[]}`))
						} else {
							b := boardstore.NewStore(pool, a, movementContext{d}, m.storage, draftjson.Decode)
							if operation == "discard" {
								_, e = b.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
							} else {
								_, e = b.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+pc.Defaults(m.vacancy).Stages[2].ID+`"}`))
							}
						}
						done <- result{op, e}
					}(op)
					waitBlockedBy(t, ctx, m.pool, pid, previousPID)
					previousPID = pid
				}
				if err = blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				for range 2 {
					select {
					case r := <-done:
						if first == "remove" && r.op == "remove" {
							var used *substatecatalog.InUseError
							if !errors.As(r.err, &used) || !reflect.DeepEqual(used.IDs, []string{id}) {
								t.Fatal(r.err)
							}
						} else if r.err != nil {
							t.Fatal(r.op, r.err)
						}
					case <-ctx.Done():
						t.Fatal("catalog/leave deadlock")
					}
				}
				view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil || len(view.Participations) != 1 || view.Participations[0].SubstateID != nil || view.Participations[0].Version != incrementVersion(t, m.item.Version) {
					t.Fatal(view, err)
				}
				wantStage := pc.Defaults(m.vacancy).Stages[2].ID
				if operation == "discard" {
					wantStage = pc.Defaults(m.vacancy).Exit.ID
				}
				if view.Participations[0].StageID != wantStage {
					t.Fatal(view)
				}
				saved, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				if (saved.ETag == catalog.ETag) != (first == "remove") || (len(view.Substates) == 0) != (first == "leave") {
					t.Fatal("catalog version/occupancy incoherent")
				}
				h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
				if err != nil || len(h.Items) != len(history.Items)+2 {
					t.Fatal(h, err)
				}
				clear, last := h.Items[len(h.Items)-2], h.Items[len(h.Items)-1]
				if clear.Kind != "substate" || clear.FromSubstateID == nil || *clear.FromSubstateID != id || clear.FromSubstateName == nil || *clear.FromSubstateName != "Interview" || clear.ToSubstateID != nil || last.Kind != operation || !clear.At.Before(last.At) {
					t.Fatal(clear, last)
				}
			})
		}
	}
}

func TestSubstateOwnerPrincipalNonprincipalDBMatrix(t *testing.T) {
	for _, role := range []string{"principal", "owner", "nonprincipal"} {
		t.Run(role, func(t *testing.T) {
			m, id := activeSubstateFixture(t)
			ctx := context.Background()
			if _, err := m.pool.Exec(ctx, `UPDATE company_members SET role='recruiter' WHERE user_id=$1`, m.recruiter); err != nil {
				t.Fatal(err)
			}
			if role != "principal" {
				other := uuid.New()
				if _, err := m.pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Other recruiter','recruiter')`, other, uuid.NewString(), uuid.NewString()+"@example.test"); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if _, err := m.pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, m.vacancy, m.recruiter); err != nil {
						t.Error(err)
					}
					if _, err := m.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, other); err != nil {
						t.Error(err)
					}
				})
				if _, err := m.pool.Exec(ctx, `UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, m.vacancy, other); err != nil {
					t.Fatal(err)
				}
			}
			if role == "owner" {
				if _, err := m.pool.Exec(ctx, `UPDATE company_members SET role='owner' WHERE user_id=$1`, m.recruiter); err != nil {
					t.Fatal(err)
				}
			}
			before := catalogSnapshot(t, m)
			if role == "nonprincipal" {
				for _, body := range []string{`broken`, `{"substate_id":"` + id + `"}`} {
					_, err := m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, "", false, []byte(body))
					if !errors.Is(err, board.ErrNotFound) || before != catalogSnapshot(t, m) {
						t.Fatal("authorization must precede preconditions/body", err)
					}
				}
				return
			}
			out, err := m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":"`+id+`"}`))
			if err != nil || out.SubstateID == nil || *out.SubstateID != id || out.Version != incrementVersion(t, m.item.Version) {
				t.Fatal(out, err)
			}
			var count int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationSubstateChanged' AND actor_id=$2`, m.item.ID, m.recruiter).Scan(&count); err != nil || count != 1 {
				t.Fatal(count, err)
			}
		})
	}
}
