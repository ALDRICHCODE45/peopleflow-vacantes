//go:build integration

package sender

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/logmail"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/fanout"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// notifications-v2 E6 (D11, D12, §Sender): claim with lease, re-check, send
// outside any tx, fenced finalize, backoff, throttle.

// A due mandatory delivery is claimed (sending, attempts 1, 2-min lease,
// next_attempt_at cleared), sent with no transaction open on any of the
// sender's connections, and finalized sent with the provider id and the lease
// cleared. Mandatory: no List-Unsubscribe, footer F2 only.
func TestSenderSendsADueDeliveryOutsideAnyTransaction(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	type atSend struct {
		openTx                   int
		status                   string
		attempts                 int
		leaseLeft                time.Duration
		nextAttempt, hasDeadline bool
	}
	var seen atSend
	mailer := &fakeMailer{}
	mailer.send = func(sendCtx context.Context, m email.Message) (string, error) {
		n, err := openSenderTx(ctx, pool)
		if err != nil {
			return "", err
		}
		seen.openTx = n
		_, seen.hasDeadline = sendCtx.Deadline()
		var leftMs int64
		if err := pool.QueryRow(ctx, `SELECT status, attempts, (extract(epoch FROM lease_until - now()) * 1000)::bigint, next_attempt_at IS NOT NULL
			FROM notification_email_deliveries WHERE id=$1`, id).Scan(&seen.status, &seen.attempts, &leftMs, &seen.nextAttempt); err != nil {
			return "", err
		}
		seen.leaseLeft = time.Duration(leftMs) * time.Millisecond
		return "provider-1", nil
	}
	s, _ := newTestSender(t, pool, mailer, nil)
	tick(t, s, 1)

	if seen.openTx != 0 || seen.status != "sending" || seen.attempts != 1 || seen.nextAttempt || !seen.hasDeadline ||
		seen.leaseLeft < Lease-30*time.Second || seen.leaseLeft > Lease {
		t.Fatalf("at send: %+v", seen)
	}
	msgs := mailer.messages()
	if len(msgs) != 1 {
		t.Fatalf("sent %d", len(msgs))
	}
	m := msgs[0]
	if m.To != w.address[w.recruiter] || m.Subject != "Te asignaron "+testTitle || m.DeliveryID != id.String() || m.Type != "vacancy_assigned" ||
		m.MessageID != "<"+id.String()+"@peopleflow.test>" {
		t.Fatalf("message: to=%q subject=%q id=%q type=%q mid=%q", m.To, m.Subject, m.DeliveryID, m.Type, m.MessageID)
	}
	if _, ok := m.Headers["List-Unsubscribe"]; ok || !strings.Contains(m.Text, "Este aviso es obligatorio") ||
		!strings.Contains(m.Text, "https://app.peopleflow.test/empresa/vacantes/"+w.job.String()+"/pipeline") ||
		!strings.Contains(m.Text, "Ahora eres responsable de "+testTitle+" en Acme Talento.") {
		t.Fatalf("mandatory message:\n%s\n%v", m.Text, m.Headers)
	}
	got := readState(t, pool, id)
	if got.Status != "sent" || !got.Sent || got.Leased || got.NextRetry || got.ErrorClass != nil || str(got.Provider) != "provider-1" || got.Attempts != 1 {
		t.Fatalf("after send: %+v provider=%s", got, str(got.Provider))
	}
	tick(t, s, 0) // nothing left
}

