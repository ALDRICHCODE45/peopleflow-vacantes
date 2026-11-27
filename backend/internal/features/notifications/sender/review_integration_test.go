//go:build integration

package sender

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/logmail"
)

// Review fixes of E6 (L20).

// R3/R4 attempt cap: a delivery stuck 'sending' with an expired lease whose
// attempts already reached MaxAttempts is never sent again: it ends failed
// (error_class transient, lease cleared) without a Mailer call. A row below
// the cap is still reclaimed and sent.
func TestSenderExpiredLeaseAtTheAttemptCapFails(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	stuck, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', attempts=$2, lease_until=now() - interval '1 second' WHERE id=$1`, stuck, MaxAttempts)
	below, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', attempts=$2, lease_until=now() - interval '1 second' WHERE id=$1`, below, MaxAttempts-1)
	live, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', attempts=$2, lease_until=now() + interval '1 minute' WHERE id=$1`, live, MaxAttempts)
	mailer := &fakeMailer{}
	var logs bytes.Buffer
	s, _ := newTestSender(t, pool, mailer, &logs)
	tick(t, s, 1)
	msgs := mailer.messages()
	if len(msgs) != 1 || msgs[0].DeliveryID != below.String() {
		t.Fatalf("sent %v (want only the row below the cap)", msgs)
	}
	if st := readState(t, pool, stuck); st.Status != "failed" || str(st.ErrorClass) != "transient" || st.Leased || st.NextRetry || st.Attempts != MaxAttempts {
		t.Fatalf("stuck at the cap: %+v class=%s", st, str(st.ErrorClass))
	}
	if st := readState(t, pool, below); st.Status != "sent" || st.Attempts != MaxAttempts {
		t.Fatalf("below the cap: %+v", st)
	}
	if st := readState(t, pool, live); st.Status != "sending" || !st.Leased {
		t.Fatalf("a live lease at the cap must be left to its sender: %+v", st)
	}
	if !strings.Contains(logs.String(), `"exhausted":1`) {
		t.Fatalf("exhausted rows not logged:\n%s", logs.String())
	}
}

// R4/R3 shutdown: cancelling the loop's context while the Mailer is mid-send
// does not cancel the send — the email completes and the delivery ends sent
// (not retry) — and no further delivery is claimed after the cancellation.
func TestSenderShutdownLetsTheInFlightSendComplete(t *testing.T) {
	pool := disposableDB(t)
	w := newWorld(t, pool)
	first, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	mustExec(t, pool, `UPDATE notification_email_deliveries SET send_after = now() - interval '1 hour' WHERE id=$1`, first)
	second, _ := w.deliver(t, pool, seed{typ: "vacancy_assigned", recipient: w.recruiter, due: true})
	inSend, release := make(chan struct{}), make(chan struct{})
	mailer := &fakeMailer{}
	mailer.send = func(sendCtx context.Context, m email.Message) (string, error) {
		close(inSend)
		select { // a real adapter aborts when its context ends
		case <-release:
			return "provider-ok", nil
		case <-sendCtx.Done():
			return "", sendCtx.Err()
		}
	}
	s, _ := newTestSender(t, pool, mailer, nil)
	ctx, cancel := context.WithCancel(context.Background())
	type ticked struct {
		n   int
		err error
	}
	done := make(chan ticked, 1)
	go func() { n, err := s.Tick(ctx); done <- ticked{n, err} }()
	select {
	case <-inSend:
	case <-time.After(15 * time.Second):
		t.Fatal("never reached the send")
	}
	cancel()
	time.Sleep(100 * time.Millisecond) // let a cancellation propagate, if any
	close(release)
	var got ticked
	select {
	case got = <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("tick never returned")
	}
	if got.n != 1 || got.err != nil {
		t.Fatalf("tick: %+v", got)
	}
	if st := readState(t, pool, first); st.Status != "sent" || str(st.Provider) != "provider-ok" || st.Leased {
		t.Fatalf("in-flight delivery: %+v", st)
	}
	if st := readState(t, pool, second); st.Status != "pending" || st.Attempts != 0 {
		t.Fatalf("claimed after shutdown: %+v", st)
	}
}

// recordingLog sends through the log adapter and keeps each message for
// inspection.
type recordingLog struct {
	*logmail.Mailer
	sent []email.Message
}

func (r *recordingLog) Send(ctx context.Context, m email.Message) (string, error) {
	r.sent = append(r.sent, m)
	return r.Mailer.Send(ctx, m)
}

// R3 candidate without participation: a candidate delivery for a process the
// candidate no longer participates in is sent with the fallbacks («una
// empresa», «una vacante») and the L6 null-link path /candidato/postulaciones,
// never failed — end to end through the log adapter.
func TestSenderCandidateWithoutParticipationUsesTheFallbacks(t *testing.T) {
	cases := []struct {
		typ, payload, subject string
	}{
		{"candidate_status_changed", `{"status":"closed"}`, "Tu postulación a una vacante cambió de estado"},
		{"candidate_message_received", `{"status":"closed"}`, "una empresa te dejó un mensaje"},
		{"candidate_test_pending", `{"invitation_id":"0193c0de-0000-7000-8000-0000000000aa"}`, "Tienes una prueba psicométrica pendiente"},
	}
	pool := disposableDB(t)
	w := newWorld(t, pool)
	ids := map[string]string{}
	for _, tc := range cases {
		id, _ := w.deliver(t, pool, seed{typ: tc.typ, recipient: w.candidate, payload: tc.payload, due: true})
		ids[tc.typ] = id.String()
	}
	mustExec(t, pool, `DELETE FROM process_participations WHERE id=$1`, w.participation)
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	mailer := &recordingLog{Mailer: logmail.New(logger)}
	s := New(senderPool(t, pool), testRenderer(t), mailer, NewBucket(1000, nil, nil), logger)
	tick(t, s, len(cases))
	if len(mailer.sent) != len(cases) {
		t.Fatalf("sent %d:\n%s", len(mailer.sent), logs.String())
	}
	for _, m := range mailer.sent {
		var want string
		for _, tc := range cases {
			if tc.typ == m.Type {
				want = tc.subject
			}
		}
		if m.Subject != want || !strings.Contains(m.Text, "https://app.peopleflow.test/candidato/postulaciones\n") ||
			!strings.Contains(m.Text, "una empresa") || strings.Contains(m.Text, "Acme") || strings.Contains(m.Text, testTitle) {
			t.Fatalf("%s: %q\n%s", m.Type, m.Subject, m.Text)
		}
	}
	for typ, id := range ids {
		if !strings.Contains(logs.String(), `"delivery_id":"`+id+`"`) {
			t.Fatalf("%s not logged by the log adapter:\n%s", typ, logs.String())
		}
	}
	for _, tc := range cases {
		var status string
		if err := pool.QueryRow(context.Background(), `SELECT status FROM notification_email_deliveries WHERE id=$1`, ids[tc.typ]).Scan(&status); err != nil || status != "sent" {
			t.Fatalf("%s: status %q %v", tc.typ, status, err)
		}
	}
}
