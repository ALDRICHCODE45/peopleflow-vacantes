//go:build integration

// Package postgres exercises migration 00011 (audit_events schema) and its
// append-only invariants against a real PostgreSQL instance. It runs only
// when the integration build tag is set AND a DATABASE_URL is provided, so
// CI on machines without a DB stays fast.
//
// These tests assume `make db-migrate` has already applied 00011 (and the
// preceding migrations 00001..00010). The down test DROPs the table manually
// and recreates it with an inline DDL constant so the schema is left in a
// usable state for later tests.
//
// The 7 tests below mirror the design §7 Phase E inventory (items 18–24) and
// the audit_events spec scenario set. They are the RED for the migration
// 00011 DDL (docs/modelo-de-datos-proyecto-04.md §3.9 verbatim): the live
// Postgres executes them; machines without DATABASE_URL skip them via
// t.Skip.
package postgres

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// skipIfNoDatabaseForAuditEvents mirrors the helper used by the jobs /
// candidates / identity / applications integration suites. Kept
// package-local so each suite evolves independently.
func skipIfNoDatabaseForAuditEvents(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot connect to Postgres: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot ping Postgres: %v", err)
	}
	return pool
}

// TestMigration00011_UpCreatesNamedObjects — spec scenario: after `goose up`,
// `audit_events`, the named CHECK `audit_events_actor_type_check`, and the
// index `audit_events_entity_idx` must exist.
func TestMigration00011_UpCreatesNamedObjects(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// table exists
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query audit_events table: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `audit_events` to exist after 00011 up")
	}

	// named CHECK constraint exists
	var hasCheck bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.table_constraints
			WHERE table_name = 'audit_events' AND constraint_name = 'audit_events_actor_type_check'
		)`,
	).Scan(&hasCheck); err != nil {
		t.Fatalf("query check constraint audit_events_actor_type_check: %v", err)
	}
	if !hasCheck {
		t.Error("expected check constraint audit_events_actor_type_check to exist")
	}

	// index exists
	var hasIdx bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM pg_indexes
			WHERE tablename = 'audit_events' AND indexname = 'audit_events_entity_idx'
		)`,
	).Scan(&hasIdx); err != nil {
		t.Fatalf("query index audit_events_entity_idx: %v", err)
	}
	if !hasIdx {
		t.Error("expected index audit_events_entity_idx to exist")
	}
}

// TestMigration00011_DownDropsTableAndIndex — the 00011 down body drops the
// table; the index drops with it. The test then recreates the schema via the
// inline createAuditEventsTableDDL constant so later tests keep working.
func TestMigration00011_DownDropsTableAndIndex(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Mirror the down body: DROP TABLE audit_events (no IF EXISTS).
	if _, err := pool.Exec(ctx, `DROP TABLE audit_events`); err != nil {
		t.Fatalf("drop audit_events table: %v", err)
	}

	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query audit_events table: %v", err)
	}
	if hasTable {
		t.Fatal("expected table `audit_events` to be gone after DROP")
	}

	var hasIdx bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM pg_indexes
			WHERE tablename = 'audit_events' AND indexname = 'audit_events_entity_idx'
		)`,
	).Scan(&hasIdx); err != nil {
		t.Fatalf("query index audit_events_entity_idx: %v", err)
	}
	if hasIdx {
		t.Fatal("expected index audit_events_entity_idx to be gone after DROP TABLE")
	}

	// Re-apply the up so the schema is left in a state usable by later tests.
	if _, err := pool.Exec(ctx, createAuditEventsTableDDL); err != nil {
		t.Fatalf("re-create audit_events table: %v", err)
	}
}

// createAuditEventsTableDDL mirrors the up migration body
// (docs/modelo-de-datos-proyecto-04.md §3.9 verbatim) so the down test can
// restore the schema after dropping it. Kept in sync by hand.
const createAuditEventsTableDDL = `
CREATE TABLE audit_events (
    id           UUID PRIMARY KEY,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id     UUID,
    actor_type   TEXT NOT NULL
        CONSTRAINT audit_events_actor_type_check
        CHECK (actor_type IN ('user', 'system')),
    event_type   TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    UUID NOT NULL,
    metadata     JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_events_entity_idx
    ON audit_events (entity_type, entity_id, occurred_at DESC);
`

// TestAuditEvents_RequiredFieldsRejectNull — spec scenario: actor_type,
// event_type, entity_type and entity_id are NOT NULL; a NULL in any of them
// must surface as SQLSTATE 23502.
func TestAuditEvents_RequiredFieldsRejectNull(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearAuditEvents(ctx, t, pool)

	cases := []struct {
		name string
		sql  string
		args []any
	}{
		{
			"actor_type NULL",
			`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
			 VALUES ($1, NULL, $2, $3, $4)`,
			[]any{uuid.New(), "ApplicationSubmitted", "application", uuid.New()},
		},
		{
			"event_type NULL",
			`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
			 VALUES ($1, $2, NULL, $3, $4)`,
			[]any{uuid.New(), "user", "application", uuid.New()},
		},
		{
			"entity_type NULL",
			`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
			 VALUES ($1, $2, $3, NULL, $4)`,
			[]any{uuid.New(), "user", "ApplicationSubmitted", uuid.New()},
		},
		{
			"entity_id NULL",
			`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
			 VALUES ($1, $2, $3, $4, NULL)`,
			[]any{uuid.New(), "user", "ApplicationSubmitted", "application"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, tc.sql, tc.args...)
			if err == nil {
				t.Fatal("expected NOT NULL violation, got nil")
			}
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) {
				t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
			}
			if pgErr.Code != "23502" {
				t.Errorf("expected SQLSTATE 23502, got %q", pgErr.Code)
			}
		})
	}
}

// TestAuditEvents_MetadataDefaultsEmptyObject — spec scenario: an INSERT
// omitting metadata stores the JSONB DEFAULT '{}' (an empty object), never
// SQL NULL.
func TestAuditEvents_MetadataDefaultsEmptyObject(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearAuditEvents(ctx, t, pool)

	id := uuid.New()
	entityID := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
		 VALUES ($1, 'user', 'ApplicationSubmitted', 'application', $2)`,
		id, entityID,
	); err != nil {
		t.Fatalf("insert row without metadata: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_events WHERE id = $1`, id)
	})

	var isNotNull bool
	var metadata string
	if err := pool.QueryRow(ctx,
		`SELECT metadata IS NOT NULL, metadata::text FROM audit_events WHERE id = $1`, id,
	).Scan(&isNotNull, &metadata); err != nil {
		t.Fatalf("read metadata: %v", err)
	}
	if !isNotNull {
		t.Error("metadata: want NOT NULL, got NULL")
	}
	if metadata != "{}" {
		t.Errorf("metadata: want %q, got %q", "{}", metadata)
	}
}

