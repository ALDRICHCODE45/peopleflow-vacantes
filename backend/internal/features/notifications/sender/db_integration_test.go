//go:build integration

package sender

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/unsubscribe"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

const (
	isolatedDSNEnv = "DRAFT_TEST_DATABASE_URL"
	isolatedDBName = "draft_test"
	// senderAppName tags the sender's own connections in pg_stat_activity.
	senderAppName = "pf_notif_sender_test"
	testTitle     = "Analista de datos"
)

// disposableDB mirrors the fan-out helper: the guarded loopback draft_test
// DSN only creates a unique draft_test_mig_* database, migrated to the latest
// version and dropped at cleanup.
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

// senderPool is a second pool on the same database whose connections carry
// application_name = senderAppName, so a probe can tell the sender's backends
// apart. Closed before the database is dropped (cleanups run LIFO).
func senderPool(t *testing.T, pool *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	cfg := pool.Config().Copy()
	cfg.ConnConfig.RuntimeParams["application_name"] = senderAppName
	p, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

func mustExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

// world is one company with a titled job: an owner, a recruiter on the team,
// a candidate with an organic participation; every user has a distinct address.
type world struct {
	company, job, owner, recruiter, candidate, participation uuid.UUID
	address                                                  map[uuid.UUID]string
}

func newWorld(t *testing.T, pool *pgxpool.Pool) world {
	t.Helper()
	w := world{company: uuid.New(), job: uuid.New(), owner: uuid.New(), recruiter: uuid.New(), candidate: uuid.New(), participation: uuid.New(),
		address: map[uuid.UUID]string{}}
	for u, kind := range map[uuid.UUID]string{w.owner: "recruiter", w.recruiter: "recruiter", w.candidate: "candidate"} {
		w.address[u] = "u" + strings.ReplaceAll(u.String(), "-", "")[:12] + "@example.test"
		mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Person',$4)`, u, uuid.NewString(), w.address[u], kind)
	}
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme Talento',$2,'technology','active')`, w.company, uuid.NewString())
	for u, role := range map[uuid.UUID]string{w.owner: "owner", w.recruiter: "recruiter"} {
		mustExec(t, pool, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,$4)`, uuid.New(), u, w.company, role)
	}
	mustExec(t, pool, `INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,convert_to($4,'UTF8'))`, w.job, w.company, w.owner,
		`{"fields":{"title":"`+testTitle+`"}}`)
	mustExec(t, pool, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, w.job, w.company, w.owner)
	mustExec(t, pool, `INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) VALUES($1,$2,'shared',now())`, w.job, w.company)
	mustExec(t, pool, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause) VALUES($1,$2,$3,$4,now(),'added')`, uuid.New(), w.job, w.company, w.recruiter)
	cv := uuid.New()
	mustExec(t, pool, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, w.candidate,
		strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	mustExec(t, pool, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`,
		w.participation, w.job, w.candidate, uuid.New(), cv)
	return w
}

// seed is one delivery to create with its linked notifications.
type seed struct {
	typ       string
	recipient uuid.UUID
	rows      int    // linked notifications (default 1)
	payload   string // jsonb, default {}
	inApp     *bool  // default true
	due       bool   // send_after in the past (false = in 10 min)
}

var scheduledTypes = map[string]bool{"delivery_due_soon": true, "delivery_overdue": true, "assignment_deadline_due_soon": true, "assignment_deadline_overdue": true}

// deliver inserts the seed's notifications (one source event each for the
// immediate types, a commitment date for the scheduled ones) and one delivery
// linking them, as the creation path would (§Creation). It returns the
// delivery id and the notification ids, oldest first.
func (w world) deliver(t *testing.T, pool *pgxpool.Pool, s seed) (uuid.UUID, []uuid.UUID) {
	t.Helper()
	if s.rows == 0 {
		s.rows = 1
	}
	if s.payload == "" {
		s.payload = "{}"
	}
	inApp := true
	if s.inApp != nil {
		inApp = *s.inApp
	}
	kind, reason, company := "member", "team", &w.company
	if strings.HasPrefix(s.typ, "candidate_") {
		kind, reason, company = "candidate", "candidate", nil
	}
	delivery := uuid.Must(uuid.NewV7())
	group := "n:" + delivery.String()
	if s.rows > 1 || s.typ == "application_received" || s.typ == "psychometric_completed" || s.typ == "psychometric_pending" {
		group = "g:" + s.typ + ":" + w.job.String()[:8] + ":" + time.Now().Format(time.DateOnly)
	}
	sendAfter := "now() + interval '10 minutes'"
	if s.due {
		sendAfter = "now() - interval '1 second'"
	}
	mustExec(t, pool, `INSERT INTO notification_email_deliveries(id,recipient_user_id,recipient_kind,company_id,type,group_key,job_id,send_after)
		VALUES($1,$2,$3,$4,$5,$6,$7,`+sendAfter+`)`, delivery, s.recipient, kind, company, s.typ, group, w.job)
	ids := make([]uuid.UUID, s.rows)
	for i := range ids {
		ids[i] = uuid.Must(uuid.NewV7())
		var event *uuid.UUID
		var commitment *string
		if scheduledTypes[s.typ] {
			d := time.Now().AddDate(0, 0, i).Format(time.DateOnly)
			commitment = &d
		} else {
			e := uuid.Must(uuid.NewV7())
			event = &e
			mustExec(t, pool, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id,participation_id,processed_at)
				VALUES($1,$2,$3,'VacancyApplicationSubmitted',$4,$5,now())`, e, uuid.New(), w.company, w.job, w.participation)
		}
		mustExec(t, pool, `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,participation_id,
				source_event_id,commitment_date,payload,in_app,created_at,email_delivery_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::jsonb,$13,now() - make_interval(secs => $14),$15)`,
			ids[i], s.recipient, kind, reason, company, s.typ, group, w.job, w.participation, event, commitment, s.payload, inApp, s.rows-i, delivery)
	}
	return delivery, ids
}

