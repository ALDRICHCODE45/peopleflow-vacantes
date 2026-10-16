//go:build integration

package migrations_test

import (
	"context"
	"testing"
)

func TestMigration00017DeliveryUpDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)
	for column, typ := range map[string]string{"draft_id": "uuid", "version": "bigint", "cutoff_stage_id": "uuid", "target_quantity": "integer", "commitment_date": "date"} {
		var got, nullable string
		if err := pool.QueryRow(context.Background(), `SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='job_draft_delivery_configs' AND column_name=$1`, column).Scan(&got, &nullable); err != nil {
			t.Fatal(err)
		}
		if got != typ || ((column == "cutoff_stage_id" || column == "target_quantity" || column == "commitment_date") && nullable != "YES") {
			t.Fatalf("%s: type=%s nullable=%s", column, got, nullable)
		}
	}
	var primary, foreign, positive, target bool
	if err := pool.QueryRow(context.Background(), `SELECT
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_delivery_configs'::regclass AND contype='p'),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_delivery_configs'::regclass AND contype='f' AND confrelid='job_drafts'::regclass AND confdeltype='c'),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_delivery_configs'::regclass AND conname='job_draft_delivery_version_positive'),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='job_draft_delivery_configs'::regclass AND conname='job_draft_delivery_target_range')`).Scan(&primary, &foreign, &positive, &target); err != nil {
		t.Fatal(err)
	}
	if !primary || !foreign || !positive || !target {
		t.Fatalf("constraints=%v %v %v %v", primary, foreign, positive, target)
	}
	gooseDownTo(t, db, 16)
	if columnExists(t, pool, "job_draft_delivery_configs", "draft_id") || !columnExists(t, pool, "job_drafts", "id") || !columnExists(t, pool, "job_draft_pipeline_configs", "draft_id") || !columnExists(t, pool, "job_draft_substate_catalogs", "draft_id") {
		t.Fatal("down must remove only delivery configs")
	}
}
