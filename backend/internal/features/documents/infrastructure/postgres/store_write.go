package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// The write and download side of the store (placement-vacancy-documents-v1 D21, D23, D26). Nothing here uses the board's
// beginTx/beginMutation: the draft authorization is the only gate, so an upload is accepted on a closed or finished
// vacancy (S4) and never touches `vacancy_processes`, the lifecycle events, `lifecycle_version` or `job_drafts.version`.

// AuthorizeUpload is the pre-flight of an upload: the manage gate in a transaction that is rolled back at once (its gate
// locks are released and no draft lock is taken), so a caller who may not write never gets a byte stored.
func (s *Store) AuthorizeUpload(ctx context.Context, companyID, actorID, draftID uuid.UUID) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin documents pre-flight tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = s.access.AuthorizeDocumentsManage(ctx, tx, companyID, actorID, draftID, false)
	return err
}

// scopeCounts is what the limit (D15) and the scope object count in the vacancy scope: files plus links.
func scopeCounts(ctx context.Context, tx pgx.Tx, companyID, draftID uuid.UUID) (docs, links int, err error) {
	err = tx.QueryRow(ctx, `
SELECT (SELECT count(*) FROM placement_documents WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NULL),
       (SELECT count(*) FROM placement_document_links WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NULL)`,
		companyID, draftID).Scan(&docs, &links)
	if err != nil {
		return 0, 0, fmt.Errorf("count scope documents: %w", err)
	}
	return docs, links, nil
}

// Upload is the short write transaction of an upload (D23): gates, the draft row lock, re-authorization, the idempotency
// lookup (after re-authorization and before the limit: a revoked recruiter cannot replay and a replay does not re-check
// the limit), the limit, the rows, the frozen idempotency record and the audit event, then commit. The file is already in
// storage; the caller (documents.Service) removes it on every outcome but a fresh success.
func (s *Store) Upload(ctx context.Context, cmd documents.UploadCommand) (documents.UploadResult, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return documents.UploadResult{}, fmt.Errorf("begin upload tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := s.access.AuthorizeDocumentsManage(ctx, tx, cmd.CompanyID, cmd.ActorID, cmd.DraftID, true); err != nil {
		return documents.UploadResult{}, err
	}
	var fingerprint []byte
	if cmd.IdempotencyKey != "" {
		fingerprint = documents.UploadFingerprint(documents.ScopeVacancy, cmd.DraftID, nil, cmd.Name, cmd.Staged.SHA256)
		body, found, err := s.idem.Replay(ctx, tx, cmd.CompanyID, cmd.ActorID, cmd.IdempotencyKey, fingerprint)
		if err != nil {
			return documents.UploadResult{}, err
		}
		if found { // the frozen answer: nothing is created and no second audit event is written
			return documents.UploadResult{Body: body, Replayed: true}, nil
		}
	}

	docs, links, err := scopeCounts(ctx, tx, cmd.CompanyID, cmd.DraftID)
	if err != nil {
		return documents.UploadResult{}, err
	}
	if limit := documents.MaxDocuments(documents.ScopeVacancy); docs+links >= limit {
		return documents.UploadResult{}, &documents.LimitReachedError{Kind: "documents", Limit: limit}
	}

	// Database time, taken after the locks: the document and its first version share one instant, and the answer built
	// from it equals what the list will read back.
	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return documents.UploadResult{}, fmt.Errorf("read clock: %w", err)
	}
	docID, versionID := uuid.Must(uuid.NewV7()), uuid.Must(uuid.NewV7())
	if _, err := tx.Exec(ctx,
		`INSERT INTO placement_documents(id, company_id, draft_id, participation_id, name, created_at, created_by) VALUES($1,$2,$3,NULL,$4,$5,$6)`,
		docID, cmd.CompanyID, cmd.DraftID, cmd.Name, now, cmd.ActorID); err != nil {
		return documents.UploadResult{}, fmt.Errorf("insert document: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO placement_document_versions(id, document_id, version, storage_key, content_type, size, uploaded_at, uploaded_by) VALUES($1,$2,1,$3,$4,$5,$6,$7)`,
		versionID, docID, cmd.Staged.Key, cmd.Staged.Format.ContentType(), cmd.Staged.Size, now, cmd.ActorID); err != nil {
		return documents.UploadResult{}, fmt.Errorf("insert document version: %w", err)
	}

	items, err := queryItems(ctx, tx, cmd.CompanyID, cmd.DraftID, &docID, true)
	if err != nil {
		return documents.UploadResult{}, err
	}
	if len(items) != 1 {
		return documents.UploadResult{}, errors.New("read back the new document")
	}
	var canLink bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vacancy_replacements WHERE process_id=$1 AND company_id=$2)`, cmd.DraftID, cmd.CompanyID).Scan(&canLink); err != nil {
		return documents.UploadResult{}, fmt.Errorf("read replacement flag: %w", err)
	}
	// The scope is computed inside the write transaction, after the change (contract «Conventions»).
	body, err := json.Marshal(documents.UploadResponse{
		Item:  items[0],
		Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: canLink, Documents: docs + 1, Links: links}),
	})
	if err != nil {
		return documents.UploadResult{}, fmt.Errorf("encode upload response: %w", err)
	}
	if cmd.IdempotencyKey != "" {
		if err := s.idem.Record(ctx, tx, cmd.CompanyID, cmd.ActorID, cmd.IdempotencyKey, fingerprint, body); err != nil {
			return documents.UploadResult{}, err
		}
	}
	// Fail-closed audit: no document without its audit row, and S4's «audit the attachment» holds after closure too.
	if err := s.audit.Append(ctx, tx, uploadedEvent(cmd.CompanyID, cmd.ActorID, cmd.DraftID, docID, versionID, cmd.Staged.Format)); err != nil {
		return documents.UploadResult{}, fmt.Errorf("co-write document upload audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return documents.UploadResult{}, fmt.Errorf("commit upload tx: %w", err)
	}
	return documents.UploadResult{Body: body}, nil
}

// Download opens the current version of a vacancy document and records DocumentDownloaded BEFORE it returns the stream
// (the audited CV download pattern of board/store.go): gates → locate the version (404) → storage disabled (503) → open
// the object → append the audit row → commit → hand over the stream. Nothing is recorded when the document or its file is
// missing or storage is unavailable, and a failed audit append or commit closes the object and serves nothing.
func (s *Store) Download(ctx context.Context, companyID, actorID, draftID, docID uuid.UUID) (documents.File, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return documents.File{}, fmt.Errorf("begin download tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, draftID); err != nil {
		return documents.File{}, err
	}
	var (
		name, key, contentType string
		versionID              uuid.UUID
		number                 int
		size                   int64
	)
	err = tx.QueryRow(ctx, `
