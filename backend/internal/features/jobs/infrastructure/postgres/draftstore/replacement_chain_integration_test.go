//go:build integration

package draftstore

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type chainFixture struct {
	t       *testing.T
	pool    *pgxpool.Pool
	company uuid.UUID
	actor   uuid.UUID
	version map[uuid.UUID]int64
}

func newChainFixture(t *testing.T, pool *pgxpool.Pool) *chainFixture {
	t.Helper()
	p := newPrincipal(t, pool)
	t.Cleanup(func() { // runs before newPrincipal's cleanup (LIFO)
		for _, q := range []string{
			`DELETE FROM vacancy_replacement_credits WHERE replacement_process_id IN (SELECT process_id FROM vacancy_replacements WHERE company_id=$1)`,
			`DELETE FROM vacancy_replacements WHERE company_id=$1`,
			`DELETE FROM placement_credits WHERE company_id=$1`,
			`DELETE FROM process_participations WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
		} {
			if _, err := pool.Exec(context.Background(), q, p.companyID); err != nil {
				t.Errorf("chain fixture cleanup: %v", err)
			}
		}
	})
	return &chainFixture{t: t, pool: pool, company: p.companyID, actor: p.ownerID, version: map[uuid.UUID]int64{}}
}

func (f *chainFixture) exec(q string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(), q, args...); err != nil {
		f.t.Fatal(err)
	}
}

// process inserts a draft + vacancy process in the given axes.
func (f *chainFixture) process(status, processStatus string) uuid.UUID {
	f.t.Helper()
	id := uuid.New()
	f.exec(`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, id, f.company, f.actor)
	f.exec(`INSERT INTO vacancy_processes(id,company_id,status,process_status,published_at,published_by) VALUES($1,$2,$3,$4,now(),$5)`, id, f.company, status, processStatus, f.actor)
	f.version[id] = 1
	return id
}

func (f *chainFixture) replacement(source, root uuid.UUID, sequence int, status, processStatus string) uuid.UUID {
	f.t.Helper()
	id := f.process(status, processStatus)
	f.exec(`INSERT INTO vacancy_replacements(process_id,company_id,source_process_id,root_process_id,sequence,started_at,started_by,target_quantity) VALUES($1,$2,$3,$4,$5,now(),$6,1)`, id, f.company, source, root, sequence, f.actor)
	return id
}

// lifecycle appends one event; only close carries a reason.
func (f *chainFixture) lifecycle(process uuid.UUID, action, reason string) {
	f.t.Helper()
	f.version[process]++
	var choice, why any
	if action == "close" {
		choice = "continue"
		if reason != "" {
			why = reason
		}
	}
	f.exec(`INSERT INTO vacancy_lifecycle_events(id,process_id,lifecycle_version,action,process,reason,actor_id,actor_name,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Owner',now())`,
		uuid.New(), process, f.version[process], action, choice, why, f.actor)
}

func (f *chainFixture) credit(process uuid.UUID, status string, hired time.Time) uuid.UUID {
	f.t.Helper()
	id := uuid.New()
	f.exec(`INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status) VALUES($1,$2,$3,$1,$1,$4,$5,'with_responsible',$6)`, id, f.company, process, hired, f.actor, status)
	return id
}

func TestReplacementChainPrimitives(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	f := newChainFixture(t, pool)
	root := f.process("closed", "finished")
	f.lifecycle(root, "close", "filled")
	first := f.replacement(root, root, 1, "closed", "finished")
	f.lifecycle(first, "close", "cancelled")
	second := f.replacement(first, root, 2, "published", "active")
	standalone := f.process("published", "active")
	hired := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	c1 := f.credit(root, "did_not_hold", hired)
	c2 := f.credit(root, "did_not_hold", hired.Add(time.Hour))
	c3 := f.credit(first, "did_not_hold", hired.Add(2*time.Hour))
	f.credit(root, "active", hired.Add(3*time.Hour))
	f.credit(first, "voided", hired.Add(4*time.Hour))
	f.credit(second, "did_not_hold", hired.Add(5*time.Hour)) // a fallen hire of the active replacement is startable too
	f.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, first, c2)

	other := newChainFixture(t, pool)
	foreign := other.process("closed", "finished")
	other.credit(foreign, "did_not_hold", hired)

	t.Run("every process of the chain resolves the same root and order", func(t *testing.T) {
		for _, from := range []uuid.UUID{root, first, second} {
			chain, found, err := readReplacementChain(ctx, pool, f.company, from)
			if err != nil || !found || chain.Root != root || len(chain.Processes) != 3 {
				t.Fatalf("from %s: %+v %v %v", from, chain, found, err)
			}
			for i, want := range []uuid.UUID{root, first, second} {
				if chain.Processes[i].ID != want || chain.Processes[i].Sequence != int32(i) {
					t.Fatalf("from %s: position %d = %+v", from, i, chain.Processes[i])
				}
			}
			if latest := chain.latest(); latest.ID != second || latest.Status != "published" {
				t.Fatalf("latest=%+v", latest)
			}
			if active, ok := chain.activeReplacement(); !ok || active.ID != second {
				t.Fatalf("active=%+v %v", active, ok)
			}
		}
		alone, found, err := readReplacementChain(ctx, pool, f.company, standalone)
		if err != nil || !found || alone.Root != standalone || len(alone.Processes) != 1 || alone.latest().ID != standalone {
			t.Fatalf("standalone: %+v %v %v", alone, found, err)
		}
		if _, ok := alone.activeReplacement(); ok {
			t.Fatal("the original is not a replacement")
		}
	})
	t.Run("company scoping and unknown processes", func(t *testing.T) {
		for name, tc := range map[string]struct{ company, process uuid.UUID }{
			"other company": {other.company, root}, "unknown": {f.company, uuid.New()}, "foreign process": {f.company, foreign},
		} {
			if _, found, err := readReplacementChain(ctx, pool, tc.company, tc.process); err != nil || found {
				t.Fatalf("%s: found=%v %v", name, found, err)
			}
		}
	})
	t.Run("successor", func(t *testing.T) {
		for _, tc := range []struct {
			of   uuid.UUID
			want uuid.UUID
			ok   bool
		}{{root, first, true}, {first, second, true}, {second, uuid.Nil, false}, {standalone, uuid.Nil, false}} {
			got, ok, err := readReplacementSuccessor(ctx, pool, f.company, tc.of)
			if err != nil || ok != tc.ok || got != tc.want {
				t.Fatalf("successor of %s = %s,%v,%v want %s,%v", tc.of, got, ok, err, tc.want, tc.ok)
			}
		}
		if _, ok, err := readReplacementSuccessor(ctx, pool, other.company, root); err != nil || ok {
			t.Fatalf("other company saw a successor: %v %v", ok, err)
		}
	})
	t.Run("startable credits are fallen, of the chain and not replaced yet", func(t *testing.T) {
		credits, err := readStartableCredits(ctx, pool, f.company, root)
		if err != nil || len(credits) != 3 || credits[0].ID != c1 || credits[1].ID != c3 || credits[0].ProcessID != root || credits[1].ProcessID != first {
			t.Fatalf("credits=%+v %v", credits, err)
		}
		if !credits[0].HiredAt.Equal(hired) {
			t.Fatalf("hired_at=%s", credits[0].HiredAt)
		}
		if mine, err := readStartableCredits(ctx, pool, other.company, root); err != nil || len(mine) != 0 {
			t.Fatalf("other company credits=%+v %v", mine, err)
		}
		if none, err := readStartableCredits(ctx, pool, f.company, standalone); err != nil || len(none) != 0 {
			t.Fatalf("standalone credits=%+v %v", none, err)
		}
		if foreignCredits, err := readStartableCredits(ctx, pool, other.company, foreign); err != nil || len(foreignCredits) != 1 {
			t.Fatalf("foreign chain credits=%+v %v", foreignCredits, err)
		}
	})
	t.Run("closed covered follows the latest close reason", func(t *testing.T) {
		reopened := f.process("published", "active") // closed filled, then reopened: not closed
		f.lifecycle(reopened, "close", "filled")
		f.lifecycle(reopened, "reopen", "")
		recovered := f.process("closed", "active") // filled, reopened, closed again without cover
		f.lifecycle(recovered, "close", "filled")
		f.lifecycle(recovered, "reopen", "")
		f.lifecycle(recovered, "close", "cancelled")
		legacy := f.process("closed", "active") // legacy close without reason
		f.lifecycle(legacy, "close", "")
		for name, tc := range map[string]struct {
			process uuid.UUID
			want    bool
		}{"filled": {root, true}, "cancelled": {first, false}, "never closed": {second, false}, "reopened": {reopened, false}, "latest close wins": {recovered, false}, "no reason": {legacy, false}} {
			got, found, err := readClosedCovered(ctx, pool, f.company, tc.process)
			if err != nil || !found || got != tc.want {
				t.Fatalf("%s: covered=%v found=%v %v", name, got, found, err)
			}
		}
		if _, found, err := readClosedCovered(ctx, pool, other.company, root); err != nil || found {
			t.Fatalf("other company: found=%v %v", found, err)
		}
	})
}
