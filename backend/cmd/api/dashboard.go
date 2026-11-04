package main

import (
	"context"
	poolpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/pool"
	talentbasepostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres/talentbase"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// dashboardPoolAdded reuses the pool summary in the dashboard's transaction. It
// is the same aggregate as the gated summary route, so a user without talent
// base access gets nil (contract talent-base-visibility-v1).
func dashboardPoolAdded(ctx context.Context, tx pgx.Tx, company, actor uuid.UUID) (*int64, error) {
	allowed, err := talentbasepostgres.CanViewIn(ctx, tx, company, actor)
	if err != nil || !allowed {
		return nil, err
	}
	summary, err := poolpostgres.ReadSummary(ctx, tx, company)
	return &summary.AddedLast7Days, err
}
