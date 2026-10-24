package draftstore

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dashboard"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// DashboardStore composes the draft reader with a transaction-scoped pool count
// supplied by the composition root, without coupling feature adapters.
type DashboardStore struct {
	*Store
	poolAdded func(context.Context, pgx.Tx, uuid.UUID) (int64, error)
}

func NewDashboardStore(store *Store, poolAdded func(context.Context, pgx.Tx, uuid.UUID) (int64, error)) *DashboardStore {
	return &DashboardStore{Store: store, poolAdded: poolAdded}
}

var _ app.Reader = (*DashboardStore)(nil)

// Dashboard performs no mutations. Live gates, visibility and all metrics share
// a repeatable-read snapshot. Pipeline defaults are never materialized by reads.
func (s *DashboardStore) Dashboard(ctx context.Context, company, actor uuid.UUID) (app.Dashboard, error) {
	out := app.Dashboard{OriginByDay: []app.Day{}, Recent: []app.Recent{}}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	auth, err := s.lockGates(ctx, tx, company, actor)
	if err != nil {
		return out, err
	}
	args := []any{company, auth.role == roleOwner, actor}
	rows, err := tx.Query(ctx, `WITH visible AS MATERIALIZED (
 SELECT d.id,COALESCE(p.status,'draft') AS status FROM job_drafts d
 LEFT JOIN vacancy_processes p ON p.id=d.id AND p.company_id=d.company_id WHERE `+visibleV2Drafts+`
 ), stage_counts AS (
 SELECT pp.process_id,pp.stage_id,count(*) AS total,
 count(*) FILTER(WHERE pp.discarded_at IS NOT NULL) AS discarded,
 count(*) FILTER(WHERE pp.discarded_at IS NULL) AS active
 FROM process_participations pp JOIN visible v ON v.id=pp.process_id AND v.status='published'
 GROUP BY pp.process_id,pp.stage_id
 ), counts AS (
 SELECT process_id,jsonb_build_object('total',sum(total),'discarded',sum(discarded),
 'by_stage',jsonb_agg(jsonb_build_object('id',stage_id,'count',active))) AS summary
 FROM stage_counts GROUP BY process_id
 ) SELECT v.id,v.status,c.configuration,c.version,m.hiring_headcount,m.version,counts.summary
 FROM visible v LEFT JOIN job_draft_pipeline_configs c ON c.draft_id=v.id
 LEFT JOIN job_draft_management_configs m ON m.draft_id=v.id
 LEFT JOIN counts ON counts.process_id=v.id`, args...)
	if err != nil {
		return out, err
	}
	type vacancy struct {
		id                                            uuid.UUID
		status                                        string
		pipeline, counts                              []byte
		pipelineVersion, headcount, managementVersion *int64
	}
	visible := []vacancy{}
	for rows.Next() {
		var v vacancy
		if err = rows.Scan(&v.id, &v.status, &v.pipeline, &v.pipelineVersion, &v.headcount, &v.managementVersion, &v.counts); err != nil {
			rows.Close()
			return out, err
		}
		visible = append(visible, v)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return out, err
	}
	ids := make([]uuid.UUID, 0, len(visible))
	stages := map[string]string{}
	publishedIDs := []uuid.UUID{}
	placements := []string{}
	for _, v := range visible {
		ids = append(ids, v.id)
		config := pipelineconfig.Defaults(v.id)
		if v.pipelineVersion != nil {
			config, err = decodeStoredPipeline(v.id, v.pipeline, *v.pipelineVersion)
			if err != nil {
				return out, err
			}
		}
		for _, stage := range append(append([]pipelineconfig.Stage{}, config.Stages...), config.Exit) {
			stages[stage.ID] = stage.Name
		}
		for _, stage := range config.Retired {
			stages[stage.ID] = stage.Name
		}
		if v.status != "published" {
			continue
		}
		out.PublishedVacancies++
		counts, err := listCandidates(config, v.counts)
		if err != nil {
			return out, err
		}
		out.InProcess += counts.InProcess
		placement := ""
		for _, stage := range config.Stages {
			if stage.Kind == "placement" {
				placement = stage.ID
			}
		}
		publishedIDs = append(publishedIDs, v.id)
		placements = append(placements, placement)
		if v.managementVersion != nil && *v.managementVersion < 1 {
			return out, fmt.Errorf("dashboard: invalid management version")
		}
		if v.headcount != nil {
			if *v.headcount < 1 || *v.headcount > vacancymanagement.MaxHiringHeadcount {
				return out, fmt.Errorf("dashboard: invalid headcount")
			}
			out.Positions.Required += *v.headcount
		}
	}
	out.Positions.Covered, err = db.ReadPlacementCoverageTotal(ctx, tx, publishedIDs, placements)
	if err != nil {
		return out, err
	}
	added, err := s.poolAdded(ctx, tx, company)
	if err != nil {
		return out, err
	}
	out.PoolAddedLast7Days = added
	// created_at is the board's applied_at (entry time), not last stage movement.
	rows, err = tx.Query(ctx, `SELECT (created_at AT TIME ZONE 'America/Mexico_City')::date::text,
 count(*) FILTER(WHERE source='organic'),count(*) FILTER(WHERE source='manual')
 FROM process_participations WHERE process_id=ANY($1::uuid[])
 AND created_at>=((now() AT TIME ZONE 'America/Mexico_City')::date-90)::timestamp AT TIME ZONE 'America/Mexico_City'
 GROUP BY 1 ORDER BY 1`, ids)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var day app.Day
		if err = rows.Scan(&day.Date, &day.Organic, &day.Manual); err != nil {
			rows.Close()
			return out, err
		}
		out.OriginByDay = append(out.OriginByDay, day)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows, err = tx.Query(ctx, `SELECT p.id,CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END,
 COALESCE(p.company_candidate_id,p.candidate_id),
 CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE COALESCE(cc.full_name,u.full_name) END,
 p.process_id,convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',p.stage_id,p.source,p.created_at,ad.id,ad.full_name
 FROM process_participations p JOIN job_drafts d ON d.id=p.process_id
 LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=d.company_id
 LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id=p.candidate_id AND o.company_id=d.company_id
 LEFT JOIN users ad ON ad.id=p.added_by AND p.source='manual'
 WHERE p.process_id=ANY($1::uuid[]) ORDER BY p.created_at DESC,p.id DESC LIMIT 10`, ids)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item app.Recent
		var addedID *uuid.UUID
		var addedName *string
		if err = rows.Scan(&item.ParticipationID, &item.Candidate.Kind, &item.Candidate.ID, &item.Candidate.Name, &item.Vacancy.ID, &item.Vacancy.Title, &item.Stage.ID, &item.Source, &item.AppliedAt, &addedID, &addedName); err != nil {
			rows.Close()
			return out, err
		}
		name, ok := stages[item.Stage.ID.String()]
		if !ok {
			rows.Close()
			return out, fmt.Errorf("dashboard: unknown stage")
		}
		item.Stage.Name = name
		item.AppliedAt = item.AppliedAt.UTC()
		if item.Source == "manual" {
			if addedID == nil || addedName == nil {
				rows.Close()
				return out, fmt.Errorf("dashboard: missing manual actor")
			}
			item.AddedBy = &app.Person{ID: *addedID, Name: *addedName}
		}
		out.Recent = append(out.Recent, item)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return out, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	return out, nil
}
