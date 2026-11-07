package entities

import (
	"sort"
	"strings"
	"testing"
)

// TestCatalogRegistersStakeholderTypes pins the stakeholder-metrics-v1 §1.4
// events with their categories and closed metadata keys.
func TestCatalogRegistersStakeholderTypes(t *testing.T) {
	for eventType, w := range map[string]struct {
		category Category
		keys     []string
	}{
		EventStakeholderInvitationCreated:  {CategoryMembers, []string{"expires_at", "invitation_id"}},
		EventStakeholderInvitationRevoked:  {CategoryMembers, []string{"invitation_id"}},
		EventStakeholderInvitationAccepted: {CategoryMembers, []string{"invitation_id", "member_user_id"}},
		EventMetricsDetailViewed:           {CategorySensitiveRead, []string{"report", "vacancy_id"}},
	} {
		spec, ok := LookupEvent(eventType)
		if !ok {
			t.Errorf("%s: not registered", eventType)
			continue
		}
		got := append([]string(nil), spec.MetadataKeys...)
		sort.Strings(got)
		if spec.Category != w.category || !spec.CompanyScoped || strings.Join(got, ",") != strings.Join(w.keys, ",") {
			t.Errorf("%s: %+v", eventType, spec)
		}
	}
	if EntityStakeholderInvitation != "stakeholder_invitation" {
		t.Fatal(EntityStakeholderInvitation)
	}
}
