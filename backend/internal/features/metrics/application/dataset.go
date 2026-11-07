package application

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Scope is what the store loads: the company's vacancies in the universe (§2.0,
// published at least once) with any activity in the period, narrowed by the
// requester filter and, when Recruiter is set, to vacancies where that user has
// a tramo overlapping the period.
type Scope struct {
	Period    Period
	Requester RequesterFilter
	Recruiter *uuid.UUID
}

// Dataset holds the facts of every vacancy in scope, whole history included,
// and the people they name.
type Dataset struct {
	Vacancies []*Vacancy
	People    map[uuid.UUID]Person
}

// Vacancy is one published vacancy and its facts.
type Vacancy struct {
	ID          uuid.UUID
	Title       string
	PublishedAt time.Time // first publication
	Requester   *Requester
	Headcount   *int
	Responsible *uuid.UUID // the open responsible function, if any
	Delivery    DeliveryFacts
	Tramos      []Tramo
	Functions   []Function
	Closes      []Close
	Credits     []Credit
	Reassigns   []Reassignment
	Origin      map[string]int // participations created in the period by origin_channel
	Entries     []Entry        // qualifying cutoff entries, oldest first
}

// DeliveryFacts are the delivery configuration and its frozen fulfillment.
// Configured means a complete configuration (cutoff, target, commitment) or a
// frozen fulfillment row.
type DeliveryFacts struct {
	Configured         bool
	Commitment         *string // the date in effect: frozen when fulfilled
	Target             *int
	TargetReachedAt    *time.Time // reached_at of the N-th frozen candidate (D8)
	OriginalCommitment *string
	Renegotiations     int
}

type Tramo struct {
	ID, UserID uuid.UUID
	Start      time.Time
	End        *time.Time
}

type Function struct {
	AssignmentID, UserID uuid.UUID
	Function             string
	Start                time.Time
	End                  *time.Time
}

// Close is one close lifecycle event; Target is the closing target in effect at
// that instant.
type Close struct {
	At     time.Time
	Reason *string
	Target *string
}

type Credit struct {
	ID         uuid.UUID
	HiredAt    time.Time
	Status     string // active | did_not_hold (voided credits are never loaded)
	Recipients []Recipient
}

type Recipient struct {
	UserID uuid.UUID
	Kind   string
}

type Reassignment struct {
	ID          uuid.UUID
	At          time.Time
	Reason      string
	Note        *string
	From, To    uuid.UUID
	By          uuid.UUID
	FromStarted time.Time
	Snapshot    json.RawMessage
}

// Entry is one history row that put a participation into the cutoff stage (or
// a manual intake at or beyond it). ByRecruiter is false for organic applies.
type Entry struct {
	ParticipationID uuid.UUID
	At              time.Time
	ActorID         uuid.UUID
	ByRecruiter     bool
}

// Store loads facts; detail reads write their own audit row.
type Store interface {
	Load(ctx context.Context, company uuid.UUID, scope Scope) (*Dataset, error)
	HadTramo(ctx context.Context, company, user uuid.UUID) (bool, error)
	People(ctx context.Context, company uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Person, error)
	Deliveries(ctx context.Context, company, actor, draft uuid.UUID) ([]DeliveryRow, error)
	Placements(ctx context.Context, company, actor, draft uuid.UUID) ([]PlacementRow, error)
}

// reaches is the first qualifying entry of every participation, in delivery
// order: the delivered candidates (the count never goes down).
func (v *Vacancy) reaches() []Entry {
	seen := map[uuid.UUID]bool{}
	out := []Entry{}
	for _, e := range v.Entries {
		if !seen[e.ParticipationID] {
			seen[e.ParticipationID] = true
			out = append(out, e)
		}
	}
	return out
}

// Delivered is the delivered count; 0 without a configuration.
func (v *Vacancy) Delivered() int {
	if !v.Delivery.Configured {
		return 0
	}
	return len(v.reaches())
}

// DeliveryResult applies §2.3 at now. lateDays is set only for late.
func (v *Vacancy) DeliveryResult(now time.Time, cal Calendar) (result string, lateDays *int) {
	d := v.Delivery
	switch {
	case !d.Configured || d.Commitment == nil:
		return "not_configured", nil
	case d.TargetReachedAt != nil:
		if LocalDate(*d.TargetReachedAt) <= *d.Commitment {
			return "on_time", nil
		}
		n := cal.Between(civilDate(*d.Commitment), civilOf(*d.TargetReachedAt))
		return "late", &n
	case LocalDate(now) > *d.Commitment:
		return "overdue", nil
	default:
		return "pending", nil
	}
}

// deliveryMoment is the instant a delivery result is attributed at: the target
// moment when fulfilled, else the end of the commitment day for overdue.
func (v *Vacancy) deliveryMoment(result string) (time.Time, bool) {
	switch result {
	case "on_time", "late":
		return *v.Delivery.TargetReachedAt, true
	case "overdue":
		day, err := time.ParseInLocation(time.DateOnly, *v.Delivery.Commitment, zone)
		return day.AddDate(0, 0, 1), err == nil
	}
	return time.Time{}, false
}

// attributedAt lists the users a delivery result counts for: the responsible
// active at that instant (with_responsible) or every member active then
// (shared). Collaborators never carry the result.
func (v *Vacancy) attributedAt(at time.Time) []uuid.UUID {
	out := []uuid.UUID{}
	for _, f := range v.Functions {
		if (f.Function == "responsible" || f.Function == "member") && !at.Before(f.Start) && (f.End == nil || at.Before(*f.End)) && !slices.Contains(out, f.UserID) {
			out = append(out, f.UserID)
		}
	}
	return out
}

// assignedIn reports a tramo of user (any user when nil) overlapping [from, to).
func (v *Vacancy) assignedIn(user *uuid.UUID, from, to time.Time) bool {
	for _, t := range v.Tramos {
		if (user == nil || t.UserID == *user) && Overlaps(t.Start, t.End, from, to) {
			return true
		}
	}
	return false
}

// inDeliveryPeriod is the §2.3 period rule: by commitment_date when configured
// (D12), by assignment when not (P1).
func (v *Vacancy) inDeliveryPeriod(p Period) bool {
	if v.Delivery.Configured && v.Delivery.Commitment != nil {
		return p.ContainsDate(*v.Delivery.Commitment)
	}
	return v.assignedIn(nil, p.Start, p.End)
}

func (v *Vacancy) closesIn(from, to time.Time) []Close {
	out := []Close{}
	for _, c := range v.Closes {
		if !c.At.Before(from) && c.At.Before(to) {
			out = append(out, c)
		}
	}
	return out
}

func (v *Vacancy) activeCredits() int {
	n := 0
	for _, c := range v.Credits {
		if c.Status == "active" {
			n++
		}
	}
	return n
}

func reasonKey(r *string) string {
	if r == nil {
		return "no_reason"
	}
	return *r
}

func (d *Dataset) person(id uuid.UUID) Person {
	if p, ok := d.People[id]; ok {
		return p
	}
	return Person{UserID: id}
}

func (d *Dataset) personPtr(id *uuid.UUID) *Person {
	if id == nil {
		return nil
	}
	p := d.person(*id)
	return &p
}
