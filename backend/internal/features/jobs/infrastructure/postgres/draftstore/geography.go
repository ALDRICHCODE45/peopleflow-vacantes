package draftstore

import (
	"context"
	"errors"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	"github.com/jackc/pgx/v5"
)

// This tx-scoped G1 lookup uses generated queries, not sibling infrastructure.
// Catalog failures remain server errors and validation precedes every write.
type geoLookup struct{ q *db.Queries }

func (l geoLookup) CountryExists(ctx context.Context, c string) (bool, error) {
	return l.q.GeoCountryExists(ctx, c)
}
func (l geoLookup) StateExists(ctx context.Context, c, s string) (bool, error) {
	return l.q.GeoStateExists(ctx, db.GeoStateExistsParams{CountryCode: c, Code: s})
}
func (l geoLookup) MunicipalityState(ctx context.Context, c, m string) (string, error) {
	s, err := l.q.GeoMunicipalityState(ctx, db.GeoMunicipalityStateParams{CountryCode: c, Code: m})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return s, err
}
func (l geoLookup) PostalMatches(ctx context.Context, c, p string) ([]domain.PostalMatch, error) {
	rows, err := l.q.GeoPostalMatches(ctx, db.GeoPostalMatchesParams{CountryCode: c, PostalCode: p})
	if err != nil {
		return nil, err
	}
	out := make([]domain.PostalMatch, 0, len(rows))
	for _, r := range rows {
		out = append(out, domain.PostalMatch{State: domain.Item{Code: r.StateCode, Name: r.StateName}, Municipality: domain.Item{Code: r.MunicipalityCode, Name: r.MunicipalityName}})
	}
	return out, nil
}

func validateGeography(ctx context.Context, tx pgx.Tx, stored []byte) error {
	fields, err := envelopeFieldsOf(stored)
	if err != nil {
		return err
	}
	location, err := vacancygeo.ParseLocation(fields["location"])
	if err != nil {
		return err
	}
	scope, err := vacancygeo.ParseRemoteScope(fields["remote_scope"])
	if err != nil {
		return err
	}
	return vacancygeo.Validate(ctx, geoLookup{db.New(tx)}, location, scope)
}

// renderGeoEnvelopeV2 expands only the read copy. Stored canonical bytes and
// fingerprints remain code-only, including the submitted remote country order.
func renderGeoEnvelopeV2(ctx context.Context, tx pgx.Tx, record draftRecord, name *string) ([]byte, error) {
	body, err := renderEnvelopeV2(record, name)
	if err != nil {
		return nil, err
	}
	return expandGeography(ctx, tx, body)
}

func renderGeoEnvelope(ctx context.Context, tx pgx.Tx, record draftRecord, name *string) ([]byte, error) {
	body, err := renderEnvelope(record, name)
	if err != nil {
		return nil, err
	}
	return expandGeography(ctx, tx, body)
}

func expandGeography(ctx context.Context, tx pgx.Tx, body []byte) ([]byte, error) {
	value, err := draftjson.Decode(body)
	if err != nil {
		return nil, err
	}
	root := value.(map[string]any)
	fields := root["fields"].(map[string]any)
	q := db.New(tx)
	if raw := fields["location"]; raw != nil {
		loc, err := vacancygeo.ParseLocation(raw)
		if err != nil {
			return nil, err
		}
		data, err := q.VacancyLocationRead(ctx, db.VacancyLocationReadParams{Country: loc.Country, State: loc.State, Municipality: loc.Municipality, PostalCode: loc.PostalCode})
		if err != nil {
			return nil, fmt.Errorf("read location names: %w", err)
		}
		fields["location"], err = draftjson.Decode(data)
		if err != nil {
			return nil, err
		}
	}
	if raw := fields["remote_scope"]; raw != nil {
		scope, err := vacancygeo.ParseRemoteScope(raw)
		if err != nil {
			return nil, err
		}
		if scope.Kind == "countries" {
			data, err := q.VacancyRemoteCountriesRead(ctx, scope.Countries)
			if err != nil {
				return nil, fmt.Errorf("read remote countries: %w", err)
			}
			expanded, err := draftjson.Decode(data)
			if err != nil {
				return nil, err
			}
			fields["remote_scope"] = map[string]any{"kind": "countries", "countries": expanded}
		}
	}
	return draftjson.EncodeValidatedValue(root)
}
