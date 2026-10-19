//go:build integration

package v2

import (
	"context"
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func followupLiveGates(t *testing.T, call func(context.Context, movementFixture, []byte) error, body func(*testing.T, movementFixture) []byte) {
	t.Helper()
	for _, gate := range []struct {
		name, query string
		want        error
	}{
		{"deleted user", `UPDATE users SET deleted_at=now() WHERE id=$1`, drafts.ErrUnauthenticated},
		{"revoked membership", `DELETE FROM company_members WHERE user_id=$1`, drafts.ErrForbidden},
		{"inactive company", `UPDATE companies SET deleted_at=now() WHERE id=$1`, drafts.ErrCompanyInactive},
		{"pending company", `UPDATE companies SET status='pending_verification' WHERE id=$1`, drafts.ErrCompanyNotActive},
		{"suspended company", `UPDATE companies SET status='suspended' WHERE id=$1`, drafts.ErrCompanyNotActive},
	} {
		t.Run(gate.name, func(t *testing.T) {
			m := setupMovement(t)
			ctx := context.Background()
			valid := body(t, m)
			// Establish the route really works before revoking a live gate.
			before := columnEffects(t, m)
			if err := call(ctx, m, valid); err != nil || before != columnEffects(t, m) {
				t.Fatal("live request failed or wrote effects", err)
			}
			id := m.company
			if gate.name == "deleted user" || gate.name == "revoked membership" {
				id = m.recruiter
			}
			if _, err := m.pool.Exec(ctx, gate.query, id); err != nil {
				t.Fatal(err)
			}
			before = columnEffects(t, m)
			for _, raw := range [][]byte{valid, []byte(`broken`)} {
				if err := call(ctx, m, raw); !errors.Is(err, gate.want) || before != columnEffects(t, m) {
					t.Fatal("live gate/body ordering or atomicity", err, gate.want)
				}
			}
		})
	}
}

func TestFulfillmentStatusPreviewLiveGateDBMatrix(t *testing.T) {
	for _, operation := range []string{"status", "preview"} {
		t.Run(operation, func(t *testing.T) {
			followupLiveGates(t, func(ctx context.Context, m movementFixture, raw []byte) error {
				if operation == "status" {
					_, err := m.drafts.GetDeliveryStatus(ctx, m.company, m.recruiter, m.vacancy)
					return err
				}
				_, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, raw)
				return err
			}, func(_ *testing.T, m movementFixture) []byte { return deliveryBody(m, 1, 2, false) })
		})
	}
}

func TestColumnsPreviewInheritedLiveGateDBMatrix(t *testing.T) {
	followupLiveGates(t, func(ctx context.Context, m movementFixture, raw []byte) error {
		_, err := m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, raw)
		return err
	}, func(t *testing.T, m movementFixture) []byte { return movementPipelineBody(t, pc.Defaults(m.vacancy)) })
	// Preview must also enforce owner/principal resource hiding rather than
	// allowing a non-principal member to inspect impact or malformed input.
	m := setupMovement(t)
	ctx := context.Background()
	other := uuid.New()
	if _, err := m.pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Other recruiter','recruiter')`, other, uuid.NewString(), uuid.NewString()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM company_members WHERE user_id=$1`, other); err != nil {
			t.Error(err)
		}
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, other); err != nil {
			t.Error(err)
		}
	})
	if _, err := m.pool.Exec(ctx, `INSERT INTO company_members(id,company_id,user_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), m.company, other); err != nil {
		t.Fatal(err)
	}
	before := columnEffects(t, m)
	for _, raw := range [][]byte{movementPipelineBody(t, pc.Defaults(m.vacancy)), []byte(`broken`)} {
		if _, err := m.drafts.PreviewPipeline(ctx, m.company, other, m.vacancy, raw); !errors.Is(err, drafts.ErrNotFound) || before != columnEffects(t, m) {
			t.Fatal(err)
		}
	}
}
