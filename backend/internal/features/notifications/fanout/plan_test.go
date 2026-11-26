package fanout

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

// fakeDirectory is current data: active team per job, active assignees,
// members (non-stakeholder, company alive) and participation accounts.
type fakeDirectory struct {
	team       []uuid.UUID
	assignees  map[uuid.UUID]bool
	members    map[uuid.UUID]bool
	candidates map[uuid.UUID]uuid.UUID
	err        error
}

func (d fakeDirectory) Team(context.Context, uuid.UUID, uuid.UUID) ([]uuid.UUID, error) {
	return d.team, d.err
}
func (d fakeDirectory) ActiveAssignee(_ context.Context, _, _, user uuid.UUID) (bool, error) {
	return d.assignees[user], d.err
}
func (d fakeDirectory) Member(_ context.Context, _, user uuid.UUID) (bool, error) {
	return d.members[user], d.err
}
func (d fakeDirectory) Candidate(_ context.Context, _, participation uuid.UUID) (*uuid.UUID, error) {
	if c, ok := d.candidates[participation]; ok {
		return &c, d.err
	}
	return nil, d.err
}

// initialStatus mirrors CandidateStatus: the initial stage is "submitted".
type initialStatus struct{ initial uuid.UUID }

func (s initialStatus) Status(_, stage uuid.UUID, discarded bool) string {
	switch {
	case discarded:
		return "closed"
	case stage == s.initial:
		return "submitted"
	}
	return "in_process"
}

type planned struct {
	Type      domain.Type
	Recipient uuid.UUID
	Reason    domain.Relation
	Kind      domain.RecipientKind
	Payload   map[string]any
}

func summary(ns []Notification) []planned {
	out := make([]planned, 0, len(ns))
	for _, n := range ns {
		out = append(out, planned{n.Type, n.RecipientUserID, n.Reason, n.RecipientKind, n.Payload})
	}
	return out
}

var (
	company, job, actor         = uuid.New(), uuid.New(), uuid.New()
	alice, bob, carol           = uuid.New(), uuid.New(), uuid.New()
	initialStage, later, later2 = uuid.New(), uuid.New(), uuid.New()
	participation, candidate    = uuid.New(), uuid.New()
	manual                      = uuid.New()
)

func newPlanner() Planner {
	return NewPlanner(initialStatus{initialStage})
}

func event(eventType string, payload map[string]any) Event {
	a := actor
	p := participation
	return Event{ID: uuid.New(), CompanyID: company, EventType: eventType, ActorUserID: &a, JobID: job, ParticipationID: &p, Payload: payload,
		OccurredAt: time.Date(2026, 11, 26, 18, 0, 0, 0, time.UTC)}
}

func ptr(id uuid.UUID) *uuid.UUID { return &id }

