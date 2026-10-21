//go:build integration

package draftstore

import (
	"context"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestLifecycleReopenPreservesCandidatesHistoryAndFrozenFulfillment(t *testing.T) {
	pool := requireDraftPool(t)
	ctx := context.Background()
	s, p, id, current := lifecycleFixture(t, pool, "published")
	candidate, cv, pid := uuid.New(), uuid.New(), uuid.New()
	cutoff := pipelineconfig.Defaults(id).Stages[3].ID
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM process_delivery_fulfillments WHERE process_id=$1`, id)
		_, _ = pool.Exec(ctx, `DELETE FROM participation_stage_history WHERE participation_id=$1`, pid)
		_, _ = pool.Exec(ctx, `DELETE FROM process_participations WHERE id=$1`, pid)
		_, _ = pool.Exec(ctx, `DELETE FROM candidate_cv_versions WHERE id=$1`, cv)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, candidate)
	})
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate')`, candidate, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`, pid, id, candidate, cutoff, cv)
	exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id) VALUES($1,$2,$3,$4)`, uuid.New(), pid, cutoff, candidate)
	exec(`INSERT INTO process_delivery_fulfillments(process_id,fulfilled_at,result,business_days_delta,target,delivered,cutoff_stage_id,cutoff_stage_name,commitment_date,candidates) VALUES($1,now(),'on_time',0,1,1,$2,'En proceso','2026-10-16',jsonb_build_array(jsonb_build_object('participation_id',$3::text)))`, id, cutoff, pid)
	snapshot := func() string {
		t.Helper()
		var raw string
		if err := pool.QueryRow(ctx, `SELECT jsonb_build_array(
 (SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),
 (SELECT to_jsonb(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1),
 (SELECT to_jsonb(c) FROM job_draft_substate_catalogs c WHERE draft_id=$1),
 (SELECT to_jsonb(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
 (SELECT to_jsonb(c) FROM job_draft_management_configs c WHERE draft_id=$1),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$1),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id=$2),
 (SELECT to_jsonb(f) FROM process_delivery_fulfillments f WHERE process_id=$1))::text`, id, pid).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before := snapshot()
	for _, step := range []struct{ action, body string }{{"close", `{"process":"continue"}`}, {"finish_process", `{}`}, {"reopen", `{}`}, {"pause", `{}`}, {"close", `{"process":"finish"}`}, {"reopen", `{}`}} {
		var err error
		current, err = s.TransitionLifecycle(ctx, p.companyID, p.ownerID, id, step.action, uuid.NewString(), true, current.ETag, true, []byte(step.body))
		if err != nil {
			t.Fatal(step.action, err)
		}
		if snapshot() != before {
			t.Fatalf("%s changed pipeline/candidates/history/fulfillment", step.action)
		}
	}
}
