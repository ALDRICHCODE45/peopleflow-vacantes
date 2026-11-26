//go:build integration

package schedule

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

// disposableDB mirrors the capture package helper: the guarded loopback
// draft_test DSN only creates a unique draft_test_mig_* database, migrated to
// the latest version and dropped at cleanup; the shared harness is untouched.
func disposableDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv(isolatedDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated notifications test", isolatedDSNEnv)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", isolatedDSNEnv, err)
	}
	switch host := cfg.ConnConfig.Host; {
	case cfg.ConnConfig.Database != isolatedDBName, host != "localhost" && host != "127.0.0.1" && host != "::1":
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
	return pool
}

func mustExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}
