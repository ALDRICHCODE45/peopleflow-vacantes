//go:build integration

package fanout

import (
	"context"
	"database/sql"
	"encoding/json"
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

// world is one company and job with a mixed team: owner and recruiter on the
// team (members), a stakeholder and an ex-member holding active assignments
// (never notified), a member whose assignment ended, an actor member off the
// team, and a candidate with an organic participation.
type world struct {
	company, job, owner, recruiter, stakeholder, exMember, ended, admin, candidate, participation uuid.UUID
}

func newWorld(t *testing.T, pool *pgxpool.Pool) world {
	t.Helper()
	w := world{company: uuid.New(), job: uuid.New(), owner: uuid.New(), recruiter: uuid.New(), stakeholder: uuid.New(), exMember: uuid.New(),
		ended: uuid.New(), admin: uuid.New(), candidate: uuid.New(), participation: uuid.New()}
	for _, u := range []uuid.UUID{w.owner, w.recruiter, w.stakeholder, w.exMember, w.ended, w.admin} {
		mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Member','recruiter')`, u, uuid.NewString(), uuid.NewString()+"@example.test")
	}
	mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, w.candidate, uuid.NewString(), uuid.NewString()+"@example.test")
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Notif Test',$2,'technology','active')`, w.company, uuid.NewString())
	for u, role := range map[uuid.UUID]string{w.owner: "owner", w.recruiter: "recruiter", w.stakeholder: "stakeholder", w.ended: "recruiter", w.admin: "recruiter"} {
		mustExec(t, pool, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,$4)`, uuid.New(), u, w.company, role)
	}
	mustExec(t, pool, `INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, w.job, w.company, w.owner)
	mustExec(t, pool, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, w.job, w.company, w.owner)
	mustExec(t, pool, `INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) VALUES($1,$2,'shared',now())`, w.job, w.company)
	for _, u := range []uuid.UUID{w.owner, w.recruiter, w.stakeholder, w.exMember} {
		mustExec(t, pool, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause) VALUES($1,$2,$3,$4,now(),'added')`, uuid.New(), w.job, w.company, u)
	}
	mustExec(t, pool, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,$4,now(),'added',now(),'removed')`,
		uuid.New(), w.job, w.company, w.ended)
	cv := uuid.New()
	mustExec(t, pool, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, w.candidate, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	mustExec(t, pool, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`,
		w.participation, w.job, w.candidate, uuid.New(), cv)
	return w
}

// addJobWithParticipation adds a second published job of the company with an
// organic participation of the same candidate.
func (w world) addJobWithParticipation(t *testing.T, pool *pgxpool.Pool) (job, participation uuid.UUID) {
	t.Helper()
	job, participation, cv := uuid.New(), uuid.New(), uuid.New()
	mustExec(t, pool, `INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, job, w.company, w.owner)
	mustExec(t, pool, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, job, w.company, w.owner)
	mustExec(t, pool, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, w.candidate, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	mustExec(t, pool, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`,
		participation, job, w.candidate, uuid.New(), cv)
	return job, participation
}

// pending is one captured event inserted as the capture decorator would.
type pending struct {
	eventType                     string
	actor, participation, subject *uuid.UUID
	payload                       map[string]any
	occurredAt                    time.Time
}

func (w world) insertEvent(t *testing.T, pool *pgxpool.Pool, e pending) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	payload, err := json.Marshal(e.payload)
	if err != nil {
		t.Fatal(err)
	}
	if e.payload == nil {
		payload = []byte(`{}`)
	}
	occurred := e.occurredAt
	if occurred.IsZero() {
		occurred = time.Now()
	}
	mustExec(t, pool, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,actor_user_id,job_id,participation_id,subject_user_id,payload,occurred_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, uuid.New(), w.company, e.eventType, e.actor, w.job, e.participation, e.subject, payload, occurred)
	return id
}

type eventState struct {
	attempts          int
	processed, failed bool
}

func readEvent(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) eventState {
	t.Helper()
	var s eventState
	if err := pool.QueryRow(context.Background(), `SELECT attempts, processed_at IS NOT NULL, failed FROM notification_events WHERE id=$1`, id).
		Scan(&s.attempts, &s.processed, &s.failed); err != nil {
		t.Fatal(err)
	}
	return s
}

type row struct {
	Type, Recipient, Kind, Reason, GroupKey string
	Company                                 *uuid.UUID
	Payload                                 string
}

func readNotifications(t *testing.T, pool *pgxpool.Pool, source uuid.UUID) []row {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT type, recipient_user_id::text, recipient_kind, recipient_reason, group_key, company_id, payload::text
		FROM notifications WHERE source_event_id=$1 ORDER BY type, recipient_user_id`, source)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.Type, &r.Recipient, &r.Kind, &r.Reason, &r.GroupKey, &r.Company, &r.Payload); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
