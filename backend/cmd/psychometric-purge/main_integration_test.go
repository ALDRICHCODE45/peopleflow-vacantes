//go:build integration

package main

import (
	"bytes"
	"context"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/assessment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	store "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// A unique schema in the same guarded draft_test database isolates all command
// connections, including concurrent runs. The real 50/51 DDL supplies every
// assessment constraint/FK; minimal parent fixtures avoid changing public data.
func purgeFixture(t *testing.T) *pgxpool.Pool {
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
	schema := "purge_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	execFixture(t, pool, `CREATE TABLE users(id uuid PRIMARY KEY,full_name text,cognito_sub text,user_type text,deleted_at timestamptz);
 CREATE TABLE process_participations(id uuid PRIMARY KEY,process_id uuid,candidate_id uuid,source text,stage_id text DEFAULT 'active',discarded_at timestamptz);
 CREATE TABLE job_drafts(id uuid PRIMARY KEY);
 CREATE TABLE vacancy_processes(id uuid PRIMARY KEY,company_id uuid);
 CREATE TABLE companies(id uuid PRIMARY KEY,name text);
 CREATE TABLE vacancy_public_projections(id uuid PRIMARY KEY,company_id uuid,title text);
 CREATE TABLE audit_events(id uuid PRIMARY KEY,entity_id uuid,event_type text);
 INSERT INTO users VALUES('00000000-0000-0000-0000-000000000001','fixture','candidate','candidate',NULL);
 INSERT INTO job_drafts VALUES('00000000-0000-0000-0000-000000000002');
 INSERT INTO companies VALUES('00000000-0000-0000-0000-000000000003','company');
 INSERT INTO vacancy_processes VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');
 INSERT INTO vacancy_public_projections VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','vacancy');`)
	for _, name := range []string{"00050_psychometric_invitations.sql", "00051_psychometric_assessments.sql"} {
		b, err := fs.ReadFile(migrations.MigrationsFS, name)
		if err != nil {
			t.Fatal(err)
		}
		up, _, _ := strings.Cut(string(b), "-- +goose Down")
		execFixture(t, pool, up)
	}
	return pool
}
func execFixture(t *testing.T, p *pgxpool.Pool, q string, args ...any) {
	t.Helper()
	if _, err := p.Exec(context.Background(), q, args...); err != nil {
		t.Fatal(err)
	}
}
func seedInvitation(t *testing.T, p *pgxpool.Pool, kind, deadline string) uuid.UUID {
	t.Helper()
	id, pid := uuid.New(), uuid.New()
	execFixture(t, p, `INSERT INTO process_participations(id,process_id,candidate_id,source) VALUES($1,'00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','organic')`, pid)
	// Deadlines are derived from the actual 12-calendar-month anchors. A boundary
	// deadline is the database's current time (never a Go clock).
	execFixture(t, p, `WITH d AS (SELECT CASE $3 WHEN 'future' THEN clock_timestamp()+interval '1 day' WHEN 'boundary' THEN clock_timestamp() ELSE clock_timestamp()-interval '1 day' END AS cutoff)
 INSERT INTO psychometric_invitations(id,participation_id,test,content_version,scoring_version,total_count,answered_count,origin,created_at,expires_at,consented_at,finished_at,revoked_at,purge_after,token_hash)
 SELECT $1::uuid,$2::uuid,'ipip60-mx','psychometrics.content.v1','psychometrics.scoring.v1',63,1,'auto',cutoff-interval '13 months',CASE WHEN $4='expired' THEN cutoff-interval '12 months' ELSE cutoff END,cutoff-interval '13 months',CASE WHEN $4='finished' THEN cutoff-interval '12 months' END,CASE WHEN $4='revoked' THEN cutoff-interval '12 months' END,cutoff,decode(repeat('01',16)||replace($1::text,'-',''),'hex') FROM d`, id, pid, deadline, kind)
	execFixture(t, p, `INSERT INTO psychometric_consents SELECT id,'1',repeat('a',64),consented_at FROM psychometric_invitations WHERE id=$1`, id)
	execFixture(t, p, `INSERT INTO psychometric_answers VALUES($1,1,3,4200,clock_timestamp())`, id)
	execFixture(t, p, `INSERT INTO psychometric_answer_events VALUES($1,$2,1,'put',3,4200,clock_timestamp(),1)`, id, uuid.New())
	if kind == "finished" {
		execFixture(t, p, `INSERT INTO psychometric_results SELECT id,content_version,scoring_version,finished_at,'{"sensitive":"score"}' FROM psychometric_invitations WHERE id=$1`, id)
		for range 3 {
			execFixture(t, p, `INSERT INTO psychometric_comparisons SELECT $2,id,'1','{"rationale":"snapshot"}',content_version,scoring_version,clock_timestamp(),'{"sensitive":"comparison"}' FROM psychometric_invitations WHERE id=$1`, id, uuid.New())
		}
	}
	execFixture(t, p, `INSERT INTO audit_events VALUES($1,$2,'PsychometricConsentGiven')`, uuid.New(), id)
	return id
}
func snapshot(t *testing.T, p *pgxpool.Pool, where string) string {
	t.Helper()
	var parts []string
	for _, table := range []string{"psychometric_invitations", "psychometric_answers", "psychometric_answer_events", "psychometric_consents", "psychometric_results", "psychometric_comparisons", "audit_events", "process_participations", "users"} {
		filter := ""
		if where != "" && strings.HasPrefix(table, "psychometric_") {
			col := "invitation_id"
			if table == "psychometric_invitations" {
				col = "id"
			}
			filter = " WHERE " + col + " IN (" + where + ")"
		}
		var s string
		if err := p.QueryRow(context.Background(), `SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]')::text FROM (SELECT to_jsonb(t) v FROM `+table+` t`+filter+`) q`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		parts = append(parts, s)
	}
	return strings.Join(parts, "\n")
}
func callPurge(args ...string) (int, string, string) {
	var out, stderr bytes.Buffer
	code := run(context.Background(), args, &out, &stderr)
	return code, out.String(), stderr.String()
}
func expectedCounts(n, finished int) string {
	return fmt.Sprintf("psychometric_invitations=%d\npsychometric_answers=%d\npsychometric_answer_events=%d\npsychometric_consents=%d\npsychometric_results=%d\npsychometric_comparisons=%d\n", n, n, n, n, finished, finished*3)
}
func TestPurgeDryExecuteRetentionAndRerun(t *testing.T) {
	p := purgeFixture(t)
	for range 40 {
		for _, kind := range []string{"finished", "revoked", "expired"} {
			seedInvitation(t, p, kind, "past")
		}
	}
	seedInvitation(t, p, "finished", "boundary")
	for _, kind := range []string{"finished", "revoked", "expired"} {
		seedInvitation(t, p, kind, "future")
	}
	// Production schema forbids NULL. Simulate invalid legacy data only in this
	// isolated schema to prove the command fails closed even without that guard.
	invalid := seedInvitation(t, p, "expired", "future")
	execFixture(t, p, `UPDATE psychometric_invitations SET purge_after='-infinity' WHERE id=$1`, invalid)
	nullID := seedInvitation(t, p, "expired", "future")
	execFixture(t, p, `ALTER TABLE psychometric_invitations ALTER COLUMN purge_after DROP NOT NULL`)
	execFixture(t, p, `UPDATE psychometric_invitations SET purge_after=NULL WHERE id=$1`, nullID)
	futureFilter := `SELECT id FROM psychometric_invitations WHERE purge_after>clock_timestamp() OR NOT isfinite(purge_after) OR purge_after IS NULL`
	before, kept := snapshot(t, p, ""), snapshot(t, p, futureFilter)
	want := expectedCounts(121, 41)
	if code, out, stderr := callPurge(); code != 0 || out != want || stderr != "" {
		t.Fatalf("dry run: %d %q %q", code, out, stderr)
	}
	if snapshot(t, p, "") != before {
		t.Fatal("dry run changed rows")
	}
	if code, out, stderr := callPurge("-execute"); code != 0 || out != want || stderr != "" {
		t.Fatalf("execute: %d %q %q", code, out, stderr)
	}
	if snapshot(t, p, futureFilter) != kept {
		t.Fatal("future/invalid or non-psychometric rows changed")
	}
	for _, table := range []string{"psychometric_answers", "psychometric_answer_events", "psychometric_consents", "psychometric_results", "psychometric_comparisons"} {
		var n int
		if err := p.QueryRow(context.Background(), `SELECT count(*) FROM `+table+` WHERE invitation_id IN (SELECT id FROM psychometric_invitations WHERE isfinite(purge_after) AND purge_after<=clock_timestamp())`).Scan(&n); err != nil || n != 0 {
			t.Fatalf("expired %s remains: %d %v", table, n, err)
		}
	}
	var tombstones int
	if err := p.QueryRow(context.Background(), `SELECT count(*) FROM psychometric_invitations WHERE purge_after<=clock_timestamp() AND isfinite(purge_after) AND token_hash IS NULL AND consented_at IS NULL AND answered_count=0`).Scan(&tombstones); err != nil || tombstones != 121 {
		t.Fatal("missing scrubbed tombstones", tombstones, err)
	}
	after := snapshot(t, p, "")
	for _, args := range [][]string{nil, {"-execute"}} {
		if code, out, stderr := callPurge(args...); code != 0 || out != expectedCounts(0, 0) || stderr != "" {
			t.Fatalf("rerun %d %q %q", code, out, stderr)
		}
	}
	if snapshot(t, p, "") != after {
		t.Fatal("rerun mutated rows")
	}
}
func TestPurgeExactDatabaseClockBoundary(t *testing.T) {
	p := purgeFixture(t)
	// Shadow the database clock in this isolated schema only. Both seeding and
	// the public command see the identical DB timestamp, proving <=, not just <.
	execFixture(t, p, `CREATE FUNCTION clock_timestamp() RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT '2030-01-01T00:00:00Z'::timestamptz $$`)
	var schema string
	if err := p.QueryRow(context.Background(), `SELECT current_schema()`).Scan(&schema); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("fixture URL")
	}
	q := u.Query()
	q.Set("search_path", schema+",pg_catalog")
	u.RawQuery = q.Encode()
	t.Setenv("DATABASE_URL", u.String())
	fixed, err := pgxpool.New(context.Background(), u.String())
	if err != nil {
		t.Fatal("fixture pool")
	}
	defer fixed.Close()
	id := seedInvitation(t, fixed, "finished", "boundary")
	var equal bool
	if err := fixed.QueryRow(context.Background(), `SELECT purge_after=clock_timestamp() FROM psychometric_invitations WHERE id=$1`, id).Scan(&equal); err != nil || !equal {
		t.Fatal("boundary fixture is not exact", err)
	}
	for _, args := range [][]string{nil, {"-execute"}} {
		if code, out, stderr := callPurge(args...); code != 0 || out != expectedCounts(1, 1) || stderr != "" {
			t.Fatalf("boundary: %d %q %q", code, out, stderr)
		}
	}
}

func TestPurgeConcurrent(t *testing.T) {
	p := purgeFixture(t)
	for range 110 {
		seedInvitation(t, p, "finished", "past")
	}
	var wg sync.WaitGroup
	start := make(chan struct{})
	outputs := make(chan string, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			code, out, stderr := callPurge("-execute")
			if code != 0 || stderr != "" {
				t.Errorf("concurrent run %d %q", code, stderr)
			}
			outputs <- out
		}()
	}
	close(start)
	wg.Wait()
	close(outputs)
	totals := make([]int, 6)
	for out := range outputs {
		lines := strings.Split(strings.TrimSpace(out), "\n")
		if len(lines) != 6 {
			t.Fatal("invalid counts")
		}
		for i, line := range lines {
			var name string
			var n int
			parts := strings.Split(line, "=")
			if len(parts) != 2 {
				t.Fatal("invalid count")
			}
			name = parts[0]
			_ = name
			if _, err := fmt.Sscan(parts[1], &n); err != nil {
				t.Fatal(err)
			}
			totals[i] += n
		}
	}
	for i, want := range []int{110, 110, 110, 110, 110, 330} {
		if totals[i] != want {
			t.Fatalf("double-count/missing count: %v", totals)
		}
	}
	if code, out, stderr := callPurge("-execute"); code != 0 || out != expectedCounts(0, 0) || stderr != "" {
		t.Fatalf("concurrent leftovers %d %q %q", code, out, stderr)
	}
}

