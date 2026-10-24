package main

import (
	"context"
	poolpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/pool"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// dashboardPoolAdded reuses the pool summary in the dashboard's transaction.
func dashboardPoolAdded(ctx context.Context, tx pgx.Tx, company uuid.UUID) (int64, error) {
	summary, err := poolpostgres.ReadSummary(ctx, tx, company)
	return summary.AddedLast7Days, err
}
