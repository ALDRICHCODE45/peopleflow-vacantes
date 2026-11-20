package postgres

import (
	"context"
	"fmt"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PipelineFrom parses a vacancy's stored pipeline configuration (nil for the
// defaults). The composition root supplies it from the jobs pipeline rules.
type PipelineFrom func(draft uuid.UUID, config []byte) (app.Pipeline, error)

// LoadPipeline reads the pipeline snapshot (v2 §2, §4.4) in one snapshot: the
// company's open vacancies (published, not closed, not finished), their
// tramos and pipeline configuration, and their active participations with
// every history row into the current stage, from which app.StageEntry takes
// the current-stage entry.
func (s *Store) LoadPipeline(ctx context.Context, company uuid.UUID) (*app.PipelineData, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	data := &app.PipelineData{Vacancies: []*app.OpenVacancy{}, People: map[uuid.UUID]app.Person{}}
	byID, ids, err := s.loadOpenVacancies(ctx, tx, company)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return data, tx.Commit(ctx)
	}
	people := map[uuid.UUID]bool{}
	for _, id := range ids {
		v := byID[id]
		data.Vacancies = append(data.Vacancies, v)
		if v.Responsible != nil {
			people[*v.Responsible] = true
		}
	}
	if err := loadOpenTramos(ctx, tx, company, ids, byID, people); err != nil {
		return nil, err
	}
	if err := loadParticipations(ctx, tx, company, ids, byID); err != nil {
		return nil, err
	}
	if data.People, err = loadPeople(ctx, tx, company, people); err != nil {
		return nil, err
	}
	return data, tx.Commit(ctx)
}

func (s *Store) loadOpenVacancies(ctx context.Context, q querier, company uuid.UUID) (map[uuid.UUID]*app.OpenVacancy, []uuid.UUID, error) {
	rows, err := q.Query(ctx, `SELECT d.id, COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''),
 d.requester_kind, d.requester_id, rq.name, pc.configuration,
 (SELECT a.user_id FROM vacancy_assignment_functions fn JOIN vacancy_assignments a ON a.id=fn.assignment_id
  WHERE fn.draft_id=d.id AND fn.ended_at IS NULL AND fn.function='responsible'),
 vr.process_id IS NOT NULL, COALESCE(vr.root_process_id, d.id), vr.sequence
 FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id AND vp.company_id=d.company_id
 LEFT JOIN vacancy_replacements vr ON vr.process_id=d.id
 LEFT JOIN job_draft_requesters rq ON rq.id=d.requester_id AND rq.company_id=d.company_id
 LEFT JOIN job_draft_pipeline_configs pc ON pc.draft_id=d.id
 WHERE d.company_id=$1 AND vp.status<>'closed' AND vp.process_status<>'finished'
 ORDER BY d.id`, company)
	if err != nil {
		return nil, nil, fmt.Errorf("metrics open vacancies: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]*app.OpenVacancy{}
	ids := []uuid.UUID{}
	for rows.Next() {
		v := &app.OpenVacancy{Participations: []app.Participation{}}
		var kind, rqName *string
		var rqID *uuid.UUID
		var config []byte
		var replacement bool
		var sequence *int32
		if err := rows.Scan(&v.ID, &v.Title, &kind, &rqID, &rqName, &config, &v.Responsible, &replacement, &v.RootID, &sequence); err != nil {
			return nil, nil, err
		}
		v.Kind, v.Sequence = app.KindOriginal, intPtr(sequence)
		if replacement {
			v.Kind = app.KindReplacement
		}
		if kind != nil {
			v.Requester = &app.Requester{Kind: *kind, ID: rqID, Name: rqName}
		}
		if v.Pipeline, err = s.pipeline(v.ID, config); err != nil {
			return nil, nil, fmt.Errorf("metrics pipeline of %s: %w", v.ID, err)
		}
		out[v.ID] = v
		ids = append(ids, v.ID)
	}
	return out, ids, rows.Err()
}

// loadOpenTramos reads the open vacancies' tramos; the recruiter filter keeps
// the ones open at the snapshot's as_of in Go.
func loadOpenTramos(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.OpenVacancy, people map[uuid.UUID]bool) error {
	rows, err := q.Query(ctx, `SELECT id, draft_id, user_id, started_at, ended_at FROM vacancy_assignments
 WHERE draft_id=ANY($1) AND company_id=$2 ORDER BY started_at, id`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics pipeline tramos: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var t app.Tramo
		var draft uuid.UUID
		if err := rows.Scan(&t.ID, &draft, &t.UserID, &t.Start, &t.End); err != nil {
			return err
		}
		byID[draft].Tramos = append(byID[draft].Tramos, t)
		people[t.UserID] = true
	}
	return rows.Err()
}

// loadParticipations reads the active participations (not discarded) with
// the company's view of the candidate's name and every history row into the
// current stage (participation_history_order_idx). Without an intake, move or
// recovery row the entry falls back to the participation's creation.
func loadParticipations(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.OpenVacancy) error {
	rows, err := q.Query(ctx, `SELECT p.process_id, p.id, COALESCE(cc.id, u.id), `+candidateName+`, p.stage_id, p.created_at,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',h.event_kind,'at',h.created_at) ORDER BY h.created_at, h.id)
  FROM participation_stage_history h WHERE h.participation_id=p.id AND h.stage_id=p.stage_id),'[]'::jsonb)
 FROM process_participations p`+candidateJoins+`
 WHERE p.process_id=ANY($1) AND p.discarded_at IS NULL
 ORDER BY p.process_id, p.created_at, p.id`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics participations: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var draft uuid.UUID
		var p app.Participation
		var created time.Time
		var events []app.StageEvent
		if err := rows.Scan(&draft, &p.ID, &p.Candidate.ID, &p.Candidate.FullName, &p.StageID, &created, &events); err != nil {
			return err
		}
		entry, ok := app.StageEntry(events)
		if !ok {
			entry = created
		}
		p.EnteredAt = entry
		byID[draft].Participations = append(byID[draft].Participations, p)
	}
	return rows.Err()
}
