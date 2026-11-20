package application

import (
	"cmp"
	"context"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// The company dashboard v2 sections (company-dashboard-v2 §2–§3): the metrics
// engine for the people who run the vacancies (owner and recruiters), read
// from the shared company snapshots and narrowed in Go by the caller's scope
// (DD1).

const (
	// DashboardVersion travels on every dashboard response (§2).
	DashboardVersion = "d2"
	// DefaultWindow is the window without a window parameter.
	DefaultWindow = 30
	// DashboardTop bounds every top list of the dashboard.
	DashboardTop = 5
)

// windows are the accepted window lengths in days.
var windows = map[string]int{"7": 7, "30": 30, "90": 90}

// Viewer is the caller of a dashboard route. An owner sees every vacancy of
// the company; anyone else (a recruiter) the vacancies where they have an
// open tramo at as_of (DD1).
type Viewer struct {
	UserID uuid.UUID
	Owner  bool
}

func (v Viewer) scope() string {
	if v.Owner {
		return "company"
	}
	return "own_vacancies"
}

// sees applies the scope to a vacancy's tramos at asOf.
func (v Viewer) sees(tramos []Tramo, asOf time.Time) bool {
	return v.Owner || openTramo(tramos, v.UserID, asOf)
}

// Window is the last Days local days ending on the as_of date, and the Days
// days before them.
type Window struct {
	Days         int    `json:"days"`
	From         string `json:"from"`
	To           string `json:"to"`
	PreviousFrom string `json:"previous_from"`
	PreviousTo   string `json:"previous_to"`
}

// NewWindow builds the window of days ending on asOf's Mexico City date.
func NewWindow(days int, asOf time.Time) Window {
	to := civilOf(asOf)
	from := to.AddDate(0, 0, 1-days)
	prevTo := from.AddDate(0, 0, -1)
	return Window{days, from.Format(time.DateOnly), to.Format(time.DateOnly), prevTo.AddDate(0, 0, 1-days).Format(time.DateOnly), prevTo.Format(time.DateOnly)}
}

func (w Window) current() Period  { p, _ := NewPeriod(w.From, w.To); return p }
func (w Window) previous() Period { p, _ := NewPeriod(w.PreviousFrom, w.PreviousTo); return p }

// dayEnd is the end of a local date: the first instant of the next day.
func dayEnd(date string) time.Time {
	d, _ := time.ParseInLocation(time.DateOnly, date, zone)
	return d.AddDate(0, 0, 1)
}

// dates lists every date from from to to, inclusive.
func dates(from, to string) []string {
	out := []string{}
	for d := civilDate(from); !d.After(civilDate(to)); d = d.AddDate(0, 0, 1) {
		out = append(out, d.Format(time.DateOnly))
	}
	return out
}

// weekEnd is the Sunday of the Monday–Sunday week of a date (DD6); on
// Sunday it is the date itself.
func weekEnd(date string) string {
	d := civilDate(date)
	return d.AddDate(0, 0, (7-int(d.Weekday()))%7).Format(time.DateOnly)
}

// ParseWindow is the strict parser of the dashboard sections: only window
// (7, 30 or 90; 30 when absent). Unknown, duplicate or invalid parameters are
// 422 invalid_filter, as in metrics.
func ParseWindow(raw string) (int, error) {
	values := map[string][]string{}
	failures := map[string]string{}
	for _, pair := range strings.Split(raw, "&") {
		if pair == "" {
			continue
		}
		key, value, _ := strings.Cut(pair, "=")
		k, ke := url.QueryUnescape(key)
		v, ve := url.QueryUnescape(value)
		if ke != nil || !utf8.ValidString(k) {
			failures["query"] = "invalid"
			continue
		}
		if ve != nil || strings.Contains(pair, ";") {
			failures[reportedKey(k)] = "invalid"
		}
		values[k] = append(values[k], v)
	}
	days := DefaultWindow
	for key, vs := range values {
		switch {
		case key != "window":
			failures[reportedKey(key)] = "unknown"
		case len(vs) != 1:
			failures[key] = "duplicate"
		case failures[key] != "":
		default:
			if n, ok := windows[vs[0]]; ok {
				days = n
			} else {
				failures[key] = "invalid"
			}
		}
	}
	if len(failures) > 0 {
		fields := make([]Field, 0, len(failures))
		for key, code := range failures {
			fields = append(fields, Field{key, code})
		}
		slices.SortFunc(fields, func(a, b Field) int { return strings.Compare(a.Field, b.Field) })
		return 0, &InvalidFilter{Fields: fields}
	}
	return days, nil
}

// dashboardHeader is the part every dashboard response shares (§2).
type dashboardHeader struct {
	DefinitionsVersion string    `json:"definitions_version"`
	Window             Window    `json:"window"`
	AsOf               time.Time `json:"as_of"`
	Scope              string    `json:"scope"`
}

func newDashboardHeader(days int, asOf time.Time, viewer Viewer) dashboardHeader {
	return dashboardHeader{DashboardVersion, NewWindow(days, asOf), asOf.UTC().Truncate(time.Second), viewer.scope()}
}

// TalentBase answers summary.pool_added (§3.1): whether the caller may see
// the talent base, and the company's pool additions in the current and the
// previous window (the talent base's added rule). The composition root
// supplies both from the companies and applications features.
type TalentBase struct {
	CanView func(ctx context.Context, company, user uuid.UUID) (bool, error)
	Added   func(ctx context.Context, company uuid.UUID, current, previous Period) (int, int, error)
}

// WithTalentBase wires summary.pool_added; without it pool_added is null.
func (s *Service) WithTalentBase(tb TalentBase) *Service {
	s.talentBase = &tb
	return s
}

// poolKey caches the company-wide pool counts of one window.
type poolKey struct {
	company  uuid.UUID
	from, to string
}

// history loads (or reuses) the company's history snapshot.
func (s *Service) history(ctx context.Context, company uuid.UUID) (*cached[*HistoryData], error) {
	return s.histories.get(ctx, company, func(ctx context.Context) (*HistoryData, error) {
		since, _ := time.ParseInLocation(time.DateOnly, civilOf(s.now()).AddDate(0, 0, -HistoryDays).Format(time.DateOnly), zone)
		return s.store.LoadHistory(ctx, company, since)
	})
}

// visible is the history snapshot's vacancies in the caller's scope.
func (s *Service) visible(snap *cached[*HistoryData], viewer Viewer) []*HistoryVacancy {
	out := []*HistoryVacancy{}
	for _, v := range snap.Data.Vacancies {
		if viewer.sees(v.Tramos, snap.AsOf) {
			out = append(out, v)
		}
	}
	return out
}

// DashboardSummarySection is §3.1 (Resumen).
type DashboardSummarySection struct {
	dashboardHeader
	InProcess          InProcessFigure `json:"in_process"`
	PublishedVacancies Delta[int]      `json:"published_vacancies"`
	PoolAdded          *Delta[int]     `json:"pool_added"`
	Positions          Positions       `json:"positions"`
}

// InProcessFigure carries the daily series: the previous window's last day,
// then every day of the window, end-of-day values.
type InProcessFigure struct {
	Delta[int]
	Series []DayValue `json:"series"`
}

type DayValue struct {
	Date  string `json:"date"`
	Value int    `json:"value"`
}

// Positions are active placement credits over hiring_headcount (DD3).
type Positions struct {
	Covered  int `json:"covered"`
	Required int `json:"required"`
}

func (p *Positions) add(v *HistoryVacancy) {
	p.Covered += v.ActiveCredits
	if v.Headcount != nil {
		p.Required += *v.Headcount
	}
}

// DashboardSummary answers §3.1.
func (s *Service) DashboardSummary(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardSummarySection, error) {
	days, err := ParseWindow(raw)
	if err != nil {
		return nil, err
	}
	snap, err := s.history(ctx, company)
	if err != nil {
		return nil, err
	}
	out := &DashboardSummarySection{dashboardHeader: newDashboardHeader(days, snap.AsOf, viewer)}
	w := out.Window
	vacancies := s.visible(snap, viewer)
	out.InProcess.Series = []DayValue{}
	for _, date := range dates(w.PreviousTo, w.To) {
		end, n := dayEnd(date), 0
		for _, v := range vacancies {
			if v.publishedAt(end) {
				n += v.inProcessAt(end)
			}
		}
		out.InProcess.Series = append(out.InProcess.Series, DayValue{date, n})
	}
	out.InProcess.Previous = out.InProcess.Series[0].Value
	out.InProcess.Current = out.InProcess.Series[len(out.InProcess.Series)-1].Value
	for _, v := range vacancies {
		if v.publishedAt(dayEnd(w.PreviousTo)) {
			out.PublishedVacancies.Previous++
		}
		if v.publishedAt(dayEnd(w.To)) {
			out.PublishedVacancies.Current++
			out.Positions.add(v)
		}
	}
	if out.PoolAdded, err = s.poolAdded(ctx, company, viewer, w); err != nil {
		return nil, err
	}
	return out, nil
}

// poolAdded is company-wide and null without talent-base access; the counts
// are cached per company and window like the snapshots.
func (s *Service) poolAdded(ctx context.Context, company uuid.UUID, viewer Viewer, w Window) (*Delta[int], error) {
	if s.talentBase == nil {
		return nil, nil
	}
	allowed, err := s.talentBase.CanView(ctx, company, viewer.UserID)
	if err != nil || !allowed {
		return nil, err
	}
	counts, err := s.pools.get(ctx, poolKey{company, w.From, w.To}, func(ctx context.Context) ([2]int, error) {
		cur, prev, err := s.talentBase.Added(ctx, company, w.current(), w.previous())
		return [2]int{cur, prev}, err
	})
	if err != nil {
		return nil, err
	}
	return &Delta[int]{counts.Data[0], counts.Data[1]}, nil
}

// AttentionSection is §3.2 (Necesita atención), state now.
type AttentionSection struct {
	dashboardHeader
	Overdue     AttentionDeliveries `json:"overdue"`
	DueThisWeek AttentionDeliveries `json:"due_this_week"`
	Stalled     AttentionStalled    `json:"stalled"`
}

type AttentionDeliveries struct {
	Total int                 `json:"total"`
	Top   []AttentionDelivery `json:"top"`
}

// AttentionDelivery is one open delivery; BusinessDaysOverdue only on
// overdue rows.
type AttentionDelivery struct {
	Vacancy             VacancyRef `json:"vacancy"`
	Requester           *Requester `json:"requester"`
	Responsible         *Person    `json:"responsible"`
	CommitmentDate      string     `json:"commitment_date"`
	BusinessDaysOverdue *int       `json:"business_days_overdue,omitempty"`
	Delivered           int        `json:"delivered"`
	Target              int        `json:"target"`
}

type AttentionStalled struct {
	Total                 int          `json:"total"`
	ThresholdBusinessDays int          `json:"threshold_business_days"`
	Top                   []StalledRow `json:"top"`
}

// StalledRow is one stalled participation (DV1).
type StalledRow struct {
	ParticipationID     uuid.UUID  `json:"participation_id"`
	Candidate           Candidate  `json:"candidate"`
	Vacancy             VacancyRef `json:"vacancy"`
	Stage               StageRef   `json:"stage"`
	BusinessDaysInStage int        `json:"business_days_in_stage"`
}

// DashboardAttention answers §3.2: deliveries from the history snapshot,
// stalled from the pipeline snapshot; as_of is the older of the two.
func (s *Service) DashboardAttention(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*AttentionSection, error) {
	days, err := ParseWindow(raw)
	if err != nil {
		return nil, err
	}
	snap, err := s.history(ctx, company)
	if err != nil {
		return nil, err
	}
	pipe, err := s.dashboardPipeline(ctx, company, viewer)
	if err != nil {
		return nil, err
	}
	asOf := snap.AsOf
	if pipe.snap.AsOf.Before(asOf) {
		asOf = pipe.snap.AsOf
	}
	out := &AttentionSection{dashboardHeader: newDashboardHeader(days, asOf, viewer),
		Overdue: AttentionDeliveries{Top: []AttentionDelivery{}}, DueThisWeek: AttentionDeliveries{Top: []AttentionDelivery{}},
		Stalled: AttentionStalled{ThresholdBusinessDays: StalledThreshold, Top: []StalledRow{}}}
	today := LocalDate(snap.AsOf)
	sunday := weekEnd(today)
	var overdue, due []AttentionDelivery
	for _, v := range s.visible(snap, viewer) {
		d := v.Delivery
		if !v.open() || !d.Configured || d.Commitment == nil || d.TargetReachedAt != nil {
			continue
		}
		row := AttentionDelivery{Vacancy: v.ref(), Requester: v.Requester, Responsible: snap.Data.people().personPtr(v.Responsible),
			CommitmentDate: *d.Commitment, Delivered: v.Delivered()}
		if d.Target != nil {
			row.Target = *d.Target
		}
		switch c := *d.Commitment; {
		case c < today:
			n := s.calendar.Between(civilDate(c), civilDate(today))
			row.BusinessDaysOverdue = &n
			overdue = append(overdue, row)
		case c <= sunday:
			due = append(due, row)
		}
	}
	byTitle := func(a, b AttentionDelivery) int {
		if c := cmp.Compare(strings.ToLower(a.Vacancy.Title), strings.ToLower(b.Vacancy.Title)); c != 0 {
			return c
		}
		return cmp.Compare(a.Vacancy.DraftID.String(), b.Vacancy.DraftID.String())
	}
	// Most business days overdue first; soonest commitment first.
	slices.SortFunc(overdue, func(a, b AttentionDelivery) int {
		if c := cmp.Compare(*b.BusinessDaysOverdue, *a.BusinessDaysOverdue); c != 0 {
			return c
		}
		return byTitle(a, b)
	})
	slices.SortFunc(due, func(a, b AttentionDelivery) int {
		if c := cmp.Compare(a.CommitmentDate, b.CommitmentDate); c != 0 {
			return c
		}
		return byTitle(a, b)
	})
	out.Overdue.Total, out.DueThisWeek.Total = len(overdue), len(due)
	out.Overdue.Top = append(out.Overdue.Top, overdue[:min(len(overdue), DashboardTop)]...)
	out.DueThisWeek.Top = append(out.DueThisWeek.Top, due[:min(len(due), DashboardTop)]...)
	var stalled []staged
	for _, r := range pipe.rows {
		if r.stalled {
			stalled = append(stalled, r)
		}
	}
	// Most business days first, ties by candidate, then participation.
	slices.SortFunc(stalled, func(a, b staged) int {
		if c := cmp.Compare(b.days, a.days); c != 0 {
			return c
		}
		if c := cmp.Compare(strings.ToLower(a.p.Candidate.FullName), strings.ToLower(b.p.Candidate.FullName)); c != 0 {
			return c
		}
		return cmp.Compare(a.p.ID.String(), b.p.ID.String())
	})
	out.Stalled.Total = len(stalled)
	for _, r := range stalled[:min(len(stalled), DashboardTop)] {
		out.Stalled.Top = append(out.Stalled.Top, StalledRow{ParticipationID: r.p.ID, Candidate: r.p.Candidate, Vacancy: r.vac.ref(),
			Stage: StageRef{r.kind, r.name}, BusinessDaysInStage: r.days})
	}
	return out, nil
}

// people names the snapshot's people (responsible, tramos).
func (d *HistoryData) people() *Dataset { return &Dataset{People: d.People} }

// dashboardPipeline is the pipeline snapshot narrowed to the caller's scope:
// a recruiter is the metrics recruiter filter (an open tramo at as_of).
func (s *Service) dashboardPipeline(ctx context.Context, company uuid.UUID, viewer Viewer) (pipelineView, error) {
	var q Query
	if !viewer.Owner {
		q.RecruiterID = &viewer.UserID
	}
	return s.pipelineView(ctx, company, q)
}

// DashboardPipelineSection is §3.3: the metrics §4.4 stages, scoped.
type DashboardPipelineSection struct {
	dashboardHeader
	StalledThreshold int           `json:"stalled_threshold_business_days"`
	Stages           []StageFigure `json:"stages"`
}

// DashboardPipeline answers §3.3 (no top vacancies: §3.4 lists them).
func (s *Service) DashboardPipeline(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardPipelineSection, error) {
	days, err := ParseWindow(raw)
	if err != nil {
		return nil, err
	}
	v, err := s.dashboardPipeline(ctx, company, viewer)
	if err != nil {
		return nil, err
	}
	return &DashboardPipelineSection{dashboardHeader: newDashboardHeader(days, v.snap.AsOf, viewer), StalledThreshold: StalledThreshold, Stages: stageFigures(v.rows)}, nil
}

// VacanciesSection is §3.4 (Vacantes activas).
type VacanciesSection struct {
	dashboardHeader
	Top []ActiveVacancy `json:"top"`
}

type ActiveVacancy struct {
	Vacancy     VacancyRef `json:"vacancy"`
	Requester   *Requester `json:"requester"`
	Responsible *Person    `json:"responsible"`
	InProcess   int        `json:"in_process"`
	Positions   Positions  `json:"positions"`
}

// DashboardVacancies answers §3.4: the published vacancies in scope by «en
// proceso» now (DD2), ties by title; a vacancy with 0 is still listed.
func (s *Service) DashboardVacancies(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*VacanciesSection, error) {
	days, err := ParseWindow(raw)
	if err != nil {
		return nil, err
	}
	snap, err := s.history(ctx, company)
	if err != nil {
		return nil, err
	}
	out := &VacanciesSection{dashboardHeader: newDashboardHeader(days, snap.AsOf, viewer), Top: []ActiveVacancy{}}
	end := dayEnd(out.Window.To)
	rows := []ActiveVacancy{}
	for _, v := range s.visible(snap, viewer) {
		if !v.publishedAt(end) {
			continue
		}
		row := ActiveVacancy{Vacancy: v.ref(), Requester: v.Requester, Responsible: snap.Data.people().personPtr(v.Responsible), InProcess: v.inProcessAt(end)}
		row.Positions.add(v)
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b ActiveVacancy) int {
		if c := cmp.Compare(b.InProcess, a.InProcess); c != 0 {
			return c
		}
		if c := cmp.Compare(strings.ToLower(a.Vacancy.Title), strings.ToLower(b.Vacancy.Title)); c != 0 {
			return c
		}
		return cmp.Compare(a.Vacancy.DraftID.String(), b.Vacancy.DraftID.String())
	})
	out.Top = append(out.Top, rows[:min(len(rows), DashboardTop)]...)
	return out, nil
}

