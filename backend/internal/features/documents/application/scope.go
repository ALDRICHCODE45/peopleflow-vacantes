package documents

// Action is one entry of an `allowed_actions` array. The server says what can be done (as in the
// lifecycle contract): the UI never derives permissions from role, state or counts. Three closed
// enums share the type: items (download|replace|delete), links (download|unlink) and the scope
// (upload|link).
type Action string

const (
	ActionDownload Action = "download"
	ActionReplace  Action = "replace"
	ActionDelete   Action = "delete"
	ActionUnlink   Action = "unlink"
	ActionUpload   Action = "upload"
	ActionLink     Action = "link"
)

// LinkState is the closed `links[].state` enum (D18, D19).
type LinkState string

const (
	LinkAvailable    LinkState = "available"
	LinkRemoved      LinkState = "removed"
	LinkInaccessible LinkState = "inaccessible"
)

// BlockedReason is the closed `scope.upload_blocked_reason` enum; the field is null otherwise.
type BlockedReason string

// BlockedLimitReached: the caller can manage the scope and it is full (files plus links).
const BlockedLimitReached BlockedReason = "limit_reached"

// ScopeKind tells which of the two scopes of D1 a list belongs to.
type ScopeKind string

const (
	ScopeVacancy       ScopeKind = "vacancy"
	ScopeParticipation ScopeKind = "participation"
)

// MaxDocuments is the files-plus-links limit of the scope (D15): 50 per vacancy, 20 per participation.
func MaxDocuments(kind ScopeKind) int {
	if kind == ScopeParticipation {
		return MaxParticipationDocuments
	}
	return MaxVacancyDocuments
}

// Limits is `scope.limits`: what the UI needs for `accept` and its copy.
type Limits struct {
	MaxBytes     int64        `json:"max_bytes"`
	MaxDocuments int          `json:"max_documents"`
	MaxVersions  int          `json:"max_versions"`
	Formats      []Descriptor `json:"formats"`
}

// Counts is `scope.counts`; the limit applies to their sum (D15).
type Counts struct {
	Documents int `json:"documents"`
	Links     int `json:"links"`
}

// Scope is the object every list and every write answers with, so the frontend does not re-read the list.
type Scope struct {
	CanManage           bool           `json:"can_manage"`
	AllowedActions      []Action       `json:"allowed_actions"`
	UploadBlockedReason *BlockedReason `json:"upload_blocked_reason"`
	Limits              Limits         `json:"limits"`
	Counts              Counts         `json:"counts"`
}

// ScopeInput is what BuildScope needs; the store fills it inside its transaction.
type ScopeInput struct {
	Kind ScopeKind
	// CanManage: the caller passes the manage gate (owner or active team member; false for a stakeholder).
	CanManage bool
	// CanReceiveLinks: the scope is a replacement process or a carried participation (D17).
	CanReceiveLinks bool
	Documents       int
	Links           int
}

// BuildScope computes the scope flags. `upload` ⇔ can_manage ∧ documents+links < max; `link` additionally needs a
// scope that can receive links. upload_blocked_reason is limit_reached only for a caller who could manage the
// scope: for anyone else the missing `upload` is explained by can_manage = false.
func BuildScope(in ScopeInput) Scope {
	max := MaxDocuments(in.Kind)
	full := in.Documents+in.Links >= max
	allowed := []Action{}
	var blocked *BlockedReason
	if in.CanManage {
		if full {
			reason := BlockedLimitReached
			blocked = &reason
		} else {
			allowed = append(allowed, ActionUpload)
			if in.CanReceiveLinks {
				allowed = append(allowed, ActionLink)
			}
		}
	}
	return Scope{
		CanManage:           in.CanManage,
		AllowedActions:      allowed,
		UploadBlockedReason: blocked,
		Limits:              Limits{MaxBytes: MaxBytes, MaxDocuments: max, MaxVersions: MaxVersions, Formats: Formats()},
		Counts:              Counts{Documents: in.Documents, Links: in.Links},
	}
}

// ItemActions is `items[].allowed_actions`: a manager gets download, replace and delete, except that replace
// disappears at MaxVersions versions; anyone else only downloads.
func ItemActions(canManage bool, versionCount int) []Action {
	if !canManage {
		return []Action{ActionDownload}
	}
	out := []Action{ActionDownload}
	if versionCount < MaxVersions {
		out = append(out, ActionReplace)
	}
	return append(out, ActionDelete)
}

// LinkActions is `links[].allowed_actions`: an available link downloads (and a manager can unlink it); a removed
// or inaccessible one has nothing to download, so a manager only gets unlink and anyone else nothing.
func LinkActions(canManage bool, state LinkState) []Action {
	switch {
	case state == LinkAvailable && canManage:
		return []Action{ActionDownload, ActionUnlink}
	case state == LinkAvailable:
		return []Action{ActionDownload}
	case canManage:
		return []Action{ActionUnlink}
	}
	return []Action{}
}
