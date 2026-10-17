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
		err = tx.QueryRow(ctx, `SELECT id FROM vacancy_processes WHERE id=$1 AND company_id=$2 AND status='published' FOR UPDATE`, id, company).Scan(&process)
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

const itemSQL = `SELECT p.id,p.stage_id,p.version,u.id,u.full_name,p.created_at,p.source,l.id,l.name,
 COALESCE((SELECT max(h.created_at) FROM participation_stage_history h WHERE h.participation_id=p.id),p.created_at)
 FROM process_participations p JOIN users u ON u.id=p.candidate_id JOIN candidate_cv_library l ON l.version_id=p.cv_version_id `

func readItem(row pgx.Row) (app.Item, int64, error) {
	var i app.Item
	var version int64
	err := row.Scan(&i.ID, &i.StageID, &version, &i.Candidate.ID, &i.Candidate.FullName, &i.AppliedAt, &i.Source, &i.CV.ID, &i.CV.Name, &i.MovedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return i, 0, app.ErrNotFound
	}
	if err != nil {
		return i, 0, err
	}
	if version < 1 || i.Source != "organic" {
		return i, 0, errors.New("invalid stored participation")
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
	err := tx.QueryRow(ctx, `SELECT (SELECT count(*) FROM process_participations WHERE process_id=$1 AND stage_id=$2::uuid),
 (SELECT min(reached_at) FROM process_coverage_milestones WHERE process_id=$1)`, id, placement(p)).Scan(&c.Covered, &c.FullCoverageReachedAt)
	if c.FullCoverageReachedAt != nil {
		v := c.FullCoverageReachedAt.UTC()
		c.FullCoverageReachedAt = &v
	}
	return c, err
}
func (s *Store) Board(ctx context.Context, company, actor, id uuid.UUID) (app.Board, error) {
	tx, p, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.Board{}, err
	}
	defer tx.Rollback(ctx)
	out := app.Board{Stages: p.Stages, Exit: p.Exit, Participations: []app.Item{}}
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
	return out, err
}
func (s *Store) Move(ctx context.Context, company, actor, id, pid uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	tx, p, err := s.begin(ctx, company, actor, id)
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
	at := time.Now().UTC().Truncate(time.Microsecond)
	if _, err = tx.Exec(ctx, `UPDATE process_participations SET stage_id=$3,version=version+1 WHERE process_id=$1 AND id=$2`, id, pid, request.ToStageID); err != nil {
		return app.Moved{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recruiter')`, uuid.New(), pid, request.ToStageID, actor, at, item.StageID, hire, departure); err != nil {
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
	if err = tx.Commit(ctx); err != nil {
		return app.Moved{}, err
	}
	return app.Moved{Item: item, Coverage: next}, nil
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
	rows, err := tx.Query(ctx, `SELECT h.from_stage_id,h.stage_id,h.hire,h.departure,h.actor_kind,u.id,u.full_name,h.created_at FROM participation_stage_history h JOIN users u ON u.id=h.actor_id WHERE h.participation_id=$1 ORDER BY h.created_at,h.id`, pid)
	if err != nil {
		return app.History{}, err
	}
	defer rows.Close()
	out := app.History{Items: []app.Entry{}}
	for rows.Next() {
		var e app.Entry
		if err = rows.Scan(&e.FromStageID, &e.ToStageID, &e.Hire, &e.Departure, &e.Actor.Kind, &e.Actor.ID, &e.Actor.FullName, &e.At); err != nil {
			return out, err
		}
		e.Kind = "move"
		if e.FromStageID == nil {
			e.Kind = "intake"
		}
		e.At = e.At.UTC()
		out.Items = append(out.Items, e)
	}
	return out, rows.Err()
}
func (s *Store) Detail(ctx context.Context, company, actor, id, pid uuid.UUID) (app.Detail, error) {
	tx, _, err := s.begin(ctx, company, actor, id)
	if err != nil {
		return app.Detail{}, err
	}
	defer tx.Rollback(ctx)
	item, _, err := readItem(tx.QueryRow(ctx, itemSQL+`WHERE p.process_id=$1 AND p.id=$2`, id, pid))
	if err != nil {
		return app.Detail{}, err
	}
	var questions, answers []byte
	if err = tx.QueryRow(ctx, `SELECT questions_snapshot,answers_snapshot FROM process_participations WHERE process_id=$1 AND id=$2`, id, pid).Scan(&questions, &answers); err != nil {
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
	out := app.Detail{Item: item, Screening: []app.Screening{}}
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
	err = tx.QueryRow(ctx, `SELECT l.name,v.content_type,v.size,v.storage_key FROM process_participations p JOIN candidate_cv_versions v ON v.id=p.cv_version_id JOIN candidate_cv_library l ON l.version_id=v.id WHERE p.process_id=$1 AND p.id=$2`, id, pid).Scan(&file.Name, &file.ContentType, &file.Size, &key)
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
