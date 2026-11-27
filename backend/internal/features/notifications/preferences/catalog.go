// Package preferences serves the personal notification preferences of
// notifications-v2 (D1–D5, D23, §Preferences): the caller tree's catalog
// (types × channels with default / enabled / mandatory_locked and
// email_deliverable) and the partial, atomic, idempotent PUT. Types, kinds,
// channels, defaults and locks come only from the domain table; the database
// holds sparse override rows keyed (user, company, type, channel), company
// NULL for candidates. Not audited (D5).
package preferences

import "github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"

// Pair is one (type, channel) of a catalog or an override row.
type Pair struct {
	Type    domain.Type
	Channel domain.Channel
}

// ChannelState is one channel of one catalog item: Default is the domain
// default, Enabled the effective value (D2), MandatoryLocked a pair no
// override can change.
type ChannelState struct {
	Default         bool `json:"default"`
	Enabled         bool `json:"enabled"`
	MandatoryLocked bool `json:"mandatory_locked"`
}

// Item is one type of the caller's tree with every channel.
type Item struct {
	Type     domain.Type                     `json:"type"`
	Kind     domain.Kind                     `json:"kind"`
	Channels map[domain.Channel]ChannelState `json:"channels"`
}

// Catalog is the GET body and the PUT response (§Preferences).
type Catalog struct {
	Channels         []domain.Channel `json:"channels"`
	EmailDeliverable bool             `json:"email_deliverable"`
	Items            []Item           `json:"items"`
}

// TreeTypes returns, in table order, the domain types of one recipient kind
// (member tree: 11; candidate tree: 3).
func TreeTypes(kind domain.RecipientKind) []domain.Spec {
	var out []domain.Spec
	for _, s := range domain.Types() {
		if s.RecipientKind == kind {
			out = append(out, s)
		}
	}
	return out
}

// Build renders the catalog of a tree from the domain table and the caller's
// override rows; rows outside the tree or on locked pairs never change a
// value (EffectivePreference).
func Build(kind domain.RecipientKind, overrides map[Pair]bool, deliverable bool) Catalog {
	channels := domain.Channels()
	specs := TreeTypes(kind)
	items := make([]Item, 0, len(specs))
	for _, spec := range specs {
		states := make(map[domain.Channel]ChannelState, len(channels))
		for _, ch := range channels {
			def, _ := domain.DefaultPreference(spec.Type, ch)
			var override *bool
			if v, ok := overrides[Pair{spec.Type, ch}]; ok {
				override = &v
			}
			states[ch] = ChannelState{
				Default:         def.Enabled,
				Enabled:         domain.EffectivePreference(spec.Type, ch, override),
				MandatoryLocked: def.Locked,
			}
		}
		items = append(items, Item{Type: spec.Type, Kind: spec.Kind, Channels: states})
	}
	return Catalog{Channels: channels, EmailDeliverable: deliverable, Items: items}
}
