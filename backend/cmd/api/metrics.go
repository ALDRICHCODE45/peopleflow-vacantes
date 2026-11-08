package main

import (
	"context"
	"encoding/json"
	"time"

	poolpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/pool"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	talentbasepostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres/talentbase"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	metricsapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	metricshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/infrastructure/http"
	metricspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newMetricsService composes the metrics read API (stakeholder-metrics-v1 §3)
// with the jobs rules it shares: the fulfillment business-day calendar, the
// pipeline stage order of manual intake beyond the cutoff and the pipeline
// configuration of the pipeline section (v2 §4.4), plus the talent base's
// access rule and added count for the company dashboard (company-dashboard-v2
// §3.1).
func newMetricsService(pool *pgxpool.Pool, events auditrepositories.AuditEventRepository) *metricsapp.Service {
	store := metricspostgres.NewStore(pool, events, metricsStagesFrom, metricsPipelineFrom)
	return metricsapp.NewService(store, businesscalendar.IsBusinessDay, time.Now).WithTalentBase(dashboardTalentBase(pool))
}

// dashboardTalentBase reuses the talent base visibility rule and the pool's
// added rule: pool_added is company-wide and null without access.
func dashboardTalentBase(pool *pgxpool.Pool) metricsapp.TalentBase {
	return metricsapp.TalentBase{
		CanView: func(ctx context.Context, company, user uuid.UUID) (bool, error) {
			tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
			if err != nil {
				return false, err
			}
			defer tx.Rollback(ctx)
			allowed, err := talentbasepostgres.CanViewIn(ctx, tx, company, user)
			if err != nil {
				return false, err
			}
			return allowed, tx.Commit(ctx)
		},
		Added: func(ctx context.Context, company uuid.UUID, current, previous metricsapp.Period) (int, int, error) {
			cur, prev, err := poolpostgres.ReadAddedBetween(ctx, pool, company, current.Start, current.End, previous.Start, previous.End)
			return int(cur), int(prev), err
		},
	}
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
	out.Exit, out.ExitName = exit.ID, exit.Name
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
