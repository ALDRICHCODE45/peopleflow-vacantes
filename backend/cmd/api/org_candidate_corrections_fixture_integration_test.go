//go:build integration

package main

import (
	"context"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const organicEditSnapshot = `{"location":{"country":"US","state":null,"municipality":null},"skills":["frozen"],"years_of_experience":"2","seniority":"junior","education":{"highest_completed":"bachelor","in_progress":null},"languages":[{"code":"en","level":"B1"}]}`

func newOrganicEditFixture(t *testing.T) *candidateEditFixture {
	t.Helper()
	base := newCandidateEditFixture(t)
	copy := *base
	f := &copy
	f.id = uuid.New()
	f.path = orgCandidatesPath + "/organic/" + f.id.String()
	// Cleanup is registered last: private correction rows go before account/company.
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM company_candidate_history WHERE candidate_id=$1`,
			`DELETE FROM audit_events WHERE entity_id=$1`,
			`DELETE FROM company_candidate_corrections WHERE user_id=$1`,
			`DELETE FROM process_participations WHERE candidate_id=$1`,
			`DELETE FROM candidate_cv_versions WHERE candidate_id=$1`,
			`DELETE FROM candidate_languages WHERE user_id=$1`,
			`DELETE FROM candidate_educations WHERE user_id=$1`,
			`DELETE FROM candidate_profiles WHERE user_id=$1`,
			`DELETE FROM users WHERE id=$1`,
		} {
			if _, err := f.h.pool.Exec(context.Background(), q, f.id); err != nil {
				t.Error(err)
			}
		}
	})
	f.exec(t, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,'original@example.test','Original Candidate','candidate')`, f.id, uuid.NewString())
	f.exec(t, `INSERT INTO candidate_profiles(user_id,phone,professional_title,current_company,skills,years_of_experience,seniority) VALUES($1,' +523311111111 ','PRIVATE TITLE','PRIVATE COMPANY',ARRAY['private'],8,'senior')`, f.id)
	f.exec(t, `INSERT INTO candidate_educations(user_id,position,level,status) VALUES($1,0,'phd','completed')`, f.id)
	f.exec(t, `INSERT INTO candidate_languages(user_id,code,level) VALUES($1,'fr','C2')`, f.id)
	for index, actor := range []draftFlowActor{f.owner, f.owner, f.foreign} {
		vacancy := publicationFlowReady(t, f.h, actor)
		publicFlowPublish(t, f.h, vacancy, actor)
		version := uuid.New()
		f.exec(t, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, version, f.id, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
		snapshot := organicEditSnapshot
		at := "2026-03-01T00:00:00Z"
		if index == 0 {
			snapshot = `{"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]}`
			at = "2026-01-01T00:00:00Z"
		}
		if index == 2 {
			at = "2026-12-01T00:00:00Z"
		}
		cfg := pipelineconfig.Defaults(uuid.MustParse(vacancy))
		f.exec(t, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,source,profile_snapshot,questions_snapshot,answers_snapshot,created_at) VALUES($1,$2,$3,$4,$5,'organic',$6::jsonb,'[]','[]',$7::timestamptz)`, uuid.New(), vacancy, f.id, cfg.Stages[0].ID, version, snapshot, at)
	}
	return f
}

// Capture entire candidate-owned rows plus every company's participation bytes.
func organicOwnedBytes(t *testing.T, f *candidateEditFixture) string {
	t.Helper()
	var raw []byte
	err := f.h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object(
 'user',(SELECT to_jsonb(u) FROM users u WHERE id=$1),
 'profile',(SELECT to_jsonb(cp) FROM candidate_profiles cp WHERE user_id=$1),
 'education',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM candidate_educations e WHERE user_id=$1),
 'languages',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.code) FROM candidate_languages l WHERE user_id=$1),
 'participations',(SELECT jsonb_agg(jsonb_build_object('row',to_jsonb(p),'snapshot_bytes',encode(jsonb_send(p.profile_snapshot),'hex')) ORDER BY p.id) FROM process_participations p WHERE candidate_id=$1))`, f.id).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
