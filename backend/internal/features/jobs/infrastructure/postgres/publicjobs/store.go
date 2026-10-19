// Package publicjobs adapts the public catalog reader to the sqlc UNION query.
package publicjobs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	catalog "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type Store struct{ queries *db.Queries }

func NewStore(queries *db.Queries) *Store { return &Store{queries: queries} }

var _ catalog.Reader = (*Store)(nil)

func (s *Store) Search(ctx context.Context, q catalog.Query) ([]catalog.Row, error) {
	p := db.SearchPublicJobsParams{Q: q.Q, Location: q.Location, WorkMode: q.WorkMode, WorkSchedule: q.WorkSchedule, ContractType: q.ContractType, ProfessionalArea: q.ProfessionalArea, PageLimit: int32(q.Limit)}
	if q.After != nil {
		p.CursorRank = q.After.Rank
		p.CursorTs = pgtype.Timestamptz{Time: q.After.PublishedAt, Valid: true}
		p.CursorSource = q.After.Source
		p.CursorID = q.After.ID
	}
	return s.search(ctx, p)
}
func (s *Store) Get(ctx context.Context, id uuid.UUID) (catalog.Detail, error) {
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
