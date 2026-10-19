//go:build integration

package migrations_test

import (
	"context"
	"testing"
)

func TestMigration00031VacancyGeographyUpDown(t *testing.T) {
	sqlDB, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, sqlDB)
	defer gooseUpAll(t, sqlDB)
	ctx := context.Background()
	for col, typ := range map[string]string{"country_code": "bpchar", "state_code": "bpchar", "municipality_code": "bpchar", "postal_code": "bpchar", "remote_scope_kind": "text", "remote_countries": "_bpchar"} {
		var got string
		if err := pool.QueryRow(ctx, `SELECT udt_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='vacancy_public_projections' AND column_name=$1`, col).Scan(&got); err != nil || got != typ {
			t.Fatal(col, got, err)
		}
	}
	if columnExists(t, pool, "vacancy_public_projections", "location") {
		t.Fatal("old projection column retained")
	}
	var foreign, indexes int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_constraint WHERE conrelid='vacancy_public_projections'::regclass AND confrelid IN ('geo_countries'::regclass,'geo_states'::regclass,'geo_municipalities'::regclass)`).Scan(&foreign); err != nil || foreign != 3 {
		t.Fatal("geo FKs", foreign, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname IN ('vacancy_public_state_idx','vacancy_public_municipality_idx','vacancy_public_remote_countries_idx')`).Scan(&indexes); err != nil || indexes != 3 {
		t.Fatal("indexes", indexes, err)
	}
	gooseDownTo(t, sqlDB, 30)
	if !columnExists(t, pool, "vacancy_public_projections", "location") || columnExists(t, pool, "vacancy_public_projections", "country_code") {
		t.Fatal("down shape")
	}
	// G1 catalog and legacy jobs stay untouched.
	if !columnExists(t, pool, "geo_countries", "code") || !columnExists(t, pool, "jobs", "location") {
		t.Fatal("down changed another cut")
	}
	gooseUpTo(t, sqlDB, 31)
}
