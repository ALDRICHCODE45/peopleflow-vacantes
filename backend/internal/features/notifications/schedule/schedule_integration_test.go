//go:build integration

package schedule

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// mxNight is 23:30 on 2026-11-26 in America/Mexico_City (05:30Z on the 27th):
// today is the 26th in MX although the UTC date is already the 27th.
var mxNight = time.Date(2026, 11, 27, 5, 30, 0, 0, time.UTC)

// at returns 12:00 MX (18:00Z) of a calendar day in November 2026.
func at(d int) time.Time { return time.Date(2026, 11, d, 18, 0, 0, 0, time.UTC) }

// world is one company with members: owner and recruiter (team members of
// every job), a stakeholder and an ex-member holding active assignments
// (never notified), a member whose assignment ended, and a member off the team.
type world struct {
	company, owner, recruiter, stakeholder, exMember, ended, outsider uuid.UUID
}

func newWorld(t *testing.T, pool *pgxpool.Pool) world {
	t.Helper()
	w := world{company: uuid.New(), owner: uuid.New(), recruiter: uuid.New(), stakeholder: uuid.New(), exMember: uuid.New(), ended: uuid.New(), outsider: uuid.New()}
	for _, u := range []uuid.UUID{w.owner, w.recruiter, w.stakeholder, w.exMember, w.ended, w.outsider} {
		mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Member','recruiter')`, u, uuid.NewString(), uuid.NewString()+"@example.test")
	}
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Notif Test',$2,'technology','active')`, w.company, uuid.NewString())
	for u, role := range map[uuid.UUID]string{w.owner: "owner", w.recruiter: "recruiter", w.stakeholder: "stakeholder", w.ended: "recruiter", w.outsider: "recruiter"} {
		mustExec(t, pool, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,$4)`, uuid.New(), u, w.company, role)
	}
	return w
}

// job is one process of the company with its team and assignment ids.
type job struct {
	id          uuid.UUID
	assignments map[uuid.UUID]uuid.UUID // user → active assignment
}

// newJob publishes a process with the given status axes and commitment date
// (nil = no delivery config) and the world's team.
func (w world) newJob(t *testing.T, pool *pgxpool.Pool, status, processStatus string, commitment *time.Time) job {
	t.Helper()
	j := job{id: uuid.New(), assignments: map[uuid.UUID]uuid.UUID{}}
	mustExec(t, pool, `INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, j.id, w.company, w.owner)
	mustExec(t, pool, `INSERT INTO vacancy_processes(id,company_id,status,process_status,published_at,published_by) VALUES($1,$2,$3,$4,now(),$5)`,
		j.id, w.company, status, processStatus, w.owner)
	if commitment != nil {
		mustExec(t, pool, `INSERT INTO job_draft_delivery_configs(draft_id,version,commitment_date) VALUES($1,1,$2)`, j.id, *commitment)
	}
	mustExec(t, pool, `INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) VALUES($1,$2,'shared',now())`, j.id, w.company)
	for _, u := range []uuid.UUID{w.owner, w.recruiter, w.stakeholder, w.exMember} {
		j.assignments[u] = w.assign(t, pool, j.id, u, nil)
	}
	mustExec(t, pool, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause,ended_at,end_cause) VALUES($1,$2,$3,$4,now(),'added',now(),'removed')`,
		uuid.New(), j.id, w.company, w.ended)
	return j
}

// assign adds an active assignment with function member and an optional recruiter deadline.
func (w world) assign(t *testing.T, pool *pgxpool.Pool, jobID, user uuid.UUID, deadline *time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	mustExec(t, pool, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause,recruiter_deadline) VALUES($1,$2,$3,$4,now(),'added',$5)`,
		id, jobID, w.company, user, deadline)
	mustExec(t, pool, `INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) VALUES($1,$2,$3,'member',now(),'added')`,
		uuid.New(), id, jobID)
	return id
}

func date(d int) *time.Time { v := time.Date(2026, 11, d, 0, 0, 0, 0, time.UTC); return &v }

func fulfil(t *testing.T, pool *pgxpool.Pool, jobID uuid.UUID) {
	t.Helper()
	mustExec(t, pool, `INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates)
		VALUES($1,now(),'on_time',0,1,1,$2,'Entrevista','2026-11-26','[{}]')`, jobID, uuid.New())
}

