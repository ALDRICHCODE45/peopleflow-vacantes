//go:build integration

package main

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLifecycleHTTPFixtureCleanupRemovesOwnedStateAndHistory(t *testing.T) {
	pool := requireDraftFlowPool(t)
	var company, id, actor string
	t.Run("fixture with closed process and history", func(t *testing.T) {
		h := newDraftFlowHarness(t)
		c, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		owner := h.actor(t, ownerID, sub)
		company, actor = c.companyID.String(), ownerID.String()
		id = publicationFlowReady(t, h, owner)
		publicFlowPublish(t, h, id, owner)
		path := draftFlowV2Path + "/" + id + "/lifecycle"
		current := h.do(t, "GET", path, "", owner.token, nil)
		closed := h.do(t, "POST", path+"/close", `{"process":"finish"}`, owner.token, map[string]string{"If-Match": current.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
		if closed.status != 200 {
			t.Fatalf("close: %d %s", closed.status, closed.body)
		}
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
}
