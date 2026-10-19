package pipelineconfig

import (
	"errors"
	"sort"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

var ErrImpactConfirmation = errors.New("pipeline impact confirmation required")

type Occupied struct{ StageIDs []string }

func (*Occupied) Error() string { return "pipeline stage occupied" }

type Candidate struct {
	ID       string `json:"id"`
	FullName string `json:"full_name"`
}
type Participation struct {
	ID              string
	Candidate       Candidate
	StageID         string
	PreviousStageID string
	Reached         map[string]bool
	Marked          map[string]bool
}
type NotApplicable struct {
	ParticipationID string    `json:"participation_id"`
	Candidate       Candidate `json:"candidate"`
	StageID         string    `json:"stage_id"`
}
type RecoveryReassigned struct {
	ParticipationID string    `json:"participation_id"`
	Candidate       Candidate `json:"candidate"`
	RetiredStageID  string    `json:"retired_stage_id"`
	DefaultStageID  string    `json:"default_stage_id"`
}
type Impact struct {
	NotApplicable      []NotApplicable      `json:"not_applicable"`
	RecoveryReassigned []RecoveryReassigned `json:"recovery_reassigned"`
}
type Preview struct {
	Stages []Stage `json:"stages"`
	Impact
	HasImpact bool `json:"has_impact"`
}

func EmptyImpact() Impact {
	return Impact{NotApplicable: []NotApplicable{}, RecoveryReassigned: []RecoveryReassigned{}}
}
func (i Impact) HasImpact() bool { return len(i.NotApplicable)+len(i.RecoveryReassigned) > 0 }

// Confirmation is decoded strictly alongside Replace; preview rejects even false.
func Confirmation(body []byte, preview bool) (bool, error) {
	value, err := draftjson.Decode(body)
	if err != nil {
		return false, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return false, drafts.ErrInvalidRequest
	}
	value, present := root["confirm_impact"]
	if !present {
		return false, nil
	}
	flag, ok := value.(bool)
	if preview || !ok {
		return false, drafts.ErrInvalidRequest
	}
	return flag, nil
}

// ComputeImpact is independent of persistence. Caller supplies locked live state
// and only real intake/move/recovery entries in Reached (never substate or marks).
func ComputeImpact(previous, next Configuration, people []Participation) (Impact, error) {
	impact := EmptyImpact()
	if previous.Equal(next) {
		return impact, nil
	}
	active := map[string]int{}
	for i, s := range next.Stages {
		active[s.ID] = i
	}
	occupied := &Occupied{}
	for _, s := range previous.Stages {
		if _, ok := active[s.ID]; ok {
			continue
		}
		for _, p := range people {
			if p.StageID == s.ID && p.PreviousStageID == "" {
				occupied.StageIDs = append(occupied.StageIDs, s.ID)
				break
			}
		}
	}
	if len(occupied.StageIDs) > 0 {
		return impact, occupied
	}
	people = append([]Participation{}, people...)
	sort.Slice(people, func(i, j int) bool { return people[i].ID < people[j].ID })
	// Recovery impact concerns only stages removed in this edit, not old retirees.
	removed := map[string]bool{}
	for _, s := range previous.Stages {
		if _, ok := active[s.ID]; !ok {
			removed[s.ID] = true
		}
	}
	for _, p := range people {
		if p.PreviousStageID != "" && removed[p.PreviousStageID] {
			target, ok := next.RecoveryStage(p.PreviousStageID)
			if !ok {
				return impact, errors.New("missing recovery default")
			}
			impact.RecoveryReassigned = append(impact.RecoveryReassigned, RecoveryReassigned{p.ID, p.Candidate, p.PreviousStageID, target})
		}
	}
	// Stage-first loops give exact stage order then participation id.
	for index, s := range next.Stages {
		for _, p := range people {
			position, ok := active[p.StageID]
			if p.PreviousStageID != "" {
				position, ok = active[p.PreviousStageID]
				if !ok {
					for _, r := range next.Retired {
						if r.ID == p.PreviousStageID {
							position, ok = r.Position, true
							break
						}
					}
				}
			}
			if !ok {
				return impact, errors.New("unknown participation position")
			}
			if index < position && !p.Reached[s.ID] && !p.Marked[s.ID] {
				impact.NotApplicable = append(impact.NotApplicable, NotApplicable{p.ID, p.Candidate, s.ID})
			}
		}
	}
	retiredOrder := map[string]int{}
	for _, r := range next.Retired {
		retiredOrder[r.ID] = r.Position
	}
	sort.SliceStable(impact.RecoveryReassigned, func(i, j int) bool {
		a, b := impact.RecoveryReassigned[i], impact.RecoveryReassigned[j]
		if retiredOrder[a.RetiredStageID] != retiredOrder[b.RetiredStageID] {
			return retiredOrder[a.RetiredStageID] < retiredOrder[b.RetiredStageID]
		}
		return a.ParticipationID < b.ParticipationID
	})
	return impact, nil
}
