//go:build integration

package draftstore

import (
	"context"
	"testing"
)

// Exercise the actual fixture cleanup, including states that make 00034 down
// refuse. Never normalize/delete another test's processes to make down pass.
func TestLifecycleFixtureCleanupRemovesOwnedStateAndHistory(t *testing.T) {
	pool := requireDraftPool(t)
	for _, state := range []string{"paused", "closed active", "closed finished"} {
		t.Run(state, func(t *testing.T) {
			var company, id, actor string
			t.Run("fixture", func(t *testing.T) {
				_, p, vacancy, _ := lifecycleFixture(t, pool, state)
				company, id, actor = p.companyID.String(), vacancy.String(), p.ownerID.String()
			})
			if id == "" {
				t.Fatal("fixture not created")
			}
			var remaining int
			err := pool.QueryRow(context.Background(), `SELECT
    (SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1::uuid)+
    (SELECT count(*) FROM vacancy_processes WHERE id=$1::uuid)+
    (SELECT count(*) FROM job_drafts WHERE id=$1::uuid)+
    (SELECT count(*) FROM job_draft_idempotency WHERE company_id=$2::uuid)+
    (SELECT count(*) FROM audit_events WHERE entity_id=$1::uuid)+
    (SELECT count(*) FROM companies WHERE id=$2::uuid)+
    (SELECT count(*) FROM users WHERE id=$3::uuid)`, id, company, actor).Scan(&remaining)
			if err != nil || remaining != 0 {
				t.Fatalf("fixture leaked %d owned rows: %v", remaining, err)
			}
		})
	}
}
