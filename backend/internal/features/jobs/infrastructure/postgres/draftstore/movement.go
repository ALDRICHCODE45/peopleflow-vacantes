package draftstore

import (
	"context"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MovementContext reuses the live draft gates and validated configuration in the
// caller's transaction. The parent lock serializes movement with intake and
// authoring saves (including headcount changes), before any process/item locks.
func (s *Store) MovementContext(ctx context.Context, tx pgx.Tx, company, actor, id uuid.UUID) (pipelineconfig.Configuration, *int64, error) {
	if err := s.authorizePipeline(ctx, tx, company, actor, id, true); err != nil {
		return pipelineconfig.Configuration{}, nil, err
	}
	c, _, err := readPipeline(ctx, tx, id)
	if err != nil {
		return c, nil, err
	}
	management, _, err := readManagement(ctx, tx, id)
	return c, management.HiringHeadcount, err
}
