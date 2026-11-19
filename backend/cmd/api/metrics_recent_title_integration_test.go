//go:build integration

package main

import (
	"context"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Dashboard recent rows show the professional title frozen in the
// participation snapshot (like the board), not the live candidate profile.
// Corrections still win, legacy snapshots read null and manual intakes keep
// the company record's title.
const snapshot00061Fields = `"location":null,"skills":[],"years_of_experience":null,"seniority":null,"education":{"highest_completed":null,"in_progress":null},"languages":[]`

func TestDashboardV2_RecentTitleFromSnapshot(t *testing.T) {
	h := newDraftFlowHarness(t)
	s := newMXDashboard(t, h)
	candidateOf := func(pid uuid.UUID) uuid.UUID {
		var id uuid.UUID
		if err := h.pool.QueryRow(context.Background(), `SELECT candidate_id FROM process_participations WHERE id=$1`, pid).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	diego, carla, pia := candidateOf(s.pd1), candidateOf(s.pc1), candidateOf(s.pa1)
	t.Cleanup(func() {
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM candidate_profiles WHERE user_id=ANY($1)`, []uuid.UUID{diego, carla, pia}); err != nil {
			t.Error(err)
		}
	})
	for _, id := range []uuid.UUID{diego, carla, pia} {
		s.exec(`INSERT INTO candidate_profiles(user_id,professional_title,skills) VALUES($1,'LIVE TITLE','{}')`, id)
	}
	// Diego: frozen copy. Carla: legacy row (NULL snapshot). Pía: corrected.
	s.exec(`UPDATE process_participations SET profile_snapshot='{`+snapshot00061Fields+`,"professional_title":"Frozen Designer"}' WHERE id=$1`, s.pd1)
	s.exec(`UPDATE process_participations SET profile_snapshot='{`+snapshot00061Fields+`,"professional_title":"Frozen Analyst"}' WHERE id=$1`, s.pa1)
	s.exec(`INSERT INTO company_candidate_corrections(company_id,user_id,corrections) VALUES($1,$2,'{"professional_title":"Corrected Analyst"}')`, s.company.companyID, pia)
	// Manual intake on D, newest of all: the company record's title, unchanged.
	manual, manualPID, manualCV := uuid.New(), uuid.New(), uuid.New()
	t.Cleanup(func() {
		for _, step := range []struct {
			q  string
			id uuid.UUID
		}{{`DELETE FROM process_participations WHERE id=$1`, manualPID}, {`DELETE FROM company_candidate_cvs WHERE id=$1`, manualCV}, {`DELETE FROM company_candidates WHERE id=$1`, manual}} {
			if _, err := h.pool.Exec(context.Background(), step.q, step.id); err != nil {
				t.Error(err)
			}
		}
	})
	s.exec(`INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,professional_title,created_by) VALUES($1,$2,'Manual Persona',$3,$3,'US','Manual Title',$4)`, manual, s.company.companyID, "manual-"+manual.String()+"@example.test", s.owner.userID)
	s.exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,6,'application/pdf','manual.pdf')`, manualCV, s.company.companyID, manual, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""))
	stage := mxStages(pipelineconfig.Defaults(s.d))["new"]
	s.exec(`INSERT INTO process_participations(id,process_id,company_candidate_id,company_candidate_cv_id,stage_id,source,added_by,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,created_at) VALUES($1,$2,$3,$4,$5,'manual',$6,'{`+snapshot00061Fields+`,"professional_title":"IGNORED SNAPSHOT"}','[]','[]','manual',$7)`, manualPID, s.d, manual, manualCV, stage, s.owner.userID, mxAt("2026-03-23T08:00:00Z"))

	titles := map[string]any{}
	for _, raw := range s.dash(s.owner, "recent")["recent"].([]any) {
		r := raw.(map[string]any)
		titles[r["participation_id"].(string)] = r["candidate"].(map[string]any)["professional_title"]
	}
	for pid, want := range map[uuid.UUID]any{manualPID: "Manual Title", s.pd1: "Frozen Designer", s.pc1: nil, s.pa1: "Corrected Analyst"} {
		got, ok := titles[pid.String()]
		if !ok || got != want {
			t.Fatalf("%s: got %v (present %v), want %v; all %v", pid, got, ok, want, titles)
		}
	}
}
