package domain

import (
	"testing"

	"github.com/google/uuid"
)

// notifications-v2 D10: exactly the three grouped types coalesce; every other
// type (all mandatory ones included) is sent immediately.
func TestCoalescedIsExactlyTheThreeGroupedTypes(t *testing.T) {
	want := map[Type]bool{TypeApplicationReceived: true, TypePsychometricCompleted: true, TypePsychometricPending: true}
	for _, s := range Types() {
		if got := Coalesced(s.Type); got != want[s.Type] {
			t.Errorf("%s: coalesced=%v want %v", s.Type, got, want[s.Type])
		}
	}
	if Coalesced(Type("unknown")) {
		t.Error("unknown type coalesced")
	}
}

// notifications-v2 D9 (matrix part that needs no database): an email set
// resolves the email channel — operational member types off by default,
// candidate types on by default (Q1), mandatory always on even facing a row.
func TestEmailOverridesResolveTheEmailChannel(t *testing.T) {
	user, company := uuid.New(), uuid.New()
	o := NewOverrides(ChannelEmail)
	cases := []struct {
		name string
		key  PreferenceKey
		want bool
	}{
		{"member operational default off", PreferenceKey{user, company, TypeApplicationReceived}, false},
		{"candidate default on", PreferenceKey{user, uuid.Nil, TypeCandidateTestPending}, true},
		{"mandatory on", PreferenceKey{user, company, TypeVacancyAssigned}, true},
	}
	for _, c := range cases {
		if got := o.Effective(c.key); got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
	o.Set(PreferenceKey{user, company, TypeApplicationReceived}, true)
	o.Set(PreferenceKey{user, uuid.Nil, TypeCandidateTestPending}, false)
	o.Set(PreferenceKey{user, company, TypeVacancyAssigned}, false)
	for _, c := range []struct {
		key  PreferenceKey
		want bool
	}{{PreferenceKey{user, company, TypeApplicationReceived}, true}, {PreferenceKey{user, uuid.Nil, TypeCandidateTestPending}, false},
		{PreferenceKey{user, company, TypeVacancyAssigned}, true}, {PreferenceKey{user, uuid.New(), TypeApplicationReceived}, false}} {
		if got := o.Effective(c.key); got != c.want {
			t.Errorf("%+v: got %v want %v", c.key, got, c.want)
		}
	}
}
