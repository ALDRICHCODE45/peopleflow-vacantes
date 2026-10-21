package db

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ReadPlacementCoverage is shared by the board and vacancy close validation.
// The caller holds the parent draft lock and supplies the current semantic
// Placement stage, not a historical coverage milestone or delivery count.
func ReadPlacementCoverage(ctx context.Context, tx pgx.Tx, id uuid.UUID, placement string) (int64, *time.Time, error) {
	var covered int64
	var reached *time.Time
	err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM process_participations WHERE process_id=$1 AND stage_id=$2::uuid),
 (SELECT min(reached_at) FROM process_coverage_milestones WHERE process_id=$1)`, id, placement).Scan(&covered, &reached)
	if reached != nil {
		v := reached.UTC()
		reached = &v
	}
	return covered, reached, err
}
