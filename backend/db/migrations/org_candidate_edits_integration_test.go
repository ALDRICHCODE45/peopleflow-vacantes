//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestOrgCandidateEditsBackfillAndGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 43)
	actor, company, candidate := uuid.New(), uuid.New(), uuid.New()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Migration Recruiter','recruiter')`, actor, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Migration Company',$2,'technology','active')`, company, uuid.NewString())
	exec(`INSERT INTO geo_countries VALUES('XZ','Test','Test') ON CONFLICT DO NOTHING`)
	exec(`INSERT INTO company_candidates(id,company_id,created_by,full_name,email,email_normalized,country_code,created_at) VALUES($1,$2,$3,'Migration Candidate','manual@example.test','manual@example.test','XZ','2026-01-01T00:00:00Z')`, candidate, company, actor)
	gooseUpTo(t, db, 44)
	var version int64
	var updated, created time.Time
	var by uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT version,created_at,updated_at,updated_by FROM company_candidates WHERE id=$1`, candidate).Scan(&version, &created, &updated, &by); err != nil {
		t.Fatal(err)
	}
	if version != 1 || !created.Equal(updated) || by != actor {
		t.Fatal(version, created, updated, by)
	}
	var index string
	if err := pool.QueryRow(ctx, `SELECT indexdef FROM pg_indexes WHERE indexname='company_candidate_history_page_idx'`).Scan(&index); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(index, "company_id, candidate_kind, candidate_id, at DESC, id DESC") {
		t.Fatal(index)
	}
	guard := func() {
		t.Helper()
		if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "retention decision") {
			t.Fatalf("guard: %v", err)
		}
		if v, err := goose.GetDBVersion(db); err != nil || v != 44 {
			t.Fatal(v, err)
		}
		if err := pool.QueryRow(ctx, `SELECT version FROM company_candidates WHERE id=$1`, candidate).Scan(&version); err != nil {
			t.Fatal("guard was not atomic", err)
		}
	}
	t.Run("version guard", func(t *testing.T) {
		exec(`UPDATE company_candidates SET version=2 WHERE id=$1`, candidate)
		guard()
		exec(`UPDATE company_candidates SET version=1 WHERE id=$1`, candidate)
	})
	t.Run("history guard", func(t *testing.T) {
		exec(`INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes) VALUES($1,$2,'manual',$3,$4,'[{"field":"phone","contact":true}]')`, uuid.New(), company, candidate, actor)
		guard()
		exec(`DELETE FROM company_candidate_history WHERE company_id=$1`, company)
	})
	t.Run("provenance guard", func(t *testing.T) {
		exec(`UPDATE company_candidates SET updated_at=created_at+interval '1 second' WHERE id=$1`, candidate)
		guard()
		exec(`UPDATE company_candidates SET updated_at=created_at WHERE id=$1`, candidate)
	})
	gooseDownTo(t, db, 43)
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('company_candidate_history') IS NOT NULL`).Scan(&exists); err != nil || exists {
		t.Fatal(exists, err)
	}
	var name string
	if err := pool.QueryRow(ctx, `SELECT full_name FROM company_candidates WHERE id=$1`, candidate).Scan(&name); err != nil || name != "Migration Candidate" {
		t.Fatal(name, err)
	}
	gooseUpTo(t, db, 44)
	if err := pool.QueryRow(ctx, `SELECT version,updated_at,updated_by FROM company_candidates WHERE id=$1`, candidate).Scan(&version, &updated, &by); err != nil || version != 1 || !updated.Equal(created) || by != actor {
		t.Fatal(version, updated, by, err)
	}
}