func runAt(t *testing.T, pool *pgxpool.Pool, now time.Time) Result {
	t.Helper()
	res, err := NewRunner(pool, func() time.Time { return now }).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("run at %s: %v", now, err)
	}
	return res
}

type item struct {
	Type, Recipient, Date string
	Resolved              bool
}

// items lists the scheduled rows of a job, ordered for comparison.
func items(t *testing.T, pool *pgxpool.Pool, jobID uuid.UUID) []item {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT type, recipient_user_id::text, commitment_date::text, resolved_at IS NOT NULL
		FROM notifications WHERE job_id=$1 ORDER BY type, recipient_user_id, commitment_date`, jobID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []item{}
	for rows.Next() {
		var i item
		if err := rows.Scan(&i.Type, &i.Recipient, &i.Date, &i.Resolved); err != nil {
			t.Fatal(err)
		}
		out = append(out, i)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func sorted(in ...item) []item {
	if in == nil {
		in = []item{}
	}
	sort.Slice(in, func(a, b int) bool {
		x, y := in[a], in[b]
		if x.Type != y.Type {
			return x.Type < y.Type
		}
		if x.Recipient != y.Recipient {
			return x.Recipient < y.Recipient
		}
		return x.Date < y.Date
	})
	return in
}

// team is the expected delivery rows for owner and recruiter.
func (w world) team(typ, d string, resolved bool) []item {
	return []item{{typ, w.owner.String(), d, resolved}, {typ, w.recruiter.String(), d, resolved}}
}

func assertItems(t *testing.T, pool *pgxpool.Pool, jobID uuid.UUID, want ...item) {
	t.Helper()
	if got := items(t, pool, jobID); !reflect.DeepEqual(got, sorted(want...)) {
		t.Fatalf("items:\n got %+v\nwant %+v", got, sorted(want...))
	}
}

// §Scheduler date rule at the MX boundary (23:30 MX = 05:30Z next day):
// commitment today / tomorrow → due soon, yesterday → overdue, later →
// nothing; recipients = active non-stakeholder members on the team; rows
// carry member/team, company, no actor, no source, n:<id>, {commitment_date}.
func TestScheduleDeliveryDateRuleAtTheMexicoBoundary(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	today := w.newJob(t, pool, "published", "active", date(26))
	tomorrow := w.newJob(t, pool, "published", "active", date(27))
	yesterday := w.newJob(t, pool, "published", "active", date(25))
	later := w.newJob(t, pool, "published", "active", date(28))
	undated := w.newJob(t, pool, "published", "active", nil)

	res := runAt(t, pool, mxNight)
	if res != (Result{DeliveryCreated: 6}) {
		t.Fatalf("result %+v", res)
	}
	assertItems(t, pool, today.id, w.team("delivery_due_soon", "2026-11-26", false)...)
	assertItems(t, pool, tomorrow.id, w.team("delivery_due_soon", "2026-11-27", false)...)
	assertItems(t, pool, yesterday.id, w.team("delivery_overdue", "2026-11-25", false)...)
	assertItems(t, pool, later.id)
	assertItems(t, pool, undated.id)

	var bad int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE NOT (
		recipient_kind='member' AND recipient_reason='team' AND company_id=$1 AND actor_user_id IS NULL AND source_event_id IS NULL
		AND participation_id IS NULL AND read_at IS NULL AND group_key = 'n:'||id::text AND payload = jsonb_build_object('commitment_date', commitment_date::text))`, w.company).Scan(&bad); err != nil {
		t.Fatal(err)
	}
	if bad != 0 {
		t.Fatalf("%d rows with unexpected fields", bad)
	}
	var v7 int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE substr(id::text,15,1) = '7'`).Scan(&v7); err != nil || v7 != 6 {
		t.Fatalf("uuid v7 ids: %d %v", v7, err)
	}
}

// Q1: paused processes notify; closed (continuing or finished) and fulfilled
// ones do not.
func TestScheduleProcessFilter(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	paused := w.newJob(t, pool, "paused", "active", date(25))
	closedContinuing := w.newJob(t, pool, "closed", "active", date(25))
	finished := w.newJob(t, pool, "closed", "finished", date(25))
	fulfilled := w.newJob(t, pool, "published", "active", date(25))
	fulfil(t, pool, fulfilled.id)

	runAt(t, pool, at(26))
	assertItems(t, pool, paused.id, w.team("delivery_overdue", "2026-11-25", false)...)
	assertItems(t, pool, closedContinuing.id)
	assertItems(t, pool, finished.id)
	assertItems(t, pool, fulfilled.id)
}

// Q7: a recruiter deadline notifies only its assignee (an active
// non-stakeholder member) with {assignment_id, function, commitment_date};
// a stakeholder's or an ended assignment's deadline notifies nobody.
func TestScheduleRecruiterDeadlineOnlyToItsAssignee(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", nil)
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-27' WHERE id=$1`, j.assignments[w.recruiter])
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-25' WHERE id=ANY($1)`, []uuid.UUID{j.assignments[w.stakeholder], j.assignments[w.exMember]})
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-25' WHERE draft_id=$1 AND user_id=$2`, j.id, w.ended)
	closed := w.newJob(t, pool, "closed", "active", nil)
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-25' WHERE id=$1`, closed.assignments[w.recruiter])

	if res := runAt(t, pool, at(26)); res != (Result{AssignmentCreated: 1}) {
		t.Fatalf("result %+v", res)
	}
	assertItems(t, pool, j.id, item{"assignment_deadline_due_soon", w.recruiter.String(), "2026-11-27", false})
	assertItems(t, pool, closed.id)
	var reason, payload string
	if err := pool.QueryRow(context.Background(), `SELECT recipient_reason, payload::text FROM notifications WHERE job_id=$1`, j.id).Scan(&reason, &payload); err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"assignment_id": j.assignments[w.recruiter].String(), "function": "member", "commitment_date": "2026-11-27"}
	if reason != "assignee" || !reflect.DeepEqual(got, want) {
		t.Fatalf("reason=%s payload=%v", reason, got)
	}
}

