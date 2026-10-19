//go:build integration

package migrations_test

import (
	"bytes"
	"context"
	"io/fs"
	"strings"
	"testing"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/google/uuid"
)

// Run the SQL helper itself on one pinned session; no Go copy of its scanner
// is an oracle. This also checks that down's helper works without a prior up.
func TestMigration00031ScannerNULAndEscapedDelimiterFixtures(t *testing.T) {
	_, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00031_vacancy_geography.sql")
	if err != nil {
		t.Fatal(err)
	}
	halves := strings.Split(string(raw), "-- +goose Down")
	for index, half := range halves {
		t.Run([]string{"up session", "down session"}[index], func(t *testing.T) {
			_, definition, ok := strings.Cut(half, "CREATE OR REPLACE FUNCTION pg_temp.geo_canonical")
			if !ok {
				t.Fatal("missing helper")
			}
			definition, _, ok = strings.Cut(definition, "UPDATE job_drafts")
			if !ok {
				t.Fatal("incomplete helper")
			}
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			if _, err := tx.Exec(ctx, "CREATE OR REPLACE FUNCTION pg_temp.geo_canonical"+definition); err != nil {
				t.Fatal(err)
			}
			for _, fixture := range earlierDraftFixtures {
				t.Run(fixture.name, func(t *testing.T) {
					for _, up := range []bool{true, false} {
						var got []byte
						want := expectedGeographyDocument(t, []byte(fixture.body), up)
						if err := tx.QueryRow(ctx, `SELECT pg_temp.geo_rewrite($1::bytea,$2::boolean)`, []byte(fixture.body), up).Scan(&got); err != nil || !bytes.Equal(got, want) {
							t.Fatalf("up=%t got=%s want=%s err=%v", up, got, want, err)
						}
					}
				})
			}
			for _, schema := range []int64{1, 2} {
				for _, location := range []any{nil, "old\x00 discarded location", map[string]any{"country": "MX", "state": "14"}} {
					draft, err := draftinput.DecodeCreateV2([]byte(nulMigrationFixture))
					if err != nil {
						t.Fatal(err)
					}
					value, err := draftjson.Decode(draft.Fingerprint())
					if err != nil {
						t.Fatal(err)
					}
					root := value.(map[string]any)
					root["schema_version"] = schema
					fields := root["fields"].(map[string]any)
					fields["location"] = location
					// The same frozen lexemes must survive both directions, independently.
					for _, up := range []bool{true, false} {
						fields["location"] = location
						fields["remote_scope"] = map[string]any{"kind": "countries", "countries": []any{"CO", "MX"}}
						before, err := draftjson.EncodeValidatedValue(root)
						if err != nil {
							t.Fatal(err)
						}
						if _, oldString := location.(string); !up || oldString {
							fields["location"] = nil
						}
						delete(fields, "remote_scope")
						if up {
							fields["remote_scope"] = nil
						}
						want, err := draftjson.EncodeValidatedValue(root)
						if err != nil {
							t.Fatal(err)
						}
						var got []byte
						if err := tx.QueryRow(ctx, `SELECT pg_temp.geo_rewrite($1::bytea,$2::boolean)`, before, up).Scan(&got); err != nil || !bytes.Equal(got, want) {
							t.Fatalf("schema=%d up=%t got=%s want=%s err=%v", schema, up, got, want, err)
						}
					}
				}
			}
		})
	}
}

func TestMigration00031HistoricalStoredFixturesUpDown(t *testing.T) {
	sqlDB, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, sqlDB)
	gooseDownTo(t, sqlDB, 30)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	ids := make([]uuid.UUID, 0, len(earlierDraftFixtures))
	defer func() {
		if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=ANY($1::uuid[])`, ids); err != nil {
			t.Error(err)
		}
		gooseUpAll(t, sqlDB)
	}()
	for _, fixture := range earlierDraftFixtures {
		id := uuid.New()
		ids = append(ids, id)
		insertDraftAt(t, pool, company, actor, id, []byte(fixture.body))
	}
	gooseUpTo(t, sqlDB, 31)
	assertRows := func(up bool, version int64) {
		t.Helper()
		for i, id := range ids {
			want := expectedGeographyDocument(t, []byte(earlierDraftFixtures[i].body), true)
			if !up {
				want = expectedGeographyDocument(t, want, false)
			}
			var got []byte
			var gotVersion int64
			if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, id).Scan(&got, &gotVersion); err != nil || gotVersion != version || !bytes.Equal(got, want) {
				t.Fatalf("%s up=%t version=%d got=%s want=%s err=%v", earlierDraftFixtures[i].name, up, gotVersion, got, want, err)
			}
		}
	}
	assertRows(true, 2)
	gooseDownTo(t, sqlDB, 30)
	assertRows(false, 3)
}

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
