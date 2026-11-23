package documents

import (
	"sort"

	"github.com/google/uuid"
)

// MaxOverviewRows caps items plus links of GET V/document-overview (L20): there is no pagination, the newest rows win.
const MaxOverviewRows = 2000

// OwnerKind says where a row of the overview lives.
type OwnerKind string

const (
	OwnerVacancy       OwnerKind = "vacancy"
	OwnerParticipation OwnerKind = "participation"
)

// NamedCandidate is the {kind, id, full_name} the board shows (the company's view of the name).
type NamedCandidate struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	FullName string `json:"full_name"`
}

// Owner is `owner` of an overview row: {kind: "vacancy"} or {kind: "participation", participation_id, candidate, discarded}.
// The participation keys are absent (not null) for the vacancy.
type Owner struct {
	Kind            OwnerKind       `json:"kind"`
	ParticipationID string          `json:"participation_id,omitempty"`
	Candidate       *NamedCandidate `json:"candidate,omitempty"`
	Discarded       *bool           `json:"discarded,omitempty"`
}

// VacancyOwner is the owner of a vacancy-level document or link.
func VacancyOwner() Owner { return Owner{Kind: OwnerVacancy} }

// ParticipationOwner is the owner of a document or link of participation p.
func ParticipationOwner(p OverviewParticipation) Owner {
	candidate, discarded := p.Candidate, p.Discarded
	return Owner{Kind: OwnerParticipation, ParticipationID: p.ParticipationID, Candidate: &candidate, Discarded: &discarded}
}

// OverviewItem is an `items[]` entry of GET P/documents plus its owner.
type OverviewItem struct {
	Item
	Owner Owner `json:"owner"`
}

// OverviewLink is a `links[]` entry of GET P/documents plus its owner.
type OverviewLink struct {
	Link
	Owner Owner `json:"owner"`
}

// OverviewVacancy is the header of the overview. Publication, Process and Visibility are the lifecycle enums of GET V/lifecycle
// (publication published|paused|closed, process active|finished, visibility public|private; all null for a draft that never
// published), Kind is original|replacement. Title is null while the draft has none.
type OverviewVacancy struct {
	ID          string  `json:"id"`
	Title       *string `json:"title"`
	Publication *string `json:"publication"`
	Process     *string `json:"process"`
	Kind        string  `json:"kind"`
	Visibility  *string `json:"visibility"`
}

// Stage is a pipeline stage by kind and name only (as carry_candidates[].stage).
type Stage struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// StageResolver names the stages of a vacancy's pipeline from its stored configuration (nil when the vacancy keeps the
// default pipeline): stage id → kind and name, live, exit and retired stages alike. The jobs feature owns the vocabulary, so
// cmd/api composes it (a feature may not import another feature's packages).
type StageResolver func(draftID uuid.UUID, configuration []byte) (map[string]Stage, error)

// OverviewParticipation is a `participations[]` entry: every participation of the vacancy, discarded ones included, with the
// flags of its own scope (files plus links against the participation limit).
type OverviewParticipation struct {
	ParticipationID     string         `json:"participation_id"`
	Candidate           NamedCandidate `json:"candidate"`
	Discarded           bool           `json:"discarded"`
	Stage               Stage          `json:"stage"`
	ScopeAllowedActions []Action       `json:"scope_allowed_actions"`
	UploadBlockedReason *BlockedReason `json:"upload_blocked_reason"`
}

// Overview is the body of GET V/document-overview: one table with the documents and links of the vacancy and of every
// participation of it. `scope` is the vacancy scope exactly as GET V/documents answers it.
type Overview struct {
	Vacancy        OverviewVacancy         `json:"vacancy"`
	Scope          Scope                   `json:"scope"`
	Items          []OverviewItem          `json:"items"`
	Links          []OverviewLink          `json:"links"`
	Participations []OverviewParticipation `json:"participations"`
	// Truncated is true when more than the cap of rows (items plus links) matched: the newest were kept.
	Truncated bool `json:"truncated"`
}

// CapNewest keeps the cap newest rows across items and links (items by `updated_at`, links by `linked_at`, then id, all
// descending) and reports whether anything was dropped. Both inputs are expected newest first and the outputs are again;
// neither output is ever nil. Timestamps are the fixed-width TimestampLayout strings, so they compare as text.
func CapNewest(items []OverviewItem, links []OverviewLink, cap int) ([]OverviewItem, []OverviewLink, bool) {
	type entry struct {
		at, id string
		item   int // index into items, or -1
		link   int // index into links, or -1
	}
	entries := make([]entry, 0, len(items)+len(links))
	for i, it := range items {
		entries = append(entries, entry{at: it.UpdatedAt, id: it.ID, item: i, link: -1})
	}
	for i, l := range links {
		entries = append(entries, entry{at: l.LinkedAt, id: l.ID, item: -1, link: i})
	}
	sort.SliceStable(entries, func(a, b int) bool {
		if entries[a].at != entries[b].at {
			return entries[a].at > entries[b].at
		}
		return entries[a].id > entries[b].id
	})
	truncated := len(entries) > cap
	if truncated {
		entries = entries[:cap]
	}
	keptItems, keptLinks := []OverviewItem{}, []OverviewLink{}
	for _, e := range entries {
		if e.item >= 0 {
			keptItems = append(keptItems, items[e.item])
		} else {
			keptLinks = append(keptLinks, links[e.link])
		}
	}
	return keptItems, keptLinks, truncated
}
