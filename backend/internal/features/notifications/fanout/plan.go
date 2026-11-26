// Package fanout turns captured notification_events into per-recipient
// notifications (notifications-v1 D4–D11): an ordered rule-based recipient
// resolver over current data, the candidate-visible status rule, group keys in
// the America/Mexico_City date, and the in-process claim loop.
package fanout

import (
	"context"
	"errors"
	"fmt"
	"time"
	_ "time/tzdata" // America/Mexico_City must resolve in minimal containers

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

// TimeZone is the business time zone of grouped dates (D11).
const TimeZone = "America/Mexico_City"

// RelationRole is the reserved stage-3 relation (D5): every company member
// with Rule.Role, in-app only. Stage 1 enables no role rule.
const RelationRole domain.Relation = "role"

// ErrRelationNotEnabled: a rule names a relation stage 1 does not resolve.
var ErrRelationNotEnabled = errors.New("notification relation not enabled")

// Event is one claimed notification_events row (ids/enums only).
type Event struct {
	ID              uuid.UUID
	CompanyID       uuid.UUID
	EventType       string
	ActorUserID     *uuid.UUID
	JobID           uuid.UUID
	ParticipationID *uuid.UUID
	SubjectUserID   *uuid.UUID
	Payload         map[string]any
	OccurredAt      time.Time
}

// Notification is one row to insert (immediate type, D21 dedupe).
type Notification struct {
	ID              uuid.UUID
	RecipientUserID uuid.UUID
	RecipientKind   domain.RecipientKind
	Reason          domain.Relation
	CompanyID       *uuid.UUID // nil for candidate recipients
	Type            domain.Type
	GroupKey        string
	JobID           uuid.UUID
	ParticipationID *uuid.UUID
	ActorUserID     *uuid.UUID
	SourceEventID   uuid.UUID
	Payload         map[string]any
}

// Directory reads current data inside the fan-out tx (§Recipients). Member
// answers are already filtered to non-stakeholder members of the event's
// company with the company not deleted (D6).
type Directory interface {
	Team(ctx context.Context, company, job uuid.UUID) ([]uuid.UUID, error)
	ActiveAssignee(ctx context.Context, company, job, user uuid.UUID) (bool, error)
	Member(ctx context.Context, company, user uuid.UUID) (bool, error)
	// Candidate is the account of the participation; nil for a manual one.
	Candidate(ctx context.Context, job, participation uuid.UUID) (*uuid.UUID, error)
}

// VisibleStatus is the candidate-visible status (`submitted | in_process |
// closed`) of a stage of the job: CandidateStatus with the process's initial
// stage, injected by the composition root (D7).
type VisibleStatus interface {
	Status(job, stage uuid.UUID, discarded bool) string
}

// Rule is one ordered (type → relation) resolver rule (D5). Role is used only
// by RelationRole.
type Rule struct {
	Type     domain.Type
	Relation domain.Relation
	Role     string
}

// Stage1Rules is one rule per captured type, with the relation of the type
// table (scheduled types are resolved by the scheduler).
func Stage1Rules() []Rule {
	var out []Rule
	for _, s := range domain.Types() {
		if !s.Scheduled {
			out = append(out, Rule{Type: s.Type, Relation: s.Relation})
		}
	}
	return out
}

// Planner computes the notifications of one event.
type Planner struct {
	Rules    []Rule
	Status   VisibleStatus
	Location *time.Location
	NewID    func() uuid.UUID
}

// NewPlanner builds the stage-1 planner.
func NewPlanner(status VisibleStatus) Planner {
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		panic(err) // tzdata is embedded
	}
	return Planner{Rules: Stage1Rules(), Status: status, Location: loc, NewID: func() uuid.UUID { return uuid.Must(uuid.NewV7()) }}
}

// Plan returns the rows for e: for each notification type the event yields,
// every rule of that type in order, actor excluded, recipients de-duplicated
// per type (the first rule gives the reason). A non-notifiable event or one
// without recipients yields nothing.
func (p Planner) Plan(ctx context.Context, dir Directory, e Event) ([]Notification, error) {
	yields, err := p.yields(e)
	if err != nil {
		return nil, err
	}
	var out []Notification
	for _, y := range yields {
		spec, ok := domain.Lookup(y.typ)
		if !ok {
			return nil, fmt.Errorf("unknown notification type %s", y.typ)
		}
		seen := map[uuid.UUID]bool{}
		for _, rule := range p.Rules {
			if rule.Type != y.typ {
				continue
			}
			users, err := p.resolve(ctx, dir, rule, e)
			if err != nil {
				return nil, fmt.Errorf("resolve %s/%s: %w", rule.Type, rule.Relation, err)
			}
			for _, u := range users {
				if seen[u] || (e.ActorUserID != nil && *e.ActorUserID == u) {
					continue
				}
				seen[u] = true
				out = append(out, p.row(e, spec, rule.Relation, u, y.payload))
			}
		}
	}
	return out, nil
}

type yield struct {
	typ     domain.Type
	payload map[string]any
}