// RecentSection is §3.5 recent.
type RecentSection struct {
	dashboardHeader
	Recent []RecentRow `json:"recent"`
}

// DashboardRecent answers §3.5 recent: the 5 newest participations of the
// vacancies in scope, any state, newest first, ties by participation id
// descending (today's order).
func (s *Service) DashboardRecent(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*RecentSection, error) {
	days, err := ParseWindow(raw)
	if err != nil {
		return nil, err
	}
	snap, err := s.history(ctx, company)
	if err != nil {
		return nil, err
	}
	rows := []RecentRow{}
	for _, v := range s.visible(snap, viewer) {
		for _, r := range v.Recent {
			r.Vacancy = RecentVacancy{v.ID, v.Title}
			r.Stage = v.Pipeline.recentStage(r.Stage.ID)
			rows = append(rows, r)
		}
	}
	slices.SortFunc(rows, func(a, b RecentRow) int {
		if c := b.AppliedAt.Compare(a.AppliedAt); c != 0 {
			return c
		}
		return cmp.Compare(b.ParticipationID.String(), a.ParticipationID.String())
	})
	return &RecentSection{dashboardHeader: newDashboardHeader(days, snap.AsOf, viewer), Recent: rows[:min(len(rows), DashboardTop)]}, nil
}

// DashboardOriginSection is §3.5 origin.
type DashboardOriginSection struct {
	dashboardHeader
	ByDay []OriginDay `json:"by_day"`
}

