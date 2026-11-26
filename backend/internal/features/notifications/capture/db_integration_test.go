//go:build integration

package capture_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

const (
	isolatedDSNEnv = "DRAFT_TEST_DATABASE_URL"
	isolatedDBName = "draft_test"
)

// disposableDB follows the migration-test pattern: the guarded loopback
// draft_test DSN only creates a unique draft_test_mig_* database, migrated to
// the latest version, and dropped at cleanup. The shared harness is never
// touched, so capture rows and goose rollbacks need no fixture cleanup.
func disposableDB(t *testing.T) (*pgxpool.Pool, *sql.DB) {
	t.Helper()
	dsn := os.Getenv(isolatedDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated notifications test", isolatedDSNEnv)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", isolatedDSNEnv, err)
	}
	if cfg.ConnConfig.Database != isolatedDBName || !loopback(cfg.ConnConfig.Host) {
		t.Fatal("notifications integration tests require loopback + draft_test as the bootstrap database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	admin, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	name := "draft_test_mig_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	cfg = cfg.Copy()
	cfg.ConnConfig.Database = name
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatalf("create disposable database (CREATEDB required): %v", err)
	}
	var pool *pgxpool.Pool
	var sqlDB *sql.DB
	t.Cleanup(func() {
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
		if pool != nil {
			pool.Close()
		}
		stopCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		if _, err := admin.Exec(stopCtx, "DROP DATABASE "+quoted); err != nil {
			t.Errorf("drop disposable database %s: %v", name, err)
		}
	})
	if pool, err = pgxpool.NewWithConfig(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	sqlDB = stdlib.OpenDBFromPool(pool)
	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, sqlDB, "."); err != nil {
		t.Fatalf("migrate disposable database: %v", err)
	}
	return pool, sqlDB
}

func loopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1", "[::1]":
		return true
	}
	return false
}

func mustExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func tableExists(t *testing.T, pool *pgxpool.Pool, table string) bool {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	return exists
}

// fixture is one company with a recruiter and a candidate holding an organic
// participation on a published process (the discard has_message read needs a
// real participation row).
type fixture struct {
	company, recruiter, candidate, job, participation uuid.UUID
}

func newFixture(t *testing.T, pool *pgxpool.Pool) fixture {
	t.Helper()
	f := fixture{company: uuid.New(), recruiter: uuid.New(), job: uuid.New()}
	mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Recruiter','recruiter')`, f.recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Notif Test',$2,'technology','active')`, f.company, uuid.NewString())
	mustExec(t, pool, `INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, f.job, f.company, f.recruiter)
	mustExec(t, pool, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, f.job, f.company, f.recruiter)
	f.candidate, f.participation = addParticipation(t, pool, f.job)
	return f
}

// addParticipation adds a new candidate account with an organic participation on job.
func addParticipation(t *testing.T, pool *pgxpool.Pool, job uuid.UUID) (candidate, participation uuid.UUID) {
	t.Helper()
	candidate, participation, cv := uuid.New(), uuid.New(), uuid.New()
	mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test")
	mustExec(t, pool, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	mustExec(t, pool, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`,
		participation, job, candidate, uuid.New(), cv)
	return candidate, participation
}
