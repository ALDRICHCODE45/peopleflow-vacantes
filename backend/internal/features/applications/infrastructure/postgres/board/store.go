package board

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditport "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Storage interface {
	Open(context.Context, string) (io.ReadCloser, error)
}
type Store struct {
	pool    *pgxpool.Pool
	audit   auditport.AuditEventRepository
	vacancy app.VacancyContext
	storage Storage
	decode  app.JSONDecoder
}

func NewStore(pool *pgxpool.Pool, audit auditport.AuditEventRepository, vacancy app.VacancyContext, storage Storage, decode app.JSONDecoder) *Store {
	return &Store{pool, audit, vacancy, storage, decode}
}

var _ app.Store = (*Store)(nil)

func (s *Store) begin(ctx context.Context, company, actor, id uuid.UUID) (pgx.Tx, app.Pipeline, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, app.Pipeline{}, err
	}
	p, err := s.vacancy.Load(ctx, tx, company, actor, id)
	if err == nil {
		var process uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id FROM vacancy_processes WHERE id=$1 AND company_id=$2 FOR UPDATE`, id, company).Scan(&process)
		if errors.Is(err, pgx.ErrNoRows) {
			err = app.ErrNotPublished
		}
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, app.Pipeline{}, err
	}
	return tx, p, nil
}

// beginMutation reads process state only after Load acquired the draft lock
// and begin acquired the process lock. L1 finish/reopen cannot race this read.
func (s *Store) beginMutation(ctx context.Context, company, actor, id uuid.UUID) (pgx.Tx, app.Pipeline, error) {
	tx, p, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return nil, p, err
	}
	var state string
	err = tx.QueryRow(ctx, `SELECT process_status FROM vacancy_processes WHERE id=$1`, id).Scan(&state)
	if err == nil && state == "finished" {
		var view json.RawMessage
		view, err = s.vacancy.Lifecycle(ctx, tx, id)
		if err == nil {
			err = &app.ProcessFinished{Lifecycle: view}
		}
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, app.Pipeline{}, err
	}
	return tx, p, nil
}

const itemSQL = `SELECT p.id,p.stage_id,p.version,COALESCE(cc.id,u.id),COALESCE(cc.full_name,u.full_name),p.created_at,p.source,COALESCE(mc.id,l.id),COALESCE(mc.file_name,l.name),
 COALESCE((SELECT max(h.created_at) FROM participation_stage_history h WHERE h.participation_id=p.id AND h.event_kind<>'not_applicable'),p.created_at),
 p.previous_stage_id,p.reason_group,p.reason_code,p.discarded_at,p.substate_id,
 CASE WHEN snap.profile->'location' IS NULL OR snap.profile->'location' = 'null'::jsonb THEN snap.profile
 ELSE jsonb_set(snap.profile,'{location}',jsonb_build_object(
 'country',jsonb_build_object('id',snap.profile->'location'->>'country','name',gc.name_es),
 'state',CASE WHEN snap.profile->'location'->>'state' IS NULL THEN NULL ELSE jsonb_build_object('id',snap.profile->'location'->>'state','name',gs.name) END,
 'municipality',CASE WHEN snap.profile->'location'->>'municipality' IS NULL THEN NULL ELSE jsonb_build_object('id',snap.profile->'location'->>'municipality','name',gm.name) END,
 'postal_code',cc.postal_code,'label',CASE WHEN gm.code IS NOT NULL THEN gm.name || ', ' || gs.name WHEN gs.code IS NOT NULL THEN gs.name ELSE gc.name_es END)) END,
 p.questions_snapshot,p.answers_snapshot,
 CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END, ad.id,ad.full_name
 FROM process_participations p
 JOIN vacancy_processes vp ON vp.id=p.process_id
 LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN candidate_cv_library l ON l.version_id=p.cv_version_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=vp.company_id
 LEFT JOIN company_candidate_cvs mc ON mc.id=p.company_candidate_cv_id AND mc.company_id=vp.company_id
 LEFT JOIN users ad ON ad.id=p.added_by AND p.source='manual'
 CROSS JOIN LATERAL (SELECT CASE WHEN p.company_candidate_id IS NULL THEN p.profile_snapshot ELSE jsonb_build_object(
 'location',jsonb_build_object('country',cc.country_code,'state',cc.state_code,'municipality',cc.municipality_code),
 'skills',cc.skills,'years_of_experience',trunc(cc.years_of_experience)::integer,'education_level',(SELECT level FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id AND e.status='completed' AND e.level IN ('high_school','bachelor','master','phd') ORDER BY CASE e.level WHEN 'phd' THEN 4 WHEN 'master' THEN 3 WHEN 'bachelor' THEN 2 ELSE 1 END DESC,e.position,e.id LIMIT 1)) END AS profile) snap
 LEFT JOIN geo_countries gc ON gc.code=snap.profile->'location'->>'country'
 LEFT JOIN geo_states gs ON gs.country_code=gc.code AND gs.code=snap.profile->'location'->>'state'
 LEFT JOIN geo_municipalities gm ON gm.country_code=gc.code AND gm.state_code=gs.code AND gm.code=snap.profile->'location'->>'municipality' `

func readItem(row pgx.Row) (app.Item, int64, error) {
	var i app.Item
	var version int64
	var previous, group, code *string
	var discardedAt *time.Time
	var profile, questions, answers []byte
	var addedID *uuid.UUID
	var addedName *string
	err := row.Scan(&i.ID, &i.StageID, &version, &i.Candidate.ID, &i.Candidate.FullName, &i.AppliedAt, &i.Source, &i.CV.ID, &i.CV.Name, &i.MovedAt, &previous, &group, &code, &discardedAt, &i.SubstateID, &profile, &questions, &answers, &i.Candidate.Kind, &addedID, &addedName)
	if errors.Is(err, pgx.ErrNoRows) {
		return i, 0, app.ErrNotFound
	}
	if err != nil {
		return i, 0, err
	}
	i.Profile = app.Profile{Skills: []string{}}
	if profile != nil {
		if err := json.Unmarshal(profile, &i.Profile); err != nil {
			return i, 0, err
		}
	}
	// A missing catalog row must not silently erase a frozen subdivision or
	// return an empty display name. Match the shared geo expansion's fail-closed rule.
	if location := i.Profile.Location; location != nil {
		if location.Country.Name == "" || (location.State != nil && location.State.Name == "") || (location.Municipality != nil && location.Municipality.Name == "") {
			return i, 0, errors.New("profile location catalog reference not found")
		}
	}
	var qs []intake.Question
	var as []intake.Answer
	if err := json.Unmarshal(questions, &qs); err != nil {
		return i, 0, err
	}
	if err := json.Unmarshal(answers, &as); err != nil {
		return i, 0, err
	}
	i.ScreeningAnswers = app.ChoiceAnswers(qs, as)
	if i.Source == "manual" {
		if addedID == nil || addedName == nil {
			return i, 0, errors.New("manual participation missing actor")
		}
		i.AddedBy = &app.AddedBy{ID: *addedID, Name: *addedName}
	}
	if version < 1 || (i.Source != "organic" && i.Source != "manual") {
		return i, 0, errors.New("invalid stored participation")
	}
	if discardedAt != nil {
		if previous == nil || group == nil || code == nil || !app.ValidReason(app.Reason{Group: *group, Key: *code}) {
			return i, 0, errors.New("invalid stored discard")
		}
		i.Discard = &app.Discard{Reason: app.Reason{Group: *group, Key: *code}, PreviousStageID: *previous, DiscardedAt: discardedAt.UTC()}
		i.MovedAt = i.Discard.DiscardedAt
	}
	i.Version = strconv.FormatInt(version, 10)
	i.ETag = app.ETag(i.ID, version)
	i.AppliedAt = i.AppliedAt.UTC()
	i.MovedAt = i.MovedAt.UTC()
	return i, version, nil
}
func placement(p app.Pipeline) string {
	for _, stage := range p.Stages {
		if stage.Kind == "placement" {
			return stage.ID
		}
	}
	return ""
}
func coverage(ctx context.Context, tx pgx.Tx, id uuid.UUID, p app.Pipeline) (app.Coverage, error) {
	c := app.Coverage{Required: p.Required}
	var err error
	c.Covered, c.FullCoverageReachedAt, err = db.ReadPlacementCoverage(ctx, tx, id, placement(p))
	return c, err
}
func (s *Store) Board(ctx context.Context, company, actor, id uuid.UUID) (app.Board, error) {
	tx, p, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.Board{}, err
	}
	defer tx.Rollback(ctx)
	out := app.Board{RetiredStages: append([]app.RetiredStage{}, p.Retired...), Stages: p.Stages, Exit: p.Exit, Participations: []app.Item{}}
	out.Lifecycle, err = s.vacancy.Lifecycle(ctx, tx, id)
	if err != nil {
		return out, err
	}
	var fields []byte
	if err = tx.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&fields); err != nil {
		return out, err
	}
	form, err := s.vacancy.Screening(fields)
	if err != nil {
		return out, err
	}
	out.ScreeningFilters = app.ChoiceFilters(form)
	out.Substates, err = readSubstates(ctx, tx, id)
	if err != nil {
		return out, err
	}
	rows, err := tx.Query(ctx, itemSQL+`WHERE p.process_id=$1 ORDER BY p.id LIMIT 1001`, id)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		item, _, err := readItem(rows)
		if err != nil {
			return out, err
		}
		if err := setRecoveryStage(&item, p); err != nil {
			return out, err
		}
		out.Participations = append(out.Participations, item)
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	if len(out.Participations) > 1000 {
		return app.Board{}, app.ErrTooLarge
	}
	order := map[string]int{}
	for i, stage := range out.Stages {
		order[stage.ID] = i
	}
	order[out.Exit.ID] = len(out.Stages)
	for _, item := range out.Participations {
		index, ok := order[item.StageID]
		if !ok {
			return out, errors.New("unknown stored participation stage")
		}
		if index == len(out.Stages) {
			out.Exit.Count++
		} else {
			out.Stages[index].Count++
		}
	}
	sort.Slice(out.Participations, func(i, j int) bool {
		a, b := out.Participations[i], out.Participations[j]
		if order[a.StageID] != order[b.StageID] {
			return order[a.StageID] < order[b.StageID]
		}
		if !a.MovedAt.Equal(b.MovedAt) {
			return a.MovedAt.After(b.MovedAt)
		}
		return a.ID.String() < b.ID.String()
	})
	out.Coverage, err = coverage(ctx, tx, id, p)
	if err != nil {
		return out, err
	}
	out.Delivery, err = s.delivery(ctx, tx, id)
	return out, err
}
func (s *Store) Move(ctx context.Context, company, actor, id, pid uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	tx, p, err := s.beginMutation(ctx, company, actor, id)
	if err != nil {
		return app.Moved{}, err
	}
	defer tx.Rollback(ctx)
	// Process then participation: fixed lock order also serializes different hires.
	item, version, err := readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2 FOR UPDATE OF p`, id, pid))
	if err != nil {
		return app.Moved{}, err
	}
	if err = app.CheckIfMatch(item.ETag, tag, present); err != nil {
		return app.Moved{}, err
	}
	request, err := app.DecodeMove(body, s.decode)
	if err != nil {
		return app.Moved{}, err
	}
	// The exit is not a progression stage; only discard/recovery may cross it.
	if item.StageID == p.Exit.ID || request.ToStageID == p.Exit.ID {
		return app.Moved{}, app.ErrValidation
	}
	hire, departure, err := app.ValidateMove(p.Stages, item.StageID, request)
	if err != nil {
		return app.Moved{}, err
	}
	if version == math.MaxInt64 {
		return app.Moved{}, app.ErrVersionOverflow
	}
	previous, err := coverage(ctx, tx, id, p)
	if err != nil {
		return app.Moved{}, err
	}
	at := nextEventAt(item.MovedAt)
	if err = s.clearSubstate(ctx, tx, actor, id, &item, at, version+1); err != nil {
		return app.Moved{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE process_participations SET stage_id=$3,substate_id=NULL,version=version+1 WHERE process_id=$1 AND id=$2`, id, pid, request.ToStageID); err != nil {
		return app.Moved{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recruiter','move')`, uuid.New(), pid, request.ToStageID, actor, at, item.StageID, hire, departure); err != nil {
		return app.Moved{}, err
	}
	next, err := coverage(ctx, tx, id, p)
	if err != nil {
		return app.Moved{}, err
	}
	// DEL-9: every below-to-full crossing is kept; first reach remains the view.
	if app.RecordCoverageMilestone(hire, previous.Covered, next.Covered, p.Required, previous.FullCoverageReachedAt != nil) {
		if _, err = tx.Exec(ctx, `INSERT INTO process_coverage_milestones(id,process_id,reached_at,covered,required) VALUES($1,$2,$3,$4,$5)`, uuid.New(), id, at, next.Covered, *p.Required); err != nil {
			return app.Moved{}, err
		}
		if next.FullCoverageReachedAt == nil {
			next.FullCoverageReachedAt = &at
		}
	}
	event := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &actor, EventType: "ParticipationMoved", EntityType: "process_participation", EntityID: pid, Metadata: map[string]string{"vacancy_id": id.String(), "from_stage_id": item.StageID, "to_stage_id": request.ToStageID, "version": strconv.FormatInt(version+1, 10), "hire": strconv.FormatBool(hire), "departure": strconv.FormatBool(departure)}}
	if err = s.audit.Append(ctx, tx, event); err != nil {
		return app.Moved{}, err
	}
	item.StageID = request.ToStageID
	item.Version = strconv.FormatInt(version+1, 10)
	item.ETag = app.ETag(pid, version+1)
	item.MovedAt = at
	if err = s.vacancy.RecordDelivery(ctx, tx, id, actor, uuid.MustParse(item.StageID), at); err != nil {
		return app.Moved{}, err
	}
	delivery, err := s.delivery(ctx, tx, id)
	if err != nil {
		return app.Moved{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return app.Moved{}, err
	}
	return app.Moved{Item: item, Coverage: next, Delivery: delivery}, nil
}
func (s *Store) History(ctx context.Context, company, actor, id, pid uuid.UUID) (app.History, error) {
	tx, _, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.History{}, err
	}
	defer tx.Rollback(ctx)
	if _, _, err = readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2`, id, pid)); err != nil {
		return app.History{}, err
	}
	rows, err := tx.Query(ctx, `SELECT h.from_stage_id,h.stage_id,h.hire,h.departure,h.actor_kind,u.id,u.full_name,h.created_at,h.event_kind,h.reason_group,h.reason_code,h.comment,h.candidate_message,h.from_substate_id,h.from_substate_name,h.to_substate_id,h.to_substate_name FROM participation_stage_history h JOIN users u ON u.id=h.actor_id WHERE h.participation_id=$1 ORDER BY h.created_at,h.id`, pid)
	if err != nil {
		return app.History{}, err
	}
	defer rows.Close()
	out := app.History{Items: []app.Entry{}}
	for rows.Next() {
		var e app.Entry
		var group, code *string
		if err = rows.Scan(&e.FromStageID, &e.ToStageID, &e.Hire, &e.Departure, &e.Actor.Kind, &e.Actor.ID, &e.Actor.FullName, &e.At, &e.Kind, &group, &code, &e.Comment, &e.CandidateMessage, &e.FromSubstateID, &e.FromSubstateName, &e.ToSubstateID, &e.ToSubstateName); err != nil {
			return out, err
		}
		if group != nil && code != nil {
			e.Reason = &app.Reason{Group: *group, Key: *code}
		}
		e.At = e.At.UTC()
		out.Items = append(out.Items, e)
	}
	return out, rows.Err()
}
func (s *Store) Detail(ctx context.Context, company, actor, id, pid uuid.UUID) (app.Detail, error) {
	tx, p, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.Detail{}, err
	}
	defer tx.Rollback(ctx)
	item, _, err := readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2`, id, pid))
	if err != nil {
		return app.Detail{}, err
	}
	if err := setRecoveryStage(&item, p); err != nil {
		return app.Detail{}, err
	}
	var questions, answers []byte
	var comment, candidateMessage *string
	var contact app.Contact
	// Company records are read only through this process's company.
	if err = tx.QueryRow(ctx, `SELECT p.questions_snapshot,p.answers_snapshot,p.comment,p.candidate_message,
 CASE WHEN p.company_candidate_id IS NOT NULL THEN cc.email ELSE u.email END,
 CASE WHEN p.company_candidate_id IS NOT NULL THEN cc.phone ELSE NULLIF(btrim(cp.phone),'') END
 FROM process_participations p
 JOIN vacancy_processes vp ON vp.id=p.process_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=vp.company_id
 LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN candidate_profiles cp ON cp.user_id=p.candidate_id
 WHERE p.process_id=$1 AND p.id=$2`, id, pid).Scan(&questions, &answers, &comment, &candidateMessage, &contact.Email, &contact.Phone); err != nil {
		return app.Detail{}, err
	}
	var qs []intake.Question
	var as []intake.Answer
	if err = json.Unmarshal(questions, &qs); err != nil {
		return app.Detail{}, err
	}
	if err = json.Unmarshal(answers, &as); err != nil {
		return app.Detail{}, err
	}
	out := app.Detail{Item: item, Screening: []app.Screening{}, Contact: contact}
	if item.Discard != nil {
		out.Comment, out.CandidateMessage = comment, candidateMessage
	}
	byID := map[string]intake.Answer{}
	for _, a := range as {
		byID[a.QuestionID] = a
	}
	for _, q := range qs {
		a, ok := byID[q.ID]
		if !ok {
			return out, errors.New("missing stored screening answer")
		}
		view := app.Screening{QuestionID: q.ID, Prompt: q.Prompt, Type: q.Type}
		switch q.Type {
		case "open":
			text := a.Text
			view.Answer.Text = &text
		case "single_choice":
			found := false
			for _, o := range q.Options {
				if o.ID == a.OptionID {
					view.Answer.OptionID = o.ID
					view.Answer.Label = o.Label
					found = true
					break
				}
			}
			if !found {
				return out, errors.New("missing stored screening option")
			}
		default:
			return out, errors.New("unknown stored question type")
		}
		out.Screening = append(out.Screening, view)
	}
	return out, nil
}
func (s *Store) File(ctx context.Context, company, actor, id, pid uuid.UUID) (app.File, error) {
	tx, _, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.File{}, err
	}
	defer tx.Rollback(ctx)
	var file app.File
	var key string
	err = tx.QueryRow(ctx, `SELECT COALESCE(mc.file_name,l.name),COALESCE(mc.content_type,v.content_type),COALESCE(mc.size,v.size),COALESCE(mc.storage_key,v.storage_key) FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id LEFT JOIN candidate_cv_versions v ON v.id=p.cv_version_id LEFT JOIN candidate_cv_library l ON l.version_id=v.id LEFT JOIN company_candidate_cvs mc ON mc.id=p.company_candidate_cv_id AND mc.company_id=vp.company_id WHERE p.process_id=$1 AND p.id=$2`, id, pid).Scan(&file.Name, &file.ContentType, &file.Size, &key)
	if errors.Is(err, pgx.ErrNoRows) {
		return file, app.ErrNotFound
	}
	if err != nil {
		return file, err
	}
	if s.storage == nil {
		return file, app.ErrStorageUnavailable
	}
	file.Reader, err = s.storage.Open(ctx, key)
	return file, err
}