// A coalesced group renders its count (rows linked at send time) and the
// vacancy candidates link; a group of one renders .one with the participation
// link. Non-mandatory: List-Unsubscribe + One-Click and the F1 footer.
func TestSenderRendersACoalescedGroupWithItsCount(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setEmail(t, pool, w.owner, &w.company, "application_received", true)
	group, _ := w.deliver(t, pool, seed{typ: "application_received", recipient: w.owner, rows: 3, due: true})
	mailer := &fakeMailer{}
	s, _ := newTestSender(t, pool, mailer, nil)
	tick(t, s, 1)
	msgs := mailer.messages()
	if len(msgs) != 1 {
		t.Fatalf("sent %d", len(msgs))
	}
	m := msgs[0]
	if m.Subject != "3 postulaciones nuevas en "+testTitle || m.Template != "application_received.many" ||
		!strings.Contains(m.Text, "https://app.peopleflow.test/empresa/vacantes/"+w.job.String()+"/pipeline") ||
		strings.Contains(m.Text, "candidato=") || !strings.Contains(m.Text, "Recibes este correo porque") {
		t.Fatalf("group message: %q %q\n%s", m.Subject, m.Template, m.Text)
	}
	if !strings.HasPrefix(m.Headers["List-Unsubscribe"], "<https://app.peopleflow.test/api/notificaciones/baja?token=k1.") ||
		m.Headers["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Fatalf("unsubscribe headers: %v", m.Headers)
	}
	if st := readState(t, pool, group); st.Status != "sent" {
		t.Fatalf("group: %+v", st)
	}

	// Same group form rule for one row: participation link, .one copy.
	mustExec(t, pool, `DELETE FROM notifications`)
	mustExec(t, pool, `DELETE FROM notification_email_deliveries`)
	w.deliver(t, pool, seed{typ: "application_received", recipient: w.owner, rows: 1, due: true})
	tick(t, s, 1)
	one := mailer.messages()[1]
	if one.Subject != "Nueva postulación en "+testTitle || one.Template != "application_received.one" ||
		!strings.Contains(one.Text, "/pipeline?candidato="+w.participation.String()) {
		t.Fatalf("single-row group: %q %q\n%s", one.Subject, one.Template, one.Text)
	}
}

// Nothing is claimed before it is due: an open window (send_after ahead), a
// retry in backoff, a live lease. Terminal rows are never claimed.
func TestSenderClaimsOnlyDueDeliveries(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setEmail(t, pool, w.owner, &w.company, "application_received", true)
	w.deliver(t, pool, seed{typ: "application_received", recipient: w.owner}) // window open
	retry, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='retry', attempts=1, next_attempt_at=now() + interval '1 minute' WHERE id=$1`, retry)
	leased, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', attempts=1, lease_until=now() + interval '1 minute' WHERE id=$1`, leased)
	for _, terminal := range []string{"sent", "skipped", "failed"} {
		id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
		switch terminal {
		case "sent":
			mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sent', sent_at=now() WHERE id=$1`, id)
		case "skipped":
			mustExec(t, pool, `UPDATE notification_email_deliveries SET status='skipped', skip_reason='read' WHERE id=$1`, id)
		default:
			mustExec(t, pool, `UPDATE notification_email_deliveries SET status='failed', error_class='permanent' WHERE id=$1`, id)
		}
	}
	mailer := &fakeMailer{}
	s, _ := newTestSender(t, pool, mailer, nil)
	tick(t, s, 0)
	if len(mailer.messages()) != 0 {
		t.Fatal("sent before due")
	}
	// The retry becomes due: claimed, next_attempt_at cleared by the claim.
	mustExec(t, pool, `UPDATE notification_email_deliveries SET next_attempt_at=now() - interval '1 second' WHERE id=$1`, retry)
	var nextAtSend bool
	mailer.send = func(ctx context.Context, m email.Message) (string, error) {
		if err := pool.QueryRow(ctx, `SELECT next_attempt_at IS NOT NULL FROM notification_email_deliveries WHERE id=$1`, retry).Scan(&nextAtSend); err != nil {
			return "", err
		}
		return "p", nil
	}
	tick(t, s, 1)
	if st := readState(t, pool, retry); st.Status != "sent" || st.Attempts != 2 || nextAtSend {
		t.Fatalf("retry: %+v next at send %v", st, nextAtSend)
	}
}

