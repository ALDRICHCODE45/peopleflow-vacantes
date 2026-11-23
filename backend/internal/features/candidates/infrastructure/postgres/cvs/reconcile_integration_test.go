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

// D25 of docs/contracts/placement-vacancy-documents-v1.md: a document file must survive CV reconciliation even if the
// two storages were ever pointed at the same root; a file no row references is still removed.
func TestReconcileRetainsPlacementDocumentFile(t *testing.T) {
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
	company, user, draft, document, version := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	t.Cleanup(func() {
		for _, q := range []struct{ sql, id string }{
			{`DELETE FROM placement_document_versions WHERE id=$1`, version.String()},
			{`DELETE FROM placement_documents WHERE id=$1`, document.String()},
			{`DELETE FROM job_drafts WHERE id=$1`, draft.String()},
			{`DELETE FROM users WHERE id=$1`, user.String()},
			{`DELETE FROM companies WHERE id=$1`, company.String()},
		} {
			if _, err := pool.Exec(context.Background(), q.sql, q.id); err != nil {
				t.Error(err)
			}
		}
	})
	for _, fixture := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Document retention fixture',$2,'technology','active')`, []any{company, uuid.NewString()}},
		{`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Document retention fixture','recruiter')`, []any{user, uuid.NewString(), uuid.NewString() + "@example.test"}},
		{`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, []any{draft, company, user}},
		{`INSERT INTO placement_documents(id,company_id,draft_id,name,created_at,created_by) VALUES($1,$2,$3,'Contrato',now(),$4)`, []any{document, company, draft, user}},
	} {
		if _, err = pool.Exec(ctx, fixture.sql, fixture.args...); err != nil {
			t.Fatal(err)
		}
	}
	kept, err := files.Put(ctx, []byte("%PDF-1 placement document"))
	if err != nil {
		t.Fatal(err)
	}
	orphan, err := files.Put(ctx, []byte("%PDF-1 orphan"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO placement_document_versions(id,document_id,version,storage_key,content_type,size,uploaded_at,uploaded_by) VALUES($1,$2,1,$3,'application/pdf',25,now(),$4)`, version, document, kept, user); err != nil {
		t.Fatal(err)
	}
	if err = NewLibrary(pool, files).Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	remaining, err := files.Keys(ctx)
	if err != nil || len(remaining) != 1 || remaining[0] != kept {
		t.Fatalf("keys=%v error=%v (orphan %s)", remaining, err, orphan)
	}
}
