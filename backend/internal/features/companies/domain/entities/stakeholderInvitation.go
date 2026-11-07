package entities

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Stakeholder invitation sentinels (stakeholder-metrics-v1 §1.3). The HTTP
// layer maps each to its catalog code.
var (
	// ErrInvitationInvalid covers unknown, expired and revoked tokens, a token
	// used by another user and one whose membership was removed: one answer.
	ErrInvitationInvalid = errors.New("invitation is invalid or expired")
	// ErrInvitationLimitReached: the company already has the maximum pending.
	ErrInvitationLimitReached = errors.New("too many pending invitations")
	// ErrCandidateAccount: a candidate account cannot join a company.
	ErrCandidateAccount = errors.New("candidate accounts cannot join a company")
	// ErrAlreadyCompanyMember: the caller belongs to a company already.
	ErrAlreadyCompanyMember = errors.New("user already belongs to a company")
	// ErrStakeholderRoleChange: PATCH never converts to or from stakeholder (D5).
	ErrStakeholderRoleChange = errors.New("stakeholder role changes are not supported")
)

// StakeholderInvitation is one pending invitation as the owner lists it; the
// token never leaves the create response.
type StakeholderInvitation struct {
	ID        uuid.UUID
	CompanyID uuid.UUID
	CreatedBy uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
}

// StakeholderAcceptance is the membership an accept created (or a replay found).
type StakeholderAcceptance struct {
	CompanyID uuid.UUID
	MemberID  uuid.UUID
}
