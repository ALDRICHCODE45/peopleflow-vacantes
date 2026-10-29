package draftstore

import (
	"context"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PsychometricInvitationsContext uses the same vacancy gate as the board. The
// caller next locks the process and participation, preserving board lock order.
func (s *Store) PsychometricInvitationsContext(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID, write bool) (string, error) {
	config, _, err := s.MovementContext(ctx, tx, company, actor, id)
	if err != nil {
		return "", err
	}
	if write {
		if err := requireActiveProcess(ctx, tx, id); err != nil {
			return "", err
		}
	}
	return config.Exit.ID, nil
}

// AuditPsychometricInvitation keeps the existing audit repository's validation
// and transaction invariants. No candidate data, tokens or answers enter audits.
func (s *Store) AuditPsychometricInvitation(ctx context.Context, tx pgx.Tx, actor, vacancy, participation, invitation uuid.UUID, eventType string) error {
	event := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: eventType, EntityType: "psychometric_invitation", EntityID: invitation, Metadata: map[string]string{"vacancy_id": vacancy.String(), "participation_id": participation.String()}}
	return s.audit.Append(ctx, tx, event)
}
