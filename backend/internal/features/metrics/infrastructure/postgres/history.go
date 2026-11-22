package postgres

import (
	"context"
	"fmt"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// LoadHistory reads the company dashboard's history snapshot
// (company-dashboard-v2 §4) in one REPEATABLE READ transaction: every vacancy
// published at least once with its facts, publication history, pipeline
// configuration and active credits; the stage history of its participations
// not discarded before since (by participation id, participation_history_order_idx);
// its 5 newest participations in any state; delivery entries of the open ones.
func (s *Store) LoadHistory(ctx context.Context, company uuid.UUID, since time.Time) (*app.HistoryData, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	data := &app.HistoryData{Vacancies: []*app.HistoryVacancy{}, People: map[uuid.UUID]app.Person{}}
	ids, err := collectIDs(ctx, tx, `SELECT d.id FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id AND vp.company_id=d.company_id WHERE d.company_id=$1`, company)
	if err != nil {
		return nil, fmt.Errorf("metrics history scope: %w", err)
	}
	if len(ids) == 0 {
		return data, tx.Commit(ctx)
	}
	facts, configs, err := loadVacancies(ctx, tx, company, ids)
	if err != nil {
		return nil, err
	}
	byID := map[uuid.UUID]*app.HistoryVacancy{}
	people := map[uuid.UUID]bool{}
	for _, id := range ids {
		v := &app.HistoryVacancy{Vacancy: facts[id]}
		byID[id] = v
		data.Vacancies = append(data.Vacancies, v)
	}
	if err := loadTramos(ctx, tx, company, ids, facts, people); err != nil {
		return nil, err
	}
	if err := s.loadHistoryState(ctx, tx, company, ids, byID); err != nil {
		return nil, err
	}
	steps := []func() error{
		func() error { return loadLifecycle(ctx, tx, ids, byID) },
		func() error { return loadActiveCredits(ctx, tx, company, ids, byID) },
		// Functions name the deliveries list's attributed_to (overdue rows).
		func() error { return loadFunctions(ctx, tx, ids, facts) },
		func() error { return loadTracks(ctx, tx, company, ids, since, byID) },
		func() error { return loadRecent(ctx, tx, company, ids, byID) },
		func() error {
			// Delivered counts only matter for open vacancies (attention).
			open := map[uuid.UUID]deliveryConfig{}
			for id, c := range configs {
				if byID[id].Status != "closed" && !byID[id].Finished {
					open[id] = c
				}
			}
			entries, err := s.loadEntries(ctx, tx, open)
			for id, e := range entries {
				byID[id].Entries = e
			}
			return err
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}
	for _, v := range data.Vacancies {
		if v.Responsible != nil {
			people[*v.Responsible] = true
		}
	}
	if data.People, err = loadPeople(ctx, tx, company, people); err != nil {
		return nil, err
	}
	return data, tx.Commit(ctx)
}

// loadHistoryState reads the publication state now and the pipeline
// configuration (defaults without a stored one).
func (s *Store) loadHistoryState(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.HistoryVacancy) error {
	rows, err := q.Query(ctx, `SELECT vp.id, vp.status, vp.process_status='finished', pc.configuration
 FROM vacancy_processes vp LEFT JOIN job_draft_pipeline_configs pc ON pc.draft_id=vp.id
 WHERE vp.id=ANY($1) AND vp.company_id=$2`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics history state: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var status string
		var finished bool
		var config []byte
		if err := rows.Scan(&id, &status, &finished, &config); err != nil {
			return err
		}
		v := byID[id]
		v.Status, v.Finished = status, finished
		if v.Pipeline, err = s.pipeline(id, config); err != nil {
			return fmt.Errorf("metrics pipeline of %s: %w", id, err)
		}
	}
	return rows.Err()
}

func loadLifecycle(ctx context.Context, q querier, ids []uuid.UUID, byID map[uuid.UUID]*app.HistoryVacancy) error {
	rows, err := q.Query(ctx, `SELECT process_id, action, created_at FROM vacancy_lifecycle_events
 WHERE process_id=ANY($1) ORDER BY created_at, lifecycle_version`, ids)
	if err != nil {
		return fmt.Errorf("metrics lifecycle: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var e app.LifecycleEvent
		if err := rows.Scan(&id, &e.Action, &e.At); err != nil {
			return err
		}
		byID[id].Lifecycle = append(byID[id].Lifecycle, e)
	}
	return rows.Err()
}

func loadActiveCredits(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.HistoryVacancy) error {
	rows, err := q.Query(ctx, `SELECT process_id, count(*) FROM placement_credits
 WHERE process_id=ANY($1) AND company_id=$2 AND status='active' GROUP BY 1`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics active credits: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var n int64
		if err := rows.Scan(&id, &n); err != nil {
			return err
		}
		byID[id].ActiveCredits = int(n)
	}
	return rows.Err()
}

// loadTracks reads every participation that could be in process since the
// history began or was created after it, with its intake, move, recovery and
// discard rows (substate and not_applicable never change the stage), and the
// company's view of the candidate's name (the dashboard candidates list). A
// carried participation (replacement process) is flagged, not filtered: the
// operational figures count it and the application ones skip it in the
// application layer.
func loadTracks(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, since time.Time, byID map[uuid.UUID]*app.HistoryVacancy) error {
	rows, err := q.Query(ctx, `SELECT p.process_id, p.id, COALESCE(cc.id, u.id), `+candidateName+`, p.created_at, p.origin_channel, p.stage_id, p.discarded_at IS NOT NULL, p.carried_from_participation_id IS NOT NULL,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',h.event_kind,'stage_id',h.stage_id,'at',h.created_at) ORDER BY h.created_at, h.id)
  FROM participation_stage_history h WHERE h.participation_id=p.id AND h.event_kind IN ('intake','move','recovery','discard')),'[]'::jsonb)
 FROM process_participations p`+candidateJoins+`
 WHERE p.process_id=ANY($1) AND (p.discarded_at IS NULL OR p.discarded_at >= $3 OR p.created_at >= $3)
 ORDER BY p.process_id, p.created_at, p.id`, ids, company, since)
	if err != nil {
		return fmt.Errorf("metrics tracks: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var t app.Track
		if err := rows.Scan(&id, &t.ID, &t.Candidate.ID, &t.Candidate.FullName, &t.CreatedAt, &t.Channel, &t.StageID, &t.Discarded, &t.Carried, &t.Moves); err != nil {
			return err
		}
		byID[id].Tracks = append(byID[id].Tracks, t)
	}
	return rows.Err()
}

// loadRecent reads each vacancy's 5 newest participations with the recent-row
// fields (same name rule as the removed legacy dashboard). The organic title
// is the participation snapshot's, like the board; corrections win and manual
// intakes use the company record. A carried participation (replacement
// process) is not a recent application: it is left out before the 5 newest.
func loadRecent(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.HistoryVacancy) error {
	rows, err := q.Query(ctx, `SELECT v.id, r.* FROM unnest($1::uuid[]) v(id) CROSS JOIN LATERAL (
 SELECT p.id, CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END,
 COALESCE(p.company_candidate_id,p.candidate_id),
 COALESCE(CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE COALESCE(cc.full_name,u.full_name) END,''),
 CASE WHEN o.corrections ? 'professional_title' THEN o.corrections->>'professional_title'
 ELSE CASE WHEN p.company_candidate_id IS NOT NULL THEN cc.professional_title ELSE p.profile_snapshot->>'professional_title' END END,
 p.stage_id, p.source, p.created_at, ad.id, COALESCE(ad.full_name,'')
 FROM process_participations p
 LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=$2
 LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id=p.candidate_id AND o.company_id=$2
 LEFT JOIN users ad ON ad.id=p.added_by AND p.source='manual'
 WHERE p.process_id=v.id AND p.carried_from_participation_id IS NULL ORDER BY p.created_at DESC, p.id DESC LIMIT 5) r`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics recent: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var r app.RecentRow
		var addedID *uuid.UUID
		var addedName string
		if err := rows.Scan(&id, &r.ParticipationID, &r.Candidate.Kind, &r.Candidate.ID, &r.Candidate.Name, &r.Candidate.ProfessionalTitle,
			&r.Stage.ID, &r.Source, &r.AppliedAt, &addedID, &addedName); err != nil {
			return err
		}
		r.AppliedAt = r.AppliedAt.UTC()
		if addedID != nil {
			r.AddedBy = &app.RecentPerson{ID: *addedID, Name: addedName}
		}
		byID[id].Recent = append(byID[id].Recent, r)
	}
	return rows.Err()
}
