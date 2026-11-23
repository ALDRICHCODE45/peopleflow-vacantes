package documents

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// TimestampLayout renders every timestamp of the documents API: UTC with microseconds (contract «Endpoints»).
const TimestampLayout = "2006-01-02T15:04:05.000000Z"

// FormatTime renders t in TimestampLayout.
func FormatTime(t time.Time) string { return t.UTC().Format(TimestampLayout) }

// Person is a user as the contract shows them: {id, name}.
type Person struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Item is one file document of GET P/documents, showing its current (highest) version.
type Item struct {
	ID string `json:"id"`
	// ParticipationID is always present: null for the vacancy scope (never omitted).
	ParticipationID *string  `json:"participation_id"`
	Name            string   `json:"name"`
	Format          Format   `json:"format"`
	ContentType     string   `json:"content_type"`
	Size            int64    `json:"size"`
	Version         int      `json:"version"`
	VersionCount    int      `json:"version_count"`
	CreatedAt       string   `json:"created_at"`
	CreatedBy       Person   `json:"created_by"`
	UpdatedAt       string   `json:"updated_at"`
	UpdatedBy       Person   `json:"updated_by"`
	AllowedActions  []Action `json:"allowed_actions"`
}

// LinkSource describes the pinned version of a link's source document (D16). It is null for a removed or
// inaccessible link.
type LinkSource struct {
	DocumentID      string  `json:"document_id"`
	ProcessID       string  `json:"process_id"`
	Sequence        int     `json:"sequence"`
	ParticipationID *string `json:"participation_id"`
	Name            string  `json:"name"`
	Format          Format  `json:"format"`
	Size            int64   `json:"size"`
	// Version is the pinned version number; UploadedAt/UploadedBy are that version's.
	Version         int    `json:"version"`
	VersionCount    int    `json:"version_count"`
	UploadedAt      string `json:"uploaded_at"`
	UploadedBy      Person `json:"uploaded_by"`
	HasNewerVersion bool   `json:"has_newer_version"`
}

// Link is one entry of `links[]`.
type Link struct {
	ID             string      `json:"id"`
	State          LinkState   `json:"state"`
	LinkedAt       string      `json:"linked_at"`
	LinkedBy       Person      `json:"linked_by"`
	AllowedActions []Action    `json:"allowed_actions"`
	Source         *LinkSource `json:"source"`
}

// List is the body of GET P/documents: both arrays are always present (empty, never null).
type List struct {
	Items []Item `json:"items"`
	Links []Link `json:"links"`
	Scope Scope  `json:"scope"`
}

// Reader is the read side of the documents store.
type Reader interface {
	// List returns the vacancy-scope documents of draftID for actor. It needs no process row: a never-published draft
	// lists too. Errors are the Err* sentinels below.
	List(ctx context.Context, companyID, actorID, draftID uuid.UUID) (List, error)
}

// Access failures of the store, in the vocabulary of the vacancy authorization (D4, D6). The HTTP layer maps each to the
// catalog code of the same name; nothing else crosses the boundary.
var (
	// ErrScopeNotFound: the vacancy, participation or document is not visible to the caller (404 not_found).
	ErrScopeNotFound = errors.New("documents: scope not found")
	// ErrTeamAccessEnded: a former team member (404 team_access_ended).
	ErrTeamAccessEnded = errors.New("documents: team access ended")
	// ErrForbidden: the caller's role may not do this (403 forbidden), e.g. a stakeholder writing.
	ErrForbidden = errors.New("documents: forbidden")
	// ErrUnauthenticated: the acting user no longer exists (401 unauthenticated).
	ErrUnauthenticated = errors.New("documents: unauthenticated")
	// ErrCompanyInactive: the session company is gone or tombstoned (403 company_inactive).
	ErrCompanyInactive = errors.New("documents: company inactive")
	// ErrCompanyNotActive: the company is not active yet (409 company_not_active).
	ErrCompanyNotActive = errors.New("documents: company not active")
)
