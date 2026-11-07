package valueobjects

import "testing"

// The stakeholder role (stakeholder-metrics-v1 §1.1) parses and prints like the
// other roles, but it stands outside the recruiter < owner ladder.
func TestParseMemberRole_Stakeholder(t *testing.T) {
	for _, raw := range []string{"stakeholder", " Stakeholder "} {
		got, err := ParseMemberRole(raw)
		if err != nil || got != StakeholderRole {
			t.Fatalf("ParseMemberRole(%q) = %v, %v; want StakeholderRole", raw, got, err)
		}
	}
	if StakeholderRole.String() != "stakeholder" {
		t.Fatalf("String() = %q", StakeholderRole.String())
	}
}

// TestMemberRole_AtLeast pins the gate rule (§1.2): owner and recruiter keep
// their ordering, and stakeholder or unknown never satisfies a ladder gate.
func TestMemberRole_AtLeast(t *testing.T) {
	for _, tc := range []struct {
		role, min MemberRole
		want      bool
	}{
		{OwnerRole, RecruiterRole, true},
		{OwnerRole, OwnerRole, true},
		{RecruiterRole, RecruiterRole, true},
		{RecruiterRole, OwnerRole, false},
		{StakeholderRole, RecruiterRole, false},
		{StakeholderRole, OwnerRole, false},
		{StakeholderRole, StakeholderRole, false},
		{OwnerRole, StakeholderRole, false},
		{UnknownMemberRole, RecruiterRole, false},
		{RecruiterRole, UnknownMemberRole, false},
	} {
		if got := tc.role.AtLeast(tc.min); got != tc.want {
			t.Errorf("%v.AtLeast(%v) = %v, want %v", tc.role, tc.min, got, tc.want)
		}
	}
}
