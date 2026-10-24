//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestManualSkillsDisplayCasing(t *testing.T) {
	f := setupManualIntake(t)
	in := f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID)
	var data map[string]any
	if err := json.Unmarshal(in.Data, &data); err != nil {
		t.Fatal(err)
	}
	data["candidate"].(map[string]any)["skills"] = []string{" React ", "TypeScript", "SQL", "react", "REACT", " "}
	var err error
	in.Data, err = json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	result, err := f.create(in)
	if err != nil {
		t.Fatal(err)
	}
	item := intakeItem(t, result)
	want := []string{"React", "TypeScript", "SQL"}
	if !reflect.DeepEqual(item.Profile.Skills, want) {
		t.Fatalf("response skills=%v", item.Profile.Skills)
	}
	var stored, snapshot []string
	if err := f.pool.QueryRow(context.Background(), `SELECT cc.skills,ARRAY(SELECT jsonb_array_elements_text(p.profile_snapshot->'skills')) FROM process_participations p JOIN company_candidates cc ON cc.id=p.company_candidate_id WHERE p.id=$1`, item.ID).Scan(&stored, &snapshot); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(stored, want) || !reflect.DeepEqual(snapshot, want) {
		t.Fatalf("stored=%v snapshot=%v", stored, snapshot)
	}
	assertManualGETItem(t, f, f.vacancy, result)
}
