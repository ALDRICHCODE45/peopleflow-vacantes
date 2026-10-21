package draftstore

import (
	"context"
	"time"

	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) PreviewPipeline(ctx context.Context, company, actor, id uuid.UUID, body []byte) (pc.Preview, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return pc.Preview{}, err
	}
	defer tx.Rollback(ctx)
	// Read-only preview still takes the shared lock order for a coherent snapshot.
	if err = s.authorizePipeline(ctx, tx, company, actor, id, true); err != nil {
		return pc.Preview{}, err
	}
	if err = requireActiveProcess(ctx, tx, id); err != nil {
		return pc.Preview{}, err
	}
	if _, err = lockDeliveryProcess(ctx, tx, id); err != nil {
		return pc.Preview{}, err
	}
	previous, version, err := readPipeline(ctx, tx, id)
	if err != nil {
		return pc.Preview{}, err
	}
	next, err := pc.Replace(previous, body, id, version)
	if err != nil {
		return pc.Preview{}, err
	}
	if _, err = pc.Confirmation(body, true); err != nil {
		return pc.Preview{}, err
	}
	impact, err := pipelineImpact(ctx, tx, id, previous, next)
	if err != nil {
		return pc.Preview{}, err
	}
	return pc.Preview{Stages: next.Stages, Impact: impact, HasImpact: impact.HasImpact()}, nil
}

func pipelineImpact(ctx context.Context, tx pgx.Tx, id uuid.UUID, previous, next pc.Configuration) (pc.Impact, error) {
	empty := pc.EmptyImpact()
	people := []pc.Participation{}
	// Lock every participation in id order after draft and process. All supported
	// mutations and intake share the draft lock, including before this read.
	rows, err := tx.Query(ctx, `SELECT p.id::text,u.id::text,u.full_name,p.stage_id::text,COALESCE(p.previous_stage_id::text,'') FROM process_participations p JOIN users u ON u.id=p.candidate_id WHERE p.process_id=$1 ORDER BY p.id FOR UPDATE OF p`, id)
	if err != nil {
		return empty, err
	}
	for rows.Next() {
		var p pc.Participation
		err = rows.Scan(&p.ID, &p.Candidate.ID, &p.Candidate.FullName, &p.StageID, &p.PreviousStageID)
		if err != nil {
			rows.Close()
			return empty, err
		}
		p.Reached = map[string]bool{}
		p.Marked = map[string]bool{}
		people = append(people, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return empty, err
	}
	history, err := tx.Query(ctx, `SELECT h.participation_id::text,h.stage_id::text,h.event_kind FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1 AND h.event_kind IN ('intake','move','recovery','not_applicable')`, id)
	if err != nil {
		return empty, err
	}
	byID := map[string]int{}
	for i, p := range people {
		byID[p.ID] = i
	}
	for history.Next() {
		var pid, stage, kind string
		if err = history.Scan(&pid, &stage, &kind); err != nil {
			history.Close()
			return empty, err
		}
		p := &people[byID[pid]]
		if kind == "not_applicable" {
			p.Marked[stage] = true
		} else {
			p.Reached[stage] = true
		}
	}
	err = history.Err()
	history.Close()
	if err != nil {
		return empty, err
	}
	impact, err := pc.ComputeImpact(previous, next, people)
	if err != nil {
		return empty, err
	}
	delivery, _, err := readDelivery(ctx, tx, id)
	if err != nil {
		return empty, err
	}
	if delivery.CutoffStageID != nil {
		retained := false
		for _, stage := range next.Stages {
			if stage.ID == *delivery.CutoffStageID {
				retained = true
				break
			}
		}
		if !retained {
			return empty, pc.ErrCutoffStageInUse
		}
	}
	return impact, nil
}

func (s *Store) writePipelineImpact(ctx context.Context, tx pgx.Tx, actor uuid.UUID, impact pc.Impact) error {
	atByID := map[string]time.Time{}
	for _, mark := range impact.NotApplicable {
		at, ok := atByID[mark.ParticipationID]
		if !ok {
			var latest time.Time
			if err := tx.QueryRow(ctx, `SELECT COALESCE(max(created_at),now()) FROM participation_stage_history WHERE participation_id=$1::uuid`, mark.ParticipationID).Scan(&latest); err != nil {
				return err
			}
			at = s.clock().UTC()
			if !at.After(latest) {
				at = latest.Add(time.Microsecond)
			}
		} else {
			at = at.Add(time.Microsecond)
		}
		atByID[mark.ParticipationID] = at
		if _, err := tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,actor_kind,event_kind) VALUES($1,$2::uuid,$3::uuid,$4,$5,'recruiter','not_applicable')`, uuid.New(), mark.ParticipationID, mark.StageID, actor, at); err != nil {
			return err
		}
	}
	return nil
}
