//go:build integration

package v2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"reflect"
	"sync"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	cvapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	cvstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/postgres/cvs"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	publicstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

type rejectAudit struct{}

func (rejectAudit) Append(context.Context, pgx.Tx, auditentities.AuditEvent) error {
	return errors.New("injected audit failure")
}

type invalidStorageKey struct {
	cvapp.Storage
	real string
}

func (s *invalidStorageKey) Put(ctx context.Context, data []byte) (string, error) {
	key, err := s.Storage.Put(ctx, data)
	s.real = key
	return "invalid-storage-key", err
}
func (s *invalidStorageKey) Delete(ctx context.Context, _ string) error {
	return s.Storage.Delete(ctx, s.real)
}
func TestScreeningAndApplyHideLegacyUnpublishedAndInactive(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	reader := publicstore.NewStore(db.New(f.pool))
	public, err := reader.Screening(ctx, f.vacancy)
	if err != nil || public.Revision != f.form.Revision {
		t.Fatal(public, err)
	}
	cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	legacy := uuid.New()
	unpublished := uuid.New()
	if _, err = f.pool.Exec(ctx, `INSERT INTO jobs(id,company_id,title,description,work_mode,employment_type,seniority,status,published_at) VALUES($1,$2,'Legacy','Legacy role','remote','full_time','mid','published',now())`, legacy, f.company); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := f.pool.Exec(context.Background(), `DELETE FROM jobs WHERE id=$1`, legacy); err != nil {
			t.Error("legacy fixture cleanup failed")
		}
	})
	if _, err = f.pool.Exec(ctx, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, unpublished, f.vacancy); err != nil {
		t.Fatal(err)
	}
	before := f.effects(t)
	assertHidden := func(id uuid.UUID) {
		t.Helper()
		if _, err := reader.Screening(ctx, id); !errors.Is(err, publicjobs.ErrNotFound) {
			t.Fatal("public screening exposed unavailable vacancy", err)
		}
		if _, err := f.store.Apply(ctx, f.sub, id, uuid.New(), f.request(cv.ID)); !errors.Is(err, app.ErrNotFound) {
			t.Fatal("applied to unavailable vacancy", err)
		}
	}
	for _, id := range []uuid.UUID{uuid.New(), legacy, unpublished} {
		assertHidden(id)
	}
	if _, err = f.pool.Exec(ctx, `UPDATE companies SET status='suspended' WHERE id=$1`, f.company); err != nil {
		t.Fatal(err)
	}
	assertHidden(f.vacancy)
	if _, err = f.pool.Exec(ctx, `UPDATE companies SET status='active',deleted_at=now() WHERE id=$1`, f.company); err != nil {
		t.Fatal(err)
	}
	assertHidden(f.vacancy)
	if before != f.effects(t) {
		t.Fatal("unavailable vacancies changed participation/history/audit/idempotency/legacy state")
	}
}

func TestCVFailedRowWriteDeletesPrivateFile(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	library := cvstore.NewLibrary(f.pool, &invalidStorageKey{Storage: f.storage})
	if _, err := library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1")); err == nil {
		t.Fatal("injected row failure ignored")
	}
	keys, err := f.storage.Keys(ctx)
	if err != nil || len(keys) != 0 {
		t.Fatal("failed row write left a file", keys, err)
	}
	var count int
	if err = f.pool.QueryRow(ctx, `SELECT count(*) FROM candidate_cv_versions WHERE candidate_id=$1`, f.actor).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed upload left version", count, err)
	}
}
func TestParticipationAuditFailureRollsBackAllEffects(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	before := f.effects(t)
	failing := NewStore(f.pool, rejectAudit{}, testVacancyRules{})
	if _, err = failing.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cv.ID)); err == nil {
		t.Fatal("audit failure ignored")
	}
	if got := f.effects(t); got != before {
		t.Fatal("audit failure left participation/history/idempotency/audit/legacy writes", got)
	}
	keys, _ := f.storage.Keys(ctx)
	if len(keys) != 1 {
		t.Fatal("failed apply changed CV files", keys)
	}
}

func isolatedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRAFT_TEST_DATABASE_URL not set; isolated database execution skipped")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid isolated database configuration")
	}
	if cfg.ConnConfig.Database != "draft_test" || (cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "::1") {
		t.Fatal("refusing non-loopback or non-draft_test database")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal("isolated database connection failed")
	}
	t.Cleanup(pool.Close)
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.MigrationsFS)
	if err != nil {
		t.Fatal("migration provider failed")
	}
	if _, err = provider.Up(context.Background()); err != nil {
		t.Fatal("isolated migrations failed")
	}
	return pool
}

