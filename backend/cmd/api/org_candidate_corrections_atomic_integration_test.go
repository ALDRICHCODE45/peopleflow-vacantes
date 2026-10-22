//go:build integration

package main

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestOrgCandidateCorrectionsAtomicRollback(t *testing.T) {
	f := newOrganicEditFixture(t)
	initial := f.detail(t)
	tag := initial.header.Get("ETag")
	owned := organicOwnedBytes(t, f)
	for _, table := range []string{"company_candidate_history", "audit_events"} {
		t.Run(table, func(t *testing.T) {
			column := "candidate_id"
			if table == "audit_events" {
				column = "entity_id"
			}
			name := "correction_test_" + uuid.NewString()[:8]
			f.exec(t, fmt.Sprintf(`ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s <> '%s'::uuid) NOT VALID`, table, name, column, f.id))
			cleanup := func() { f.exec(t, fmt.Sprintf(`ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s`, table, name)) }
			t.Cleanup(cleanup)
			r := f.patch(t, `{"set":{"full_name":"Must Roll Back","skills":["rust"],"education":[`+editStudy+`],"languages":[{"code":"es","level":"native"}]}}`, tag)
			draftFlowAssertError(t, r, 500, "internal_error")
			if got := f.detail(t); string(got.body) != string(initial.body) {
				t.Fatal("partial edit escaped rollback", string(got.body))
			}
			if h, a := f.counts(t); h != 0 || a != 0 {
				t.Fatal(h, a)
			}
			if n := draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2`, f.company.companyID, f.id); n != 0 {
				t.Fatal("first-write correction row escaped rollback")
			}
			if organicOwnedBytes(t, f) != owned {
				t.Fatal("candidate-owned rows changed")
			}
			cleanup()
		})
	}
}

func TestOrgCandidateCorrectionsConcurrentIfMatch(t *testing.T) {
	for _, first := range []bool{true, false} {
		name := "existing correction"
		if first {
			name = "first correction"
		}
		t.Run(name, func(t *testing.T) {
			f := newOrganicEditFixture(t)
			tag := f.detail(t).header.Get("ETag")
			if !first {
				r := f.patch(t, `{"set":{"professional_title":"Initial Correction"}}`, tag)
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				tag = r.header.Get("ETag")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			lock, err := f.h.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer lock.Rollback(context.Background())
			if first {
				if _, err = lock.Exec(ctx, `INSERT INTO company_candidate_corrections(company_id,user_id) VALUES($1,$2)`, f.company.companyID, f.id); err != nil {
					t.Fatal(err)
				}
			}
			var pid int
			if err = lock.QueryRow(ctx, `SELECT pg_backend_pid() FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2 FOR UPDATE`, f.company.companyID, f.id).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			done := make(chan draftFlowCall, 2)
			for _, title := range []string{"First Winner", "Second Winner"} {
				go func(title string) {
					r, err := f.h.roundTrip("PATCH", f.path, `{"set":{"professional_title":"`+title+`"}}`, f.recruiter.token, map[string]string{"If-Match": tag})
					done <- draftFlowCall{resp: r, err: err}
				}(title)
			}
			ticker := time.NewTicker(5 * time.Millisecond)
			defer ticker.Stop()
			for {
				var waiting int
				err = f.h.pool.QueryRow(ctx, `WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*) FROM waiting`, pid).Scan(&waiting)
				if err != nil {
					t.Fatal(err)
				}
				if waiting >= 2 {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("both PATCHes did not reach correction lock")
				case <-ticker.C:
				}
			}
			if err = lock.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			statuses := []int{}
			for range 2 {
				select {
				case result := <-done:
					if result.err != nil {
						t.Fatal(result.err)
					}
					statuses = append(statuses, result.resp.status)
					draftFlowAssertNoStore(t, result.resp)
					if result.resp.status == 412 {
						if len(draftFlowObject(t, result.resp.body)) != 2 || draftFlowCatalogCode(t, result.resp.body) != "precondition_failed" {
							t.Fatal(string(result.resp.body))
						}
					}
				case <-ctx.Done():
					t.Fatal("PATCH did not finish")
				}
			}
			sort.Ints(statuses)
			if statuses[0] != 200 || statuses[1] != 412 {
				t.Fatal(statuses)
			}
			want := 1
			if !first {
				want = 2
			}
			if h, a := f.counts(t); h != want || a != want {
				t.Fatal(h, a)
			}
			current := f.detail(t)
			if current.header.Get("ETag") == tag {
				t.Fatal("winner did not advance version")
			}
			history := f.history(t, "")
			change := history["items"].([]any)[0].(map[string]any)["changes"].([]any)[0].(map[string]any)
			expectedFrom := any(nil)
			if !first {
				expectedFrom = "Initial Correction"
			}
			if change["from"] != expectedFrom || change["to"] != draftFlowObject(t, current.body)["professional_title"] {
				t.Fatal(change)
			}
		})
	}
}