func setEmail(t *testing.T, pool *pgxpool.Pool, user uuid.UUID, company *uuid.UUID, typ string, enabled bool) {
	t.Helper()
	mustExec(t, pool, `INSERT INTO notification_preferences(user_id,company_id,type,channel,enabled,source) VALUES($1,$2,$3,'email',$4,'settings')
		ON CONFLICT ON CONSTRAINT notification_preferences_key DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, user, company, typ, enabled)
}

// state is a delivery row as the finalize leaves it.
type state struct {
	Status                  string
	SkipReason, ErrorClass  *string
	Attempts                int
	Sent, Leased, NextRetry bool
	Provider                *string
	RetryIn                 time.Duration // next_attempt_at - updated_at
}

func readState(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) state {
	t.Helper()
	var s state
	var retryMs *int64
	if err := pool.QueryRow(context.Background(), `SELECT status, skip_reason, error_class, attempts, sent_at IS NOT NULL, lease_until IS NOT NULL,
			next_attempt_at IS NOT NULL, provider_message_id, (extract(epoch FROM next_attempt_at - updated_at) * 1000)::bigint
		FROM notification_email_deliveries WHERE id=$1`, id).
		Scan(&s.Status, &s.SkipReason, &s.ErrorClass, &s.Attempts, &s.Sent, &s.Leased, &s.NextRetry, &s.Provider, &retryMs); err != nil {
		t.Fatal(err)
	}
	if retryMs != nil {
		s.RetryIn = time.Duration(*retryMs) * time.Millisecond
	}
	return s
}

func str(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

// fakeMailer records every message; send decides the outcome (nil = accept
// with the Message-ID as provider id).
type fakeMailer struct {
	mu   sync.Mutex
	sent []email.Message
	send func(ctx context.Context, m email.Message) (string, error)
}

func (f *fakeMailer) Send(ctx context.Context, m email.Message) (string, error) {
	f.mu.Lock()
	f.sent = append(f.sent, m)
	send := f.send
	f.mu.Unlock()
	if send != nil {
		return send(ctx, m)
	}
	return "provider-" + m.DeliveryID, nil
}

func (f *fakeMailer) messages() []email.Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]email.Message(nil), f.sent...)
}

// countingThrottle counts waits; err makes every wait fail.
type countingThrottle struct {
	mu    sync.Mutex
	waits int
	err   error
}

func (c *countingThrottle) Wait(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.waits++
	return c.err
}

func testRenderer(t *testing.T) *email.Renderer {
	t.Helper()
	signer, err := unsubscribe.NewSigner([]unsubscribe.Key{{ID: "k1", Secret: bytes.Repeat([]byte{7}, 32)}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	r, err := email.NewRenderer(email.Settings{From: `"PeopleFlow" <no-reply@peopleflow.test>`, AppBaseURL: "https://app.peopleflow.test",
		UnsubscribeURL: "https://app.peopleflow.test/api/notificaciones/baja"}, signer)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// newTestSender builds a sender on its own tagged pool, with an unlimited
// counting throttle and JSON logs captured in logs (nil = discarded).
func newTestSender(t *testing.T, pool *pgxpool.Pool, mailer email.Mailer, logs *bytes.Buffer) (*Sender, *countingThrottle) {
	t.Helper()
	var out = &bytes.Buffer{}
	if logs != nil {
		out = logs
	}
	throttle := &countingThrottle{}
	return New(senderPool(t, pool), testRenderer(t), mailer, throttle, slog.New(slog.NewJSONHandler(&lockedWriter{w: out}, nil))), throttle
}

// lockedWriter serializes concurrent log writes into one buffer.
type lockedWriter struct {
	mu sync.Mutex
	w  *bytes.Buffer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

func tick(t *testing.T, s *Sender, want int) {
	t.Helper()
	if n, err := s.Tick(context.Background()); err != nil || n != want {
		t.Fatalf("claimed=%d err=%v want %d", n, err, want)
	}
}

// openSenderTx counts the sender pool's backends with an open transaction,
// seen from another connection.
func openSenderTx(ctx context.Context, probe *pgxpool.Pool) (int, error) {
	var n int
	err := probe.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
		WHERE datname = current_database() AND application_name = $1 AND xact_start IS NOT NULL AND pid <> pg_backend_pid()`, senderAppName).Scan(&n)
	return n, err
}

var errTransient = errors.New("smtp 451 try later")

func permanentErr() error { return fmt.Errorf("smtp 550: %w", email.ErrPermanent) }
