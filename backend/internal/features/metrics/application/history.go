package application

import (
	"time"

	"github.com/google/uuid"
)

// The history snapshot of company-dashboard-v2 §4: every published vacancy of
// the company with its publication history and the stage history of its
// participations, keyed (company) only, so an owner and their recruiters share
// one load. Scope (DD1) is a Go filter over it.

// HistoryDays is how far back the history covers: the 90-day window plus the
// previous window's end point (181 days), with one day of margin.
const HistoryDays = 182

// HistoryData is the history snapshot and the people it names.
type HistoryData struct {
	Vacancies []*HistoryVacancy
	People    map[uuid.UUID]Person
}

// HistoryVacancy is one vacancy published at least once. The embedded Vacancy
// carries the title, requester, headcount, responsible, tramos and, for open
// vacancies, the delivery facts and cutoff entries.
type HistoryVacancy struct {
	*Vacancy
	Status        string // publication now: published | paused | closed
	Finished      bool   // the internal process is finished
	Pipeline      Pipeline
	Lifecycle     []LifecycleEvent // oldest first
	ActiveCredits int
	Tracks        []Track
	// Recent holds the vacancy's 5 newest participations in any state.
	Recent []RecentRow
}

// LifecycleEvent is one vacancy_lifecycle_events row.
type LifecycleEvent struct {
	Action string // pause | resume | close | finish_process | reopen
	At     time.Time
}

// Track is one participation and its stage history: the intake, move,
// recovery and discard rows, oldest first (substate and not_applicable never
// change the stage). Loaded unless it was discarded before the history began.
type Track struct {
	ID        uuid.UUID
	Candidate Candidate // as the company sees them (dashboard candidates list)
	CreatedAt time.Time
	Channel   string // origin_channel
	StageID   uuid.UUID
	Discarded bool
	Moves     []StageMove
}

// StageMove is one stage history row.
type StageMove struct {
	Kind    string    `json:"kind"`
	StageID uuid.UUID `json:"stage_id"`
	At      time.Time `json:"at"`
}

// RecentRow is one participation of the recent section (§3.5), the shape of
// GET /v2/me/company/dashboard's recent rows. The store fills the stage id;
// the name and kind come from the vacancy's current configuration.
type RecentRow struct {
	ParticipationID uuid.UUID       `json:"participation_id"`
	Candidate       RecentCandidate `json:"candidate"`
	Vacancy         RecentVacancy   `json:"vacancy"`
	Stage           RecentStage     `json:"stage"`
	Source          string          `json:"source"`
	AppliedAt       time.Time       `json:"applied_at"`
	AddedBy         *RecentPerson   `json:"added_by"`
}

type RecentCandidate struct {
	Kind              string    `json:"kind"`
	ID                uuid.UUID `json:"id"`
	Name              string    `json:"name"`
	ProfessionalTitle *string   `json:"professional_title"`
}

type RecentVacancy struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}

type RecentStage struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
	Kind string    `json:"kind"`
}

type RecentPerson struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// publishedAt reports whether the vacancy was published (not paused, closed
// or finished) at the instant t: published before t, then the last
// lifecycle event before t decides.
func (v *HistoryVacancy) publishedAt(t time.Time) bool {
	if !v.PublishedAt.Before(t) {
		return false
	}
	on := true
	for _, e := range v.Lifecycle {
		if !e.At.Before(t) {
			break
		}
		switch e.Action {
		case "pause", "close", "finish_process":
			on = false
		case "resume", "reopen":
			on = true
		}
	}
	return on
}

// open is now: not closed and not finished (paused counts as open).
func (v *HistoryVacancy) open() bool {
	return v.Status != "closed" && !v.Finished
}

// stageAt is the participation's stage at the instant t and whether it was
// active then (entered and not discarded). Without history rows it sits in
// its current stage from its creation.
func (p *Track) stageAt(t time.Time) (uuid.UUID, bool) {
	var stage uuid.UUID
	seen, active := false, false
	for _, m := range p.Moves {
		if !m.At.Before(t) {
			break
		}
		switch m.Kind {
		case "intake", "move", "recovery":
			stage, seen, active = m.StageID, true, true
		case "discard":
			stage, seen, active = m.StageID, true, false
		}
	}
	if !p.moved() {
		return p.StageID, !p.Discarded && p.CreatedAt.Before(t)
	}
	return stage, seen && active
}

// entryAt is the entry into stage as of t: the latest intake, move or
// recovery row into it before t (StageEntry's rule), else the creation.
func (p *Track) entryAt(stage uuid.UUID, t time.Time) time.Time {
	entry := p.CreatedAt
	for _, m := range p.Moves {
		if !m.At.Before(t) {
			break
		}
		if m.StageID == stage && (m.Kind == "intake" || m.Kind == "move" || m.Kind == "recovery") {
			entry = m.At
		}
	}
	return entry
}

// moved reports a stage row (substate and not_applicable rows do not count).
func (p *Track) moved() bool {
	for _, m := range p.Moves {
		if m.Kind == "intake" || m.Kind == "move" || m.Kind == "recovery" || m.Kind == "discard" {
			return true
		}
	}
	return false
}

// inProcess is DD2 «en proceso» for a stage of the vacancy: not new, not
// placement, not the exit stage (a retired stage counts).
func (p Pipeline) inProcess(stage uuid.UUID) bool {
	kind, _, exit := p.stageOf(stage)
	return !exit && kind != "new" && kind != "placement"
}

// inProcessAt counts the vacancy's participations in process at t.
func (v *HistoryVacancy) inProcessAt(t time.Time) int {
	n := 0
	for i := range v.Tracks {
		if stage, active := v.Tracks[i].stageAt(t); active && v.Pipeline.inProcess(stage) {
			n++
		}
	}
	return n
}

// recentStage names a stage as today's dashboard does: the progression,
// exit (kind discarded) and retired stages keep their configured kind.
func (p Pipeline) recentStage(id uuid.UUID) RecentStage {
	out := RecentStage{ID: id, Kind: "custom"}
	switch {
	case id == p.Exit:
		out.Name, out.Kind = p.ExitName, "discarded"
	default:
		for _, s := range append(append([]PipelineStage{}, p.Stages...), p.Retired...) {
			if s.ID == id {
				out.Name, out.Kind = s.Name, s.Kind
			}
		}
	}
	return out
}
