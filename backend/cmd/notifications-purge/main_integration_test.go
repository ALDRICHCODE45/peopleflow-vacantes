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

func dry(n, e, d int) string  { return outLines("would_delete", n, e, d) }
func done(n, e, d int) string { return outLines("deleted", n, e, d) }
func outLines(verb string, n, e, d int) string {
	return "notifications_" + verb + "=" + strconv.Itoa(n) + "\nnotification_events_" + verb + "=" + strconv.Itoa(e) +
		"\nnotification_email_deliveries_" + verb + "=" + strconv.Itoa(d) + "\n"
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
		if code, out, stderr := callPurge(1000); code != 0 || out != dry(3, 3, 0) || stderr != "" {
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
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(3, 3, 0) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", keptN...)
	f.assertKept(t, "notification_events", keptE...)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(0, 0, 0) || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(1000); code != 0 || out != dry(0, 0, 0) || stderr != "" {
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
	if code, out, stderr := callPurge(3); code != 0 || out != dry(7, 7, 0) || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != done(7, 7, 0) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", nearN)
	f.assertKept(t, "notification_events", nearE, pending)
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != done(0, 0, 0) || stderr != "" {
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

	if code, out, stderr := callPurge(1000); code != 0 || out != dry(1, 1, 0) || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(1, 1, 0) || stderr != "" {
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
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(1, 1, 0) || stderr != "" {
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
	if code, out, stderr := callPurge(1, "-execute"); code != 0 || out != done(0, 2, 0) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", keep)
	f.assertKept(t, "notification_events", []uuid.UUID{fresh})
}

func TestFailureOutputIsStaticWhenATableIsMissing(t *testing.T) {
	for _, table := range []string{"notifications", "notification_events", "notification_email_deliveries"} {
		f := purgeFixture(t)
		f.exec(t, `DROP TABLE `+table+` CASCADE`)
		for _, args := range [][]string{nil, {"-execute"}} {
			if code, out, stderr := callPurge(1000, args...); code != 1 || out != "" || stderr != "notifications purge failed\n" {
				t.Fatalf("failure without %s %q: %d %q %q", table, args, code, out, stderr)
			}
		}
	}
}

// delivery inserts a member notification_email_deliveries row created age ago
// (a Postgres interval) in the given status, with the columns each status's
// CHECK requires (sent_at, skip_reason, next_attempt_at, lease_until).
func (f *fixture) delivery(t *testing.T, age, status string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	f.exec(t, `INSERT INTO notification_email_deliveries(id,recipient_user_id,recipient_kind,company_id,type,group_key,job_id,
			status,skip_reason,send_after,attempts,next_attempt_at,lease_until,error_class,sent_at,created_at,updated_at)
		VALUES($1,$2,'member',$3,'delivery_overdue',$4,$5,
			$6::text,
			CASE WHEN $6::text = 'skipped' THEN 'resolved' END,
			now()-$7::interval,
			CASE WHEN $6::text = 'pending' THEN 0 ELSE 1 END,
			CASE WHEN $6::text = 'retry' THEN now()+interval '1 minute' END,
			CASE WHEN $6::text = 'sending' THEN now()+interval '2 minutes' END,
			CASE WHEN $6::text IN ('failed','retry') THEN 'transient' END,
			CASE WHEN $6::text = 'sent' THEN now()-$7::interval END,
			now()-$7::interval, now()-$7::interval)`,
		id, f.user, f.company, "d:"+id.String(), uuid.New(), status, age)
	return id
}

func (f *fixture) deliveries(t *testing.T, age, status string, n int) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, n)
	for i := range ids {
		ids[i] = f.delivery(t, age, status)
	}
	return ids
}

// link points notification n at delivery d (notifications.email_delivery_id).
func (f *fixture) link(t *testing.T, n, d uuid.UUID) {
	t.Helper()
	f.exec(t, `UPDATE notifications SET email_delivery_id=$2 WHERE id=$1`, n, d)
}

func (f *fixture) linkedDelivery(t *testing.T, n uuid.UUID) *uuid.UUID {
	t.Helper()
	var d *uuid.UUID
	if err := f.pool.QueryRow(context.Background(), `SELECT email_delivery_id FROM notifications WHERE id=$1`, n).Scan(&d); err != nil {
		t.Fatal(err)
	}
	return d
}

var (
	terminalStatuses    = []string{"sent", "skipped", "failed"}
	nonTerminalStatuses = []string{"pending", "retry", "sending"}
)

// seedDeliveries seeds every status on both sides of the 180 day cutoff and
// returns the rows that must survive: terminal rows inside the retention and
// every pending, retry or sending row whatever its age (notifications-v2 D20).
func seedDeliveries(t *testing.T, f *fixture) (expired int, kept [][]uuid.UUID) {
	t.Helper()
	for _, status := range terminalStatuses {
		expired += len(f.deliveries(t, "181 days", status, 2))
		expired += len(f.deliveries(t, "3 years", status, 1))
		kept = append(kept, f.deliveries(t, "179 days", status, 1), f.deliveries(t, "1 minute", status, 1))
	}
	for _, status := range nonTerminalStatuses {
		kept = append(kept, f.deliveries(t, "400 days", status, 1), f.deliveries(t, "181 days", status, 1),
			f.deliveries(t, "1 minute", status, 1))
	}
	return expired, kept
}

func TestDeliveriesDryRunReportsTerminalRowsAndDeletesNothing(t *testing.T) {
	f := purgeFixture(t)
	expired, _ := seedDeliveries(t, f)
	all := f.ids(t, "notification_email_deliveries")
	if expired != 9 || len(all) != 9+6+9 {
		t.Fatalf("seeded %d expired of %d deliveries", expired, len(all))
	}
	for range 2 {
		if code, out, stderr := callPurge(1000); code != 0 || out != dry(0, 0, 9) || stderr != "" {
			t.Fatalf("dry run: %d %q %q", code, out, stderr)
		}
	}
	f.assertKept(t, "notification_email_deliveries", keys(all))
}

func TestExecuteDeletesOnlyTerminalDeliveriesOlderThanRetention(t *testing.T) {
	f := purgeFixture(t)
	_, kept := seedDeliveries(t, f)
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(0, 0, 9) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notification_email_deliveries", kept...)
	var remaining []string
	rows, err := f.pool.Query(context.Background(), `SELECT DISTINCT status FROM notification_email_deliveries
		WHERE created_at < now() - interval '180 days' ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	if remaining, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
		t.Fatal(err)
	}
	if strings.Join(remaining, ",") != "pending,retry,sending" {
		t.Fatalf("old statuses left = %v, want only the non-terminal ones", remaining)
	}
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(0, 0, 0) || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(1000); code != 0 || out != dry(0, 0, 0) || stderr != "" {
		t.Fatalf("dry run after execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notification_email_deliveries", kept...)
}

func TestExecuteDeletesDeliveriesAcrossMoreThanOneBatch(t *testing.T) {
	f := purgeFixture(t)
	for _, status := range terminalStatuses {
		f.deliveries(t, "200 days", status, 3)
	}
	near := f.deliveries(t, "179 days", "sent", 2)
	open := f.deliveries(t, "300 days", "retry", 4)
	f.notifications(t, "200 days", 4)
	if code, out, stderr := callPurge(3); code != 0 || out != dry(4, 0, 9) || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != done(4, 0, 9) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notification_email_deliveries", near, open)
	f.assertKept(t, "notifications")
	if code, out, stderr := callPurge(3, "-execute"); code != 0 || out != done(0, 0, 0) || stderr != "" {
		t.Fatalf("second execute: %d %q %q", code, out, stderr)
	}
}

// Notifications go first, so an expired delivery's expired notifications are
// already gone; a notification still inside the retention that links an
// expired terminal delivery (coalescing links rows up to the window close
// after the delivery's created_at) stays valid with email_delivery_id NULL
// (ON DELETE SET NULL). Links to kept deliveries are untouched.
func TestLinkedNotificationsStayValidWhenTheirDeliveryIsPurged(t *testing.T) {
	f := purgeFixture(t)
	var action string
	if err := f.pool.QueryRow(context.Background(), `SELECT confdeltype::text FROM pg_constraint
		WHERE conrelid = 'notifications'::regclass AND confrelid = 'notification_email_deliveries'::regclass AND contype = 'f'`).Scan(&action); err != nil {
		t.Fatal(err)
	}
	if action != "n" {
		t.Fatalf("notifications.email_delivery_id ON DELETE action = %q, want SET NULL (n)", action)
	}

	expired := f.delivery(t, "181 days", "sent")
	oldLinked := f.notification(t, "181 days", nil)
	recentLinked := f.notification(t, "179 days", nil)
	f.link(t, oldLinked, expired)
	f.link(t, recentLinked, expired)

	openOld := f.delivery(t, "181 days", "retry")
	openLinked := f.notification(t, "179 days", nil)
	f.link(t, openLinked, openOld)

	fresh := f.delivery(t, "1 day", "sent")
	freshLinked := f.notification(t, "1 day", nil)
	f.link(t, freshLinked, fresh)

	if code, out, stderr := callPurge(1000); code != 0 || out != dry(1, 0, 1) || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if got := f.linkedDelivery(t, recentLinked); got == nil || *got != expired {
		t.Fatalf("dry run changed the link: %v", got)
	}
	if code, out, stderr := callPurge(1000, "-execute"); code != 0 || out != done(1, 0, 1) || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notifications", []uuid.UUID{recentLinked, openLinked, freshLinked})
	f.assertKept(t, "notification_email_deliveries", []uuid.UUID{openOld, fresh})
	if got := f.linkedDelivery(t, recentLinked); got != nil {
		t.Fatalf("email_delivery_id = %v, want NULL", got)
	}
	if got := f.linkedDelivery(t, openLinked); got == nil || *got != openOld {
		t.Fatalf("open delivery link = %v, want %s", got, openOld)
	}
	if got := f.linkedDelivery(t, freshLinked); got == nil || *got != fresh {
		t.Fatalf("fresh delivery link = %v, want %s", got, fresh)
	}
	var dangling int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications n
		WHERE n.email_delivery_id IS NOT NULL
		  AND NOT EXISTS (SELECT 1 FROM notification_email_deliveries d WHERE d.id = n.email_delivery_id)`).Scan(&dangling); err != nil {
		t.Fatal(err)
	}
	if dangling != 0 {
		t.Fatalf("%d notifications reference a missing delivery", dangling)
	}
}

// A terminal delivery another connection holds is skipped, not waited for,
// and goes on a later run.
func TestExecuteSkipsLockedDeliveries(t *testing.T) {
	f := purgeFixture(t)
	held := f.delivery(t, "181 days", "failed")
	f.deliveries(t, "181 days", "sent", 2)
	ctx := context.Background()
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT 1 FROM notification_email_deliveries WHERE id=$1 FOR UPDATE`, held); err != nil {
		t.Fatal(err)
	}
	runCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var out, stderr bytes.Buffer
	if code := runBatch(runCtx, []string{"-execute"}, &out, &stderr, 1); code != 0 || out.String() != done(0, 0, 2) || stderr.Len() != 0 {
		t.Fatalf("execute with a held row: %d %q %q", code, out.String(), stderr.String())
	}
	f.assertKept(t, "notification_email_deliveries", []uuid.UUID{held})
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if code, out, stderr := callPurge(1, "-execute"); code != 0 || out != done(0, 0, 1) || stderr != "" {
		t.Fatalf("execute after release: %d %q %q", code, out, stderr)
	}
	f.assertKept(t, "notification_email_deliveries")
}