func TestPlanRecipientsPerType(t *testing.T) {
	dir := fakeDirectory{
		team:       []uuid.UUID{alice, actor, bob, alice},
		assignees:  map[uuid.UUID]bool{alice: true, actor: true},
		members:    map[uuid.UUID]bool{bob: true, actor: true},
		candidates: map[uuid.UUID]uuid.UUID{participation: candidate},
	}
	invitation := uuid.NewString()
	reassigned := event(audit.EventVacancyResponsibleReassigned, map[string]any{"reassignment_id": "r", "from_user_id": bob.String(), "reason": "workload"})
	reassigned.ParticipationID, reassigned.SubjectUserID = nil, ptr(alice)
	assigned := event(audit.EventVacancyTeamCreated, map[string]any{"assignment_id": "a"})
	assigned.ParticipationID, assigned.SubjectUserID = nil, ptr(alice)
	added := event(audit.EventVacancyTeamMemberAdded, map[string]any{"assignment_id": "a", "function": "collaborator"})
	added.ParticipationID, added.SubjectUserID = nil, ptr(alice)
	team := func(typ domain.Type, payload map[string]any) []planned {
		return []planned{{typ, alice, domain.RelationTeam, domain.RecipientMember, payload}, {typ, bob, domain.RelationTeam, domain.RecipientMember, payload}}
	}
	cases := map[string]struct {
		event Event
		want  []planned
	}{
		"application → team, actor excluded, de-duplicated": {event(audit.EventVacancyApplicationSubmitted, map[string]any{}), team(domain.TypeApplicationReceived, map[string]any{})},
		"psychometric finished → team": {event(audit.EventPsychometricAssessmentFinished, map[string]any{"invitation_id": invitation}),
			team(domain.TypePsychometricCompleted, map[string]any{"invitation_id": invitation})},
		"invitation → team + candidate": {event(audit.EventPsychometricInvitationCreated, map[string]any{"invitation_id": invitation}),
			append(team(domain.TypePsychometricPending, map[string]any{"invitation_id": invitation}),
				planned{domain.TypeCandidateTestPending, candidate, domain.RelationCandidate, domain.RecipientCandidate, map[string]any{"invitation_id": invitation}})},
		"team created → assignee": {assigned, []planned{{domain.TypeVacancyAssigned, alice, domain.RelationAssignee, domain.RecipientMember, map[string]any{}}}},
		"member added → assignee": {added, []planned{{domain.TypeVacancyTeamAdded, alice, domain.RelationAssignee, domain.RecipientMember, map[string]any{"function": "collaborator"}}}},
		"reassigned → new + previous responsible (D10)": {reassigned, []planned{
			{domain.TypeVacancyReassigned, alice, domain.RelationAssignee, domain.RecipientMember, map[string]any{"from_user_id": bob.String(), "reason": "workload"}},
			{domain.TypeVacancyUnassigned, bob, domain.RelationPreviousAssignee, domain.RecipientMember, map[string]any{"to_user_id": alice.String(), "reason": "workload"}},
		}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := newPlanner().Plan(context.Background(), dir, tc.event)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(summary(got), tc.want) {
				t.Fatalf("got  %+v\nwant %+v", summary(got), tc.want)
			}
			for _, n := range got {
				if n.SourceEventID != tc.event.ID || n.JobID != job || !reflect.DeepEqual(n.ActorUserID, tc.event.ActorUserID) ||
					!reflect.DeepEqual(n.ParticipationID, tc.event.ParticipationID) {
					t.Fatalf("row ids: %+v", n)
				}
				if (n.RecipientKind == domain.RecipientCandidate) != (n.CompanyID == nil) || (n.CompanyID != nil && *n.CompanyID != company) {
					t.Fatalf("company_id per recipient kind: %+v", n)
				}
			}
		})
	}
}

func TestPlanExclusions(t *testing.T) {
	ctx := context.Background()
	member := map[uuid.UUID]bool{alice: true, bob: true}
	// Assignee no longer active on the job (or not a member any more) → nobody.
	assigned := event(audit.EventVacancyTeamCreated, map[string]any{})
	assigned.SubjectUserID = ptr(carol)
	if got, _ := newPlanner().Plan(ctx, fakeDirectory{assignees: map[uuid.UUID]bool{alice: true}}, assigned); len(got) != 0 {
		t.Fatalf("inactive assignee notified: %+v", summary(got))
	}
	// Actor assigning themselves is never notified.
	assigned.SubjectUserID = ptr(actor)
	if got, _ := newPlanner().Plan(ctx, fakeDirectory{assignees: map[uuid.UUID]bool{actor: true}}, assigned); len(got) != 0 {
		t.Fatalf("actor notified: %+v", summary(got))
	}
	// NULL subject (team without responsible) → no recipient, no error.
	assigned.SubjectUserID = nil
	if got, err := newPlanner().Plan(ctx, fakeDirectory{assignees: map[uuid.UUID]bool{alice: true}}, assigned); err != nil || len(got) != 0 {
		t.Fatalf("null subject: %+v %v", summary(got), err)
	}
	// Previous responsible no longer a member (or stakeholder) → only the new one.
	reassigned := event(audit.EventVacancyResponsibleReassigned, map[string]any{"from_user_id": carol.String(), "reason": "other"})
	reassigned.SubjectUserID = ptr(alice)
	got, _ := newPlanner().Plan(ctx, fakeDirectory{assignees: map[uuid.UUID]bool{alice: true}, members: member}, reassigned)
	if len(got) != 1 || got[0].Type != domain.TypeVacancyReassigned {
		t.Fatalf("ex-member previous responsible: %+v", summary(got))
	}
	// Missing / malformed from_user_id → no previous-assignee recipient.
	for _, from := range []any{nil, "nope", 7} {
		reassigned.Payload = map[string]any{"from_user_id": from, "reason": "other"}
		if got, err := newPlanner().Plan(ctx, fakeDirectory{members: member}, reassigned); err != nil || len(got) != 0 {
			t.Fatalf("from_user_id %v: %+v %v", from, summary(got), err)
		}
	}
	// Manual participation (no account) or NULL participation → no candidate row.
	invitation := event(audit.EventPsychometricInvitationCreated, map[string]any{"invitation_id": "i"})
	invitation.ParticipationID = ptr(manual)
	if got, _ := newPlanner().Plan(ctx, fakeDirectory{}, invitation); len(got) != 0 {
		t.Fatalf("manual candidate notified: %+v", summary(got))
	}
	invitation.ParticipationID = nil
	if got, err := newPlanner().Plan(ctx, fakeDirectory{candidates: map[uuid.UUID]uuid.UUID{participation: candidate}}, invitation); err != nil || len(got) != 0 {
		t.Fatalf("null participation: %+v %v", summary(got), err)
	}
	// The candidate acting on their own participation is the actor → excluded.
	finished := event(audit.EventVacancyApplicationSubmitted, map[string]any{})
	finished.ActorUserID = ptr(alice)
	if got, _ := newPlanner().Plan(ctx, fakeDirectory{team: []uuid.UUID{alice}}, finished); len(got) != 0 {
		t.Fatalf("actor in team notified: %+v", summary(got))
	}
	// Non-notifiable types plan nothing; directory errors propagate.
	if got, err := newPlanner().Plan(ctx, fakeDirectory{team: []uuid.UUID{alice}}, event(audit.EventParticipationSubstateChanged, nil)); err != nil || len(got) != 0 {
		t.Fatalf("non-notifiable: %+v %v", got, err)
	}
	boom := errors.New("boom")
	if _, err := newPlanner().Plan(ctx, fakeDirectory{err: boom}, event(audit.EventVacancyApplicationSubmitted, map[string]any{})); !errors.Is(err, boom) {
		t.Fatalf("directory error: %v", err)
	}
}

