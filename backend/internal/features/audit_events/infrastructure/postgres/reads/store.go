// Package reads is the read side of audit_events for the owner's audit screen
// (audit-log-v1 §8). The append-only port (AuditEventRepository) stays without
// any read method: this package is a separate, read-only adapter. Its only
// write is the export's own AuditLogExported row, appended through that port.
package reads

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/application/auditlog"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool  *pgxpool.Pool
	audit auditrepositories.AuditEventRepository
}

func NewStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *Store {
	return &Store{pool: pool, audit: audit}
}

var _ app.Reader = (*Store)(nil)

// catalogTypes are the only event types the screen shows, so every row has a
// category. Append refuses any other type, so this excludes nothing written
// after the catalog existed.
func catalogTypes() []string {
	specs := entities.Catalog()
	out := make([]string, len(specs))
	for i, spec := range specs {
		out[i] = spec.Type
	}
	return out
}

// args numbers positional parameters.
type args []any

func (a *args) add(v any) string {
	*a = append(*a, v)
	return "$" + strconv.Itoa(len(*a))
}

// where builds the shared filter clause over audit_events aliased `a`.
func where(a *args, company uuid.UUID, f app.Filters) (string, error) {
	from, toExclusive, err := f.Window()
	if err != nil {
		return "", err
	}
	conds := []string{
		"a.company_id = " + a.add(company),
		"a.event_type = ANY(" + a.add(f.Types()) + ")",
	}
	if f.ActorID != nil {
		conds = append(conds, "a.actor_id = "+a.add(*f.ActorID))
	}
	if f.VacancyID != nil {
		conds = append(conds, "a.vacancy_id = "+a.add(*f.VacancyID))
	}
	if !from.IsZero() {
		conds = append(conds, "a.occurred_at >= "+a.add(from))
	}
	if !toExclusive.IsZero() {
		conds = append(conds, "a.occurred_at < "+a.add(toExclusive))
	}
	return strings.Join(conds, " AND "), nil
}

// vacancyTitle reads the live title of a draft of the same company; no row (a
// deleted vacancy) is NULL, a vacancy without a title is ”.
func vacancyTitle(id string) string {
	return `(SELECT COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title','') FROM job_drafts d WHERE d.id = ` + id + ` AND d.company_id = p.company_id)`
}

// visibleName is the name the company sees for an organic candidate: the
// company's correction when it has one, else the account name.
const visibleName = `CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE %s END`

// entityLabel resolves the label at read time, never stored (audit-log-v1
// §8.1). NULL when the entity no longer exists or the type has no label. A
// company_member label names a person, so it resolves only for a user who is a
// member of the row's company, acted in it, or is named by another member event
// of it (a former member keeps the name, §5); a user id from anywhere else
// shows nothing (§7).
var entityLabel = `NULLIF(CASE p.entity_type
 WHEN 'company_candidate' THEN COALESCE(
  (SELECT cc.full_name FROM company_candidates cc WHERE cc.id = p.entity_id AND cc.company_id = p.company_id),
  (SELECT ` + fmt.Sprintf(visibleName, "u2.full_name") + `
   FROM users u2 LEFT JOIN company_candidate_corrections o ON o.company_id = p.company_id AND o.user_id = u2.id
   WHERE u2.id = p.entity_id AND EXISTS (
    SELECT 1 FROM process_participations pp JOIN vacancy_processes vp ON vp.id = pp.process_id
    WHERE pp.candidate_id = u2.id AND vp.company_id = p.company_id)))
 WHEN 'process_participation' THEN (
  SELECT COALESCE(cc.full_name, ` + fmt.Sprintf(visibleName, "u3.full_name") + `)
  FROM process_participations pp JOIN vacancy_processes vp ON vp.id = pp.process_id AND vp.company_id = p.company_id
  LEFT JOIN company_candidates cc ON cc.id = pp.company_candidate_id
  LEFT JOIN users u3 ON u3.id = pp.candidate_id
  LEFT JOIN company_candidate_corrections o ON o.company_id = p.company_id AND o.user_id = pp.candidate_id
  WHERE pp.id = p.entity_id)
 WHEN 'company_member' THEN (
  SELECT u4.full_name FROM users u4
  WHERE u4.deleted_at IS NULL AND u4.id = CASE WHEN p.metadata->>'member_user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN (p.metadata->>'member_user_id')::uuid END
  AND (EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = u4.id AND m.company_id = p.company_id)
   OR EXISTS (SELECT 1 FROM audit_events x WHERE x.company_id = p.company_id AND x.actor_id = u4.id)
   OR EXISTS (SELECT 1 FROM audit_events x WHERE x.company_id = p.company_id AND x.id <> p.id AND x.entity_type = 'company_member'
    AND x.metadata->>'member_user_id' = u4.id::text)))
 WHEN 'job_draft' THEN ` + vacancyTitle("p.entity_id") + `
 WHEN 'vacancy' THEN ` + vacancyTitle("p.entity_id") + `
 WHEN 'vacancy_process' THEN ` + vacancyTitle("p.entity_id") + `
 WHEN 'company' THEN (SELECT c.name FROM companies c WHERE c.id = p.entity_id AND c.id = p.company_id)
END, '')`

