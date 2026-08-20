// Package entities holds the companies bounded-context domain entities.
// CompanyMember is the aggregate root of the company_membership subdomain
// (ROADMAP §3.5): one row per user_id, scoped to a single company, with a
// closed-set role (MemberRole). Membership is resolved per request from
// the JWT subject and never persisted in the token.
package entities

import (
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// Sentinel errors for the company_membership subdomain. Each maps to
// exactly one HTTP status in the design error table; the dispatch is a flat
// errors.Is chain so callers don't have to inspect error messages.
var (
	// ErrUnknownSubject is returned when the JWT `sub` does not match any
	// live users.cognito_sub row. The HTTP layer maps this to 401 per the
	// spec scenarios "unknown sub is 401" (GetMyMembership /
	// RequireCompanyRole).
	ErrUnknownSubject = errors.New("unknown JWT subject")
	// ErrNotAMember is returned when the resolved user has no
	// company_members row. GetMyMembership maps this to 404 (the caller
	// isn't a member of any company); RequireCompanyRole maps this to 403
	// (the route requires membership and the caller has none).
	ErrNotAMember = errors.New("user is not a member of any company")
	// ErrMemberExists is returned when AddMember tries to add a user who
	// already has a membership. The HTTP layer maps this to 409 per the
	// spec scenario "duplicate user is rejected" (driven by the DB
	// SQLSTATE 23505 → ErrMemberExists mapping in the postgres adapter).
	ErrMemberExists = errors.New("user already has a company membership")
	// ErrMemberNotFound is returned when UpdateRole or RemoveMember target
	// a member that doesn't exist OR belongs to a different company than
	// the caller's. The HTTP layer maps this to 404 (the cross-company
	// target scenario intentionally hides the existence of the foreign
	// row — design D7 / spec scenario "cross-company target is rejected").
	ErrMemberNotFound = errors.New("company member not found")
	// ErrUserNotFound is returned by AddMember when the target user_id
	// does not match any live users row (FK violation 23503). The HTTP
	// layer maps this to 404.
	ErrUserNotFound = errors.New("user not found")
)

// CompanyMember is one user's membership in one company. The aggregate root
// is keyed by ID (UUID v7); the DB enforces a UNIQUE(user_id) constraint so a
// user can belong to at most one company. Role is the ordinal enum that
// drives `RequireCompanyRole(minRole)` in the identity slice.
type CompanyMember struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	CompanyID uuid.UUID
	Role      valueobjects.MemberRole

	CreatedAt time.Time
	UpdatedAt time.Time
}

// NewCompanyMember builds a CompanyMember in its initial, publishable state.
// It validates the role against the closed set (refusing UnknownMemberRole,
// which would silently fail the DB CHECK constraint) and assigns the ID
// plus UTC timestamps. The use case owns which (user_id, company_id) pair
// gets passed in — the factory does not police those because the FK
// constraint will catch a missing user / company at persistence time and
// the adapter maps it to a richer sentinel (ErrUserNotFound).
func NewCompanyMember(userID, companyID uuid.UUID, role valueobjects.MemberRole) (*CompanyMember, error) {
	if role == valueobjects.UnknownMemberRole {
		return nil, valueobjects.ErrInvalidMemberRole
	}

	id, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	return &CompanyMember{
		ID:        id,
		UserID:    userID,
		CompanyID: companyID,
		Role:      role,
		CreatedAt: now,
		UpdatedAt: now,
	}, nil
}
