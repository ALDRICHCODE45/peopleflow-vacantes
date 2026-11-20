package application

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The pipeline of stakeholder-metrics-v2 §4.4 and its candidates list (§5.5):
// a picture of now, read from the company's pipeline snapshot (§2), not from
// the period.

const (
	// StalledThreshold is DV1: 7 business days in the stage, every stage
	// except placement.
	StalledThreshold = 7
	// TopVacancies bounds pipeline.top_vacancies.
	TopVacancies = 5
	// InProcessQuery is the candidates filter that reproduces a top
	// vacancy's in_process figure (with vacancy_id): every active stage
	// outside new, placement and the exit stage (DD2).
	InProcessQuery = "stage_kind=screening,screening_ok,in_process,custom,retired"
)

// stageKinds is the fixed order of §4.4; retired goes last, only when > 0.
var stageKinds = []string{"new", "screening", "screening_ok", "in_process", "custom", "placement", "retired"}

// PipelineStage is one stage of a vacancy's pipeline configuration.
type PipelineStage struct {
	ID   uuid.UUID
	Kind string
	Name string
}

// Pipeline is a vacancy's configuration: the progression stages in order,
// the exit stage and the retired stages. The composition root parses it from
// the jobs rules (defaults without a stored configuration).
type Pipeline struct {
	Stages   []PipelineStage
	Exit     uuid.UUID
	ExitName string
	Retired  []PipelineStage
}

// PipelineData is the pipeline snapshot: every open vacancy (published, not
// closed and not finished) with its current participations, and the people
// it names.
type PipelineData struct {
	Vacancies []*OpenVacancy
	People    map[uuid.UUID]Person
}

// OpenVacancy is one open vacancy and its active (not discarded)
// participations.
type OpenVacancy struct {
	ID             uuid.UUID
	Title          string
	Kind           string    // original | replacement; "" is original
	RootID         uuid.UUID // the original of the logical vacancy; Nil is the vacancy itself
	Sequence       *int      // position of a replacement in its chain; nil for an original
	Requester      *Requester
	Responsible    *uuid.UUID // the open responsible function, if any
	Tramos         []Tramo
	Pipeline       Pipeline
	Participations []Participation
}

// Participation is one active participation; EnteredAt is its current-stage
// entry (StageEntry).
type Participation struct {
	ID        uuid.UUID
	Candidate Candidate // as the company sees them
	StageID   uuid.UUID
	EnteredAt time.Time
}

// StageEvent is one stage history row into a participation's current stage.
type StageEvent struct {
	Kind string
	At   time.Time
}

// StageEntry is the current-stage entry (§4.4): the latest intake, move or
// recovery row into the current stage. substate and not_applicable rows never
// reset it. ok is false when no such row exists.
func StageEntry(events []StageEvent) (entry time.Time, ok bool) {
	for _, e := range events {
		if (e.Kind == "intake" || e.Kind == "move" || e.Kind == "recovery") && (!ok || e.At.After(entry)) {
			entry, ok = e.At, true
		}
	}
	return entry, ok
}

// stageOf resolves a stage id in the vacancy's configuration: its kind and
// name, retired for a stage no longer in the progression; exit is the
// discarded stage (not counted).
func (p Pipeline) stageOf(id uuid.UUID) (kind, name string, exit bool) {
	if id == p.Exit {
		return "", "", true
	}
	for _, s := range p.Stages {
		if s.ID == id {
			return s.Kind, s.Name, false
		}
	}
	for _, s := range p.Retired {
		if s.ID == id {
			return "retired", s.Name, false
		}
	}
	return "retired", "", false
}

// replacement reports a replacement process.
func (v *OpenVacancy) replacement() bool { return v.Kind == KindReplacement }

// ref is the vacancy as a row names it.
func (v *OpenVacancy) ref() VacancyRef {
	ref := VacancyRef{DraftID: v.ID, Title: v.Title, Kind: KindOriginal, RootDraftID: v.ID, Sequence: v.Sequence}
	if v.replacement() {
		ref.Kind = KindReplacement
		if v.RootID != uuid.Nil {
			ref.RootDraftID = v.RootID
		}
	}
	return ref
}

// selectedBy applies the process_kind filter ("" selects every process).
func (v *OpenVacancy) selectedBy(kind string) bool {
	return kind == "" || (kind == KindReplacement) == v.replacement()
}

// openTramo reports a tramo of user open at asOf.
func (v *OpenVacancy) openTramo(user uuid.UUID, asOf time.Time) bool {
	return openTramo(v.Tramos, user, asOf)
}

