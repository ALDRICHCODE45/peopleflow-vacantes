//go:build integration

package localbootstrap_test

import (
	"context"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	lb "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/localbootstrap"
	identitypg "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestDisposablePostgresBootstrap is opt-in, users-only, and always rolls back.
// Failures are deliberately static: driver errors may contain private DSN data.
// No database, schema, company, membership or existing-user mutations are made.
func TestDisposablePostgresBootstrap(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if _, err := lb.ParseDatabaseTarget(dsn); err != nil {
		t.Fatal("integration requires an explicit authorized loopback DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("private database configuration invalid")
	}
	cfg.MaxConns = 1
	cfg.ConnConfig.ConnectTimeout = 5 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("private pool setup failed")
	}
	defer pool.Close()
	if pool.Ping(ctx) != nil {
		t.Fatal("authorized disposable database unavailable")
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal("transaction setup failed")
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 3*time.Second)
		defer done()
		_ = tx.Rollback(cleanup)
	}()
	repo := identitypg.NewUserRepository(db.New(tx))
	creator := lb.NewUserServiceCreator(usecases.NewUserService(lb.NewCompatibleUserStore(repo)))
	unique := uuid.NewString()
	command := lb.CreateUserCommand{CognitoSub: "tmp-bootstrap-integration-" + unique, Email: "bootstrap-" + unique + "@example.invalid", FullName: "Synthetic Integration Person", UserType: "recruiter"}
	otherSub := "tmp-bootstrap-email-conflict-" + unique

	t.Run("created", func(t *testing.T) {
		code, err := creator.Create(ctx, command)
		if err != nil || code != lb.CreateCodeCreated {
			t.Fatal("fresh synthetic user must be created")
		}
	})
	original, err := repo.GetByCognitoSub(ctx, command.CognitoSub)
	if err != nil {
		t.Fatal("created synthetic user unavailable")
	}
	if original.Email.Value() != command.Email || original.FullName.Value() != command.FullName || original.UserType.String() != command.UserType {
		t.Fatal("stored synthetic profile does not match validated creation input")
	}
	unchanged := func(t *testing.T) {
		t.Helper()
		current, err := repo.GetByCognitoSub(ctx, command.CognitoSub)
		if err != nil || !reflect.DeepEqual(original, current) {
			t.Fatal("rejected or repeated input changed stored synthetic user")
		}
		var count int
		if tx.QueryRow(ctx, "SELECT count(*) FROM users WHERE cognito_sub IN ($1,$2)", command.CognitoSub, otherSub).Scan(&count) != nil || count != 1 {
			t.Fatal("unexpected synthetic user count")
		}
	}
	t.Run("already_exists_is_unchanged", func(t *testing.T) {
		code, err := creator.Create(ctx, command)
		if err != nil || code != lb.CreateCodeAlreadyExists {
			t.Fatal("identical repeat must report already_exists")
		}
		unchanged(t)
	})
	for _, field := range []string{"email", "full_name", "user_type"} {
		t.Run("profile_conflict_"+field, func(t *testing.T) {
			conflicting := command
			switch field {
			case "email":
				conflicting.Email = "changed-" + unique + "@example.invalid"
			case "full_name":
				conflicting.FullName = "Different Synthetic Person"
			case "user_type":
				conflicting.UserType = "candidate"
			}
			if _, err := creator.Create(ctx, conflicting); !errors.Is(err, lb.ErrIdentityConflict) {
				t.Fatal("incompatible profile must report identity_conflict")
			}
			unchanged(t)
		})
	}
	t.Run("email_conflict_no_relink", func(t *testing.T) {
		// The real unique violation aborts its savepoint, not the outer fixture.
		nested, err := tx.Begin(ctx)
		if err != nil {
			t.Fatal("conflict savepoint setup failed")
		}
		scoped := lb.NewUserServiceCreator(usecases.NewUserService(lb.NewCompatibleUserStore(identitypg.NewUserRepository(db.New(nested)))))
		conflicting := command
		conflicting.CognitoSub = otherSub
		_, createErr := scoped.Create(ctx, conflicting)
		if nested.Rollback(ctx) != nil {
			t.Fatal("conflict savepoint rollback failed")
		}
		if !errors.Is(createErr, lb.ErrIdentityConflict) {
			t.Fatal("taken email must report identity_conflict")
		}
		if _, err := repo.GetByCognitoSub(ctx, otherSub); !errors.Is(err, entities.ErrUserNotFound) {
			t.Fatal("email conflict created or relinked a synthetic user")
		}
		unchanged(t)
	})
	if tx.Rollback(ctx) != nil {
		t.Fatal("fixture rollback failed")
	}
	publicRepo := identitypg.NewUserRepository(db.New(pool))
	for _, sub := range []string{command.CognitoSub, otherSub} {
		if _, err := publicRepo.GetByCognitoSub(ctx, sub); !errors.Is(err, entities.ErrUserNotFound) {
			t.Fatal("rollback left a permanent synthetic user")
		}
	}
	t.Log("POSTGRES_BOOTSTRAP_PASS: created, unchanged repeat, profile/email conflicts, no relink and rollback verified; users-only")
}
