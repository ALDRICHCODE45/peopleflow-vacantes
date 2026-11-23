package documents

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"
)

var (
	// ErrInvalidRequest is a malformed multipart request: not multipart, a missing or duplicated `file`, an unknown part,
	// a Content-Transfer-Encoding (400 invalid_request).
	ErrInvalidRequest = errors.New("documents: invalid request")
	// ErrIdempotencyConflict: the same Idempotency-Key was used for another request (409 idempotency_conflict).
	ErrIdempotencyConflict = errors.New("documents: idempotency conflict")
)

// LimitReachedError is document_limit_reached: Kind is "documents" (files plus links in the scope) or "versions"
// (the versions of one document) and Limit the maximum that was reached.
type LimitReachedError struct {
	Kind  string
	Limit int
}

func (e *LimitReachedError) Error() string { return "documents: limit reached (" + e.Kind + ")" }

// Staged is a file that already sits in storage and passed inspection, waiting for its rows (D23): the object exists
// before any row does, so whoever holds a Staged must either commit it (Service.Upload) or discard it.
type Staged struct {
	Key    string
	Size   int64
	Format Format
	// SHA256 is the hex digest of the file bytes, computed while streaming; it feeds the idempotency fingerprint.
	SHA256 string
}

// UploadCommand is the write of one staged file as a new vacancy document.
type UploadCommand struct {
	CompanyID, ActorID, DraftID uuid.UUID
	// IdempotencyKey is the canonical (lower-case hyphenated) UUID, "" when the client sent none.
	IdempotencyKey string
	// Name is the display name: normalized, known extension stripped (D11).
	Name   string
	Staged Staged
}

// UploadResult is the 201 body of the upload, exactly the bytes that were (or, on a replay, were once) frozen:
// {"item": …, "scope": …}. Replayed is true when the body comes from a stored idempotency record: nothing was created.
type UploadResult struct {
	Body     []byte
	Replayed bool
}

// UploadResponse is the shape of UploadResult.Body.
type UploadResponse struct {
	Item  Item  `json:"item"`
	Scope Scope `json:"scope"`
}

// File is a document version ready to stream. Name is the DOWNLOAD name (display name plus the extension of the stored
// format of that version, D11). The caller closes Reader.
type File struct {
	Name        string
	ContentType string
	Size        int64
	Reader      io.ReadCloser
}

// Writer is the write and download side of the documents store.
type Writer interface {
	// AuthorizeUpload is the cheap pre-flight an upload runs before it stores a byte: the manage gate without the draft
	// lock. Errors are the Err* access sentinels.
	AuthorizeUpload(ctx context.Context, companyID, actorID, draftID uuid.UUID) error
	// Upload runs the short write transaction (gates, draft lock, re-authorization, idempotency, limits, rows, audit).
	Upload(ctx context.Context, cmd UploadCommand) (UploadResult, error)
	// Download opens the current version of docID, records DocumentDownloaded and commits BEFORE it returns the stream.
	// Nothing is recorded when the document or its file is missing or storage is unavailable.
	Download(ctx context.Context, companyID, actorID, draftID, docID uuid.UUID) (File, error)
}

// Files is what the HTTP layer needs: the Service.
type Files interface {
	PreflightUpload(ctx context.Context, companyID, actorID, draftID uuid.UUID) error
	Stage(ctx context.Context, filename string, r io.Reader) (Staged, error)
	Upload(ctx context.Context, cmd UploadCommand) (UploadResult, error)
	Discard(ctx context.Context, key string)
	Download(ctx context.Context, companyID, actorID, draftID, docID uuid.UUID) (File, error)
}

// Service orchestrates files and rows: the storage streams, the writer owns the database. A nil storage is the disabled
// mode of the environment (every route that moves a file answers ErrStorageUnavailable after its gates).
type Service struct {
	storage Storage
	writer  Writer
}

var _ Files = (*Service)(nil)

// NewService builds the service. storage may be nil (documents storage disabled).
func NewService(storage Storage, writer Writer) *Service {
	return &Service{storage: storage, writer: writer}
}

