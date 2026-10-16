package draftstore

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/google/uuid"
)

var _ draftlist.Lister = (*Store)(nil)

// ListV2 lists only visible schema-2 drafts, using the session scope even when
// a cursor is supplied. A save can move a draft before the current cursor;
// restarting pagination reveals it at its new position.
func (s *Store) ListV2(ctx context.Context, companyID, actorID uuid.UUID, req draftlist.Request) (draftlist.Page, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return draftlist.Page{}, fmt.Errorf("begin list v2 tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	auth, err := s.lockGates(ctx, tx, companyID, actorID)
	if err != nil {
		return draftlist.Page{}, err
	}

	query := `SELECT d.id, d.fields, d.principal_recruiter_id, u.full_name,
 d.version, d.created_at, d.updated_at, COALESCE(p.status,'draft'), p.published_at
 FROM job_drafts d
 LEFT JOIN users u ON u.id = d.principal_recruiter_id AND u.deleted_at IS NULL
 LEFT JOIN vacancy_processes p ON p.id = d.id AND p.company_id = d.company_id
 WHERE d.company_id = $1 AND ($2::boolean OR d.principal_recruiter_id = $3)
 AND convert_from(d.fields,'UTF8')::jsonb->>'schema_version' = '2'`
	// Same rule as authorized(): the owner sees every draft, others only
	// their principal drafts.
	args := []any{companyID, auth.role == roleOwner, actorID}
	if req.After != nil {
		query += ` AND (d.updated_at, d.id) < ($4::timestamptz, $5::uuid)`
		args = append(args, req.After.LastUpdatedAt, req.After.LastID)
	}
	query += fmt.Sprintf(` ORDER BY d.updated_at DESC, d.id DESC LIMIT %d`, req.Limit+1)
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return draftlist.Page{}, fmt.Errorf("list v2 drafts: %w", err)
	}
	items := make([]draftlist.Item, 0, req.Limit+1)
	documents := make([][]byte, 0, req.Limit+1)
	for rows.Next() {
		var item draftlist.Item
		var fields []byte
		if err := rows.Scan(&item.ID, &fields, &item.Principal.ID, &item.Principal.Name, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.Status, &item.PublishedAt); err != nil {
			rows.Close()
			return draftlist.Page{}, fmt.Errorf("scan list v2 draft: %w", err)
		}
		items = append(items, item)
		documents = append(documents, fields)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return draftlist.Page{}, fmt.Errorf("iterate list v2 drafts: %w", err)
	}

	page := draftlist.Page{Items: items}
	if len(items) > req.Limit {
		page.Items = items[:req.Limit]
		last := page.Items[req.Limit-1]
		page.NextCursor, err = draftlist.EncodeCursor(draftlist.Cursor{
			CompanyID: companyID, ActorID: actorID, LastUpdatedAt: last.UpdatedAt, LastID: last.ID,
		})
		if err != nil {
			return draftlist.Page{}, fmt.Errorf("encode list v2 cursor: %w", err)
		}
	}
	// Close the result set before catalog lookups on this same transaction.
	// The lookahead row only establishes that another page exists.
	for i := range page.Items {
		document := documents[i]
		if err := requireV2ReadDocument(document); err != nil {
			return draftlist.Page{}, err
		}
		fields, err := envelopeFieldsOf(document)
		if err != nil {
			return draftlist.Page{}, err
		}
		if title, ok := fields["title"].(string); ok {
			page.Items[i].Title = &title
		}
		// Codes were validated by requireV2ReadDocument; copy them as stored.
		if mode, ok := fields["work_mode"].(string); ok {
			page.Items[i].WorkMode = &mode
		}
		if schedule, ok := fields["work_schedule"].(string); ok {
			page.Items[i].Schedule = &schedule
		}
		kind, id, present, err := requesterRef(document)
		if err != nil {
			return draftlist.Page{}, err
		}
		if present {
			name, err := requesterNameForRead(ctx, tx, companyID, document)
			if err != nil {
				return draftlist.Page{}, err
			}
			page.Items[i].Requester = &draftlist.Requester{Kind: kind, ID: id, Name: name}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return draftlist.Page{}, fmt.Errorf("commit list v2 tx: %w", err)
	}
	return page, nil
}
