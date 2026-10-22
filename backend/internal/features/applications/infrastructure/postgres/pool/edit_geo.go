package pool

import (
	"context"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/jackc/pgx/v5"
)

// Transaction-bound adapter to generated catalog queries; validation remains
// owned by manual intake, not duplicated in the persistence adapter.
type editGeoLookup struct{ q *db.Queries }

func (g editGeoLookup) CountryExists(ctx context.Context, country string) (bool, error) {
	return g.q.GeoCountryExists(ctx, country)
}
func (g editGeoLookup) StateExists(ctx context.Context, country, state string) (bool, error) {
	return g.q.GeoStateExists(ctx, db.GeoStateExistsParams{CountryCode: country, Code: state})
}
func (g editGeoLookup) MunicipalityState(ctx context.Context, country, municipality string) (string, error) {
	state, err := g.q.GeoMunicipalityState(ctx, db.GeoMunicipalityStateParams{CountryCode: country, Code: municipality})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return state, err
}
func (g editGeoLookup) PostalMatches(ctx context.Context, country, postal string) ([]geo.PostalMatch, error) {
	rows, err := g.q.GeoPostalMatches(ctx, db.GeoPostalMatchesParams{CountryCode: country, PostalCode: postal})
	out := make([]geo.PostalMatch, 0, len(rows))
	for _, r := range rows {
		out = append(out, geo.PostalMatch{State: geo.Item{Code: r.StateCode, Name: r.StateName}, Municipality: geo.Item{Code: r.MunicipalityCode, Name: r.MunicipalityName}})
	}
	return out, err
}
