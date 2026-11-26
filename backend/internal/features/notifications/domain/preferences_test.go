package domain

import "testing"

// notifications-v2 §Preferences, per-type table: (in_app, email) defaults and
// whether the pair is locked, row by row in types.go order.
func TestDefaultPreferencesMatchContract(t *testing.T) {
	type row struct {
		typ           Type
		inApp, email  bool
		locked        bool
		recipientKind RecipientKind
	}
	want := []row{
		{TypeApplicationReceived, true, false, false, RecipientMember},
		{TypeDeliveryDueSoon, true, false, false, RecipientMember},
		{TypeDeliveryOverdue, true, true, true, RecipientMember},
		{TypeAssignmentDeadlineDueSoon, true, false, false, RecipientMember},
		{TypeAssignmentDeadlineOverdue, true, true, true, RecipientMember},
		{TypeVacancyAssigned, true, true, true, RecipientMember},
		{TypeVacancyReassigned, true, true, true, RecipientMember},
		{TypeVacancyUnassigned, true, true, true, RecipientMember},
		{TypeVacancyTeamAdded, true, true, true, RecipientMember},
		{TypePsychometricCompleted, true, false, false, RecipientMember},
		{TypePsychometricPending, true, false, false, RecipientMember},
		// Q1 (D2): the three candidate types send email by default.
		{TypeCandidateStatusChanged, true, true, false, RecipientCandidate},
		{TypeCandidateMessageReceived, true, true, false, RecipientCandidate},
		{TypeCandidateTestPending, true, true, false, RecipientCandidate},
	}
	if got := len(Types()); got != len(want) {
		t.Fatalf("types = %d, want %d", got, len(want))
	}
	for i, w := range want {
		if Types()[i].Type != w.typ || Types()[i].RecipientKind != w.recipientKind {
			t.Fatalf("row %d = %s, want %s (%s)", i, Types()[i].Type, w.typ, w.recipientKind)
		}
		for _, c := range []struct {
			ch      Channel
			enabled bool
		}{{ChannelInApp, w.inApp}, {ChannelEmail, w.email}} {
			d, ok := DefaultPreference(w.typ, c.ch)
			if !ok || d.Enabled != c.enabled || d.Locked != w.locked {
				t.Errorf("DefaultPreference(%s, %s) = %+v %v, want enabled=%v locked=%v", w.typ, c.ch, d, ok, c.enabled, w.locked)
			}
		}
		if Locked(w.typ) != w.locked {
			t.Errorf("Locked(%s) = %v, want %v", w.typ, Locked(w.typ), w.locked)
		}
	}
}

// §Default table: the rule is by kind (mandatory on+locked, operational and
// informative in_app on / email off), with the candidate email exception.
func TestKindDefaults(t *testing.T) {
	for _, tc := range []struct {
		kind         Kind
		inApp, email ChannelDefault
	}{
		{KindMandatory, ChannelDefault{true, true}, ChannelDefault{true, true}},
		{KindOperational, ChannelDefault{true, false}, ChannelDefault{false, false}},
		{KindInformative, ChannelDefault{true, false}, ChannelDefault{false, false}},
	} {
		if got, ok := KindDefault(tc.kind, ChannelInApp); !ok || got != tc.inApp {
			t.Errorf("KindDefault(%s, in_app) = %+v %v, want %+v", tc.kind, got, ok, tc.inApp)
		}
		if got, ok := KindDefault(tc.kind, ChannelEmail); !ok || got != tc.email {
			t.Errorf("KindDefault(%s, email) = %+v %v, want %+v", tc.kind, got, ok, tc.email)
		}
	}
	if _, ok := KindDefault("urgent", ChannelInApp); ok {
		t.Error("unknown kind must have no default")
	}
	if _, ok := KindDefault(KindOperational, "sms"); ok {
		t.Error("unknown channel must have no default")
	}
}

// Effective preference (D2): override row wins over the default, except a
// locked (mandatory) pair, which is always on whatever a row says.
func TestEffectivePreference(t *testing.T) {
	on, off := true, false
	for _, tc := range []struct {
		name     string
		typ      Type
		ch       Channel
		override *bool
		want     bool
	}{
		{"operational in_app default", TypeApplicationReceived, ChannelInApp, nil, true},
		{"operational email default", TypeApplicationReceived, ChannelEmail, nil, false},
		{"operational email override on", TypeApplicationReceived, ChannelEmail, &on, true},
		{"operational in_app override off", TypePsychometricPending, ChannelInApp, &off, false},
		{"operational override equal to default", TypeDeliveryDueSoon, ChannelInApp, &on, true},
		{"scheduled due soon email default", TypeAssignmentDeadlineDueSoon, ChannelEmail, nil, false},
		{"candidate email default on (Q1)", TypeCandidateStatusChanged, ChannelEmail, nil, true},
		{"candidate message email default on (Q1)", TypeCandidateMessageReceived, ChannelEmail, nil, true},
		{"candidate test email default on (Q1)", TypeCandidateTestPending, ChannelEmail, nil, true},
		{"candidate email override off", TypeCandidateTestPending, ChannelEmail, &off, false},
		{"candidate in_app override off", TypeCandidateMessageReceived, ChannelInApp, &off, false},
		{"mandatory in_app default", TypeDeliveryOverdue, ChannelInApp, nil, true},
		{"mandatory email default", TypeVacancyAssigned, ChannelEmail, nil, true},
		{"mandatory email row ignored", TypeVacancyReassigned, ChannelEmail, &off, true},
		{"mandatory in_app row ignored", TypeVacancyTeamAdded, ChannelInApp, &off, true},
		{"unknown type", "team_added", ChannelInApp, &on, false},
		{"unknown channel", TypeApplicationReceived, "sms", &on, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := EffectivePreference(tc.typ, tc.ch, tc.override); got != tc.want {
				t.Fatalf("EffectivePreference(%s, %s, %v) = %v, want %v", tc.typ, tc.ch, tc.override, got, tc.want)
			}
		})
	}
}

// The channel set is closed and ordered as the GET catalog lists it.
func TestChannels(t *testing.T) {
	got := Channels()
	if len(got) != 2 || got[0] != ChannelInApp || got[1] != ChannelEmail {
		t.Fatalf("Channels() = %v", got)
	}
	got[0] = "sms"
	if Channels()[0] != ChannelInApp {
		t.Fatal("Channels must return a copy")
	}
	for _, c := range []Channel{ChannelInApp, ChannelEmail} {
		if !c.Valid() {
			t.Errorf("%s must be valid", c)
		}
	}
	if Channel("sms").Valid() {
		t.Error("sms must not be a channel")
	}
	if _, ok := DefaultPreference("team_added", ChannelInApp); ok {
		t.Error("unknown type must have no default")
	}
}

// Overridable types are exactly the non-mandatory ones; the migration 00069
// notification_preferences.type CHECK lists the same set (checked against the
// database in the capture migration test).
func TestOverridableTypes(t *testing.T) {
	var want []Type
	for _, s := range Types() {
		if s.Kind != KindMandatory {
			want = append(want, s.Type)
		}
	}
	got := OverridableTypes()
	if len(got) != len(want) || len(got) != 8 {
		t.Fatalf("OverridableTypes() = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("OverridableTypes()[%d] = %s, want %s", i, got[i], want[i])
		}
	}
}
