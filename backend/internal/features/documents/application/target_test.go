package documents

import (
	"testing"

	"github.com/google/uuid"
)

func TestTargetKind(t *testing.T) {
	draft, pid := uuid.New(), uuid.New()
	v := VacancyTarget(draft)
	if v.Kind() != ScopeVacancy || v.DraftID != draft || v.ParticipationID != nil {
		t.Fatalf("vacancy target %+v", v)
	}
	p := ParticipationTarget(draft, pid)
	if p.Kind() != ScopeParticipation || p.DraftID != draft || p.ParticipationID == nil || *p.ParticipationID != pid {
		t.Fatalf("participation target %+v", p)
	}
}

// D15: 50 per vacancy, 20 per participation; the scope object carries the limit of its own scope.
func TestScopeLimitFollowsTheTargetKind(t *testing.T) {
	for kind, want := range map[ScopeKind]int{ScopeVacancy: 50, ScopeParticipation: 20} {
		if got := MaxDocuments(kind); got != want {
			t.Fatalf("%s: %d", kind, got)
		}
		scope := BuildScope(ScopeInput{Kind: kind, CanManage: true, Documents: want - 1})
		if scope.Limits.MaxDocuments != want || len(scope.AllowedActions) != 1 || scope.AllowedActions[0] != ActionUpload {
			t.Fatalf("%s one below the limit: %+v", kind, scope)
		}
		full := BuildScope(ScopeInput{Kind: kind, CanManage: true, Documents: want - 3, Links: 3})
		if full.UploadBlockedReason == nil || *full.UploadBlockedReason != BlockedLimitReached || len(full.AllowedActions) != 0 {
			t.Fatalf("%s at the limit (files plus links): %+v", kind, full)
		}
	}
}
