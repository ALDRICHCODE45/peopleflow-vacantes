package dtos

import "github.com/google/uuid"

// AddMemberDto is the POST /me/company/members body. CompanyID is the body
// field the spec calls out as ignored (scenario "body company_id is
// ignored"): the service MUST always resolve the company from the caller's
// membership row, never from this field. Carrying it on the DTO is a
// documentation device — the field exists in some clients' OpenAPI
// schemas, but the use case never reads it.
type AddMemberDto struct {
	UserID uuid.UUID

	// Role is the raw string the service validates through
	// valueobjects.ParseMemberRole. Empty / "admin" / etc. surface as
	// valueobjects.ErrInvalidMemberRole → HTTP 400.
	Role string

	// CompanyID is the body's company_id and is INTENTIONALLY ignored
	// by the use case. The field is kept on the DTO so the spec scenario
	// "body company_id is ignored" can be tested against an actual
	// payload carrying it (otherwise the test would merely prove the
	// DTO doesn't expose the field, not that the service ignores it).
	CompanyID *uuid.UUID
}

// UpdateMemberRoleDto is the PATCH /me/company/members/{id} body. The target
// member id comes from the URL path (never the body); only the role is
// patchable, and it is validated through the same VO as AddMember.
type UpdateMemberRoleDto struct {
	Role string
}
