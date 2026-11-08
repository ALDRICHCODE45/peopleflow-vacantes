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
// with the jobs rules it shares: the fulfillment business-day calendar and the
// pipeline stage order of manual intake beyond the cutoff.
func newMetricsService(pool *pgxpool.Pool, events auditrepositories.AuditEventRepository) *metricsapp.Service {
	store := metricspostgres.NewStore(pool, events, metricsStagesFrom)
	return metricsapp.NewService(store, businesscalendar.IsBusinessDay, time.Now)
}

func newMetricsHandler(service *metricsapp.Service) *metricshttp.Handler {
	return metricshttp.NewHandler(service)
}

// metricsStagesFrom lists the stages at or beyond the cutoff in the vacancy's
// stored pipeline (the defaults without one), as delivery fulfillment does.
func metricsStagesFrom(draft uuid.UUID, raw []byte, cutoff uuid.UUID) ([]uuid.UUID, error) {
	config := pipelineconfig.Defaults(draft)
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &config); err != nil {
			return nil, err
		}
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
