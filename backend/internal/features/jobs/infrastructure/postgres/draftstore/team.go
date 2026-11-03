package draftstore

import (
	"context"
	"encoding/json"
	"fmt"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancyteam"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ vacancyteam.Store = (*Store)(nil)

// draftAccessError is called only after denial on a company-scoped draft.
// Never expose prior membership for foreign or nonexistent drafts.
func draftAccessError(ctx context.Context, tx pgx.Tx, actor uuid.UUID, record draftRecord, found bool) error {
	if !found {
		return drafts.ErrNotFound
	}
	var ended bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vacancy_assignments WHERE draft_id=$1 AND user_id=$2 AND ended_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM vacancy_assignments WHERE draft_id=$1 AND user_id=$2 AND ended_at IS NULL)`, record.id, actor).Scan(&ended); err != nil {
		return fmt.Errorf("check ended team access: %w", err)
	}
	if ended {
		return drafts.ErrTeamAccessEnded
	}
	return drafts.ErrNotFound
}

// createTeam is the single transactional initializer for both draft schemas.
func (s *Store) createTeam(ctx context.Context, tx pgx.Tx, record draftRecord, actor uuid.UUID) error {
	assignment := uuid.Must(uuid.NewV7())
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) VALUES($1,$2,'with_responsible',$3)`, record.id, record.companyID, record.createdAt); err != nil {
		return fmt.Errorf("create vacancy team: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,started_by,start_cause) VALUES($1,$2,$3,$4,$5,$4,'creation')`, assignment, record.id, record.companyID, actor, record.createdAt); err != nil {
		return fmt.Errorf("create responsible assignment: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) VALUES($1,$2,$3,'responsible',$4,'creation')`, uuid.Must(uuid.NewV7()), assignment, record.id, record.createdAt); err != nil {
		return fmt.Errorf("create responsible function: %w", err)
	}
	event := audit.AuditEvent{ID: uuid.Must(uuid.NewV7()), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "VacancyTeamCreated", EntityType: "vacancy", EntityID: record.id, Metadata: map[string]string{"company_id": record.companyID.String(), "mode": "with_responsible", "responsible_user_id": actor.String(), "assignment_id": assignment.String()}}
	if err := s.audit.Append(ctx, tx, event); err != nil {
		return fmt.Errorf("co-write vacancy team create audit: %w", err)
	}
	return nil
}

func (s *Store) GetTeam(ctx context.Context, company, actor, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	auth, err := s.lockGates(ctx, tx, company, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	record, found, err := readDraft(ctx, tx, company, id, false, actor)
	if err != nil {
		return drafts.Result{}, err
	}
	if !found || !authorized(auth, actor, record) {
		return drafts.Result{}, draftAccessError(ctx, tx, actor, record, found)
	}
	if err := requireV2ReadDocument(record.fields); err != nil {
		return drafts.Result{}, err
	}
	var mode string
	var version int64
	if err := tx.QueryRow(ctx, `SELECT mode,version FROM vacancy_teams WHERE draft_id=$1`, id).Scan(&mode, &version); err != nil {
		return drafts.Result{}, err
	}
	rows, err := tx.Query(ctx, `SELECT a.user_id,f.function,jsonb_build_object(
 'assignment_id',a.id,'user',jsonb_build_object('id',u.id,'name',u.full_name),'function',f.function,'started_at',a.started_at,
 'recruiter_deadline',a.recruiter_deadline,'effective_deadline',COALESCE(a.recruiter_deadline,d.commitment_date),
 'deadline_source',CASE WHEN a.recruiter_deadline IS NOT NULL THEN 'recruiter' WHEN d.commitment_date IS NOT NULL THEN 'commitment' ELSE 'none' END)
 FROM vacancy_assignments a JOIN vacancy_assignment_functions f ON f.assignment_id=a.id AND f.ended_at IS NULL
 JOIN users u ON u.id=a.user_id LEFT JOIN job_draft_delivery_configs d ON d.draft_id=a.draft_id
 WHERE a.draft_id=$1 AND a.ended_at IS NULL ORDER BY a.started_at,a.id`, id)
	if err != nil {
		return drafts.Result{}, err
	}
	members := []json.RawMessage{}
	var function *string
	for rows.Next() {
		var user uuid.UUID
		var fn string
		var raw json.RawMessage
		if err := rows.Scan(&user, &fn, &raw); err != nil {
			rows.Close()
			return drafts.Result{}, err
		}
		members = append(members, raw)
		if user == actor {
			v := fn
			function = &v
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return drafts.Result{}, err
	}
	fn := ""
	if function != nil {
		fn = *function
	}
	body, err := json.Marshal(struct {
		Mode    string            `json:"mode"`
		Members []json.RawMessage `json:"members"`
		Viewer  struct {
			Function *string                 `json:"function"`
			IsOwner  bool                    `json:"is_owner"`
			Can      vacancyteam.Permissions `json:"can"`
		} `json:"viewer"`
	}{Mode: mode, Members: members, Viewer: struct {
		Function *string                 `json:"function"`
		IsOwner  bool                    `json:"is_owner"`
		Can      vacancyteam.Permissions `json:"can"`
	}{function, auth.role == roleOwner, vacancyteam.Can(mode, fn, auth.role == roleOwner, len(members))}})
	if err != nil {
		return drafts.Result{}, err
	}
	return drafts.Result{Body: body, ETag: vacancyteam.ETag(id, version)}, nil
}

// The timeline derives a tramo's position from its latest event, not arrival.
// Function history stays inside that continuous stay, in chronological order.
const teamTimelineSQL = `WITH timeline AS (
 SELECT a.id,'tramo'::text AS kind,COALESCE(a.ended_at,(SELECT max(f.started_at) FROM vacancy_assignment_functions f WHERE f.assignment_id=a.id),a.started_at) AS at,
 jsonb_build_object('assignment_id',a.id,'user',jsonb_build_object('id',u.id,'name',u.full_name),
 'started_at',a.started_at,'started_by',CASE WHEN sb.id IS NULL THEN NULL ELSE jsonb_build_object('id',sb.id,'name',sb.full_name) END,'start_cause',a.start_cause,
 'ended_at',a.ended_at,'ended_by',CASE WHEN eb.id IS NULL THEN NULL ELSE jsonb_build_object('id',eb.id,'name',eb.full_name) END,'end_cause',a.end_cause,
 'recruiter_deadline',a.recruiter_deadline,'closing_deadline',a.closing_deadline,
 'functions',COALESCE((SELECT jsonb_agg(jsonb_build_object('function',f.function,'started_at',f.started_at,'ended_at',f.ended_at,'start_cause',f.start_cause,'end_cause',f.end_cause) ORDER BY f.started_at,f.id) FROM vacancy_assignment_functions f WHERE f.assignment_id=a.id),'[]'::jsonb)) AS data
 FROM vacancy_assignments a JOIN users u ON u.id=a.user_id LEFT JOIN users sb ON sb.id=a.started_by LEFT JOIN users eb ON eb.id=a.ended_by WHERE a.draft_id=$1
 UNION ALL
 SELECT r.id,'reassignment',r.performed_at,jsonb_build_object('id',r.id,'from_user',jsonb_build_object('id',fu.id,'name',fu.full_name),
 'to_user',jsonb_build_object('id',tu.id,'name',tu.full_name),'reason',r.reason,'note',r.note,'previous_responsible',r.previous_responsible,
 'performed_by',jsonb_build_object('id',p.id,'name',p.full_name),'state_snapshot',r.state_snapshot)
 FROM vacancy_reassignments r JOIN vacancy_assignments fa ON fa.id=r.from_assignment_id JOIN users fu ON fu.id=fa.user_id
 JOIN vacancy_assignments ta ON ta.id=r.to_assignment_id JOIN users tu ON tu.id=ta.user_id JOIN users p ON p.id=r.performed_by WHERE r.draft_id=$1
 UNION ALL
 SELECT m.id,'mode_change',m.performed_at,jsonb_build_object('id',m.id,'from_mode',m.from_mode,'to_mode',m.to_mode,
 'responsible_user',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id',u.id,'name',u.full_name) END,'performed_by',jsonb_build_object('id',p.id,'name',p.full_name))
 FROM vacancy_team_mode_changes m LEFT JOIN users u ON u.id=m.responsible_user_id JOIN users p ON p.id=m.performed_by WHERE m.draft_id=$1
 ) SELECT id,kind,at,jsonb_build_object('kind',kind,'at',at,kind,data) FROM timeline`

func (s *Store) GetTeamHistory(ctx context.Context, company, actor, id uuid.UUID, token string) (drafts.Result, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return drafts.Result{}, err
	}
	defer tx.Rollback(ctx)
	if err := s.authorizePipeline(ctx, tx, company, actor, id, false); err != nil {
		return drafts.Result{}, err
	}
	scope := vacancyteam.Scope{CompanyID: company, ActorID: actor, DraftID: id}
	query := teamTimelineSQL
	args := []any{id}
	if token != "" {
		c, err := vacancyteam.DecodeCursor(token, scope)
		if err != nil {
			return drafts.Result{}, err
		}
		query += ` WHERE at < $2 OR (at=$2 AND (kind,id)>($3::text,$4::uuid))`
		args = append(args, c.At, c.Kind, c.ID)
	}
	query += ` ORDER BY at DESC,kind ASC,id ASC LIMIT 21`
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("read team timeline: %w", err)
	}
	items := []json.RawMessage{}
	positions := []vacancyteam.Cursor{}
	for rows.Next() {
		c := vacancyteam.Cursor{Scope: scope}
		var raw json.RawMessage
		if err := rows.Scan(&c.ID, &c.Kind, &c.At, &raw); err != nil {
			rows.Close()
			return drafts.Result{}, err
		}
		items = append(items, raw)
		positions = append(positions, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return drafts.Result{}, err
	}
	var next *string
	if len(items) > 20 {
		items = items[:20]
		value, err := vacancyteam.EncodeCursor(positions[19])
		if err != nil {
			return drafts.Result{}, err
		}
		next = &value
	}
	body, err := json.Marshal(struct {
		Items      []json.RawMessage `json:"items"`
		NextCursor *string           `json:"next_cursor"`
	}{items, next})
	if err != nil {
		return drafts.Result{}, err
	}
	return drafts.Result{Body: body}, nil
}