// OriginDay splits a day's applications: manual is the manual channel,
// organic every other (portal, careers site, unknown).
type OriginDay struct {
	Date    string `json:"date"`
	Organic int    `json:"organic"`
	Manual  int    `json:"manual"`
}

// DashboardOrigin answers §3.5 origin: participations of the vacancies in
// scope created on each day of the window, any state.
func (s *Service) DashboardOrigin(ctx context.Context, company uuid.UUID, viewer Viewer, raw string) (*DashboardOriginSection, error) {
	days, err := ParseWindow(raw)
	if err != nil {
		return nil, err
	}
	snap, err := s.history(ctx, company)
	if err != nil {
		return nil, err
	}
	out := &DashboardOriginSection{dashboardHeader: newDashboardHeader(days, snap.AsOf, viewer), ByDay: []OriginDay{}}
	index := map[string]int{}
	for i, date := range dates(out.Window.From, out.Window.To) {
		index[date] = i
		out.ByDay = append(out.ByDay, OriginDay{Date: date})
	}
	for _, v := range s.visible(snap, viewer) {
		for _, p := range v.Tracks {
			i, ok := index[LocalDate(p.CreatedAt)]
			switch {
			case !ok:
			case p.Channel == "manual":
				out.ByDay[i].Manual++
			default:
				out.ByDay[i].Organic++
			}
		}
	}
	return out, nil
}
