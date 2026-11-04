// Package repositories defines the persistence ports for the companies context.
package repositories

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// CompanyMemberRepository is the persistence port for the company_membership
// subdomain. It mirrors the design Interfaces section (D7 same-company
// guard encoded in the Update/Remove signatures) so the postgres adapter
// can implement it without leaking SQLSTATE codes into the application
// layer; the adapter owns the constraint-violation → sentinel mapping.
//
// Membership resolution (sub → users.id → company_members) lives in the
// application service, not on this port: GetMembershipByUserID takes a
// users.id because by the time the call site has resolved the JWT subject,
// the raw `sub` string has already been discarded.
type CompanyMemberRepository interface {
	// Create persists a new member row. The adapter MUST map
	// SQLSTATE 23505 → entities.ErrMemberExists and 23503 on user_id →
	// entities.ErrUserNotFound so the HTTP layer can produce 409 / 404
	// instead of leaking 500s. actor is the user adding the member; the
	// CompanyMemberAdded audit event commits in the same transaction
	// (audit-log-v1 §5), so an audit failure leaves no member behind.
	Create(ctx context.Context, actor uuid.UUID, m *entities.CompanyMember) error

	// GetMembershipByUserID returns the user's single membership row, or
	// entities.ErrNotAMember when no row exists. The DB enforces
	// UNIQUE(user_id) so the caller can assume at most one result.
	GetMembershipByUserID(ctx context.Context, userID uuid.UUID) (*entities.CompanyMember, error)

	// ListByCompanyID returns every member of the given company, enriched with
	// the member's user identity (id, full_name, email). Each row's User is nil
	// when the member's user can't be resolved (deleted/missing). Empty result
	// is a non-nil empty slice. Order is adapter-defined; the postgres adapter
	// returns ORDER BY created_at ASC, id ASC for stable rendering.
	ListByCompanyID(ctx context.Context, companyID uuid.UUID) ([]entities.MemberListRow, error)

	// UpdateRole replaces the target member's role. The (id, companyID)
	// pair is the same-company guard (design D7): cross-company targets
	// affect 0 rows and surface as entities.ErrMemberNotFound. The
	// adapter MUST touch `updated_at` so callers never have to remember.
	// Atomically rejects demoting the final owner with entities.ErrLastOwner;
	// same-company/not-found validation takes precedence. actor is the user
	// changing the role; a CompanyMemberRoleChanged event commits in the same
	// transaction when the role actually changes (none when it stays the same).
	UpdateRole(ctx context.Context, actor, id, companyID uuid.UUID, role valueobjects.MemberRole) error

	// Remove hard-deletes the row (design D2: no soft-delete). The
	// (id, companyID) pair is the same-company guard: cross-company
	// targets affect 0 rows and surface as entities.ErrMemberNotFound.
	// HARD DELETE frees `user_id` for re-assignment. Atomically rejects
	// removing the final owner with entities.ErrLastOwner, after the scope check.
	// actor is the user removing the member; CompanyMemberOffboarded commits in
	// the same transaction.
	Remove(ctx context.Context, actor, id, companyID uuid.UUID) error
}
