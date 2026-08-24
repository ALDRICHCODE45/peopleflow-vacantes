// Package entities holds the companies bounded-context domain entities.
package entities

import "github.com/google/uuid"

// MemberListRow is the read-model projection for GET /me/company/members: a
// membership row enriched with its user's public identity (id, full_name,
// email). It is NOT the CompanyMember aggregate — it only exists to carry the
// list endpoint's response shape, so the aggregate stays free of read-side
// concerns.
//
// User is nil when the member's user can't be resolved (soft-deleted or
// otherwise missing); the HTTP layer renders `user: null` in that case rather
// than dropping the row.
type MemberListRow struct {
	ID        uuid.UUID
	CompanyID uuid.UUID
	Role      string
	CreatedAt string
	UpdatedAt string

	// User is nil when the LEFT JOIN found no live users row.
	User *MemberUser
}

// MemberUser is the public identity of a member's user. It intentionally
// omits cognito_sub (auth-sensitive) and user_type (already validated on the
// write path); the list endpoint only needs identity for display.
type MemberUser struct {
	ID       uuid.UUID
	FullName string
	Email    string
}
