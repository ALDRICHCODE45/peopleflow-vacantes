package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// placementCoverageRows is the shared current-stage coverage definition. Both
// single-board reads and dashboard totals supply a trusted scope relation.
const placementCoverageRows = `FROM process_participations WHERE process_id=scope.id AND stage_id=scope.placement`

// ReadPlacementCoverage is shared by the board and vacancy close validation.
// The caller holds the parent draft lock and supplies the current semantic
// Placement stage, not a historical coverage milestone or delivery count.
func ReadPlacementCoverage(ctx context.Context, tx pgx.Tx, id uuid.UUID, placement string) (int64, *time.Time, error) {
	var covered int64
	var reached *time.Time
	err := tx.QueryRow(ctx, `SELECT (SELECT count(*) `+placementCoverageRows+`),
 (SELECT min(reached_at) FROM process_coverage_milestones WHERE process_id=scope.id)
 FROM (SELECT $1::uuid AS id,$2::uuid AS placement) scope`, id, placement).Scan(&covered, &reached)
	if reached != nil {
		v := reached.UTC()
		reached = &v
	}
	return covered, reached, err
}

// ReadPlacementCoverageTotal sums the same board coverage for paired process
// and semantic placement-stage identities without per-vacancy round trips.
func ReadPlacementCoverageTotal(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, placements []string) (int64, error) {
	var covered int64
	err := tx.QueryRow(ctx, `SELECT COALESCE(sum((SELECT count(*) `+placementCoverageRows+`)),0)::bigint
 FROM unnest($1::uuid[],$2::uuid[]) AS scope(id,placement)`, ids, placements).Scan(&covered)
	return covered, err
}
