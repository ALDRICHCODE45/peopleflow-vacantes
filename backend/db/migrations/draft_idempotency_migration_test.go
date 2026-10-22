//go:build integration

// Migration 00013 (`version_draft_idempotency_fingerprint`) contract coverage:
// up tags pre-existing rows as legacy and preserves their fingerprint bytes,
// down refuses transactionally while any non-legacy row exists, and a
// legacy-only table drops cleanly.
//
// DRAFT_TEST_DATABASE_URL must identify loopback + draft_test. Each test creates
// a separate draft_test_mig_* database on that server and drops only its own
// database at cleanup. Rollbacks never migrate the shared harness or an ambient
// DATABASE_URL. The connection role needs CREATEDB.
package migrations_test

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

const (
	migrationIsolatedDSNEnv = "DRAFT_TEST_DATABASE_URL"
	migrationIsolatedDBName = "draft_test"
	legacyAlgorithmTag      = "go-json-v1+canonical-bytes"
	sha256AlgorithmTag      = "go-json-v1+sha256"
)

// isolatedMigrationDB uses the guarded shared DSN only to create a unique
// draft_test_mig_* database. Rollbacks never touch the shared harness database.
// Both deferred cleanup and t.Cleanup are supported, including setup failures.
func isolatedMigrationDB(t *testing.T) (*sql.DB, *pgxpool.Pool, func()) {
	t.Helper()

	dsn := os.Getenv(migrationIsolatedDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated migration test", migrationIsolatedDSNEnv)
	}

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", migrationIsolatedDSNEnv, err)
	}
	if cfg.ConnConfig.Database != migrationIsolatedDBName || !migrationLoopback(cfg.ConnConfig.Host) {
		t.Fatalf("refusing non-isolated database: host=%q database=%q (want loopback + %q)",
			cfg.ConnConfig.Host, cfg.ConnConfig.Database, migrationIsolatedDBName)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	admin, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatalf("connect bootstrap: %v", err)
	}
	t.Cleanup(admin.Close)
	name := "draft_test_mig_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	cfg = cfg.Copy()
	cfg.ConnConfig.Database = name
	if !migrationLoopback(cfg.ConnConfig.Host) || !strings.HasPrefix(name, "draft_test_") || name == migrationIsolatedDBName {
		t.Fatal("refusing unsafe disposable database")
	}
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatalf("create migration database (CREATEDB required): %v", err)
	}
	var pool *pgxpool.Pool
	var sqlDB *sql.DB
	var once sync.Once
	cleanup := func() {
		once.Do(func() {
			if sqlDB != nil {
				if err := sqlDB.Close(); err != nil {
					t.Errorf("close migration SQL wrapper: %v", err)
				}
			}
			if pool != nil {
				pool.Close()
			}
			cleanupCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
			defer stop()
			if _, err := admin.Exec(cleanupCtx, "DROP DATABASE "+quoted); err != nil {
				t.Errorf("drop owned migration database %s: %v", name, err)
			}
		})
	}
	t.Cleanup(cleanup)
	pool, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("connect migration database: %v", err)
	}
	sqlDB = stdlib.OpenDBFromPool(pool)
	gooseUpAll(t, sqlDB)
	return sqlDB, pool, cleanup
}

func migrationLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1", "[::1]":
		return true
	default:
		return false
	}
}

// resetToVersion12 clears every draft-idempotency row and lands the schema
// exactly at 00012, the last pre-00013 state. Clearing first guarantees the
// 00013 down half cannot refuse for a row this suite did not create.
func resetToVersion12(t *testing.T, db *sql.DB, pool *pgxpool.Pool) {
	t.Helper()

	gooseUpAll(t, db)

	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM job_draft_idempotency`); err != nil {
		t.Fatalf("clear idempotency rows: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM job_drafts`); err != nil {
		t.Fatalf("clear draft rows: %v", err)
	}

	gooseDownTo(t, db, 12)
}

// gooseDownOnce applies exactly the down half of the current version and
// returns goose's error so a caller can assert a refusal.
func gooseDownOnce(t *testing.T, db *sql.DB) error {
	t.Helper()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose SetDialect: %v", err)
	}
	return goose.Down(db, ".")
}

