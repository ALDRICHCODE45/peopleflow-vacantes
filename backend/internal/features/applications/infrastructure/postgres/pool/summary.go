package pool

import (
	"context"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Summary shares the list's membership, active counts and company scope. All
// metrics use one statement snapshot and the same PostgreSQL server time.
func (s *Store) Summary(ctx context.Context, company uuid.UUID) (app.Summary, error) {
	return ReadSummary(ctx, s.pool, company)
}

// ReadSummary lets composite read models reuse the pool definition in their snapshot.
func ReadSummary(ctx context.Context, reader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, company uuid.UUID) (app.Summary, error) {
	var out app.Summary
	err := reader.QueryRow(ctx, poolSQL+`) SELECT
 count(*),
 count(*) FILTER(WHERE active>=1),
 count(*) FILTER(WHERE created_at>now()-interval '7 days' AND created_at<=now()),
 count(*) FILTER(WHERE kind='manual'),
 count(*) FILTER(WHERE kind='organic')
 FROM filtered`, company).Scan(&out.Total, &out.WithActiveProcess, &out.AddedLast7Days, &out.ByKind.Manual, &out.ByKind.Organic)
	return out, err
}