// rowColumns is the one projection behind the list and the export. p is the
// page of audit rows, u the actor's account.
var rowColumns = `p.id, p.occurred_at, p.event_type, p.actor_type, p.actor_id,
 CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL THEN u.full_name END,
 CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL THEN u.email END,
 EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = p.actor_id AND m.company_id = p.company_id),
 p.entity_type, p.entity_id, ` + entityLabel + `,
 p.vacancy_id, ` + vacancyTitle("p.vacancy_id") + `,
 CASE WHEN jsonb_typeof(p.metadata) = 'object' THEN p.metadata ELSE '{}'::jsonb END,
 host(p.ip), p.user_agent, p.ip_source`

// rowsSQL selects the filtered rows newest first, hydrating labels only for the
// page (LIMIT inside the CTE).
func rowsSQL(whereClause, extra, limit string) string {
	return `WITH page AS (SELECT a.* FROM audit_events a WHERE ` + whereClause + extra + ` ORDER BY a.occurred_at DESC, a.id DESC` + limit + `)
SELECT ` + rowColumns + ` FROM page p LEFT JOIN users u ON u.id = p.actor_id ORDER BY p.occurred_at DESC, p.id DESC`
}

type row struct {
	id                      uuid.UUID
	at                      time.Time
	eventType, actorType    string
	actorID                 *uuid.UUID
	actorName, actorEmail   *string
	member                  bool
	entityType              string
	entityID                uuid.UUID
	label                   *string
	vacancyID               *uuid.UUID
	vacancyTitle            *string
	metadata                []byte
	ip, userAgent, ipSource *string
}

func scanRow(rows pgx.Rows) (row, error) {
	var r row
	err := rows.Scan(&r.id, &r.at, &r.eventType, &r.actorType, &r.actorID, &r.actorName, &r.actorEmail, &r.member,
		&r.entityType, &r.entityID, &r.label, &r.vacancyID, &r.vacancyTitle, &r.metadata, &r.ip, &r.userAgent, &r.ipSource)
	return r, err
}

func categoryOf(eventType string) string {
	if spec, ok := entities.LookupEvent(eventType); ok {
		return string(spec.Category)
	}
	return ""
}

func (r row) item() app.Item {
	item := app.Item{
		ID: r.id, OccurredAt: app.Timestamp{Time: r.at}, EventType: r.eventType, Category: categoryOf(r.eventType),
		Entity:   app.Entity{Type: r.entityType, ID: r.entityID, Label: r.label},
		Metadata: r.metadata, IP: r.ip, IPSource: r.ipSource, UserAgent: r.userAgent,
	}
	if r.actorType == string(entities.ActorTypeSystem) || r.actorID == nil {
		item.Actor = app.Actor{System: true}
	} else {
		item.Actor = app.Actor{UserID: *r.actorID, Name: r.actorName, Email: r.actorEmail, IsCurrentMember: r.member}
	}
	if r.vacancyID != nil {
		item.Vacancy = &app.VacancyRef{ID: *r.vacancyID, Title: r.vacancyTitle}
	}
	return item
}

func (r row) exportRow() app.ExportRow {
	out := app.ExportRow{
		OccurredAt: r.at, EventType: r.eventType, Category: categoryOf(r.eventType),
		EntityType: r.entityType, EntityID: r.entityID, EntityLabel: r.label,
		VacancyID: r.vacancyID, VacancyTitle: r.vacancyTitle, IP: r.ip, UserAgent: r.userAgent, Metadata: r.metadata,
	}
	if r.actorType != string(entities.ActorTypeSystem) && r.actorID != nil {
		out.ActorUserID, out.ActorName, out.ActorEmail = r.actorID, r.actorName, r.actorEmail
	}
	return out
}

// List runs the page and the exact total in one read-only snapshot.
func (s *Store) List(ctx context.Context, company uuid.UUID, q app.Query) (app.Page, error) {
	var a args
	clause, err := where(&a, company, q.Filters)
	if err != nil {
		return app.Page{}, err
	}
	total := "SELECT count(*) FROM audit_events a WHERE " + clause
	totalArgs := append(args(nil), a...)
	extra := ""
	if q.After != nil {
		extra = " AND (a.occurred_at, a.id) < (" + a.add(q.After.At) + ", " + a.add(q.After.ID) + ")"
	}
	query := rowsSQL(clause, extra, " LIMIT "+a.add(q.Limit+1))

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return app.Page{}, err
	}
	defer tx.Rollback(ctx)
	var page app.Page
	if err := tx.QueryRow(ctx, total, totalArgs...).Scan(&page.Total); err != nil {
		return app.Page{}, err
	}
	rows, err := tx.Query(ctx, query, a...)
	if err != nil {
		return app.Page{}, err
	}
	defer rows.Close()
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return app.Page{}, err
		}
		page.Items = append(page.Items, r.item())
	}
	if err := rows.Err(); err != nil {
		return app.Page{}, err
	}
	return page, nil
}

