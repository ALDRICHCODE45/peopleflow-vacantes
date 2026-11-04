//go:build integration

package main

import (
	"bytes"
	"context"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A unique schema in the guarded draft_test database holds a real audit_events
// table (migrations 00011 and 00056, trigger included), so every command
// connection is isolated and the shared public table is never touched.
func auditFixture(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("DRAFT_TEST_DATABASE_URL required; verification must not skip")
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Path != "/draft_test" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		t.Fatal("isolated loopback draft_test required")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("fixture connection failed")
	}
	schema := "auditpurge_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal("fixture schema failed")
	}
	t.Cleanup(func() {
		_, err := admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		if err != nil {
			t.Error("fixture schema cleanup failed")
		}
	})
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	t.Setenv("DATABASE_URL", u.String())
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal("fixture pool failed")
	}
	t.Cleanup(pool.Close)
	for _, name := range []string{"00011_create_audit_events.sql", "00056_audit_log.sql"} {
		b, err := fs.ReadFile(migrations.MigrationsFS, name)
		if err != nil {
			t.Fatal(err)
		}
		up, _, _ := strings.Cut(string(b), "-- +goose Down")
		if _, err := pool.Exec(ctx, up); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	return pool
}

// seedAge inserts n rows whose occurred_at is the database clock minus age
// (a Postgres interval literal such as '25 months'). It returns their ids.
func seedAge(t *testing.T, p *pgxpool.Pool, age string, n int) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, n)
	for i := range ids {
		ids[i] = uuid.New()
		if _, err := p.Exec(context.Background(),
			`INSERT INTO audit_events(id, occurred_at, actor_type, event_type, entity_type, entity_id)
			 VALUES($1, now() - $2::interval, 'system', 'CompanyDeleted', 'company', $3)`, ids[i], age, uuid.New()); err != nil {
			t.Fatal(err)
		}
	}
	return ids
}

func remaining(t *testing.T, p *pgxpool.Pool) map[uuid.UUID]bool {
	t.Helper()
	rows, err := p.Query(context.Background(), `SELECT id FROM audit_events`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		got[id] = true
	}
	return got
}

func callPurge(batchSize int, args ...string) (int, string, string) {
	var out, stderr bytes.Buffer
	code := runBatch(context.Background(), args, &out, &stderr, batchSize)
	return code, out.String(), stderr.String()
}

func assertKept(t *testing.T, p *pgxpool.Pool, want ...[]uuid.UUID) {
	t.Helper()
	got := remaining(t, p)
	total := 0
	for _, group := range want {
		for _, id := range group {
			total++
			if !got[id] {
				t.Fatalf("row %s was deleted", id)
			}
		}
	}
	if len(got) != total {
		t.Fatalf("remaining rows = %d, want %d", len(got), total)
	}
}

func TestDryRunReportsAndDeletesNothing(t *testing.T) {
	p := auditFixture(t)
	old := seedAge(t, p, "25 months", 3)
	near, recent := seedAge(t, p, "23 months", 2), seedAge(t, p, "1 day", 2)
	for range 2 {
		if code, out, stderr := callPurge(1000); code != 0 || out != "audit_events_would_delete=3\n" || stderr != "" {
			t.Fatalf("dry run: %d %q %q", code, out, stderr)
		}
	}
	assertKept(t, p, old, near, recent)
}

func TestExecuteDeletesOnlyRowsOlderThanRetention(t *testing.T) {
	p := auditFixture(t)
	seedAge(t, p, "25 months", 3)
	near, recent := seedAge(t, p, "23 months", 2), seedAge(t, p, "1 minute", 2)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != "audit_events_deleted=3\n" || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	assertKept(t, p, near, recent)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != "audit_events_deleted=0\n" || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(1000); code != 0 || out != "audit_events_would_delete=0\n" || stderr != "" {
		t.Fatalf("dry run after execute: %d %q %q", code, out, stderr)
	}
	assertKept(t, p, near, recent)
}

func TestExecuteBatchesAcrossMoreThanOneBatch(t *testing.T) {
	p := auditFixture(t)
	seedAge(t, p, "30 months", 7)
	near := seedAge(t, p, "23 months", 2)
	if code, out, stderr := callPurge(3); code != 0 || out != "audit_events_would_delete=7\n" || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != "audit_events_deleted=7\n" || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	assertKept(t, p, near)
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != "audit_events_deleted=0\n" || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
}

func TestEmptyTableAndFixtureCleanup(t *testing.T) {
	p := auditFixture(t)
	seedAge(t, p, "1 day", 1)
	if err := audittest.Delete(context.Background(), p, `DELETE FROM audit_events`); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		args []string
		out  string
	}{{nil, "audit_events_would_delete=0\n"}, {[]string{"-execute"}, "audit_events_deleted=0\n"}} {
		if code, out, stderr := callPurge(1000, tc.args...); code != 0 || out != tc.out || stderr != "" {
			t.Fatalf("empty table %q: %d %q %q", tc.args, code, out, stderr)
		}
	}
}

func TestFailureOutputIsStaticWhenTheTableIsMissing(t *testing.T) {
	p := auditFixture(t)
	if _, err := p.Exec(context.Background(), `DROP TABLE audit_events`); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{nil, {"-execute"}} {
		if code, out, stderr := callPurge(1000, args...); code != 1 || out != "" || stderr != "audit purge failed\n" {
			t.Fatalf("failure %q: %d %q %q", args, code, out, stderr)
		}
	}
}
