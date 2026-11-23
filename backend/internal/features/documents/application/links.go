package documents

import (
	"context"

	"github.com/google/uuid"
)

// P7 of placement-vacancy-documents-v1: replacement linking (S3, D16-D19, D22). A link is a reference to a pinned version of a
// document of an earlier process of the replacement chain (or of an ancestor of a carried participation): nothing is copied,
// and every read of a link re-evaluates access to the source (D18).

// The closed `data.reason` enum of document_link_invalid (contract «Closed enums»).
const (
	// LinkNotReplacement: the target is not a replacement process, or not a carried participation (D17).
	LinkNotReplacement = "not_replacement"
	// LinkSourceNotInChain: the source is not a document of an earlier process of the chain / of an ancestor participation.
	LinkSourceNotInChain = "source_not_in_chain"
	// LinkVersionNotFound: the source has no such version.
	LinkVersionNotFound = "version_not_found"
)

// LinkInvalidError is document_link_invalid (422); Reason is one of the Link* constants above.
type LinkInvalidError struct{ Reason string }

func (e *LinkInvalidError) Error() string { return "documents: link invalid (" + e.Reason + ")" }

// AlreadyLinkedError is document_already_linked (409): the source document is already linked in this scope. LinkID is the
// existing link.
type AlreadyLinkedError struct{ LinkID uuid.UUID }

func (e *AlreadyLinkedError) Error() string { return "documents: already linked" }

// SourceDocument is one entry of `sources[].documents[]`: a real file of an earlier process with its current version.
type SourceDocument struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Format       Format `json:"format"`
	Size         int64  `json:"size"`
	Version      int    `json:"version"`
	VersionCount int    `json:"version_count"`
	UpdatedAt    string `json:"updated_at"`
	// AlreadyLinked: this document is already linked in the scope the list was asked for.
	AlreadyLinked bool `json:"already_linked"`
}

// SourceGroup is one origin: an earlier process (vacancy scope, ParticipationID null) or an ancestor participation of the
// carried one (participation scope). Sequence 0 is the original process.
type SourceGroup struct {
	ProcessID       string           `json:"process_id"`
	Sequence        int              `json:"sequence"`
	ParticipationID *string          `json:"participation_id"`
	Documents       []SourceDocument `json:"documents"`
}

// Sources is the body of GET P/document-sources. Both keys are always present; `sources` is `[]`, never null.
type Sources struct {
	// CanLink equals `link` ∈ scope.allowed_actions: a manager, a scope that can receive links and a scope that is not full.
	CanLink bool          `json:"can_link"`
	Sources []SourceGroup `json:"sources"`
}

// NoSources is the answer for a scope that cannot receive links: 200 with nothing to offer.
func NoSources() Sources { return Sources{Sources: []SourceGroup{}} }

// LinkCommand is a request to link a source document into the scope of Target.
type LinkCommand struct {
	CompanyID, ActorID uuid.UUID
	Target             Target
	SourceDocumentID   uuid.UUID
	// Version is the version to pin; nil pins the source's current version at that moment.
	Version *int
}

// LinkResponse is the 201 body of a link: the new link as `links[]` shows it plus the scope flags after the change.
type LinkResponse struct {
	Link  Link  `json:"link"`
	Scope Scope `json:"scope"`
}

// Link creates the link: the whole write is database-only (no file moves), so it needs no storage and no pre-flight.
func (s *Service) Link(ctx context.Context, cmd LinkCommand) (LinkResponse, error) {
	return s.writer.Link(ctx, cmd)
}

// Unlink removes the link (the source and its files are untouched): the answer is the scope after the change.
func (s *Service) Unlink(ctx context.Context, companyID, actorID uuid.UUID, target Target, linkID uuid.UUID) (ScopeResponse, error) {
	scope, err := s.writer.Unlink(ctx, companyID, actorID, target, linkID)
	if err != nil {
		return ScopeResponse{}, err
	}
	return ScopeResponse{Scope: scope}, nil
}

// DownloadLink delegates to the store, which re-evaluates source access, records the audited download of the pinned version
// before it returns the stream.
func (s *Service) DownloadLink(ctx context.Context, companyID, actorID uuid.UUID, target Target, linkID uuid.UUID) (File, error) {
	return s.writer.DownloadLink(ctx, companyID, actorID, target, linkID)
}
