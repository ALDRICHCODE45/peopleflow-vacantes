package draftstore

import (
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
)

// The documents read gate (placement-vacancy-documents-v1 D4, D6): owner, active team
// member, or any stakeholder of the session company. Manage stays the draft rule
// (`authorized`): owner or active tramo, and never a stakeholder.
func TestDocumentGate(t *testing.T) {
	actor := uuid.New()
	for _, tc := range []struct {
		name       string
		role       string
		tramo      bool
		read, edit bool
	}{
		{"owner without a tramo", roleOwner, false, true, true},
		{"owner with a tramo", roleOwner, true, true, true},
		{"recruiter on the team", "recruiter", true, true, true},
		{"recruiter never or no longer on the team", "recruiter", false, false, false},
		// A stakeholder reads every vacancy of the company, drafts included, and never writes.
		{"stakeholder", roleStakeholder, false, true, false},
		{"stakeholder holding a stale active tramo", roleStakeholder, true, true, false},
		{"unknown role without a tramo", "", false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			auth, record := authContext{role: tc.role}, draftRecord{activeTeamMember: tc.tramo}
			if got := authorizedRead(auth, actor, record); got != tc.read {
				t.Errorf("authorizedRead = %v, want %v", got, tc.read)
			}
			if got := authorizedManage(auth, actor, record); got != tc.edit {
				t.Errorf("authorizedManage = %v, want %v", got, tc.edit)
			}
			// Whoever manages reads: the read gate is a superset of the draft rule.
			if authorized(auth, actor, record) && !authorizedRead(auth, actor, record) {
				t.Error("authorized must imply authorizedRead")
			}
		})
	}
}

// The manage decision (D4): after the read gate and the schema gate, a caller who can read but not manage is a
// stakeholder (403 forbidden by the contract: the recruiter ladder refuses them on every write route). Everyone
// else was already denied by the read gate with not_found/team_access_ended.
func TestDocumentManageDecision(t *testing.T) {
	actor := uuid.New()
	for _, tc := range []struct {
		name    string
		role    string
		tramo   bool
		wantErr error
	}{
		{"owner", roleOwner, false, nil},
		{"recruiter on the team", "recruiter", true, nil},
		{"stakeholder", roleStakeholder, false, drafts.ErrForbidden},
		{"stakeholder holding a stale tramo", roleStakeholder, true, drafts.ErrForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := documentManageDecision(authContext{role: tc.role}, actor, draftRecord{activeTeamMember: tc.tramo})
			if !errors.Is(got, tc.wantErr) || (tc.wantErr == nil && got != nil) {
				t.Fatalf("decision = %v, want %v", got, tc.wantErr)
			}
		})
	}
}

// The idempotency operation of the upload (D26) is pinned: changing it would orphan every stored key.
func TestDocumentUploadOperation(t *testing.T) {
	if DocumentUploadOperation != "placement-document-upload:r1" {
		t.Fatalf("operation = %q", DocumentUploadOperation)
	}
}
