//go:build integration

package fanout

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newTestProcessor(pool *pgxpool.Pool, logs *bytes.Buffer) *Processor {
	var logger *slog.Logger
	if logs != nil {
		logger = slog.New(slog.NewJSONHandler(logs, nil))
	}
	return NewProcessor(pool, NewPlanner(initialStatus{initialStage}), logger)
}

// §Recipients against current data: team = active assignments of active
// non-stakeholder members; assignee only while active; previous assignee
// while a member; candidate only with an account; actor excluded; rows carry
// kind/reason/company/group key/payload; every event ends processed.
func TestFanOutResolvesRecipientsFromCurrentData(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	str := func(id uuid.UUID) string { return id.String() }
	application := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation,
		occurredAt: time.Date(2026, 11, 27, 5, 30, 0, 0, time.UTC)})
	invitation := w.insertEvent(t, pool, pending{eventType: audit.EventPsychometricInvitationCreated, participation: &w.participation, payload: map[string]any{"invitation_id": "inv"},
		occurredAt: time.Date(2026, 11, 27, 6, 30, 0, 0, time.UTC)})
	reassigned := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyResponsibleReassigned, actor: &w.admin, subject: &w.recruiter,
		payload: map[string]any{"reassignment_id": "r", "from_user_id": str(w.owner), "reason": "workload"}})
	toExMember := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyTeamCreated, actor: &w.admin, subject: &w.exMember, payload: map[string]any{"assignment_id": "a"}})
	toEnded := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyTeamMemberAdded, actor: &w.admin, subject: &w.ended, payload: map[string]any{"function": "member"}})
	toStakeholderPrev := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyResponsibleReassigned, actor: &w.owner, subject: &w.owner,
		payload: map[string]any{"from_user_id": str(w.stakeholder), "reason": "other"}})
	discard := w.insertEvent(t, pool, pending{eventType: audit.EventParticipationDiscarded, actor: &w.recruiter, participation: &w.participation,
		payload: map[string]any{"from_stage_id": str(later), "to_stage_id": str(later2), "has_message": true}})
	silentMove := w.insertEvent(t, pool, pending{eventType: audit.EventParticipationMoved, actor: &w.recruiter, participation: &w.participation,
		payload: map[string]any{"from_stage_id": str(later), "to_stage_id": str(later2)}})
	// Review finding 5: a real organic participation of the same candidate on a
	// second job of the company; the process_id predicate must keep it out.
	_, otherParticipation := w.addJobWithParticipation(t, pool)
	foreign := w.insertEvent(t, pool, pending{eventType: audit.EventPsychometricInvitationCreated, participation: &otherParticipation, payload: map[string]any{"invitation_id": "inv"},
		occurredAt: time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)})

	claimed, err := newTestProcessor(pool, nil).Tick(ctx)
	if err != nil || claimed != 9 {
		t.Fatalf("claimed=%d err=%v", claimed, err)
	}
	company := &w.company
	team := func(typ, key, payload string) []row {
		r := []row{{typ, str(w.owner), "member", "team", key, company, payload}, {typ, str(w.recruiter), "member", "team", key, company, payload}}
		if r[0].Recipient > r[1].Recipient {
			r[0], r[1] = r[1], r[0]
		}
		return r
	}
	cases := map[string]struct {
		event uuid.UUID
		want  []row
	}{
		"application → active team, MX date of 05:30Z": {application, team("application_received", "applications:"+str(w.job)+":2026-11-26", "{}")},
		"invitation → team (MX date 00:30) + candidate": {invitation, append(
			[]row{{"candidate_test_pending", str(w.candidate), "candidate", "candidate", "", nil, `{"invitation_id": "inv"}`}},
			team("psychometric_pending", "psychometrics_pending:"+str(w.job)+":2026-11-27", `{"invitation_id": "inv"}`)...)},
		"reassigned → new + previous": {reassigned, []row{
			{"vacancy_reassigned", str(w.recruiter), "member", "assignee", "", company, `{"reason": "workload", "from_user_id": "` + str(w.owner) + `"}`},
			{"vacancy_unassigned", str(w.owner), "member", "previous_assignee", "", company, `{"reason": "workload", "to_user_id": "` + str(w.recruiter) + `"}`}}},
		"assignee who is no longer a member":      {toExMember, nil},
		"assignee whose assignment ended":         {toEnded, nil},
		"actor subject + stakeholder previous":    {toStakeholderPrev, nil},
		"discard with message → candidate only":   {discard, []row{{"candidate_message_received", str(w.candidate), "candidate", "candidate", "", nil, `{"status": "closed"}`}}},
		"move keeping the visible status":         {silentMove, nil},
		"participation of another job: no target": {foreign, team("psychometric_pending", "psychometrics_pending:"+str(w.job)+":2026-03-01", `{"invitation_id": "inv"}`)},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got := readNotifications(t, pool, tc.event)
			for i := range got {
				if strings.HasPrefix(got[i].GroupKey, "n:") {
					got[i].GroupKey = "" // n:<notification id>, checked below
				}
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got  %+v\nwant %+v", got, tc.want)
			}
			if s := readEvent(t, pool, tc.event); !s.processed || s.failed || s.attempts != 0 {
				t.Fatalf("event state %+v", s)
			}
		})
	}
	var badSingles int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications WHERE group_key LIKE 'n:%' AND group_key <> 'n:' || id::text`).Scan(&badSingles); err != nil || badSingles != 0 {
		t.Fatalf("single group keys must be n:<id>: %d %v", badSingles, err)
	}
	var candidateActors, candidateRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE actor_user_id IS NOT NULL), count(*) FROM notifications WHERE recipient_kind = 'candidate'`).
		Scan(&candidateActors, &candidateRows); err != nil || candidateActors != 0 || candidateRows == 0 {
		t.Fatalf("candidate rows must store actor_user_id NULL: %d of %d %v", candidateActors, candidateRows, err)
	}
}