// Actors lists the users that appear as actors in the company's events,
// former members and deleted accounts included, ordered by name.
func (s *Store) Actors(ctx context.Context, company uuid.UUID) ([]app.ActorOption, error) {
	rows, err := s.pool.Query(ctx, `SELECT x.actor_id,
 CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL THEN u.full_name END AS name,
 CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL THEN u.email END,
 EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = x.actor_id AND m.company_id = $1)
FROM (SELECT DISTINCT actor_id FROM audit_events WHERE company_id = $1 AND actor_id IS NOT NULL AND event_type = ANY($2)) x
LEFT JOIN users u ON u.id = x.actor_id
ORDER BY lower(CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL THEN u.full_name END) NULLS LAST, 2, x.actor_id`, company, catalogTypes())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []app.ActorOption
	for rows.Next() {
		var o app.ActorOption
		if err := rows.Scan(&o.UserID, &o.Name, &o.Email, &o.IsCurrentMember); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// Vacancies lists the vacancies that appear in the company's events, deleted
// ones included (title NULL, last), ordered by title.
func (s *Store) Vacancies(ctx context.Context, company uuid.UUID) ([]app.VacancyOption, error) {
	rows, err := s.pool.Query(ctx, `SELECT v.vacancy_id, v.title FROM (
 SELECT x.vacancy_id,
  (SELECT COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title','') FROM job_drafts d WHERE d.id = x.vacancy_id AND d.company_id = $1) AS title
 FROM (SELECT DISTINCT vacancy_id FROM audit_events WHERE company_id = $1 AND vacancy_id IS NOT NULL AND event_type = ANY($2)) x
) v ORDER BY lower(v.title) NULLS LAST, v.title, v.vacancy_id`, company, catalogTypes())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []app.VacancyOption
	for rows.Next() {
		var o app.VacancyOption
		if err := rows.Scan(&o.VacancyID, &o.Title); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

const exportCursor = "audit_export"
const exportBatch = 500

// Export counts in a REPEATABLE READ transaction, refuses above the limit, and
// otherwise declares a WITH HOLD cursor over the same snapshot, appends
// AuditLogExported and commits. The commit materialises the cursor, so the rows
// streamed afterwards are exactly the rows counted, and the record exists
// before the first byte is written.
func (s *Store) Export(ctx context.Context, req app.ExportRequest) (app.ExportStream, error) {
	var a args
	clause, err := where(&a, req.Company, req.Filters)
	if err != nil {
		return nil, err
	}
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	handedOver := false
	defer func() {
		if !handedOver {
			conn.Release()
		}
	}()
	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var count int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM audit_events a WHERE "+clause, a...).Scan(&count); err != nil {
		return nil, err
	}
	if count > req.Limit {
		return nil, &app.TooLarge{RowCount: count, Limit: req.Limit}
	}
	if _, err := tx.Exec(ctx, "DECLARE "+exportCursor+" NO SCROLL CURSOR WITH HOLD FOR "+rowsSQL(clause, "", ""), a...); err != nil {
		return nil, fmt.Errorf("declare export cursor: %w", err)
	}
	if err := s.audit.Append(ctx, tx, req.Audit(count)); err != nil {
		return nil, fmt.Errorf("record audit export: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	handedOver = true
	return &stream{conn: conn, count: count}, nil
}

type stream struct {
	conn   *pgxpool.Conn
	count  int
	closed bool
}

func (s *stream) RowCount() int { return s.count }

func (s *stream) Next(ctx context.Context) ([]app.ExportRow, error) {
	if s.closed {
		return nil, errors.New("audit export stream is closed")
	}
	rows, err := s.conn.Query(ctx, "FETCH FORWARD "+strconv.Itoa(exportBatch)+" FROM "+exportCursor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []app.ExportRow
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r.exportRow())
	}
	return out, rows.Err()
}

// Close drops the cursor and returns the connection; a connection that cannot
// close it cleanly is discarded rather than pooled with a live cursor.
func (s *stream) Close() error {
	if s.closed {
		return nil
	}
	s.closed = true
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := s.conn.Exec(ctx, "CLOSE "+exportCursor)
	if err != nil {
		_ = s.conn.Conn().Close(ctx)
	}
	s.conn.Release()
	return err
}