// D7/D8: candidate status notifications follow the candidate-visible status.
func TestPlanVisibleStatusRule(t *testing.T) {
	dir := fakeDirectory{candidates: map[uuid.UUID]uuid.UUID{participation: candidate}}
	move := func(eventType string, from, to uuid.UUID, extra map[string]any) Event {
		payload := map[string]any{"from_stage_id": from.String(), "to_stage_id": to.String()}
		for k, v := range extra {
			payload[k] = v
		}
		return event(eventType, payload)
	}
	cases := map[string]struct {
		event Event
		want  []planned
	}{
		"move out of the initial stage": {move(audit.EventParticipationMoved, initialStage, later, nil),
			[]planned{{domain.TypeCandidateStatusChanged, candidate, domain.RelationCandidate, domain.RecipientCandidate, map[string]any{"status": "in_process"}}}},
		"move back into the initial stage": {move(audit.EventParticipationMoved, later, initialStage, nil),
			[]planned{{domain.TypeCandidateStatusChanged, candidate, domain.RelationCandidate, domain.RecipientCandidate, map[string]any{"status": "submitted"}}}},
		"move between later stages": {move(audit.EventParticipationMoved, later, later2, nil), []planned{}},
		"recovered always notifies": {move(audit.EventParticipationRecovered, later, later, nil),
			[]planned{{domain.TypeCandidateStatusChanged, candidate, domain.RelationCandidate, domain.RecipientCandidate, map[string]any{"status": "in_process"}}}},
		"discard without message": {move(audit.EventParticipationDiscarded, later, later2, map[string]any{"has_message": false}),
			[]planned{{domain.TypeCandidateStatusChanged, candidate, domain.RelationCandidate, domain.RecipientCandidate, map[string]any{"status": "closed"}}}},
		"discard with message → only the message (D8)": {move(audit.EventParticipationDiscarded, later, later2, map[string]any{"has_message": true}),
			[]planned{{domain.TypeCandidateMessageReceived, candidate, domain.RelationCandidate, domain.RecipientCandidate, map[string]any{"status": "closed"}}}},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := newPlanner().Plan(context.Background(), dir, tc.event)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(summary(got), tc.want) {
				t.Fatalf("got  %+v\nwant %+v", summary(got), tc.want)
			}
		})
	}
	if _, err := newPlanner().Plan(context.Background(), dir, event(audit.EventParticipationMoved, map[string]any{"from_stage_id": "x", "to_stage_id": later.String()})); err == nil {
		t.Fatal("malformed stage id must fail the event")
	}
}