// D21 / Q5: a re-run inserts nothing; a renegotiated date fires again and
// resolves the old item; a member added later gets only what the current run
// evaluates, never the items already fired for the old date.
func TestScheduleDedupeRenegotiationAndLateMembers(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", date(27))
	runAt(t, pool, at(26))
	if res := runAt(t, pool, at(26)); res != (Result{}) {
		t.Fatalf("re-run result %+v", res)
	}
	assertItems(t, pool, j.id, w.team("delivery_due_soon", "2026-11-27", false)...)

	late := w.outsider
	w.assign(t, pool, j.id, late, nil)
	mustExec(t, pool, `UPDATE job_draft_delivery_configs SET commitment_date='2026-11-26' WHERE draft_id=$1`, j.id)
	if res := runAt(t, pool, at(26)); res != (Result{DeliveryCreated: 3, Resolved: 2}) {
		t.Fatalf("renegotiated result %+v", res)
	}
	assertItems(t, pool, j.id, append(append(w.team("delivery_due_soon", "2026-11-27", true), w.team("delivery_due_soon", "2026-11-26", false)...),
		item{"delivery_due_soon", late.String(), "2026-11-26", false})...)

	// Cleared date: every open item resolves, nothing new.
	mustExec(t, pool, `UPDATE job_draft_delivery_configs SET commitment_date=NULL WHERE draft_id=$1`, j.id)
	if res := runAt(t, pool, at(26)); res != (Result{Resolved: 3}) {
		t.Fatalf("cleared result %+v", res)
	}
}

// §Scheduler resolution: overdue supersedes due soon for the same recipient,
// job and date (delivery and assignment types alike).
func TestScheduleOverdueSupersedesDueSoon(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", date(26))
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-26' WHERE id=$1`, j.assignments[w.recruiter])
	runAt(t, pool, at(26))
	if res := runAt(t, pool, at(27)); res != (Result{DeliveryCreated: 2, AssignmentCreated: 1, Resolved: 3}) {
		t.Fatalf("result %+v", res)
	}
	assertItems(t, pool, j.id, append(append(w.team("delivery_due_soon", "2026-11-26", true), w.team("delivery_overdue", "2026-11-26", false)...),
		item{"assignment_deadline_due_soon", w.recruiter.String(), "2026-11-26", true},
		item{"assignment_deadline_overdue", w.recruiter.String(), "2026-11-26", false})...)
	if res := runAt(t, pool, at(28)); res != (Result{}) {
		t.Fatalf("later run result %+v", res)
	}
}

