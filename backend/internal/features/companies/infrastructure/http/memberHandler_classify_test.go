package http

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
)

// TestClassifyMemberError_CatalogDefinition pins the catalog adoption for every
// domain sentinel the membership use cases surface. This test runs against the
// handler's classifyMemberError and asserts the catalog Definition (Code + Status
// + Message). The handler uses stable safe message strings, NOT err.Error(), so
// wrapped sentinels return the same clean messages as direct ones.
//
// Catalog mapping (canonical spec):
//
//	ErrUnknownSubject      → CodeUnauthenticated  (401) + "unauthenticated"
//	ErrNotAMember          → CodeNotFound        (404) + "company member not found"
//	ErrMemberExists        → CodeAlreadyExists   (409) + "user already has a company membership"
//	ErrMemberNotFound      → CodeNotFound        (404) + "company member not found"
//	ErrUserNotFound        → CodeNotFound        (404) + "user not found"
//	ErrTargetNotRecruiter  → CodeInvalidRequest  (400) + "target user is not a recruiter"
//	ErrInvalidMemberRole   → CodeInvalidRequest  (400) + "invalid member role"
//	ErrCompanyNotFound     → CodeNotFound        (404) + "company not found"
//
// Anything else → CodeInternalError (500) + canonical generic message.
// Wrapped sentinel cases prove errors.Is chain resolution without wrapper leakage.
func TestClassifyMemberError_CatalogDefinition(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantCode   httpjson.Code
		wantStatus int
		wantMsg    string
	}{
		{
			name:       "ErrUnknownSubject → CodeUnauthenticated/401",
			err:        entities.ErrUnknownSubject,
			wantCode:   httpjson.CodeUnauthenticated,
			wantStatus: http.StatusUnauthorized,
			wantMsg:    "unauthenticated",
		},
		{
			name:       "ErrNotAMember → CodeNotFound/404",
			err:        entities.ErrNotAMember,
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "company member not found",
		},
		{
			name:       "ErrMemberExists → CodeAlreadyExists/409",
			err:        entities.ErrMemberExists,
			wantCode:   httpjson.CodeAlreadyExists,
			wantStatus: http.StatusConflict,
			wantMsg:    "user already has a company membership",
		},
		{
			name:       "ErrMemberNotFound → CodeNotFound/404",
			err:        entities.ErrMemberNotFound,
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "company member not found",
		},
		{
			name:       "ErrUserNotFound → CodeNotFound/404",
			err:        entities.ErrUserNotFound,
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "user not found",
		},
		{
			name:       "ErrTargetNotRecruiter → CodeInvalidRequest/400",
			err:        entities.ErrTargetNotRecruiter,
			wantCode:   httpjson.CodeInvalidRequest,
			wantStatus: http.StatusBadRequest,
			wantMsg:    "target user is not a recruiter",
		},
		{
			name:       "ErrInvalidMemberRole → CodeInvalidRequest/400",
			err:        valueobjects.ErrInvalidMemberRole,
			wantCode:   httpjson.CodeInvalidRequest,
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid member role",
		},
		{
			name:       "ErrCompanyNotFound (fallback) → CodeNotFound/404",
			err:        entities.ErrCompanyNotFound,
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "company not found",
		},
		{
			name:       "unknown error → CodeInternalError/500 + generic",
			err:        errors.New("kaboom"),
			wantCode:   httpjson.CodeInternalError,
			wantStatus: http.StatusInternalServerError,
			wantMsg:    "an internal error occurred",
		},
		{
			name:       "wrapped ErrMemberExists still resolves → CodeAlreadyExists/409",
			err:        fmt.Errorf("repo: %w", entities.ErrMemberExists),
			wantCode:   httpjson.CodeAlreadyExists,
			wantStatus: http.StatusConflict,
			wantMsg:    "user already has a company membership",
		},
		{
			name:       "wrapped ErrMemberNotFound still resolves → CodeNotFound/404",
			err:        fmt.Errorf("service: %w", entities.ErrMemberNotFound),
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "company member not found",
		},
		{
			name:       "wrapped Identity ErrUserNotFound still resolves → CodeNotFound/404",
			err:        fmt.Errorf("identity repo: %w", identityentities.ErrUserNotFound),
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "user not found",
		},
		{
			name:       "wrapped ErrTargetNotRecruiter: no wrapper prefix in message",
			err:        fmt.Errorf("repo: %w", entities.ErrTargetNotRecruiter),
			wantCode:   httpjson.CodeInvalidRequest,
			wantStatus: http.StatusBadRequest,
			wantMsg:    "target user is not a recruiter",
		},
		{
			name:       "wrapped ErrInvalidMemberRole: no wrapper prefix in message",
			err:        fmt.Errorf("service: %w", valueobjects.ErrInvalidMemberRole),
			wantCode:   httpjson.CodeInvalidRequest,
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid member role",
		},
		{
			name:       "wrapped ErrNotAMember still resolves → CodeNotFound/404",
			err:        fmt.Errorf("middleware: %w", entities.ErrNotAMember),
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "company member not found",
		},
		{
			name:       "wrapped ErrCompanyNotFound still resolves → CodeNotFound/404",
			err:        fmt.Errorf("db: %w", entities.ErrCompanyNotFound),
			wantCode:   httpjson.CodeNotFound,
			wantStatus: http.StatusNotFound,
			wantMsg:    "company not found",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := classifyMemberError(tt.err)
			if def.Code != tt.wantCode {
				t.Errorf("code: want %q, got %q", tt.wantCode, def.Code)
			}
			if def.Status != tt.wantStatus {
				t.Errorf("status: want %d, got %d", tt.wantStatus, def.Status)
			}
			if def.Message != tt.wantMsg {
				t.Errorf("message: want %q, got %q", tt.wantMsg, def.Message)
			}
		})
	}
}