SELECT d.name, v.id, v.version, v.storage_key, v.content_type, v.size
  FROM placement_documents d
  JOIN LATERAL (SELECT id, version, storage_key, content_type, size FROM placement_document_versions
                 WHERE document_id = d.id ORDER BY version DESC LIMIT 1) v ON true
 WHERE d.id = $1 AND d.company_id = $2 AND d.draft_id = $3 AND d.participation_id IS NULL`,
		docID, companyID, draftID).Scan(&name, &versionID, &number, &key, &contentType, &size)
	if errors.Is(err, pgx.ErrNoRows) {
		return documents.File{}, documents.ErrScopeNotFound
	}
	if err != nil {
		return documents.File{}, fmt.Errorf("read document version: %w", err)
	}
	format, ok := documents.FormatFromContentType(contentType)
	if !ok {
		return documents.File{}, fmt.Errorf("document %s: content type outside the format enum", docID)
	}
	if s.storage == nil {
		return documents.File{}, documents.ErrStorageUnavailable
	}
	reader, err := s.storage.Open(ctx, key)
	if err != nil {
		if errors.Is(err, documents.ErrNotFound) {
			return documents.File{}, documents.ErrNotFound
		}
		return documents.File{}, documents.ErrStorageUnavailable
	}
	if err := s.audit.Append(ctx, tx, downloadedEvent(companyID, actorID, draftID, docID, versionID, number)); err != nil {
		_ = reader.Close()
		return documents.File{}, fmt.Errorf("co-write document download audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		_ = reader.Close()
		return documents.File{}, fmt.Errorf("commit download tx: %w", err)
	}
	return documents.File{Name: documents.DownloadName(name, format), ContentType: contentType, Size: size, Reader: reader}, nil
}
