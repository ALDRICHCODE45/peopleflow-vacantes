//go:build integration

package v2

import (
	"context"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Shared draft lockers may queue behind the exclusive blocker or behind the
// first waiter's tuple lock. Either proves both applications are in flight.
func waitFulfillmentApplicationBlocked(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pid, blocker, first int) {
	t.Helper()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		var blocked bool
		if err := pool.QueryRow(ctx, `SELECT $2::int=ANY(pg_blocking_pids($1)) OR $3::int=ANY(pg_blocking_pids($1))`, pid, blocker, first).Scan(&blocked); err != nil {
			t.Fatal("application lock probe failed")
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("expected concurrent application lock not observed")
		case <-tick.C:
		}
	}
}

func TestFulfillmentConcurrentMovesExactlyOnce(t *testing.T) {
	for _, first := range []int{0, 1} {
		t.Run(stringNumber(first), func(t *testing.T) {
			m := setupMovement(t)
			other := fulfillmentOther(t, m)
			fulfillmentConfig(t, m, 1, 2)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			poolA, pidA := operationPool(t, ctx, m.pool)
			poolB, pidB := operationPool(t, ctx, m.pool)
			a := audit.NewAuditEventRepository()
			stores := []*boardstore.Store{
				boardstore.NewStore(poolA, a, movementContext{draftstore.NewStore(poolA, a)}, m.storage, draftjson.Decode),
				boardstore.NewStore(poolB, a, movementContext{draftstore.NewStore(poolB, a)}, m.storage, draftjson.Decode),
			}
			items := []board.Item{m.item, other}
			pids := []int{pidA, pidB}
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
				value board.Moved
				err   error
			}
			results := make(chan result, 2)
			start := func(i int) {
				go func() {
					item := items[i]
					v, e := stores[i].Move(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{"to_stage_id":"`+pipelineconfig.Defaults(m.vacancy).Stages[1].ID+`"}`))
					results <- result{v, e}
				}()
			}
			start(first)
			waitBlockedBy(t, ctx, m.pool, pids[first], blockerPID)
			start(1 - first)
			waitBlockedBy(t, ctx, m.pool, pids[1-first], pids[first])
			if err = blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			fulfilled := 0
			for i := 0; i < 2; i++ {
				select {
				case r := <-results:
					if r.err != nil {
						t.Fatal(r.err)
					}
					if r.value.Delivery.State == "fulfilled" {
						fulfilled++
					}
				case <-ctx.Done():
					t.Fatal("concurrent move deadlock")
				}
			}
			if fulfilled != 1 {
				t.Fatal("expected only threshold-crossing response fulfilled", fulfilled)
			}
			got := fulfillmentStatus(t, m)
			if got.Delivered != 2 || len(got.Fulfillment.Candidates) != 2 || got.Fulfillment.Candidates[0].ParticipationID != items[first].ID {
				t.Fatal(got)
			}
			assertOneFulfillment(t, m)
		})
	}
}

func TestFulfillmentConcurrentApplicationsExactlyOnce(t *testing.T) {
	f := setup(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	a := audit.NewAuditEventRepository()
	m := movementFixture{fixture: f, drafts: draftstore.NewStore(f.pool, a)}
	if err := f.pool.QueryRow(ctx, `SELECT principal_recruiter_id FROM job_drafts WHERE id=$1`, f.vacancy).Scan(&m.recruiter); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO company_members(id,company_id,user_id,role) VALUES(gen_random_uuid(),$1,$2,'owner')`, f.company, m.recruiter); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(), `DELETE FROM company_members WHERE company_id=$1`, f.company); err != nil {
			t.Error(err)
		}
	})
	fulfillmentConfig(t, m, 0, 2)
	cvA, err := f.library.Upload(ctx, f.sub, "CV A", "cv.pdf", []byte("%PDF-1 A"))
	if err != nil {
		t.Fatal(err)
	}
	cvB, err := f.library.Upload(ctx, f.other, "CV B", "cv.pdf", []byte("%PDF-1 B"))
	if err != nil {
		t.Fatal(err)
	}
	poolA, pidA := operationPool(t, ctx, f.pool)
	poolB, pidB := operationPool(t, ctx, f.pool)
	storeA := NewStore(poolA, a, testVacancyRules{}, draftstore.NewStore(poolA, a))
	storeB := NewStore(poolB, a, testVacancyRules{}, draftstore.NewStore(poolB, a))
	blocker, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer blocker.Rollback(context.Background())
	var blockerPID int
	if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, f.vacancy).Scan(&blockerPID); err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	go func() { _, e := storeA.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cvA.ID)); results <- e }()
	waitBlockedBy(t, ctx, f.pool, pidA, blockerPID)
	go func() { _, e := storeB.Apply(ctx, f.other, f.vacancy, uuid.New(), f.request(cvB.ID)); results <- e }()
	waitFulfillmentApplicationBlocked(t, ctx, f.pool, pidB, blockerPID, pidA)
	if err = blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		select {
		case e := <-results:
			if e != nil {
				t.Fatal(e)
			}
		case <-ctx.Done():
			t.Fatal("concurrent application deadlock")
		}
	}
	status := fulfillmentStatus(t, m)
	if status.State != "fulfilled" || status.Delivered != 2 || len(status.Fulfillment.Candidates) != 2 || status.Fulfillment.Candidates[0].ParticipationID == status.Fulfillment.Candidates[1].ParticipationID {
		t.Fatal(status)
	}
	assertOneFulfillment(t, m)
}
