//go:build integration

// Migration 00014 (`index_job_drafts_company_updated`) contract coverage: up
// creates the keyset index of the employer draft list
// (GET /v2/me/company/job-drafts orders by updated_at DESC, id DESC inside one
// company), the planner can serve that order from it, and down drops it.
//
// Same isolation as the 00013 tests: only the disposable loopback `draft_test`
// database named by DRAFT_TEST_DATABASE_URL, schema left at the highest version.
package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const draftListIndex = "job_drafts_company_updated_id_idx"

func indexDefinition(t *testing.T, pool *pgxpool.Pool, name string) (string, bool) {
	t.Helper()
	var def string
	err := pool.QueryRow(context.Background(),
		`SELECT indexdef FROM pg_indexes WHERE tablename = 'job_drafts' AND indexname = $1`, name,
	).Scan(&def)
	if err != nil {
		return "", false
	}
	return def, true
}

func TestMigration00014UpCreatesDraftListIndexUsedByTheListOrder(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)

	def, ok := indexDefinition(t, pool, draftListIndex)
	if !ok {
		t.Fatalf("index %s must exist after 00014 up", draftListIndex)
	}
	if !strings.Contains(def, "(company_id, updated_at DESC, id DESC)") {
		t.Fatalf("index definition = %q, want (company_id, updated_at DESC, id DESC)", def)
	}

	// The list query shape: one company, keyset on (updated_at, id), newest
	// first, LIMIT n+1. With sequential scans disabled the planner must be able
	// to serve both the filter and the order from the index.
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)
	// This is an index-capability test, not a cost-estimation test. Prevent a
	// bitmap scan plus sort from competing with the ordered index scan when
	// unrelated fixtures or suite load change the table's statistics. LOCAL
	// settings cannot escape this transaction into another pooled test.
	for _, setting := range []string{`SET LOCAL enable_seqscan = off`, `SET LOCAL enable_bitmapscan = off`} {
		if _, err := tx.Exec(ctx, setting); err != nil {
			t.Fatalf("configure planner: %v", err)
		}
	}
	rows, err := tx.Query(ctx,
		`EXPLAIN SELECT id FROM job_drafts
		  WHERE company_id = '00000000-0000-4000-8000-000000000001'
		    AND (updated_at, id) < (now(), '00000000-0000-4000-8000-000000000002'::uuid)
		  ORDER BY updated_at DESC, id DESC LIMIT 21`)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan plan: %v", err)
		}
		plan.WriteString(line + "\n")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatalf("read plan: %v", err)
	}
	if !strings.Contains(plan.String(), draftListIndex) || strings.Contains(plan.String(), "Sort") {
		t.Fatalf("list query must use %s without a sort step; plan:\n%s", draftListIndex, plan.String())
	}
}

func TestMigration00014DownDropsDraftListIndex(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)

	gooseDownTo(t, db, 13)
	if _, ok := indexDefinition(t, pool, draftListIndex); ok {
		t.Fatalf("index %s must not exist after 00014 down", draftListIndex)
	}
	// The pre-existing company index is untouched by 00014.
	if _, ok := indexDefinition(t, pool, "job_drafts_company_id_idx"); !ok {
		t.Fatal("job_drafts_company_id_idx must survive 00014 down")
	}
}
