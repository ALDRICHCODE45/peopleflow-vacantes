//go:build integration

package draftstore

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// requireMigrationPool never rolls back the shared harness database. Each caller
// owns a fresh database and drops only that database after fixture cleanup.
func requireMigrationPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv(isolatedDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated migration test", isolatedDSNEnv)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", isolatedDSNEnv, err)
	}
	if cfg.ConnConfig.Database != isolatedDBName || !isLoopback(cfg.ConnConfig.Host) {
		t.Fatal("migration tests require loopback + draft_test as the bootstrap database")
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
	if !isLoopback(cfg.ConnConfig.Host) || !strings.HasPrefix(name, "draft_test_") || name == isolatedDBName {
		t.Fatal("refusing unsafe disposable database")
	}
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatalf("create migration database (CREATEDB required): %v", err)
	}
	var pool *pgxpool.Pool
	t.Cleanup(func() {
		if pool != nil {
			pool.Close()
		}
		cleanupCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanupCtx, "DROP DATABASE "+quoted); err != nil {
			t.Errorf("drop owned migration database %s: %v", name, err)
		}
	})
	pool, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyEmbeddedMigrations(ctx, pool); err != nil {
		t.Fatalf("migrate disposable database: %v", err)
	}
	return pool
}
