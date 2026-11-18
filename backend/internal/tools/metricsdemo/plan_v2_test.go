package metricsdemo

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// The demo holds only states the app can reach (T13): its board and draft
// list refuse the others. Every published vacancy has a complete delivery
// configuration (publication requires it), every active participation sits
// in a stage of its vacancy's current pipeline (the app retires only empty
// stages) and every discarded one sits in the exit stage.
func TestBuildPlanStatesAreReachable(t *testing.T) {
	zone, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		t.Fatal(err)
	}
	for _, now := range []time.Time{
		time.Date(2026, 11, 8, 18, 0, 0, 0, time.UTC),
		time.Date(2027, 1, 1, 0, 30, 0, 0, zone),
		time.Date(2028, 2, 29, 23, 30, 0, 0, zone),
	} {
		plan, err := BuildPlan(now, testPeople)
		if err != nil {
			t.Fatal(err)
		}
		published := map[uuid.UUID]bool{}
		delivery := map[uuid.UUID]bool{}
		pipelines := map[uuid.UUID]pipelineconfig.Configuration{}
		type participation struct {
			process, stage uuid.UUID
			discarded      bool
		}
		var parts []participation
		for _, s := range plan.Statements {
			switch tableOf(s.SQL) {
			case "vacancy_processes":
				published[s.Args[0].(uuid.UUID)] = true
			case "job_draft_delivery_configs":
				// draft_id,version,cutoff_stage_id,target_quantity,commitment_date
				delivery[s.Args[0].(uuid.UUID)] = s.Args[2] != nil && s.Args[3] != nil && s.Args[4] != nil
			case "job_draft_pipeline_configs":
				var c pipelineconfig.Configuration
				if err := json.Unmarshal(s.Args[2].([]byte), &c); err != nil {
					t.Fatal(err)
				}
				pipelines[s.Args[0].(uuid.UUID)] = c
			case "process_participations":
				parts = append(parts, participation{process: s.Args[1].(uuid.UUID), stage: s.Args[3].(uuid.UUID), discarded: s.Args[16].(*time.Time) != nil})
			}
		}
		if len(published) == 0 || len(parts) == 0 {
			t.Fatal("empty plan")
		}
		for id := range published {
			if !delivery[id] {
				t.Errorf("%s: published vacancy %s without a complete delivery configuration", now.Format(time.DateOnly), id)
			}
		}
		for _, p := range parts {
			config, ok := pipelines[p.process]
			if !ok {
				config = pipelineconfig.Defaults(p.process)
			}
			want := map[string]bool{}
			if p.discarded {
				want[config.Exit.ID] = true
			} else {
				for _, s := range config.Stages {
					want[s.ID] = true
				}
			}
			if !want[p.stage.String()] {
				t.Errorf("%s: participation of %s (discarded=%v) in stage %s outside its current pipeline", now.Format(time.DateOnly), p.process, p.discarded, p.stage)
			}
		}
	}
}