func columnExists(t *testing.T, pool *pgxpool.Pool, table, column string) bool {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(),
		`SELECT EXISTS (
		    SELECT 1 FROM information_schema.columns
		    WHERE table_name = $1 AND column_name = $2
		)`,
		table, column,
	).Scan(&exists); err != nil {
		t.Fatalf("probe column %s.%s: %v", table, column, err)
	}
	return exists
}

// insertDraftAt seeds a minimal job_drafts row so a seeded idempotency row
// resolves to an existing company-scoped draft.
func insertDraftAt(t *testing.T, pool *pgxpool.Pool, companyID, actorID, draftID uuid.UUID, fields []byte) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO job_drafts (id, company_id, created_by, principal_recruiter_id, status, version, fields)
		 VALUES ($1, $2, $3, $3, 'draft', 1, $4)`,
		draftID, companyID, actorID, fields,
	); err != nil {
		t.Fatalf("seed draft row: %v", err)
	}
}

// insertPre00013IdempotencyAt inserts a legacy row using only the 00012 column
// set, because at version 12 the algorithm column does not exist yet.
func insertPre00013IdempotencyAt(t *testing.T, pool *pgxpool.Pool, companyID, actorID uuid.UUID, key string, fingerprint, body []byte) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO job_draft_idempotency
		     (id, company_id, actor_id, operation, idem_key, fingerprint, response_body, response_etag)
		 VALUES ($1, $2, $3, 'create', $4, $5, $6, $7)`,
		uuid.Must(uuid.NewV7()), companyID, actorID, key, fingerprint, body, `"jd-r1-00000000-0000-7000-8000-000000000000-v1"`,
	); err != nil {
		t.Fatalf("seed pre-00013 idempotency row: %v", err)
	}
}

// insertTaggedIdempotencyAt inserts a row with an explicit algorithm tag. Used
// only once 00013 is applied.
func insertTaggedIdempotencyAt(t *testing.T, pool *pgxpool.Pool, companyID, actorID uuid.UUID, key, algorithm string, fingerprint, body []byte) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO job_draft_idempotency
		     (id, company_id, actor_id, operation, idem_key, fingerprint, fingerprint_algorithm, response_body, response_etag)
		 VALUES ($1, $2, $3, 'create', $4, $5, $6, $7, $8)`,
		uuid.Must(uuid.NewV7()), companyID, actorID, key, fingerprint, algorithm, body, `"jd-r1-00000000-0000-7000-8000-000000000000-v1"`,
	); err != nil {
		t.Fatalf("seed tagged idempotency row: %v", err)
	}
}

// TestMigration00013UpTagsLegacyRowsAndPreservesFingerprint proves the up half:
// a row written before 00013 keeps its exact fingerprint bytes and is tagged
// legacy by the column default, and the digest-length constraint exists.
func TestMigration00013UpTagsLegacyRowsAndPreservesFingerprint(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	resetToVersion12(t, db, pool)

	ctx := context.Background()
	_, companyID, userID := seedPrereqs(ctx, t, pool)
	canonical := []byte(`{"schema_version":1,"fields":{"title":"Legacy"}}`)
	draftID := uuid.Must(uuid.NewV7())
	key := uuid.NewString()

	insertDraftAt(t, pool, companyID, userID, draftID, canonical)
	insertPre00013IdempotencyAt(t, pool, companyID, userID, key, canonical, canonical)

	if columnExists(t, pool, "job_draft_idempotency", "fingerprint_algorithm") {
		t.Fatal("fingerprint_algorithm must not exist before 00013 is applied")
	}

	gooseUpTo(t, db, 13)

	if !columnExists(t, pool, "job_draft_idempotency", "fingerprint_algorithm") {
		t.Fatal("00013 up must add fingerprint_algorithm")
	}
	var constraintExists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
		    SELECT 1 FROM information_schema.table_constraints
		    WHERE table_name = 'job_draft_idempotency'
		      AND constraint_name = 'job_draft_idempotency_fingerprint_length_check'
		)`,
	).Scan(&constraintExists); err != nil {
		t.Fatalf("probe length constraint: %v", err)
	}
	if !constraintExists {
		t.Error("00013 up must add the named fingerprint-length constraint")
	}

	var algorithm string
	var stored []byte
	if err := pool.QueryRow(ctx,
		`SELECT fingerprint_algorithm, fingerprint FROM job_draft_idempotency WHERE idem_key = $1`, key,
	).Scan(&algorithm, &stored); err != nil {
		t.Fatalf("read migrated legacy row: %v", err)
	}
	if algorithm != legacyAlgorithmTag {
		t.Errorf("migrated legacy row algorithm: want %q, got %q", legacyAlgorithmTag, algorithm)
	}
	if !bytes.Equal(stored, canonical) {
		t.Errorf("migrated legacy row fingerprint bytes changed\n got: %s\nwant: %s", stored, canonical)
	}
}

