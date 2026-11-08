package repositories

import (
	"context"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/google/uuid"
)

// StakeholderInvitationRepository persists stakeholder invitations
// (stakeholder-metrics-v1 §1.3). Every write commits with its audit event.
type StakeholderInvitationRepository interface {
	// Create stores the invitation unless the company already has limit
	// pending ones (entities.ErrInvitationLimitReached).
	Create(ctx context.Context, invitation entities.StakeholderInvitation, tokenHash []byte, limit int) error
	// ListPending returns the company's pending invitations at now, newest first.
	ListPending(ctx context.Context, companyID uuid.UUID, now time.Time) ([]entities.StakeholderInvitation, error)
	// Revoke revokes a pending invitation of the company; anything else is a
	// no-op without error (idempotent).
	Revoke(ctx context.Context, companyID, actor, id uuid.UUID, now time.Time) error
	// Accept turns the invitation into a stakeholder membership of userID, or
	// recognizes the replay of an accept by the same user.
	Accept(ctx context.Context, userID uuid.UUID, tokenHash []byte, now time.Time) (entities.StakeholderAcceptance, error)
}
