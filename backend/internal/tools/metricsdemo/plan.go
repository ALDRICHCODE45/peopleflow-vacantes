package metricsdemo

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // America/Mexico_City must resolve anywhere

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

const (
	CompanyName = "Demo Métricas"
	companyRFC  = "DEMOMETRICAS"
	// stalledDays is the metrics stalled threshold (stakeholder-metrics-v2 DV1).
	stalledDays = 7
)

var zone = func() *time.Location {
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		panic(err)
	}
	return loc
}()

// People are the three registered accounts the demo attaches; OwnerName is
// the owner's account name, copied into the lifecycle events as the app does.
type People struct {
	Owner, Stakeholder, Recruiter uuid.UUID
	OwnerName                     string
}

// Statement is one INSERT of the plan.
type Statement struct {
	SQL  string
	Args []any
}

// Plan is every row of the demo company, in foreign-key order.
// FictitiousUsers are the users rows it creates (recruiters and candidates),
// the only users remove deletes.
type Plan struct {
	Statements      []Statement
	FictitiousUsers []uuid.UUID
}

func insert(table, columns string, args ...any) Statement {
	marks := make([]string, len(args))
	for i := range args {
		marks[i] = "$" + strconv.Itoa(i+1)
	}
	return Statement{SQL: "INSERT INTO " + table + "(" + columns + ") VALUES(" + strings.Join(marks, ",") + ")", Args: args}
}

// --- calendar -------------------------------------------------------------

// Dates are civil dates at UTC midnight, the business calendar's input.