// TestMigration00013DownRefusesWhenDigestRowsExist proves the down half refuses
// transactionally while a non-legacy row exists: goose returns an error and the
// algorithm column (and the digest row) survive.
func TestMigration00013DownRefusesWhenDigestRowsExist(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	resetToVersion12(t, db, pool)
	gooseUpTo(t, db, 13)

	ctx := context.Background()
	_, companyID, userID := seedPrereqs(ctx, t, pool)
	canonical := []byte(`{"schema_version":1,"fields":{"title":"Legacy"}}`)
	digest := bytes.Repeat([]byte{0xab}, 32)
	draftID := uuid.Must(uuid.NewV7())
	key := uuid.NewString()

	insertDraftAt(t, pool, companyID, userID, draftID, canonical)
	insertTaggedIdempotencyAt(t, pool, companyID, userID, key, sha256AlgorithmTag, digest, canonical)

	if err := gooseDownOnce(t, db); err == nil {
		t.Fatal("00013 down must refuse while a non-legacy fingerprint row exists")
	}
	if !columnExists(t, pool, "job_draft_idempotency", "fingerprint_algorithm") {
		t.Error("a refused down must leave fingerprint_algorithm in place")
	}

	var algorithm string
	var stored []byte
	if err := pool.QueryRow(ctx,
		`SELECT fingerprint_algorithm, fingerprint FROM job_draft_idempotency WHERE idem_key = $1`, key,
	).Scan(&algorithm, &stored); err != nil {
		t.Fatalf("digest row must survive a refused down: %v", err)
	}
	if algorithm != sha256AlgorithmTag || !bytes.Equal(stored, digest) {
		t.Errorf("refused down must not reinterpret the digest row: algorithm=%q stored=%x", algorithm, stored)
	}
}

// TestMigration00013DownSucceedsForLegacyOnlyRows proves a legacy-only table
// drops cleanly and the legacy fingerprint bytes survive as canonical bytes.
func TestMigration00013DownSucceedsForLegacyOnlyRows(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	resetToVersion12(t, db, pool)
	gooseUpTo(t, db, 13)

	ctx := context.Background()
	_, companyID, userID := seedPrereqs(ctx, t, pool)
	canonical := []byte(`{"schema_version":1,"fields":{"title":"Legacy"}}`)
	draftID := uuid.Must(uuid.NewV7())
	key := uuid.NewString()

	insertDraftAt(t, pool, companyID, userID, draftID, canonical)
	insertTaggedIdempotencyAt(t, pool, companyID, userID, key, legacyAlgorithmTag, canonical, canonical)

	if err := gooseDownOnce(t, db); err != nil {
		t.Fatalf("legacy-only 00013 down must succeed: %v", err)
	}
	if columnExists(t, pool, "job_draft_idempotency", "fingerprint_algorithm") {
		t.Error("00013 down must drop fingerprint_algorithm")
	}

	var stored []byte
	if err := pool.QueryRow(ctx,
		`SELECT fingerprint FROM job_draft_idempotency WHERE idem_key = $1`, key,
	).Scan(&stored); err != nil {
		t.Fatalf("legacy row must survive the down: %v", err)
	}
	if !bytes.Equal(stored, canonical) {
		t.Errorf("legacy fingerprint bytes changed across down\n got: %s\nwant: %s", stored, canonical)
	}
}
