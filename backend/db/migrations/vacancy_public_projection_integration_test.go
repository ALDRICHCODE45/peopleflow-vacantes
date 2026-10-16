//go:build integration

package migrations_test

import (
	"context"
	"testing"
)

func TestMigration00020PublicProjectionUpDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	defer gooseUpAll(t, db)
	for col, typ := range map[string]string{"id": "uuid", "company_id": "uuid", "title": "text", "description": "jsonb", "description_plain": "text", "benefits": "jsonb", "compensation": "jsonb", "work_schedule": "text", "contract_type": "text", "professional_area": "text", "published_at": "timestamp with time zone", "source_draft_version": "bigint", "search_vector": "tsvector"} {
		var got string
		if err := pool.QueryRow(context.Background(), `SELECT udt_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='vacancy_public_projections' AND column_name=$1`, col).Scan(&got); err != nil {
			t.Fatal(err)
		}
		// information_schema.data_type exposes tsvector as USER-DEFINED, hence udt_name.
		want := typ
		switch typ {
		case "timestamp with time zone":
			want = "timestamptz"
		case "bigint":
			want = "int8"
		}
		if got != want {
			t.Fatalf("%s=%s want %s", col, got, want)
		}
	}
	var fk, gin, generated bool
	if err := pool.QueryRow(context.Background(), `SELECT
 EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='vacancy_public_projections'::regclass AND contype='f' AND confrelid='vacancy_processes'::regclass AND confdeltype='c'),
 EXISTS(SELECT 1 FROM pg_indexes WHERE tablename='vacancy_public_projections' AND schemaname=current_schema() AND indexdef LIKE '%USING gin (search_vector)%'),
 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='vacancy_public_projections' AND column_name='search_vector' AND is_generated='ALWAYS')`).Scan(&fk, &gin, &generated); err != nil {
		t.Fatal(err)
	}
	if !fk || !gin || !generated {
		t.Fatal("missing projection FK/generated search/GIN")
	}
	gooseDownTo(t, db, 19)
	if columnExists(t, pool, "vacancy_public_projections", "id") || !columnExists(t, pool, "vacancy_processes", "id") || !columnExists(t, pool, "jobs", "id") {
		t.Fatal("down removed non-projection state")
	}
}
