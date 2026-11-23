package draftstore

import (
	"testing"
)

func ptr[T any](v T) *T { return &v }

// The kind and the visibility of a stakeholder row are the lifecycle's (and the job-drafts list's): a replacement is a row of
// vacancy_replacements, visibility is null until the first publication, public for an original, and private only for a
// replacement without a public projection.
func TestStakeholderKindVisibility(t *testing.T) {
	for _, tc := range []struct {
		name          string
		sequence      *int32
		status        *string
		hasProjection bool
		kind          string
		visibility    *string
	}{
		{"never published original", nil, nil, false, "original", nil},
		{"never published replacement", ptr(int32(1)), nil, false, "replacement", nil},
		{"published original", nil, ptr("published"), true, "original", ptr("public")},
		{"original without projection is still public", nil, ptr("published"), false, "original", ptr("public")},
		{"closed original", nil, ptr("closed"), true, "original", ptr("public")},
		{"private replacement", ptr(int32(2)), ptr("published"), false, "replacement", ptr("private")},
		{"public replacement", ptr(int32(2)), ptr("paused"), true, "replacement", ptr("public")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			kind, visibility := stakeholderKindVisibility(tc.sequence, tc.status, tc.hasProjection)
			if kind != tc.kind {
				t.Fatalf("kind = %q, want %q", kind, tc.kind)
			}
			switch {
			case visibility == nil && tc.visibility == nil:
			case visibility == nil || tc.visibility == nil || *visibility != *tc.visibility:
				t.Fatalf("visibility = %v, want %v", visibility, tc.visibility)
			}
		})
	}
}

// Only the owner and the stakeholder read this list: a recruiter (or anything else) is refused by the store as well.
func TestStakeholderReaderRoles(t *testing.T) {
	for role, want := range map[string]bool{roleOwner: true, roleStakeholder: true, "recruiter": false, "": false, "candidate": false} {
		if got := stakeholderMayRead(role); got != want {
			t.Fatalf("role %q: %v, want %v", role, got, want)
		}
	}
}
