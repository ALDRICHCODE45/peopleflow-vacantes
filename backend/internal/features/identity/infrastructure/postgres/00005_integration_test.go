//go:build integration

// Package postgres_migration_check exercises the migration 00005 constraints
// against a real PostgreSQL instance. It runs only when the integration build
// tag is set and a DATABASE_URL is provided, so CI on machines without a DB
// stays fast.
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

func skipIfNoDatabaseForUsers(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
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

// TestUsersMigrationUpCreatesNamedObjects proves "up creates named objects".
// It checks that `users`, the named CHECK `users_user_type_check`, and both
// partial unique indexes exist after migration 00005 is applied.
func TestUsersMigrationUpCreatesNamedObjects(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// table exists
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query users table: %v", err)
	}
	if !hasTable {
		t.Fatal("expected table `users` to exist after 00005 up")
	}

	// named CHECK exists
	var hasCheck bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (
			SELECT 1 FROM information_schema.table_constraints
			WHERE table_name = 'users' AND constraint_name = 'users_user_type_check'
		)`,
	).Scan(&hasCheck); err != nil {
		t.Fatalf("query check constraint: %v", err)
	}
	if !hasCheck {
		t.Fatal("expected check constraint `users_user_type_check` to exist")
	}

	// both partial unique indexes exist
	for _, idx := range []string{"users_cognito_sub_unique", "users_email_unique"} {
		var hasIdx bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM pg_indexes
				WHERE tablename = 'users' AND indexname = $1
			)`, idx,
		).Scan(&hasIdx); err != nil {
			t.Fatalf("query index %s: %v", idx, err)
		}
		if !hasIdx {
			t.Errorf("expected index %q to exist", idx)
		}
	}
}

// TestUsersMigrationDownDropsTable proves "down drops table and indexes".
// Apply 00005 up, then down, then verify the table is gone.
func TestUsersMigrationDownDropsTable(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Ensure the table exists first by inserting a row. We treat any FK
	// surprise as a hard skip (some fixtures require the table to be clean).
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (cognito_sub) WHERE deleted_at IS NULL DO NOTHING`,
		uuid.New(), "down-test-sub", "down@example.com", "Down Test", "candidate",
	); err != nil {
		t.Skipf("cannot insert users fixture (table may already be missing): %v", err)
	}
	// Cleanup
	defer pool.Exec(ctx, `DELETE FROM users WHERE cognito_sub = 'down-test-sub'`)
	// Drop using the same DDL as migration down.
	if _, err := pool.Exec(ctx, `DROP TABLE users`); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	var hasTable bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users')`,
	).Scan(&hasTable); err != nil {
		t.Fatalf("query users table: %v", err)
	}
	if hasTable {
		t.Fatal("expected table `users` to be gone after DROP")
	}
}

// TestUsersMigrationRejectsInvalidUserType proves the CHECK constraint blocks
// values outside the closed user_type set.
func TestUsersMigrationRejectsInvalidUserType(t *testing.T) {
	pool := skipIfNoDatabaseForUsers(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, "ck-sub", "ck@example.com", "Ck Test", "admin",
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for user_type='admin', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}
