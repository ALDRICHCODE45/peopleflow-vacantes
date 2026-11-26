package domain

import "github.com/google/uuid"

// Creation-time preference evaluation (notifications-v2 D6, D7, E3): the
// fan-out and the scheduler read, in the tx that inserts the rows, the
// override rows of every (recipient, company, type) they are about to create,
// in one batched query per event / run, and resolve each row's value here.

// PreferenceKey is the scope of one override row: user, company (uuid.Nil =
// the candidate tree, company_id NULL, D1) and type. Matching is exact, so a
// row of another company or of the other tree never applies.
type PreferenceKey struct {
	User    uuid.UUID
	Company uuid.UUID
	Type    Type
}

// Overrides holds the override rows of one channel read for a batch.
type Overrides struct {
	channel Channel
	rows    map[PreferenceKey]bool
}

// NewOverrides returns an empty set for a channel.
func NewOverrides(c Channel) *Overrides {
	return &Overrides{channel: c, rows: map[PreferenceKey]bool{}}
}

// Set records the enabled value of one override row.
func (o *Overrides) Set(k PreferenceKey, enabled bool) { o.rows[k] = enabled }

// Effective is EffectivePreference of the key in the set's channel: a locked
// (mandatory) type is always on, whatever row exists; else the row; else the
// default. A nil set means no rows (defaults, in_app channel).
func (o *Overrides) Effective(k PreferenceKey) bool {
	if o == nil {
		return EffectivePreference(k.Type, ChannelInApp, nil)
	}
	if v, ok := o.rows[k]; ok {
		return EffectivePreference(k.Type, o.channel, &v)
	}
	return EffectivePreference(k.Type, o.channel, nil)
}

// OverrideLookup is the argument set of the batched override read: distinct
// users, distinct non-NULL companies and overridable types, first-seen order.
// The read over-fetches at most the cross product; Overrides matches exact
// keys. Slices are never nil (they bind to SQL arrays).
type OverrideLookup struct {
	Users     []uuid.UUID
	Companies []uuid.UUID
	Types     []string
}

// Empty reports that no key can have a row (every type locked): skip the read.
func (l OverrideLookup) Empty() bool { return len(l.Types) == 0 }

// NewOverrideLookup builds the lookup for keys; locked types are left out
// because no row of theirs can change anything.
func NewOverrideLookup(keys []PreferenceKey) OverrideLookup {
	l := OverrideLookup{Users: []uuid.UUID{}, Companies: []uuid.UUID{}, Types: []string{}}
	users, companies, types := map[uuid.UUID]bool{}, map[uuid.UUID]bool{}, map[Type]bool{}
	for _, k := range keys {
		if Locked(k.Type) {
			continue
		}
		if !users[k.User] {
			users[k.User] = true
			l.Users = append(l.Users, k.User)
		}
		if k.Company != uuid.Nil && !companies[k.Company] {
			companies[k.Company] = true
			l.Companies = append(l.Companies, k.Company)
		}
		if !types[k.Type] {
			types[k.Type] = true
			l.Types = append(l.Types, string(k.Type))
		}
	}
	return l
}
