//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestOrgCandidateCVAtomicRollback(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			initial := f.detail(t)
			tag := initial.header.Get("ETag")
			owned := f.owned(t)
			keys, err := f.local.Keys(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			sort.Strings(keys)
			for _, table := range []string{"company_candidate_cvs", "company_candidate_history", "audit_events"} {
				t.Run(table, func(t *testing.T) {
					column, id := "company_candidate_id", f.id
					if table == "company_candidate_cvs" {
						column, id = "company_id", f.company.companyID
					}
					if table == "company_candidate_history" {
						column = "candidate_id"
					}
					if table == "audit_events" {
						column = "entity_id"
					}
					constraint := "cv_test_" + uuid.NewString()[:8]
					f.exec(t, fmt.Sprintf(`ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s <> '%s'::uuid) NOT VALID`, table, constraint, column, id))
					cleanup := func() { f.exec(t, fmt.Sprintf(`ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s`, table, constraint)) }
					t.Cleanup(cleanup)
					r := f.upload(t, "must-rollback.pdf", "%PDF-rollback", tag)
					draftFlowAssertError(t, r, 500, "internal_error")
					if got := f.detail(t); string(got.body) != string(initial.body) || f.owned(t) != owned {
						t.Fatal("non-atomic CV write", string(got.body))
					}
					if n := draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_history WHERE candidate_id=$1`, f.id); n != 0 {
						t.Fatal(n)
					}
					if n := draftFlowAuditCount(t, f.h.pool, f.id, "CompanyCandidateCVCorrected"); n != 0 {
						t.Fatal(n)
					}
					after, err := f.local.Keys(t.Context())
					if err != nil {
						t.Fatal(err)
					}
					sort.Strings(after)
					if !reflect.DeepEqual(keys, after) {
						t.Fatal("orphan file not compensated", keys, after)
					}
					if kind == "organic" && draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2`, f.company.companyID, f.id) != 0 {
						t.Fatal("first correction row escaped rollback")
					}
					cleanup()
				})
			}
		})
	}
}

func TestOrgCandidateCVConcurrentIfMatch(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		for _, first := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/first=%t", kind, first), func(t *testing.T) {
				f := newCandidateCVFixture(t, kind)
				tag := f.detail(t).header.Get("ETag")
				want := 1
				if !first {
					r := f.upload(t, "previous.pdf", "%PDF-previous", tag)
					if r.status != 200 {
						t.Fatal(r.status, string(r.body))
					}
					tag = r.header.Get("ETag")
					want = 2
				}
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				lock, err := f.h.pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer lock.Rollback(context.Background())
				var blocker int
				if kind == "manual" {
					err = lock.QueryRow(ctx, `SELECT pg_backend_pid() FROM company_candidates WHERE id=$1 FOR UPDATE`, f.id).Scan(&blocker)
				} else {
					if first {
						if _, err = lock.Exec(ctx, `INSERT INTO company_candidate_corrections(company_id,user_id) VALUES($1,$2)`, f.company.companyID, f.id); err != nil {
							t.Fatal(err)
						}
					}
					err = lock.QueryRow(ctx, `SELECT pg_backend_pid() FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2 FOR UPDATE`, f.company.companyID, f.id).Scan(&blocker)
				}
				if err != nil {
					t.Fatal(err)
				}
				done := make(chan draftFlowCall, 2)
				for _, name := range []string{"winner-a.pdf", "winner-b.pdf"} {
					body, typ := orgCVMultipart(t, name, []byte("%PDF-"+name), "")
					go func() {
						r, err := f.h.roundTrip("POST", f.pathCV, body, f.recruiter.token, map[string]string{"If-Match": tag, "Content-Type": typ})
						done <- draftFlowCall{resp: r, err: err}
					}()
				}
				ticker := time.NewTicker(5 * time.Millisecond)
				defer ticker.Stop()
				for {
					var waiting int
					err = f.h.pool.QueryRow(ctx, `WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*) FROM waiting`, blocker).Scan(&waiting)
					if err != nil {
						t.Fatal(err)
					}
					if waiting >= 2 {
						break
					}
					select {
					case <-ctx.Done():
						t.Fatal("both uploads did not reach candidate lock")
					case <-ticker.C:
					}
				}
				if err = lock.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				statuses := []int{}
				for range 2 {
					select {
					case call := <-done:
						if call.err != nil {
							t.Fatal(call.err)
						}
						statuses = append(statuses, call.resp.status)
						draftFlowAssertNoStore(t, call.resp)
						if call.resp.status == 412 && (len(draftFlowObject(t, call.resp.body)) != 2 || draftFlowCatalogCode(t, call.resp.body) != "precondition_failed") {
							t.Fatal(string(call.resp.body))
						}
					case <-ctx.Done():
						t.Fatal("upload did not finish")
					}
				}
				sort.Ints(statuses)
				if !reflect.DeepEqual(statuses, []int{200, 412}) {
					t.Fatal(statuses)
				}
				if n := draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_history WHERE candidate_id=$1`, f.id); n != want {
					t.Fatal(n)
				}
				if n := draftFlowAuditCount(t, f.h.pool, f.id, "CompanyCandidateCVCorrected"); n != want {
					t.Fatal(n)
				}
				if f.detail(t).header.Get("ETag") == tag {
					t.Fatal("version not advanced")
				}
			})
		}
	}
}
