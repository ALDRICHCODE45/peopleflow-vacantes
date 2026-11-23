package postgres

import (
	"context"
	"fmt"

	auditport "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Access is what authorization tells the store about the caller.
type Access struct {
	// Role is the live membership role: owner, recruiter or stakeholder.
	Role string
	// CanManage is the manage gate: the company owner or an active member of the vacancy's team (never a stakeholder).
	CanManage bool
}

// Authorizer runs the vacancy authorization inside the store's transaction (D4, D6). The implementation is the draft store's
// (`draftstore.AuthorizeDocuments`), adapted by cmd/api because a feature may not import another feature's packages: the
// adapter maps the draft errors onto the documents.Err* sentinels.
type Authorizer interface {
	// AuthorizeDocuments is the READ gate (owner, active team member, stakeholder); it takes no draft lock.
	AuthorizeDocuments(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID) (Access, error)
	// AuthorizeDocumentsManage is the WRITE gate (owner or active team member; a stakeholder is ErrForbidden). lock=true
	// takes the draft row FOR UPDATE for the short write transaction. It never looks at the lifecycle (S4).
	AuthorizeDocumentsManage(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID, lock bool) (Access, error)
}

// Idempotency is the upload's Idempotency-Key bookkeeping in `job_draft_idempotency`, with the semantics of the draft,
// team and replacement writes (D26). Like Authorizer it is the draft store's, adapted by cmd/api.
type Idempotency interface {
	// Replay serializes racing requests that share key and looks it up: the frozen body of a same-fingerprint request
	// (found), nothing (not found), or documents.ErrIdempotencyConflict for another fingerprint.
	Replay(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, key string, fingerprint []byte) (body []byte, found bool, err error)
	// Record freezes the 201 body under key, in the transaction that inserts the rows.
	Record(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, key string, fingerprint, body []byte) error
}

// txBeginner is the part of *pgxpool.Pool the store needs.
type txBeginner interface {
	BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error)
}

// Store is the PostgreSQL adapter of the documents store: the read side (the list reads only the database and works with
// storage disabled) and the write and download side (store_write.go), which moves files through the storage port.
type Store struct {
	pool    txBeginner
	access  Authorizer
	idem    Idempotency
	audit   auditport.AuditEventRepository
	storage documents.Storage
}

var (
	_ documents.Reader = (*Store)(nil)
	_ documents.Writer = (*Store)(nil)
)

// NewStore builds the store. storage may be nil (documents storage disabled).
func NewStore(pool txBeginner, access Authorizer, idem Idempotency, audit auditport.AuditEventRepository, storage documents.Storage) *Store {
	return &Store{pool: pool, access: access, idem: idem, audit: audit, storage: storage}
}

