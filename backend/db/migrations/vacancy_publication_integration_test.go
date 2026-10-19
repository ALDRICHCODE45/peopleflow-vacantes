//go:build integration

package migrations_test

import (
	"context"
	"testing"
)

func TestMigration00019PublicationUpDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)
	for column, typ := range map[string]string{"id": "uuid", "company_id": "uuid", "status": "text", "published_at": "timestamp with time zone", "published_by": "uuid"} {
		var got, nullable string
		if err := pool.QueryRow(context.Background(), `SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='vacancy_processes' AND column_name=$1`, column).Scan(&got, &nullable); err != nil {
			t.Fatal(err)
		}
		if got != typ || nullable != "NO" {
			t.Fatalf("%s type=%s nullable=%s", column, got, nullable)
		}
	}
	var primary, foreign, status, company, actor bool
	if err := pool.QueryRow(context.Background(), `SELECT
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vacancy_processes'::regclass AND contype='p'),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vacancy_processes'::regclass AND contype='f' AND confrelid='job_drafts'::regclass AND confdeltype='c'),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vacancy_processes'::regclass AND conname='vacancy_process_status'),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vacancy_processes'::regclass AND contype='f' AND confrelid='companies'::regclass),
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vacancy_processes'::regclass AND contype='f' AND confrelid='users'::regclass)`).Scan(&primary, &foreign, &status, &company, &actor); err != nil {
		t.Fatal(err)
	}
	if !primary || !foreign || !status || !company || !actor {
		t.Fatalf("constraints=%v %v %v %v %v", primary, foreign, status, company, actor)
	}
	gooseDownTo(t, db, 18)
	if columnExists(t, pool, "vacancy_processes", "id") || !columnExists(t, pool, "job_drafts", "id") || !columnExists(t, pool, "job_draft_management_configs", "draft_id") || !columnExists(t, pool, "jobs", "id") || !columnExists(t, pool, "applications", "id") {
		t.Fatal("down must remove only publication state")
	}
}