// SKIP LOCKED: a delivery locked by another transaction is skipped and the
// next due one is claimed; two senders running at once over many deliveries
// send each exactly once.
func TestSenderSkipLockedAcrossInstances(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	first, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET send_after = now() - interval '1 hour' WHERE id=$1`, first)
	second, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})

	lock, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lock.Exec(ctx, `SELECT 1 FROM notification_email_deliveries WHERE id=$1 FOR UPDATE`, first); err != nil {
		t.Fatal(err)
	}
	mailer := &fakeMailer{}
	s, _ := newTestSender(t, pool, mailer, nil)
	s.batch = 1
	tick(t, s, 1)
	if msgs := mailer.messages(); len(msgs) != 1 || msgs[0].DeliveryID != second.String() {
		t.Fatalf("claimed past the lock: %v", msgs)
	}
	if st := readState(t, pool, first); st.Status != "pending" || st.Attempts != 0 {
		t.Fatalf("locked row touched: %+v", st)
	}
	if err := lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	tick(t, s, 1)

	// Two instances racing over 12 deliveries.
	mustExec(t, pool, `DELETE FROM notifications`)
	mustExec(t, pool, `DELETE FROM notification_email_deliveries`)
	want := map[string]bool{}
	for range 12 {
		id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
		want[id.String()] = true
	}
	slow := func(ctx context.Context, m email.Message) (string, error) {
		time.Sleep(20 * time.Millisecond)
		return "p-" + m.DeliveryID, nil
	}
	ma, mb := &fakeMailer{send: slow}, &fakeMailer{send: slow}
	a, _ := newTestSender(t, pool, ma, nil)
	b, _ := newTestSender(t, pool, mb, nil)
	var wg sync.WaitGroup
	counts := make([]int, 2)
	for i, sd := range []*Sender{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := sd.Tick(ctx)
			if err != nil {
				t.Errorf("tick: %v", err)
			}
			counts[i] = n
		}()
	}
	wg.Wait()
	seen := map[string]int{}
	for _, m := range append(ma.messages(), mb.messages()...) {
		seen[m.DeliveryID]++
	}
	if len(seen) != 12 || counts[0]+counts[1] != 12 || len(ma.messages()) == 0 || len(mb.messages()) == 0 {
		t.Fatalf("split %v counts %v (a=%d b=%d)", seen, counts, len(ma.messages()), len(mb.messages()))
	}
	for id, n := range seen {
		if n != 1 || !want[id] {
			t.Fatalf("delivery %s sent %d times", id, n)
		}
		if st := readState(t, pool, uuid.MustParse(id)); st.Status != "sent" || st.Attempts != 1 {
			t.Fatalf("delivery %s: %+v", id, st)
		}
	}
}

// A sending row whose lease expired (crashed sender) is claimed again: sent,
// attempts counted twice.
func TestSenderReclaimsAnExpiredLease(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', attempts=1, lease_until=now() - interval '1 second' WHERE id=$1`, id)
	mailer := &fakeMailer{}
	s, _ := newTestSender(t, pool, mailer, nil)
	tick(t, s, 1)
	if st := readState(t, pool, id); st.Status != "sent" || st.Attempts != 2 || st.Leased || len(mailer.messages()) != 1 {
		t.Fatalf("reclaimed: %+v sent=%d", st, len(mailer.messages()))
	}
}

