package v2

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditport "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const fingerprintAlgorithm = "go-json-v1+sha256"

type Store struct {
	pool     *pgxpool.Pool
	audit    auditport.AuditEventRepository
	rules    app.VacancyRules
	delivery app.DeliveryRecorder
}

func NewStore(pool *pgxpool.Pool, audit auditport.AuditEventRepository, rules app.VacancyRules, delivery app.DeliveryRecorder) *Store {
	return &Store{pool, audit, rules, delivery}
}

var _ app.Store = (*Store)(nil)

func actor(ctx context.Context, tx pgx.Tx, sub string) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1 AND user_type='candidate' AND deleted_at IS NULL FOR UPDATE`, sub).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, app.ErrNotFound
	}
	return id, err
}
func (s *Store) Apply(ctx context.Context, sub string, vacancy, key uuid.UUID, req app.Request) (app.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Result{}, err
	}
	defer tx.Rollback(ctx)
	candidate, err := actor(ctx, tx, sub)
	if err != nil {
		return app.Result{}, err
	}
	// Lock the same authoring row as employer saves. A process lock alone
	// would not serialize questionnaire edits, since they lock the draft.
	var fields []byte
	err = tx.QueryRow(ctx, `SELECT d.fields FROM job_drafts d JOIN vacancy_processes p ON p.id=d.id JOIN vacancy_public_projections v ON v.id=p.id JOIN companies c ON c.id=p.company_id WHERE p.id=$1 AND c.status='active' AND c.deleted_at IS NULL FOR SHARE OF d,c`, vacancy).Scan(&fields)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Result{}, app.ErrNotFound
	}
	if err != nil {
		return app.Result{}, err
	}
	var locked uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT id FROM vacancy_processes WHERE id=$1 FOR UPDATE`, vacancy).Scan(&locked); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return app.Result{}, app.ErrNotFound
		}
		return app.Result{}, err
	}
	fingerprint, err := app.Fingerprint(req)
	if err != nil {
		return app.Result{}, err
	}
	var stored, body []byte
	var algorithm string
	err = tx.QueryRow(ctx, `SELECT fingerprint,fingerprint_algorithm,response_body FROM participation_idempotency WHERE candidate_id=$1 AND process_id=$2 AND idem_key=$3`, candidate, vacancy, key).Scan(&stored, &algorithm, &body)
	if err == nil {
		if algorithm != fingerprintAlgorithm || len(stored) != 32 {
			return app.Result{}, errors.New("invalid application fingerprint record")
		}
		if subtle.ConstantTimeCompare(stored, fingerprint) != 1 {
			return app.Result{}, app.ErrIdempotencyConflict
		}
		return app.Result{Body: body, Replayed: true}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return app.Result{}, err
	}
	// Lifecycle writers also lock the draft first. Read availability in a fresh
	// statement, never from the join that may have waited on that draft lock.
	var availability string
	if err = tx.QueryRow(ctx, `SELECT status FROM vacancy_processes WHERE id=$1`, vacancy).Scan(&availability); err != nil {
		return app.Result{}, err
	}
	if availability != "published" {
		return app.Result{}, &app.NotAcceptingApplications{Availability: availability}
	}
	// Use a fresh READ COMMITTED statement after the draft lock is held.
	// SaveV2/Publish lock the draft before writing the projection. A join that
	// waits for that lock can refresh d via EvalPlanQual but retain stale v
	// values from its original snapshot. No extra projection lock is needed:
	// retaining the draft lock excludes those writers for this transaction.
	var mode string
	var scope *string
	var allowed []string
	err = tx.QueryRow(ctx, `SELECT work_mode,remote_scope_kind,remote_countries FROM vacancy_public_projections WHERE id=$1`, vacancy).Scan(&mode, &scope, &allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Result{}, app.ErrNotFound
	}
	if err != nil {
		return app.Result{}, err
	}
	// Read the current profile once, after replay and before screening/CV/duplicate
	// checks. The same row supplies both the gate and the immutable snapshot.
	var country, state, municipality, years, seniority *string
	var skills []string
	var education app.SnapshotEducation
	var spoken []app.SnapshotLanguage
	var languageJSON []byte
	err = tx.QueryRow(ctx, `SELECT country_code,state_code,municipality_code,skills,trim_scale(years_of_experience)::text,seniority,
 (SELECT level FROM candidate_educations e WHERE e.user_id=cp.user_id AND e.status='completed' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1),
 (SELECT level FROM candidate_educations e WHERE e.user_id=cp.user_id AND e.status='in_progress' ORDER BY array_position(ARRAY['secondary','high_school','technical','tsu','bachelor','specialty','master','phd'],e.level) DESC,e.position,e.id LIMIT 1),
 COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.code,'level',l.level) ORDER BY l.code) FROM candidate_languages l WHERE l.user_id=cp.user_id),'[]'::jsonb)
 FROM candidate_profiles cp WHERE user_id=$1 FOR SHARE`, candidate).Scan(&country, &state, &municipality, &skills, &years, &seniority, &education.HighestCompleted, &education.InProgress, &languageJSON)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return app.Result{}, err
	}
	if languageJSON != nil {
		if err = json.Unmarshal(languageJSON, &spoken); err != nil {
			return app.Result{}, err
		}
	}
	if err = app.CheckApplicantCountry(mode, scope, allowed, country); err != nil {
		return app.Result{}, err
	}
	var location *app.SnapshotLocation
	if country != nil {
		location = &app.SnapshotLocation{Country: *country, State: state, Municipality: municipality}
	}
	form, err := s.rules.Screening(fields)
	if err != nil {
		return app.Result{}, err
	}
	if form.Revision != req.Revision {
		return app.Result{}, app.ErrQuestionnaireChanged
	}
	if err = app.ValidateAnswers(form, req.Answers); err != nil {
		return app.Result{}, err
	}
	var version uuid.UUID
	err = tx.QueryRow(ctx, `SELECT version_id FROM candidate_cv_library WHERE id=$1 AND candidate_id=$2 AND removed_at IS NULL FOR SHARE`, req.CVID, candidate).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Result{}, app.ErrCVUnavailable
	}
	if err != nil {
		return app.Result{}, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations WHERE process_id=$1 AND candidate_id=$2)`, vacancy, candidate).Scan(&exists); err != nil {
		return app.Result{}, err
	}
	if exists {
		return app.Result{}, app.ErrAlreadyApplied
	}
	questions, err := json.Marshal(form.Questions)
	if err != nil {
		return app.Result{}, err
	}
	answers, err := json.Marshal(req.Answers)
	if err != nil {
		return app.Result{}, err
	}
	profile, err := json.Marshal(app.SnapshotProfile(location, skills, years, seniority, education, spoken))
	if err != nil {
		return app.Result{}, err
	}
	id := uuid.New()
	stage := s.rules.InitialStage(vacancy)
	at := time.Now().UTC().Truncate(time.Microsecond)
	_, err = tx.Exec(ctx, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,created_at,profile_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,'organic',$8,$9)`, id, vacancy, candidate, stage, version, questions, answers, at, profile)
	if err != nil {
		return app.Result{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at) VALUES($1,$2,$3,$4,$5)`, uuid.New(), id, stage, candidate, at); err != nil {
		return app.Result{}, err
	}
	event := audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &candidate, EventType: "VacancyApplicationSubmitted", EntityType: "process_participation", EntityID: id, Metadata: map[string]string{"vacancy_id": vacancy.String(), "stage_id": stage.String(), "source": "organic"}}
	if err = s.audit.Append(ctx, tx, event); err != nil {
		return app.Result{}, err
	}
	if err = s.delivery.RecordDelivery(ctx, tx, vacancy, candidate, stage, at); err != nil {
		return app.Result{}, err
	}
	body, err = json.Marshal(app.Submitted{ID: id, VacancyID: vacancy, Status: "submitted", AppliedAt: at})
	if err != nil {
		return app.Result{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO participation_idempotency(candidate_id,process_id,idem_key,fingerprint,fingerprint_algorithm,response_body) VALUES($1,$2,$3,$4,$5,$6)`, candidate, vacancy, key, fingerprint, fingerprintAlgorithm, body); err != nil {
		return app.Result{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return app.Result{}, err
	}
	return app.Result{Body: body}, nil
}
func (s *Store) List(ctx context.Context, sub string, q app.Query) (app.Page, error) {
	if q.Limit < 1 || q.Limit > 50 {
		return app.Page{}, app.ErrInvalidRequest
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Page{}, err
	}
	defer tx.Rollback(ctx)
	candidate, err := actor(ctx, tx, sub)
	if err != nil {
		return app.Page{}, err
	}
	var at any
	id := uuid.Nil
	if q.After != nil {
		at = q.After.At
		id = q.After.ID
	}
	rows, err := tx.Query(ctx, `SELECT p.id,p.process_id,v.title,CASE WHEN vp.process_status='finished' THEN 'closed' ELSE 'open' END,c.id,c.name,p.created_at,p.stage_id,p.discarded_at IS NOT NULL,CASE WHEN p.discarded_at IS NOT NULL THEN p.candidate_message ELSE NULL END FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id JOIN vacancy_public_projections v ON v.id=vp.id JOIN companies c ON c.id=vp.company_id WHERE p.candidate_id=$1 AND p.source='organic' AND ($2::timestamptz IS NULL OR (p.created_at,p.id)<($2::timestamptz,$3::uuid)) ORDER BY p.created_at DESC,p.id DESC LIMIT $4`, candidate, at, id, q.Limit+1)
	if err != nil {
		return app.Page{}, err
	}
	defer rows.Close()
	page := app.Page{Items: []app.Item{}}
	for rows.Next() {
		var item app.Item
		var stage uuid.UUID
		var discarded bool
		if err = rows.Scan(&item.ID, &item.Vacancy.ID, &item.Vacancy.Title, &item.Vacancy.State, &item.Company.ID, &item.Company.Name, &item.AppliedAt, &stage, &discarded, &item.Message); err != nil {
			return app.Page{}, err
		}
		item.Status = app.CandidateStatus(stage, s.rules.InitialStage(item.Vacancy.ID), discarded)
		item.AppliedAt = item.AppliedAt.UTC()
		page.Items = append(page.Items, item)
	}
	if err = rows.Err(); err != nil {
		return app.Page{}, err
	}
	if len(page.Items) > q.Limit {
		last := page.Items[q.Limit-1]
		token, err := app.EncodeCursor(app.Position{ID: last.ID, At: last.AppliedAt})
		if err != nil {
			return app.Page{}, err
		}
		page.NextCursor = &token
		page.Items = page.Items[:q.Limit]
	}
	return page, nil
}
