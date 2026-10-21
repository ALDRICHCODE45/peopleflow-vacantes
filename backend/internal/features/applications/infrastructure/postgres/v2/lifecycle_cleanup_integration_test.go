//go:build integration

package v2

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLifecycleMovementFixtureCleanupRemovesOwnedTransitionRows(t *testing.T) {
	pool := isolatedPool(t)
	var company, id, actor string
	t.Run("fixture with real finish transition", func(t *testing.T) {
		m := setupMovement(t)
		company, id, actor = m.company.String(), m.vacancy.String(), m.recruiter.String()
		ctx := context.Background()
		current, err := m.drafts.GetLifecycle(ctx, m.company, m.recruiter, m.vacancy)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = m.drafts.TransitionLifecycle(ctx, m.company, m.recruiter, m.vacancy, "close", uuid.NewString(), true, current.ETag, true, []byte(`{"process":"finish","reason":"cancelled","reason_note":null}`)); err != nil {
			t.Fatal(err)
		}
	})
	if id == "" {
		t.Fatal("fixture not created")
	}
	var remaining int
	err := pool.QueryRow(context.Background(), `SELECT
  (SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1::uuid)+
  (SELECT count(*) FROM vacancy_processes WHERE id=$1::uuid)+
  (SELECT count(*) FROM process_participations WHERE process_id=$1::uuid)+
  (SELECT count(*) FROM job_drafts WHERE id=$1::uuid)+
  (SELECT count(*) FROM job_draft_idempotency WHERE company_id=$2::uuid)+
  (SELECT count(*) FROM audit_events WHERE entity_id=$1::uuid)+
  (SELECT count(*) FROM companies WHERE id=$2::uuid)+
  (SELECT count(*) FROM users WHERE id=$3::uuid)`, id, company, actor).Scan(&remaining)
	if err != nil || remaining != 0 {
		t.Fatalf("fixture leaked %d owned rows: %v", remaining, err)
	}
}
