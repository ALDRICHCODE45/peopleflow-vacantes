package postgres

import (
	"context"
	"fmt"

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
	AuthorizeDocuments(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID) (Access, error)
}

// txBeginner is the part of *pgxpool.Pool the store needs.
type txBeginner interface {
	BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error)
}

// Store is the PostgreSQL adapter of the documents read side. The storage port is held for the slices that stream files
// (P4+); the list reads only the database and works with storage disabled.
type Store struct {
	pool    txBeginner
	access  Authorizer
	storage documents.Storage
}

var _ documents.Reader = (*Store)(nil)

// NewStore builds the store. storage may be nil (documents storage disabled).
func NewStore(pool txBeginner, access Authorizer, storage documents.Storage) *Store {
	return &Store{pool: pool, access: access, storage: storage}
}

// List implements documents.Reader: the file documents and the links of the vacancy scope of draftID plus the scope flags, all
// from one REPEATABLE READ snapshot taken after the authorization, so the counts always match the arrays. It needs no process
// row and takes no draft lock.
func (s *Store) List(ctx context.Context, companyID, actorID, draftID uuid.UUID) (documents.List, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return documents.List{}, fmt.Errorf("begin documents list tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	access, err := s.access.AuthorizeDocuments(ctx, tx, companyID, actorID, draftID)
	if err != nil {
		return documents.List{}, err
	}
	items, err := listItems(ctx, tx, companyID, draftID, access.CanManage)
	if err != nil {
		return documents.List{}, err
	}
	links, err := listLinks(ctx, tx, companyID, actorID, draftID, access)
	if err != nil {
		return documents.List{}, err
	}
	canLink := false
	if access.CanManage {
		// A vacancy-level link is only possible on a replacement process (D17).
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vacancy_replacements WHERE process_id=$1 AND company_id=$2)`, draftID, companyID).Scan(&canLink); err != nil {
			return documents.List{}, fmt.Errorf("read replacement flag: %w", err)
		}
	}
	return documents.List{
		Items: items,
		Links: links,
		Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: access.CanManage, CanReceiveLinks: canLink, Documents: len(items), Links: len(links)}),
	}, nil
}

func listItems(ctx context.Context, tx pgx.Tx, companyID, draftID uuid.UUID, canManage bool) ([]documents.Item, error) {
	rows, err := tx.Query(ctx, `
SELECT d.id::text, d.name, d.created_at, d.created_by::text, cu.full_name,
       v.version, v.content_type, v.size, v.uploaded_at, v.uploaded_by::text, uu.full_name,
       (SELECT count(*) FROM placement_document_versions x WHERE x.document_id = d.id)
  FROM placement_documents d
  JOIN LATERAL (SELECT version, content_type, size, uploaded_at, uploaded_by FROM placement_document_versions
                 WHERE document_id = d.id ORDER BY version DESC LIMIT 1) v ON true
  JOIN users cu ON cu.id = d.created_by
  JOIN users uu ON uu.id = v.uploaded_by
 WHERE d.company_id = $1 AND d.draft_id = $2 AND d.participation_id IS NULL
 ORDER BY v.uploaded_at DESC, d.id DESC`, companyID, draftID)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()
	items := []documents.Item{}
	for rows.Next() {
		var r itemRow
		if err := rows.Scan(&r.id, &r.name, &r.createdAt, &r.createdBy.ID, &r.createdBy.Name,
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

// listLinks reads the vacancy-level links of draftID. The source is resolved through the pinned version; a source the caller
// may not read (owner or stakeholder of the company, or an active member of the source vacancy's team: D18) is reported as
// inaccessible without its data. The company equality on every join keeps a foreign row from ever being described.
func listLinks(ctx context.Context, tx pgx.Tx, companyID, actorID, draftID uuid.UUID, access Access) ([]documents.Link, error) {
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
 WHERE l.company_id = $1 AND l.draft_id = $2 AND l.participation_id IS NULL
 ORDER BY l.linked_at DESC, l.id DESC`, companyID, draftID, sees, actorID)
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
