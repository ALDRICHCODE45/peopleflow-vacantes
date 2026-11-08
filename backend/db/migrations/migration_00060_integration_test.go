//go:build integration

// Migration 00060 (`metrics_participation_index`, stakeholder-metrics-v2 §2):
// up creates the (process_id, created_at) participation index the origin and
// applications reads use, and down drops it. Same isolation as the other
// migration tests: a disposable draft_test_mig_* database.
package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const participationProcessCreatedIndex = "process_participations_process_created_idx"

func participationIndexDefinition(t *testing.T, pool *pgxpool.Pool) (string, bool) {
	t.Helper()
	var def string
	err := pool.QueryRow(context.Background(),
		`SELECT indexdef FROM pg_indexes WHERE tablename = 'process_participations' AND indexname = $1`, participationProcessCreatedIndex,
	).Scan(&def)
	if err != nil {
		return "", false
	}
	return def, true
}

func TestMigration00060UpCreatesAndDownDropsParticipationIndex(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)

	def, ok := participationIndexDefinition(t, pool)
	if !ok || !strings.Contains(def, "(process_id, created_at)") {
		t.Fatalf("index after 00060 up: %q %v, want (process_id, created_at)", def, ok)
	}
	gooseDownTo(t, db, 59)
	if _, ok := participationIndexDefinition(t, pool); ok {
		t.Fatalf("index %s must not exist after 00060 down", participationProcessCreatedIndex)
	}
	// The index 00058 added on participations is untouched by 00060.
	var survived bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'process_participations' AND indexdef LIKE '%(created_at, origin_channel)%')`,
	).Scan(&survived); err != nil || !survived {
		t.Fatalf("the 00058 (created_at, origin_channel) index must survive 00060 down: %v", err)
	}
	gooseUpAll(t, db)
	if _, ok := participationIndexDefinition(t, pool); !ok {
		t.Fatal("00060 must apply again after its rollback")
	}
}