// D4: two concurrent claimers never hold the same event, and two processors
// racing over the same backlog claim every event exactly once.
func TestClaimSkipsLockedEvents(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	first := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation, occurredAt: time.Now().Add(-time.Minute)})
	second := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation})
	claim := func(tx pgx.Tx) (uuid.UUID, error) {
		r, err := db.New(tx).ClaimNextNotificationEvent(ctx, []uuid.UUID{})
		return r.ID, err
	}
	tx1, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx1.Rollback(ctx)
	tx2, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx2.Rollback(ctx)
	tx3, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx3.Rollback(ctx)
	a, errA := claim(tx1)
	b, errB := claim(tx2)
	_, errC := claim(tx3)
	if errA != nil || errB != nil || a != first || b != second || !errors.Is(errC, pgx.ErrNoRows) {
		t.Fatalf("a=%v(%v) b=%v(%v) c=%v", a, errA, b, errB, errC)
	}
	_ = tx1.Rollback(ctx)
	_ = tx2.Rollback(ctx)
	_ = tx3.Rollback(ctx)

	const backlog = 60
	for i := 0; i < backlog; i++ {
		w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation})
	}
	var wg sync.WaitGroup
	counts := make([]int, 2)
	errs := make([]error, 2)
	for i := range counts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			counts[i], errs[i] = newTestProcessor(pool, nil).Tick(ctx)
		}(i)
	}
	wg.Wait()
	var processed, rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE processed_at IS NOT NULL AND NOT failed AND attempts = 0) FROM notification_events`).Scan(&processed); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notifications`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if errs[0] != nil || errs[1] != nil || counts[0]+counts[1] != backlog+2 || processed != backlog+2 || rows != 2*(backlog+2) {
		t.Fatalf("counts=%v errs=%v processed=%d rows=%d", counts, errs, processed, rows)
	}
}

// §Scheduler: a failing event is rolled back, attempts++ in a separate tx,
// retried once per tick (it does not block later events), and after 10
// attempts it is failed + processed; logs carry type and id only.
func TestFailingEventRetriesThenGivesUpAfterTenAttempts(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	bad := w.insertEvent(t, pool, pending{eventType: audit.EventParticipationMoved, participation: &w.participation, occurredAt: time.Now().Add(-time.Minute),
		payload: map[string]any{"from_stage_id": "bogus-stage-value", "to_stage_id": "x"}})
	good := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation})
	var logs bytes.Buffer
	p := newTestProcessor(pool, &logs)
	for attempt := 1; attempt <= MaxAttempts; attempt++ {
		claimed, err := p.Tick(ctx)
		wantClaimed := 1
		if attempt == 1 {
			wantClaimed = 2
		}
		if err != nil || claimed != wantClaimed {
			t.Fatalf("attempt %d: claimed=%d err=%v", attempt, claimed, err)
		}
		s := readEvent(t, pool, bad)
		if s.attempts != attempt || s.processed != (attempt == MaxAttempts) || s.failed != (attempt == MaxAttempts) {
			t.Fatalf("attempt %d: %+v", attempt, s)
		}
		// Review finding 2: exponential backoff (30 s · 2^(n-1), cap 30 min);
		// not due → not claimed; given up → no next attempt.
		delay := readBackoff(t, pool, bad)
		if attempt == MaxAttempts {
			if delay != nil {
				t.Fatalf("given-up event keeps next_attempt_at: %v", *delay)
			}
			continue
		}
		want := RetryBase << (attempt - 1)
		if want > RetryCap {
			want = RetryCap
		}
		if delay == nil || *delay < want-5*time.Second || *delay > want+time.Second {
			t.Fatalf("attempt %d: backoff %v, want %v", attempt, delay, want)
		}
		if claimed, err := p.Tick(ctx); err != nil || claimed != 0 {
			t.Fatalf("attempt %d: event claimed before due: %d %v", attempt, claimed, err)
		}
		mustExec(t, pool, `UPDATE notification_events SET next_attempt_at = now() - interval '1 second' WHERE id = $1`, bad)
	}
	if s := readEvent(t, pool, good); !s.processed || s.attempts != 0 || len(readNotifications(t, pool, good)) != 2 {
		t.Fatalf("good event blocked: %+v", s)
	}
	if claimed, err := p.Tick(ctx); err != nil || claimed != 0 {
		t.Fatalf("given-up event claimed again: %d %v", claimed, err)
	}
	out := logs.String()
	if !strings.Contains(out, "notification fan-out gave up") || !strings.Contains(out, bad.String()) || !strings.Contains(out, audit.EventParticipationMoved) ||
		strings.Contains(out, "bogus-stage-value") || strings.Contains(out, w.participation.String()) {
		t.Fatalf("logs: %s", out)
	}
	if len(readNotifications(t, pool, bad)) != 0 {
		t.Fatal("failed event left rows")
	}
}