// §Scheduler resolution: fulfillment, closing (continuing) and finishing
// resolve every open item of the job; an ended assignment or a changed /
// cleared recruiter deadline resolves its assignment item (a changed one
// fires again) and leaves the delivery items alone.
func TestScheduleResolvesStaleItems(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	fulfilled := w.newJob(t, pool, "published", "active", date(25))
	closed := w.newJob(t, pool, "paused", "active", date(25))
	finished := w.newJob(t, pool, "published", "active", date(25))
	team := w.newJob(t, pool, "published", "active", date(25))
	for _, j := range []job{fulfilled, closed, finished, team} {
		mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-25' WHERE id=ANY($1)`, []uuid.UUID{j.assignments[w.owner], j.assignments[w.recruiter]})
	}
	if res := runAt(t, pool, at(26)); res != (Result{DeliveryCreated: 8, AssignmentCreated: 8}) {
		t.Fatalf("first run %+v", res)
	}
	fulfil(t, pool, fulfilled.id)
	mustExec(t, pool, `UPDATE vacancy_processes SET status='closed' WHERE id=$1`, closed.id)
	mustExec(t, pool, `UPDATE vacancy_processes SET status='closed', process_status='finished' WHERE id=$1`, finished.id)
	mustExec(t, pool, `UPDATE vacancy_assignments SET ended_at=now(), end_cause='removed' WHERE id=$1`, team.assignments[w.owner])
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-27' WHERE id=$1`, team.assignments[w.recruiter])
	if res := runAt(t, pool, at(26)); res != (Result{AssignmentCreated: 1, Resolved: 14}) {
		t.Fatalf("second run %+v", res)
	}
	for _, j := range []job{fulfilled, closed, finished} {
		var open int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE job_id=$1 AND resolved_at IS NULL`, j.id).Scan(&open); err != nil || open != 0 {
			t.Fatalf("job still has %d open items (%v)", open, err)
		}
	}
	// The owner left the team: their old delivery item stays open (only assignment items resolve on an ended assignment).
	assertItems(t, pool, team.id,
		item{"assignment_deadline_due_soon", w.recruiter.String(), "2026-11-27", false},
		item{"assignment_deadline_overdue", w.owner.String(), "2026-11-25", true},
		item{"assignment_deadline_overdue", w.recruiter.String(), "2026-11-25", true},
		item{"delivery_overdue", w.owner.String(), "2026-11-25", false},
		item{"delivery_overdue", w.recruiter.String(), "2026-11-25", false})

	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline=NULL WHERE id=$1`, team.assignments[w.recruiter])
	if res := runAt(t, pool, at(26)); res != (Result{Resolved: 1}) {
		t.Fatalf("cleared deadline %+v", res)
	}
}

// D20: with the lock held by another session the run is skipped; the lock is
// released after a run, so the next holder can take it.
func TestScheduleSkipsWhileTheLockIsHeld(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", date(25))
	runner := NewRunner(pool, func() time.Time { return at(26) })
	run := func(ctx context.Context) error { _, err := runner.RunOnce(ctx); return err }
	lock := NewAdvisoryLock(pool)

	other, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	released := false
	t.Cleanup(func() { // a failed assertion must not leave the connection checked out (pool.Close would wait)
		if !released {
			other.Release()
		}
	})
	if _, err := other.Exec(ctx, `SELECT pg_advisory_lock($1)`, LockKey); err != nil {
		t.Fatal(err)
	}
	ran, err := lock.TryRun(ctx, run)
	if ran || err != nil {
		t.Fatalf("held: ran=%v err=%v", ran, err)
	}
	assertItems(t, pool, j.id)
	if _, err := other.Exec(ctx, `SELECT pg_advisory_unlock($1)`, LockKey); err != nil {
		t.Fatal(err)
	}
	other.Release()
	released = true

	if ran, err := lock.TryRun(ctx, run); !ran || err != nil {
		t.Fatalf("free: ran=%v err=%v", ran, err)
	}
	assertItems(t, pool, j.id, w.team("delivery_overdue", "2026-11-25", false)...)
	var held int
	// Only this database and this key: pg_locks is cluster-wide, and other
	// integration packages may hold their own advisory locks concurrently.
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_locks
		WHERE locktype = 'advisory' AND granted AND objsubid = 1
		  AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
		  AND classid::bigint = ($1::bigint >> 32) AND objid::bigint = ($1::bigint & 4294967295)`, LockKey).Scan(&held); err != nil || held != 0 {
		t.Fatalf("advisory locks still held after the run: %d (%v)", held, err)
	}
}
