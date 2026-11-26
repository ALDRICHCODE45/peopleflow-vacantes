package preferences

import (
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

// The catalog of each tree is that tree's rows of the domain type table, in
// table order, with both channels (D3); defaults and locks come from the
// domain, overrides only change enabled and never a locked pair.
func TestBuildCatalogPerTree(t *testing.T) {
	member := Build(domain.RecipientMember, nil, true)
	candidate := Build(domain.RecipientCandidate, nil, false)
	if len(member.Items) != 11 || len(candidate.Items) != 3 {
		t.Fatalf("items member=%d candidate=%d, want 11/3", len(member.Items), len(candidate.Items))
	}
	var wantMember, wantCandidate []domain.Type
	for _, s := range domain.Types() {
		if s.RecipientKind == domain.RecipientMember {
			wantMember = append(wantMember, s.Type)
		} else {
			wantCandidate = append(wantCandidate, s.Type)
		}
	}
	for i, it := range member.Items {
		if it.Type != wantMember[i] {
			t.Fatalf("member item %d = %s, want %s", i, it.Type, wantMember[i])
		}
	}
	for i, it := range candidate.Items {
		if it.Type != wantCandidate[i] {
			t.Fatalf("candidate item %d = %s, want %s", i, it.Type, wantCandidate[i])
		}
		if s := it.Channels[domain.ChannelEmail]; !s.Default || !s.Enabled || s.MandatoryLocked {
			t.Fatalf("candidate %s email = %+v, want default on, unlocked (Q1)", it.Type, s)
		}
	}
	if !member.EmailDeliverable || candidate.EmailDeliverable {
		t.Fatal("email_deliverable not carried")
	}
	for _, it := range member.Items {
		locked := it.Kind == domain.KindMandatory
		for _, ch := range domain.Channels() {
			s, ok := it.Channels[ch]
			wantDefault := ch == domain.ChannelInApp || locked
			if !ok || s.MandatoryLocked != locked || s.Default != wantDefault || s.Enabled != wantDefault {
				t.Fatalf("member %s %s = %+v (present %v)", it.Type, ch, s, ok)
			}
		}
		if len(it.Channels) != len(domain.Channels()) {
			t.Fatalf("%s channels = %d", it.Type, len(it.Channels))
		}
	}
}

func TestBuildCatalogAppliesOverridesExceptLocked(t *testing.T) {
	c := Build(domain.RecipientMember, map[Pair]bool{
		{domain.TypeApplicationReceived, domain.ChannelEmail}:  true,
		{domain.TypePsychometricPending, domain.ChannelInApp}:  false,
		{domain.TypeDeliveryOverdue, domain.ChannelEmail}:      false, // impossible row: ignored
		{domain.TypeCandidateTestPending, domain.ChannelEmail}: false, // other tree: ignored
	}, true)
	got := map[Pair]ChannelState{}
	for _, it := range c.Items {
		for ch, s := range it.Channels {
			got[Pair{it.Type, ch}] = s
		}
	}
	for pair, want := range map[Pair]ChannelState{
		{domain.TypeApplicationReceived, domain.ChannelEmail}: {Default: false, Enabled: true},
		{domain.TypePsychometricPending, domain.ChannelInApp}: {Default: true, Enabled: false},
		{domain.TypeDeliveryOverdue, domain.ChannelEmail}:     {Default: true, Enabled: true, MandatoryLocked: true},
		{domain.TypeDeliveryDueSoon, domain.ChannelEmail}:     {Default: false, Enabled: false},
	} {
		if got[pair] != want {
			t.Errorf("%v = %+v, want %+v", pair, got[pair], want)
		}
	}
}

func TestCatalogWireShape(t *testing.T) {
	raw, err := json.Marshal(Build(domain.RecipientCandidate, nil, true))
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"channels":["in_app","email"],"email_deliverable":true,"items":[` +
		`{"type":"candidate_status_changed","kind":"operational","channels":{"email":{"default":true,"enabled":true,"mandatory_locked":false},"in_app":{"default":true,"enabled":true,"mandatory_locked":false}}},` +
		`{"type":"candidate_message_received","kind":"operational","channels":{"email":{"default":true,"enabled":true,"mandatory_locked":false},"in_app":{"default":true,"enabled":true,"mandatory_locked":false}}},` +
		`{"type":"candidate_test_pending","kind":"operational","channels":{"email":{"default":true,"enabled":true,"mandatory_locked":false},"in_app":{"default":true,"enabled":true,"mandatory_locked":false}}}]}`
	if string(raw) != want {
		t.Fatalf("wire =\n%s\nwant\n%s", raw, want)
	}
}
