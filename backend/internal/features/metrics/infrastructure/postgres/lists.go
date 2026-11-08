package postgres

import (
	"context"
	"fmt"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/google/uuid"
)

// Names resolves the applied filters the snapshot cannot name (v2 §5). A
// person is named only when they are or were part of this company: a member
// now, or in its history (a tramo, a credit, a reassignment they performed);
// anyone else, and a requester or vacancy of another company, comes back with
// a null name. Nothing is named across companies.
func (s *Store) Names(ctx context.Context, company uuid.UUID, q app.NameQuery) (app.Names, error) {
	out := app.Names{People: map[uuid.UUID]app.Person{}}
	if len(q.People) > 0 {
		rows, err := s.pool.Query(ctx, `SELECT x.id,
 CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL AND (
   EXISTS (SELECT 1 FROM company_members m WHERE m.user_id=x.id AND m.company_id=$2)
   OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.user_id=x.id AND a.company_id=$2)
   OR EXISTS (SELECT 1 FROM placement_credit_recipients r JOIN placement_credits pc ON pc.id=r.credit_id WHERE r.user_id=x.id AND pc.company_id=$2)
   OR EXISTS (SELECT 1 FROM vacancy_reassignments vr WHERE vr.performed_by=x.id AND vr.company_id=$2))
 THEN u.full_name END,
 NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id=x.id AND m.company_id=$2)
 FROM unnest($1::uuid[]) x(id) LEFT JOIN users u ON u.id=x.id`, q.People, company)
		if err != nil {
			return out, fmt.Errorf("metrics names: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var p app.Person
			if err := rows.Scan(&p.UserID, &p.Name, &p.FormerMember); err != nil {
				return out, err
			}
			out.People[p.UserID] = p
		}
		if err := rows.Err(); err != nil {
			return out, err
		}
	}
	if r := q.Requester; r != nil {
		err := s.pool.QueryRow(ctx, `SELECT (SELECT name FROM job_draft_requesters WHERE id=$1 AND company_id=$2 AND kind=$3)`, r.ID, company, r.Kind).Scan(&out.Requester)
		if err != nil {
			return out, fmt.Errorf("metrics requester name: %w", err)
		}
	}
	if q.Vacancy != nil {
		err := s.pool.QueryRow(ctx, `SELECT (SELECT COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title','') FROM job_drafts d
 WHERE d.id=$1 AND d.company_id=$2)`, *q.Vacancy, company).Scan(&out.Vacancy)
		if err != nil {
			return out, fmt.Errorf("metrics vacancy title: %w", err)
		}
	}
	return out, nil
}

// RecordDetail writes one audited list read (MetricsDetailViewed) or export
// (MetricsDetailExported) in its own transaction (v2 §6). The row names the
// vacancy when the list is filtered by one; its vacancy column is set only
// for a vacancy of this company.
func (s *Store) RecordDetail(ctx context.Context, a app.DetailAudit) error {
	event := auditentities.AuditEvent{
		ID: uuid.Must(uuid.NewV7()), ActorType: auditentities.ActorTypeUser, ActorID: &a.Actor,
		EventType: auditentities.EventMetricsDetailViewed, EntityType: auditentities.EntityCompany, EntityID: a.Company,
		CompanyID: &a.Company,
	}
	metadata := map[string]any{"report": a.Report, "filters": a.Filters}
	if a.Exported {
		event.EventType = auditentities.EventMetricsDetailExported
		metadata["row_count"] = a.RowCount
	}
	if a.Vacancy != nil {
		event.EntityType, event.EntityID = "vacancy", *a.Vacancy
		metadata["vacancy_id"] = a.Vacancy.String()
		if a.VacancyOwned {
			event.VacancyID = a.Vacancy
		}
	}
	event.StructuredMetadata = metadata
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
