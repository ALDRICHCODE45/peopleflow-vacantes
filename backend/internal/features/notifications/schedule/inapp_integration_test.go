//go:build integration

package schedule

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setPreference(t *testing.T, pool *pgxpool.Pool, user, company uuid.UUID, typ string, enabled bool) {
	t.Helper()
	mustExec(t, pool, `INSERT INTO notification_preferences(user_id,company_id,type,channel,enabled,source) VALUES($1,$2,$3,'in_app',$4,'settings')
		ON CONFLICT ON CONSTRAINT notification_preferences_key DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, user, company, typ, enabled)
}

type shown struct {
	Type, Recipient string
	InApp           bool
}

// visibility lists (type, recipient, in_app) of a job's rows; it also fails
// on more than one row per (type, recipient), i.e. a re-created item.
func visibility(t *testing.T, pool *pgxpool.Pool, jobID uuid.UUID) map[shown]bool {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT type, recipient_user_id::text, in_app FROM notifications WHERE job_id=$1`, jobID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[shown]bool{}
	seen := map[[2]string]bool{}
	for rows.Next() {
		var s shown
		if err := rows.Scan(&s.Type, &s.Recipient, &s.InApp); err != nil {
			t.Fatal(err)
		}
		if seen[[2]string{s.Type, s.Recipient}] {
			t.Fatalf("item re-created: %+v", s)
		}
		seen[[2]string{s.Type, s.Recipient}] = true
		out[s] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// notifications-v2 D6/D7 (E3): the scheduler writes in_app from the
// recipient's effective preference for (user, company, type) at creation.
// A member with in_app off on delivery_due_soon gets a hidden row; the D21
// dedupe still blocks a re-creation on the next runs, and turning the
// channel back on never reveals the hidden row. The overdue (mandatory) item
// of another job stays visible; the assignment due-soon type obeys its own
// row; an override of another company does not apply.
func TestScheduleInAppOffCreatesAHiddenDeduplicatedRow(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	otherCompany := uuid.New()
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Other',$2,'technology','active')`, otherCompany, uuid.NewString())
	soon := w.newJob(t, pool, "published", "active", date(27))
	overdue := w.newJob(t, pool, "published", "active", date(25))
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline='2026-11-27' WHERE id=$1`, soon.assignments[w.recruiter])
	setPreference(t, pool, w.owner, w.company, "delivery_due_soon", false)
	setPreference(t, pool, w.recruiter, w.company, "assignment_deadline_due_soon", false)
	setPreference(t, pool, w.recruiter, otherCompany, "delivery_due_soon", false)

	owner, recruiter := w.owner.String(), w.recruiter.String()
	wantSoon := map[shown]bool{
		{"delivery_due_soon", owner, false}: true, {"delivery_due_soon", recruiter, true}: true,
		{"assignment_deadline_due_soon", recruiter, false}: true,
	}
	wantOverdue := map[shown]bool{{"delivery_overdue", owner, true}: true, {"delivery_overdue", recruiter, true}: true}
	check := func(when string) {
		t.Helper()
		if got := visibility(t, pool, soon.id); !reflect.DeepEqual(got, wantSoon) {
			t.Fatalf("%s due soon:\n got %v\nwant %v", when, got, wantSoon)
		}
		if got := visibility(t, pool, overdue.id); !reflect.DeepEqual(got, wantOverdue) {
			t.Fatalf("%s overdue:\n got %v\nwant %v", when, got, wantOverdue)
		}
	}

	if res := runAt(t, pool, at(26)); res != (Result{DeliveryCreated: 4, AssignmentCreated: 1}) {
		t.Fatalf("first run %+v", res)
	}
	check("first run")
	if res := runAt(t, pool, at(26)); res != (Result{}) {
		t.Fatalf("second run %+v", res)
	}
	check("second run")
	setPreference(t, pool, w.owner, w.company, "delivery_due_soon", true)
	setPreference(t, pool, w.recruiter, w.company, "assignment_deadline_due_soon", true)
	if res := runAt(t, pool, at(26)); res != (Result{}) {
		t.Fatalf("run after re-enabling %+v", res)
	}
	check("after re-enabling")
}

// A mandatory scheduled type is always visible, even facing an override row
// the table CHECK normally refuses (dropped here, disposable database).
func TestScheduleMandatoryTypeIgnoresAnInAppOverride(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	mustExec(t, pool, `ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check`)
	j := w.newJob(t, pool, "published", "active", date(25))
	setPreference(t, pool, w.owner, w.company, "delivery_overdue", false)
	runAt(t, pool, at(26))
	want := map[shown]bool{{"delivery_overdue", w.owner.String(), true}: true, {"delivery_overdue", w.recruiter.String(), true}: true}
	if got := visibility(t, pool, j.id); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

// D8 (E4 hook): the scheduled insert reports the affected rows — 1 on insert,
// 0 on the (recipient, type, job, date) conflict — and writes the given in_app.
func TestInsertScheduledNotificationReportsAffectedRows(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", date(27))
	s := scheduled{recipient: w.owner, company: w.company, job: j.id, typ: domain.TypeDeliveryDueSoon, reason: domain.RelationTeam,
		date: time.Date(2026, 11, 27, 0, 0, 0, 0, time.UTC), payload: map[string]any{"commitment_date": "2026-11-27"}}
	q := db.New(pool)
	if _, n, err := insert(ctx, q, s, false); err != nil || n != 1 {
		t.Fatalf("first insert: n=%d err=%v", n, err)
	}
	if _, n, err := insert(ctx, q, s, true); err != nil || n != 0 {
		t.Fatalf("conflicting insert: n=%d err=%v", n, err)
	}
	want := map[shown]bool{{"delivery_due_soon", w.owner.String(), false}: true}
	if got := visibility(t, pool, j.id); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