func openTramo(tramos []Tramo, user uuid.UUID, asOf time.Time) bool {
	return slices.ContainsFunc(tramos, func(t Tramo) bool {
		return t.UserID == user && !t.Start.After(asOf) && (t.End == nil || t.End.After(asOf))
	})
}

// staged is one active participation judged at as_of.
type staged struct {
	vac     *OpenVacancy
	p       Participation
	kind    string
	name    string
	days    int
	stalled bool
}

// pipelineView is the pipeline snapshot narrowed by the request's common
// filters (requester; recruiter = an open tramo at as_of), vacancy_id and
// process_kind. every is the same without process_kind (the candidates list
// counts its process_kind facet over every kind).
type pipelineView struct {
	rows  []staged
	every []staged
	snap  *PipelineSnapshot
}

func (s *Service) pipelineView(ctx context.Context, company uuid.UUID, q Query) (pipelineView, error) {
	snap, err := s.pipelines.get(ctx, company, func(ctx context.Context) (*PipelineData, error) { return s.store.LoadPipeline(ctx, company) })
	if err != nil {
		return pipelineView{}, err
	}
	out := pipelineView{rows: []staged{}, every: []staged{}, snap: snap}
	for _, v := range snap.Data.Vacancies {
		if !q.Requester.selects(v.Requester) || (q.RecruiterID != nil && !v.openTramo(*q.RecruiterID, snap.AsOf)) || (q.VacancyID != nil && v.ID != *q.VacancyID) {
			continue
		}
		for _, p := range v.Participations {
			kind, name, exit := v.Pipeline.stageOf(p.StageID)
			if exit {
				continue
			}
			days := s.calendar.BetweenInstants(p.EnteredAt, snap.AsOf)
			r := staged{vac: v, p: p, kind: kind, name: name, days: days, stalled: kind != "placement" && days >= StalledThreshold}
			out.every = append(out.every, r)
			if v.selectedBy(q.ProcessKind) {
				out.rows = append(out.rows, r)
			}
		}
	}
	return out, nil
}

// names is the pipeline snapshot shaped for applied_filters: vacancies with
// their title and requester, and the people.
func (d *PipelineData) names() *Dataset {
	out := &Dataset{Vacancies: make([]*Vacancy, len(d.Vacancies)), People: d.People}
	for i, v := range d.Vacancies {
		out.Vacancies[i] = &Vacancy{ID: v.ID, Title: v.Title, Requester: v.Requester}
	}
	return out
}

// PipelineSection is §4.4 (Pipeline por etapa).
type PipelineSection struct {
	header
	StalledThreshold int           `json:"stalled_threshold_business_days"`
	Stages           []StageFigure `json:"stages"`
	TopVacancies     []TopVacancy  `json:"top_vacancies"`
}

// StageFigure is one stage kind across the open vacancies.
type StageFigure struct {
	Kind                      string   `json:"kind"`
	Candidates                int      `json:"candidates"`
	MedianBusinessDaysInStage *float64 `json:"median_business_days_in_stage"`
	Stalled                   int      `json:"stalled"`
}

// TopVacancy is one open vacancy by active participations outside new,
// placement and the exit stage (DD2 «en proceso»).
type TopVacancy struct {
	Vacancy     VacancyRef `json:"vacancy"`
	Requester   *Requester `json:"requester"`
	Responsible *Person    `json:"responsible"`
	InProcess   int        `json:"in_process"`
}

// Pipeline answers §4.4: the period is validated and echoed, never applied.
func (s *Service) Pipeline(ctx context.Context, company uuid.UUID, raw string) (*PipelineSection, error) {
	q, p, err := prepare(raw, RoutePipeline)
	if err != nil {
		return nil, err
	}
	v, err := s.pipelineView(ctx, company, q)
	if err != nil {
		return nil, err
	}
	inProcess := map[*OpenVacancy]int{}
	for _, r := range v.rows {
		if r.kind != "new" && r.kind != "placement" {
			inProcess[r.vac]++
		}
	}
	out := &PipelineSection{header: newHeader(p, v.snap.AsOf), StalledThreshold: StalledThreshold, Stages: stageFigures(v.rows), TopVacancies: []TopVacancy{}}
	top := make([]*OpenVacancy, 0, len(inProcess))
	for vac := range inProcess {
		top = append(top, vac)
	}
	// Most active participations first, ties by title (then id, for a
	// stable order).
	slices.SortFunc(top, func(a, b *OpenVacancy) int {
		if c := cmp.Compare(inProcess[b], inProcess[a]); c != 0 {
			return c
		}
		if c := cmp.Compare(strings.ToLower(a.Title), strings.ToLower(b.Title)); c != 0 {
			return c
		}
		return cmp.Compare(a.ID.String(), b.ID.String())
	})
	data := v.snap.Data.names()
	for _, vac := range top[:min(len(top), TopVacancies)] {
		out.TopVacancies = append(out.TopVacancies, TopVacancy{Vacancy: vac.ref(), Requester: vac.Requester,
			Responsible: data.personPtr(vac.Responsible), InProcess: inProcess[vac]})
	}
	return out, nil
}