// Fenced finalize: sender A's lease expires during its send and sender B
// reclaims the delivery; A's late finalize (success or failure) arrives while
// B still holds it ('sending' under B's lease) and matches nothing — only
// the lease tells the two apart. B's result then stands. The stale finalize
// is logged without values.
func TestSenderFinalizeIsFencedByTheLease(t *testing.T) {
	for _, outcome := range []string{"success", "transient", "permanent"} {
		t.Run(outcome, func(t *testing.T) {
			pool := disposableDB(t)
			ctx := context.Background()
			w := newWorld(t, pool)
			id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
			bSending, releaseB := make(chan struct{}), make(chan struct{})
			mb := &fakeMailer{send: func(ctx context.Context, m email.Message) (string, error) {
				close(bSending)
				<-releaseB
				return "provider-B", nil
			}}
			b, _ := newTestSender(t, pool, mb, nil)
			bDone := make(chan error, 1)
			var logs bytes.Buffer
			ma := &fakeMailer{}
			a, _ := newTestSender(t, pool, ma, &logs)
			ma.send = func(sendCtx context.Context, m email.Message) (string, error) {
				mustExec(t, pool, `UPDATE notification_email_deliveries SET lease_until = now() - interval '1 second' WHERE id=$1`, id)
				go func() {
					n, err := b.Tick(ctx)
					if err == nil && n != 1 {
						err = errors.New("B claimed nothing")
					}
					bDone <- err
				}()
				select {
				case <-bSending:
				case <-time.After(15 * time.Second):
					t.Error("B never reclaimed the expired lease")
				}
				switch outcome {
				case "transient":
					return "", errTransient
				case "permanent":
					return "", permanentErr()
				}
				return "provider-A", nil
			}
			tick(t, a, 1)
			if st := readState(t, pool, id); st.Status != "sending" || !st.Leased || st.Attempts != 2 || st.ErrorClass != nil || st.Provider != nil {
				t.Fatalf("stale finalize overwrote B's claim: %+v", st)
			}
			close(releaseB)
			if err := <-bDone; err != nil {
				t.Fatal(err)
			}
			st := readState(t, pool, id)
			if st.Status != "sent" || str(st.Provider) != "provider-B" || st.Attempts != 2 || st.Leased || st.ErrorClass != nil {
				t.Fatalf("after B: %+v provider=%s", st, str(st.Provider))
			}
			if !strings.Contains(logs.String(), `"step":"finalize"`) || !strings.Contains(logs.String(), `"stale":true`) ||
				!strings.Contains(logs.String(), id.String()) || strings.Contains(logs.String(), w.address[w.recruiter]) {
				t.Fatalf("stale finalize log:\n%s", logs.String())
			}
		})
	}
}

