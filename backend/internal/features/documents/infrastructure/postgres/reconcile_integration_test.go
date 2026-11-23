//go:build integration

package postgres

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	docstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// Same isolated harness as the other integration tests: loopback draft_test only, embedded migrations,
// every fixture row removed on cleanup.
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

func TestReconcileAgainstDatabase(t *testing.T) {
	pool := reconcileTestPool(t)
	ctx := context.Background()
	root := filepath.Join(t.TempDir(), "documents")
	files, err := docstorage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = files.Close() })

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
		{`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Document reconcile fixture',$2,'technology','active')`, []any{company, uuid.NewString()}},
		{`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Document reconcile fixture','recruiter')`, []any{user, uuid.NewString(), uuid.NewString() + "@example.test"}},
		{`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, []any{draft, company, user}},
		{`INSERT INTO placement_documents(id,company_id,draft_id,name,created_at,created_by) VALUES($1,$2,$3,'Contrato',now(),$4)`, []any{document, company, draft, user}},
	} {
		if _, err = pool.Exec(ctx, fixture.sql, fixture.args...); err != nil {
			t.Fatal(err)
		}
	}
	put := func(content string) string {
		stored, _, err := files.Put(ctx, bytes.NewReader([]byte(content)), 1024)
		if err != nil {
			t.Fatal(err)
		}
		return stored
	}
	referenced, oldOrphan, youngOrphan := put("referenced"), put("old orphan"), put("young orphan")
	if _, err = pool.Exec(ctx, `INSERT INTO placement_document_versions(id,document_id,version,storage_key,content_type,size,uploaded_at,uploaded_by) VALUES($1,$2,1,$3,'application/pdf',10,now(),$4)`, version, document, referenced, user); err != nil {
		t.Fatal(err)
	}
	// Referenced and orphan objects are both old; only the young orphan is inside the grace window.
	old := time.Now().Add(-2 * time.Hour)
	for _, name := range []string{referenced, oldOrphan} {
		if err = os.Chtimes(filepath.Join(root, name), old, old); err != nil {
			t.Fatal(err)
		}
	}
	// A foreign file in the root is never touched.
	if err = os.WriteFile(filepath.Join(root, "notes.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // idempotent
		if err = NewReconciler(pool, files).Reconcile(ctx); err != nil {
			t.Fatal(err)
		}
		objects, err := files.Objects(ctx)
		if err != nil {
			t.Fatal(err)
		}
		got := map[string]bool{}
		for _, o := range objects {
			got[o.Key] = true
		}
		if len(got) != 2 || !got[referenced] || !got[youngOrphan] || got[oldOrphan] {
			t.Fatalf("pass %d: objects=%v", i, got)
		}
		if _, err = os.Stat(filepath.Join(root, "notes.txt")); err != nil {
			t.Fatal("foreign file removed")
		}
	}
	// Once the young orphan ages out it goes too; the referenced file never does.
	if err = os.Chtimes(filepath.Join(root, youngOrphan), old, old); err != nil {
		t.Fatal(err)
	}
	if err = NewReconciler(pool, files).Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	objects, err := files.Objects(ctx)
	if err != nil || len(objects) != 1 || objects[0].Key != referenced {
		t.Fatalf("objects=%v err=%v", objects, err)
	}
}