// PreflightUpload authorizes the caller before a byte is stored, so an unauthorized caller cannot write objects (D23),
// and only then looks at the storage: a denied caller never learns that the storage is down.
func (s *Service) PreflightUpload(ctx context.Context, companyID, actorID, draftID uuid.UUID) error {
	if err := s.writer.AuthorizeUpload(ctx, companyID, actorID, draftID); err != nil {
		return err
	}
	if s.storage == nil {
		return ErrStorageUnavailable
	}
	return nil
}

// Stage streams r into storage while keeping what inspection needs (the head, a rolling tail, the size and the SHA-256),
// then inspects the bytes against filename's extension. The file is never held in memory. Any failure removes the
// object before it returns: ErrEmpty, ErrTooLarge, ErrUnsupportedType, *MismatchError, the reader's own error
// (errors.Is-compatible, e.g. the request cap) or ErrStorageUnavailable.
func (s *Service) Stage(ctx context.Context, filename string, r io.Reader) (Staged, error) {
	if s.storage == nil {
		return Staged{}, ErrStorageUnavailable
	}
	collector, digest := NewCollector(), sha256.New()
	key, size, err := s.storage.Put(ctx, io.TeeReader(r, io.MultiWriter(collector, digest)), MaxBytes)
	if err != nil {
		return Staged{}, err
	}
	sample := collector.Sample()
	if sample.Size != size {
		s.Discard(ctx, key)
		return Staged{}, fmt.Errorf("documents: stored %d bytes but inspected %d", size, sample.Size)
	}
	format, err := Inspect(filename, sample)
	if err != nil {
		s.Discard(ctx, key)
		return Staged{}, err
	}
	return Staged{Key: key, Size: size, Format: format, SHA256: hex.EncodeToString(digest.Sum(nil))}, nil
}

// Discard removes a staged object best effort, on a context that outlives the request (WithoutCancel): a client that
// went away must not leave the object behind. A failed delete leaves an orphan that Reconcile removes after OrphanGrace.
func (s *Service) Discard(ctx context.Context, key string) {
	if s.storage == nil || key == "" {
		return
	}
	_ = s.storage.Delete(context.WithoutCancel(ctx), key)
}

// Upload writes the staged file. The object stays only when a new document was created: a replay, a conflict, a limit,
// a revoked authorization or any row failure removes it (the failure table of the contract).
func (s *Service) Upload(ctx context.Context, cmd UploadCommand) (UploadResult, error) {
	res, err := s.writer.Upload(ctx, cmd)
	if err != nil || res.Replayed {
		s.Discard(ctx, cmd.Staged.Key)
	}
	return res, err
}

// Download delegates to the store, which records the audited download before it returns the stream.
func (s *Service) Download(ctx context.Context, companyID, actorID, draftID, docID uuid.UUID) (File, error) {
	return s.writer.Download(ctx, companyID, actorID, draftID, docID)
}

// uploadFingerprint is the canonical request the Idempotency-Key is compared against (D26). The struct field order is
// the encoding order, so the bytes are stable.
type uploadFingerprint struct {
	Scope           ScopeKind `json:"scope"`
	DraftID         string    `json:"draft_id"`
	ParticipationID string    `json:"participation_id"`
	Name            string    `json:"name"`
	FileSHA256      string    `json:"file_sha256"`
}

// UploadFingerprint is the canonical request of an upload: scope, vacancy id, participation id (none for the vacancy
// scope), the normalized name and the SHA-256 of the file bytes, as JSON. The store hashes it again before persisting.
func UploadFingerprint(scope ScopeKind, draftID uuid.UUID, participationID *uuid.UUID, name, fileSHA256 string) []byte {
	f := uploadFingerprint{Scope: scope, DraftID: draftID.String(), Name: name, FileSHA256: fileSHA256}
	if participationID != nil {
		f.ParticipationID = participationID.String()
	}
	out, err := json.Marshal(f)
	if err != nil { // a struct of strings cannot fail to encode
		panic("documents: encode upload fingerprint: " + err.Error())
	}
	return out
}
