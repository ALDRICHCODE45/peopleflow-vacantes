//go:build integration

package migrations_test

import (
	"context"
	"testing"
)

func TestMigration00015PipelineConfigUpDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)
	for _, column := range []string{"draft_id", "version", "configuration"} {
		if !columnExists(t, pool, "job_draft_pipeline_configs", column) {
			t.Fatalf("missing pipeline column %s", column)
		}
	}
	var primary, foreign, positive bool
	if err := pool.QueryRow(context.Background(), `SELECT
		EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_pipeline_configs'::regclass AND contype='p'),
		EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_pipeline_configs'::regclass AND contype='f' AND confrelid='job_drafts'::regclass),
		EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_pipeline_configs'::regclass AND conname='job_draft_pipeline_version_positive')`).Scan(&primary, &foreign, &positive); err != nil {
		t.Fatal(err)
	}
	if !primary || !foreign || !positive {
		t.Fatalf("constraints: primary=%v foreign=%v positive=%v", primary, foreign, positive)
	}
	gooseDownTo(t, db, 14)
	if columnExists(t, pool, "job_draft_pipeline_configs", "draft_id") || !columnExists(t, pool, "job_drafts", "id") {
		t.Fatal("down must remove only pipeline configuration")
	}
}
