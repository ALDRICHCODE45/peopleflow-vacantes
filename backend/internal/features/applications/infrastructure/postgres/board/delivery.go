package board

import (
	"context"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) delivery(ctx context.Context, tx pgx.Tx, id uuid.UUID) (app.Delivery, error) {
	state, delivered, target, err := s.vacancy.DeliverySummary(ctx, tx, id)
	return app.Delivery{State: state, Delivered: delivered, Target: target}, err
}
