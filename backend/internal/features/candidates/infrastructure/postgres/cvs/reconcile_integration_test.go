//go:build integration

package cvs

import (
	"context"
	"io"
	"os"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// Match the existing isolated integration harness: no database creation, only
// embedded migrations on loopback draft_test, with every fixture row cleaned up.
func reconcileTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if testing.Short() {
		t.Skip("isolated database test")
	}
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRAFT_TEST_DATABASE_URL not set; isolated database execution skipped")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid isolated database configuration")
	}
	if cfg.ConnConfig.Database != "draft_test" || (cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "::1") {
		t.Fatal("refusing non-loopback or non-draft_test database")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal("isolated database connection failed")
	}
	t.Cleanup(pool.Close)
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.MigrationsFS)
	if err != nil {
		t.Fatal("migration provider failed")
	}
	if _, err = provider.Up(context.Background()); err != nil {
		t.Fatal("isolated migrations failed")
	}
	return pool
}

func TestReconcileRetainsCompanyOwnedManualCV(t *testing.T) {
	pool := reconcileTestPool(t)
	ctx := context.Background()
	files, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := files.Close(); err != nil {
			t.Error(err)
		}
	})
	company, cv := uuid.New(), uuid.New()
	// Registered after pool cleanup, hence runs first (LIFO). This fixture has
	// no candidate identity: organic reuse must be retained by company ownership.
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `DELETE FROM company_candidate_cvs WHERE id=$1`, cv); err != nil {
			t.Error(err)
		}
		if _, err := pool.Exec(context.Background(), `DELETE FROM companies WHERE id=$1`, company); err != nil {
			t.Error(err)
		}
	})
	if _, err = pool.Exec(ctx, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'CV retention fixture',$2,'technology','active')`, company, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	content := []byte("%PDF-1 company-private manual intake")
	key, err := files.Put(ctx, content)
	if err != nil {
		t.Fatal(err)
	}
	orphan, err := files.Put(ctx, []byte("%PDF-1 orphan"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,NULL,$3,$4,'application/pdf','manual.pdf')`, cv, company, key, len(content)); err != nil {
		t.Fatal(err)
	}
	library := NewLibrary(pool, files)
	for i := 0; i < 2; i++ {
		if err = library.Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
		file, err := files.Open(ctx, key)
		if err != nil {
			t.Fatalf("company-owned CV removed: %v", err)
		}
		got, readErr := io.ReadAll(file)
		closeErr := file.Close()
		if readErr != nil || closeErr != nil || string(got) != string(content) {
			t.Fatalf("manual CV changed: read=%v close=%v", readErr, closeErr)
		}
	}
	keys, err := files.Keys(ctx)
	if err != nil || len(keys) != 1 || keys[0] != key {
		t.Fatalf("reconciliation keys=%v error=%v (orphan %s)", keys, err, orphan)
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM company_candidate_cvs WHERE id=$1 AND company_candidate_id IS NULL`, cv).Scan(&count); err != nil || count != 1 {
		t.Fatalf("CV metadata changed: count=%d error=%v", count, err)
	}
}
