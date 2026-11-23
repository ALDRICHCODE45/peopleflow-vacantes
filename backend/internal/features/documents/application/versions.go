package documents

import (
	"context"
	"errors"
	"log/slog"

	"github.com/google/uuid"
)

// P5 of placement-vacancy-documents-v1: replace (a new version, D7), the version list, download by version and delete (D13).

var (
	// ErrExpectedVersionRequired: the replace carried no `expected_version` part (400 validation_error expected_version/required).
	ErrExpectedVersionRequired = errors.New("documents: expected_version required")
	// ErrExpectedVersionInvalid: `expected_version` is not a decimal integer ≥ 1 (400 validation_error expected_version/invalid).
	ErrExpectedVersionInvalid = errors.New("documents: expected_version invalid")
)

// VersionConflictError is document_version_conflict: the client replaced a version that is no longer the current one.
// Current is the document's current (highest) version, so the client can re-read and retry.
type VersionConflictError struct{ Current int }

func (e *VersionConflictError) Error() string { return "documents: version conflict" }

// CheckReplaceable is the rule of a replace, shared by the pre-flight and the write under the draft lock: the stale
// `expected_version` is answered first (a replace never loses a version silently), then the 25-version cap. current is the
// document's current (highest) version.
func CheckReplaceable(current, expected int) error {
	if expected != current {
		return &VersionConflictError{Current: current}
	}
	if current >= MaxVersions {
		return &LimitReachedError{Kind: "versions", Limit: MaxVersions}
	}
	return nil
}

// VersionItem is one entry of `versions[]` in GET P/documents/{doc}/versions.
type VersionItem struct {
	Version     int    `json:"version"`
	Format      Format `json:"format"`
	ContentType string `json:"content_type"`
	Size        int64  `json:"size"`
	UploadedAt  string `json:"uploaded_at"`
	UploadedBy  Person `json:"uploaded_by"`
	// IsCurrent is true for the highest version only.
	IsCurrent bool `json:"is_current"`
}

// VersionList is the body of GET P/documents/{doc}/versions: every version, newest first (at most MaxVersions, no pagination).
type VersionList struct {
	DocumentID string        `json:"document_id"`
	Name       string        `json:"name"`
	Versions   []VersionItem `json:"versions"`
}

// ReplaceCommand is the write of one staged file as version n+1 of an existing document of the scope of Target.
type ReplaceCommand struct {
	CompanyID, ActorID uuid.UUID
	Target             Target
	DocID              uuid.UUID
	// ExpectedVersion is the `version` the client saw; the write only lands when it is still the current one.
	ExpectedVersion int
	// Name renames the document when it is set (normalized, known extension stripped, D11); nil keeps the name.
	Name   *string
	Staged Staged
}

// ScopeResponse is the 200 body of both deletes: the updated scope flags and nothing else.
type ScopeResponse struct {
	Scope Scope `json:"scope"`
}

// DeleteResult is what the store reports after it committed a delete: the new scope and the storage keys of every version of
// the document, whose files the service removes AFTER the commit.
type DeleteResult struct {
	Scope Scope
	Keys  []string
}

// PreflightReplace is the cheap check a replace runs before it stores a byte (D23): the manage gate, then the document
// (404 when it is not one of this scope), then the storage. It returns the document's current version so the handler can
// answer a stale `expected_version` before it streams the body. A denied caller never learns that the storage is down.
func (s *Service) PreflightReplace(ctx context.Context, companyID, actorID uuid.UUID, target Target, docID uuid.UUID) (int, error) {
	current, err := s.writer.AuthorizeReplace(ctx, companyID, actorID, target, docID)
	if err != nil {
		return 0, err
	}
	if s.storage == nil {
		return 0, ErrStorageUnavailable
	}
	return current, nil
}

// Replace writes the staged file as the next version. The object stays only when the version was created: a stale
// expected_version, the version cap, a revoked authorization, a deleted document or any row failure removes it.
func (s *Service) Replace(ctx context.Context, cmd ReplaceCommand) (UploadResponse, error) {
	res, err := s.writer.Replace(ctx, cmd)
	if err != nil {
		s.Discard(ctx, cmd.Staged.Key)
		return UploadResponse{}, err
	}
	return res, nil
}

// Delete removes the document's rows in one transaction (the store) and only then its files, best effort and on a context
// that outlives the request (D13). A file that could not be deleted is an orphan that Reconcile removes after OrphanGrace; the
// answer is still the scope, because the delete itself is final. With the storage disabled there is nothing to remove.
func (s *Service) Delete(ctx context.Context, companyID, actorID uuid.UUID, target Target, docID uuid.UUID) (ScopeResponse, error) {
	res, err := s.writer.Delete(ctx, companyID, actorID, target, docID)
	if err != nil {
		return ScopeResponse{}, err
	}
	if s.storage != nil {
		for _, key := range res.Keys {
			if err := s.storage.Delete(context.WithoutCancel(ctx), key); err != nil {
				slog.Warn("documents: deleted document left an orphan file for reconcile", "storage_key", key, "error", err)
			}
		}
	}
	return ScopeResponse{Scope: res.Scope}, nil
}

// DownloadVersion delegates to the store, which records the audited download of that numbered version before it returns the
// stream.
func (s *Service) DownloadVersion(ctx context.Context, companyID, actorID uuid.UUID, target Target, docID uuid.UUID, version int) (File, error) {
	return s.writer.DownloadVersion(ctx, companyID, actorID, target, docID, version)
}
