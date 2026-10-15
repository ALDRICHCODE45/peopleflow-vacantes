package draftstore

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/requesters"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Compile-time assertion that the adapter satisfies the requester port.
var _ requesters.Store = (*Store)(nil)

// requesterNormalizationVersion tags rows written by the current
// RequesterName algorithm so a future algorithm change stays observable.
const requesterNormalizationVersion = 1

// CreateRequester inserts one immutable catalog entry with its audit event in
// a single transaction after re-checking the live user, the live active
// company and the membership. A duplicate (company, kind, name key) inserts
// nothing and returns *requesters.AlreadyExistsError carrying the stored
// entry of the same company and kind.
func (s *Store) CreateRequester(ctx context.Context, companyID, actorID uuid.UUID, kind string, name valueobjects.RequesterName) (requesters.Entry, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return requesters.Entry{}, fmt.Errorf("begin create requester tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := s.lockGates(ctx, tx, companyID, actorID); err != nil {
		return requesters.Entry{}, err
	}

	id := uuid.Must(uuid.NewV7())
	// ON CONFLICT waits for a concurrent insert of the same key and then
	// skips, so exactly one transaction creates the entry.
	err = tx.QueryRow(ctx,
		`INSERT INTO job_draft_requesters (id, company_id, kind, name, name_key, normalization_version)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT ON CONSTRAINT job_draft_requesters_unique DO NOTHING
		 RETURNING id`,
		id, companyID, kind, name.Value(), name.Key(), requesterNormalizationVersion,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, err := findRequesterByKey(ctx, tx, companyID, kind, name.Key())
		if err != nil {
			return requesters.Entry{}, err
		}
		return requesters.Entry{}, &requesters.AlreadyExistsError{Existing: existing}
	}
	if err != nil {
		return requesters.Entry{}, fmt.Errorf("insert requester: %w", err)
	}

	actor := actorID
	if err := s.audit.Append(ctx, tx, entities.AuditEvent{
		ID:         uuid.Must(uuid.NewV7()),
		ActorType:  entities.ActorTypeUser,
		ActorID:    &actor,
		EventType:  entities.EventJobDraftRequesterCreated,
		EntityType: entities.EntityJobDraftRequester,
		EntityID:   id,
		Metadata:   map[string]string{"kind": kind},
	}); err != nil {
		return requesters.Entry{}, fmt.Errorf("co-write requester audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return requesters.Entry{}, fmt.Errorf("commit create requester tx: %w", err)
	}
	return requesters.Entry{ID: id, Kind: kind, Name: name.Value()}, nil
}

// findRequesterByKey reads the stored entry of one (company, kind, key).
func findRequesterByKey(ctx context.Context, tx pgx.Tx, companyID uuid.UUID, kind, key string) (requesters.Entry, error) {
	entry := requesters.Entry{Kind: kind}
	if err := tx.QueryRow(ctx,
		`SELECT id, name FROM job_draft_requesters WHERE company_id = $1 AND kind = $2 AND name_key = $3`,
		companyID, kind, key,
	).Scan(&entry.ID, &entry.Name); err != nil {
		return requesters.Entry{}, fmt.Errorf("read existing requester: %w", err)
	}
	return entry, nil
}

// ListRequesters returns one keyset page of the company catalog for one kind,
// ordered by (name_key COLLATE "C", id). The query is a literal prefix of the
// casefold key. The session company predicate always applies, whatever the
// cursor says.
func (s *Store) ListRequesters(ctx context.Context, companyID, actorID uuid.UUID, req requesters.ListRequest) (requesters.Page, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return requesters.Page{}, fmt.Errorf("begin list requesters tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := s.lockGates(ctx, tx, companyID, actorID); err != nil {
		return requesters.Page{}, err
	}

	query := `SELECT id, name, name_key FROM job_draft_requesters
	 WHERE company_id = $1 AND kind = $2 AND name_key COLLATE "C" LIKE $3 ESCAPE '\'`
	args := []any{companyID, req.Kind, likePrefix(req.Query.Key)}
	if req.After != nil {
		query += ` AND (name_key COLLATE "C", id) > ($4::text COLLATE "C", $5::uuid)`
		args = append(args, req.After.LastNameKey, req.After.LastID)
	}
	query += fmt.Sprintf(` ORDER BY name_key COLLATE "C", id LIMIT %d`, req.Limit+1)

	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return requesters.Page{}, fmt.Errorf("list requesters: %w", err)
	}
	items := make([]requesters.Entry, 0, req.Limit)
	keys := make([]string, 0, req.Limit)
	for rows.Next() {
		entry := requesters.Entry{Kind: req.Kind}
		var key string
		if err := rows.Scan(&entry.ID, &entry.Name, &key); err != nil {
			rows.Close()
			return requesters.Page{}, fmt.Errorf("scan requester: %w", err)
		}
		items = append(items, entry)
		keys = append(keys, key)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return requesters.Page{}, fmt.Errorf("iterate requesters: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return requesters.Page{}, fmt.Errorf("commit list requesters tx: %w", err)
	}

	page := requesters.Page{Items: items}
	if len(items) > req.Limit {
		page.Items = items[:req.Limit]
		last := page.Items[req.Limit-1]
		next, err := requesters.EncodeCursor(requesters.Cursor{
			CompanyID:   companyID,
			Kind:        req.Kind,
			QNormalized: req.Query.Normalized,
			LastNameKey: keys[req.Limit-1],
			LastID:      last.ID,
		})
		if err != nil {
			return requesters.Page{}, fmt.Errorf("encode requester cursor: %w", err)
		}
		page.NextCursor = next
	}
	return page, nil
}

// likePrefix escapes LIKE metacharacters so the prefix matches literally.
func likePrefix(prefix string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(prefix)
	return escaped + "%"
}
