package domain

// Personal preferences (notifications-v2 D1–D2, §Preferences): defaults come
// from the type's kind in this closed table; the database stores only sparse
// override rows (notification_preferences, migration 00069), whose CHECK
// refuses every mandatory type. Effective = the override row if present, else
// the default; a locked (mandatory) pair is always on.

// Channel is one delivery channel; it mirrors
// notification_preferences.channel.
type Channel string

const (
	ChannelInApp Channel = "in_app"
	ChannelEmail Channel = "email"
)

// channels is the closed channel set in catalog order (D3).
var channels = []Channel{ChannelInApp, ChannelEmail}

// Channels returns a copy of the ordered channel set.
func Channels() []Channel { return append([]Channel(nil), channels...) }

// Valid reports whether c is a known channel.
func (c Channel) Valid() bool { return c == ChannelInApp || c == ChannelEmail }

// ChannelDefault is the default of one (type, channel) pair: Enabled when no
// override row exists; Locked pairs cannot be overridden at all (D2).
type ChannelDefault struct {
	Enabled bool
	Locked  bool
}

// kindDefaults is §Default table by kind: mandatory on and locked in both
// channels; operational and informative in_app on, email off (S2).
var kindDefaults = map[Kind]map[Channel]ChannelDefault{
	KindMandatory:   {ChannelInApp: {Enabled: true, Locked: true}, ChannelEmail: {Enabled: true, Locked: true}},
	KindOperational: {ChannelInApp: {Enabled: true}, ChannelEmail: {Enabled: false}},
	KindInformative: {ChannelInApp: {Enabled: true}, ChannelEmail: {Enabled: false}},
}

// KindDefault returns the kind-level default of a channel.
func KindDefault(k Kind, c Channel) (ChannelDefault, bool) {
	d, ok := kindDefaults[k][c]
	return d, ok
}

// DefaultPreference returns the default of (type, channel): the kind default,
// except the candidate types, whose email is on by default (Q1, D2). ok is
// false for an unknown type or channel.
func DefaultPreference(t Type, c Channel) (ChannelDefault, bool) {
	spec, ok := Lookup(t)
	if !ok {
		return ChannelDefault{}, false
	}
	d, ok := KindDefault(spec.Kind, c)
	if !ok {
		return ChannelDefault{}, false
	}
	if c == ChannelEmail && spec.RecipientKind == RecipientCandidate && spec.Kind != KindMandatory {
		d.Enabled = true
	}
	return d, true
}

// Locked reports whether a type is mandatory_locked: both channels always on,
// no override accepted (API 422 notification_preference_locked, DB CHECK).
func Locked(t Type) bool {
	spec, ok := Lookup(t)
	return ok && spec.Kind == KindMandatory
}

// EffectivePreference is the value that applies to (type, channel): always
// true for a locked pair, else the override row's enabled when present
// (override non-nil), else the default. Unknown type or channel → false.
func EffectivePreference(t Type, c Channel, override *bool) bool {
	d, ok := DefaultPreference(t, c)
	if !ok {
		return false
	}
	if d.Locked || override == nil {
		return d.Enabled
	}
	return *override
}

// OverridableTypes lists, in table order, the types that may have override
// rows (every non-mandatory type); it mirrors the
// notification_preferences.type CHECK of migration 00069.
func OverridableTypes() []Type {
	var out []Type
	for _, s := range types {
		if s.Kind != KindMandatory {
			out = append(out, s.Type)
		}
	}
	return out
}
