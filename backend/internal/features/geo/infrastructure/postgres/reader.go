// Package postgres adapts generated catalog queries to the application port.
package postgres

import (
	"context"
	"errors"
	"strconv"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/jackc/pgx/v5"
)

type Reader struct{ q *db.Queries }

func NewReader(q *db.Queries) *Reader { return &Reader{q: q} }
func (r *Reader) Countries(ctx context.Context) ([]domain.Item, error) {
	rows, err := r.q.GeoCountries(ctx)
	out := make([]domain.Item, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.Item{Code: row.Code, Name: row.NameEs})
	}
	return out, err
}
func (r *Reader) States(ctx context.Context, country string) ([]domain.Item, error) {
	rows, err := r.q.GeoStates(ctx, country)
	out := make([]domain.Item, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.Item{Code: row.Code, Name: row.Name})
	}
	return out, err
}
func (r *Reader) Municipalities(ctx context.Context, country, state string) ([]domain.Item, error) {
	rows, err := r.q.GeoMunicipalities(ctx, db.GeoMunicipalitiesParams{CountryCode: country, StateCode: state})
	out := make([]domain.Item, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.Item{Code: row.Code, Name: row.Name})
	}
	return out, err
}
func (r *Reader) PostalMatches(ctx context.Context, country, postal string) ([]domain.PostalMatch, error) {
	rows, err := r.q.GeoPostalMatches(ctx, db.GeoPostalMatchesParams{CountryCode: country, PostalCode: postal})
	out := make([]domain.PostalMatch, 0, len(rows))
	for _, row := range rows {
		out = append(out, domain.PostalMatch{State: domain.Item{Code: row.StateCode, Name: row.StateName}, Municipality: domain.Item{Code: row.MunicipalityCode, Name: row.MunicipalityName}})
	}
	return out, err
}
func (r *Reader) CountryExists(ctx context.Context, country string) (bool, error) {
	return r.q.GeoCountryExists(ctx, country)
}
func (r *Reader) StateExists(ctx context.Context, country, state string) (bool, error) {
	return r.q.GeoStateExists(ctx, db.GeoStateExistsParams{CountryCode: country, Code: state})
}
func (r *Reader) MunicipalityState(ctx context.Context, country, municipality string) (string, error) {
	state, err := r.q.GeoMunicipalityState(ctx, db.GeoMunicipalityStateParams{CountryCode: country, Code: municipality})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return state, err
}
func (r *Reader) Version(ctx context.Context) (string, error) {
	id, err := r.q.GeoLatestImport(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return "empty", nil
	}
	return strconv.FormatInt(id, 10), err
}