// D11 re-check at send: each reason finalizes skipped with its skip_reason,
// the lease cleared and no email sent. Mandatory deliveries are never skipped
// for being read; hidden rows are never read, so they never cause a skip.
func TestSenderSkipReasons(t *testing.T) {
	no := false
	cases := []struct {
		name    string
		prepare func(t *testing.T, pool *pgxpool.Pool, w world) seed
		reason  string // "" = sent
	}{
		{"soft-deleted recipient", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			mustExec(t, pool, `UPDATE users SET deleted_at=now() WHERE id=$1`, w.recruiter)
			return seed{typ: "vacancy_assigned", recipient: w.recruiter}
		}, "recipient_gone"},
		{"member left the company", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			mustExec(t, pool, `DELETE FROM company_members WHERE user_id=$1`, w.recruiter)
			return seed{typ: "vacancy_assigned", recipient: w.recruiter}
		}, "recipient_gone"},
		{"company soft-deleted", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			mustExec(t, pool, `UPDATE companies SET deleted_at=now() WHERE id=$1`, w.company)
			return seed{typ: "vacancy_assigned", recipient: w.recruiter}
		}, "recipient_gone"},
		{"soft-deleted candidate", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			mustExec(t, pool, `UPDATE users SET deleted_at=now() WHERE id=$1`, w.candidate)
			return seed{typ: "candidate_status_changed", recipient: w.candidate, payload: `{"status":"closed"}`}
		}, "recipient_gone"},
		{"blank address", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			mustExec(t, pool, `UPDATE users SET email='   ' WHERE id=$1`, w.recruiter)
			return seed{typ: "vacancy_assigned", recipient: w.recruiter}
		}, "no_address"},
		{"suppressed address, even mandatory", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			mustExec(t, pool, `UPDATE users SET email=$2 WHERE id=$1`, w.recruiter, "  "+strings.ToUpper(w.address[w.recruiter])+" ")
			mustExec(t, pool, `INSERT INTO email_suppressions(address,reason) VALUES($1,'manual')`, w.address[w.recruiter])
			return seed{typ: "vacancy_assigned", recipient: w.recruiter}
		}, "suppressed"},
		{"preference turned off", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			setEmail(t, pool, w.owner, &w.company, "application_received", false)
			return seed{typ: "application_received", recipient: w.owner, rows: 2}
		}, "preference_off"},
		{"candidate preference off (company NULL)", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			setEmail(t, pool, w.candidate, nil, "candidate_status_changed", false)
			return seed{typ: "candidate_status_changed", recipient: w.candidate, payload: `{"status":"closed"}`}
		}, "preference_off"},
		{"operational default off", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			return seed{typ: "psychometric_completed", recipient: w.owner, rows: 2}
		}, "preference_off"},
		{"off in another company only", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			other := uuid.New()
			mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Other',$2,'technology','active')`, other, uuid.NewString())
			setEmail(t, pool, w.owner, &w.company, "application_received", true)
			setEmail(t, pool, w.owner, &other, "application_received", false)
			return seed{typ: "application_received", recipient: w.owner, rows: 2}
		}, ""},
		{"all linked rows resolved", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			return seed{typ: "delivery_overdue", recipient: w.owner}
		}, "resolved"},
		{"all linked rows read (non-mandatory)", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			setEmail(t, pool, w.owner, &w.company, "application_received", true)
			return seed{typ: "application_received", recipient: w.owner, rows: 2}
		}, "read"},
		{"mandatory never skipped for being read", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			return seed{typ: "vacancy_assigned", recipient: w.recruiter}
		}, ""},
		{"hidden rows are never read", func(t *testing.T, pool *pgxpool.Pool, w world) seed {
			setEmail(t, pool, w.owner, &w.company, "application_received", true)
			return seed{typ: "application_received", recipient: w.owner, rows: 2, inApp: &no}
		}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			pool := disposableDB(t)
			w := newWorld(t, pool)
			sd := tc.prepare(t, pool, w)
			sd.due = true
			id, rows := w.deliver(t, pool, sd)
			switch tc.name {
			case "all linked rows resolved":
				mustExec(t, pool, `UPDATE notifications SET resolved_at=now() WHERE id = ANY($1)`, rows)
			case "all linked rows read (non-mandatory)", "mandatory never skipped for being read":
				mustExec(t, pool, `UPDATE notifications SET read_at=now() WHERE id = ANY($1)`, rows)
			}
			mailer := &fakeMailer{}
			s, throttle := newTestSender(t, pool, mailer, nil)
			tick(t, s, 1)
			st := readState(t, pool, id)
			if tc.reason == "" {
				if st.Status != "sent" || len(mailer.messages()) != 1 || throttle.waits != 1 {
					t.Fatalf("want sent: %+v mails=%d waits=%d", st, len(mailer.messages()), throttle.waits)
				}
				return
			}
			if st.Status != "skipped" || str(st.SkipReason) != tc.reason || st.Leased || st.Sent || st.Attempts != 1 ||
				len(mailer.messages()) != 0 || throttle.waits != 0 {
				t.Fatalf("want skipped %s: %+v reason=%s mails=%d waits=%d", tc.reason, st, str(st.SkipReason), len(mailer.messages()), throttle.waits)
			}
		})
	}
}

// Some linked rows still unresolved / unread: the email goes out, with the
// count of every linked row.
func TestSenderPartiallyReadOrResolvedGroupIsSent(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	setEmail(t, pool, w.owner, &w.company, "application_received", true)
	_, rows := w.deliver(t, pool, seed{typ: "application_received", recipient: w.owner, rows: 3, due: true})
	mustExec(t, pool, `UPDATE notifications SET read_at=now() WHERE id = ANY($1)`, rows[:2])
	mustExec(t, pool, `UPDATE notifications SET resolved_at=now() WHERE id = $1`, rows[0])
	mailer := &fakeMailer{}
	s, _ := newTestSender(t, pool, mailer, nil)
	tick(t, s, 1)
	if msgs := mailer.messages(); len(msgs) != 1 || msgs[0].Subject != "3 postulaciones nuevas en "+testTitle {
		t.Fatalf("partial group: %v", msgs)
	}
}

