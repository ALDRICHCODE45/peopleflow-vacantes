package postgres

import (
	"context"
	"errors"
	"fmt"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// candidateName is the name the company sees: the manual candidate's name, or
// the company's correction of an organic candidate's name, else the account name.
const candidateName = `COALESCE(cc.full_name, CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE u.full_name END, '')`

const candidateJoins = ` LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=$2
 LEFT JOIN company_candidate_corrections o ON o.company_id=$2 AND o.user_id=p.candidate_id`

// audited runs a §3.5 read and its MetricsDetailViewed row in one read-write
// transaction: a failed audit insert fails the read (fail-closed). A vacancy of
// another company, or never published, is 404 and writes nothing.
func (s *Store) audited(ctx context.Context, company, actor, draft uuid.UUID, report string, read func(pgx.Tx) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var found bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id AND vp.company_id=d.company_id
 WHERE d.id=$1 AND d.company_id=$2)`, draft, company).Scan(&found); err != nil {
		return err
	}
	if !found {
		return app.ErrNotFound
	}
	if err := read(tx); err != nil {
		return err
	}
	if err := s.audit.Append(ctx, tx, auditentities.AuditEvent{
		ID: uuid.Must(uuid.NewV7()), ActorType: auditentities.ActorTypeUser, ActorID: &actor,
		EventType: auditentities.EventMetricsDetailViewed, EntityType: "vacancy", EntityID: draft,
		CompanyID: &company, VacancyID: &draft,
		Metadata: map[string]string{"report": report, "vacancy_id": draft.String()},
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Deliveries lists every delivered candidate in delivery order (the count never
// goes down), with the recruiter whose entry delivered them.
func (s *Store) Deliveries(ctx context.Context, company, actor, draft uuid.UUID) ([]app.DeliveryRow, error) {
	out := []app.DeliveryRow{}
	err := s.audited(ctx, company, actor, draft, "deliveries", func(tx pgx.Tx) error {
		var cutoff *uuid.UUID
		var pipeline []byte
		var configured bool
		err := tx.QueryRow(ctx, `SELECT COALESCE(f.cutoff_stage_id, c.cutoff_stage_id), pc.configuration,
 f.process_id IS NOT NULL OR (c.cutoff_stage_id IS NOT NULL AND c.target_quantity IS NOT NULL AND c.commitment_date IS NOT NULL)
 FROM job_drafts d LEFT JOIN job_draft_delivery_configs c ON c.draft_id=d.id
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=d.id
 LEFT JOIN job_draft_pipeline_configs pc ON pc.draft_id=d.id WHERE d.id=$1`, draft).Scan(&cutoff, &pipeline, &configured)
		if err != nil {
			return err
		}
		if !configured || cutoff == nil {
			return nil
		}
		entries, err := s.loadEntries(ctx, tx, map[uuid.UUID]deliveryConfig{draft: {cutoff: *cutoff, pipeline: pipeline}})
		if err != nil {
			return err
		}
		reaches := app.Reaches(entries[draft])
		if len(reaches) == 0 {
			return nil
		}
		ids := make([]uuid.UUID, len(reaches))
		people := map[uuid.UUID]bool{}
		for i, e := range reaches {
			ids[i] = e.ParticipationID
			if e.ByRecruiter {
				people[e.ActorID] = true
			}
		}
		candidates, err := loadCandidates(ctx, tx, company, ids)
		if err != nil {
			return err
		}
		names, err := loadPeople(ctx, tx, company, people)
		if err != nil {
			return err
		}
		for _, e := range reaches {
			row := app.DeliveryRow{Candidate: candidates[e.ParticipationID], ReachedAt: e.At.UTC()}
			if e.ByRecruiter {
				p := names[e.ActorID]
				row.DeliveredBy = &p
			}
			out = append(out, row)
		}
		return nil
	})
	return out, err
}

func loadCandidates(ctx context.Context, q querier, company uuid.UUID, participations []uuid.UUID) (map[uuid.UUID]app.Candidate, error) {
	rows, err := q.Query(ctx, `SELECT p.id, COALESCE(cc.id, u.id), `+candidateName+`
 FROM process_participations p`+candidateJoins+` WHERE p.id=ANY($1)`, participations, company)
	if err != nil {
		return nil, fmt.Errorf("metrics candidates: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]app.Candidate{}
	for rows.Next() {
		var pid uuid.UUID
		var c app.Candidate
		if err := rows.Scan(&pid, &c.ID, &c.FullName); err != nil {
			return nil, err
		}
		out[pid] = c
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) != len(participations) {
		return nil, errors.New("metrics: delivered participation without a candidate")
	}
	return out, nil
}

// Placements lists the vacancy's active and did_not_hold credits, oldest hire
// first; voided credits are not listed, as in the counts (M3).
func (s *Store) Placements(ctx context.Context, company, actor, draft uuid.UUID) ([]app.PlacementRow, error) {
	out := []app.PlacementRow{}
	err := s.audited(ctx, company, actor, draft, "placements", func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT pc.id, COALESCE(cc.id, u.id), `+candidateName+`, pc.hired_at, pc.status
 FROM placement_credits pc JOIN process_participations p ON p.id=pc.participation_id`+candidateJoins+`
 WHERE pc.process_id=$1 AND pc.company_id=$2 AND pc.status IN ('active','did_not_hold') ORDER BY pc.hired_at, pc.id`, draft, company)
		if err != nil {
			return fmt.Errorf("metrics placements: %w", err)
		}
		var credits []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			row := app.PlacementRow{Recipients: []app.PlacementPerson{}}
			if err := rows.Scan(&id, &row.Candidate.ID, &row.Candidate.FullName, &row.HiredAt, &row.Status); err != nil {
				rows.Close()
				return err
			}
			row.HiredAt = row.HiredAt.UTC()
			credits = append(credits, id)
			out = append(out, row)
		}
		rows.Close()
		if err := rows.Err(); err != nil || len(credits) == 0 {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT credit_id, user_id, kind FROM placement_credit_recipients WHERE credit_id=ANY($1) ORDER BY credit_id, kind, user_id`, credits)
		if err != nil {
			return err
		}
		type recipient struct {
			credit, user uuid.UUID
			kind         string
		}
		var recipients []recipient
		people := map[uuid.UUID]bool{}
		for rows.Next() {
			var r recipient
			if err := rows.Scan(&r.credit, &r.user, &r.kind); err != nil {
				rows.Close()
				return err
			}
			recipients = append(recipients, r)
			people[r.user] = true
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		names, err := loadPeople(ctx, tx, company, people)
		if err != nil {
			return err
		}
		index := map[uuid.UUID]int{}
		for i, id := range credits {
			index[id] = i
		}
		for _, r := range recipients {
			i := index[r.credit]
			out[i].Recipients = append(out[i].Recipients, app.PlacementPerson{Person: names[r.user], Kind: r.kind})
		}
		return nil
	})
	return out, err
}
