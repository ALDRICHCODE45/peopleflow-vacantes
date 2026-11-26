//go:build integration

package capture_test

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/capture"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type capturedRow struct {
	company, job                     uuid.UUID
	eventType                        string
	actor, participation, subject    *uuid.UUID
	payload                          map[string]any
	attempts                         int
	processed, failed, sameAuditTime bool
}

func readCaptured(t *testing.T, pool *pgxpool.Pool, auditID uuid.UUID) (capturedRow, bool) {
	t.Helper()
	var row capturedRow
	var payload []byte
	err := pool.QueryRow(context.Background(), `SELECT e.company_id, e.job_id, e.event_type, e.actor_user_id, e.participation_id, e.subject_user_id, e.payload,
		e.attempts, e.processed_at IS NOT NULL, e.failed, e.occurred_at = a.occurred_at
		FROM notification_events e JOIN audit_events a ON a.id = e.audit_event_id WHERE e.audit_event_id = $1`, auditID).
		Scan(&row.company, &row.job, &row.eventType, &row.actor, &row.participation, &row.subject, &payload, &row.attempts, &row.processed, &row.failed, &row.sameAuditTime)
	if errors.Is(err, pgx.ErrNoRows) {
		return capturedRow{}, false
	}
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(payload, &row.payload); err != nil {
		t.Fatal(err)
	}
	return row, true
}

