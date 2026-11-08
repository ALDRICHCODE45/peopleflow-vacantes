package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ vacancyteam.AssignmentHistoryStore = (*Store)(nil)

// GetAssignmentHistory deliberately does not use vacancy authorization: ended
// stays remain readable, but only by their user in their current company.
func (s *Store) GetAssignmentHistory(ctx context.Context, company, actor uuid.UUID, token string) (drafts.Result, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := s.lockGates(ctx, tx, company, actor); err != nil {
		return drafts.Result{}, err
	}
	// A nil draft scope keeps these cursors distinct from vacancy team cursors.
	scope := vacancyteam.Scope{CompanyID: company, ActorID: actor}
	query := `WITH timeline AS (
 SELECT a.*,COALESCE(a.ended_at,(SELECT max(f.started_at) FROM vacancy_assignment_functions f WHERE f.assignment_id=a.id),a.started_at) AS at
 FROM vacancy_assignments a JOIN job_drafts d ON d.id=a.draft_id AND d.company_id=$1
 WHERE a.company_id=$1 AND a.user_id=$2
 ) SELECT a.id,a.draft_id,a.at,a.started_at,a.ended_at,c.cutoff_stage_id::text,d.fields,
 (CASE WHEN a.ended_at IS NULL THEN COALESCE(a.recruiter_deadline,c.commitment_date) ELSE a.closing_deadline END)::text,
 f.process_id IS NOT NULL,(f.candidates->(f.target-1)->>'reached_at')::timestamptz,COALESCE(f.target,c.target_quantity),
 jsonb_build_object(
 'vacancy_status',jsonb_build_object('publication',COALESCE(vp.status,'draft'),'process',vp.process_status),
 'vacancy_title',convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',
 'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('function',f.function,'started_at',f.started_at,'ended_at',f.ended_at) ORDER BY f.started_at,f.id) FROM vacancy_assignment_functions f WHERE f.assignment_id=a.id),'[]'::jsonb),
 'started_at',a.started_at,'ended_at',a.ended_at,'end_cause',a.end_cause,
 'effective_deadline',CASE WHEN a.ended_at IS NULL THEN COALESCE(a.recruiter_deadline,c.commitment_date) ELSE a.closing_deadline END,
 'placements',(SELECT jsonb_build_object('direct',count(*) FILTER (WHERE r.kind='direct'),'participant',count(*) FILTER (WHERE r.kind='participant'),'shared',count(*) FILTER (WHERE r.kind='shared'))
 FROM placement_credit_recipients r JOIN placement_credits pc ON pc.id=r.credit_id
 WHERE r.assignment_id=a.id AND r.user_id=$2 AND pc.company_id=$1 AND pc.process_id=a.draft_id AND pc.status IN ('active','did_not_hold')))
 FROM timeline a JOIN job_drafts d ON d.id=a.draft_id LEFT JOIN job_draft_delivery_configs c ON c.draft_id=a.draft_id
 LEFT JOIN vacancy_processes vp ON vp.id=a.draft_id
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=a.draft_id`
	args := []any{company, actor}
	if token != "" {
		c, err := vacancyteam.DecodeCursor(token, scope)
		if err != nil || c.Kind != "tramo" {
			return drafts.Result{}, vacancyteam.ErrInvalidCursor
		}
		query += ` WHERE a.at < $3 OR (a.at=$3 AND a.id>$4::uuid)`
		args = append(args, c.At, c.ID)
	}
	query += ` ORDER BY a.at DESC,a.id ASC LIMIT 21`
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("read own assignment history: %w", err)
	}
	type entry struct {
		cursor    vacancyteam.Cursor
		draft     uuid.UUID
		start     time.Time
		end       *time.Time
		cutoff    *string
		fields    []byte
		deadline  *string
		frozen    bool
		fulfilled *time.Time
		target    *int64
		body      map[string]json.RawMessage
	}
	entries := []entry{}
	for rows.Next() {
		e := entry{cursor: vacancyteam.Cursor{Scope: scope, Kind: "tramo"}}
		var raw []byte
		if err := rows.Scan(&e.cursor.ID, &e.draft, &e.cursor.At, &e.start, &e.end, &e.cutoff, &e.fields, &e.deadline, &e.frozen, &e.fulfilled, &e.target, &raw); err != nil {
			rows.Close()
			return drafts.Result{}, err
		}
		if e.frozen && e.fulfilled == nil {
			rows.Close()
			return drafts.Result{}, errors.New("draftstore: fulfillment without the target candidate")
		}
		if err := json.Unmarshal(raw, &e.body); err != nil {
			rows.Close()
			return drafts.Result{}, err
		}
		entries = append(entries, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return drafts.Result{}, err
	}
	var next *string
	if len(entries) > 20 {
		entries = entries[:20]
		value, err := vacancyteam.EncodeCursor(entries[19].cursor)
		if err != nil {
			return drafts.Result{}, err
		}
		next = &value
	}
	items := make([]map[string]json.RawMessage, 0, len(entries))
	now := s.clock().UTC()
	zone, err := time.LoadLocation(deliveryconfig.TimeZone)
	if err != nil {
		return drafts.Result{}, err
	}
	for _, e := range entries {
		end := now
		if e.end != nil {
			end = *e.end
		}
		count, err := deliveredInAssignment(ctx, tx, e.draft, actor, e.cutoff, e.start, end)
		if err != nil {
			return drafts.Result{}, err
		}
		name, err := requesterNameForRead(ctx, tx, company, e.fields)
		if err != nil {
			return drafts.Result{}, err
		}
		var requester any
		if name != nil {
			kind, _, _, err := requesterRef(e.fields)
			if err != nil {
				return drafts.Result{}, err
			}
			requester = map[string]any{"kind": kind, "name": *name}
		}
		var draftID any
		if e.end == nil {
			draftID = e.draft
		}
		result, delta := assignmentDeadlineResult(e.start, end, e.end != nil, e.deadline, e.cutoff != nil && e.target != nil, e.fulfilled, zone)
		for key, value := range map[string]any{
			"draft_id":                     draftID,
			"requester":                    requester,
			"business_days_in_tramo":       vacancyteam.SnapshotTramo(e.start, end, nil, nil, zone).BusinessDaysElapsed,
			"delivery_target":              e.target,
			"deadline_result":              result,
			"deadline_delta_business_days": delta,
			"delivered_in_tramo":           count,
		} {
			raw, err := json.Marshal(value)
			if err != nil {
				return drafts.Result{}, err
			}
			e.body[key] = raw
		}
		items = append(items, e.body)
	}
	body, err := json.Marshal(struct {
		Items      []map[string]json.RawMessage `json:"items"`
		NextCursor *string                      `json:"next_cursor"`
	}{items, next})
	if err != nil {
		return drafts.Result{}, err
	}
	return drafts.Result{Body: body}, nil
}

