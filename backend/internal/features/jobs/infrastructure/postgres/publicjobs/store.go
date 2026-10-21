// Package publicjobs adapts the public catalog reader to the sqlc UNION query.
package publicjobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	catalog "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct{ queries *db.Queries }

func NewStore(queries *db.Queries) *Store { return &Store{queries: queries} }

var _ catalog.Reader = (*Store)(nil)

func (s *Store) Search(ctx context.Context, q catalog.Query) ([]catalog.Row, error) {
	if err := catalog.ValidateFilters(ctx, s, q); err != nil {
		return nil, fmt.Errorf("validate public filters: %w", err)
	}
	p := db.SearchPublicJobsParams{Q: q.Q, States: q.States, Municipalities: q.Municipalities, WorkModes: q.WorkModes, ApplicantCountry: q.ApplicantCountry, WorkSchedule: q.WorkSchedule, ContractType: q.ContractType, ProfessionalArea: q.ProfessionalArea, PageLimit: int32(q.Limit)}
	if f := q.Salary; f != nil {
		p.SalaryCurrency, p.SalaryPeriod, p.SalaryBasis, p.SalaryMin, p.SalaryMax = f.Currency, f.Period, f.Basis, f.Min, f.Max
	}
	if q.After != nil {
		p.CursorRank = q.After.Rank
		p.CursorTs = pgtype.Timestamptz{Time: q.After.PublishedAt, Valid: true}
		p.CursorSource = q.After.Source
		p.CursorID = q.After.ID
	}
	return s.search(ctx, p)
}
func (s *Store) CountryExists(ctx context.Context, country string) (bool, error) {
	return s.queries.GeoCountryExists(ctx, country)
}
func (s *Store) StateExists(ctx context.Context, country, state string) (bool, error) {
	return s.queries.GeoStateExists(ctx, db.GeoStateExistsParams{CountryCode: country, Code: state})
}
func (s *Store) MunicipalityState(ctx context.Context, country, municipality string) (string, error) {
	state, err := s.queries.GeoMunicipalityState(ctx, db.GeoMunicipalityStateParams{CountryCode: country, Code: municipality})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return state, err
}
func (s *Store) unavailable(ctx context.Context, id uuid.UUID) error {
	row, err := s.queries.GetUnavailableVacancy(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read unavailable vacancy: %w", err)
	}
	out := &catalog.Unavailable{ID: row.ID, Title: row.Title, Availability: row.Availability}
	out.Company.ID = row.CompanyID
	out.Company.Name = row.CompanyName
	return out
}

func (s *Store) Get(ctx context.Context, id uuid.UUID) (catalog.Detail, error) {
	if err := s.unavailable(ctx, id); err != nil {
		return catalog.Detail{}, err
	}
	rows, err := s.search(ctx, db.SearchPublicJobsParams{DetailID: pgtype.UUID{Bytes: id, Valid: true}, PageLimit: 1})
	if err != nil {
		return catalog.Detail{}, err
	}
	if len(rows) == 0 {
		return catalog.Detail{}, catalog.ErrNotFound
	}
	return rows[0].Detail, nil
}
func (s *Store) search(ctx context.Context, p db.SearchPublicJobsParams) ([]catalog.Row, error) {
	rows, err := s.queries.SearchPublicJobs(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("read public catalog: %w", err)
	}
	out := make([]catalog.Row, 0, len(rows))
	for _, row := range rows {
		var detail catalog.Detail
		if err := json.Unmarshal(row.Body, &detail); err != nil {
			return nil, fmt.Errorf("decode public catalog row: %w", err)
		}
		detail.PublishedAt = detail.PublishedAt.UTC()
		out = append(out, catalog.Row{Detail: detail, Rank: row.SearchRank})
	}
	return out, nil
}
