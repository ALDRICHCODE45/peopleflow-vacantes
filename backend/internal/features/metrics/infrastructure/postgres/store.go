// Package postgres loads the metric facts of stakeholder-metrics-v1 §2 with SQL
// over the domain tables, computed on every request (§3.6), and writes the
// MetricsDetailViewed audit row of the §3.5 detail reads.
package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"time"

	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StagesFrom returns the stage ids at or beyond the cutoff in a vacancy's
// pipeline (config is the stored configuration, nil for the defaults). The
// composition root supplies it from the jobs pipeline rules: manual intake at
// or beyond the cutoff counts as a delivery, as in delivery fulfillment.
type StagesFrom func(draft uuid.UUID, config []byte, cutoff uuid.UUID) ([]uuid.UUID, error)

type Store struct {
	pool   *pgxpool.Pool
	audit  auditrepositories.AuditEventRepository
	stages StagesFrom
}

var _ app.Store = (*Store)(nil)

func NewStore(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository, stages StagesFrom) *Store {
	return &Store{pool: pool, audit: audit, stages: stages}
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// requesterSQL narrows d (job_drafts) by the M6 requester filter, appending
// its arguments.
func requesterSQL(f app.RequesterFilter, args *[]any) string {
	switch {
	case f.Kind == "" && f.None:
		return ` AND d.requester_kind IS NULL`
	case f.Kind == "":
		return ``
	}
	*args = append(*args, f.Kind)
	out := ` AND d.requester_kind=$` + strconv.Itoa(len(*args))
	switch {
	case f.None:
		out += ` AND d.requester_id IS NULL`
	case f.ID != uuid.Nil:
		*args = append(*args, f.ID)
		out += ` AND d.requester_id=$` + strconv.Itoa(len(*args))
	}
	return out
}

// scopeSQL selects the company's published vacancies (D6) with any activity in
// the period: a tramo overlapping it, a close, a commitment date, a hire, a
// reassignment or an application in it.
func scopeSQL(scope app.Scope, args *[]any) string {
	query := `SELECT d.id FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id AND vp.company_id=d.company_id
 LEFT JOIN job_draft_delivery_configs c ON c.draft_id=d.id
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=d.id
 WHERE d.company_id=$1` + requesterSQL(scope.Requester, args)
	if scope.Recruiter != nil {
		*args = append(*args, *scope.Recruiter)
		query += ` AND EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id=d.id AND a.user_id=$` + strconv.Itoa(len(*args)) +
			` AND a.started_at < $3 AND (a.ended_at IS NULL OR a.ended_at >= $2))`
	}
	return query + ` AND (
 EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id=d.id AND a.started_at < $3 AND (a.ended_at IS NULL OR a.ended_at >= $2))
 OR EXISTS (SELECT 1 FROM vacancy_lifecycle_events e WHERE e.process_id=d.id AND e.action='close' AND e.created_at >= $2 AND e.created_at < $3)
 OR COALESCE(f.commitment_date, c.commitment_date) BETWEEN $4::date AND $5::date
 OR EXISTS (SELECT 1 FROM placement_credits pc WHERE pc.process_id=d.id AND pc.company_id=$1 AND pc.hired_at >= $2 AND pc.hired_at < $3)
 OR EXISTS (SELECT 1 FROM vacancy_reassignments r WHERE r.draft_id=d.id AND r.performed_at >= $2 AND r.performed_at < $3)
 OR EXISTS (SELECT 1 FROM process_participations p WHERE p.process_id=d.id AND p.created_at >= $2 AND p.created_at < $3))`
}

// Load reads every fact of the vacancies in scope in one snapshot.
func (s *Store) Load(ctx context.Context, company uuid.UUID, scope app.Scope) (*app.Dataset, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	args := []any{company, scope.Period.Start, scope.Period.End, scope.Period.From, scope.Period.To}
	ids, err := collectIDs(ctx, tx, scopeSQL(scope, &args), args...)
	if err != nil {
		return nil, fmt.Errorf("metrics scope: %w", err)
	}
	data := &app.Dataset{Vacancies: []*app.Vacancy{}, People: map[uuid.UUID]app.Person{}}
	if len(ids) == 0 {
		return data, tx.Commit(ctx)
	}
	byID, configs, err := loadVacancies(ctx, tx, company, ids)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		data.Vacancies = append(data.Vacancies, byID[id])
	}
	people := map[uuid.UUID]bool{}
	steps := []func() error{
		func() error { return loadTramos(ctx, tx, company, ids, byID, people) },
		func() error { return loadFunctions(ctx, tx, ids, byID) },
		func() error { return loadCloses(ctx, tx, ids, byID) },
		func() error { return loadCredits(ctx, tx, company, ids, byID, people) },
		func() error { return loadReassignments(ctx, tx, company, ids, byID, people) },
		func() error { return loadOrigin(ctx, tx, ids, scope.Period, byID) },
		func() error {
			entries, err := s.loadEntries(ctx, tx, configs)
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

func collectIDs(ctx context.Context, q querier, query string, args ...any) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, query+` ORDER BY 1`, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// deliveryConfig is what the entry scan needs per configured vacancy.
type deliveryConfig struct {
	cutoff   uuid.UUID
	pipeline []byte
}

func loadVacancies(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]*app.Vacancy, map[uuid.UUID]deliveryConfig, error) {
	rows, err := q.Query(ctx, `SELECT d.id, COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''), vp.published_at,
 d.requester_kind, d.requester_id, rq.name, mc.hiring_headcount,
 c.cutoff_stage_id, c.target_quantity, c.commitment_date::text,
 f.process_id IS NOT NULL, f.cutoff_stage_id, f.target, f.commitment_date::text,
 (f.candidates->(f.target-1)->>'reached_at')::timestamptz,
 (SELECT cc.previous_date::text FROM vacancy_commitment_changes cc WHERE cc.draft_id=d.id AND cc.previous_date IS NOT NULL ORDER BY cc.performed_at, cc.id LIMIT 1),
 (SELECT count(*) FROM vacancy_commitment_changes cc WHERE cc.draft_id=d.id),
 pc.configuration,
 (SELECT a.user_id FROM vacancy_assignment_functions fn JOIN vacancy_assignments a ON a.id=fn.assignment_id
  WHERE fn.draft_id=d.id AND fn.ended_at IS NULL AND fn.function='responsible')
 FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id
 LEFT JOIN job_draft_requesters rq ON rq.id=d.requester_id AND rq.company_id=d.company_id
 LEFT JOIN job_draft_management_configs mc ON mc.draft_id=d.id
 LEFT JOIN job_draft_delivery_configs c ON c.draft_id=d.id
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=d.id
 LEFT JOIN job_draft_pipeline_configs pc ON pc.draft_id=d.id
 WHERE d.id=ANY($1) AND d.company_id=$2`, ids, company)
	if err != nil {
		return nil, nil, fmt.Errorf("metrics vacancies: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]*app.Vacancy{}
	configs := map[uuid.UUID]deliveryConfig{}
	for rows.Next() {
		v := &app.Vacancy{Origin: map[string]int{}}
		var kind, rqName, cfgCommit, frozenCommit *string
		var rqID, cfgCutoff, frozenCutoff *uuid.UUID
		var headcount, cfgTarget, frozenTarget *int32
		var fulfilled bool
		var reached *time.Time
		var renegotiations int64
		var pipeline []byte
		if err := rows.Scan(&v.ID, &v.Title, &v.PublishedAt, &kind, &rqID, &rqName, &headcount, &cfgCutoff, &cfgTarget, &cfgCommit,
			&fulfilled, &frozenCutoff, &frozenTarget, &frozenCommit, &reached, &v.Delivery.OriginalCommitment, &renegotiations, &pipeline, &v.Responsible); err != nil {
			return nil, nil, err
		}
		if kind != nil {
			v.Requester = &app.Requester{Kind: *kind, ID: rqID, Name: rqName}
		}
		v.Headcount = intPtr(headcount)
		d := &v.Delivery
		d.Renegotiations = int(renegotiations)
		cutoff := cfgCutoff
		if fulfilled {
			if reached == nil {
				return nil, nil, fmt.Errorf("metrics: fulfillment of %s without the target candidate", v.ID)
			}
			d.Configured, d.Commitment, d.Target, d.TargetReachedAt, cutoff = true, frozenCommit, intPtr(frozenTarget), reached, frozenCutoff
		} else {
			d.Configured = cfgCutoff != nil && cfgTarget != nil && cfgCommit != nil
			d.Commitment, d.Target = cfgCommit, intPtr(cfgTarget)
		}
		if d.OriginalCommitment == nil {
			d.OriginalCommitment = d.Commitment
		}
		if d.Configured && cutoff != nil {
			configs[v.ID] = deliveryConfig{cutoff: *cutoff, pipeline: pipeline}
		}
		out[v.ID] = v
	}
	return out, configs, rows.Err()
}

func intPtr(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func loadTramos(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.Vacancy, people map[uuid.UUID]bool) error {
	rows, err := q.Query(ctx, `SELECT id, draft_id, user_id, started_at, ended_at FROM vacancy_assignments
 WHERE draft_id=ANY($1) AND company_id=$2 ORDER BY started_at, id`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics tramos: %w", err)
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

func loadFunctions(ctx context.Context, q querier, ids []uuid.UUID, byID map[uuid.UUID]*app.Vacancy) error {
	rows, err := q.Query(ctx, `SELECT f.draft_id, f.assignment_id, a.user_id, f.function, f.started_at, f.ended_at
 FROM vacancy_assignment_functions f JOIN vacancy_assignments a ON a.id=f.assignment_id
 WHERE f.draft_id=ANY($1) ORDER BY f.started_at, f.id`, ids)
	if err != nil {
		return fmt.Errorf("metrics functions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var f app.Function
		var draft uuid.UUID
		if err := rows.Scan(&draft, &f.AssignmentID, &f.UserID, &f.Function, &f.Start, &f.End); err != nil {
			return err
		}
		byID[draft].Functions = append(byID[draft].Functions, f)
	}
	return rows.Err()
}

// loadCloses reads every close from the lifecycle history (never closed_at,
// which keeps only the latest), with the closing target in effect at that
// instant: the last change before it, else the value the first later change
// replaced, else the stored date.
func loadCloses(ctx context.Context, q querier, ids []uuid.UUID, byID map[uuid.UUID]*app.Vacancy) error {
	rows, err := q.Query(ctx, `SELECT e.process_id, e.created_at, e.reason,
 CASE WHEN EXISTS (SELECT 1 FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id AND t.performed_at <= e.created_at)
  THEN (SELECT t.new_date::text FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id AND t.performed_at <= e.created_at ORDER BY t.performed_at DESC, t.id DESC LIMIT 1)
  WHEN EXISTS (SELECT 1 FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id)
  THEN (SELECT t.previous_date::text FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id ORDER BY t.performed_at, t.id LIMIT 1)
  ELSE (SELECT mc.target_close_date::text FROM job_draft_management_configs mc WHERE mc.draft_id=e.process_id) END
 FROM vacancy_lifecycle_events e WHERE e.process_id=ANY($1) AND e.action='close' ORDER BY e.created_at, e.lifecycle_version`, ids)
	if err != nil {
		return fmt.Errorf("metrics closes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var c app.Close
		var draft uuid.UUID
		if err := rows.Scan(&draft, &c.At, &c.Reason, &c.Target); err != nil {
			return err
		}
		byID[draft].Closes = append(byID[draft].Closes, c)
	}
	return rows.Err()
}

func loadCredits(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.Vacancy, people map[uuid.UUID]bool) error {
	rows, err := q.Query(ctx, `SELECT pc.process_id, pc.id, pc.hired_at, pc.status,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',r.user_id,'kind',r.kind) ORDER BY r.user_id) FROM placement_credit_recipients r WHERE r.credit_id=pc.id),'[]'::jsonb)
 FROM placement_credits pc WHERE pc.process_id=ANY($1) AND pc.company_id=$2 AND pc.status IN ('active','did_not_hold')
 ORDER BY pc.hired_at, pc.id`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics credits: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var c app.Credit
		var draft uuid.UUID
		var raw []byte
		if err := rows.Scan(&draft, &c.ID, &c.HiredAt, &c.Status, &raw); err != nil {
			return err
		}
		var recipients []struct {
			UserID uuid.UUID `json:"user_id"`
			Kind   string    `json:"kind"`
		}
		if err := json.Unmarshal(raw, &recipients); err != nil {
			return err
		}
		for _, r := range recipients {
			c.Recipients = append(c.Recipients, app.Recipient{UserID: r.UserID, Kind: r.Kind})
			people[r.UserID] = true
		}
		byID[draft].Credits = append(byID[draft].Credits, c)
	}
	return rows.Err()
}

func loadReassignments(ctx context.Context, q querier, company uuid.UUID, ids []uuid.UUID, byID map[uuid.UUID]*app.Vacancy, people map[uuid.UUID]bool) error {
	rows, err := q.Query(ctx, `SELECT r.draft_id, r.id, r.performed_at, r.reason, r.note, fa.user_id, ta.user_id, r.performed_by, fa.started_at, r.state_snapshot
 FROM vacancy_reassignments r JOIN vacancy_assignments fa ON fa.id=r.from_assignment_id JOIN vacancy_assignments ta ON ta.id=r.to_assignment_id
 WHERE r.draft_id=ANY($1) AND r.company_id=$2 ORDER BY r.performed_at, r.id`, ids, company)
	if err != nil {
		return fmt.Errorf("metrics reassignments: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var r app.Reassignment
		var draft uuid.UUID
		if err := rows.Scan(&draft, &r.ID, &r.At, &r.Reason, &r.Note, &r.From, &r.To, &r.By, &r.FromStarted, &r.Snapshot); err != nil {
			return err
		}
		byID[draft].Reassigns = append(byID[draft].Reassigns, r)
		people[r.From], people[r.To], people[r.By] = true, true, true
	}
	return rows.Err()
}

func loadOrigin(ctx context.Context, q querier, ids []uuid.UUID, p app.Period, byID map[uuid.UUID]*app.Vacancy) error {
	rows, err := q.Query(ctx, `SELECT process_id, origin_channel, count(*) FROM process_participations
 WHERE process_id=ANY($1) AND created_at >= $2 AND created_at < $3 GROUP BY 1, 2`, ids, p.Start, p.End)
	if err != nil {
		return fmt.Errorf("metrics origin: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var draft uuid.UUID
		var channel string
		var n int64
		if err := rows.Scan(&draft, &channel, &n); err != nil {
			return err
		}
		byID[draft].Origin[channel] = int(n)
	}
	return rows.Err()
}

// loadEntries reads the history rows that entered each configured vacancy's
// cutoff stage (intake, move, recovery), plus manual intakes at or beyond it,
// oldest first: delivery fulfillment's cutoff-entry semantics.
func (s *Store) loadEntries(ctx context.Context, q querier, configs map[uuid.UUID]deliveryConfig) (map[uuid.UUID][]app.Entry, error) {
	out := map[uuid.UUID][]app.Entry{}
	if len(configs) == 0 {
		return out, nil
	}
	var drafts, cutoffs []uuid.UUID
	beyond := map[uuid.UUID][]uuid.UUID{}
	for draft, c := range configs {
		drafts = append(drafts, draft)
		cutoffs = append(cutoffs, c.cutoff)
		stages, err := s.stages(draft, c.pipeline, c.cutoff)
		if err != nil {
			return nil, err
		}
		beyond[draft] = stages
	}
	rows, err := q.Query(ctx, `SELECT p.process_id, p.id, h.created_at, h.actor_id, h.actor_kind='recruiter', h.stage_id, h.event_kind='intake' AND p.source='manual'
 FROM unnest($1::uuid[], $2::uuid[]) k(draft_id, cutoff)
 JOIN process_participations p ON p.process_id=k.draft_id
 JOIN participation_stage_history h ON h.participation_id=p.id
 WHERE h.event_kind IN ('intake','move','recovery') AND (h.stage_id=k.cutoff OR (p.source='manual' AND h.event_kind='intake'))
 ORDER BY h.created_at, p.id, h.id`, drafts, cutoffs)
	if err != nil {
		return nil, fmt.Errorf("metrics entries: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var draft, stage uuid.UUID
		var e app.Entry
		var manualIntake bool
		if err := rows.Scan(&draft, &e.ParticipationID, &e.At, &e.ActorID, &e.ByRecruiter, &stage, &manualIntake); err != nil {
			return nil, err
		}
		if stage != configs[draft].cutoff && !(manualIntake && slices.Contains(beyond[draft], stage)) {
			continue
		}
		out[draft] = append(out[draft], e)
	}
	return out, rows.Err()
}

// loadPeople names users with the audit screen's member rule: the account name
// unless the account is deleted, former_member when no longer a member here.
func loadPeople(ctx context.Context, q querier, company uuid.UUID, set map[uuid.UUID]bool) (map[uuid.UUID]app.Person, error) {
	out := map[uuid.UUID]app.Person{}
	if len(set) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	rows, err := q.Query(ctx, `SELECT x.id, CASE WHEN u.id IS NOT NULL AND u.deleted_at IS NULL THEN u.full_name END,
 NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id=x.id AND m.company_id=$2)
 FROM unnest($1::uuid[]) x(id) LEFT JOIN users u ON u.id=x.id`, ids, company)
	if err != nil {
		return nil, fmt.Errorf("metrics people: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p app.Person
		if err := rows.Scan(&p.UserID, &p.Name, &p.FormerMember); err != nil {
			return nil, err
		}
		out[p.UserID] = p
	}
	return out, rows.Err()
}

// HadTramo answers whether the user ever had a tramo in this company (§3.3).
func (s *Store) HadTramo(ctx context.Context, company, user uuid.UUID) (bool, error) {
	var had bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM vacancy_assignments a JOIN job_drafts d ON d.id=a.draft_id AND d.company_id=$1
 WHERE a.company_id=$1 AND a.user_id=$2)`, company, user).Scan(&had)
	return had, err
}

// People names the given users.
func (s *Store) People(ctx context.Context, company uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]app.Person, error) {
	set := map[uuid.UUID]bool{}
	for _, id := range ids {
		set[id] = true
	}
	return loadPeople(ctx, s.pool, company, set)
}