// fulfilled is the target moment of stakeholder-metrics-v1 §2.3 (D8): the
// reached_at of the N-th frozen candidate, never fulfilled_at, which can be a
// configuration save or a recovery time.
// assignmentDeadlineResult evaluates the shared target only within this stay's
// half-open instant window. Civil-date comparisons, not delta signs, determine
// lateness: a weekend may be late with a zero business-day delta.
func assignmentDeadlineResult(start, end time.Time, ended bool, deadline *string, configured bool, fulfilled *time.Time, zone *time.Location) (string, *int) {
	if deadline == nil || !configured {
		return "none", nil
	}
	if fulfilled != nil && fulfilled.Before(start) {
		return "not_applicable", nil
	}
	if fulfilled != nil && !fulfilled.Before(start) && fulfilled.Before(end) {
		result, delta := fulfillment.Evaluate(*fulfilled, *deadline, zone)
		return result, &delta
	}
	result, delta := fulfillment.Evaluate(end, *deadline, zone)
	if result != "late" {
		result = "pending"
		if ended {
			result = "unfinished"
		}
	}
	return result, &delta
}

// Match fulfillment's cutoff-entry semantics, including only manual intake
// that skips the cutoff. Reuse its pipeline stage ordering, but aggregate only
// participation IDs; candidate identities never enter this projection.
func deliveredInAssignment(ctx context.Context, tx pgx.Tx, draft, actor uuid.UUID, cutoff *string, start, end time.Time) (int64, error) {
	if cutoff == nil {
		return 0, nil
	}
	stages, err := manualDeliveryStages(ctx, tx, draft, *cutoff)
	if err != nil {
		return 0, err
	}
	var count int64
	err = tx.QueryRow(ctx, `SELECT count(DISTINCT p.id)
 FROM process_participations p JOIN participation_stage_history h ON h.participation_id=p.id
 WHERE p.process_id=$1 AND h.actor_id=$2 AND h.created_at >= $3 AND h.created_at < $4
 AND (h.stage_id=$5::uuid OR (p.source='manual' AND h.event_kind='intake' AND h.stage_id=ANY($6::uuid[])))
 AND h.event_kind IN ('intake','move','recovery')`, draft, actor, start, end, *cutoff, stages).Scan(&count)
	return count, err
}
