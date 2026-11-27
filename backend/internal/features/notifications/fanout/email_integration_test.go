//go:build integration

package fanout

import (
	"bytes"
	"context"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// notifications-v2 E4 (D8–D10, D19): the fan-out creates the email delivery
// decision in the event's tx, only for rows it inserted.

func newEmailProcessor(pool *pgxpool.Pool) *Processor {
	return newTestProcessor(pool, nil).WithEmailDeliveries(true)
}

// delivery is one notification_email_deliveries row with the notification
// ids linked to it (notifications.email_delivery_id), sorted.
type delivery struct {
	ID, Recipient    uuid.UUID
	Kind, Type       string
	Company          *uuid.UUID
	GroupKey, Status string
	Job              uuid.UUID
	Window           time.Duration // send_after - created_at: 0 immediate, 10 min coalesced
	SendAfter        time.Time
	Linked           []uuid.UUID
}

func readDeliveries(t *testing.T, pool *pgxpool.Pool) []delivery {
	t.Helper()
	ctx := context.Background()
	rows, err := pool.Query(ctx, `SELECT d.id, d.recipient_user_id, d.recipient_kind, d.type, d.company_id, d.group_key, d.status, d.job_id,
			(extract(epoch FROM d.send_after - d.created_at) * 1000)::bigint, d.send_after,
			coalesce((SELECT array_agg(n.id::text ORDER BY n.id) FROM notifications n WHERE n.email_delivery_id = d.id), '{}')
		FROM notification_email_deliveries d ORDER BY d.created_at, d.id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []delivery{}
	for rows.Next() {
		var d delivery
		var windowMs int64
		var linked []string
		if err := rows.Scan(&d.ID, &d.Recipient, &d.Kind, &d.Type, &d.Company, &d.GroupKey, &d.Status, &d.Job, &windowMs, &d.SendAfter, &linked); err != nil {
			t.Fatal(err)
		}
		d.Window = time.Duration(windowMs) * time.Millisecond
		for _, id := range linked {
			d.Linked = append(d.Linked, uuid.MustParse(id))
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// rowsOf returns the ids of the notifications of one event, type and
// recipient (sorted) and their in_app values.
func rowsOf(t *testing.T, pool *pgxpool.Pool, typ string, recipient uuid.UUID, sources ...uuid.UUID) (ids []uuid.UUID, inApp []bool) {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT id, in_app FROM notifications WHERE type=$1 AND recipient_user_id=$2 AND source_event_id = ANY($3) ORDER BY id`,
		typ, recipient, sources)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var v bool
		if err := rows.Scan(&id, &v); err != nil {
			t.Fatal(err)
		}
		ids, inApp = append(ids, id), append(inApp, v)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return ids, inApp
}

func countLinked(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE email_delivery_id IS NOT NULL`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func sortedIDs(in ...uuid.UUID) []uuid.UUID {
	out := append([]uuid.UUID(nil), in...)
	sort.Slice(out, func(a, b int) bool { return out[a].String() < out[b].String() })
	return out
}

func tick(t *testing.T, p *Processor, want int) {
	t.Helper()
	if claimed, err := p.Tick(context.Background()); err != nil || claimed != want {
		t.Fatalf("claimed=%d err=%v want %d", claimed, err, want)
	}
}

// D9 eligibility matrix at creation: email preference on (explicit for the
// member operational type, default for the candidate type, Q1), a row of
// another company never applies, an operational member type is off by
// default. A hidden in_app row (D6) still gets its email: the channels are
// independent. Grouped types open a 10-min window, singles are immediate.
func TestFanOutEmailEligibilityAtCreation(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	otherCompany := uuid.New()
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Other',$2,'technology','active')`, otherCompany, uuid.NewString())
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true)
	setPreference(t, pool, w.owner, &w.company, "application_received", "in_app", false) // hidden row, email still on
	setPreference(t, pool, w.recruiter, &otherCompany, "application_received", "email", true)

	application := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	invitation := w.insertEvent(t, pool, pending{eventType: audit.EventPsychometricInvitationCreated, participation: &w.participation, payload: map[string]any{"invitation_id": "inv"}})
	tick(t, newEmailProcessor(pool), 2)

	ownerRows, ownerInApp := rowsOf(t, pool, "application_received", w.owner, application)
	if len(ownerRows) != 1 || ownerInApp[0] {
		t.Fatalf("owner application row: ids=%v in_app=%v (want one hidden row)", ownerRows, ownerInApp)
	}
	candidateRows, _ := rowsOf(t, pool, "candidate_test_pending", w.candidate, invitation)
	got := readDeliveries(t, pool)
	if len(got) != 2 {
		t.Fatalf("deliveries: %+v", got)
	}
	if got[0].Recipient != w.owner {
		got[0], got[1] = got[1], got[0]
	}
	want := []delivery{
		{ID: got[0].ID, Recipient: w.owner, Kind: "member", Type: "application_received", Company: &w.company,
			GroupKey: "applications:" + w.job.String() + ":" + today(), Status: "pending", Job: w.job, Window: 10 * time.Minute, SendAfter: got[0].SendAfter, Linked: ownerRows},
		{ID: got[1].ID, Recipient: w.candidate, Kind: "candidate", Type: "candidate_test_pending", Company: nil,
			GroupKey: got[1].GroupKey, Status: "pending", Job: w.job, Window: 0, SendAfter: got[1].SendAfter, Linked: candidateRows},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("deliveries:\n got %+v\nwant %+v", got, want)
	}
	var single string
	if err := pool.QueryRow(context.Background(), `SELECT group_key FROM notifications WHERE id=$1`, candidateRows[0]).Scan(&single); err != nil || single != got[1].GroupKey {
		t.Fatalf("single delivery group %q, notification group %q err=%v", got[1].GroupKey, single, err)
	}
	if n := countLinked(t, pool); n != 2 {
		t.Fatalf("linked notifications = %d, want 2 (recruiter rows, psychometric_pending rows have no email)", n)
	}
}

