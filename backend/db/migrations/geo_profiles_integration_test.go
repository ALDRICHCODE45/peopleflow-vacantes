//go:build integration

package migrations_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestGeoProfilesMigrationConstraintsAndEmptyDown(t *testing.T) {
	sqlDB, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, sqlDB)
	gooseDownTo(t, sqlDB, 31)
	defer gooseUpAll(t, sqlDB)
	user, company := uuid.New(), uuid.New()
	industry := "geo-profiles-" + uuid.NewString()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO industries(id,label_es,label_en,sort_order,active) VALUES($1,'Geo','Geo',0,true)`, []any{industry}},
		{`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Geo','candidate')`, []any{user, user.String(), user.String() + "@example.test"}},
		{`INSERT INTO candidate_profiles(user_id,city,country) VALUES($1,'Old city','Old country')`, []any{user}},
		{`INSERT INTO companies(id,name,rfc,industry_id,city,country) VALUES($1,'Geo Company','GEO010101ABC',$2,'Old city','Old country')`, []any{company, industry}},
	} {
		if _, err := pool.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	gooseUpTo(t, sqlDB, 32)
	for _, table := range []string{"candidate_profiles", "companies"} {
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name IN ('city','country')`, table).Scan(&count); err != nil || count != 0 {
			t.Fatal("free text retained", table, count, err)
		}
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE country_code IS NOT NULL OR state_code IS NOT NULL OR municipality_code IS NOT NULL`).Scan(&count); err != nil || count != 0 {
			t.Fatal("unexpected backfill", table, count, err)
		}
	}
	var oldIndex bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('candidate_profiles_city_idx') IS NOT NULL`).Scan(&oldIndex); err != nil || oldIndex {
		t.Fatal("old city index retained", err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, statement := range []string{
		`INSERT INTO geo_countries VALUES('MX','México','Mexico'),('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_states VALUES('MX','14','Jalisco','Jal.'),('MX','15','México','Mex.') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_municipalities VALUES('MX','14','14039','Guadalajara'),('MX','14','14040','Hostotipaquillo') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_postal_codes VALUES('MX','44100','14039') ON CONFLICT DO NOTHING`,
	} {
		if _, err = tx.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"candidate_profiles", "companies"} {
		for _, tc := range []struct {
			name, values string
			valid        bool
		}{
			{"null", `NULL,NULL,NULL`, true},
			{"country", `'US',NULL,NULL`, true},
			{"MX country", `'MX',NULL,NULL`, true},
			{"state", `'MX','14',NULL`, true},
			{"municipality", `'MX','14','14039'`, true},
			{"state without country", `NULL,'14',NULL`, false},
			{"municipality without state", `'MX',NULL,'14039'`, false},
			{"municipality mismatch", `'MX','15','14039'`, false},
			{"international state", `'US','14',NULL`, false},
			{"unknown country", `'ZZ',NULL,NULL`, false},
			{"unknown state", `'MX','99',NULL`, false},
			{"unknown municipality", `'MX','14','14999'`, false},
		} {
			t.Run(table+"/"+tc.name, func(t *testing.T) {
				savepoint, err := tx.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer savepoint.Rollback(ctx)
				_, err = savepoint.Exec(ctx, `UPDATE `+table+` SET (country_code,state_code,municipality_code)=(`+tc.values+`)`)
				if (err == nil) != tc.valid {
					t.Fatalf("valid=%v: %v", tc.valid, err)
				}
			})
		}
	}
	for _, tc := range []struct {
		name, values string
		valid        bool
	}{
		{"postal", `'MX','14','14039','44100'`, true},
		{"unknown postal", `'MX','14','14039','00000'`, false},
		{"postal mismatch", `'MX','14','14040','44100'`, false},
		{"postal requires municipality", `'MX','14',NULL,'44100'`, false},
		{"postal requires country", `NULL,NULL,NULL,'44100'`, false},
		{"postal format", `'MX','14','14039','4410'`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			savepoint, err := tx.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer savepoint.Rollback(ctx)
			_, err = savepoint.Exec(ctx, `UPDATE companies SET (country_code,state_code,municipality_code,postal_code)=(`+tc.values+`)`)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
		})
	}
	// Persist a real structured value to prove down discards it, not just NULLs.
	if _, err = tx.Exec(ctx, `UPDATE candidate_profiles SET country_code='MX',state_code='14',municipality_code='14039'`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE companies SET country_code='MX',state_code='14',municipality_code='14039',postal_code='44100'`); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	gooseDownTo(t, sqlDB, 31)
	for _, table := range []string{"candidate_profiles", "companies"} {
		var count int
		if err = pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` WHERE city IS NOT NULL OR country IS NOT NULL`).Scan(&count); err != nil || count != 0 {
			t.Fatal("down restored nonempty text", table, count, err)
		}
	}
	if err = pool.QueryRow(ctx, `SELECT to_regclass('candidate_profiles_city_idx') IS NOT NULL`).Scan(&oldIndex); err != nil || !oldIndex {
		t.Fatal("down did not restore index", err)
	}
}
