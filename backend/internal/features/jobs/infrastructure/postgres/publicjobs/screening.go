package publicjobs

import (
	"context"
	"errors"

	catalog "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) Screening(ctx context.Context, id uuid.UUID) (catalog.Screening, error) {
	if err := s.unavailable(ctx, id); err != nil {
		return catalog.Screening{}, err
	}
	source, err := s.queries.GetPublishedScreeningSource(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return catalog.Screening{}, catalog.ErrNotFound
	}
	if err != nil {
		return catalog.Screening{}, err
	}
	return catalog.BuildScreening(source)
}