// today is the America/Mexico_City date the fan-out puts in grouped keys for
// an event that occurred now.
func today() string {
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		panic(err)
	}
	return time.Now().In(loc).Format(time.DateOnly)
}

// NOTIFICATIONS_MAILER=off (the default processor): no delivery at all, even
// for a recipient with the email preference on (D13).
func TestFanOutMailerOffCreatesNoDelivery(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true)
	w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	w.insertEvent(t, pool, pending{eventType: audit.EventPsychometricInvitationCreated, participation: &w.participation, payload: map[string]any{"invitation_id": "inv"}})
	tick(t, newTestProcessor(pool, nil), 2)
	if got := readDeliveries(t, pool); len(got) != 0 {
		t.Fatalf("deliveries with the mailer off: %+v", got)
	}
}

// Mandatory types are always eligible when the address is deliverable — even
// facing an email override row the CHECK normally refuses — and suppression
// wins over mandatory (D9): the normalized address (lower(btrim)) is looked
// up. A blank address gets nothing either. Lifting the suppression applies to
// the next event.
func TestFanOutMandatoryEmailNeedsADeliverableAddress(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	mustExec(t, pool, `ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check`)
	setPreference(t, pool, w.recruiter, &w.company, "vacancy_reassigned", "email", false)
	mustExec(t, pool, `UPDATE users SET email = '  Owner.Suppressed@Example.TEST ' WHERE id=$1`, w.owner)
	mustExec(t, pool, `INSERT INTO email_suppressions(address, reason) VALUES('owner.suppressed@example.test','manual')`)
	reassign := func() uuid.UUID {
		return w.insertEvent(t, pool, pending{eventType: audit.EventVacancyResponsibleReassigned, actor: &w.admin, subject: &w.recruiter,
			payload: map[string]any{"reassignment_id": uuid.NewString(), "from_user_id": w.owner.String(), "reason": "workload"}})
	}
	p := newEmailProcessor(pool)
	first := reassign()
	tick(t, p, 1)
	recruiterRows, _ := rowsOf(t, pool, "vacancy_reassigned", w.recruiter, first)
	got := readDeliveries(t, pool)
	if len(got) != 1 || got[0].Recipient != w.recruiter || got[0].Type != "vacancy_reassigned" || got[0].Window != 0 ||
		!reflect.DeepEqual(got[0].Linked, recruiterRows) {
		t.Fatalf("first event: %+v (want only the recruiter's immediate mandatory delivery)", got)
	}

	mustExec(t, pool, `UPDATE users SET email = '   ' WHERE id=$1`, w.recruiter)
	mustExec(t, pool, `DELETE FROM email_suppressions`)
	second := reassign()
	tick(t, p, 1)
	ownerRows, _ := rowsOf(t, pool, "vacancy_unassigned", w.owner, second)
	got = readDeliveries(t, pool)
	if len(got) != 2 || got[1].Recipient != w.owner || got[1].Type != "vacancy_unassigned" || got[1].Window != 0 ||
		!reflect.DeepEqual(got[1].Linked, ownerRows) {
		t.Fatalf("second event: %+v (want the owner's delivery, nothing for the blank address)", got)
	}
	if rows, _ := rowsOf(t, pool, "vacancy_reassigned", w.recruiter, second); len(rows) != 1 {
		t.Fatalf("the blank address must not block the in-app row: %v", rows)
	}
}

