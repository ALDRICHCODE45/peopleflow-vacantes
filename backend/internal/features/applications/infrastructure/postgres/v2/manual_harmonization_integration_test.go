//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestManualHarmonizationPersistenceReuseAndSnapshot(t *testing.T) {
	f := setupManualIntake(t)
	in := f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID)
	var data map[string]any
	if err := json.Unmarshal(in.Data, &data); err != nil {
		t.Fatal(err)
	}
	c := data["candidate"].(map[string]any)
	c["education"] = []any{
		map[string]any{"level": "bachelor", "institution": " UNAM ", "field": " Computación ", "status": "completed", "start_year": 2015, "end_year": 2020},
		map[string]any{"level": "master", "institution": nil, "field": nil, "status": "completed", "start_year": nil, "end_year": nil},
		map[string]any{"level": "phd", "institution": nil, "field": nil, "status": "in_progress", "start_year": 2024, "end_year": nil},
		map[string]any{"level": "specialty", "institution": nil, "field": nil, "status": "completed", "start_year": nil, "end_year": nil},
		map[string]any{"level": "technical", "institution": nil, "field": nil, "status": "in_progress", "start_year": nil, "end_year": nil},
	}
	in = intakeChange(t, in, "candidate", c)
	result, err := f.create(in)
	if err != nil {
		t.Fatal(err)
	}
	item := intakeItem(t, result)
	assertManualGETItem(t, f, f.vacancy, result)
	ctx := context.Background()
	var years, seniority, code, level, institution, field string
	var count int
	err = f.pool.QueryRow(ctx, `SELECT c.years_of_experience::text,c.seniority,l.code,l.level,e.institution,e.field,(SELECT count(*) FROM company_candidate_educations WHERE company_candidate_id=c.id) FROM company_candidates c JOIN company_candidate_languages l ON l.company_candidate_id=c.id JOIN company_candidate_educations e ON e.company_candidate_id=c.id AND e.position=0 WHERE c.id=$1`, item.Candidate.ID).Scan(&years, &seniority, &code, &level, &institution, &field, &count)
	if err != nil || years != "7.9" || seniority != "senior" || code != "en" || level != "native" || institution != "UNAM" || field != "Computación" || count != 5 {
		t.Fatal(years, seniority, code, level, institution, field, count, err)
	}
	assertSnapshot := func(id any, want any) {
		t.Helper()
		var raw []byte
		if err := f.pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE id=$1`, id).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		snapshot := movementKeys(t, movementObject(t, raw), "location", "skills", "years_of_experience", "seniority", "education", "languages")
		education := movementKeys(t, snapshot["education"], "highest_completed", "in_progress")
		spoken := snapshot["languages"].([]any)
		if snapshot["years_of_experience"] != "7.9" || snapshot["seniority"] != "senior" || education["highest_completed"] != want || education["in_progress"] != "phd" || len(spoken) != 1 {
			t.Fatal(snapshot)
		}
		language := movementKeys(t, spoken[0], "code", "level")
		if language["code"] != "en" || language["level"] != "native" {
			t.Fatal(snapshot)
		}
	}
	assertSnapshot(item.ID, "master")
	other := intakeOtherDraft(t, f, true)
	reuse := f.input(pipelineconfig.Defaults(other).Stages[0].ID)
	reuse = intakeChange(t, reuse, "candidate", nil)
	reuse = intakeChange(t, reuse, "existing", map[string]any{"kind": "manual", "id": item.Candidate.ID})
	reused, err := f.board.CreateManual(ctx, f.company, f.recruiter, other, reuse, f.inspect, f.files)
	if err != nil {
		t.Fatal(err)
	}
	assertManualGETItem(t, f, other, reused)
	assertSnapshot(intakeItem(t, reused).ID, "master")
	// Manual board profiles are live: the completed specialty now wins;
	// an ongoing doctorate does not count as a completed qualification.
	duplicateExec(t, f.movementFixture, `UPDATE company_candidate_educations SET status='paused' WHERE company_candidate_id=$1 AND level IN ('bachelor','master')`, item.Candidate.ID)
	got, err := f.board.Board(ctx, f.company, f.recruiter, f.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range got.Participations {
		if p.ID == item.ID {
			found = true
			if p.Profile.Education.HighestCompleted == nil || *p.Profile.Education.HighestCompleted != "specialty" || p.Profile.Education.InProgress == nil || *p.Profile.Education.InProgress != "phd" || p.Profile.YearsOfExperience == nil || *p.Profile.YearsOfExperience != "7.9" {
				t.Fatal(p.Profile)
			}
		}
	}
	if !found {
		t.Fatal("manual row missing")
	}
	third := intakeOtherDraft(t, f, true)
	reuse = intakeChange(t, reuse, "stage_id", pipelineconfig.Defaults(third).Stages[0].ID)
	// Use a distinct replay key for the new process.
	reuse.IdempotencyKey = third
	result, err = f.board.CreateManual(ctx, f.company, f.recruiter, third, reuse, f.inspect, f.files)
	if err != nil {
		t.Fatal(err)
	}
	assertSnapshot(intakeItem(t, result).ID, "specialty")
	assertManualGETItem(t, f, third, result)
}
