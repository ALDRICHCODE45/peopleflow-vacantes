//go:build integration

// Package postgres also covers the list projection: ListByCompanyID LEFT
// JOINs users to expose (id, full_name, email) per member, and renders
// `user: null` when the member's user is soft-deleted.
package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/google/uuid"
)

func TestListByCompanyID_EnrichesUserAndNullsDeleted(t *testing.T) {
	pool := skipIfNoDatabase(t)
	t.Cleanup(pool.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })

	repo := NewCompanyMemberRepository(db.New(tx))

	suffix := uuid.NewString()[:6]
	industryID := "list-join-industry"
	companyID := uuid.New()
	aliveUserID := uuid.New()
	deletedUserID := uuid.New()

	seeds := []struct {
		name string
		sql  string
		args []any
	}{
		{"industry", `INSERT INTO industries (id, label_es, label_en, sort_order, active)
		               VALUES ($1, 'L', 'L', 0, true) ON CONFLICT (id) DO NOTHING`, []any{industryID}},
		{"company", `INSERT INTO companies (id, name, rfc, industry_id, status)
		             VALUES ($1, 'List Co', $2, $3, 'active')`, []any{companyID, "LS" + suffix + "A123", industryID}},
		{"alive user", `INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		                VALUES ($1, $2, $3, $4, 'recruiter')`,
			[]any{aliveUserID, "alive-" + suffix, "alive-" + suffix + "@example.com", "Alice Alive"}},
		{"deleted user", `INSERT INTO users (id, cognito_sub, email, full_name, user_type, deleted_at)
		                 VALUES ($1, $2, $3, $4, 'recruiter', now())`,
			[]any{deletedUserID, "deleted-" + suffix, "deleted-" + suffix + "@example.com", "Bob Deleted"}},
		{"alive member", `INSERT INTO company_members (id, user_id, company_id, role)
		                  VALUES ($1, $2, $3, 'recruiter')`,
			[]any{uuid.New(), aliveUserID, companyID}},
		{"deleted member", `INSERT INTO company_members (id, user_id, company_id, role)
		                   VALUES ($1, $2, $3, 'recruiter')`,
			[]any{uuid.New(), deletedUserID, companyID}},
	}
	for _, s := range seeds {
		if _, err := tx.Exec(ctx, s.sql, s.args...); err != nil {
			t.Fatalf("seed %s: %v", s.name, err)
		}
	}

	rows, err := repo.ListByCompanyID(ctx, companyID)
	if err != nil {
		t.Fatalf("ListByCompanyID: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 members, got %d", len(rows))
	}

	aliveFound := false
	deletedNil := false
	for _, r := range rows {
		if r.User == nil {
			deletedNil = true
			continue
		}
		if r.User.ID == aliveUserID {
			aliveFound = true
			if r.User.FullName != "Alice Alive" || r.User.Email != "alive-"+suffix+"@example.com" {
				t.Errorf("alive user identity wrong: %+v", r.User)
			}
		}
		if r.User.ID == deletedUserID {
			t.Errorf("soft-deleted user must surface as user: null, got %+v", r.User)
		}
	}

	if !aliveFound {
		t.Errorf("alive user not found in projection")
	}
	if !deletedNil {
		t.Errorf("expected at least one member with nil user (the soft-deleted one)")
	}
}
