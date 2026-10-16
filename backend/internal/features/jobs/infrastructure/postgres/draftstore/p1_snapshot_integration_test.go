//go:build integration

package draftstore

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// publicationSnapshot is shared by management/publication acceptance tests.
// Apply both P1 schema migrations before these tests. Includes every company
// idempotency record, not merely the addressed key, to detect stray writes.
func publicationSnapshot(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var value string
	if err := pool.QueryRow(context.Background(), `SELECT json_build_array(
 (SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
 (SELECT row_to_json(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_substate_catalogs c WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_management_configs c WHERE draft_id=$1),
 (SELECT row_to_json(p) FROM vacancy_processes p WHERE id=$1),
 (SELECT json_agg(i ORDER BY i.id) FROM job_draft_idempotency i WHERE company_id=(SELECT company_id FROM job_drafts WHERE id=$1)),
 (SELECT json_agg(a ORDER BY a.id) FROM audit_events a WHERE entity_id=$1))::text`, id).Scan(&value); err != nil {
		t.Fatal(err)
	}
	return value
}
