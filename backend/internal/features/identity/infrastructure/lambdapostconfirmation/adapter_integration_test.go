//go:build integration

package lambdapostconfirmation

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestAdapter_RepeatedDeliveryLeavesOneUser drives the full event -> adapter
// -> application handler -> PostgreSQL user repository path twice with the
// same Cognito event and proves the idempotent upsert leaves exactly one
// user row. It follows the project's disposable integration pattern: build
// tag `integration`, DATABASE_URL gated, unique fixtures, guaranteed cleanup.
//
// Per the WS4B-A redaction contract, no DATABASE_URL value and no raw
// database error text is ever printed.
func TestAdapter_RepeatedDeliveryLeavesOneUser(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skip("cannot connect to Postgres; skipping integration test")
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skip("cannot ping Postgres; skipping integration test")
	}

	t.Setenv("IDENTITY_POSTCONFIRMATION_ENABLED", "true")

	sub := "it-" + uuid.NewString()
	email := "it-" + uuid.NewString() + "@example.com"
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE cognito_sub = $1`, sub)
	})
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE cognito_sub = $1`, sub); err != nil {
		t.Fatal("fixture cleanup query failed")
	}

	repo := identitypostgres.NewUserRepository(db.New(pool))
	handler := application.NewPostConfirmationHandler(repo)
	adapter := NewAdapter(handler)

	event := postConfirmationEvent("PostConfirmation_ConfirmSignUp", map[string]string{
		"sub":            sub,
		"email":          email,
		"name":           "Integration Test",
		"cognito:groups": `["candidates"]`,
	})

	// First delivery: creates the user.
	if err := adapter.Handle(ctx, event); err != nil {
		t.Fatal("first delivery failed")
	}
	// Second delivery of the same event: must be an idempotent no-op.
	if err := adapter.Handle(ctx, event); err != nil {
		t.Fatal("second delivery failed")
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE cognito_sub = $1`, sub).Scan(&count); err != nil {
		t.Fatal("user count query failed")
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 user row after repeated delivery, got %d", count)
	}
}
