//go:build integration

package main

import (
	"context"
	"reflect"
	"testing"
)

// Shared P1 effect assertions; both additive migrations must be applied.
func publicationFlowSnapshot(t *testing.T, h *draftFlowHarness, id string) string {
	t.Helper()
	var value string
	if err := h.pool.QueryRow(context.Background(), `SELECT json_build_array(
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

func publicationFlowAssertError(t *testing.T, r draftFlowResponse, status int, code string, missing []string) {
	t.Helper()
	draftFlowAssertNoStore(t, r)
	obj := draftFlowObject(t, r.body)
	keys := 2
	if code == "publication_incomplete" {
		keys = 3
		want := make([]any, len(missing))
		for i, v := range missing {
			want[i] = v
		}
		if !reflect.DeepEqual(obj["missing"], want) {
			t.Fatalf("missing=%v want=%v", obj["missing"], want)
		}
	}
	if r.status != status || len(obj) != keys || obj["code"] != code || obj["error"] == "" || r.header.Get("ETag") != "" || r.header.Get("Idempotency-Replayed") != "" {
		t.Fatalf("error=%d %s %v", r.status, r.body, r.header)
	}
}