// List implements documents.Reader: the file documents and the links of the scope of target plus the scope flags, all
// from one REPEATABLE READ snapshot taken after the authorization, so the counts always match the arrays. It takes no draft
// lock. A vacancy scope needs no process row; a participation scope needs the participation to belong to the draft.
func (s *Store) List(ctx context.Context, companyID, actorID uuid.UUID, target documents.Target) (documents.List, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return documents.List{}, fmt.Errorf("begin documents list tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	access, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, target.DraftID)
	if err != nil {
		return documents.List{}, err
	}
	// The scope must exist whoever asks (a wrong `pid` is 404 for a stakeholder too); the link flag only matters to a manager.
	canLink, err := scopeCanReceiveLinks(ctx, tx, companyID, target)
	if err != nil {
		return documents.List{}, err
	}
	items, err := queryItems(ctx, tx, companyID, target, nil, access.CanManage)
	if err != nil {
		return documents.List{}, err
	}
	links, err := listLinks(ctx, tx, companyID, actorID, target, access)
	if err != nil {
		return documents.List{}, err
	}
	return documents.List{
		Items: items,
		Links: links,
		Scope: documents.BuildScope(documents.ScopeInput{Kind: target.Kind(), CanManage: access.CanManage, CanReceiveLinks: canLink, Documents: len(items), Links: len(links)}),
	}, nil
}

// Versions implements documents.Reader: every version of a document of the scope, newest first, after the read gate. It reads only
// the database (the list of versions works with storage disabled) and writes no audit row: no content leaves.
func (s *Store) Versions(ctx context.Context, companyID, actorID uuid.UUID, target documents.Target, docID uuid.UUID) (documents.VersionList, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return documents.VersionList{}, fmt.Errorf("begin document versions tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, target.DraftID); err != nil {
		return documents.VersionList{}, err
	}
	if _, err := scopeCanReceiveLinks(ctx, tx, companyID, target); err != nil {
		return documents.VersionList{}, err
	}
	// One statement: the name and the versions come from the same snapshot. The company, draft and scope equalities keep a
	// foreign or participation document from ever being described.
	rows, err := tx.Query(ctx, `
SELECT d.name, v.version, v.content_type, v.size, v.uploaded_at, v.uploaded_by::text, u.full_name
  FROM placement_documents d
  JOIN placement_document_versions v ON v.document_id = d.id
  JOIN users u ON u.id = v.uploaded_by
 WHERE d.id = $1 AND d.company_id = $2 AND d.draft_id = $3 AND d.participation_id IS NOT DISTINCT FROM $4::uuid
 ORDER BY v.version DESC`, docID, companyID, target.DraftID, target.ParticipationID)
	if err != nil {
		return documents.VersionList{}, fmt.Errorf("list document versions: %w", err)
	}
	defer rows.Close()
	list := documents.VersionList{DocumentID: docID.String(), Versions: []documents.VersionItem{}}
	var raw []versionRow
	for rows.Next() {
		var r versionRow
		if err := rows.Scan(&list.Name, &r.version, &r.contentType, &r.size, &r.uploadedAt, &r.uploadedBy.ID, &r.uploadedBy.Name); err != nil {
			return documents.VersionList{}, fmt.Errorf("scan document version: %w", err)
		}
		raw = append(raw, r)
	}
	if err := rows.Err(); err != nil {
		return documents.VersionList{}, fmt.Errorf("list document versions: %w", err)
	}
	if len(raw) == 0 {
		return documents.VersionList{}, documents.ErrScopeNotFound
	}
	current := raw[0].version // newest first: the first row is the highest version
	for _, r := range raw {
		item, err := newVersionItem(r, current)
		if err != nil {
			return documents.VersionList{}, err
		}
		list.Versions = append(list.Versions, item)
	}
	return list, nil
}

// queryItems reads the documents of the scope of target with their current version, every one of them or, when docID is
// set, just that one. The company, draft and participation equalities scope it (`IS NOT DISTINCT FROM`: a vacancy scope
// matches only NULL, a participation scope only its own id), so a foreign document is never described and the two scopes
// never show each other's documents.
func queryItems(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, target documents.Target, docID *uuid.UUID, canManage bool) ([]documents.Item, error) {
	rows, err := tx.Query(ctx, `
SELECT d.id::text, d.participation_id::text, d.name, d.created_at, d.created_by::text, cu.full_name,
       v.version, v.content_type, v.size, v.uploaded_at, v.uploaded_by::text, uu.full_name,
       (SELECT count(*) FROM placement_document_versions x WHERE x.document_id = d.id)
  FROM placement_documents d
  JOIN LATERAL (SELECT version, content_type, size, uploaded_at, uploaded_by FROM placement_document_versions
                 WHERE document_id = d.id ORDER BY version DESC LIMIT 1) v ON true
  JOIN users cu ON cu.id = d.created_by
  JOIN users uu ON uu.id = v.uploaded_by
 WHERE d.company_id = $1 AND d.draft_id = $2 AND d.participation_id IS NOT DISTINCT FROM $4::uuid AND ($3::uuid IS NULL OR d.id = $3)
 ORDER BY v.uploaded_at DESC, d.id DESC`, companyID, target.DraftID, docID, target.ParticipationID)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()
	items := []documents.Item{}
	for rows.Next() {
		var r itemRow
		if err := rows.Scan(&r.id, &r.participationID, &r.name, &r.createdAt, &r.createdBy.ID, &r.createdBy.Name,
			&r.version, &r.contentType, &r.size, &r.uploadedAt, &r.uploadedBy.ID, &r.uploadedBy.Name, &r.versionCount); err != nil {
			return nil, fmt.Errorf("scan document: %w", err)
		}
		item, err := newItem(r, canManage)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	return items, nil
}

// listLinks reads the links of the scope of target. The source is resolved through the pinned version; a source the caller
// may not read (owner or stakeholder of the company, or an active member of the source vacancy's team: D18) is reported as
// inaccessible without its data. The company equality on every join keeps a foreign row from ever being described.
func listLinks(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, target documents.Target, access Access) ([]documents.Link, error) {
	sees := access.Role == "owner" || access.Role == "stakeholder"
	rows, err := tx.Query(ctx, `
SELECT l.id::text, l.linked_at, l.linked_by::text, lu.full_name,
       sd.id::text, sd.draft_id::text, sd.participation_id::text, sd.name,
       sv.version, sv.content_type, sv.size, sv.uploaded_at, sv.uploaded_by::text, su.full_name,
       (SELECT count(*) FROM placement_document_versions x WHERE x.document_id = sd.id),
       (SELECT max(x.version) FROM placement_document_versions x WHERE x.document_id = sd.id),
       COALESCE(r.sequence, 0),
       ($3::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = sd.draft_id AND a.user_id = $4 AND a.ended_at IS NULL))
  FROM placement_document_links l
  JOIN users lu ON lu.id = l.linked_by
  LEFT JOIN placement_documents sd ON sd.id = l.source_document_id AND sd.company_id = l.company_id
  LEFT JOIN placement_document_versions sv ON sv.id = l.source_version_id AND sv.document_id = sd.id
  LEFT JOIN users su ON su.id = sv.uploaded_by
  LEFT JOIN vacancy_replacements r ON r.process_id = sd.draft_id
 WHERE l.company_id = $1 AND l.draft_id = $2 AND l.participation_id IS NOT DISTINCT FROM $5::uuid
 ORDER BY l.linked_at DESC, l.id DESC`, companyID, target.DraftID, sees, actorID, target.ParticipationID)
	if err != nil {
		return nil, fmt.Errorf("list document links: %w", err)
	}
	defer rows.Close()
	links := []documents.Link{}
	for rows.Next() {
		var r linkRow
		var uploadedBy, uploadedByName *string
		if err := rows.Scan(&r.id, &r.linkedAt, &r.linkedBy.ID, &r.linkedBy.Name,
			&r.sourceDocumentID, &r.sourceProcessID, &r.sourceParticipationID, &r.sourceName,
			&r.pinnedVersion, &r.sourceContentType, &r.size, &r.uploadedAt, &uploadedBy, &uploadedByName,
			&r.versionCount, &r.newestVersion, &r.sequence, &r.readable); err != nil {
			return nil, fmt.Errorf("scan document link: %w", err)
		}
		if uploadedBy != nil && uploadedByName != nil {
			r.uploadedBy = &documents.Person{ID: *uploadedBy, Name: *uploadedByName}
		}
		link, err := newLink(r, access.CanManage)
		if err != nil {
			return nil, err
		}
		links = append(links, link)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list document links: %w", err)
	}
	return links, nil
}
