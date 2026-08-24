//go:build integration

// Package postgres_membership_bootstrap exercises the CompanyBootstrapRepository
// adapter against a live PostgreSQL instance. It runs only when the integration
// build tag is set and DATABASE_URL is provided (t.Skip otherwise).
//
// Scope: the atomic company + owner write. The unit suite covers the pure
// use-case branching; this file proves the real transactional behavior:
//
//   - CreateWithOwner(success) persists BOTH the company and its owner row.
//   - CreateWithOwner(failing member) rolls the company back so no orphan
//     company is left behind.
package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

func TestCreateWithOwner_PersistsCompanyAndOwner(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	repo := NewCompanyBootstrapRepository(pool)

	industryID := "bootstrap-test-industry"
	if _, err := pool.Exec(ctx,
		`INSERT INTO industries (id, label_es, label_en, sort_order, active)
		 VALUES ($1, 'B', 'B', 0, true) ON CONFLICT (id) DO NOTHING`, industryID); err != nil {
		t.Fatalf("seed industry: %v", err)
	}

	// Unique rfc so re-runs don't collide on companies_rfc_unique.
	// RFC must be exactly 12 characters (domain VO enforces it).
	suffix := uuid.NewString()[:8]
	rfc := "BTSX" + suffix // 4 + 8 = 12 chars

	userID := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, 'recruiter')`,
		userID, "sub-"+suffix, suffix+"@example.com", "Bootstrap Owner"); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	company, err := entities.NewCompany("Bootstrap Co", rfc, industryID, entities.CompanyProfile{})
	if err != nil {
		t.Fatalf("NewCompany: %v", err)
	}
	owner, err := entities.NewCompanyMember(userID, company.ID, valueobjects.OwnerRole)
	if err != nil {
		t.Fatalf("NewCompanyMember: %v", err)
	}

	if err := repo.CreateWithOwner(ctx, company, owner); err != nil {
		t.Fatalf("CreateWithOwner: %v", err)
	}

	var cnt int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM company_members WHERE company_id = $1 AND user_id = $2 AND role = 'owner'`,
		company.ID, userID).Scan(&cnt); err != nil {
		t.Fatalf("verify member: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("expected 1 owner row, got %d", cnt)
	}
}

func TestCreateWithOwner_RollsBackOnMemberFailure(t *testing.T) {
	pool := skipIfNoDatabase(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	repo := NewCompanyBootstrapRepository(pool)

	industryID := "bootstrap-test-industry"
	if _, err := pool.Exec(ctx,
		`INSERT INTO industries (id, label_es, label_en, sort_order, active)
		 VALUES ($1, 'B', 'B', 0, true) ON CONFLICT (id) DO NOTHING`, industryID); err != nil {
		t.Fatalf("seed industry: %v", err)
	}

	suffix := uuid.NewString()[:8]
	rfc := "BTRX" + suffix // 4 + 8 = 12 chars
	company, err := entities.NewCompany("Rollback Co", rfc, industryID, entities.CompanyProfile{})
	if err != nil {
		t.Fatalf("NewCompany: %v", err)
	}

	// Owner points at a NON-EXISTENT user → the member INSERT hits FK 23503,
	// which must roll back the already-inserted company too.
	ghostUser := uuid.New()
	owner, err := entities.NewCompanyMember(ghostUser, company.ID, valueobjects.OwnerRole)
	if err != nil {
		t.Fatalf("NewCompanyMember: %v", err)
	}

	err = repo.CreateWithOwner(ctx, company, owner)
	if err == nil {
		t.Fatal("expected error for ghost user FK violation, got nil")
	}

	// Post-condition: the company must NOT exist — the member failure rolled
	// the company write back.
	var cnt int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM companies WHERE id = $1`, company.ID).Scan(&cnt); err != nil {
		t.Fatalf("verify company rollback: %v", err)
	}
	if cnt != 0 {
		t.Fatalf("expected company to be rolled back, found %d rows", cnt)
	}
}
