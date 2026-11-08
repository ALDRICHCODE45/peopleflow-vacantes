package main

import (
	"encoding/json"
	"time"

	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	metricsapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	metricshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/infrastructure/http"
	metricspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newMetricsService composes the metrics read API (stakeholder-metrics-v1 §3)
// with the jobs rules it shares: the fulfillment business-day calendar, the
// pipeline stage order of manual intake beyond the cutoff and the pipeline
// configuration of the pipeline section (v2 §4.4).
func newMetricsService(pool *pgxpool.Pool, events auditrepositories.AuditEventRepository) *metricsapp.Service {
	store := metricspostgres.NewStore(pool, events, metricsStagesFrom, metricsPipelineFrom)
	return metricsapp.NewService(store, businesscalendar.IsBusinessDay, time.Now)
}

func newMetricsHandler(service *metricsapp.Service) *metricshttp.Handler {
	return metricshttp.NewHandler(service)
}

// metricsPipeline is the vacancy's stored pipeline, the defaults without one.
func metricsPipeline(draft uuid.UUID, raw []byte) (pipelineconfig.Configuration, error) {
	config := pipelineconfig.Defaults(draft)
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &config); err != nil {
			return pipelineconfig.Configuration{}, err
		}
	}
	return config, nil
}

// metricsPipelineFrom maps the vacancy's pipeline to the metrics shape:
// progression stages in order, the exit stage and the retired stages.
func metricsPipelineFrom(draft uuid.UUID, raw []byte) (metricsapp.Pipeline, error) {
	config, err := metricsPipeline(draft, raw)
	if err != nil {
		return metricsapp.Pipeline{}, err
	}
	stage := func(s pipelineconfig.Stage) (metricsapp.PipelineStage, error) {
		id, err := uuid.Parse(s.ID)
		return metricsapp.PipelineStage{ID: id, Kind: s.Kind, Name: s.Name}, err
	}
	var out metricsapp.Pipeline
	exit, err := stage(config.Exit)
	if err != nil {
		return out, err
	}
	out.Exit = exit.ID
	for _, s := range config.Stages {
		st, err := stage(s)
		if err != nil {
			return out, err
		}
		out.Stages = append(out.Stages, st)
	}
	for _, s := range config.RetiredStages() {
		st, err := stage(s)
		if err != nil {
			return out, err
		}
		out.Retired = append(out.Retired, st)
	}
	return out, nil
}

// metricsStagesFrom lists the stages at or beyond the cutoff in the vacancy's
// stored pipeline (the defaults without one), as delivery fulfillment does.
func metricsStagesFrom(draft uuid.UUID, raw []byte, cutoff uuid.UUID) ([]uuid.UUID, error) {
	config, err := metricsPipeline(draft, raw)
	if err != nil {
		return nil, err
	}
	out := []uuid.UUID{}
	found := false
	for _, stage := range config.Stages {
		found = found || stage.ID == cutoff.String()
		if found {
			id, err := uuid.Parse(stage.ID)
			if err != nil {
				return nil, err
			}
			out = append(out, id)
		}
	}
	return out, nil
}