// Transient failures retry with backoff 1 min·2^(n−1) capped at 1 h; the 8th
// attempt gives up as failed (transient). Every finalize clears the lease.
func TestSenderRetriesWithBackoffAndGivesUpAtEight(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mailer := &fakeMailer{send: func(ctx context.Context, m email.Message) (string, error) { return "", errTransient }}
	var logs bytes.Buffer
	s, _ := newTestSender(t, pool, mailer, &logs)
	wantBackoff := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 16 * time.Minute, 32 * time.Minute, time.Hour}
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		tick(t, s, 1)
		st := readState(t, pool, id)
		if attempt < MaxAttempts {
			if st.Status != "retry" || st.Attempts != attempt || st.Leased || !st.NextRetry || st.RetryIn != wantBackoff[attempt-1] || str(st.ErrorClass) != "transient" {
				t.Fatalf("attempt %d: %+v class=%s", attempt, st, str(st.ErrorClass))
			}
			tick(t, s, 0) // in backoff
			mustExec(t, pool, `UPDATE notification_email_deliveries SET next_attempt_at = now() - interval '1 second' WHERE id=$1`, id)
			continue
		}
		if st.Status != "failed" || st.Attempts != MaxAttempts || st.Leased || st.NextRetry || str(st.ErrorClass) != "transient" {
			t.Fatalf("give up: %+v", st)
		}
	}
	tick(t, s, 0)
	if len(mailer.messages()) != MaxAttempts {
		t.Fatalf("sends %d", len(mailer.messages()))
	}
	if !strings.Contains(logs.String(), `"error_class":"transient"`) || strings.Contains(logs.String(), errTransient.Error()) {
		t.Fatalf("retry logs:\n%s", logs.String())
	}
}

// A permanent failure (ErrPermanent) fails at once; a delivery that cannot
// render (an unknown label code) fails permanently without a send.
func TestSenderPermanentFailures(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mailer := &fakeMailer{send: func(ctx context.Context, m email.Message) (string, error) { return "", permanentErr() }}
	var logs bytes.Buffer
	s, _ := newTestSender(t, pool, mailer, &logs)
	tick(t, s, 1)
	if st := readState(t, pool, id); st.Status != "failed" || str(st.ErrorClass) != "permanent" || st.Attempts != 1 || st.Leased || st.NextRetry {
		t.Fatalf("permanent: %+v", st)
	}
	bad, _ := w.deliver(t, pool, seed{typ: "vacancy_team_added", recipient: w.recruiter, payload: `{"function":"chief"}`, due: true})
	tick(t, s, 1)
	if st := readState(t, pool, bad); st.Status != "failed" || str(st.ErrorClass) != "permanent" || len(mailer.messages()) != 1 {
		t.Fatalf("render failure: %+v sends=%d", st, len(mailer.messages()))
	}
	if !strings.Contains(logs.String(), `"step":"render"`) || strings.Contains(logs.String(), "chief") {
		t.Fatalf("render log:\n%s", logs.String())
	}
}

// The throttle is taken once per email actually sent (never for skips) and,
// when it cannot be had (shutdown), nothing is sent and the attempt retries.
func TestSenderThrottle(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	for range 3 {
		w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	}
	w.deliver(t, pool, seed{typ: "psychometric_completed", recipient: w.owner, due: true}) // default off → skipped
	mailer := &fakeMailer{}
	s, throttle := newTestSender(t, pool, mailer, nil)
	tick(t, s, 4)
	if throttle.waits != 3 || len(mailer.messages()) != 3 {
		t.Fatalf("waits=%d sends=%d", throttle.waits, len(mailer.messages()))
	}

	id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	throttle.err = context.Canceled
	tick(t, s, 1)
	if st := readState(t, pool, id); st.Status != "retry" || st.Leased || len(mailer.messages()) != 3 {
		t.Fatalf("no token: %+v sends=%d", st, len(mailer.messages()))
	}
}

