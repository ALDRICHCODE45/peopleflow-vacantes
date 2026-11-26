//go:build integration

package fanout

import (
	"context"
	"reflect"
	"sort"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// setPreference upserts one override row as the preferences PUT would
// (company nil = candidate tree, company_id NULL).
func setPreference(t *testing.T, pool *pgxpool.Pool, user uuid.UUID, company *uuid.UUID, typ, channel string, enabled bool) {
	t.Helper()
	mustExec(t, pool, `INSERT INTO notification_preferences(user_id,company_id,type,channel,enabled,source) VALUES($1,$2,$3,$4,$5,'settings')
		ON CONFLICT ON CONSTRAINT notification_preferences_key DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`, user, company, typ, channel, enabled)
}

type visibility struct {
	Type, Recipient string
	InApp           bool
}

func readVisibility(t *testing.T, pool *pgxpool.Pool, source uuid.UUID) []visibility {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT type, recipient_user_id::text, in_app FROM notifications WHERE source_event_id=$1 ORDER BY type, recipient_user_id`, source)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []visibility{}
	for rows.Next() {
		var v visibility
		if err := rows.Scan(&v.Type, &v.Recipient, &v.InApp); err != nil {
			t.Fatal(err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func sortedVisibility(in ...visibility) []visibility {
	sort.Slice(in, func(a, b int) bool {
		if in[a].Type != in[b].Type {
			return in[a].Type < in[b].Type
		}
		return in[a].Recipient < in[b].Recipient
	})
	return in
}

// notifications-v2 D6/D7 (E3): each row's in_app is the recipient's effective
// in_app preference at creation, keyed by (user, event company, type) for
// members and (user, NULL, type) for candidates; other recipients keep the
// default (visible). A later change never rewrites the row: re-processing
// (dedupe) with the channel back on leaves the old row hidden.
func TestFanOutWritesInAppFromThePreferenceAtCreation(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	otherCompany := uuid.New()
	mustExec(t, pool, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Other',$2,'technology','active')`, otherCompany, uuid.NewString())

	setPreference(t, pool, w.owner, &w.company, "application_received", "in_app", false)
	setPreference(t, pool, w.owner, &w.company, "application_received", "email", true) // other channel: irrelevant
	setPreference(t, pool, w.recruiter, &otherCompany, "application_received", "in_app", false)
	setPreference(t, pool, w.recruiter, &w.company, "psychometric_pending", "in_app", true) // explicit on
	setPreference(t, pool, w.candidate, nil, "candidate_test_pending", "in_app", false)

	application := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	invitation := w.insertEvent(t, pool, pending{eventType: audit.EventPsychometricInvitationCreated, participation: &w.participation, payload: map[string]any{"invitation_id": "inv"}})
	p := newTestProcessor(pool, nil)
	if claimed, err := p.Tick(ctx); err != nil || claimed != 2 {
		t.Fatalf("claimed=%d err=%v", claimed, err)
	}
	owner, recruiter, candidate := w.owner.String(), w.recruiter.String(), w.candidate.String()
	wantApplication := sortedVisibility(visibility{"application_received", owner, false}, visibility{"application_received", recruiter, true})
	if got := readVisibility(t, pool, application); !reflect.DeepEqual(got, wantApplication) {
		t.Fatalf("application:\n got %+v\nwant %+v", got, wantApplication)
	}
	wantInvitation := sortedVisibility(visibility{"candidate_test_pending", candidate, false},
		visibility{"psychometric_pending", owner, true}, visibility{"psychometric_pending", recruiter, true})
	if got := readVisibility(t, pool, invitation); !reflect.DeepEqual(got, wantInvitation) {
		t.Fatalf("invitation:\n got %+v\nwant %+v", got, wantInvitation)
	}

	// Turning the channel back on shows new items only (D6 point 4).
	setPreference(t, pool, w.owner, &w.company, "application_received", "in_app", true)
	setPreference(t, pool, w.candidate, nil, "candidate_test_pending", "in_app", true)
	mustExec(t, pool, `UPDATE notification_events SET processed_at = NULL WHERE id = ANY($1)`, []uuid.UUID{application, invitation})
	if claimed, err := p.Tick(ctx); err != nil || claimed != 2 {
		t.Fatalf("re-process claimed=%d err=%v", claimed, err)
	}
	if got := readVisibility(t, pool, application); !reflect.DeepEqual(got, wantApplication) {
		t.Fatalf("re-processed application revealed a hidden row: %+v", got)
	}
	if got := readVisibility(t, pool, invitation); !reflect.DeepEqual(got, wantInvitation) {
		t.Fatalf("re-processed invitation revealed a hidden row: %+v", got)
	}
	later := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	if _, err := p.Tick(ctx); err != nil {
		t.Fatal(err)
	}
	wantLater := sortedVisibility(visibility{"application_received", owner, true}, visibility{"application_received", recruiter, true})
	if got := readVisibility(t, pool, later); !reflect.DeepEqual(got, wantLater) {
		t.Fatalf("new event after re-enabling:\n got %+v\nwant %+v", got, wantLater)
	}
}

// A mandatory type is always visible: even an override row that the table
// CHECK normally refuses (dropped here, disposable database) is ignored.
func TestFanOutMandatoryTypeIgnoresAnInAppOverride(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	mustExec(t, pool, `ALTER TABLE notification_preferences DROP CONSTRAINT notification_preferences_type_check`)
	setPreference(t, pool, w.recruiter, &w.company, "vacancy_reassigned", "in_app", false)
	setPreference(t, pool, w.owner, &w.company, "vacancy_unassigned", "in_app", false)
	reassigned := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyResponsibleReassigned, actor: &w.admin, subject: &w.recruiter,
		payload: map[string]any{"reassignment_id": "r", "from_user_id": w.owner.String(), "reason": "workload"}})
	if claimed, err := newTestProcessor(pool, nil).Tick(ctx); err != nil || claimed != 1 {
		t.Fatalf("claimed=%d err=%v", claimed, err)
	}
	want := sortedVisibility(visibility{"vacancy_reassigned", w.recruiter.String(), true}, visibility{"vacancy_unassigned", w.owner.String(), true})
	if got := readVisibility(t, pool, reassigned); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

// D8 (E4 hook): the insert reports whether a row was actually created —
// true once, false on the dedupe conflict — and writes the given in_app.
func TestInsertNotificationReportsWhetherARowWasInserted(t *testing.T) {
	pool := disposableDB(t)
	ctx := context.Background()
	w := newWorld(t, pool)
	event := w.insertEvent(t, pool, pending{eventType: audit.EventVacancyApplicationSubmitted, actor: &w.candidate, participation: &w.participation})
	n := Notification{ID: uuid.Must(uuid.NewV7()), RecipientUserID: w.owner, RecipientKind: domain.RecipientMember, Reason: domain.RelationTeam,
		CompanyID: &w.company, Type: domain.TypeApplicationReceived, GroupKey: "applications:" + w.job.String() + ":2026-11-26", JobID: w.job,
		SourceEventID: event, Payload: map[string]any{}}
	q := db.New(pool)
	if inserted, err := insert(ctx, q, n, false); err != nil || !inserted {
		t.Fatalf("first insert: inserted=%v err=%v", inserted, err)
	}
	n.ID = uuid.Must(uuid.NewV7())
	if inserted, err := insert(ctx, q, n, true); err != nil || inserted {
		t.Fatalf("conflicting insert: inserted=%v err=%v", inserted, err)
	}
	want := []visibility{{"application_received", w.owner.String(), false}}
	if got := readVisibility(t, pool, event); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v want %+v", got, want)
	}
}