// No-op jobs gate isolates feature public interfaces without importing another
// feature's infrastructure. Production ownership gates are unchanged.
type readJobs struct{}

func (readJobs) PsychometricInvitationsContext(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, bool) (string, error) {
	return "", nil
}
func (readJobs) AuditPsychometricInvitation(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return nil
}
func (readJobs) AuditPsychometricComparison(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return nil
}
func TestRetentionReadInterfaces(t *testing.T) {
	p := purgeFixture(t)
	ctx := context.Background()
	expired := seedInvitation(t, p, "finished", "past")
	future := seedInvitation(t, p, "expired", "future")
	// Keep link expiry in the future to prove retention is independently enforced.
	execFixture(t, p, `UPDATE psychometric_invitations SET expires_at=clock_timestamp()+interval '1 day' WHERE id=$1`, expired)
	candidates := store.NewAssessmentStore(p, readJobs{})
	employers := store.NewInvitationsStore(p, readJobs{})
	before := snapshot(t, p, "")
	for _, action := range []string{"get", "items"} {
		if _, err := candidates.Execute(ctx, assessment.Access{ID: expired, Subject: "candidate"}, action, 0, assessment.Command{}); err != assessment.ErrNotFound {
			t.Fatalf("retained account %s: %v", action, err)
		}
	}
	hash := make([]byte, 32)
	for i := range hash {
		hash[i] = 1
	}
	var digest [32]byte
	copy(digest[:], hash)
	execFixture(t, p, `UPDATE psychometric_invitations SET token_hash=$2 WHERE id=$1`, expired, hash)
	if id, err := employers.FindAvailableToken(ctx, digest, true); err != nil || id != uuid.Nil {
		t.Fatal("retained public lookup accessible", id, err)
	}
	// Restore token to compare all rejected-read state byte for byte.
	execFixture(t, p, `UPDATE psychometric_invitations SET token_hash=decode(repeat('01',16)||replace(id::text,'-',''),'hex') WHERE id=$1`, expired)
	company := uuid.MustParse("00000000-0000-0000-0000-000000000003")
	draft := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	for _, read := range []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error){employers.GetResult, employers.CreateComparison} {
		if _, err := read(ctx, company, uuid.Nil, draft, expired); err != invitations.ErrNotFound {
			t.Fatalf("retained employer result: %v", err)
		}
	}
	list, err := candidates.List(ctx, "candidate")
	if err != nil || strings.Contains(string(list.Body), expired.String()) || !strings.Contains(string(list.Body), future.String()) {
		t.Fatal("account retention list", err, string(list.Body))
	}
	inv, err := employers.ListInvitations(ctx, company, uuid.Nil, draft)
	if err != nil || strings.Contains(string(inv.Body), expired.String()) || !strings.Contains(string(inv.Body), future.String()) {
		t.Fatal("employer retention list", err, string(inv.Body))
	}
	if snapshot(t, p, "") != before {
		t.Fatal("rejected reads mutated rows")
	}
	// Preserve existing candidate get/items and public lookup before retention.
	for _, action := range []string{"get", "items"} {
		r, err := candidates.Execute(ctx, assessment.Access{ID: future, Subject: "candidate"}, action, 0, assessment.Command{})
		if err != nil || r.Status != 200 {
			t.Fatal("pre-retention candidate read changed", action, err)
		}
	}
	execFixture(t, p, `UPDATE psychometric_invitations SET token_hash=$2,expires_at=clock_timestamp()+interval '1 day' WHERE id=$1`, future, hash)
	if id, err := employers.FindAvailableToken(ctx, digest, true); err != nil || id != future {
		t.Fatal("pre-retention public lookup changed", id, err)
	}
}
