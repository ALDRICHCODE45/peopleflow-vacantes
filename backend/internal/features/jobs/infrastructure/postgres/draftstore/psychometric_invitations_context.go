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

// PsychometricStageCurrent reads without acquiring any parent locks. Stage-entry
// callers already hold draft/process ownership; acquiring them here would invert
// the manual-send lock order.
func (s *Store) PsychometricStageCurrent(ctx context.Context, tx pgx.Tx, id, stage uuid.UUID) (bool, error) {
	stages, err := checklistStages(ctx, tx, id)
	if err != nil {
		return false, err
	}
	for _, current := range stages {
		if current == stage.String() {
			return true, nil
		}
	}
	return false, nil
}

// AuditPsychometricInvitation keeps the existing audit repository's validation
// and transaction invariants. No candidate data, tokens or answers enter audits.
func (s *Store) AuditPsychometricInvitation(ctx context.Context, tx pgx.Tx, actor, vacancy, participation, invitation uuid.UUID, eventType string) error {
	return s.auditPsychometricInvitation(ctx, tx, actor, vacancy, participation, invitation, eventType, nil)
}

// AuditPsychometricComparison uses the same append/validation boundary as every
// other invitation audit, with only the immutable comparison authority added.
func (s *Store) AuditPsychometricComparison(ctx context.Context, tx pgx.Tx, actor, vacancy, participation, invitation, comparison uuid.UUID, version string) error {
	return s.auditPsychometricInvitation(ctx, tx, actor, vacancy, participation, invitation, "PsychometricComparisonCreated", map[string]string{"comparison_id": comparison.String(), "profile_version": version})
}

func (s *Store) auditPsychometricInvitation(ctx context.Context, tx pgx.Tx, actor, vacancy, participation, invitation uuid.UUID, eventType string, extra map[string]string) error {
	metadata := map[string]string{"vacancy_id": vacancy.String(), "participation_id": participation.String()}
	for key, value := range extra {
		metadata[key] = value
	}
	event := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: eventType, EntityType: "psychometric_invitation", EntityID: invitation, Metadata: metadata}
	if actor == uuid.Nil {
		event.ActorType = audit.ActorTypeSystem
		event.ActorID = nil
	}
	return s.audit.Append(ctx, tx, event)
}