func civil(at time.Time) time.Time {
	y, m, d := at.In(zone).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func isBusinessDay(d time.Time) bool { return businesscalendar.IsBusinessDay(d) }

// addBusinessDays moves forward n business days (n = 0 keeps the date).
func addBusinessDays(d time.Time, n int) time.Time {
	for n > 0 {
		d = d.AddDate(0, 0, 1)
		if isBusinessDay(d) {
			n--
		}
	}
	return d
}

func nextBusinessDay(d time.Time) time.Time {
	for !isBusinessDay(d) {
		d = d.AddDate(0, 0, 1)
	}
	return d
}

func previousBusinessDay(d time.Time) time.Time {
	for !isBusinessDay(d) {
		d = d.AddDate(0, 0, -1)
	}
	return d
}

// businessDaysBetween counts the business days in (from, to], the metrics rule.
func businessDaysBetween(from, to time.Time) int {
	n := 0
	for d := from.AddDate(0, 0, 1); !d.After(to); d = d.AddDate(0, 0, 1) {
		if isBusinessDay(d) {
			n++
		}
	}
	return n
}

// at is the Mexico City instant of a civil date and time.
func at(d time.Time, hour, minute int) time.Time {
	return time.Date(d.Year(), d.Month(), d.Day(), hour, minute, 0, 0, zone)
}

func dateText(d time.Time) string { return d.Format(time.DateOnly) }

// --- builder --------------------------------------------------------------

type requester struct {
	id         uuid.UUID
	kind, name string
}

type candidate struct {
	id, cv      uuid.UUID
	name, email string
}

type builder struct {
	company     uuid.UUID // CompanyID() for the demo, a bench company otherwise
	now, today  time.Time
	periodStart time.Time // first day of the month eleven months back
	monthEnd    time.Time // last day of the current month
	people      People
	users       map[string]uuid.UUID
	requesters  map[string]requester
	candidates  []candidate
	next        int
	vacancies   []*vacancy
	errs        []error
}

func (b *builder) fail(format string, args ...any) {
	b.errs = append(b.errs, fmt.Errorf(format, args...))
}

// check rejects a planned instant after now: the demo never holds the future.
func (b *builder) check(where string, t time.Time) time.Time {
	if t.After(b.now) {
		b.fail("%s: %s is after now", where, t.Format(time.RFC3339))
	}
	return t
}

// month is the business day on or after the given day of the month k months
// back from today's month.
func (b *builder) month(k, day int) time.Time {
	first := time.Date(b.today.Year(), b.today.Month()-time.Month(k), 1, 0, 0, 0, 0, time.UTC)
	return nextBusinessDay(first.AddDate(0, 0, day-1))
}

// recent is a business day with exactly n business days in (it, today]: an
// entry on it has spent n business days in its stage by today.
func (b *builder) recent(n int) time.Time {
	d := b.today
	for k := 0; k < n; d = d.AddDate(0, 0, -1) {
		if isBusinessDay(d) {
			k++
		}
	}
	return previousBusinessDay(d)
}

// pending is a commitment date still ahead: n business days after today,
// kept inside the current month so a period ending this month counts it.
func (b *builder) pending(n int) time.Time {
	d := addBusinessDays(b.today, n)
	if d.After(b.monthEnd) {
		d = b.monthEnd
	}
	return d
}

func (b *builder) user(key string) uuid.UUID {
	id, ok := b.users[key]
	if !ok {
		b.fail("unknown user %q", key)
	}
	return id
}

func (b *builder) candidate() *candidate {
	c := &b.candidates[b.next%len(b.candidates)]
	b.next++
	return c
}

// --- vacancy ----------------------------------------------------------------

type function struct {
	id         uuid.UUID
	kind       string
	start      time.Time
	startCause string
	end        *time.Time
	endCause   string
}

type tramo struct {
	id           uuid.UUID
	user         string
	start        time.Time
	startCause   string
	end          *time.Time
	endCause     string
	reassignment *uuid.UUID
	functions    []*function
}

func (t *tramo) open() *function {
	for _, f := range t.functions {
		if f.end == nil {
			return f
		}
	}
	return nil
}

func (t *tramo) holds(kind string, when time.Time) bool {
	for _, f := range t.functions {
		if f.kind == kind && !when.Before(f.start) && (f.end == nil || when.Before(*f.end)) {
			return true
		}
	}
	return false
}

type event struct {
	action, reason, note string
	at                   time.Time
}

type entry struct {
	id         uuid.UUID
	stage      string
	at         time.Time
	kind       string // intake | move | discard
	from       string
	actor      uuid.UUID
	recruiter  bool
	hire       bool
	departure  bool
	reasonCode string
}

type part struct {
	v         *vacancy
	id        uuid.UUID
	who       *candidate
	source    string
	channel   string
	addedBy   *uuid.UUID
	companyCV *uuid.UUID
	entries   []*entry
	discarded bool
	stalled   *bool
}

type recipient struct {
	user, kind string
}

type credit struct {
	id         uuid.UUID
	p          *part
	hire       *entry
	exit       *entry
	status     string
	recipients []recipient
}

type reassignment struct {
	id, from, to       uuid.UUID
	reason, note, prev string
	at                 time.Time
	snapshot           []byte
}

type closeTarget struct {
	id             uuid.UUID
	previous, next *time.Time
	at             time.Time
}

type commitmentChange struct {
	id             uuid.UUID
	previous, next time.Time
	at             time.Time
}

type vacancy struct {
	b                   *builder
	key, title, area    string
	seniority, workMode string
	requester           string // a requesters key, "" for none, "client?" for an unspecified client
	draft               uuid.UUID
	pubDate             time.Time
	pub, created        time.Time
	published           bool
	mode                string
	pipeline            pipelineconfig.Configuration
	storedPipeline      bool
	stages              map[string]uuid.UUID
	stageNames          map[string]string
	tramos              []*tramo
	parts               []*part
	events              []event
	headcount           int
	target              *time.Time
	targets             []closeTarget
	deliveryTarget      int
	commitment          *time.Time
	commitments         []commitmentChange
	credits             []*credit
	reassignments       []reassignment
	seq                 int
	expectResult        string
	expectLate          int
}

func (v *vacancy) next(kind string) uuid.UUID {
	v.seq++
	return ID("vacancy", v.key, kind, strconv.Itoa(v.seq))
}

// d is the business day n business days after publication; t its instant.
func (v *vacancy) d(n int) time.Time          { return addBusinessDays(v.pubDate, n) }
func (v *vacancy) t(n, hour int) time.Time    { return at(v.d(n), hour, 0) }
func (v *vacancy) where(what string) string   { return v.key + " " + what }
func (v *vacancy) actor(key string) uuid.UUID { return v.b.user(key) }

// vacancy starts a published vacancy: the owner creates the draft three
// days before publishing and assigns its first team.
func (b *builder) vacancy(key, title, area, req string, pub time.Time, mode string) *vacancy {
	v := &vacancy{b: b, key: key, title: title, area: area, requester: req, draft: ID("draft", key), pubDate: pub,
		pub: at(pub, 9, 30), created: at(pub.AddDate(0, 0, -3), 12, 0), published: true, mode: mode,
		seniority: "semi_senior", workMode: "hybrid", headcount: 1, expectLate: -1}
	v.usePipeline(pipelineconfig.Defaults(v.draft), false)
	b.check(v.where("publication"), v.pub)
	if pub.Before(b.periodStart) {
		b.fail("%s: published before the twelve-month window", key)
	}
	b.vacancies = append(b.vacancies, v)
	return v
}

// draftOnly starts a vacancy that was never published (outside the metrics).
func (b *builder) draftOnly(key, title, area, req string, created time.Time) *vacancy {
	v := b.vacancy(key, title, area, req, created, "with_responsible")
	v.published, v.created = false, at(created, 12, 0)
	return v
}

func (v *vacancy) usePipeline(config pipelineconfig.Configuration, stored bool) {
	v.pipeline, v.storedPipeline = config, stored
	v.stages, v.stageNames = map[string]uuid.UUID{}, map[string]string{}
	add := func(key string, s pipelineconfig.Stage) {
		v.stages[key] = uuid.MustParse(s.ID)
		v.stageNames[key] = s.Name
	}
	for _, s := range config.Stages {
		add(s.Kind, s)
	}
	add("exit", config.Exit)
	for _, s := range config.RetiredStages() {
		add("retired", s)
	}
}

// customPipeline stores a pipeline with a custom stage before placement and
// a retired custom stage (the stakeholder-metrics-v2 §4.4 kinds).
func (v *vacancy) customPipeline(custom, retired string) {
	config := pipelineconfig.Defaults(v.draft)
	stage := pipelineconfig.Stage{ID: ID("vacancy", v.key, "stage", "custom").String(), Kind: "custom", Name: custom}
	config.Stages = append(config.Stages[:4:4], stage, config.Stages[4])
	config.Retired = []pipelineconfig.RetiredStage{{Stage: pipelineconfig.Stage{ID: ID("vacancy", v.key, "stage", "retired").String(), Kind: "custom", Name: retired}, Position: 4}}
	v.usePipeline(config, true)
	v.stages["custom"] = uuid.MustParse(stage.ID)
}

// stay opens a tramo holding one function, added by the owner.
func (v *vacancy) stay(user, kind string, start time.Time) *tramo {
	if v.openTramo(user) != nil {
		v.b.fail("%s: %s already has an open tramo", v.key, user)
	}
	t := &tramo{id: v.next("tramo"), user: user, start: v.b.check(v.where("tramo"), start), startCause: "added"}
	t.functions = append(t.functions, &function{id: v.next("function"), kind: kind, start: start, startCause: "added"})
	v.tramos = append(v.tramos, t)
	return t
}

func (v *vacancy) openTramo(user string) *tramo {
	for _, t := range v.tramos {
		if t.user == user && t.end == nil {
			return t
		}
	}
	return nil
}

// tramoAt is the user's tramo active at an instant.
func (v *vacancy) tramoAt(user string, when time.Time) *tramo {
	for _, t := range v.tramos {
		if t.user == user && !when.Before(t.start) && (t.end == nil || when.Before(*t.end)) {
			return t
		}
	}
	v.b.fail("%s: %s has no tramo at %s", v.key, user, when.Format(time.RFC3339))
	return &tramo{}
}

// reassign moves the responsible function from one recruiter to another
// (vacancy_reassignments), removing the previous responsible or keeping them
// as collaborator.
func (v *vacancy) reassign(from, to, reason, note string, when time.Time, keep bool) {
	v.b.check(v.where("reassignment"), when)
	ft := v.openTramo(from)
	if ft == nil || ft.open() == nil || ft.open().kind != "responsible" {
		v.b.fail("%s: %s is not the responsible", v.key, from)
		return
	}
	r := reassignment{id: v.next("reassignment"), from: ft.id, reason: reason, note: note, at: when, prev: "remove"}
	end := when
	ft.open().end, ft.open().endCause = &end, "reassignment"
	if keep {
		r.prev = "keep_as_collaborator"
		ft.functions = append(ft.functions, &function{id: v.next("function"), kind: "collaborator", start: when, startCause: "reassignment"})
	} else {
		ft.end, ft.endCause, ft.reassignment = &end, "reassigned", &r.id
	}
	tt := v.openTramo(to)
	if tt == nil {
		tt = &tramo{id: v.next("tramo"), user: to, start: when, startCause: "reassignment", reassignment: &r.id}
		v.tramos = append(v.tramos, tt)
	} else if f := tt.open(); f != nil {
		f.end, f.endCause = &end, "reassignment"
	}
	tt.functions = append(tt.functions, &function{id: v.next("function"), kind: "responsible", start: when, startCause: "reassignment"})
	r.to = tt.id
	r.snapshot = v.snapshot(ft, when)
	v.reassignments = append(v.reassignments, r)
}

// lifecycle ---------------------------------------------------------------

func (v *vacancy) close(reason, note string, when time.Time) {
	v.events = append(v.events, event{action: "close", reason: reason, note: note, at: v.b.check(v.where("close"), when)})
}
func (v *vacancy) reopen(when time.Time) {
	v.events = append(v.events, event{action: "reopen", at: v.b.check(v.where("reopen"), when)})
}
func (v *vacancy) pause(when time.Time) {
	v.events = append(v.events, event{action: "pause", at: v.b.check(v.where("pause"), when)})
}

// closingTarget sets the management configuration with an optional closing
// target, logged at creation like the app does.
func (v *vacancy) closingTarget(headcount int, target *time.Time) {
	v.headcount, v.target = headcount, target
	if target != nil {
		v.targets = append(v.targets, closeTarget{id: v.next("close-target"), next: target, at: v.created.Add(time.Hour)})
	}
}

// moveTarget changes the closing target at an instant.
func (v *vacancy) moveTarget(next time.Time, when time.Time) {
	v.targets = append(v.targets, closeTarget{id: v.next("close-target"), previous: v.target, next: &next, at: v.b.check(v.where("target change"), when)})
	v.target = &next
}

// deliver configures the delivery commitment with the default cutoff
// («Screening OK»).
func (v *vacancy) deliver(target int, commitment time.Time) {
	v.deliveryTarget, v.commitment = target, &commitment
	if commitment.Before(v.b.periodStart) || commitment.After(v.b.monthEnd) {
		v.b.fail("%s: commitment %s outside the twelve-month window", v.key, dateText(commitment))
	}
}

// renegotiate records a commitment change from previous to the current date.
func (v *vacancy) renegotiate(previous time.Time, when time.Time) {
	v.commitments = append(v.commitments, commitmentChange{id: v.next("commitment"), previous: previous, next: *v.commitment, at: v.b.check(v.where("renegotiation"), when)})
}

// expect pins the delivery result the plan is designed to produce; lateDays
// only for late.
func (v *vacancy) expect(result string, lateDays int) {
	v.expectResult, v.expectLate = result, lateDays
}

// participations ----------------------------------------------------------

// apply is an organic application into «Nuevos»; channel manual is a manual
// intake by that recruiter.
func (v *vacancy) apply(channel string, when time.Time) *part {
	p := v.newPart(channel, when)
	p.entries = append(p.entries, &entry{id: v.next("history"), stage: "new", at: when, kind: "intake", actor: p.who.id})
	return p
}

// intake is a recruiter's manual intake of an existing account into «Nuevos».
func (v *vacancy) intake(by string, when time.Time) *part {
	p := v.newPart("manual", when)
	actor := v.actor(by)
	cv := v.next("company-cv")
	p.source, p.addedBy, p.companyCV = "manual", &actor, &cv
	p.entries = append(p.entries, &entry{id: v.next("history"), stage: "new", at: when, kind: "intake", actor: actor, recruiter: true})
	return p
}

func (v *vacancy) newPart(channel string, when time.Time) *part {
	if when.Before(v.pub) {
		v.b.fail("%s: participation before publication", v.key)
	}
	v.b.check(v.where("participation"), when)
	p := &part{v: v, id: v.next("participation"), who: v.b.candidate(), source: "organic", channel: channel}
	v.parts = append(v.parts, p)
	return p
}

func (p *part) last() *entry  { return p.entries[len(p.entries)-1] }
func (p *part) stage() string { return p.last().stage }

func (p *part) step(e *entry) *part {
	v := p.v
	v.b.check(v.where("move"), e.at)
	if p.discarded {
		v.b.fail("%s: move after discard", v.key)
	}
	if !e.at.After(p.last().at) {
		v.b.fail("%s: %s at %s is not after %s", v.key, e.stage, e.at.Format(time.RFC3339), p.last().at.Format(time.RFC3339))
	}
	if _, ok := v.stages[e.stage]; !ok {
		v.b.fail("%s: unknown stage %q", v.key, e.stage)
	}
	e.id, e.from, e.recruiter = v.next("history"), p.stage(), true
	if e.kind == "" {
		e.kind = "move"
	}
	p.entries = append(p.entries, e)
	return p
}

// to is a recruiter's move to a stage.
func (p *part) to(stage string, when time.Time, by string) *part {
	return p.step(&entry{stage: stage, at: when, actor: p.v.actor(by)})
}

// hire moves to «Placement» (the move a placement credit points at).
func (p *part) hire(when time.Time, by string) *part {
	return p.step(&entry{stage: "placement", at: when, actor: p.v.actor(by), hire: true})
}

// leave moves a hire out of «Placement» because the candidate left.
func (p *part) leave(when time.Time, by string) *part {
	return p.step(&entry{stage: "in_process", at: when, actor: p.v.actor(by), departure: true})
}

// discard moves to the exit stage with a recruiter reason.
func (p *part) discard(when time.Time, by, code string) *part {
	p.step(&entry{stage: "exit", at: when, actor: p.v.actor(by), kind: "discard", reasonCode: code})
	p.discarded = true
	return p
}

// expectStalled pins whether the participation is stalled today.
func (p *part) expectStalled(want bool) *part {
	p.stalled = &want
	return p
}

// stageEntry is when the participation entered its current stage.
func (p *part) stageEntry() time.Time {
	for i := len(p.entries) - 1; i >= 0; i-- {
		if e := p.entries[i]; e.stage == p.stage() && e.kind != "discard" {
			return e.at
		}
	}
	return p.entries[0].at
}

// credits -----------------------------------------------------------------

// credit records the placement credit of a participation's latest hire not
// yet credited; did_not_hold also points at the departure that followed it.
func (v *vacancy) credit(p *part, status string, recipients ...recipient) {
	c := &credit{id: v.next("credit"), p: p, status: status, recipients: recipients}
	for i, e := range p.entries {
		if !e.hire || slices.ContainsFunc(v.credits, func(o *credit) bool { return o.hire == e }) {
			continue
		}
		c.hire = e
		if status == "did_not_hold" {
			for _, later := range p.entries[i+1:] {
				if later.departure {
					c.exit = later
					break
				}
			}
		}
		break
	}
	if c.hire == nil || (status == "did_not_hold") != (c.exit != nil) {
		v.b.fail("%s: credit without its hire or departure", v.key)
		return
	}
	v.credits = append(v.credits, c)
}

// --- derived facts --------------------------------------------------------

// reaches are the first entries into the cutoff, in delivery order.
func (v *vacancy) reaches() []*entry {
	var out []*entry
	for _, p := range v.parts {
		for _, e := range p.entries {
			if e.stage == "screening_ok" && e.kind != "discard" {
				out = append(out, e)
				break
			}
		}
	}
	slices.SortStableFunc(out, func(a, b *entry) int { return a.at.Compare(b.at) })
	return out
}

func (v *vacancy) partOf(e *entry) *part {
	for _, p := range v.parts {
		if slices.Contains(p.entries, e) {
			return p
		}
	}
	return nil
}

// fulfilled is the N-th reach when the target was met.
func (v *vacancy) fulfilled() *entry {
	if v.commitment == nil {
		return nil
	}
	if r := v.reaches(); len(r) >= v.deliveryTarget {
		return r[v.deliveryTarget-1]
	}
	return nil
}

// result is the stakeholder-metrics §2.3 delivery result today.
func (v *vacancy) result() (string, int) {
	switch n := v.fulfilled(); {
	case v.commitment == nil:
		return "not_configured", -1
	case n != nil && !civil(n.at).After(*v.commitment):
		return "on_time", -1
	case n != nil:
		return "late", businessDaysBetween(*v.commitment, civil(n.at))
	case v.b.today.After(*v.commitment):
		return "overdue", -1
	default:
		return "pending", -1
	}
}

// snapshot is the reassignment's state_snapshot at an instant.
func (v *vacancy) snapshot(from *tramo, when time.Time) []byte {
	type count struct {
		StageID   string `json:"stage_id"`
		StageName string `json:"stage_name"`
		Kind      string `json:"kind"`
		Active    int    `json:"active"`
		Discarded int    `json:"discarded"`
	}
	counts := []count{}
	for _, s := range v.pipeline.Stages {
		counts = append(counts, count{StageID: s.ID, StageName: s.Name, Kind: s.Kind})
	}
	delivered, placed := 0, 0
	for _, p := range v.parts {
		var current *entry
		reached := false
		for _, e := range p.entries {
			if e.at.After(when) {
				break
			}
			current = e
			reached = reached || e.stage == "screening_ok"
		}
		if current == nil {
			continue
		}
		if reached {
			delivered++
		}
		stage, field := current.stage, "active"
		if current.kind == "discard" {
			stage, field = current.from, "discarded"
		}
		if stage == "placement" && field == "active" {
			placed++
		}
		for i := range counts {
			if counts[i].StageID == v.stages[stage].String() {
				if field == "active" {
					counts[i].Active++
				} else {
					counts[i].Discarded++
				}
			}
		}
	}
	delivery := map[string]any{"target": nil, "delivered": delivered, "fulfilled_at": nil, "result": nil, "commitment_date": nil}
	deadline, source := any(nil), "none"
	if v.commitment != nil {
		delivery["target"], delivery["commitment_date"] = v.deliveryTarget, dateText(*v.commitment)
		deadline, source = dateText(*v.commitment), "commitment"
	}
	raw, err := json.Marshal(map[string]any{
		"captured_at":  when.UTC(),
		"lifecycle":    map[string]any{"publication": "published", "process": "active"},
		"stage_counts": counts,
		"tramo": map[string]any{"started_at": from.start.UTC(), "effective_deadline": deadline, "deadline_source": source,
			"business_days_elapsed": businessDaysBetween(civil(from.start), civil(when)), "business_days_total": nil},
		"delivery":   delivery,
		"placements": map[string]any{"current": placed, "credited": placed},
	})
	if err != nil {
		v.b.fail("%s: snapshot: %v", v.key, err)
	}
	return raw
}

// --- validation and emission -----------------------------------------------

func (v *vacancy) validate() {
	b := v.b
	if v.published {
		if got, late := v.result(); got != v.expectResult || late != v.expectLate {
			b.fail("%s: delivery %s (%d late), designed %s (%d late)", v.key, got, late, v.expectResult, v.expectLate)
		}
	}
	for _, p := range v.parts {
		if p.stalled == nil {
			continue
		}
		stalled := !p.discarded && p.stage() != "placement" && businessDaysBetween(civil(p.stageEntry()), b.today) >= stalledDays
		if stalled != *p.stalled {
			b.fail("%s: participation stalled=%v, designed %v", v.key, stalled, *p.stalled)
		}
	}
	responsible := 0
	for _, t := range v.tramos {
		if f := t.open(); t.end == nil && f != nil && f.kind == "responsible" {
			responsible++
		}
	}
	if responsible > 1 {
		b.fail("%s: %d open responsible functions", v.key, responsible)
	}
}

// fields is the job_drafts.fields document: the canonical schema-2 draft the
// app's own create codec (draftinput.DecodeCreateV2) produces for these
// values, so the v2 draft routes read it (T13, L23). Every other field keeps
// its create default.
func (v *vacancy) fields() []byte {
	fields := map[string]any{"title": v.title, "professional_area": v.area, "seniority": v.seniority, "work_mode": v.workMode,
		"work_schedule": "full_time", "contract_type": "indefinite"}
	switch v.requester {
	case "":
	case "client?":
		fields["requester"] = map[string]any{"kind": "client", "id": nil}
	default:
		r := v.b.requesters[v.requester]
		fields["requester"] = map[string]any{"kind": r.kind, "id": r.id.String()}
	}
	body, err := json.Marshal(map[string]any{"fields": fields})
	if err != nil {
		v.b.fail("%s: fields: %v", v.key, err)
		return nil
	}
	create, err := draftinput.DecodeCreateV2(body)
	if err != nil {
		v.b.fail("%s: fields: %v", v.key, err)
		return nil
	}
	return create.Fingerprint()
}

func (v *vacancy) requesterColumns() (*string, *uuid.UUID) {
	switch v.requester {
	case "":
		return nil, nil
	case "client?":
		kind := "client"
		return &kind, nil
	}
	r := v.b.requesters[v.requester]
	return &r.kind, &r.id
}

func datePtr(d *time.Time) *string {
	if d == nil {
		return nil
	}
	s := dateText(*d)
	return &s
}

func textPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (v *vacancy) emit(out *[]Statement) {
	b, company, owner := v.b, v.b.company, v.b.people.Owner
	add := func(s Statement) { *out = append(*out, s) }
	kind, requesterID := v.requesterColumns()
	add(insert("job_drafts", "id,company_id,created_by,status,version,fields,created_at,updated_at,requester_kind,requester_id",
		v.draft, company, owner, "draft", int64(1), v.fields(), v.created, v.created, kind, requesterID))

	if v.published {
		status, version := "published", int64(len(v.events)+1)
		var paused, closed *time.Time
		for _, e := range v.events {
			switch e.action {
			case "close":
				status, closed, paused = "closed", &e.at, nil
			case "reopen":
				status, closed = "published", nil
			case "pause":
				status, paused = "paused", &e.at
			}
		}
		add(insert("vacancy_processes", "id,company_id,status,published_at,published_by,process_status,lifecycle_version,paused_at,closed_at",
			v.draft, company, status, v.pub, owner, "active", version, paused, closed))
	}
	add(insert("vacancy_teams", "draft_id,company_id,mode,version,updated_at", v.draft, company, v.mode, int64(1), v.created))

	var request *string
	if v.published {
		request = datePtr(&v.pubDate)
	}
	add(insert("job_draft_management_configs", "draft_id,version,request_date,hiring_headcount,target_close_date",
		v.draft, int64(1), request, int32(v.headcount), datePtr(v.target)))
	for _, c := range v.targets {
		add(insert("vacancy_close_target_changes", "id,draft_id,company_id,previous_date,new_date,performed_by,performed_at",
			c.id, v.draft, company, datePtr(c.previous), datePtr(c.next), owner, c.at))
	}
	if v.commitment != nil {
		add(insert("job_draft_delivery_configs", "draft_id,version,cutoff_stage_id,target_quantity,commitment_date",
			v.draft, int64(1), v.stages["screening_ok"], int32(v.deliveryTarget), dateText(*v.commitment)))
		for _, c := range v.commitments {
			add(insert("vacancy_commitment_changes", "id,draft_id,company_id,previous_date,new_date,reason,performed_by,performed_at",
				c.id, v.draft, company, dateText(c.previous), dateText(c.next), "client_request", owner, c.at))
		}
	}
	if v.storedPipeline {
		raw, err := json.Marshal(v.pipeline)
		if err != nil {
			b.fail("%s: pipeline: %v", v.key, err)
		}
		add(insert("job_draft_pipeline_configs", "draft_id,version,configuration", v.draft, int64(1), raw))
	}

	for _, t := range v.tramos {
		var endedBy *uuid.UUID
		if t.end != nil {
			endedBy = &owner
		}
		add(insert("vacancy_assignments", "id,draft_id,company_id,user_id,started_at,started_by,start_cause,ended_at,ended_by,end_cause,reassignment_id",
			t.id, v.draft, company, b.user(t.user), t.start, owner, t.startCause, t.end, endedBy, textPtr(t.endCause), t.reassignment))
		for _, f := range t.functions {
			add(insert("vacancy_assignment_functions", "id,assignment_id,draft_id,function,started_at,start_cause,ended_at,end_cause",
				f.id, t.id, v.draft, f.kind, f.start, f.startCause, f.end, textPtr(f.endCause)))
		}
	}

	for _, p := range v.parts {
		created := p.entries[0].at
		if p.companyCV != nil {
			hash := sha256.Sum256([]byte("devseed-metrics-demo/company-cv/" + p.companyCV.String()))
			add(insert("company_candidate_cvs", "id,company_id,storage_key,size,content_type,file_name,uploaded_at",
				*p.companyCV, company, hex.EncodeToString(hash[:]), int64(184_320), "application/pdf", "CV "+p.who.name+".pdf", created))
		}
		var cv *uuid.UUID
		if p.source == "organic" {
			cv = &p.who.cv
		}
		stage := v.stages[p.stage()]
		var previous *uuid.UUID
		var group, code *string
		var discarded *time.Time
		if p.discarded {
			from := v.stages[p.last().from]
			previous, group, code, discarded = &from, textPtr("recruiter"), &p.last().reasonCode, &p.last().at
		}
		add(insert("process_participations", "id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,origin_channel,created_at,company_candidate_cv_id,added_by,version,previous_stage_id,reason_group,reason_code,discarded_at",
			p.id, v.draft, p.who.id, stage, cv, "[]", "[]", p.source, p.channel, created, p.companyCV, p.addedBy, int64(len(p.entries)), previous, group, code, discarded))
		for _, e := range p.entries {
			actorKind := "candidate"
			if e.recruiter {
				actorKind = "recruiter"
			}
			var from *uuid.UUID
			if e.from != "" {
				id := v.stages[e.from]
				from = &id
			}
			var group *string
			if e.reasonCode != "" {
				group = textPtr("recruiter")
			}
			add(insert("participation_stage_history", "id,participation_id,stage_id,actor_id,created_at,event_kind,from_stage_id,actor_kind,hire,departure,reason_group,reason_code",
				e.id, p.id, v.stages[e.stage], e.actor, e.at, e.kind, from, actorKind, e.hire, e.departure, group, textPtr(e.reasonCode)))
		}
	}

	if n := v.fulfilled(); n != nil {
		result, late := v.result()
		delta := -late
		if result == "on_time" {
			delta = businessDaysBetween(civil(n.at), *v.commitment)
		}
		type person struct {
			ID       uuid.UUID `json:"id"`
			FullName string    `json:"full_name"`
		}
		type reached struct {
			ParticipationID uuid.UUID `json:"participation_id"`
			Candidate       person    `json:"candidate"`
			ReachedAt       time.Time `json:"reached_at"`
		}
		var frozen []reached
		for _, e := range v.reaches()[:v.deliveryTarget] {
			p := v.partOf(e)
			frozen = append(frozen, reached{ParticipationID: p.id, Candidate: person{ID: p.who.id, FullName: p.who.name}, ReachedAt: e.at.UTC()})
		}
		raw, err := json.Marshal(frozen)
		if err != nil {
			b.fail("%s: fulfillment: %v", v.key, err)
		}
		add(insert("process_delivery_fulfillments", "process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates",
			v.draft, n.at, result, int32(delta), int32(v.deliveryTarget), int32(v.deliveryTarget), v.stages["screening_ok"], v.stageNames["screening_ok"], dateText(*v.commitment), raw))
	}

	for _, c := range v.credits {
		var exit *uuid.UUID
		var exitReason *string
		var changedAt *time.Time
		var changedBy *uuid.UUID
		if c.exit != nil {
			exit, exitReason, changedAt, changedBy = &c.exit.id, textPtr("candidate_left"), &c.exit.at, &owner
		}
		add(insert("placement_credits", "id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status,exit_history_id,exit_reason,status_changed_at,status_changed_by",
			c.id, company, v.draft, c.p.id, c.hire.id, c.hire.at, c.hire.actor, v.mode, c.status, exit, exitReason, changedAt, changedBy))
		for _, r := range c.recipients {
			add(insert("placement_credit_recipients", "credit_id,user_id,assignment_id,kind", c.id, b.user(r.user), v.tramoAt(r.user, c.hire.at).id, r.kind))
		}
	}
	for _, r := range v.reassignments {
		add(insert("vacancy_reassignments", "id,draft_id,company_id,from_assignment_id,to_assignment_id,reason,note,previous_responsible,performed_by,performed_at,state_snapshot",
			r.id, v.draft, company, r.from, r.to, r.reason, textPtr(r.note), r.prev, owner, r.at, r.snapshot))
	}
	for i, e := range v.events {
		var process *string
		var reason *string
		if e.action == "close" {
			process, reason = textPtr("continue"), textPtr(e.reason)
		}
		add(insert("vacancy_lifecycle_events", "id,process_id,lifecycle_version,action,process,actor_id,actor_name,created_at,reason,reason_note",
			ID("vacancy", v.key, "lifecycle", strconv.Itoa(i)), v.draft, int64(i+2), e.action, process, owner, b.people.OwnerName, e.at, reason, textPtr(e.note)))
	}
}

// offboard ends every open tramo of a user, as removing their membership
// does (membership_ended).
func (b *builder) offboard(user string, when time.Time) {
	b.check("offboard", when)
	for _, v := range b.vacancies {
		for _, t := range v.tramos {
			if t.user != user || t.end != nil || !t.start.Before(when) {
				continue
			}
			end := when
			t.end, t.endCause = &end, "membership_ended"
			if f := t.open(); f != nil {
				f.end, f.endCause = &end, "tramo_ended"
			}
		}
	}
}

// --- entry point ------------------------------------------------------------

// recruiters are the fictitious recruiters: users rows without a login.
// valeria left the company (membership removed); her history stays.
var recruiters = []struct{ key, name string }{
	{"mariana", "Mariana Ortiz"},
	{"jorge", "Jorge Paredes"},
	{"lucia", "Lucía Hernández"},
	{"diego", "Diego Navarro"},
	{"valeria", "Valeria Ríos"},
}

const formerMember = "valeria"

var requesterCatalog = []struct{ key, kind, name string }{
	{"banorte", "client", "Banorte · Finanzas"},
	{"liverpool", "client", "Liverpool · Tecnología"},
	{"bimbo", "client", "Grupo Bimbo · Operaciones"},
	{"rrhh", "internal_area", "Interno · RR. HH."},
}

var firstNames = []string{"Ana", "Luis", "Carmen", "José", "Fernanda", "Ricardo", "Paola", "Miguel", "Daniela", "Alejandro",
	"Sofía", "Andrés", "Gabriela", "Raúl", "Elena", "Héctor", "Natalia", "Óscar", "Regina", "Emilio"}
var lastNames = []string{"García", "Martínez", "López", "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz",
	"Cruz", "Morales", "Reyes", "Gutiérrez", "Mendoza", "Aguilar", "Castillo", "Jiménez", "Vargas", "Romero"}

const candidatePool = 60

// FictitiousUsers are the users rows the demo creates: the fictitious
// recruiters, then the candidates.
func FictitiousUsers() []uuid.UUID {
	out := make([]uuid.UUID, 0, len(recruiters)+candidatePool)
	for _, r := range recruiters {
		out = append(out, ID("user", r.key))
	}
	for i := 0; i < candidatePool; i++ {
		out = append(out, ID("candidate", strconv.Itoa(i)))
	}
	return out
}

// BuildPlan builds every row of the demo company for today (now in Mexico
// City). It is pure: the same now and people give the same statements, and
// ids never depend on now.
func BuildPlan(now time.Time, people People) (*Plan, error) {
	if people.Owner == uuid.Nil || people.Stakeholder == uuid.Nil || people.Recruiter == uuid.Nil {
		return nil, errors.New("the three accounts are required")
	}
	today := civil(now)
	b := &builder{company: CompanyID(), now: now, today: today, people: people,
		periodStart: time.Date(today.Year(), today.Month()-11, 1, 0, 0, 0, 0, time.UTC),
		monthEnd:    time.Date(today.Year(), today.Month()+1, 0, 0, 0, 0, 0, time.UTC),
		users:       map[string]uuid.UUID{"owner": people.Owner, "stakeholder": people.Stakeholder, "recruiter": people.Recruiter},
		requesters:  map[string]requester{}}
	plan := &Plan{}
	company := CompanyID()
	start := at(b.periodStart.AddDate(0, 0, -7), 9, 0)

	plan.Statements = append(plan.Statements,
		insert("companies", "id,name,rfc,industry_id,status,description,size,created_at,updated_at",
			company, CompanyName, companyRFC, "technology", "active", "Empresa ficticia para revisar el tablero de métricas (solo desarrollo).", "medium", start, start))
	for _, r := range recruiters {
		id := ID("user", r.key)
		b.users[r.key] = id
		plan.FictitiousUsers = append(plan.FictitiousUsers, id)
		email := strings.ReplaceAll(strings.ToLower(r.key), " ", ".") + ".demo-metricas@example.invalid"
		plan.Statements = append(plan.Statements, insert("users", "id,cognito_sub,email,full_name,user_type,created_at",
			id, "devseed-metrics-demo|"+r.key, email, r.name, "recruiter", start))
	}
	for _, m := range []struct {
		key, role string
	}{{"owner", "owner"}, {"stakeholder", "stakeholder"}, {"recruiter", "recruiter"}, {"mariana", "recruiter"}, {"jorge", "recruiter"}, {"lucia", "recruiter"}, {"diego", "recruiter"}} {
		plan.Statements = append(plan.Statements, insert("company_members", "id,user_id,company_id,role", ID("member", m.key), b.users[m.key], company, m.role))
	}
	for _, r := range requesterCatalog {
		name, err := valueobjects.NewRequesterName(r.name)
		if err != nil {
			return nil, err
		}
		b.requesters[r.key] = requester{id: ID("requester", r.key), kind: r.kind, name: name.Value()}
		plan.Statements = append(plan.Statements, insert("job_draft_requesters", "id,company_id,kind,name,name_key,normalization_version,created_at",
			ID("requester", r.key), company, r.kind, name.Value(), name.Key(), int32(1), start))
	}
	for i := 0; i < candidatePool; i++ {
		name := firstNames[i%len(firstNames)] + " " + lastNames[(i+3*(i/len(firstNames)))%len(lastNames)]
		c := candidate{id: ID("candidate", strconv.Itoa(i)), cv: ID("candidate-cv", strconv.Itoa(i)), name: name,
			email: fmt.Sprintf("candidato%02d.demo-metricas@example.invalid", i+1)}
		b.candidates = append(b.candidates, c)
		plan.FictitiousUsers = append(plan.FictitiousUsers, c.id)
		hash := sha256.Sum256([]byte("devseed-metrics-demo/cv/" + c.cv.String()))
		plan.Statements = append(plan.Statements,
			insert("users", "id,cognito_sub,email,full_name,user_type,created_at", c.id, "devseed-metrics-demo|candidate|"+strconv.Itoa(i+1), c.email, name, "candidate", start),
			insert("candidate_cv_versions", "id,candidate_id,storage_key,size,content_type,uploaded_at", c.cv, c.id, hex.EncodeToString(hash[:]), int64(204_800), "application/pdf", start),
			// The library entry names the CV on the board (T13); the file
			// itself is never uploaded.
			insert("candidate_cv_library", "id,candidate_id,version_id,name", ID("candidate-cv-library", strconv.Itoa(i)), c.id, c.cv, "CV "+name+".pdf"))
	}

	scenario(b)

	for _, v := range b.vacancies {
		v.validate()
		v.emit(&plan.Statements)
	}
	if len(b.errs) > 0 {
		return nil, errors.Join(b.errs...)
	}
	return plan, nil
}
