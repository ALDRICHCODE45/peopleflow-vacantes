package domain

import (
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// notifications-v2 D6/D7 (E3): the creation-time in_app value comes from the
// override row of exactly (user, company-or-NULL, type) in the channel, else
// the default; a mandatory type is always on, even facing an (impossible) row.
func TestOverridesEffective(t *testing.T) {
	user, other, company, otherCompany := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	o := NewOverrides(ChannelInApp)
	o.Set(PreferenceKey{User: user, Company: company, Type: TypeApplicationReceived}, false)
	o.Set(PreferenceKey{User: user, Company: otherCompany, Type: TypePsychometricPending}, false)
	o.Set(PreferenceKey{User: user, Type: TypeCandidateTestPending}, false) // candidate tree: company NULL
	o.Set(PreferenceKey{User: user, Company: company, Type: TypeVacancyReassigned}, false)
	o.Set(PreferenceKey{User: user, Company: company, Type: TypeDeliveryOverdue}, false)
	o.Set(PreferenceKey{User: other, Company: company, Type: TypeDeliveryDueSoon}, true)

	cases := []struct {
		name string
		key  PreferenceKey
		want bool
	}{
		{"own override off", PreferenceKey{user, company, TypeApplicationReceived}, false},
		{"other user: default", PreferenceKey{other, company, TypeApplicationReceived}, true},
		{"override of another company does not apply", PreferenceKey{user, company, TypePsychometricPending}, true},
		{"override of that company applies there", PreferenceKey{user, otherCompany, TypePsychometricPending}, false},
		{"candidate override keyed by NULL company", PreferenceKey{user, uuid.Nil, TypeCandidateTestPending}, false},
		{"candidate type under a company key: no row", PreferenceKey{user, company, TypeCandidateTestPending}, true},
		{"mandatory ignores an override", PreferenceKey{user, company, TypeVacancyReassigned}, true},
		{"mandatory scheduled ignores an override", PreferenceKey{user, company, TypeDeliveryOverdue}, true},
		{"explicit on", PreferenceKey{other, company, TypeDeliveryDueSoon}, true},
		{"unknown type", PreferenceKey{user, company, Type("nope")}, false},
	}
	for _, tc := range cases {
		if got := o.Effective(tc.key); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
	var nilOverrides *Overrides
	if !nilOverrides.Effective(PreferenceKey{user, company, TypeApplicationReceived}) {
		t.Error("nil overrides must fall back to the in_app default")
	}
	email := NewOverrides(ChannelEmail)
	if email.Effective(PreferenceKey{user, company, TypeApplicationReceived}) || !email.Effective(PreferenceKey{user, uuid.Nil, TypeCandidateTestPending}) {
		t.Error("email overrides must fall back to the email defaults")
	}
}

// The batched lookup reads only what can matter: distinct users, distinct
// non-NULL companies and overridable types, in first-seen order; nothing to
// read when every key is mandatory.
func TestNewOverrideLookup(t *testing.T) {
	a, b, company := uuid.New(), uuid.New(), uuid.New()
	got := NewOverrideLookup([]PreferenceKey{
		{a, company, TypeApplicationReceived},
		{b, company, TypeApplicationReceived},
		{a, uuid.Nil, TypeCandidateTestPending},
		{b, company, TypeVacancyAssigned},
		{a, company, TypeApplicationReceived},
	})
	want := OverrideLookup{Users: []uuid.UUID{a, b}, Companies: []uuid.UUID{company}, Types: []string{"application_received", "candidate_test_pending"}}
	if !reflect.DeepEqual(got, want) || got.Empty() {
		t.Fatalf("got %+v want %+v", got, want)
	}
	if l := NewOverrideLookup([]PreferenceKey{{a, company, TypeVacancyAssigned}, {b, company, TypeDeliveryOverdue}}); !l.Empty() {
		t.Fatalf("only mandatory keys must need no lookup: %+v", l)
	}
	if l := NewOverrideLookup(nil); !l.Empty() || l.Users == nil || l.Companies == nil || l.Types == nil {
		t.Fatalf("empty lookup must carry non-nil slices (SQL arrays): %+v", l)
	}
}
