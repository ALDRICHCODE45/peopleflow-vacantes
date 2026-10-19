//go:build integration

package v2

import (
	"context"
	"errors"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

func TestDiscardRecoveryOwnerPrincipalAndNonprincipal(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	other := uuid.New()
	if _, err := m.pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Other recruiter','recruiter')`, other, uuid.NewString(), uuid.NewString()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, entry := range []struct {
			sql  string
			args []any
		}{
			{`UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, []any{m.vacancy, m.recruiter}},
			{`DELETE FROM company_members WHERE user_id=$1`, []any{other}},
			{`DELETE FROM users WHERE id=$1`, []any{other}},
		} {
			if _, err := m.pool.Exec(context.Background(), entry.sql, entry.args...); err != nil {
				t.Error(err)
			}
		}
	})
	if _, err := m.pool.Exec(ctx, `INSERT INTO company_members(id,company_id,user_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), m.company, other); err != nil {
		t.Fatal(err)
	}
	before := m.snapshot(t)
	for _, operation := range []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (board.Moved, error){m.board.Discard, m.board.Recover} {
		if _, err := operation(ctx, m.company, other, m.vacancy, m.item.ID, "", false, []byte(`broken`)); !errors.Is(err, board.ErrNotFound) {
			t.Fatal("authorization must precede preconditions/body", err)
		}
		if before != m.snapshot(t) {
			t.Fatal("nonprincipal rejection wrote effects")
		}
	}
	item := m.item
	for _, role := range []string{"principal", "owner"} {
		t.Run(role, func(t *testing.T) {
			if role == "principal" {
				if _, err := m.pool.Exec(ctx, `UPDATE company_members SET role='recruiter' WHERE user_id=$1`, m.recruiter); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := m.pool.Exec(ctx, `UPDATE company_members SET role='owner' WHERE user_id=$1`, m.recruiter); err != nil {
					t.Fatal(err)
				}
				if _, err := m.pool.Exec(ctx, `UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, m.vacancy, other); err != nil {
					t.Fatal(err)
				}
			}
			discarded, err := m.discard(t, item, discardBody)
			if err != nil {
				t.Fatal(role, "discard rejected", err)
			}
			recovered, err := m.recover(t, discarded.Item, `{}`)
			if err != nil {
				t.Fatal(role, "recovery rejected", err)
			}
			item = recovered.Item
		})
	}
}
