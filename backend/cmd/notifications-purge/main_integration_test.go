//go:build integration

package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// fixture is one migrated draft_test_mig_* database created from the guarded
// loopback draft_test DSN (DRAFT_TEST_DATABASE_URL only) and dropped at
// cleanup. DATABASE_URL is pointed at it for the command, so the sourced dev
// DATABASE_URL is never used and the shared draft_test database is untouched.
type fixture struct {
	pool    *pgxpool.Pool
	user    uuid.UUID
	company uuid.UUID
}

func purgeFixture(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("DRAFT_TEST_DATABASE_URL required; verification must not skip")
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Path != "/draft_test" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		t.Fatal("isolated loopback draft_test required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("fixture connection failed")
	}
	t.Cleanup(admin.Close)
	name := "draft_test_mig_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatal("create disposable database failed (CREATEDB required)")
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
		if _, err := admin.Exec(stopCtx, "DROP DATABASE "+quoted+" WITH (FORCE)"); err != nil {
			t.Error("drop disposable database failed")
		}
	})
	u.Path = "/" + name
	t.Setenv("DATABASE_URL", u.String())
	if pool, err = pgxpool.New(ctx, u.String()); err != nil {
		t.Fatal("fixture pool failed")
	}
	sqlDB = stdlib.OpenDBFromPool(pool)
	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, sqlDB, "."); err != nil {
		t.Fatalf("migrate disposable database: %v", err)
	}
	f := &fixture{pool: pool, user: uuid.New(), company: uuid.New()}
	f.exec(t, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Recruiter','recruiter')`, f.user, uuid.NewString(), uuid.NewString()+"@example.test")
	f.exec(t, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Purge Test',$2,'technology','active')`, f.company, uuid.NewString())
	return f
}

func (f *fixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// event inserts a notification_events row that occurred occurredAge ago (a
// Postgres interval) and was processed processedAge ago; processedAge "" keeps
// it pending. failed marks a given-up event (processed too).
func (f *fixture) event(t *testing.T, occurredAge, processedAge string, failed bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var processed any
	if processedAge != "" {
		processed = processedAge
	}
	f.exec(t, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id,occurred_at,processed_at,failed)
		VALUES($1,$2,$3,'VacancyApplicationSubmitted',$4,now()-$5::interval,now()-$6::interval,$7)`,
		id, uuid.New(), f.company, uuid.New(), occurredAge, processed, failed)
	return id
}

func (f *fixture) events(t *testing.T, occurredAge, processedAge string, n int) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, n)
	for i := range ids {
		ids[i] = f.event(t, occurredAge, processedAge, false)
	}
	return ids
}

// notification inserts a member row created age ago. With a source event it
// is an immediate application_received row; without one a scheduled
// delivery_overdue row (each on its own job, so the dedupe never collides).
func (f *fixture) notification(t *testing.T, age string, source *uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if source != nil {
		f.exec(t, `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,source_event_id,created_at)
			VALUES($1,$2,'member','team',$3,'application_received',$4,$5,$6,now()-$7::interval)`,
			id, f.user, f.company, "n:"+id.String(), uuid.New(), *source, age)
		return id
	}
	f.exec(t, `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,commitment_date,created_at)
		VALUES($1,$2,'member','team',$3,'delivery_overdue',$4,$5,current_date,now()-$6::interval)`,
		id, f.user, f.company, "n:"+id.String(), uuid.New(), age)
	return id
}

func (f *fixture) notifications(t *testing.T, age string, n int) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, n)
	for i := range ids {
		ids[i] = f.notification(t, age, nil)
	}
	return ids
}

func (f *fixture) ids(t *testing.T, table string) map[uuid.UUID]bool {
	t.Helper()
	rows, err := f.pool.Query(context.Background(), `SELECT id FROM `+table)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		t.Fatal(err)
	}
	set := map[uuid.UUID]bool{}
	for _, id := range got {
		set[id] = true
	}
	return set
}

func (f *fixture) assertKept(t *testing.T, table string, want ...[]uuid.UUID) {
	t.Helper()
	got := f.ids(t, table)
	total := 0
	for _, group := range want {
		for _, id := range group {
			total++
			if !got[id] {
				t.Fatalf("%s row %s was deleted", table, id)
			}
		}
	}
	if len(got) != total {
		t.Fatalf("%s remaining rows = %d, want %d", table, len(got), total)
	}
}

func callPurge(batchSize int, args ...string) (int, string, string) {
	var out, stderr bytes.Buffer
	code := runBatch(context.Background(), args, &out, &stderr, batchSize)
	return code, out.String(), stderr.String()
}

func dry(n, e int) string  { return outLines("would_delete", n, e) }
func done(n, e int) string { return outLines("deleted", n, e) }
func outLines(verb string, n, e int) string {
	return "notifications_" + verb + "=" + strconv.Itoa(n) + "\nnotification_events_" + verb + "=" + strconv.Itoa(e) + "\n"
}

// seedMixed seeds both tables on both sides of the 180 day cutoff, including
// pending and given-up events. It returns the rows that must survive.
func seedMixed(t *testing.T, f *fixture) (keptN, keptE [][]uuid.UUID) {
	t.Helper()
	f.notifications(t, "181 days", 3)
	nearN, recentN := f.notifications(t, "179 days", 2), f.notifications(t, "1 minute", 2)
	f.events(t, "200 days", "181 days", 2)
	f.event(t, "200 days", "190 days", true) // given up after 10 attempts: processed, purged
	nearE, recentE := f.events(t, "200 days", "179 days", 2), f.events(t, "1 day", "1 minute", 1)
	pendingOld := []uuid.UUID{f.event(t, "400 days", "", false), f.event(t, "181 days", "", false)}
	return [][]uuid.UUID{nearN, recentN}, [][]uuid.UUID{nearE, recentE, pendingOld}
}

func TestDryRunReportsAndDeletesNothing(t *testing.T) {
	f := purgeFixture(t)
	seedMixed(t, f)
	allN, allE := f.ids(t, "notifications"), f.ids(t, "notification_events")
	if len(allN) != 7 || len(allE) != 8 {
		t.Fatalf("seeded %d notifications, %d events", len(allN), len(allE))
	}
	for range 2 {
		if code, out, stderr := callPurge(1000); code != 0 || out != dry(3, 3) || stderr != "" {
			t.Fatalf("dry run: %d %q %q", code, out, stderr)
		}
	}
	f.assertKept(t, "notifications", keys(allN))
	f.assertKept(t, "notification_events", keys(allE))
}

func keys(set map[uuid.UUID]bool) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	return out
}

func TestExecuteDeletesOnlyRowsOlderThanRetention(t *testing.T) {
	f := purgeFixture(t)
	keptN, keptE := seedMixed(t, f)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(3, 3) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", keptN...)
	f.assertKept(t, "notification_events", keptE...)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(0, 0) || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(1000); code != 0 || out != dry(0, 0) || stderr != "" {
		t.Fatalf("dry run after execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", keptN...)
	f.assertKept(t, "notification_events", keptE...)
}

func TestExecuteBatchesAcrossMoreThanOneBatch(t *testing.T) {
	f := purgeFixture(t)
	f.notifications(t, "200 days", 7)
	f.events(t, "300 days", "200 days", 7)
	nearN, nearE := f.notifications(t, "179 days", 2), f.events(t, "300 days", "179 days", 2)
	pending := f.events(t, "300 days", "", 4)
	if code, out, stderr := callPurge(3); code != 0 || out != dry(7, 7) || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != done(7, 7) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", nearN)
	f.assertKept(t, "notification_events", nearE, pending)
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != done(0, 0) || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
}

// An expired event whose notification is still inside the retention is kept:
// the ON DELETE SET NULL action would violate the notifications CHECK
// «source_event_id IS NULL iff scheduled type» for immediate rows, failing the
// batch. The event goes on the run after its last notification expires.
func TestEventsReferencedByRemainingNotificationsAreKept(t *testing.T) {
	f := purgeFixture(t)
	shared := f.event(t, "200 days", "181 days", false)
	recent := f.notification(t, "10 days", &shared)
	oldOnly := f.event(t, "200 days", "181 days", false)
	f.notification(t, "181 days", &oldOnly) // expires in the same run, first

	var pgErr *pgconn.PgError
	_, err := f.pool.Exec(context.Background(), `DELETE FROM notification_events WHERE id=$1`, shared)
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("SET NULL on an immediate notification must violate its CHECK, got %v", err)
	}

	if code, out, stderr := callPurge(1000); code != 0 || out != dry(1, 1) || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(1, 1) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", []uuid.UUID{recent})
	f.assertKept(t, "notification_events", []uuid.UUID{shared})
	var source *uuid.UUID
	if err := f.pool.QueryRow(context.Background(), `SELECT source_event_id FROM notifications WHERE id=$1`, recent).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source == nil || *source != shared {
		t.Fatalf("source_event_id = %v, want %s", source, shared)
	}

	f.exec(t, `UPDATE notifications SET created_at = now() - interval '181 days' WHERE id=$1`, recent)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(1, 1) || stderr != "" {
		t.Fatalf("execute after expiry: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications")
	f.assertKept(t, "notification_events")
}

// A scheduled notification has no source event, and an unrelated recent
// notification does not hold back an expired event it does not reference.
func TestUnreferencedExpiredEventsGoEvenWithRecentNotifications(t *testing.T) {
	f := purgeFixture(t)
	f.events(t, "200 days", "181 days", 2)
	fresh := f.event(t, "1 day", "1 day", false)
	keep := []uuid.UUID{f.notification(t, "1 day", &fresh), f.notification(t, "1 day", nil)}
	if code, out, stderr := callPurge(1, "-execute"); code != 0 || out != done(0, 2) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", keep)
	f.assertKept(t, "notification_events", []uuid.UUID{fresh})
}

func TestFailureOutputIsStaticWhenATableIsMissing(t *testing.T) {
	for _, table := range []string{"notifications", "notification_events"} {
		f := purgeFixture(t)
		f.exec(t, `DROP TABLE `+table+` CASCADE`)
		for _, args := range [][]string{nil, {"-execute"}} {
			if code, out, stderr := callPurge(1000, args...); code != 1 || out != "" || stderr != "notifications purge failed\n" {
				t.Fatalf("failure without %s %q: %d %q %q", table, args, code, out, stderr)
			}
		}
	}
}
