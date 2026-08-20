package entities

import (
	"errors"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

// TestNewCompanyMember_SetsIDAndTimestamps covers the spec invariant
// "the factory sets id/timestamps". The ID must be a non-zero v7 UUID, and
// both CreatedAt and UpdatedAt must be a non-zero UTC instant captured
// during the call (defensive: a future refactor that forgets to set
// UpdatedAt will surface here).
func TestNewCompanyMember_SetsIDAndTimestamps(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()

	before := time.Now().UTC()
	m, err := NewCompanyMember(userID, companyID, valueobjects.OwnerRole)
	after := time.Now().UTC()

	if err != nil {
		t.Fatalf("expected no error for valid inputs, got: %v", err)
	}
	if m == nil {
		t.Fatal("expected non-nil member")
	}
	if m.ID == uuid.Nil {
		t.Error("expected non-zero ID")
	}
	if m.UserID != userID {
		t.Errorf("UserID: want %v, got %v", userID, m.UserID)
	}
	if m.CompanyID != companyID {
		t.Errorf("CompanyID: want %v, got %v", companyID, m.CompanyID)
	}
	if m.Role != valueobjects.OwnerRole {
		t.Errorf("Role: want OwnerRole, got %v", m.Role)
	}
	if m.CreatedAt.IsZero() {
		t.Error("expected non-zero CreatedAt")
	}
	if m.UpdatedAt.IsZero() {
		t.Error("expected non-zero UpdatedAt")
	}
	if m.CreatedAt.Location() != time.UTC {
		t.Errorf("CreatedAt must be UTC, got %v", m.CreatedAt.Location())
	}
	if m.UpdatedAt.Location() != time.UTC {
		t.Errorf("UpdatedAt must be UTC, got %v", m.UpdatedAt.Location())
	}
	// Generous window to avoid CI flake, while still proving the timestamp
	// was captured during the call (not hard-coded).
	if m.CreatedAt.Before(before.Add(-time.Second)) || m.CreatedAt.After(after.Add(time.Second)) {
		t.Errorf("CreatedAt %v out of expected window around %v", m.CreatedAt, before)
	}
}

// TestNewCompanyMember_UnknownRoleRejected covers the spec scenario
// "invalid role is rejected". The factory MUST refuse the zero-value role
// before it ever reaches the repository — the role enum's whole point is to
// make illegal states unrepresentable, and an UnknownMemberRole in a
// persisted row would silently fail the DB CHECK constraint.
func TestNewCompanyMember_UnknownRoleRejected(t *testing.T) {
	_, err := NewCompanyMember(uuid.New(), uuid.New(), valueobjects.UnknownMemberRole)
	if err == nil {
		t.Fatal("expected ErrInvalidMemberRole, got nil")
	}
	if !errors.Is(err, valueobjects.ErrInvalidMemberRole) {
		t.Errorf("expected ErrInvalidMemberRole, got: %v", err)
	}
}

// TestNewCompanyMember_RecruiterRoleAccepted is the triangulation companion
// to TestNewCompanyMember_UnknownRoleRejected: a non-owner but still valid
// role MUST be accepted and stored verbatim, so the role escalation guard
// (OwnerRole > RecruiterRole) is the only thing differentiating the two —
// not a hidden validation gate.
func TestNewCompanyMember_RecruiterRoleAccepted(t *testing.T) {
	userID := uuid.New()
	companyID := uuid.New()

	m, err := NewCompanyMember(userID, companyID, valueobjects.RecruiterRole)
	if err != nil {
		t.Fatalf("expected no error for RecruiterRole, got: %v", err)
	}
	if m.Role != valueobjects.RecruiterRole {
		t.Errorf("Role: want RecruiterRole, got %v", m.Role)
	}
}
