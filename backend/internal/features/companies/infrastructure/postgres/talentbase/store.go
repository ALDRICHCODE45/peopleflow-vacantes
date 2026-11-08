// Package talentbase persists the company talent base visibility setting.
package talentbase

import (
	"context"
	"errors"
	"sort"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/talentbase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool  *pgxpool.Pool
	audit auditrepo.AuditEventRepository
}

func NewStore(pool *pgxpool.Pool, events auditrepo.AuditEventRepository) *Store {
	return &Store{pool: pool, audit: events}
}

var (
	_ app.Store  = (*Store)(nil)
	_ app.Access = (*Store)(nil)
)

// CanView is the single rule: owners, companies in all_recruiters (including a
// company that never saved the setting) and listed viewers.
func (s *Store) CanView(ctx context.Context, company, user uuid.UUID, role string) (bool, error) {
	if role == "owner" {
		return true, nil
	}
	var allowed bool
	err := s.pool.QueryRow(ctx, `SELECT COALESCE((SELECT mode='all_recruiters' FROM company_talent_base_settings WHERE company_id=$1),true)
 OR EXISTS(SELECT 1 FROM company_talent_base_viewers WHERE company_id=$1 AND user_id=$2)`, company, user).Scan(&allowed)
	return allowed, err
}

// CanViewIn applies the same rule inside a caller's transaction, reading the
// role from the membership instead of the request context.
func CanViewIn(ctx context.Context, q pgx.Tx, company, user uuid.UUID) (bool, error) {
	var allowed bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2 AND role='owner')
 OR COALESCE((SELECT mode='all_recruiters' FROM company_talent_base_settings WHERE company_id=$1),true)
 OR EXISTS(SELECT 1 FROM company_talent_base_viewers WHERE company_id=$1 AND user_id=$2)`, company, user).Scan(&allowed)
	return allowed, err
}

func (s *Store) Get(ctx context.Context, company uuid.UUID) (app.Document, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return app.Document{}, err
	}
	defer tx.Rollback(ctx)
	return read(ctx, tx, company)
}

func (s *Store) Replace(ctx context.Context, company, actor uuid.UUID, version int64, r app.Replacement) (app.Document, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Document{}, err
	}
	defer tx.Rollback(ctx)
	// Same stable company lock as member mutations, then the settings row: a
	// promotion or offboarding cannot interleave with the membership checks below.
	if _, err = db.New(tx).LockCompanyForMemberMutation(ctx, company); err != nil {
		return app.Document{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO company_talent_base_settings(company_id,mode) VALUES($1,'all_recruiters') ON CONFLICT DO NOTHING`, company); err != nil {
		return app.Document{}, err
	}
	var previousMode app.Mode
	var current int64
	if err = tx.QueryRow(ctx, `SELECT mode,version FROM company_talent_base_settings WHERE company_id=$1 FOR UPDATE`, company).Scan(&previousMode, &current); err != nil {
		return app.Document{}, err
	}
	if current != version {
		doc, err := read(ctx, tx, company)
		if err != nil {
			return app.Document{}, err
		}
		return doc, app.ErrVersionConflict
	}
	if err = checkMembers(ctx, tx, company, r.UserIDs); err != nil {
		return app.Document{}, err
	}
	existing, err := viewerIDs(ctx, tx, company)
	if err != nil {
		return app.Document{}, err
	}
	added, removed := diff(existing, r.UserIDs)
	if len(removed) > 0 {
		if _, err = tx.Exec(ctx, `DELETE FROM company_talent_base_viewers WHERE company_id=$1 AND user_id=ANY($2)`, company, removed); err != nil {
			return app.Document{}, err
		}
	}
	for _, id := range added {
		if _, err = tx.Exec(ctx, `INSERT INTO company_talent_base_viewers(company_id,user_id,added_at,added_by) VALUES($1,$2,now(),$3)`, company, id, actor); err != nil {
			return app.Document{}, err
		}
	}
	next := current + 1
	if _, err = tx.Exec(ctx, `UPDATE company_talent_base_settings SET mode=$2,version=$3,updated_at=now(),updated_by=$4 WHERE company_id=$1`, company, string(r.Mode), next, actor); err != nil {
		return app.Document{}, err
	}
	if err = s.audit.Append(ctx, tx, audit.AuditEvent{
		ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor,
		EventType: app.EventVisibilityChanged, EntityType: audit.EntityCompany, EntityID: company, CompanyID: &company,
		StructuredMetadata: map[string]any{
			"company_id": company.String(), "version": next,
			"previous_mode": string(previousMode), "new_mode": string(r.Mode),
			"added_user_ids": idStrings(added), "removed_user_ids": idStrings(removed),
		},
	}); err != nil {
		return app.Document{}, err
	}
	doc, err := read(ctx, tx, company)
	if err != nil {
		return app.Document{}, err
	}
	return doc, tx.Commit(ctx)
}