// TestAuditEvents_EventTypeNotCheckConstrained — the §1.3 exception: event
// types grow constantly, so event_type carries NO CHECK. An arbitrary future
// value must be accepted by the schema.
func TestAuditEvents_EventTypeNotCheckConstrained(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearAuditEvents(ctx, t, pool)

	id := uuid.New()
	entityID := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
		 VALUES ($1, 'user', 'FutureUnknownEvent', 'application', $2)`,
		id, entityID,
	); err != nil {
		t.Fatalf("insert row with unconstrained event_type: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM audit_events WHERE id = $1`, id)
	})

	var eventType string
	if err := pool.QueryRow(ctx,
		`SELECT event_type FROM audit_events WHERE id = $1`, id,
	).Scan(&eventType); err != nil {
		t.Fatalf("read event_type: %v", err)
	}
	if eventType != "FutureUnknownEvent" {
		t.Errorf("event_type: want %q, got %q", "FutureUnknownEvent", eventType)
	}
}

// TestAuditEvents_ActorTypeCheckRejectsOutOfVocabulary — the closed actor
// vocabulary is enforced at the DB boundary: 'robot' must fail with SQLSTATE
// 23514.
func TestAuditEvents_ActorTypeCheckRejectsOutOfVocabulary(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearAuditEvents(ctx, t, pool)

	_, err := pool.Exec(ctx,
		`INSERT INTO audit_events (id, actor_type, event_type, entity_type, entity_id)
		 VALUES ($1, 'robot', 'ApplicationSubmitted', 'application', $2)`,
		uuid.New(), uuid.New(),
	)
	if err == nil {
		t.Fatal("expected CHECK violation, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514, got %q", pgErr.Code)
	}
}

// TestAuditEvents_StructurallyAppendOnly — the audit log is structurally
// append-only: no updated_at, no deleted_at, no FK on actor_id, and no
// foreign key constraints reference audit_events (it survives its actors).
func TestAuditEvents_StructurallyAppendOnly(t *testing.T) {
	pool := skipIfNoDatabaseForAuditEvents(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// The whole assertion set is meaningless without the table: fail loudly
	// (RED) when the migration has not been applied instead of passing
	// vacuously.
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_events')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query audit_events table: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `audit_events` to exist (run make db-migrate first)")
	}

	// no updated_at column
	var hasUpdatedAt bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'audit_events' AND column_name = 'updated_at'
		)`,
	).Scan(&hasUpdatedAt); err != nil {
		t.Fatalf("query updated_at column: %v", err)
	}
	if hasUpdatedAt {
		t.Error("audit_events must NOT have an updated_at column (append-only)")
	}

	// no deleted_at column
	var hasDeletedAt bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_name = 'audit_events' AND column_name = 'deleted_at'
		)`,
	).Scan(&hasDeletedAt); err != nil {
		t.Fatalf("query deleted_at column: %v", err)
	}
	if hasDeletedAt {
		t.Error("audit_events must NOT have a deleted_at column (append-only)")
	}

	// no FK on actor_id (actor_id is a bare UUID by design)
	var actorIDHasFK bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1
			FROM information_schema.key_column_usage kcu
			JOIN information_schema.table_constraints tc
			  ON tc.constraint_name = kcu.constraint_name
			 AND tc.table_schema   = kcu.table_schema
			 AND tc.table_name     = kcu.table_name
			WHERE kcu.table_name = 'audit_events'
			  AND kcu.column_name = 'actor_id'
			  AND tc.constraint_type = 'FOREIGN KEY'
		)`,
	).Scan(&actorIDHasFK); err != nil {
		t.Fatalf("query actor_id FK: %v", err)
	}
	if actorIDHasFK {
		t.Error("audit_events.actor_id must NOT be a foreign key (the log survives its actors)")
	}

	// no foreign key constraints reference audit_events
	var referencedByFK bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM pg_constraint
			WHERE contype = 'f' AND confrelid = 'audit_events'::regclass
		)`,
	).Scan(&referencedByFK); err != nil {
		t.Fatalf("query FKs referencing audit_events: %v", err)
	}
	if referencedByFK {
		t.Error("no table may hold a foreign key referencing audit_events")
	}
}

// --- helpers -------------------------------------------------------------

// clearAuditEvents empties the audit_events table so the schema tests never
// collide with a row left behind by a previous run or sibling test. Safe:
// audit_events has no FK dependents and no UNIQUE constraints beyond the PK,
// and these tests only prove constraints/defaults.
func clearAuditEvents(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `DELETE FROM audit_events`); err != nil {
		t.Fatalf("clear audit_events: %v", err)
	}
}