func auditExists(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) bool {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM audit_events WHERE id = $1)`, id).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	return exists
}

// discardInTx is the discard domain write (board/discard.go): the participation
// UPDATE, with or without a candidate message, before the audit append.
func discardInTx(ctx context.Context, tx pgx.Tx, participation uuid.UUID, message *string) error {
	_, err := tx.Exec(ctx, `UPDATE process_participations SET previous_stage_id=stage_id, stage_id=$2, reason_group='recruiter', reason_code='profile_mismatch',
		discarded_at=now(), candidate_message=$3 WHERE id=$1`, participation, uuid.New(), message)
	return err
}

// §Capture: one notification_events row per notifiable audit type, ids per
// the contract table, in the same tx and clock as the audit row (D1, D3).
func TestCaptureWritesOneRowPerNotifiableType(t *testing.T) {
	pool, _ := disposableDB(t)
	ctx := context.Background()
	f := newFixture(t, pool)
	decorator := capture.New(auditpostgres.NewAuditEventRepository())
	member := f.candidate // any users row works as a subject FK target
	_, silent := addParticipation(t, pool, f.job)
	_, talkative := addParticipation(t, pool, f.job)
	invitation, entity := uuid.New(), uuid.New()
	message := "Gracias por participar"
	stages := map[string]string{"vacancy_id": f.job.String(), "from_stage_id": "s-from", "to_stage_id": "s-to", "version": "2", "hire": "false", "departure": "false"}
	stageMove := map[string]any{"from_stage_id": "s-from", "to_stage_id": "s-to"}
	jobStr, partStr := f.job.String(), f.participation.String()

	for _, tc := range []struct {
		name          string
		event         audit.AuditEvent
		domainWrite   func(pgx.Tx) error
		participation *uuid.UUID
		subject       *uuid.UUID
		payload       map[string]any
		system        bool
	}{
		{name: "VacancyApplicationSubmitted", event: audit.AuditEvent{EventType: audit.EventVacancyApplicationSubmitted, EntityType: "process_participation", EntityID: f.participation,
			Metadata: map[string]string{"vacancy_id": jobStr, "stage_id": "s1", "source": "organic"}}, participation: &f.participation, payload: map[string]any{}},
		{name: "VacancyTeamCreated", event: audit.AuditEvent{EventType: audit.EventVacancyTeamCreated, EntityType: "vacancy", EntityID: f.job,
			Metadata: map[string]string{"company_id": f.company.String(), "mode": "with_responsible", "responsible_user_id": member.String(), "assignment_id": "a-1"}},
			subject: &member, payload: map[string]any{"assignment_id": "a-1"}},
		{name: "VacancyResponsibleReassigned", event: audit.AuditEvent{EventType: audit.EventVacancyResponsibleReassigned, EntityType: "vacancy", EntityID: f.job,
			Metadata: map[string]string{"company_id": f.company.String(), "reassignment_id": "r-1", "from_user_id": f.recruiter.String(), "to_user_id": member.String(),
				"from_assignment_id": "a-1", "to_assignment_id": "a-2", "reason": "workload", "previous_responsible": "remove"}},
			subject: &member, payload: map[string]any{"reassignment_id": "r-1", "from_user_id": f.recruiter.String(), "reason": "workload"}},
		{name: "VacancyTeamMemberAdded", event: audit.AuditEvent{EventType: audit.EventVacancyTeamMemberAdded, EntityType: "vacancy", EntityID: f.job,
			Metadata: map[string]string{"company_id": f.company.String(), "assignment_id": "a-3", "user_id": member.String(), "function": "collaborator", "recruiter_deadline": ""}},
			subject: &member, payload: map[string]any{"assignment_id": "a-3", "function": "collaborator"}},
		{name: "PsychometricAssessmentFinished", event: audit.AuditEvent{EventType: audit.EventPsychometricAssessmentFinished, EntityType: "psychometric_invitation", EntityID: invitation,
			Metadata: map[string]string{"vacancy_id": jobStr, "participation_id": partStr}}, participation: &f.participation, payload: map[string]any{"invitation_id": invitation.String()}},
		{name: "PsychometricInvitationCreated (system)", system: true, event: audit.AuditEvent{EventType: audit.EventPsychometricInvitationCreated, EntityType: "psychometric_invitation", EntityID: entity,
			Metadata: map[string]string{"vacancy_id": jobStr, "participation_id": partStr}}, participation: &f.participation, payload: map[string]any{"invitation_id": entity.String()}},
		{name: "ParticipationMoved", event: audit.AuditEvent{EventType: audit.EventParticipationMoved, EntityType: "process_participation", EntityID: f.participation, Metadata: stages},
			participation: &f.participation, payload: stageMove},
		{name: "ParticipationRecovered", event: audit.AuditEvent{EventType: audit.EventParticipationRecovered, EntityType: "process_participation", EntityID: f.participation,
			Metadata: map[string]string{"vacancy_id": jobStr, "from_stage_id": "s-from", "to_stage_id": "s-to", "version": "3", "hire": "false", "departure": "false", "recovery_override": "false", "previous_stage_id": "s-to"}},
			participation: &f.participation, payload: stageMove},
		{name: "ParticipationDiscarded without message", event: audit.AuditEvent{EventType: audit.EventParticipationDiscarded, EntityType: "process_participation", EntityID: silent, Metadata: stages},
			domainWrite: func(tx pgx.Tx) error { return discardInTx(ctx, tx, silent, nil) }, participation: &silent,
			payload: map[string]any{"from_stage_id": "s-from", "to_stage_id": "s-to", "has_message": false}},
		{name: "ParticipationDiscarded with message", event: audit.AuditEvent{EventType: audit.EventParticipationDiscarded, EntityType: "process_participation", EntityID: talkative, Metadata: stages},
			domainWrite: func(tx pgx.Tx) error { return discardInTx(ctx, tx, talkative, &message) }, participation: &talkative,
			payload: map[string]any{"from_stage_id": "s-from", "to_stage_id": "s-to", "has_message": true}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			event := tc.event
			event.ID, event.CompanyID, event.ActorType, event.ActorID = uuid.Must(uuid.NewV7()), &f.company, audit.ActorTypeUser, &f.recruiter
			if tc.system {
				event.ActorType, event.ActorID = audit.ActorTypeSystem, nil
			}
			if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				if tc.domainWrite != nil {
					if err := tc.domainWrite(tx); err != nil {
						return err
					}
				}
				return decorator.Append(ctx, tx, event)
			}); err != nil {
				t.Fatal(err)
			}
			row, ok := readCaptured(t, pool, event.ID)
			if !ok {
				t.Fatal("no notification_events row")
			}
			var wantActor *uuid.UUID
			if !tc.system {
				wantActor = &f.recruiter
			}
			if row.company != f.company || row.job != f.job || row.eventType != event.EventType || !reflect.DeepEqual(row.actor, wantActor) ||
				!reflect.DeepEqual(row.participation, tc.participation) || !reflect.DeepEqual(row.subject, tc.subject) || !reflect.DeepEqual(row.payload, tc.payload) {
				t.Fatalf("row %+v", row)
			}
			if row.attempts != 0 || row.processed || row.failed || !row.sameAuditTime {
				t.Fatalf("pending state / clock: %+v", row)
			}
			if strings.Contains(string(mustJSON(t, row.payload)), message) {
				t.Fatal("candidate message leaked into the payload")
			}
		})
	}
	var total int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification_events`).Scan(&total); err != nil || total != 10 {
		t.Fatalf("notification_events = %d: %v", total, err)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// Non-notifiable types keep their audit row and capture nothing (§Capture).
func TestCaptureSkipsNonNotifiableTypes(t *testing.T) {
	pool, _ := disposableDB(t)
	ctx := context.Background()
	f := newFixture(t, pool)
	decorator := capture.New(auditpostgres.NewAuditEventRepository())
	for _, event := range []audit.AuditEvent{
		{EventType: audit.EventVacancyCandidateAddedManually, EntityType: "process_participation", EntityID: f.participation, Metadata: map[string]string{"vacancy_id": f.job.String()}},
		{EventType: audit.EventParticipationSubstateChanged, EntityType: "process_participation", EntityID: f.participation, Metadata: map[string]string{"vacancy_id": f.job.String()}},
		{EventType: audit.EventVacancyTeamMemberRemoved, EntityType: "vacancy", EntityID: f.job, Metadata: map[string]string{"user_id": f.recruiter.String()}},
		{EventType: audit.EventVacancyDeliveryFulfilled, EntityType: "vacancy", EntityID: f.job, Metadata: map[string]string{"vacancy_id": f.job.String()}},
		{EventType: audit.EventCompanyUpdated, EntityType: audit.EntityCompany, EntityID: f.company, Metadata: map[string]string{}},
	} {
		event.ID, event.CompanyID, event.ActorType, event.ActorID = uuid.Must(uuid.NewV7()), &f.company, audit.ActorTypeUser, &f.recruiter
		if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error { return decorator.Append(ctx, tx, event) }); err != nil {
			t.Fatal(event.EventType, err)
		}
		if !auditExists(t, pool, event.ID) {
			t.Fatal(event.EventType, "audit row missing")
		}
		if _, ok := readCaptured(t, pool, event.ID); ok {
			t.Fatal(event.EventType, "captured a non-notifiable type")
		}
	}
}

