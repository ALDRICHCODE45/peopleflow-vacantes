package postgres

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Replacement linking (placement-vacancy-documents-v1, S3, D16-D19, D22). A link is a row of placement_document_links that pins
// a version of a source document of an earlier process of the replacement chain (vacancy scope) or of an ancestor of the carried
// participation (participation scope). Nothing is copied. The chain and the ancestry are read straight from `vacancy_replacements`
// and `process_participations.carried_from_participation_id` (the same tables the scope flag already reads), so the documents
// feature needs no other feature's code; the source access rule is the vacancy read rule (D18): the owner and every stakeholder
// read every source of the company, a recruiter only the vacancies they hold an active tramo on.

// sourceRow is one readable source document with its current version, plus where it comes from.
type sourceRow struct {
	processID       string
	sequence        int
	participationID *string
	docID           string
	name            string
	contentType     string
	size            int64
	version         int
	versionCount    int
	uploadedAt      time.Time
	alreadyLinked   bool
}

// sourcesVacancySQL: the vacancy documents of every EARLIER process of the chain target belongs to (the original is sequence 0).
// A process that is not a replacement has no `me` row, so it yields nothing. Parameters: company, target draft, sees-every-source,
// actor, optional document id.
const sourcesVacancySQL = `
SELECT p.id::text, COALESCE(r.sequence, 0), NULL::text, sd.id::text, sd.name, v.content_type, v.size, v.version,
       (SELECT count(*) FROM placement_document_versions x WHERE x.document_id = sd.id), v.uploaded_at,
       EXISTS (SELECT 1 FROM placement_document_links l WHERE l.company_id = $1 AND l.draft_id = $2 AND l.participation_id IS NULL AND l.source_document_id = sd.id)
  FROM vacancy_replacements me
  JOIN vacancy_processes p ON p.company_id = me.company_id
  LEFT JOIN vacancy_replacements r ON r.process_id = p.id
  JOIN placement_documents sd ON sd.draft_id = p.id AND sd.company_id = me.company_id AND sd.participation_id IS NULL
  JOIN LATERAL (SELECT content_type, size, version, uploaded_at FROM placement_document_versions
                 WHERE document_id = sd.id ORDER BY version DESC LIMIT 1) v ON true
 WHERE me.process_id = $2 AND me.company_id = $1
   AND (p.id = me.root_process_id OR r.root_process_id = me.root_process_id)
   AND COALESCE(r.sequence, 0) < me.sequence
   AND ($3::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = p.id AND a.user_id = $4 AND a.ended_at IS NULL))
   AND ($5::uuid IS NULL OR sd.id = $5)
 ORDER BY COALESCE(r.sequence, 0), v.uploaded_at DESC, sd.id DESC`

// sourcesParticipationSQL: the documents of the ancestors of the carried participation $6 of process $2 (nearest first), found
// by following carried_from_participation_id (bounded, so a corrupt cycle cannot run away). The vacancy documents of those
// processes are not sources of a participation. Parameters: company, target draft, sees-every-source, actor, optional document
// id, target participation.
const sourcesParticipationSQL = `
WITH RECURSIVE ancestors(id, depth) AS (
    SELECT c.carried_from_participation_id, 1
      FROM process_participations c
      JOIN vacancy_processes vp ON vp.id = c.process_id AND vp.company_id = $1
     WHERE c.id = $6 AND c.process_id = $2 AND c.carried_from_participation_id IS NOT NULL
  UNION ALL
    SELECT c.carried_from_participation_id, a.depth + 1
      FROM ancestors a
      JOIN process_participations c ON c.id = a.id
     WHERE c.carried_from_participation_id IS NOT NULL AND a.depth < 64
)
SELECT ap.process_id::text, COALESCE(r.sequence, 0), ap.id::text, sd.id::text, sd.name, v.content_type, v.size, v.version,
       (SELECT count(*) FROM placement_document_versions x WHERE x.document_id = sd.id), v.uploaded_at,
       EXISTS (SELECT 1 FROM placement_document_links l WHERE l.company_id = $1 AND l.draft_id = $2 AND l.participation_id = $6 AND l.source_document_id = sd.id)
  FROM ancestors an
  JOIN process_participations ap ON ap.id = an.id
  JOIN vacancy_processes vp ON vp.id = ap.process_id AND vp.company_id = $1
  LEFT JOIN vacancy_replacements r ON r.process_id = ap.process_id
  JOIN placement_documents sd ON sd.participation_id = ap.id AND sd.draft_id = ap.process_id AND sd.company_id = $1
  JOIN LATERAL (SELECT content_type, size, version, uploaded_at FROM placement_document_versions
                 WHERE document_id = sd.id ORDER BY version DESC LIMIT 1) v ON true
 WHERE ($3::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = ap.process_id AND a.user_id = $4 AND a.ended_at IS NULL))
   AND ($5::uuid IS NULL OR sd.id = $5)
 ORDER BY an.depth, v.uploaded_at DESC, sd.id DESC`

