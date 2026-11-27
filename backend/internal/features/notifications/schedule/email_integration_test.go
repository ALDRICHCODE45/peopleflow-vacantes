//go:build integration

package schedule

import (
	"bytes"
	"context"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// notifications-v2 E4 (D8, D9, D10): every scheduled type is a single group,
// so an eligible item gets one immediate delivery in the run's tx, created
// only when the run inserted the row.

func setEmail(t *testing.T, pool *pgxpool.Pool, user, company uuid.UUID, typ string, enabled bool) {
	t.Helper()
	mustExec(t, pool, `INSERT INTO notification_preferences(user_id,company_id,type,channel,enabled,source) VALUES($1,$2,$3,'email',$4,'settings')
		ON CONFLICT ON CONSTRAINT notification_preferences_key DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, user, company, typ, enabled)
}

func runEmailAt(t *testing.T, pool *pgxpool.Pool, now time.Time) Result {
	t.Helper()
	res, err := NewRunner(pool, func() time.Time { return now }).WithEmailDeliveries(true).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("run at %s: %v", now, err)
	}
	return res
}

// mailed is one delivery as seen through its single linked notification.
type mailed struct {
	Type, Recipient string
	InApp           bool
}

// scheduledDeliveries checks every delivery's shape (immediate, member,
// company, job, group = the linked notification's n:<id> key, exactly one
// linked row, pending) and returns them keyed by (type, recipient, in_app).
func scheduledDeliveries(t *testing.T, pool *pgxpool.Pool, company uuid.UUID) map[mailed]bool {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT n.type, n.recipient_user_id::text, n.in_app,
			d.send_after = d.created_at, d.recipient_kind = 'member', d.company_id = $1, d.job_id = n.job_id, d.group_key = n.group_key,
			d.type = n.type, d.recipient_user_id = n.recipient_user_id, d.status = 'pending',
			(SELECT count(*) FROM notifications x WHERE x.email_delivery_id = d.id)
		FROM notification_email_deliveries d LEFT JOIN notifications n ON n.email_delivery_id = d.id`, company)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[mailed]bool{}
	for rows.Next() {
		var m mailed
		var inApp *bool
		var typ, recipient *string
		var immediate, member, sameCompany, sameJob, sameGroup, sameType, sameRecipient, pending *bool
		var linked int
		if err := rows.Scan(&typ, &recipient, &inApp, &immediate, &member, &sameCompany, &sameJob, &sameGroup, &sameType, &sameRecipient, &pending, &linked); err != nil {
			t.Fatal(err)
		}
		if typ == nil || linked != 1 {
			t.Fatalf("delivery with %d linked rows", linked)
		}
		for name, ok := range map[string]*bool{"immediate": immediate, "member": member, "company": sameCompany, "job": sameJob, "group": sameGroup,
			"type": sameType, "recipient": sameRecipient, "pending": pending} {
			if ok == nil || !*ok {
				t.Fatalf("%s %s delivery: %s mismatch", *typ, *recipient, name)
			}
		}
		m = mailed{*typ, *recipient, *inApp}
		if out[m] {
			t.Fatalf("duplicate delivery %+v", m)
		}
		out[m] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// Overdue (mandatory) items mail every deliverable team member regardless of
// preference rows; due-soon (operational) items only with email on — a hidden
// in_app row (D6) is still mailed. A suppressed address gets nothing, even
// mandatory. A second run (dedupe) creates no delivery.
func TestScheduleCreatesImmediateDeliveries(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	mustExec(t, pool, `ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check`)
	w.newJob(t, pool, "published", "active", date(25))
	w.newJob(t, pool, "published", "active", date(27))
	setEmail(t, pool, w.recruiter, w.company, "delivery_overdue", false) // mandatory: ignored
	setEmail(t, pool, w.owner, w.company, "delivery_due_soon", true)
	setPreference(t, pool, w.owner, w.company, "delivery_due_soon", false) // in_app off: hidden, still mailed
	setEmail(t, pool, w.stakeholder, w.company, "delivery_due_soon", true) // never a recipient

	runEmailAt(t, pool, at(26))
	owner, recruiter := w.owner.String(), w.recruiter.String()
	want := map[mailed]bool{
		{"delivery_overdue", owner, true}: true, {"delivery_overdue", recruiter, true}: true,
		{"delivery_due_soon", owner, false}: true,
	}
	if got := scheduledDeliveries(t, pool, w.company); !reflect.DeepEqual(got, want) {
		t.Fatalf("first run:\n got %v\nwant %v", got, want)
	}
	if res := runEmailAt(t, pool, at(26)); res != (Result{}) {
		t.Fatalf("second run %+v", res)
	}
	if got := scheduledDeliveries(t, pool, w.company); !reflect.DeepEqual(got, want) {
		t.Fatalf("second run re-created deliveries: %v", got)
	}
}

// Suppression wins over mandatory in the scheduler path too (D9), looked up
// by the normalized address; assignment deadline items follow the same rule.
func TestScheduleSuppressedAddressGetsNoDelivery(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", date(25))
	mustExec(t, pool, `UPDATE vacancy_assignments SET recruiter_deadline = $2 WHERE id=$1`, j.assignments[w.recruiter], *date(27))
	setEmail(t, pool, w.recruiter, w.company, "assignment_deadline_due_soon", true)
	mustExec(t, pool, `UPDATE users SET email = ' Owner.Off@Example.TEST' WHERE id=$1`, w.owner)
	mustExec(t, pool, `INSERT INTO email_suppressions(address, reason) VALUES('owner.off@example.test','bounce')`)

	runEmailAt(t, pool, at(26))
	recruiter := w.recruiter.String()
	want := map[mailed]bool{{"delivery_overdue", recruiter, true}: true, {"assignment_deadline_due_soon", recruiter, true}: true}
	if got := scheduledDeliveries(t, pool, w.company); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

// NOTIFICATIONS_MAILER=off (the default runner): rows, no deliveries (D13).
func TestScheduleMailerOffCreatesNoDelivery(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	w.newJob(t, pool, "published", "active", date(25))
	if res := runAt(t, pool, at(26)); res.DeliveryCreated != 2 {
		t.Fatalf("run %+v", res)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM notification_email_deliveries`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("deliveries=%d err=%v", n, err)
	}
}

// L13 (1): the email decision runs in a savepoint of the run's tx. When it
// fails (the deliveries table is broken here), only the email part rolls
// back: the run commits its rows and its resolution, no delivery exists, and
// the failure is logged with step email and its SQLSTATE only.
func TestScheduleEmailFailureKeepsTheRun(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	stale := w.newJob(t, pool, "published", "active", date(27))
	runAt(t, pool, at(26)) // due-soon items for the stale job, no email
	fulfil(t, pool, stale.id)
	j := w.newJob(t, pool, "published", "active", date(25))
	mustExec(t, pool, `ALTER TABLE notification_email_deliveries ADD CONSTRAINT e6_broken CHECK (false) NOT VALID`)
	var logs bytes.Buffer
	res, err := NewRunner(pool, func() time.Time { return at(26) }).WithEmailDeliveries(true).WithLogger(slog.New(slog.NewJSONHandler(&logs, nil))).
		RunOnce(context.Background())
	if err != nil {
		t.Fatalf("run failed instead of isolating the email step: %v", err)
	}
	if res.DeliveryCreated != 2 || res.Resolved != 2 {
		t.Fatalf("result %+v (want 2 overdue rows and 2 resolved due-soon rows)", res)
	}
	assertItems(t, pool, j.id, w.team("delivery_overdue", "2026-11-25", false)...)
	assertItems(t, pool, stale.id, w.team("delivery_due_soon", "2026-11-27", true)...)
	var deliveries int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM notification_email_deliveries`).Scan(&deliveries); err != nil || deliveries != 0 {
		t.Fatalf("deliveries %d %v", deliveries, err)
	}
	out := logs.String()
	if !strings.Contains(out, `"step":"email"`) || !strings.Contains(out, `"sqlstate":"23514"`) || strings.Contains(out, "e6_broken") ||
		strings.Contains(out, w.owner.String()) {
		t.Fatalf("email failure log:\n%s", out)
	}
}

// L13 (3): a soft-deleted team member gets the scheduled in-app row but no
// email delivery at creation (D9), even for a mandatory type.
func TestScheduleSoftDeletedRecipientGetsNoDelivery(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	j := w.newJob(t, pool, "published", "active", date(25))
	mustExec(t, pool, `UPDATE users SET deleted_at = now() WHERE id=$1`, w.owner)
	runEmailAt(t, pool, at(26))
	assertItems(t, pool, j.id, w.team("delivery_overdue", "2026-11-25", false)...)
	want := map[mailed]bool{{"delivery_overdue", w.recruiter.String(), true}: true}
	if got := scheduledDeliveries(t, pool, w.company); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}
