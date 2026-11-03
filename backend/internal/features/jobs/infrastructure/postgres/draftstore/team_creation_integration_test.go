//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"testing"

	"github.com/google/uuid"
)

// Both public creation ports must commit (or roll back) the team and its audit
// along with the draft. SQL only observes counters not exposed by those ports.
func TestTeamCreationReplayAndAuditRollback(t *testing.T) {
	for _, v2 := range []bool{false, true} {
		name := "v1"
		if v2 {
			name = "v2"
		}
		t.Run(name, func(t *testing.T) {
			pool := requireDraftPool(t)
			s := newStore(t, pool)
			p := newPrincipal(t, pool)
			createDraft := s.Create
			if v2 {
				createDraft = s.CreateV2
			}
			body := minimalCreateBody()
			key := uuid.NewString()
			first, err := createDraft(context.Background(), p.companyID, p.ownerID, key, body)
			if err != nil {
				t.Fatal(err)
			}
			replay, err := createDraft(context.Background(), p.companyID, p.ownerID, key, body)
			if err != nil || !replay.Replayed || first.Replayed || !bytes.Equal(first.Body, replay.Body) || first.ETag != replay.ETag {
				t.Fatalf("replay: %+v %v", replay, err)
			}
			id := draftIDOf(t, first)
			for _, q := range []string{
				`SELECT count(*) FROM vacancy_teams WHERE draft_id=$1`,
				`SELECT count(*) FROM vacancy_assignments WHERE draft_id=$1`,
				`SELECT count(*) FROM vacancy_assignment_functions WHERE draft_id=$1`,
				`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyTeamCreated'`,
			} {
				if n := countRows(t, pool, q, id); n != 1 {
					t.Fatalf("%s: got %d, want 1", q, n)
				}
			}
			t.Run("team audit failure", func(t *testing.T) {
				failed := newPrincipal(t, pool)
				ensureAuditRejectHarness(t, pool)
				addAuditRejectRule(t, pool, "VacancyTeamCreated", nil, &failed.ownerID)
				result, err := createDraft(context.Background(), failed.companyID, failed.ownerID, uuid.NewString(), body)
				requireAuditInsertFailure(t, err)
				if result.Replayed || result.ETag != "" || len(result.Body) != 0 {
					t.Fatalf("failed create returned result: %+v", result)
				}
				for _, q := range []string{
					`SELECT count(*) FROM job_drafts WHERE company_id=$1`,
					`SELECT count(*) FROM vacancy_teams WHERE company_id=$1`,
					`SELECT count(*) FROM vacancy_assignments WHERE company_id=$1`,
					`SELECT count(*) FROM vacancy_assignment_functions WHERE assignment_id IN (SELECT id FROM vacancy_assignments WHERE company_id=$1)`,
					`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1`,
					`SELECT count(*) FROM audit_events WHERE actor_id=$1`,
				} {
					arg := failed.companyID
					if q == `SELECT count(*) FROM audit_events WHERE actor_id=$1` {
						arg = failed.ownerID
					}
					if n := countRows(t, pool, q, arg); n != 0 {
						t.Fatalf("%s: rollback left %d rows", q, n)
					}
				}
			})
		})
	}
}
