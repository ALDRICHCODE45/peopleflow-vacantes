//go:build integration

package draftstore

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestPipeline_FirstDefaultPutMaterializesThenNoOp(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	get, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	body := pipelineWriteBody(t, pipelineconfig.Defaults(id))
	saved, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, get.ETag, true, body)
	if err != nil || saved.ETag != pipelineconfig.ETag(id, 1) || !pipelineConfigOf(t, saved.Body).Equal(pipelineconfig.Defaults(id)) || auditCount(t, pool, id, pipelineConfiguredEvent) != 1 {
		t.Fatalf("first default PUT: %+v %v", saved, err)
	}
	before := pipelineSnapshot(t, pool, id)
	noop, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, body)
	if err != nil || !reflect.DeepEqual(noop, saved) || pipelineSnapshot(t, pool, id) != before {
		t.Fatalf("stored default no-op: %+v %v", noop, err)
	}
}

func TestPipeline_AuditFailureRollsBackFirstAndLaterPuts(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	failing := NewStore(pool, failingAudit{})
	for _, phase := range []string{"first PUT", "later PUT"} {
		t.Run(phase, func(t *testing.T) {
			get, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
			if err != nil {
				t.Fatal(err)
			}
			c := pipelineConfigOf(t, get.Body)
			c.Exit.Name = "Failure " + phase
			before := pipelineSnapshot(t, pool, id)
			got, err := failing.PutPipeline(ctx, p.companyID, p.ownerID, id, get.ETag, true, pipelineWriteBody(t, c))
			if err == nil || !reflect.DeepEqual(got, drafts.Result{}) || pipelineSnapshot(t, pool, id) != before {
				t.Fatalf("failed audit did not roll back: %+v %v", got, err)
			}
			if _, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, get.ETag, true, pipelineWriteBody(t, c)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPipeline_LiveGatesAndStoredCorruptionFailClosed(t *testing.T) {
	pool := requireDraftPool(t)
	tests := []struct {
		name   string
		mutate string
		want   error
	}{
		{"deleted user", `UPDATE users SET deleted_at=now() WHERE id=$1`, drafts.ErrUnauthenticated},
		{"revoked membership", `DELETE FROM company_members WHERE user_id=$1`, drafts.ErrForbidden},
		{"suspended company", `UPDATE companies SET status='suspended' WHERE id=$1`, drafts.ErrCompanyNotActive},
		{"tombstoned company", `UPDATE companies SET deleted_at=now() WHERE id=$1`, drafts.ErrCompanyInactive},
		{"corrupt pipeline", `UPDATE job_draft_pipeline_configs SET configuration='broken'::bytea WHERE draft_id=$1`, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, p, created := createV2Draft(t, pool)
			id := draftIDOf(t, created)
			ctx := context.Background()
			get, err := s.GetPipeline(ctx, p.companyID, p.ownerID, id)
			if err != nil {
				t.Fatal(err)
			}
			c := pipelineConfigOf(t, get.Body)
			c.Exit.Name = "Fuera"
			saved, err := s.PutPipeline(ctx, p.companyID, p.ownerID, id, get.ETag, true, pipelineWriteBody(t, c))
			if err != nil {
				t.Fatal(err)
			}
			target := id
			switch tc.name {
			case "deleted user", "revoked membership":
				target = p.ownerID
			case "suspended company", "tombstoned company":
				target = p.companyID
			}
			if _, err := pool.Exec(ctx, tc.mutate, target); err != nil {
				t.Fatal(err)
			}
			before := pipelineSnapshot(t, pool, id)
			for _, write := range []bool{false, true} {
				var got drafts.Result
				if write {
					got, err = s.PutPipeline(ctx, p.companyID, p.ownerID, id, saved.ETag, true, pipelineWriteBody(t, pipelineconfig.Defaults(id)))
				} else {
					got, err = s.GetPipeline(ctx, p.companyID, p.ownerID, id)
				}
				if err == nil || (tc.want != nil && !errors.Is(err, tc.want)) || !reflect.DeepEqual(got, drafts.Result{}) || pipelineSnapshot(t, pool, id) != before {
					t.Fatalf("gate write=%v returned data or changed state: %+v %v", write, got, err)
				}
			}
		})
	}
}
