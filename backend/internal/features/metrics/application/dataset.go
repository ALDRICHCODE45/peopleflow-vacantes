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
// and the people they name. Loaded, Vacancies is every process of the chains
// in scope (originals and replacements). narrow fills the two views a request
// reads (replacement-processes-v1 §«Metrics»): Vacancies is then the
// process-level set (every process passing the requester and recruiter
// filters) and Roots the vacancy-level set (the original of each logical
// vacancy, whose process_kind is ignored).
type Dataset struct {
	Vacancies []*Vacancy
	Roots     []*Vacancy
	People    map[uuid.UUID]Person
}

// Process kinds (replacement-processes-v1). A vacancy loaded without a kind is
// an original.
const (
	KindOriginal    = "original"
	KindReplacement = "replacement"
)

// Replacements summarizes the replacements started from an original's logical
// vacancy: how many, and the one whose process is still active, if any.
type Replacements struct {
	Count         int        `json:"count"`
	ActiveDraftID *uuid.UUID `json:"active_draft_id"`
}

// Vacancy is one published process and its facts. Kind, RootID and Sequence
// place it in its logical vacancy (the zero values are an original that is its
// own root).
type Vacancy struct {
	ID          uuid.UUID
	Title       string
	PublishedAt time.Time // first publication (a replacement: its start)
	Kind        string    // original | replacement; "" is original
	RootID      uuid.UUID // the original of the logical vacancy; Nil is the vacancy itself
	Sequence    *int      // position of a replacement in its chain; nil for an original
	// ProcessActive is process_status = active.
	ProcessActive bool
	// Replacements, ChainTramos and ChainFunctions describe an original's
	// whole chain; link fills them (ChainTramos and ChainFunctions only when it
	// has replacements, else the vacancy's own apply).
	Replacements   Replacements
	ChainTramos    []Tramo
	ChainFunctions []Function
	Requester      *Requester
	Headcount      *int
	Responsible    *uuid.UUID // the open responsible function, if any
	Delivery       DeliveryFacts
	Tramos         []Tramo
	Functions      []Function
	Closes         []Close
	Credits        []Credit
	Reassigns      []Reassignment
	Origin         map[string]int // participations created in the period by origin_channel
	Entries        []Entry        // qualifying cutoff entries, oldest first
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
	Status     string    // active | did_not_hold (voided credits are never loaded)
	Candidate  Candidate // as the company sees them (placements list, v2 §5.3)
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

// ProcessRef places a process in its logical vacancy (the `process` of a
// per-vacancy detail and the keys of VacancyRef).
type ProcessRef struct {
	Kind        string    `json:"kind"`
	RootDraftID uuid.UUID `json:"root_draft_id"`
	Sequence    *int      `json:"sequence"`
}

// Store loads facts; detail reads write their own audit row.
type Store interface {
	Load(ctx context.Context, company uuid.UUID, scope Scope) (*Dataset, error)
	HadTramo(ctx context.Context, company, user uuid.UUID) (bool, error)
	People(ctx context.Context, company uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Person, error)
	// Deliveries and Placements read one process' rows (empty when its kind is
	// not the process_kind filter, "" = any) and name where the process sits
	// in its logical vacancy.
	Deliveries(ctx context.Context, company, actor, draft uuid.UUID, kind string) ([]DeliveryRow, ProcessRef, error)
	Placements(ctx context.Context, company, actor, draft uuid.UUID, kind string) ([]PlacementRow, ProcessRef, error)
	// Names resolves the applied filters the snapshot cannot name, never
	// across companies (v2 §5).
	Names(ctx context.Context, company uuid.UUID, q NameQuery) (Names, error)
	// RecordDetail writes one audited list read or export in its own
	// transaction (v2 §6); an error fails the read.
	RecordDetail(ctx context.Context, a DetailAudit) error
	// LoadPipeline reads the company's open vacancies and their active
	// participations with the current-stage entry (v2 §2, §4.4).
	LoadPipeline(ctx context.Context, company uuid.UUID) (*PipelineData, error)
	// LoadHistory reads the company dashboard's history snapshot: every
	// published vacancy, its publication history and the stage history of
	// the participations not discarded before since (company-dashboard-v2 §4).
	LoadHistory(ctx context.Context, company uuid.UUID, since time.Time) (*HistoryData, error)
}

// isReplacement reports a replacement process; an original (or a vacancy
// loaded without a kind) is not.
func (v *Vacancy) isReplacement() bool { return v.Kind == KindReplacement }

func (v *Vacancy) kind() string {
	if v.isReplacement() {
		return KindReplacement
	}
	return KindOriginal
}

// root is the id of the logical vacancy's original.
func (v *Vacancy) root() uuid.UUID {
	if v.RootID != uuid.Nil {
		return v.RootID
	}
	return v.ID
}

// selectedBy applies the process_kind filter ("" selects every process).
func (v *Vacancy) selectedBy(kind string) bool { return kind == "" || v.kind() == kind }

// process is where the vacancy sits in its logical vacancy.
func (v *Vacancy) process() ProcessRef {
	return ProcessRef{Kind: v.kind(), RootDraftID: v.root(), Sequence: v.Sequence}
}

// chainTramos are the tramos of the whole logical vacancy for an original
// (its own when it has no replacement): the vacancy-level «assigned» rule (A5).
func (v *Vacancy) chainTramos() []Tramo {
	if v.ChainTramos != nil {
		return v.ChainTramos
	}
	return v.Tramos
}

func (v *Vacancy) chainFunctions() []Function {
	if v.ChainFunctions != nil {
		return v.ChainFunctions
	}
	return v.Functions
}

// assignedInChain is the vacancy-level assigned: a tramo of user (any user
// when nil) overlapping [from, to) on the original or on any replacement.
func (v *Vacancy) assignedInChain(user *uuid.UUID, from, to time.Time) bool {
	for _, t := range v.chainTramos() {
		if (user == nil || t.UserID == *user) && Overlaps(t.Start, t.End, from, to) {
			return true
		}
	}
	return false
}

// link joins every original with its replacements: the count and active one,
// and the chain's tramos and functions. The store's loader leaves the
// vacancies unlinked; the service links each snapshot once. Linking twice is
// harmless.
func (d *Dataset) link() {
	byID := make(map[uuid.UUID]*Vacancy, len(d.Vacancies))
	for _, v := range d.Vacancies {
		byID[v.ID] = v
		v.Replacements, v.ChainTramos, v.ChainFunctions = Replacements{}, nil, nil
	}
	for _, v := range d.Vacancies {
		if !v.isReplacement() {
			continue
		}
		root := byID[v.RootID]
		if root == nil || root == v {
			continue
		}
		if root.ChainTramos == nil {
			root.ChainTramos, root.ChainFunctions = slices.Clone(root.Tramos), slices.Clone(root.Functions)
		}
		root.Replacements.Count++
		if v.ProcessActive {
			id := v.ID
			root.Replacements.ActiveDraftID = &id
		}
		root.ChainTramos = append(root.ChainTramos, v.Tramos...)
		root.ChainFunctions = append(root.ChainFunctions, v.Functions...)
	}
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

// attributedPeople names the users a delivery result counts for (§2.3 per
// recruiter): the deliveries list rows and the overdue top share it.
func (v *Vacancy) attributedPeople(result string, data *Dataset) []Person {
	out := []Person{}
	if at, ok := v.deliveryMoment(result); ok {
		for _, id := range v.attributedAt(at) {
			out = append(out, data.person(id))
		}
	}
	return out
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

// narrow keeps the processes the request's filters select (M6 requester rule;
// with recruiter, a tramo of that user overlapping the period) as Vacancies,
// and the originals the same filters select as Roots; for a root the recruiter
// rule looks at the tramos of its whole chain (A5). People stay whole: they
// only name ids the kept vacancies carry. process_kind is not applied here
// (forKind): a list counts its process_kind facet over every kind.
func (d *Dataset) narrow(p Period, requester RequesterFilter, recruiter *uuid.UUID) *Dataset {
	out := &Dataset{Vacancies: make([]*Vacancy, 0, len(d.Vacancies)), Roots: make([]*Vacancy, 0, len(d.Vacancies)), People: d.People}
	for _, v := range d.Vacancies {
		if !requester.selects(v.Requester) {
			continue
		}
		if recruiter == nil || v.assignedIn(recruiter, p.Start, p.End) {
			out.Vacancies = append(out.Vacancies, v)
		}
		if !v.isReplacement() && (recruiter == nil || v.assignedInChain(recruiter, p.Start, p.End)) {
			out.Roots = append(out.Roots, v)
		}
	}
	return out
}

// forKind keeps the processes the process_kind filter selects ("" = all);
// the roots, which ignore it, stay.
func (d *Dataset) forKind(kind string) *Dataset {
	if kind == "" {
		return d
	}
	out := &Dataset{Vacancies: make([]*Vacancy, 0, len(d.Vacancies)), Roots: d.Roots, People: d.People}
	for _, v := range d.Vacancies {
		if v.selectedBy(kind) {
			out.Vacancies = append(out.Vacancies, v)
		}
	}
	return out
}

// selects applies the requester filter to a vacancy's current requester.
func (f RequesterFilter) selects(r *Requester) bool {
	switch {
	case f.Kind == "":
		return !f.None || r == nil
	case r == nil || r.Kind != f.Kind:
		return false
	case f.None:
		return r.ID == nil
	case f.ID != uuid.Nil:
		return r.ID != nil && *r.ID == f.ID
	}
	return true
}
