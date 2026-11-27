package preferences

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

// ReadOverrides reads, with one query over the caller's queries (its tx or
// the pool), the override rows of one channel for every key and returns them
// as a domain.Overrides that resolves each key's effective value
// (notifications-v2 D6, D7, D11). Locked (mandatory) types are never fetched
// and no query runs when every key is locked. This is the one read shared by
// the creation paths (fan-out and scheduler in_app, the email delivery
// decision) and the sender's re-check at send time; the domain stays DB-free.
func ReadOverrides(ctx context.Context, q *db.Queries, channel domain.Channel, keys []domain.PreferenceKey) (*domain.Overrides, error) {
	out := domain.NewOverrides(channel)
	lookup := domain.NewOverrideLookup(keys)
	if lookup.Empty() {
		return out, nil
	}
	rows, err := q.ListNotificationPreferenceOverrides(ctx, db.ListNotificationPreferenceOverridesParams{
		Channel: string(channel), UserIds: lookup.Users, Types: lookup.Types, CompanyIds: lookup.Companies})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		k := domain.PreferenceKey{User: r.UserID, Type: domain.Type(r.Type)}
		if r.CompanyID.Valid {
			k.Company = r.CompanyID.Bytes
		}
		out.Set(k, r.Enabled)
	}
	return out, nil
}