// The real bucket paces sends at the configured rate per instance.
func TestSenderPacesWithTheBucket(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	for range 3 {
		w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	}
	mailer := &fakeMailer{}
	s := New(senderPool(t, pool), testRenderer(t), mailer, NewBucket(10, nil, nil), nil)
	start := time.Now()
	tick(t, s, 3)
	if elapsed := time.Since(start); elapsed < 180*time.Millisecond {
		t.Fatalf("3 sends at 10/s took %s", elapsed)
	}
}

// Logs carry delivery id, type, step, attempt, error class and SQLSTATE only:
// never the address, subject, body or provider error text.
func TestSenderLogsAreValueFree(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	id, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	secret := "smtp said: mailbox " + w.address[w.recruiter] + " unavailable"
	mailer := &fakeMailer{send: func(ctx context.Context, m email.Message) (string, error) { return "", errors.New(secret) }}
	var logs bytes.Buffer
	s, _ := newTestSender(t, pool, mailer, &logs)
	tick(t, s, 1)
	out := logs.String()
	for _, leak := range []string{w.address[w.recruiter], testTitle, "Te asignaron", "mailbox"} {
		if strings.Contains(out, leak) {
			t.Fatalf("log leaked %q:\n%s", leak, out)
		}
	}
	for _, want := range []string{`"delivery_id":"` + id.String() + `"`, `"type":"vacancy_assigned"`, `"step":"send"`, `"attempt":1`, `"error_class":"transient"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("log misses %s:\n%s", want, out)
		}
	}
}

type visibleStatus struct{}

func (visibleStatus) Status(job, stage uuid.UUID, discarded bool) string { return "in_process" }

// End to end with the log adapter: a captured event is fanned out into a
// notification and its immediate delivery (candidate_test_pending, email on
// by default, Q1), and the sender sends it: sent, one value-free log line.
func TestSenderEndToEndWithTheLogMailer(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	invitation := uuid.New()
	event := uuid.Must(uuid.NewV7())
	mustExec(t, pool, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id,participation_id,payload,occurred_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,now())`, event, uuid.New(), w.company, audit.EventPsychometricInvitationCreated, w.job, w.participation,
		`{"invitation_id":"`+invitation.String()+`"}`)
	p := fanout.NewProcessor(pool, fanout.NewPlanner(visibleStatus{}), slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))).WithEmailDeliveries(true)
	if n, err := p.Tick(context.Background()); err != nil || n != 1 {
		t.Fatalf("fan-out: %d %v", n, err)
	}
	var delivery uuid.UUID
	if err := pool.QueryRow(context.Background(), `SELECT d.id FROM notification_email_deliveries d JOIN notifications n ON n.email_delivery_id = d.id
		WHERE n.source_event_id=$1 AND n.type='candidate_test_pending' AND d.status='pending'`, event).Scan(&delivery); err != nil {
		t.Fatalf("delivery of the fanned-out notification: %v", err)
	}
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	s := New(senderPool(t, pool), testRenderer(t), logmail.New(logger), NewBucket(1000, nil, nil), logger)
	tick(t, s, 1)
	st := readState(t, pool, delivery)
	if st.Status != "sent" || str(st.Provider) != "<"+delivery.String()+"@peopleflow.test>" {
		t.Fatalf("e2e: %+v provider=%s", st, str(st.Provider))
	}
	out := logs.String()
	if !strings.Contains(out, `"delivery_id":"`+delivery.String()+`"`) || !strings.Contains(out, `"template":"candidate_test_pending"`) ||
		!strings.Contains(out, `"has_unsubscribe":true`) || strings.Contains(out, w.address[w.candidate]) {
		t.Fatalf("log mailer output:\n%s", out)
	}
}
