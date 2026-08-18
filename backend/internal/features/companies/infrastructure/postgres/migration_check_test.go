//go:build integration

// Package postgres_migration_check exercises the migration 00003 constraints
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

func skipIfNoDatabase(t *testing.T) *pgxpool.Pool {
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

// TestCompaniesProfileMigrationAcceptsValidSize verifies that the CHECK
// constraint added in migration 00003 admits each member of the closed size
// set.
func TestCompaniesProfileMigrationAcceptsValidSize(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Use a deterministic industry_id; if FK to industries is required we
	// fall back to inserting a synthetic row.
	industryID := "integration-test-industry"
	_, _ = pool.Exec(ctx,
		`INSERT INTO industries (id, label_es, label_en, sort_order, active)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (id) DO NOTHING`,
		industryID, "Test", "Test", 0, true,
	)

	for _, size := range []string{"startup", "small", "medium", "large", "enterprise"} {
		t.Run("size="+size, func(t *testing.T) {
			id := uuid.New()
			_, err := pool.Exec(ctx,
				`INSERT INTO companies
				 (id, name, rfc, industry_id, size)
				 VALUES ($1, $2, $3, $4, $5)`,
				id, "Acme "+size, id.String()[:12], industryID, size,
			)
			if err != nil {
				t.Errorf("CHECK constraint rejected valid size %q: %v", size, err)
			}
		})
	}
}

// TestCompaniesProfileMigrationRejectsInvalidSize verifies the CHECK
// constraint blocks values outside the closed size set.
func TestCompaniesProfileMigrationRejectsInvalidSize(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	industryID := "integration-test-industry"

	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO companies
		 (id, name, rfc, industry_id, size)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, "ShouldFail SA", id.String()[:12], industryID, "gigantic",
	)
	if err == nil {
		// Cleanup if the row slipped through (it shouldn't)
		_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for size='gigantic', got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" { // check_violation
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}

// TestCompaniesProfileMigrationRejectsOutOfRangeYear covers the founded_year
// CHECK constraint as well.
func TestCompaniesProfileMigrationRejectsOutOfRangeYear(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	industryID := "integration-test-industry"
	id := uuid.New()
	_, err := pool.Exec(ctx,
		`INSERT INTO companies
		 (id, name, rfc, industry_id, founded_year)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, "OldCompany SA", id.String()[:12], industryID, 1700,
	)
	if err == nil {
		_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, id)
		t.Fatal("expected CHECK violation for founded_year=1700, got nil")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23514" {
		t.Errorf("expected SQLSTATE 23514 (check_violation), got %q", pgErr.Code)
	}
}