// yields maps the event to its notification types and their payloads
// (§Capture, §GET payload per type): ids/enums only.
func (p Planner) yields(e Event) ([]yield, error) {
	str := func(k string) (string, bool) { v, ok := e.Payload[k].(string); return v, ok && v != "" }
	pick := func(keys ...string) map[string]any {
		out := map[string]any{}
		for _, k := range keys {
			if v, ok := str(k); ok {
				out[k] = v
			}
		}
		return out
	}
	switch e.EventType {
	case audit.EventVacancyApplicationSubmitted:
		return []yield{{domain.TypeApplicationReceived, map[string]any{}}}, nil
	case audit.EventVacancyTeamCreated:
		return []yield{{domain.TypeVacancyAssigned, map[string]any{}}}, nil
	case audit.EventVacancyTeamMemberAdded:
		return []yield{{domain.TypeVacancyTeamAdded, pick("function")}}, nil
	case audit.EventVacancyResponsibleReassigned:
		unassigned := pick("reason")
		if e.SubjectUserID != nil {
			unassigned["to_user_id"] = e.SubjectUserID.String()
		}
		return []yield{{domain.TypeVacancyReassigned, pick("from_user_id", "reason")}, {domain.TypeVacancyUnassigned, unassigned}}, nil
	case audit.EventPsychometricAssessmentFinished:
		return []yield{{domain.TypePsychometricCompleted, pick("invitation_id")}}, nil
	case audit.EventPsychometricInvitationCreated:
		return []yield{{domain.TypePsychometricPending, pick("invitation_id")}, {domain.TypeCandidateTestPending, pick("invitation_id")}}, nil
	case audit.EventParticipationDiscarded:
		// D8: one bell item; the message text stays in the application read model.
		if has, _ := e.Payload["has_message"].(bool); has {
			return []yield{{domain.TypeCandidateMessageReceived, map[string]any{"status": "closed"}}}, nil
		}
		return []yield{{domain.TypeCandidateStatusChanged, map[string]any{"status": "closed"}}}, nil
	case audit.EventParticipationRecovered:
		to, err := p.stage(e, "to_stage_id")
		if err != nil {
			return nil, err
		}
		return []yield{{domain.TypeCandidateStatusChanged, map[string]any{"status": p.Status.Status(e.JobID, to, false)}}}, nil
	case audit.EventParticipationMoved:
		// D7: only a candidate-visible status change notifies.
		from, err := p.stage(e, "from_stage_id")
		if err != nil {
			return nil, err
		}
		to, err := p.stage(e, "to_stage_id")
		if err != nil {
			return nil, err
		}
		before, after := p.Status.Status(e.JobID, from, false), p.Status.Status(e.JobID, to, false)
		if before == after {
			return nil, nil
		}
		return []yield{{domain.TypeCandidateStatusChanged, map[string]any{"status": after}}}, nil
	}
	return nil, nil
}

func (p Planner) stage(e Event, key string) (uuid.UUID, error) {
	raw, _ := e.Payload[key].(string)
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, fmt.Errorf("%s: malformed %s", e.EventType, key)
	}
	return id, nil
}

func (p Planner) resolve(ctx context.Context, dir Directory, rule Rule, e Event) ([]uuid.UUID, error) {
	one := func(u uuid.UUID, ok bool, err error) ([]uuid.UUID, error) {
		if err != nil || !ok {
			return nil, err
		}
		return []uuid.UUID{u}, nil
	}
	switch rule.Relation {
	case domain.RelationTeam:
		return dir.Team(ctx, e.CompanyID, e.JobID)
	case domain.RelationAssignee:
		if e.SubjectUserID == nil {
			return nil, nil
		}
		ok, err := dir.ActiveAssignee(ctx, e.CompanyID, e.JobID, *e.SubjectUserID)
		return one(*e.SubjectUserID, ok, err)
	case domain.RelationPreviousAssignee:
		raw, _ := e.Payload["from_user_id"].(string)
		from, err := uuid.Parse(raw)
		if err != nil || from == uuid.Nil {
			return nil, nil
		}
		ok, err := dir.Member(ctx, e.CompanyID, from)
		return one(from, ok, err)
	case domain.RelationCandidate:
		if e.ParticipationID == nil {
			return nil, nil
		}
		c, err := dir.Candidate(ctx, e.JobID, *e.ParticipationID)
		if err != nil || c == nil {
			return nil, err
		}
		return []uuid.UUID{*c}, nil
	}
	return nil, fmt.Errorf("%w: %s", ErrRelationNotEnabled, rule.Relation)
}

func (p Planner) row(e Event, spec domain.Spec, reason domain.Relation, user uuid.UUID, payload map[string]any) Notification {
	n := Notification{ID: p.NewID(), RecipientUserID: user, RecipientKind: spec.RecipientKind, Reason: reason, Type: spec.Type,
		JobID: e.JobID, ParticipationID: e.ParticipationID, ActorUserID: e.ActorUserID, SourceEventID: e.ID, Payload: clone(payload)}
	if spec.RecipientKind == domain.RecipientMember {
		company := e.CompanyID
		n.CompanyID = &company
	}
	n.GroupKey = GroupKey(spec.Group, e.JobID, e.OccurredAt.In(p.Location), n.ID)
	return n
}

// GroupKey is the D11 key: `<rule>:<job_id>:<YYYY-MM-DD>` for grouped types
// (local is already in America/Mexico_City), `n:<notification_id>` otherwise.
func GroupKey(rule domain.GroupRule, job uuid.UUID, local time.Time, id uuid.UUID) string {
	if rule == domain.GroupSingle {
		return "n:" + id.String()
	}
	return string(rule) + ":" + job.String() + ":" + local.Format(time.DateOnly)
}

func clone(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
