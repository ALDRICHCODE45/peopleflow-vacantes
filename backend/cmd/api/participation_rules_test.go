package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
)

func TestParticipationRulesReusePublishedContracts(t *testing.T) {
	rules := participationRules{}
	id := uuid.New()
	if rules.InitialStage(id).String() != pipelineconfig.Defaults(id).Stages[0].ID {
		t.Fatal("production adapter changed built-in new identity")
	}
	d, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	public, err := publicjobs.BuildScreening(d.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	intake, err := rules.Screening(d.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(intake)
	if intake.Revision != public.Revision || len(intake.Questions) != 1 || intake.Questions[0].Prompt != "Why?" || !strings.Contains(string(raw), `"options":null`) {
		t.Fatal(intake)
	}
}