// D10 burst: grouped notifications of one recipient and group within the
// window link to one pending delivery; the window is fixed (a later row never
// moves send_after). Re-processing the events creates nothing (D8). Once the
// delivery leaves 'pending' (sender claim), the next row opens a new window.
func TestFanOutCoalescesABurstIntoOneWindow(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true)
	at := time.Now()
	apply := func() uuid.UUID {
		return w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation, occurredAt: at})
	}
	p := newEmailProcessor(pool)
	burst := []uuid.UUID{apply(), apply(), apply()}
	tick(t, p, 3)
	got := readDeliveries(t, pool)
	ownerRows, _ := rowsOf(t, pool, "application_received", w.owner, burst...)
	if len(got) != 1 || len(ownerRows) != 3 || got[0].Status != "pending" || got[0].Window != 10*time.Minute || !reflect.DeepEqual(got[0].Linked, ownerRows) {
		t.Fatalf("burst: deliveries %+v, owner rows %v", got, ownerRows)
	}
	window := got[0]

	time.Sleep(20 * time.Millisecond) // a later tx: now() differs
	burst = append(burst, apply())
	tick(t, p, 1)
	got = readDeliveries(t, pool)
	ownerRows, _ = rowsOf(t, pool, "application_received", w.owner, burst...)
	if len(got) != 1 || got[0].ID != window.ID || !got[0].SendAfter.Equal(window.SendAfter) || !reflect.DeepEqual(got[0].Linked, ownerRows) {
		t.Fatalf("late row in the open window: %+v (send_after was %s)", got, window.SendAfter)
	}

	mustExec(t, pool, `UPDATE notification_events SET processed_at = NULL WHERE id = ANY($1)`, burst)
	tick(t, p, 4)
	if again := readDeliveries(t, pool); !reflect.DeepEqual(again, got) {
		t.Fatalf("re-processing changed the deliveries:\n got %+v\nwant %+v", again, got)
	}
	for _, id := range burst {
		if s := readEvent(t, pool, id); !s.processed || s.attempts != 0 || s.failed {
			t.Fatalf("re-processed event %s: %+v (want processed without a failed attempt)", id, s)
		}
	}

	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', lease_until=now() + interval '2 minutes', attempts=attempts+1 WHERE id=$1`, window.ID)
	next := apply()
	tick(t, p, 1)
	nextRows, _ := rowsOf(t, pool, "application_received", w.owner, next)
	got = readDeliveries(t, pool)
	if len(got) != 2 || got[0].ID != window.ID || len(got[0].Linked) != 4 || got[1].Status != "pending" || got[1].Window != 10*time.Minute ||
		got[1].GroupKey != window.GroupKey || !reflect.DeepEqual(got[1].Linked, nextRows) {
		t.Fatalf("after the window closed: %+v", got)
	}
}