// checkMembers reports the first listed user, in request order, who is not a
// member of this company or is an owner.
func checkMembers(ctx context.Context, tx pgx.Tx, company uuid.UUID, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT user_id,role FROM company_members WHERE company_id=$1 AND user_id=ANY($2)`, company, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	roles := make(map[uuid.UUID]string, len(ids))
	for rows.Next() {
		var id uuid.UUID
		var role string
		if err = rows.Scan(&id, &role); err != nil {
			return err
		}
		roles[id] = role
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for i, id := range ids {
		role, member := roles[id]
		switch {
		// A stakeholder is never a viewer entry (stakeholder-metrics-v1 §1.1).
		case !member || role == "stakeholder":
			return &app.RuleError{Rule: app.RuleViewerNotMember, Field: app.UserIDField(i)}
		case role == "owner":
			return &app.RuleError{Rule: app.RuleViewerIsOwner, Field: app.UserIDField(i)}
		}
	}
	return nil
}

func viewerIDs(ctx context.Context, tx pgx.Tx, company uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `SELECT user_id FROM company_talent_base_viewers WHERE company_id=$1`, company)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// diff returns the ids to add and to remove, each sorted by their text form.
func diff(existing, next []uuid.UUID) (added, removed []uuid.UUID) {
	had := make(map[uuid.UUID]bool, len(existing))
	for _, id := range existing {
		had[id] = true
	}
	want := make(map[uuid.UUID]bool, len(next))
	for _, id := range next {
		want[id] = true
		if !had[id] {
			added = append(added, id)
		}
	}
	for _, id := range existing {
		if !want[id] {
			removed = append(removed, id)
		}
	}
	sortIDs(added)
	sortIDs(removed)
	return added, removed
}

func sortIDs(ids []uuid.UUID) {
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
}

func idStrings(ids []uuid.UUID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = id.String()
	}
	return out
}

func read(ctx context.Context, tx pgx.Tx, company uuid.UUID) (app.Document, error) {
	doc := app.Document{Mode: app.ModeAllRecruiters, Viewers: []app.Viewer{}, Version: 1}
	var editor *uuid.UUID
	var editorName *string
	err := tx.QueryRow(ctx, `SELECT s.mode,s.version,s.updated_at,s.updated_by,u.full_name FROM company_talent_base_settings s LEFT JOIN users u ON u.id=s.updated_by WHERE s.company_id=$1`, company).
		Scan(&doc.Mode, &doc.Version, &doc.UpdatedAt, &editor, &editorName)
	if errors.Is(err, pgx.ErrNoRows) {
		return doc, nil
	}
	if err != nil {
		return doc, err
	}
	if editor != nil && editorName != nil {
		doc.UpdatedBy = &app.Editor{UserID: *editor, FullName: *editorName}
	}
	rows, err := tx.Query(ctx, `SELECT v.user_id,u.full_name,u.email,m.role,v.added_at
 FROM company_talent_base_viewers v
 JOIN company_members m ON m.user_id=v.user_id AND m.company_id=v.company_id
 JOIN users u ON u.id=v.user_id
 WHERE v.company_id=$1 ORDER BY u.full_name,v.user_id`, company)
	if err != nil {
		return doc, err
	}
	defer rows.Close()
	for rows.Next() {
		var viewer app.Viewer
		if err = rows.Scan(&viewer.UserID, &viewer.FullName, &viewer.Email, &viewer.Role, &viewer.AddedAt); err != nil {
			return doc, err
		}
		doc.Viewers = append(doc.Viewers, viewer)
	}
	return doc, rows.Err()
}
