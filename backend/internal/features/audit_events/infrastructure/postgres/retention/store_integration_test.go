//go:build integration

package retention

import (
	"context"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A unique schema in the guarded draft_test database holds a real audit_events
// table (migrations 00011 and 00056, trigger included). A recorder trigger
// logs the transaction id of every row the purge deletes.
func retentionFixture(t *testing.T) *pgxpool.Pool {
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
	schema := "auditretention_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	// "zz_" sorts after audit_events_append_only, so a row is recorded only
	// when the append-only trigger let the delete through.
	if _, err := pool.Exec(ctx, `CREATE TABLE purge_log(id uuid, txid text);
CREATE FUNCTION record_purge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO purge_log VALUES (OLD.id, txid_current()::text); RETURN OLD; END $$;
CREATE TRIGGER zz_record_purge BEFORE DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION record_purge();`); err != nil {
		t.Fatal(err)
	}
	return pool
}

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

func count(t *testing.T, p *pgxpool.Pool, query string) int {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), query).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCountExpiredIgnoresRowsInsideRetentionAndDeletesNothing(t *testing.T) {
	p := retentionFixture(t)
	seedAge(t, p, "25 months", 4)
	seedAge(t, p, "24 months 1 hour", 1)
	seedAge(t, p, "23 months", 3)
	seedAge(t, p, "24 months -1 hour", 1)
	seedAge(t, p, "1 minute", 2)
	s := NewStore(p, DefaultBatchSize)
	n, err := s.CountExpired(context.Background())
	if err != nil || n != 5 {
		t.Fatalf("CountExpired = %d, %v; want 5", n, err)
	}
	if got := count(t, p, `SELECT count(*) FROM audit_events`); got != 11 {
		t.Fatalf("rows after count = %d, want 11", got)
	}
}

func TestDeleteExpiredBatchesEachInItsOwnTransaction(t *testing.T) {
	p := retentionFixture(t)
	seedAge(t, p, "26 months", 7)
	keep := append(seedAge(t, p, "23 months", 2), seedAge(t, p, "1 day", 2)...)
	s := NewStore(p, 3)
	n, err := s.DeleteExpired(context.Background())
	if err != nil || n != 7 {
		t.Fatalf("DeleteExpired = %d, %v; want 7", n, err)
	}
	if got := count(t, p, `SELECT count(*) FROM purge_log`); got != 7 {
		t.Fatalf("recorded deletions = %d, want 7", got)
	}
	// 7 rows in batches of 3 = 3 transactions (3 + 3 + 1).
	if got := count(t, p, `SELECT count(DISTINCT txid) FROM purge_log`); got != 3 {
		t.Fatalf("distinct purge transactions = %d, want 3", got)
	}
	if got := count(t, p, `SELECT max(c)::int FROM (SELECT count(*) c FROM purge_log GROUP BY txid) b`); got != 3 {
		t.Fatalf("largest batch = %d, want 3", got)
	}
	for _, id := range keep {
		if got := count(t, p, `SELECT count(*) FROM audit_events WHERE id = '`+id.String()+`'`); got != 1 {
			t.Fatalf("row %s inside retention was deleted", id)
		}
	}
	n, err = s.DeleteExpired(context.Background())
	if err != nil || n != 0 {
		t.Fatalf("second DeleteExpired = %d, %v; want 0", n, err)
	}
}

func TestDeleteExpiredOldestFirstWithinABatch(t *testing.T) {
	p := retentionFixture(t)
	// The oldest row is inserted last, so heap order cannot fake the ordering.
	seedAge(t, p, "30 months", 2)
	oldest := seedAge(t, p, "40 months", 1)[0]
	s := NewStore(p, 1)
	if n, err := s.DeleteExpired(context.Background()); err != nil || n != 3 {
		t.Fatalf("DeleteExpired = %d, %v; want 3", n, err)
	}
	var first uuid.UUID
	if err := p.QueryRow(context.Background(), `SELECT (array_agg(l.id))[1] FROM (SELECT id FROM purge_log ORDER BY ctid) l`).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if first != oldest {
		t.Fatalf("first deleted row = %s, want the oldest %s", first, oldest)
	}
}

func TestNonPositiveBatchSizeFallsBackToDefault(t *testing.T) {
	p := retentionFixture(t)
	seedAge(t, p, "25 months", 5)
	for _, size := range []int{0, -1} {
		s := NewStore(p, size)
		if n, err := s.CountExpired(context.Background()); err != nil || n != 5 {
			t.Fatalf("size %d CountExpired = %d, %v", size, n, err)
		}
	}
	if n, err := NewStore(p, 0).DeleteExpired(context.Background()); err != nil || n != 5 {
		t.Fatalf("DeleteExpired = %d, %v; want 5", n, err)
	}
	if got := count(t, p, `SELECT count(DISTINCT txid) FROM purge_log`); got != 1 {
		t.Fatalf("one default-size batch expected, got %d transactions", got)
	}
}

func TestErrorsAreReturnedWhenTheTableIsMissing(t *testing.T) {
	p := retentionFixture(t)
	if _, err := p.Exec(context.Background(), `DROP TABLE audit_events`); err != nil {
		t.Fatal(err)
	}
	s := NewStore(p, 3)
	if _, err := s.CountExpired(context.Background()); err == nil {
		t.Fatal("CountExpired succeeded without a table")
	}
	if _, err := s.DeleteExpired(context.Background()); err == nil {
		t.Fatal("DeleteExpired succeeded without a table")
	}
}
