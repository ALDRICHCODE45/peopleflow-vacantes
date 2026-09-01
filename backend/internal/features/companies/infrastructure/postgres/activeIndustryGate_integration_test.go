//go:build integration

package postgres

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type activeIndustryFixture struct {
	industryID string
	userID     uuid.UUID
	company    *entities.Company
	owner      *entities.CompanyMember
}

func newActiveIndustryFixture(t *testing.T, pool *pgxpool.Pool, name string, active *bool) activeIndustryFixture {
	t.Helper()
	suffix := uuid.NewString()[:9]
	f := activeIndustryFixture{industryID: "ws2a-" + name + "-" + suffix, userID: uuid.New()}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if active != nil {
		if _, err := pool.Exec(ctx,
			`INSERT INTO industries (id, label_es, label_en, sort_order, active) VALUES ($1, 'L', 'L', 0, $2)`,
			f.industryID, *active); err != nil {
			t.Fatalf("seed industry: %v", err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type) VALUES ($1, $2, $3, $4, 'recruiter')`,
		f.userID, "sub-"+f.industryID, f.industryID+"@example.com", "WS2A Owner"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var err error
	f.company, err = entities.NewCompany("WS2A "+name, "WGX"+suffix, f.industryID, entities.CompanyProfile{})
	if err != nil {
		t.Fatalf("NewCompany: %v", err)
	}
	f.owner, err = entities.NewCompanyMember(f.userID, f.company.ID, valueobjects.OwnerRole)
	if err != nil {
		t.Fatalf("NewCompanyMember: %v", err)
	}
	return f
}

func (f activeIndustryFixture) cleanup(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, _ = pool.Exec(ctx, `DELETE FROM company_members WHERE company_id = $1`, f.company.ID)
	_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, f.company.ID)
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, f.userID)
	_, _ = pool.Exec(ctx, `DELETE FROM industries WHERE id = $1`, f.industryID)
}

func newActiveIndustryPool(t *testing.T, name string) (*pgxpool.Pool, int32) {
	t.Helper()
	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	cfg.MaxConns, cfg.MinConns = 1, 1
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	cfg.ConnConfig.RuntimeParams["application_name"] = name
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatalf("create bounded pool: %v", err)
	}
	t.Cleanup(pool.Close)
	var pid int32
	if err := pool.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatalf("query backend pid: %v", err)
	}
	return pool, pid
}

func waitForIndustryLock(ctx context.Context, pool *pgxpool.Pool, waitingPID, blockingPID int32) error {
	const query = `SELECT EXISTS (
		SELECT 1 FROM pg_stat_activity
		WHERE pid = $1 AND wait_event_type = 'Lock'
		  AND $2 = ANY(pg_blocking_pids($1)))`
	for ctx.Err() == nil {
		var blocked bool
		if err := pool.QueryRow(ctx, query, waitingPID, blockingPID).Scan(&blocked); err != nil {
			return err
		}
		if blocked {
			return nil
		}
	}
	return ctx.Err()
}

func rollbackIndustryTx(tx interface{ Rollback(context.Context) error }) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}

func assertIndustryRows(t *testing.T, pool *pgxpool.Pool, f activeIndustryFixture, want int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, query := range []string{
		`SELECT count(*) FROM companies WHERE id = $1`,
		`SELECT count(*) FROM company_members WHERE company_id = $1`,
	} {
		var got int
		if err := pool.QueryRow(ctx, query, f.company.ID).Scan(&got); err != nil {
			t.Fatalf("count fixture rows: %v", err)
		}
		if got != want {
			t.Fatalf("rows: want %d, got %d", want, got)
		}
	}
}

func TestCompanyBootstrapRepository_CreateWithOwnerRejectsUnavailableIndustry(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()
	inactive := false
	for _, tc := range []struct {
		name   string
		active *bool
	}{{"inactive", &inactive}, {"unknown", nil}} {
		t.Run(tc.name, func(t *testing.T) {
			f := newActiveIndustryFixture(t, pool, tc.name, tc.active)
			defer f.cleanup(t, pool)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			err := NewCompanyBootstrapRepository(pool).CreateWithOwner(ctx, f.company, f.owner)
			if !errors.Is(err, entities.ErrIndustryUnavailable) || err.Error() != "industry unavailable" {
				t.Fatalf("want exact ErrIndustryUnavailable, got %v", err)
			}
			assertIndustryRows(t, pool, f, 0)
		})
	}
}

func TestActiveIndustryGate_DeactivateFirst(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()
	active := true
	f := newActiveIndustryFixture(t, pool, "deactivate-first", &active)
	defer f.cleanup(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin deactivation: %v", err)
	}
	defer rollbackIndustryTx(tx)
	var blockerPID int32
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&blockerPID); err != nil {
		t.Fatalf("deactivation pid: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE industries SET active = false WHERE id = $1`, f.industryID); err != nil {
		t.Fatalf("hold deactivation: %v", err)
	}

	createPool, createPID := newActiveIndustryPool(t, "ws2a-deactivate-first")
	createDone := make(chan error, 1)
	go func() {
		createDone <- NewCompanyBootstrapRepository(createPool).CreateWithOwner(ctx, f.company, f.owner)
	}()
	lockCtx, lockCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer lockCancel()
	if err := waitForIndustryLock(lockCtx, pool, createPID, blockerPID); err != nil {
		t.Fatalf("observe blocked create: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit deactivation: %v", err)
	}
	select {
	case err := <-createDone:
		if !errors.Is(err, entities.ErrIndustryUnavailable) {
			t.Fatalf("want ErrIndustryUnavailable, got %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("wait create: %v", ctx.Err())
	}
	assertIndustryRows(t, pool, f, 0)
}

func TestActiveIndustryGate_CreateFirst(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()
	active := true
	f := newActiveIndustryFixture(t, pool, "create-first", &active)
	defer f.cleanup(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin create: %v", err)
	}
	defer rollbackIndustryTx(tx)
	var blockerPID int32
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&blockerPID); err != nil {
		t.Fatalf("create pid: %v", err)
	}
	queries := db.New(tx)
	if _, err := queries.CreateCompany(ctx, buildCreateParams(f.company)); err != nil {
		t.Fatalf("create company: %v", err)
	}
	if _, err := queries.CreateCompanyMember(ctx, buildCreateMemberParams(f.owner)); err != nil {
		t.Fatalf("create owner: %v", err)
	}

	deactivatePool, deactivatePID := newActiveIndustryPool(t, "ws2a-create-first")
	deactivateDone := make(chan error, 1)
	go func() {
		_, err := deactivatePool.Exec(ctx, `UPDATE industries SET active = false WHERE id = $1`, f.industryID)
		deactivateDone <- err
	}()
	lockCtx, lockCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer lockCancel()
	if err := waitForIndustryLock(lockCtx, pool, deactivatePID, blockerPID); err != nil {
		t.Fatalf("observe blocked deactivation: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit create: %v", err)
	}
	select {
	case err := <-deactivateDone:
		if err != nil {
			t.Fatalf("deactivate industry: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("wait deactivation: %v", ctx.Err())
	}
	assertIndustryRows(t, pool, f, 1)
	var isActive bool
	if err := pool.QueryRow(ctx, `SELECT active FROM industries WHERE id = $1`, f.industryID).Scan(&isActive); err != nil || isActive {
		t.Fatalf("want inactive industry, active=%v err=%v", isActive, err)
	}
}