// stageFigures groups the rows by kind in the fixed order, retired only when
// > 0 (§4.4; the company dashboard's pipeline shares it).
func stageFigures(rows []staged) []StageFigure {
	days := map[string][]int{}
	stalled := map[string]int{}
	for _, r := range rows {
		days[r.kind] = append(days[r.kind], r.days)
		if r.stalled {
			stalled[r.kind]++
		}
	}
	out := []StageFigure{}
	for _, kind := range stageKinds {
		if kind == "retired" && len(days[kind]) == 0 {
			continue
		}
		out = append(out, StageFigure{Kind: kind, Candidates: len(days[kind]), MedianBusinessDaysInStage: Median(days[kind]), Stalled: stalled[kind]})
	}
	return out
}

// CandidateRow is one active participation of an open vacancy (§5.5); it
// carries the candidate's name, so its reads are audited.
type CandidateRow struct {
	ParticipationID     uuid.UUID  `json:"participation_id"`
	Candidate           Candidate  `json:"candidate"`
	Vacancy             VacancyRef `json:"vacancy"`
	Stage               StageRef   `json:"stage"`
	BusinessDaysInStage int        `json:"business_days_in_stage"`
	Stalled             bool       `json:"stalled"`
	EnteredStageAt      time.Time  `json:"entered_stage_at"`
}

// StageRef is a row's stage: the §4.4 kind and the stage's name in its
// vacancy (the retired stage's name for retired, empty when unknown).
type StageRef struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// StageKindFacet counts rows per §4.4 kind; retired only when > 0.
type StageKindFacet struct {
	New         int `json:"new"`
	Screening   int `json:"screening"`
	ScreeningOK int `json:"screening_ok"`
	InProcess   int `json:"in_process"`
	Custom      int `json:"custom"`
	Placement   int `json:"placement"`
	Retired     int `json:"retired,omitempty"`
}

func (f *StageKindFacet) add(kind string) {
	*map[string]*int{"new": &f.New, "screening": &f.Screening, "screening_ok": &f.ScreeningOK, "in_process": &f.InProcess,
		"custom": &f.Custom, "placement": &f.Placement, "retired": &f.Retired}[kind]++
}

type CandidateFacets struct {
	StageKind   StageKindFacet    `json:"stage_kind"`
	Stalled     int               `json:"stalled"`
	ProcessKind *ProcessKindFacet `json:"process_kind,omitempty"`
}

func (f *ProcessKindFacet) addOpen(v *OpenVacancy) {
	if v.replacement() {
		f.Replacement++
	} else {
		f.Original++
	}
}

var candidateColumns = map[string]sortColumn[CandidateRow]{
	"business_days_in_stage": {keyInt, func(r CandidateRow) *string { return intKey(&r.BusinessDaysInStage) }},
	"candidate":              {keyText, func(r CandidateRow) *string { return textKey(r.Candidate.FullName) }},
	"title":                  {keyText, func(r CandidateRow) *string { return textKey(r.Vacancy.Title) }},
	"entered_stage_at":       {keyTime, func(r CandidateRow) *string { return timeKey(r.EnteredStageAt) }},
}