type fixture struct {
	pool                    *pgxpool.Pool
	library                 *cvstore.Library
	storage                 *storage.Local
	sub, other              string
	actor, vacancy, company uuid.UUID
	form                    publicjobs.Screening
	store                   *Store
}

type testVacancyRules struct{}

func (testVacancyRules) Screening(stored []byte) (app.Screening, error) {
	safe, err := publicjobs.BuildScreening(stored)
	if err != nil {
		return app.Screening{}, err
	}
	raw, err := json.Marshal(safe)
	if err != nil {
		return app.Screening{}, err
	}
	var form app.Screening
	err = json.Unmarshal(raw, &form)
	return form, err
}
func (testVacancyRules) InitialStage(id uuid.UUID) uuid.UUID {
	return uuid.MustParse(pipelineconfig.Defaults(id).Stages[0].ID)
}

func setup(t *testing.T) fixture {
	t.Helper()
	pool := isolatedPool(t)
	ctx := context.Background()
	f := fixture{pool: pool, sub: uuid.NewString(), other: uuid.NewString(), actor: uuid.New(), vacancy: uuid.New(), company: uuid.New()}
	f.storage, _ = storage.NewLocal(t.TempDir())
	t.Cleanup(func() { f.storage.Close() })
	f.library = cvstore.NewLibrary(pool, f.storage)
	f.store = NewStore(pool, audit.NewAuditEventRepository(), testVacancyRules{})
	recruiter := uuid.New()
	otherID := uuid.New()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		cleanupCtx := context.Background()
		tx, err := pool.Begin(cleanupCtx)
		if err != nil {
			t.Error("fixture cleanup could not begin")
			return
		}
		defer tx.Rollback(cleanupCtx)
		for _, sql := range []string{
			`DELETE FROM audit_events WHERE entity_type='process_participation' AND entity_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes v ON v.id=p.process_id WHERE v.company_id=$1)`,
			`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes v ON v.id=p.process_id WHERE v.company_id=$1)`,
			`DELETE FROM participation_idempotency WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
			`DELETE FROM process_participations WHERE process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
			`DELETE FROM vacancy_public_projections WHERE company_id=$1`,
			`DELETE FROM vacancy_processes WHERE company_id=$1`,
			`DELETE FROM job_drafts WHERE company_id=$1`,
			`DELETE FROM companies WHERE id=$1`,
		} {
			if _, err = tx.Exec(cleanupCtx, sql, f.company); err != nil {
				t.Error("fixture cleanup failed")
				return
			}
		}
		for _, table := range []string{"candidate_cv_library", "candidate_cv_versions"} {
			if _, err = tx.Exec(cleanupCtx, `DELETE FROM `+table+` WHERE candidate_id IN ($1,$2)`, f.actor, otherID); err != nil {
				t.Error("CV fixture cleanup failed")
				return
			}
		}
		if _, err = tx.Exec(cleanupCtx, `DELETE FROM users WHERE id IN ($1,$2,$3)`, f.actor, otherID, recruiter); err != nil {
			t.Error("user fixture cleanup failed")
			return
		}
		if err = tx.Commit(cleanupCtx); err != nil {
			t.Error("fixture cleanup commit failed")
		}
	})
	exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Candidate','candidate'),($4,$5,$6,'Other','candidate'),($7,$8,$9,'Recruiter','recruiter')`, f.actor, f.sub, f.sub+"@example.test", otherID, f.other, f.other+"@example.test", recruiter, uuid.NewString(), uuid.NewString()+"@example.test")
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Acme',$2,'technology','active')`, f.company, uuid.NewString())
	d, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	f.form, err = publicjobs.BuildScreening(d.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, f.vacancy, f.company, recruiter, d.Fingerprint())
	exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, f.vacancy, f.company, recruiter)
	exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,location,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version) VALUES($1,$2,'Engineer','Role','CDMX','remote','full_time','indefinite','technology_systems','{}',now(),1)`, f.vacancy, f.company)
	return f
}
func (f fixture) request(cv uuid.UUID) app.Request {
	return app.Request{CVID: cv, Revision: f.form.Revision, Answers: []app.Answer{{QuestionID: f.form.Questions[0].ID, Text: "Because", HasText: true}}}
}
func (f fixture) effects(t *testing.T) string {
	t.Helper()
	var snapshot string
	err := f.pool.QueryRow(context.Background(), `SELECT json_build_array((SELECT count(*) FROM process_participations WHERE process_id=$1),(SELECT count(*) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1),(SELECT count(*) FROM audit_events WHERE metadata->>'vacancy_id'=$1::text),(SELECT count(*) FROM participation_idempotency WHERE process_id=$1),(SELECT count(*) FROM applications WHERE candidate_id=$2))::text`, f.vacancy, f.actor).Scan(&snapshot)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}
func (f fixture) assertSingleEffects(t *testing.T) {
	t.Helper()
	var counts []int
	if err := json.Unmarshal([]byte(f.effects(t)), &counts); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(counts, []int{1, 1, 1, 1, 0}) {
		t.Fatal("wrong participation/history/audit/idempotency/legacy effects", counts)
	}
}
func TestParticipationAtomicReplaySnapshotAndCVRetention(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	cv, err := f.library.Upload(ctx, f.sub, "Resume", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	before := f.effects(t)
	req := f.request(cv.ID)
	foreign, err := f.library.Upload(ctx, f.other, "Foreign", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	bad := req
	bad.CVID = foreign.ID
	if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), bad); !errors.Is(err, app.ErrCVUnavailable) {
		t.Fatal(err)
	}
	stale := req
	stale.Revision = "old"
	if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), stale); !errors.Is(err, app.ErrQuestionnaireChanged) {
		t.Fatal(err)
	}
	invalid := req
	invalid.Answers = []app.Answer{}
	var answerErr *app.InvalidAnswers
	if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), invalid); !errors.As(err, &answerErr) {
		t.Fatal(err)
	}
	if got := f.effects(t); got != before {
		t.Fatal("rejected request changed state", got)
	}
	key := uuid.New()
	created, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
	if err != nil || !replay.Replayed || !bytes.Equal(created.Body, replay.Body) {
		t.Fatal("bad replay", err)
	}
	changed := req
	changed.Answers = append([]app.Answer{}, req.Answers...)
	changed.Answers[0].Text = "Different"
	if _, err = f.store.Apply(ctx, f.sub, f.vacancy, key, changed); !errors.Is(err, app.ErrIdempotencyConflict) {
		t.Fatal(err)
	}
	if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), req); !errors.Is(err, app.ErrAlreadyApplied) {
		t.Fatal(err)
	}
	f.assertSingleEffects(t)
	var stage uuid.UUID
	var snapshot, answers string
	if err = f.pool.QueryRow(ctx, `SELECT stage_id,questions_snapshot::text,answers_snapshot::text FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&stage, &snapshot, &answers); err != nil {
		t.Fatal(err)
	}
	if stage.String() != pipelineconfig.Defaults(f.vacancy).Stages[0].ID {
		t.Fatal("wrong intake stage")
	}
	if _, err = f.pool.Exec(ctx, `UPDATE job_drafts SET fields=convert_to(replace(convert_from(fields,'UTF8'),'Why?','Changed?'),'UTF8') WHERE id=$1`, f.vacancy); err != nil {
		t.Fatal(err)
	}
	var after, answersAfter string
	if err = f.pool.QueryRow(ctx, `SELECT questions_snapshot::text,answers_snapshot::text FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&after, &answersAfter); err != nil {
		t.Fatal(err)
	}
	if snapshot != after || answers != answersAfter {
		t.Fatal("question/answer snapshot changed after questionnaire edit")
	}
	var frozen []app.Answer
	if err = json.Unmarshal([]byte(answersAfter), &frozen); err != nil || len(frozen) != 1 || frozen[0].QuestionID != req.Answers[0].QuestionID || frozen[0].Text != "Because" {
		t.Fatal("original answer was not frozen", err)
	}
	if _, err = f.library.Rename(ctx, f.sub, cv.ID, "Updated label"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = f.library.File(ctx, f.other, cv.ID); !errors.Is(err, cvapp.ErrNotFound) {
		t.Fatal("cross-candidate read", err)
	}
	if err = f.library.Remove(ctx, f.sub, cv.ID); err != nil {
		t.Fatal(err)
	}
	replayAfterRemoval, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
	if err != nil || !replayAfterRemoval.Replayed || !bytes.Equal(replayAfterRemoval.Body, created.Body) {
		t.Fatal("original request did not replay after questionnaire edit and CV removal", err)
	}
	f.assertSingleEffects(t)
	if err = f.library.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	keys, _ := f.storage.Keys(ctx)
	if len(keys) != 2 {
		t.Fatal("used version removed", keys)
	}
	page, err := f.store.List(ctx, f.sub, app.Query{Limit: 20})
	if err != nil || len(page.Items) != 1 || page.Items[0].Status != "submitted" {
		t.Fatal(page, err)
	}
	other, err := f.store.List(ctx, f.other, app.Query{Limit: 20})
	if err != nil || len(other.Items) != 0 {
		t.Fatal(other, err)
	}
}
func TestCVLibraryLimitRemovalOrphanReconciler(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	var first cvapp.CV
	for i := 0; i < 10; i++ {
		cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = cv
		}
	}
	if _, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1")); !errors.Is(err, cvapp.ErrLibraryFull) {
		t.Fatal(err)
	}
	if _, err := f.library.Rename(ctx, f.other, first.ID, "Foreign rename"); !errors.Is(err, cvapp.ErrNotFound) {
		t.Fatal("foreign rename must be not found", err)
	}
	items, err := f.library.List(ctx, f.sub)
	if err != nil || len(items) != 10 {
		t.Fatal("list failed", err)
	}
	for _, item := range items {
		if item.Name != "CV" {
			t.Fatal("foreign rename changed owner's label")
		}
	}
	if err := f.library.Remove(ctx, f.other, first.ID); !errors.Is(err, cvapp.ErrNotFound) {
		t.Fatal(err)
	}
	if err := f.library.Remove(ctx, f.sub, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.library.File(ctx, f.sub, first.ID); !errors.Is(err, cvapp.ErrNotFound) {
		t.Fatal(err)
	}
	orphan, err := f.storage.Put(ctx, []byte("orphan"))
	if err != nil {
		t.Fatal(err)
	}
	if err = f.library.Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	if file, err := f.storage.Open(ctx, orphan); err == nil {
		io.Copy(io.Discard, file)
		file.Close()
		t.Fatal("orphan survived")
	}
	keys, _ := f.storage.Keys(ctx)
	if len(keys) != 9 {
		t.Fatal("unexpected files", keys)
	}
}
func TestCandidateListPagingAndVacancyScopedKeys(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	second := uuid.New()
	for _, sql := range []string{
		`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`,
		`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) SELECT $1,company_id,status,published_at,published_by FROM vacancy_processes WHERE id=$2`,
		`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,location,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version) SELECT $1,company_id,'Second',description_plain,location,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version FROM vacancy_public_projections WHERE id=$2`,
	} {
		if _, err := f.pool.Exec(ctx, sql, second, f.vacancy); err != nil {
			t.Fatal(err)
		}
	}
	cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	key := uuid.New()
	var submitted []app.Submitted
	for _, vacancy := range []uuid.UUID{f.vacancy, second} {
		result, err := f.store.Apply(ctx, f.sub, vacancy, key, f.request(cv.ID))
		if err != nil || result.Replayed {
			t.Fatal("key leaked between vacancies", err)
		}
		var body app.Submitted
		if err = json.Unmarshal(result.Body, &body); err != nil {
			t.Fatal(err)
		}
		submitted = append(submitted, body)
	}
	expected := submitted[1]
	remaining := submitted[0]
	if expected.AppliedAt.Before(remaining.AppliedAt) || (expected.AppliedAt.Equal(remaining.AppliedAt) && bytes.Compare(expected.ID[:], remaining.ID[:]) < 0) {
		expected, remaining = remaining, expected
	}
	page, err := f.store.List(ctx, f.sub, app.Query{Limit: 1})
	if err != nil || len(page.Items) != 1 || page.NextCursor == nil || page.Items[0].ID != expected.ID {
		t.Fatal(page, err)
	}
	query, err := app.ParseQuery("limit=1&cursor=" + *page.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	next, err := f.store.List(ctx, f.sub, query)
	if err != nil || len(next.Items) != 1 || next.Items[0].ID != remaining.ID || next.NextCursor != nil {
		t.Fatal(next, err)
	}
}

func TestConcurrentAppliesCreateOneParticipation(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cv.ID))
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	success, duplicate := 0, 0
	for err := range errs {
		if err == nil {
			success++
		} else if errors.Is(err, app.ErrAlreadyApplied) {
			duplicate++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || duplicate != 1 {
		t.Fatal(success, duplicate)
	}
	var count int
	if err = f.pool.QueryRow(ctx, `SELECT count(*) FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	f.assertSingleEffects(t)
}
