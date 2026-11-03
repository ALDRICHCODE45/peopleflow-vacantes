package board

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// recordPlacementCredit is called only alongside the history insert, while the
// shared draft lock serializes hires, exits, team changes and owner corrections.
func (s *Store) recordPlacementCredit(ctx context.Context, tx pgx.Tx, company, actor, process, participation, history uuid.UUID, at time.Time, hire, departure bool, reason string) error {
	if hire {
		credit := uuid.Must(uuid.NewV7())
		var mode string
		if err := tx.QueryRow(ctx, `INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status)
 SELECT $1,$2,$3,$4,$5,$6,$7,mode,'active' FROM vacancy_teams WHERE draft_id=$3 RETURNING team_mode`, credit, company, process, participation, history, at, actor).Scan(&mode); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `INSERT INTO placement_credit_recipients(credit_id,user_id,assignment_id,kind)
 SELECT $1,a.user_id,a.id,CASE f.function WHEN 'responsible' THEN 'direct' WHEN 'collaborator' THEN 'participant' WHEN 'member' THEN 'shared' END
 FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id AND f.ended_at IS NULL
 WHERE a.draft_id=$2 AND a.ended_at IS NULL RETURNING user_id,kind`, credit, process)
		if err != nil {
			return err
		}
		recipients := []map[string]string{}
		for rows.Next() {
			var user uuid.UUID
			var kind string
			if err := rows.Scan(&user, &kind); err != nil {
				rows.Close()
				return err
			}
			recipients = append(recipients, map[string]string{"user_id": user.String(), "kind": kind})
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		// SQL RETURNING has no order guarantee; stable event order aids consumers.
		sort.Slice(recipients, func(i, j int) bool { return recipients[i]["user_id"] < recipients[j]["user_id"] })
		return s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyPlacementCredited", EntityType: "process_participation", EntityID: participation, StructuredMetadata: map[string]any{"company_id": company.String(), "vacancy_id": process.String(), "credit_id": credit.String(), "team_mode": mode, "hired_by": actor.String(), "recipients": recipients}})
	}
	if !departure {
		return nil
	}
	var credit uuid.UUID
	var fromStatus string
	// Status corrections do not end an episode. Attach its first departure
	// even when the owner has already voided the credit.
	err := tx.QueryRow(ctx, `SELECT id,status FROM placement_credits WHERE process_id=$1 AND participation_id=$2 AND exit_history_id IS NULL AND hired_at<$3 ORDER BY hired_at DESC,id DESC LIMIT 1`, process, participation, at).Scan(&credit, &fromStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	status := fromStatus
	if fromStatus == "active" {
		status = "did_not_hold"
		if reason == "moved_by_mistake" {
			status = "voided"
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE placement_credits SET exit_history_id=$2,exit_reason=$3,status=$4,status_changed_at=CASE WHEN status='active' THEN $5 ELSE status_changed_at END,status_changed_by=CASE WHEN status='active' THEN $6 ELSE status_changed_by END WHERE id=$1`, credit, history, reason, status, at, actor); err != nil {
		return err
	}
	if status == fromStatus {
		return nil
	}
	return s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyPlacementCreditChanged", EntityType: "process_participation", EntityID: participation, Metadata: map[string]string{"company_id": company.String(), "vacancy_id": process.String(), "credit_id": credit.String(), "from_status": "active", "to_status": status, "cause": "exit:" + reason}})
}

func (s *Store) PlacementCredits(ctx context.Context, company, actor, id, pid uuid.UUID) (app.CreditList, error) {
	tx, _, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.CreditList{}, err
	}
	defer tx.Rollback(ctx)
	if _, _, err = readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2`, id, pid)); err != nil {
		return app.CreditList{}, err
	}
	raw, err := db.ReadPlacementCredits(ctx, tx, id, pid)
	return app.CreditList{Items: raw}, err
}
func creditDetail(ctx context.Context, tx pgx.Tx, company, actor, id, pid uuid.UUID) (*app.PlacementCredit, app.CreditCapabilities, error) {
	raw, err := db.ReadPlacementCredits(ctx, tx, id, pid)
	if err != nil {
		return nil, app.CreditCapabilities{}, err
	}
	var credits []app.PlacementCredit
	if err = json.Unmarshal(raw, &credits); err != nil {
		return nil, app.CreditCapabilities{}, err
	}
	var latest *app.PlacementCredit
	if len(credits) > 0 {
		latest = &credits[0]
	}
	var owner bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_members WHERE company_id=$1 AND user_id=$2 AND role='owner')`, company, actor).Scan(&owner); err != nil {
		return nil, app.CreditCapabilities{}, err
	}
	return latest, app.CreditCan(owner, latest), nil
}
