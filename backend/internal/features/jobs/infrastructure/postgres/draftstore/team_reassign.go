package draftstore

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// reassignResponsible is the single transactional handover writer, shared by
// team writes and membership offboarding. The caller holds the vacancy lock
// and validates the current mode, responsible and company membership.
func (s *Store) reassignResponsible(ctx context.Context, tx pgx.Tx, id, company, actor uuid.UUID, responsible activeAssignment, members []activeAssignment, input vacancyteam.Input, now time.Time) (map[string]string, error) {
	snapshot, err := s.teamSnapshot(ctx, tx, id, responsible, now)
	if err != nil {
		return nil, err
	}
	reassignment := uuid.Must(uuid.NewV7())
	if input.Previous == "remove" {
		if err := endTeamAssignment(ctx, tx, responsible, actor, "reassigned", &reassignment, now); err != nil {
			return nil, err
		}
	} else {
		if err := closeTeamFunction(ctx, tx, responsible.ID, "reassignment", now); err != nil {
			return nil, err
		}
		if err := openTeamFunction(ctx, tx, id, responsible.ID, "collaborator", "reassignment", now); err != nil {
			return nil, err
		}
	}
	var to *activeAssignment
	for i := range members {
		if members[i].User == input.UserID {
			to = &members[i]
		}
	}
	toID := uuid.Must(uuid.NewV7())
	if to != nil {
		toID = to.ID
		if err := closeTeamFunction(ctx, tx, toID, "reassignment", now); err != nil {
			return nil, err
		}
		if err := openTeamFunction(ctx, tx, id, toID, "responsible", "reassignment", now); err != nil {
			return nil, err
		}
	} else {
		if err := openTeamAssignment(ctx, tx, id, company, input.UserID, actor, toID, "responsible", "reassignment", input.Deadline, now); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_reassignments(id,draft_id,company_id,from_assignment_id,to_assignment_id,reason,note,previous_responsible,performed_by,performed_at,state_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, reassignment, id, company, responsible.ID, toID, input.Reason, input.Note, input.Previous, actor, now, snapshot); err != nil {
		return nil, err
	}
	return map[string]string{"company_id": company.String(), "reassignment_id": reassignment.String(), "from_user_id": responsible.User.String(), "to_user_id": input.UserID.String(), "from_assignment_id": responsible.ID.String(), "to_assignment_id": toID.String(), "reason": input.Reason, "previous_responsible": input.Previous}, nil
}