// D11: grouped types use the America/Mexico_City date of occurred_at.
func TestPlanGroupKeysUseMexicoCityDate(t *testing.T) {
	dir := fakeDirectory{team: []uuid.UUID{alice}, assignees: map[uuid.UUID]bool{alice: true}}
	at := func(utc string) time.Time {
		v, err := time.Parse(time.RFC3339, utc)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	cases := []struct {
		eventType string
		occurred  time.Time
		want      string
	}{
		// 05:59Z is 23:59 of the previous day in Mexico City (UTC-6), 06:00Z is midnight.
		{audit.EventVacancyApplicationSubmitted, at("2026-11-27T05:59:59Z"), "applications:" + job.String() + ":2026-11-26"},
		{audit.EventVacancyApplicationSubmitted, at("2026-11-27T06:00:00Z"), "applications:" + job.String() + ":2026-11-27"},
		{audit.EventPsychometricAssessmentFinished, at("2026-01-01T03:00:00Z"), "psychometrics:" + job.String() + ":2025-12-31"},
		{audit.EventPsychometricInvitationCreated, at("2026-11-26T12:00:00Z"), "psychometrics_pending:" + job.String() + ":2026-11-26"},
	}
	for _, tc := range cases {
		e := event(tc.eventType, map[string]any{"invitation_id": "i"})
		e.ParticipationID, e.OccurredAt = nil, tc.occurred
		got, err := newPlanner().Plan(context.Background(), dir, e)
		if err != nil || len(got) != 1 || got[0].GroupKey != tc.want {
			t.Fatalf("%s at %s: %+v %v, want %s", tc.eventType, tc.occurred, got, err, tc.want)
		}
	}
	e := event(audit.EventVacancyTeamCreated, map[string]any{})
	e.SubjectUserID = ptr(alice)
	got, err := newPlanner().Plan(context.Background(), dir, e)
	if err != nil || len(got) != 1 || got[0].GroupKey != "n:"+got[0].ID.String() || got[0].ID.Version() != 7 {
		t.Fatalf("single group: %+v %v", got, err)
	}
}

// D5: rules are ordered (type → relation); the first rule giving a user wins
// its reason, recipients are de-duplicated per type, and the stage-3 role
// relation is a reserved seam that is not enabled in stage 1.
func TestPlanRulesAreOrderedWithReservedRoleSeam(t *testing.T) {
	dir := fakeDirectory{team: []uuid.UUID{alice, bob}, assignees: map[uuid.UUID]bool{alice: true}}
	p := newPlanner()
	p.Rules = []Rule{{Type: domain.TypeVacancyAssigned, Relation: domain.RelationAssignee}, {Type: domain.TypeVacancyAssigned, Relation: domain.RelationTeam}}
	e := event(audit.EventVacancyTeamCreated, map[string]any{})
	e.SubjectUserID = ptr(alice)
	got, err := p.Plan(context.Background(), dir, e)
	want := []planned{{domain.TypeVacancyAssigned, alice, domain.RelationAssignee, domain.RecipientMember, map[string]any{}},
		{domain.TypeVacancyAssigned, bob, domain.RelationTeam, domain.RecipientMember, map[string]any{}}}
	if err != nil || !reflect.DeepEqual(summary(got), want) {
		t.Fatalf("got %+v %v", summary(got), err)
	}
	p.Rules = []Rule{{Type: domain.TypeVacancyAssigned, Relation: RelationRole, Role: "stakeholder"}}
	if _, err := p.Plan(context.Background(), dir, e); !errors.Is(err, ErrRelationNotEnabled) {
		t.Fatalf("role relation: %v", err)
	}
	// Stage-1 rules: one per captured type, the relation of the type table.
	rules := Stage1Rules()
	for _, s := range domain.Types() {
		var n int
		for _, r := range rules {
			if r.Type == s.Type {
				n++
				if r.Relation != s.Relation {
					t.Fatalf("%s relation %s", s.Type, r.Relation)
				}
			}
		}
		if (n == 1) == s.Scheduled || n > 1 {
			t.Fatalf("%s: %d rules (scheduled=%v)", s.Type, n, s.Scheduled)
		}
	}
}
