package http

import (
	"errors"
	"fmt"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
)

// TestClassifyMemberError_MappingTable locks the design error table to a
// table-driven test so a future change that flips a sentinel's status
// surfaces as a red build, not a 5xx leaking to clients.
//
// The dispatch is a flat errors.Is chain per the existing handler pattern
// (companies/infrastructure/http/handler.go::classifyCreateCompanyError)
// — no special-cased branches.
//
// Status mapping (design error table):
//
//	ErrUnknownSubject      → 401
//	ErrNotAMember          → 404  (handler's GetMyMembership view of the
//	                              sentinel; RequireCompanyRole maps this
//	                              to 403 inside the identity middleware)
//	ErrMemberExists        → 409
//	ErrMemberNotFound      → 404
//	ErrUserNotFound        → 404
//	ErrInvalidMemberRole   → 400
//
// Anything else falls through to 500 (the real error is logged
// separately and the caller gets a generic message).
func TestClassifyMemberError_MappingTable(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode int
		wantMsg  string // empty == no assertion on message
	}{
		{
			name:     "ErrUnknownSubject maps to 401 unauthorized",
			err:      entities.ErrUnknownSubject,
			wantCode: 401,
			wantMsg:  "unauthorized",
		},
		{
			name:     "ErrNotAMember maps to 404 not found",
			err:      entities.ErrNotAMember,
			wantCode: 404,
			wantMsg:  "company member not found",
		},
		{
			name:     "ErrMemberExists maps to 409 conflict",
			err:      entities.ErrMemberExists,
			wantCode: 409,
			wantMsg:  "user already has a company membership",
		},
		{
			name:     "ErrMemberNotFound maps to 404 not found",
			err:      entities.ErrMemberNotFound,
			wantCode: 404,
			wantMsg:  "company member not found",
		},
		{
			name:     "ErrUserNotFound maps to 404 not found",
			err:      entities.ErrUserNotFound,
			wantCode: 404,
			wantMsg:  "user not found",
		},
		{
			name:     "ErrInvalidMemberRole maps to 400 bad request",
			err:      valueobjects.ErrInvalidMemberRole,
			wantCode: 400,
			wantMsg:  "invalid member role",
		},
		{
			name:     "unknown error falls through to 500",
			err:      errors.New("kaboom"),
			wantCode: 500,
			wantMsg:  "internal server error",
		},
		{
			name:     "wrapped sentinel still resolves (ErrMemberExists)",
			err:      fmt.Errorf("repo: %w", entities.ErrMemberExists),
			wantCode: 409,
			wantMsg:  "user already has a company membership",
		},
		{
			name:     "wrapped sentinel still resolves (ErrMemberNotFound)",
			err:      fmt.Errorf("service: %w", entities.ErrMemberNotFound),
			wantCode: 404,
			wantMsg:  "company member not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, msg := classifyMemberError(tt.err)
			if code != tt.wantCode {
				t.Errorf("status: want %d, got %d", tt.wantCode, code)
			}
			if tt.wantMsg != "" && msg != tt.wantMsg {
				t.Errorf("message: want %q, got %q", tt.wantMsg, msg)
			}
		})
	}
}
