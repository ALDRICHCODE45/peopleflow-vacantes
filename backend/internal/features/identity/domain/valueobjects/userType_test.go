package valueobjects

import (
	"errors"
	"testing"
)

func TestNewUserType_AcceptsCandidates(t *testing.T) {
	got, err := NewUserType("candidate")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got != UserCandidate {
		t.Errorf("expected UserCandidate, got: %v", got)
	}
}

func TestNewUserType_AcceptsRecruiters(t *testing.T) {
	got, err := NewUserType("recruiter")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if got != UserRecruiter {
		t.Errorf("expected UserRecruiter, got: %v", got)
	}
}

func TestNewUserType_RejectsUnknown(t *testing.T) {
	_, err := NewUserType("admin")
	if err == nil {
		t.Fatal("expected ErrInvalidUserType for \"admin\", got nil")
	}
	if !errors.Is(err, ErrInvalidUserType) {
		t.Errorf("expected ErrInvalidUserType, got: %v", err)
	}
}

func TestNewUserType_RejectsEmpty(t *testing.T) {
	_, err := NewUserType("")
	if err == nil {
		t.Fatal("expected ErrInvalidUserType for empty string, got nil")
	}
	if !errors.Is(err, ErrInvalidUserType) {
		t.Errorf("expected ErrInvalidUserType, got: %v", err)
	}
}

// TestUserType_String covers the wire-format mapping for both constants.
// The DB CHECK constraint and the Cognito group mapping both rely on these
// exact lowercase strings.
func TestUserType_String(t *testing.T) {
	cases := []struct {
		input UserType
		want  string
	}{
		{UserCandidate, "candidate"},
		{UserRecruiter, "recruiter"},
	}
	for _, tc := range cases {
		t.Run(tc.want, func(t *testing.T) {
			if got := tc.input.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}