// ListCandidates answers GET …/metrics/candidates (§5.5). Each successful
// page writes one MetricsDetailViewed row in its own transaction before it is
// served (§6); a failed audit serves nothing.
func (s *Service) ListCandidates(ctx context.Context, company, actor uuid.UUID, raw string) (*List[CandidateRow, CandidateFacets], error) {
	l, err := prepareList(company, raw, RouteCandidates, false)
	if err != nil {
		return nil, err
	}
	b, err := s.buildCandidates(ctx, l)
	if err != nil {
		return nil, err
	}
	out, err := finish(l, b)
	if err != nil {
		return nil, err
	}
	if err := s.store.RecordDetail(ctx, DetailAudit{Company: company, Actor: actor, Report: "candidates", Vacancy: l.q.VacancyID,
		VacancyOwned: b.owned, Filters: auditFilters(l)}); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) buildCandidates(ctx context.Context, l listing) (*built[CandidateRow, CandidateFacets], error) {
	v, err := s.pipelineView(ctx, l.company, l.q)
	if err != nil {
		return nil, err
	}
	q := l.q
	b := &built[CandidateRow, CandidateFacets]{rows: []CandidateRow{}, asOf: v.snap.AsOf, facets: CandidateFacets{ProcessKind: &ProcessKindFacet{}}}
	for _, r := range v.every {
		kindOK := q.StageKinds == nil || slices.Contains(q.StageKinds, r.kind)
		stalledOK := !q.Stalled || r.stalled
		processOK := r.vac.selectedBy(q.ProcessKind)
		// Each facet ignores only its own filter.
		if stalledOK && processOK {
			b.facets.StageKind.add(r.kind)
		}
		if kindOK && r.stalled && processOK {
			b.facets.Stalled++
		}
		if kindOK && stalledOK {
			b.facets.ProcessKind.addOpen(r.vac)
		}
		if !kindOK || !stalledOK || !processOK {
			continue
		}
		b.rows = append(b.rows, CandidateRow{ParticipationID: r.p.ID, Candidate: r.p.Candidate, Vacancy: r.vac.ref(),
			Stage: StageRef{r.kind, r.name}, BusinessDaysInStage: r.days, Stalled: r.stalled, EnteredStageAt: r.p.EnteredAt.UTC()})
	}
	if b.applied, b.owned, err = s.applied(ctx, l.company, q, v.snap.Data.names()); err != nil {
		return nil, err
	}
	sortRows(l, b, candidateColumns, func(r CandidateRow) uuid.UUID { return r.ParticipationID })
	return b, nil
}

// ApplicationRow is one vacancy with applications created in the period
// (§5.6, DV4: no candidates). Total sums the selected channels (every channel
// without a channel filter), so the rows add up to the response total.
type ApplicationRow struct {
	Vacancy     VacancyRef `json:"vacancy"`
	Requester   *Requester `json:"requester"`
	Portal      int        `json:"portal"`
	CareersSite int        `json:"careers_site"`
	Manual      int        `json:"manual"`
	Unknown     int        `json:"unknown"`
	Total       int        `json:"total"`
}

type ApplicationFacets struct {
	Channel     Origin            `json:"channel"`
	ProcessKind *ProcessKindFacet `json:"process_kind,omitempty"`
}

var applicationColumns = map[string]sortColumn[ApplicationRow]{
	"total": {keyInt, func(r ApplicationRow) *string { return intKey(&r.Total) }},
	"title": {keyText, func(r ApplicationRow) *string { return textKey(r.Vacancy.Title) }},
}

// ListApplications answers GET …/metrics/applications (§5.6, not audited).
// Its total is the sum of applications in the selected channels (the §4.6
// origin figure), not the row count.
func (s *Service) ListApplications(ctx context.Context, company uuid.UUID, raw string) (*List[ApplicationRow, ApplicationFacets], error) {
	l, err := prepareList(company, raw, RouteApplications, false)
	if err != nil {
		return nil, err
	}
	b, total, err := s.buildApplications(ctx, l)
	if err != nil {
		return nil, err
	}
	out, err := finish(l, b)
	if err != nil {
		return nil, err
	}
	out.Total = total
	return out, nil
}

func (s *Service) buildApplications(ctx context.Context, l listing) (*built[ApplicationRow, ApplicationFacets], int, error) {
	v, err := s.listView(ctx, l, l.q.RecruiterID)
	if err != nil {
		return nil, 0, err
	}
	q := l.q
	b := &built[ApplicationRow, ApplicationFacets]{rows: []ApplicationRow{}, asOf: v.asOf, facets: ApplicationFacets{ProcessKind: &ProcessKindFacet{}}}
	total := 0
	for _, vac := range v.every.Vacancies {
		if q.VacancyID != nil && vac.ID != *q.VacancyID {
			continue
		}
		kindOK := vac.selectedBy(q.ProcessKind)
		if kindOK {
			b.facets.Channel.add(vac.Origin)
		}
		row := ApplicationRow{Vacancy: vac.ref(), Requester: vac.Requester, Portal: vac.Origin["portal"],
			CareersSite: vac.Origin["careers_site"], Manual: vac.Origin["manual"], Unknown: vac.Origin["unknown"]}
		for _, channel := range channels {
			if q.Channels == nil || slices.Contains(q.Channels, channel) {
				row.Total += vac.Origin[channel]
			}
		}
		b.facets.ProcessKind.add(vac, row.Total)
		if row.Total == 0 || !kindOK {
			continue
		}
		total += row.Total
		b.rows = append(b.rows, row)
	}
	if b.applied, b.owned, err = s.applied(ctx, l.company, q, v.all); err != nil {
		return nil, 0, err
	}
	sortRows(l, b, applicationColumns, func(r ApplicationRow) uuid.UUID { return r.Vacancy.DraftID })
	return b, total, nil
}