// D1 fail-closed: when the capture insert fails, the caller's tx rolls back
// the domain write and the audit row with it.
func TestCaptureFailureRollsBackAuditAndDomainWrite(t *testing.T) {
	pool, _ := disposableDB(t)
	ctx := context.Background()
	f := newFixture(t, pool)
	decorator := capture.New(auditpostgres.NewAuditEventRepository())
	duplicated := uuid.Must(uuid.NewV7())
	// A capture row already holding this audit id makes the insert violate the UNIQUE.
	mustExec(t, pool, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id) VALUES($1,$2,$3,'VacancyApplicationSubmitted',$4)`,
		uuid.New(), duplicated, f.company, f.job)
	message := "Mensaje"
	for name, tc := range map[string]struct {
		id    uuid.UUID
		event audit.AuditEvent
		code  string
	}{
		"unique audit_event_id": {duplicated, audit.AuditEvent{EventType: audit.EventParticipationDiscarded, EntityType: "process_participation", EntityID: f.participation,
			Metadata: map[string]string{"vacancy_id": f.job.String(), "from_stage_id": "a", "to_stage_id": "b", "version": "2", "hire": "false", "departure": "false"}}, "23505"},
		"subject FK": {uuid.Must(uuid.NewV7()), audit.AuditEvent{EventType: audit.EventVacancyTeamMemberAdded, EntityType: "vacancy", EntityID: f.job,
			Metadata: map[string]string{"company_id": f.company.String(), "assignment_id": "a", "user_id": uuid.NewString(), "function": "member", "recruiter_deadline": ""}}, "23503"},
	} {
		t.Run(name, func(t *testing.T) {
			event := tc.event
			event.ID, event.CompanyID, event.ActorType, event.ActorID = tc.id, &f.company, audit.ActorTypeUser, &f.recruiter
			err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
				if err := discardInTx(ctx, tx, f.participation, &message); err != nil {
					return err
				}
				return decorator.Append(ctx, tx, event)
			})
			if err == nil || !strings.Contains(err.Error(), tc.code) || !strings.Contains(err.Error(), "capture notification event") {
				t.Fatalf("want capture failure %s, got %v", tc.code, err)
			}
			if auditExists(t, pool, event.ID) {
				t.Fatal("audit row survived the failed capture")
			}
			var discarded bool
			if err := pool.QueryRow(ctx, `SELECT discarded_at IS NOT NULL OR candidate_message IS NOT NULL FROM process_participations WHERE id=$1`, f.participation).Scan(&discarded); err != nil || discarded {
				t.Fatalf("domain write survived: %v %v", discarded, err)
			}
		})
	}
}