// §Coalescing race: the fan-out's upsert waits on the sender's claim row lock;
// when the claim commits, PostgreSQL re-checks the partial unique arbiter and
// the upsert inserts a new delivery (new window). When the claim rolls back
// instead, the row joins the still-open window.
func TestFanOutWindowCloseRaceWithAConcurrentClaim(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true)
	at := time.Now()
	apply := func() uuid.UUID {
		return w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation, occurredAt: at})
	}
	p := newEmailProcessor(pool)
	first := apply()
	tick(t, p, 1)
	open := readDeliveries(t, pool)
	if len(open) != 1 {
		t.Fatalf("first window: %+v", open)
	}

	// raceTick holds a claim of delivery in an open tx, runs one fan-out tick
	// concurrently, waits until it blocks on the claim's row lock, then ends
	// the claim (commit or rollback) and returns once the tick finished.
	raceTick := func(deliveryID uuid.UUID, commit bool) {
		t.Helper()
		claim, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = claim.Rollback(ctx) }()
		if _, err := claim.Exec(ctx, `UPDATE notification_email_deliveries SET status='sending', lease_until=now() + interval '2 minutes', attempts=attempts+1
			WHERE id=$1 AND status='pending'`, deliveryID); err != nil {
			t.Fatal(err)
		}
		var claimPID int32
		if err := claim.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&claimPID); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() {
			claimed, err := p.Tick(ctx)
			if err == nil && claimed != 1 {
				err = errClaimed(claimed)
			}
			done <- err
		}()
		deadline := time.Now().Add(15 * time.Second)
		for {
			var waiting int
			// Only the fan-out's own coalescing upsert, blocked by this claim's
			// backend, counts (L15): no unrelated lock wait passes the probe.
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
				WHERE datname = current_database() AND wait_event_type = 'Lock' AND $1::int = ANY (pg_blocking_pids(pid))
				  AND position('INSERT INTO notification_email_deliveries' IN query) > 0
				  AND position('ON CONFLICT (recipient_user_id, group_key)' IN query) > 0`, claimPID).Scan(&waiting); err != nil {
				t.Fatal(err)
			}
			if waiting > 0 {
				break
			}
			select {
			case err := <-done:
				t.Fatalf("the fan-out finished without waiting on the claim: %v", err)
			default:
			}
			if time.Now().After(deadline) {
				t.Fatal("the fan-out never blocked on the claim's row lock")
			}
			time.Sleep(10 * time.Millisecond)
		}
		if commit {
			err = claim.Commit(ctx)
		} else {
			err = claim.Rollback(ctx)
		}
		if err != nil {
			t.Fatal(err)
		}
		select {
		case err := <-done:
			if err != nil {
				t.Fatalf("fan-out tick: %v", err)
			}
		case <-time.After(15 * time.Second):
			t.Fatal("the fan-out tick never finished")
		}
	}

	second := apply()
	raceTick(open[0].ID, true)
	firstRows, _ := rowsOf(t, pool, "application_received", w.owner, first)
	secondRows, _ := rowsOf(t, pool, "application_received", w.owner, second)
	got := readDeliveries(t, pool)
	if len(got) != 2 || got[0].ID != open[0].ID || got[0].Status != "sending" || !reflect.DeepEqual(got[0].Linked, firstRows) ||
		got[1].Status != "pending" || got[1].Window != 10*time.Minute || !reflect.DeepEqual(got[1].Linked, secondRows) {
		t.Fatalf("claim committed: %+v", got)
	}

	third := apply()
	raceTick(got[1].ID, false)
	thirdRows, _ := rowsOf(t, pool, "application_received", w.owner, third)
	after := readDeliveries(t, pool)
	if len(after) != 2 || after[1].ID != got[1].ID || after[1].Status != "pending" ||
		!reflect.DeepEqual(after[1].Linked, sortedIDs(append(secondRows, thirdRows...)...)) {
		t.Fatalf("claim rolled back: %+v", after)
	}
}

type errClaimed int

func (e errClaimed) Error() string { return "unexpected claimed count" }

// L13 (1): the email decision runs in a savepoint of the event's tx. When it
// fails (the deliveries table is broken here), only the email part rolls
// back: the in-app rows commit, the event is processed with no failed
// attempt, no delivery exists, and the failure is logged with step email and
// its SQLSTATE only.
func TestFanOutEmailFailureKeepsTheInAppRows(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true)
	mustExec(t, pool, `ALTER TABLE notification_email_deliveries ADD CONSTRAINT e6_broken CHECK (false) NOT VALID`)
	var logs bytes.Buffer
	p := newTestProcessor(pool, &logs).WithEmailDeliveries(true)
	application := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	tick(t, p, 1)
	if got := readEvent(t, pool, application); !got.processed || got.failed || got.attempts != 0 {
		t.Fatalf("event: %+v (want processed with no failed attempt)", got)
	}
	ownerRows, _ := rowsOf(t, pool, "application_received", w.owner, application)
	recruiterRows, _ := rowsOf(t, pool, "application_received", w.recruiter, application)
	if len(ownerRows) != 1 || len(recruiterRows) != 1 {
		t.Fatalf("in-app rows rolled back: owner=%v recruiter=%v", ownerRows, recruiterRows)
	}
	if got := readDeliveries(t, pool); len(got) != 0 || countLinked(t, pool) != 0 {
		t.Fatalf("deliveries %+v linked %d", got, countLinked(t, pool))
	}
	out := logs.String()
	if !strings.Contains(out, `"step":"email"`) || !strings.Contains(out, `"sqlstate":"23514"`) || !strings.Contains(out, application.String()) ||
		strings.Contains(out, "e6_broken") || strings.Contains(out, w.owner.String()) {
		t.Fatalf("email failure log:\n%s", out)
	}

	// Repaired: the next event gets its delivery again.
	mustExec(t, pool, `ALTER TABLE notification_email_deliveries DROP CONSTRAINT e6_broken`)
	next := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	tick(t, p, 1)
	nextRows, _ := rowsOf(t, pool, "application_received", w.owner, next)
	if got := readDeliveries(t, pool); len(got) != 1 || !reflect.DeepEqual(got[0].Linked, nextRows) {
		t.Fatalf("after repair: %+v", got)
	}
}

// L13 (3): a soft-deleted recipient still on the team gets the in-app row
// (stage-1 rules unchanged) but never an email delivery at creation (D9),
// even with the email preference on.
func TestFanOutSoftDeletedRecipientGetsNoDelivery(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true)
	setPreference(t, pool, w.recruiter, &w.company, "application_received", "email", true)
	mustExec(t, pool, `UPDATE users SET deleted_at = now() WHERE id=$1`, w.owner)
	application := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	tick(t, newEmailProcessor(pool), 1)
	ownerRows, _ := rowsOf(t, pool, "application_received", w.owner, application)
	recruiterRows, _ := rowsOf(t, pool, "application_received", w.recruiter, application)
	got := readDeliveries(t, pool)
	if len(ownerRows) != 1 || len(got) != 1 || got[0].Recipient != w.recruiter || !reflect.DeepEqual(got[0].Linked, recruiterRows) {
		t.Fatalf("owner rows %v deliveries %+v", ownerRows, got)
	}
}