// querySources lists the source documents the caller may link into the scope of target (D17, D18): the earlier processes of the
// chain, or the ancestors of the carried participation, restricted to what the caller can read. docID narrows it to one
// document, which is how a link request asks «is this document a legal source». A target that cannot receive links yields none.
func querySources(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, access Access, target documents.Target, docID *uuid.UUID) ([]sourceRow, error) {
	var (
		rows pgx.Rows
		err  error
	)
	sees := seesEverySource(access)
	if target.ParticipationID == nil {
		rows, err = tx.Query(ctx, sourcesVacancySQL, companyID, target.DraftID, sees, actorID, docID)
	} else {
		rows, err = tx.Query(ctx, sourcesParticipationSQL, companyID, target.DraftID, sees, actorID, docID, *target.ParticipationID)
	}
	if err != nil {
		return nil, fmt.Errorf("list document sources: %w", err)
	}
	defer rows.Close()
	var out []sourceRow
	for rows.Next() {
		var r sourceRow
		if err := rows.Scan(&r.processID, &r.sequence, &r.participationID, &r.docID, &r.name, &r.contentType, &r.size, &r.version, &r.versionCount, &r.uploadedAt, &r.alreadyLinked); err != nil {
			return nil, fmt.Errorf("scan document source: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list document sources: %w", err)
	}
	return out, nil
}

// groupSources folds the ordered rows into one group per origin. The rows come ordered by origin (sequence, or ancestry depth),
// so the documents of one origin are adjacent. A stored content type outside the closed format enum fails closed, like the list.
func groupSources(rows []sourceRow) ([]documents.SourceGroup, error) {
	groups := []documents.SourceGroup{}
	for _, r := range rows {
		format, ok := documents.FormatFromContentType(r.contentType)
		if !ok {
			return nil, fmt.Errorf("source document %s: content type outside the format enum", r.docID)
		}
		doc := documents.SourceDocument{
			ID: r.docID, Name: r.name, Format: format, Size: r.size, Version: r.version, VersionCount: r.versionCount,
			UpdatedAt: documents.FormatTime(r.uploadedAt), AlreadyLinked: r.alreadyLinked,
		}
		if n := len(groups); n > 0 && groups[n-1].ProcessID == r.processID && samePtr(groups[n-1].ParticipationID, r.participationID) {
			groups[n-1].Documents = append(groups[n-1].Documents, doc)
			continue
		}
		groups = append(groups, documents.SourceGroup{ProcessID: r.processID, Sequence: r.sequence, ParticipationID: r.participationID, Documents: []documents.SourceDocument{doc}})
	}
	return groups, nil
}

func samePtr(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

// Sources implements documents.Reader: GET P/document-sources, from one REPEATABLE READ snapshot taken after the read
// authorization. A scope that cannot receive links (a process that is not a replacement, a participation that is not carried)
// is 200 with nothing to offer; a wrong `pid` is still 404. `can_link` is the scope's own `link` action, so the two can never
// disagree.
func (s *Store) Sources(ctx context.Context, companyID, actorID uuid.UUID, target documents.Target) (documents.Sources, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return documents.Sources{}, fmt.Errorf("begin document sources tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	access, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, target.DraftID)
	if err != nil {
		return documents.Sources{}, err
	}
	receives, err := scopeCanReceiveLinks(ctx, tx, companyID, target)
	if err != nil {
		return documents.Sources{}, err
	}
	if !receives {
		return documents.NoSources(), nil
	}
	rows, err := querySources(ctx, tx, companyID, actorID, access, target, nil)
	if err != nil {
		return documents.Sources{}, err
	}
	groups, err := groupSources(rows)
	if err != nil {
		return documents.Sources{}, err
	}
	docs, links, err := scopeCounts(ctx, tx, companyID, target)
	if err != nil {
		return documents.Sources{}, err
	}
	scope := documents.BuildScope(documents.ScopeInput{Kind: target.Kind(), CanManage: access.CanManage, CanReceiveLinks: true, Documents: docs, Links: links})
	return documents.Sources{CanLink: slices.Contains(scope.AllowedActions, documents.ActionLink), Sources: groups}, nil
}

// Link is the short write transaction of a link (D16-D19, D23): gates, the draft row lock, re-authorization, then in the
// contract's order: the target must be a replacement / carried participation (422 not_replacement) → the source document must
// exist in the company and be readable by the caller (404, no leak) → it must be a document of an earlier process of the chain /
// an ancestor participation (422 source_not_in_chain) → the pinned version must exist (422 version_not_found) → not already
// linked (409, with the existing link) → the 50/20 limit on files plus links (409) → the row, the read-back link, the scope after
// the change and DocumentLinked, then commit. The source document row is held FOR SHARE until the commit, so a concurrent delete
// of the source waits and then leaves this link «removed» (never a dangling reference). No file is read or written.
func (s *Store) Link(ctx context.Context, cmd documents.LinkCommand) (documents.LinkResponse, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return documents.LinkResponse{}, fmt.Errorf("begin link tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	access, err := s.access.AuthorizeDocumentsManage(ctx, tx, cmd.CompanyID, cmd.ActorID, cmd.Target.DraftID, true)
	if err != nil {
		return documents.LinkResponse{}, err
	}
	receives, err := scopeCanReceiveLinks(ctx, tx, cmd.CompanyID, cmd.Target)
	if err != nil {
		return documents.LinkResponse{}, err
	}
	if !receives {
		return documents.LinkResponse{}, &documents.LinkInvalidError{Reason: documents.LinkNotReplacement}
	}

	// The source must exist in the company and be readable by the caller: the refusal is the same 404 as a missing document.
	var sourceDraft uuid.UUID
	var sourceParticipation *uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT sd.draft_id, sd.participation_id
  FROM placement_documents sd
 WHERE sd.id = $1 AND sd.company_id = $2
   AND ($3::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = sd.draft_id AND a.user_id = $4 AND a.ended_at IS NULL))
   FOR SHARE OF sd`, cmd.SourceDocumentID, cmd.CompanyID, seesEverySource(access), cmd.ActorID).Scan(&sourceDraft, &sourceParticipation)
	if errors.Is(err, pgx.ErrNoRows) {
		return documents.LinkResponse{}, documents.ErrScopeNotFound
	}
	if err != nil {
		return documents.LinkResponse{}, fmt.Errorf("read link source: %w", err)
	}
	legal, err := querySources(ctx, tx, cmd.CompanyID, cmd.ActorID, access, cmd.Target, &cmd.SourceDocumentID)
	if err != nil {
		return documents.LinkResponse{}, err
	}
	if len(legal) == 0 {
		return documents.LinkResponse{}, &documents.LinkInvalidError{Reason: documents.LinkSourceNotInChain}
	}

	// The pinned version: the one asked for, or the source's current one right now.
	pinned := 0
	if cmd.Version != nil {
		pinned = *cmd.Version
	}
	var versionID uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT id FROM placement_document_versions WHERE document_id = $1 AND ($2::int = 0 OR version = $2) ORDER BY version DESC LIMIT 1`,
		cmd.SourceDocumentID, pinned).Scan(&versionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return documents.LinkResponse{}, &documents.LinkInvalidError{Reason: documents.LinkVersionNotFound}
	}
	if err != nil {
		return documents.LinkResponse{}, fmt.Errorf("read link version: %w", err)
	}

	var existing uuid.UUID
	err = tx.QueryRow(ctx, `
SELECT id FROM placement_document_links
 WHERE company_id = $1 AND draft_id = $2 AND participation_id IS NOT DISTINCT FROM $3::uuid AND source_document_id = $4`,
		cmd.CompanyID, cmd.Target.DraftID, cmd.Target.ParticipationID, cmd.SourceDocumentID).Scan(&existing)
	if err == nil {
		return documents.LinkResponse{}, &documents.AlreadyLinkedError{LinkID: existing}
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return documents.LinkResponse{}, fmt.Errorf("read existing link: %w", err)
	}

	docs, links, err := scopeCounts(ctx, tx, cmd.CompanyID, cmd.Target)
	if err != nil {
		return documents.LinkResponse{}, err
	}
	if limit := documents.MaxDocuments(cmd.Target.Kind()); docs+links >= limit {
		return documents.LinkResponse{}, &documents.LimitReachedError{Kind: "documents", Limit: limit}
	}

	var now time.Time
	if err := tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return documents.LinkResponse{}, fmt.Errorf("read clock: %w", err)
	}
	linkID := uuid.Must(uuid.NewV7())
	if _, err := tx.Exec(ctx, `
INSERT INTO placement_document_links(id, company_id, draft_id, participation_id, source_document_id, source_version_id, linked_at, linked_by)
VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
		linkID, cmd.CompanyID, cmd.Target.DraftID, cmd.Target.ParticipationID, cmd.SourceDocumentID, versionID, now, cmd.ActorID); err != nil {
		return documents.LinkResponse{}, fmt.Errorf("insert document link: %w", err)
	}

	read, err := queryLinks(ctx, tx, cmd.CompanyID, cmd.ActorID, cmd.Target, Access{Role: access.Role, CanManage: true}, &linkID)
	if err != nil {
		return documents.LinkResponse{}, err
	}
	if len(read) != 1 {
		return documents.LinkResponse{}, errors.New("read back the new link")
	}
	scope, err := scopeAfter(ctx, tx, cmd.CompanyID, cmd.Target)
	if err != nil {
		return documents.LinkResponse{}, err
	}
	// Fail-closed audit; after closure the event is the same (S4).
	if err := s.audit.Append(ctx, tx, linkedEvent(cmd.CompanyID, cmd.ActorID, cmd.Target, linkID, cmd.SourceDocumentID, versionID, sourceDraft, sourceParticipation)); err != nil {
		return documents.LinkResponse{}, fmt.Errorf("co-write document link audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return documents.LinkResponse{}, fmt.Errorf("commit link tx: %w", err)
	}
	return documents.LinkResponse{Link: read[0], Scope: scope}, nil
}

// Unlink removes a link of the scope of target: gates, the draft row lock, re-authorization, the delete (a link of another
// scope or company, or one that is already gone, is ErrScopeNotFound), the scope after the change, DocumentDeleted with kind
// link, commit. The source document, its versions and its files are not touched.
func (s *Store) Unlink(ctx context.Context, companyID, actorID uuid.UUID, target documents.Target, linkID uuid.UUID) (documents.Scope, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return documents.Scope{}, fmt.Errorf("begin unlink tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := s.access.AuthorizeDocumentsManage(ctx, tx, companyID, actorID, target.DraftID, true); err != nil {
		return documents.Scope{}, err
	}
	if _, err := scopeCanReceiveLinks(ctx, tx, companyID, target); err != nil {
		return documents.Scope{}, err
	}
	tag, err := tx.Exec(ctx, `
DELETE FROM placement_document_links
 WHERE id = $1 AND company_id = $2 AND draft_id = $3 AND participation_id IS NOT DISTINCT FROM $4::uuid`, linkID, companyID, target.DraftID, target.ParticipationID)
	if err != nil {
		return documents.Scope{}, fmt.Errorf("delete document link: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return documents.Scope{}, documents.ErrScopeNotFound
	}
	scope, err := scopeAfter(ctx, tx, companyID, target)
	if err != nil {
		return documents.Scope{}, err
	}
	if err := s.audit.Append(ctx, tx, deletedLinkEvent(companyID, actorID, target, linkID)); err != nil {
		return documents.Scope{}, fmt.Errorf("co-write document unlink audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return documents.Scope{}, fmt.Errorf("commit unlink tx: %w", err)
	}
	return scope, nil
}

// DownloadLink serves the PINNED version of a link (D16) through the audited download path: the read gate for the target, the
// scope rule, then the link of THIS scope. A link whose source was deleted (removed, D19) or whose source the caller can no
// longer read (inaccessible, D18) is ErrScopeNotFound, exactly like a link that does not exist: nothing is described, opened or
// recorded. The audit event names the source document and version and the link (downloadedViaLinkEvent).
func (s *Store) DownloadLink(ctx context.Context, companyID, actorID uuid.UUID, target documents.Target, linkID uuid.UUID) (documents.File, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return documents.File{}, fmt.Errorf("begin link download tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	access, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, target.DraftID)
	if err != nil {
		return documents.File{}, err
	}
	if _, err := scopeCanReceiveLinks(ctx, tx, companyID, target); err != nil {
		return documents.File{}, err
	}
	var (
		sourceDoc, versionID   *uuid.UUID
		name, key, contentType *string
		number                 *int
		size                   *int64
		readable               bool
	)
	err = tx.QueryRow(ctx, `
SELECT sd.id, v.id, sd.name, v.storage_key, v.content_type, v.version, v.size,
       COALESCE($5::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = sd.draft_id AND a.user_id = $6 AND a.ended_at IS NULL), false)
  FROM placement_document_links l
  LEFT JOIN placement_documents sd ON sd.id = l.source_document_id AND sd.company_id = l.company_id
  LEFT JOIN placement_document_versions v ON v.id = l.source_version_id AND v.document_id = sd.id
 WHERE l.id = $1 AND l.company_id = $2 AND l.draft_id = $3 AND l.participation_id IS NOT DISTINCT FROM $4::uuid`,
		linkID, companyID, target.DraftID, target.ParticipationID, seesEverySource(access), actorID).
		Scan(&sourceDoc, &versionID, &name, &key, &contentType, &number, &size, &readable)
	if errors.Is(err, pgx.ErrNoRows) {
		return documents.File{}, documents.ErrScopeNotFound
	}
	if err != nil {
		return documents.File{}, fmt.Errorf("read document link: %w", err)
	}
	if sourceDoc == nil || versionID == nil || name == nil || key == nil || contentType == nil || number == nil || size == nil || !readable {
		return documents.File{}, documents.ErrScopeNotFound // removed or inaccessible: nothing to serve (D18, D19)
	}
	return s.serve(ctx, tx, *name, *key, *contentType, *size, downloadedViaLinkEvent(companyID, actorID, target, linkID, *sourceDoc, *versionID, *number))
}
