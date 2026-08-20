package valueobjects

import (
	"errors"
	"testing"
)

// TestParseMemberRole_Valid covers the spec scenarios: "owner" and "recruiter"
// are the only accepted raw values. Anything else (e.g. "admin") MUST surface
// ErrInvalidMemberRole so the HTTP layer can map it to 400 (design error
// table: ErrInvalidMemberRole → 400).
func TestParseMemberRole_Valid(t *testing.T) {
	cases := []struct {
		raw  string
		want MemberRole
	}{
		{"owner", OwnerRole},
		{"recruiter", RecruiterRole},
	}

	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseMemberRole(tc.raw)
			if err != nil {
				t.Fatalf("expected no error for %q, got: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseMemberRole(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

// TestParseMemberRole_AdminRejected nails the spec scenario "invalid role is
// rejected": the spec's closed set is {owner, recruiter}; "admin" is the
// canonical wrong value that the design calls out as the example. The VO
// MUST refuse it before the entity or the HTTP layer ever runs.
func TestParseMemberRole_AdminRejected(t *testing.T) {
	_, err := ParseMemberRole("admin")
	if err == nil {
		t.Fatal("expected error for admin, got nil")
	}
	if !errors.Is(err, ErrInvalidMemberRole) {
		t.Errorf("expected ErrInvalidMemberRole, got: %v", err)
	}
}

// TestParseMemberRole_EmptyRejected covers the edge case "empty string is not
// a valid role". Distinct from the unknown-value test so a future refactor
// that collapses the two paths surfaces a regression here.
func TestParseMemberRole_EmptyRejected(t *testing.T) {
	_, err := ParseMemberRole("")
	if err == nil {
		t.Fatal("expected error for empty role, got nil")
	}
	if !errors.Is(err, ErrInvalidMemberRole) {
		t.Errorf("expected ErrInvalidMemberRole, got: %v", err)
	}
}

// TestMemberRole_String covers the wire-format invariant: the canonical
// lowercase textual value is what the database CHECK and the HTTP body use.
// Recruiter and Owner round-trip cleanly; UnknownRole returns the explicit
// "unknown_role" sentinel so JSON encoding never produces an empty string.
func TestMemberRole_String(t *testing.T) {
	cases := []struct {
		role MemberRole
		want string
	}{
		{RecruiterRole, "recruiter"},
		{OwnerRole, "owner"},
		{UnknownMemberRole, "unknown_role"},
	}

	for _, tc := range cases {
		t.Run(tc.want, func(t *testing.T) {
			if got := tc.role.String(); got != tc.want {
				t.Errorf("String() = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestMemberRole_OrdinalRanking nails the spec invariant
// `MemberRole` is an ordinal enum (`Unknown=0, Recruiter=1, Owner=2`) so
// `role >= minRole` implements ranking (design D + comments). This is the
// exact ordering the middleware (Phase 3) and `RequireCompanyRole(minRole)`
// will rely on — getting the iota order wrong here would silently authorize
// recruiters as owners later.
func TestMemberRole_OrdinalRanking(t *testing.T) {
	if !(OwnerRole > RecruiterRole) {
		t.Errorf("expected OwnerRole (%d) > RecruiterRole (%d)", OwnerRole, RecruiterRole)
	}
	if !(RecruiterRole > UnknownMemberRole) {
		t.Errorf("expected RecruiterRole (%d) > UnknownMemberRole (%d)", RecruiterRole, UnknownMemberRole)
	}
	if !(OwnerRole > UnknownMemberRole) {
		t.Errorf("expected OwnerRole (%d) > UnknownMemberRole (%d)", OwnerRole, UnknownMemberRole)
	}
	// Concrete ranking threshold check used by RequireCompanyRole("owner"):
	// an Owner satisfies OwnerRole>=OwnerRole AND RecruiterRole>=OwnerRole is
	// false (proves the >= operator respects the closed-set ordering).
	if !(OwnerRole >= OwnerRole) {
		t.Error("OwnerRole must satisfy OwnerRole >= OwnerRole (>= operator)")
	}
	if RecruiterRole >= OwnerRole {
		t.Error("RecruiterRole must NOT satisfy RecruiterRole >= OwnerRole (role escalation guard)")
	}
}