// D21: re-processing an event (crash after insert, or a second instance)
// inserts nothing twice; the dedupe unique absorbs it.
func TestReprocessingAnEventIsIdempotent(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	event := w.insertEvent(t, pool, pending{eventType: audit.EventPsychometricInvitationCreated, participation: &w.participation, payload: map[string]any{"invitation_id": "inv"}})
	p := newTestProcessor(pool, nil)
	if _, err := p.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	before := readNotifications(t, pool, event)
	if len(before) != 3 {
		t.Fatalf("rows=%d", len(before))
	}
	mustExec(t, pool, `UPDATE notification_events SET processed_at = NULL WHERE id = $1`, event)
	if claimed, err := p.Tick(ctx); err != nil || claimed != 1 {
		t.Fatalf("claimed=%d err=%v", claimed, err)
	}
	after := readNotifications(t, pool, event)
	if !reflect.DeepEqual(after, before) {
		t.Fatalf("re-processing changed rows:\n%+v\n%+v", before, after)
	}
	if s := readEvent(t, pool, event); !s.processed || s.attempts != 0 {
		t.Fatalf("state %+v", s)
	}
}

// readBackoff is next_attempt_at - now(), nil when there is no next attempt.
func readBackoff(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) *time.Duration {
	t.Helper()
	var ms *float64
	if err := pool.QueryRow(context.Background(), `SELECT EXTRACT(EPOCH FROM next_attempt_at - now()) * 1000 FROM notification_events WHERE id=$1`, id).Scan(&ms); err != nil {
		t.Fatal(err)
	}
	if ms == nil {
		return nil
	}
	d := time.Duration(*ms * float64(time.Millisecond))
	return &d
}

// Review finding 2: the claim skips events whose next attempt is not due yet.
func TestClaimSkipsEventsNotYetDue(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	notDue := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation, occurredAt: time.Now().Add(-time.Hour)})
	due := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation, occurredAt: time.Now().Add(-time.Minute)})
	fresh := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation})
	mustExec(t, pool, `UPDATE notification_events SET attempts = 1, next_attempt_at = now() + interval '1 minute' WHERE id = $1`, notDue)
	mustExec(t, pool, `UPDATE notification_events SET attempts = 1, next_attempt_at = now() - interval '1 second' WHERE id = $1`, due)
	if claimed, err := newTestProcessor(pool, nil).Tick(ctx); err != nil || claimed != 2 {
		t.Fatalf("claimed=%d err=%v", claimed, err)
	}
	if s := readEvent(t, pool, notDue); s.processed {
		t.Fatal("not-yet-due event claimed")
	}
	for _, id := range []uuid.UUID{due, fresh} {
		if s := readEvent(t, pool, id); !s.processed {
			t.Fatalf("due event %v not processed", id)
		}
	}
}

// panicStatus panics for one stage, standing in for any planner bug.
type panicStatus struct{ poison uuid.UUID }

func (s panicStatus) Status(_, stage uuid.UUID, discarded bool) string {
	if stage == s.poison {
		panic("poison " + stage.String())
	}
	return initialStatus{initialStage}.Status(uuid.Nil, stage, discarded)
}

// Review finding 1: a panicking event is rolled back and recorded as a failed
// attempt (type + id + step only in logs); later events are still processed.
func TestPanickingEventIsAFailedAttemptAndDoesNotBlock(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	poison := uuid.New()
	bad := w.insertEvent(t, pool, pending{eventType: audit.EventParticipationMoved, participation: &w.participation, occurredAt: time.Now().Add(-time.Minute),
		payload: map[string]any{"from_stage_id": poison.String(), "to_stage_id": later.String()}})
	good := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, participation: &w.participation})
	var logs bytes.Buffer
	p := NewProcessor(pool, NewPlanner(panicStatus{poison}), slog.New(slog.NewJSONHandler(&logs, nil)))
	claimed, err := p.Tick(ctx)
	if err != nil || claimed != 2 {
		t.Fatalf("claimed=%d err=%v", claimed, err)
	}
	if s := readEvent(t, pool, bad); s.attempts != 1 || s.processed || s.failed {
		t.Fatalf("poison state %+v", s)
	}
	if s := readEvent(t, pool, good); !s.processed || len(readNotifications(t, pool, good)) != 2 {
		t.Fatalf("later event blocked: %+v", s)
	}
	out := logs.String()
	if !strings.Contains(out, `"step":"panic"`) || !strings.Contains(out, bad.String()) || strings.Contains(out, poison.String()) {
		t.Fatalf("logs: %s", out)
	}
}
