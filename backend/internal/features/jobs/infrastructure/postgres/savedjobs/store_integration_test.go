//go:build integration

package savedjobs_test

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/savedjobs"
	publicstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/publicjobs"
	store "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/savedjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

type fixture struct {
	t                     *testing.T
	pool                  *pgxpool.Pool
	store                 *store.Store
	company, actor, other uuid.UUID
	sub, otherSub         string
}

func setup(t *testing.T) *fixture {
	t.Helper()
	if testing.Short() {
		t.Skip("isolated database test")
	}
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRAFT_TEST_DATABASE_URL not set")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid isolated database configuration")
	}
	if cfg.ConnConfig.Database != "draft_test" || (cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "::1") {
		t.Fatal("refusing non-loopback or non-draft_test database")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.MigrationsFS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = provider.Up(context.Background()); err != nil {
		t.Fatal(err)
	}
	f := &fixture{t: t, pool: pool, store: store.NewStore(pool), company: uuid.New(), actor: uuid.New(), other: uuid.New(), sub: uuid.NewString(), otherSub: uuid.NewString()}
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM process_participations WHERE candidate_id IN ($1,$2)`,
			`DELETE FROM candidate_cv_versions WHERE candidate_id IN ($1,$2)`,
			`DELETE FROM saved_jobs WHERE candidate_id IN ($1,$2)`,
		} {
			f.exec(q, f.actor, f.other)
		}
		for _, q := range []string{`DELETE FROM vacancy_public_projections WHERE company_id=$1`, `DELETE FROM vacancy_processes WHERE company_id=$1`, `DELETE FROM job_drafts WHERE company_id=$1`, `DELETE FROM jobs WHERE company_id=$1`, `DELETE FROM companies WHERE id=$1`} {
			f.exec(q, f.company)
		}
		f.exec(`DELETE FROM candidate_profiles WHERE user_id IN ($1,$2)`, f.actor, f.other)
		f.exec(`DELETE FROM users WHERE id IN ($1,$2)`, f.actor, f.other)
	})
	f.exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Saved candidate','candidate'),($4,$5,$6,'Other candidate','candidate')`, f.actor, f.sub, f.sub+"@example.test", f.other, f.otherSub, f.otherSub+"@example.test")
	f.exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Saved company',$2,'technology','active')`, f.company, uuid.NewString())
	return f
}
func (f *fixture) exec(q string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(), q, args...); err != nil {
		f.t.Fatal(err)
	}
}
func (f *fixture) legacy() uuid.UUID {
	f.t.Helper()
	id := uuid.New()
	f.exec(`INSERT INTO jobs(id,company_id,title,description,work_mode,employment_type,seniority,status,published_at,location,salary_min,salary_max,salary_currency) VALUES($1,$2,'Legacy','Role','remote','full_time','mid','published',now(),'Mexico',100,200,'MXN')`, id, f.company)
	return id
}
func (f *fixture) vacancy() uuid.UUID {
	f.t.Helper()
	id := uuid.New()
	f.exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,'{}')`, id, f.company, f.actor)
	f.exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, f.company, f.actor)
	f.exec(`INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,benefits,published_at,source_draft_version,skills,screening_questions,requirements_profile) VALUES($1,$2,'Engineer','Role','remote','full_time','indefinite','technology_systems','{}',now(),1,ARRAY[]::text[],0,'{"languages":[],"min_years_of_experience":null,"min_education_level":null,"accepts_in_progress_education":false}')`, id, f.company)
	return id
}
func (f *fixture) page() app.Page {
	f.t.Helper()
	p, err := f.store.List(context.Background(), f.sub)
	if err != nil {
		f.t.Fatal(err)
	}
	if p.Total != len(p.Items) || p.Limit != 200 || p.Items == nil {
		f.t.Fatal(p)
	}
	return p
}
func (f *fixture) save(id uuid.UUID) app.Saved {
	f.t.Helper()
	s, created, err := f.store.Save(context.Background(), f.sub, id)
	if err != nil || !created || s.JobID != id || s.SavedAt.IsZero() {
		f.t.Fatal(s, created, err)
	}
	return s
}
func TestSaveEvaluationOrderAndRejections(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	v := f.vacancy()
	l := f.legacy()
	before := f.page()
	reject := func(id uuid.UUID, want error) {
		t.Helper()
		_, created, err := f.store.Save(ctx, f.sub, id)
		if !errors.Is(err, want) || created {
			t.Fatal(created, err, want)
		}
		if got := f.page(); !reflect.DeepEqual(got, before) {
			t.Fatal("rejection changed saved rows", got, before)
		}
	}
	reject(uuid.New(), app.ErrNotFound)
	for _, status := range []string{"paused", "closed"} {
		f.exec(`UPDATE vacancy_processes SET status=$2 WHERE id=$1`, v, status)
		reject(v, app.ErrUnavailable)
	}
	draft := uuid.New()
	f.exec(`INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,'{}')`, draft, f.company, f.actor)
	reject(draft, app.ErrNotFound)
	f.exec(`UPDATE vacancy_processes SET status='published' WHERE id=$1`, v)
	for _, q := range []string{`UPDATE companies SET status='suspended' WHERE id=$1`, `UPDATE companies SET status='active',deleted_at=now() WHERE id=$1`} {
		f.exec(q, f.company)
		reject(v, app.ErrNotFound)
		reject(l, app.ErrNotFound)
	}
	f.exec(`UPDATE companies SET deleted_at=NULL WHERE id=$1`, f.company)
	for _, q := range []string{`UPDATE jobs SET status='draft' WHERE id=$1`, `UPDATE jobs SET status='published',published_at=now(),deleted_at=now() WHERE id=$1`} {
		f.exec(q, l)
		reject(l, app.ErrNotFound)
	}
	saved := f.save(v)
	f.exec(`UPDATE vacancy_processes SET status='closed' WHERE id=$1`, v)
	for i := 0; i < 199; i++ {
		f.save(f.legacy())
	}
	before = f.page()
	got, created, err := f.store.Save(ctx, f.sub, v)
	if err != nil || created || got != saved {
		t.Fatal("idempotency precedes availability/limit", got, created, err)
	}
	reject(f.legacy(), app.ErrLimit)
	reject(uuid.New(), app.ErrNotFound)
	paused := f.vacancy()
	f.exec(`UPDATE vacancy_processes SET status='paused' WHERE id=$1`, paused)
	reject(paused, app.ErrUnavailable)
}
func TestConcurrentSavesAt199(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	for i := 0; i < 199; i++ {
		f.save(f.legacy())
	}
	ids := []uuid.UUID{f.legacy(), f.legacy()}
	start := make(chan struct{})
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(id uuid.UUID) { defer wg.Done(); <-start; _, _, err := f.store.Save(ctx, f.sub, id); errs <- err }(id)
	}
	close(start)
	wg.Wait()
	close(errs)
	limits := 0
	success := 0
	for err := range errs {
		if errors.Is(err, app.ErrLimit) {
			limits++
		} else if err == nil {
			success++
		} else {
			t.Fatal(err)
		}
	}
	if limits != 1 || success != 1 || f.page().Total != 200 {
		t.Fatal(limits, success)
	}
}
func TestSnapshotsAvailabilityOrderingIsolationAndRemoval(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	v, l := f.vacancy(), f.legacy()
	f.exec(`UPDATE vacancy_public_projections SET country_code='MX',compensation='{"mode":"fixed","amount":"12500.00","min":null,"max":null,"currency":"MXN","pay_period":"monthly","basis":"gross"}' WHERE id=$1`, v)
	f.save(v)
	f.save(l)
	reader := publicstore.NewStore(db.New(f.pool))
	for _, item := range f.page().Items {
		detail, err := reader.Get(ctx, item.JobID)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(detail)
		var public map[string]any
		json.Unmarshal(raw, &public)
		raw, _ = json.Marshal(item.Job)
		var snapshot map[string]any
		json.Unmarshal(raw, &snapshot)
		if len(snapshot) != 8 {
			t.Fatal(snapshot)
		}
		for key, value := range snapshot {
			if !reflect.DeepEqual(value, public[key]) {
				t.Fatalf("snapshot %s differs: %v != %v", key, value, public[key])
			}
		}
		if item.Availability != "open" || item.ClosedAt != nil || item.Application != nil {
			t.Fatal(item)
		}
	}
	p := f.page()
	if p.Items[0].JobID != l {
		t.Fatal("saved_at descending", p)
	}
	f.exec(`UPDATE saved_jobs SET saved_at='2026-01-01T00:00:00Z' WHERE candidate_id=$1`, f.actor)
	p = f.page()
	if p.Items[0].JobID.String() > p.Items[1].JobID.String() {
		t.Fatal("job_id tie ordering", p)
	}
	ids, err := f.store.IDs(ctx, f.sub)
	if err != nil || !reflect.DeepEqual(ids, []uuid.UUID{p.Items[0].JobID, p.Items[1].JobID}) {
		t.Fatal(ids, err)
	}
	other, err := f.store.List(ctx, f.otherSub)
	if err != nil || other.Total != 0 || other.Items == nil {
		t.Fatal(other, err)
	}
	if _, _, err = f.store.Save(ctx, f.otherSub, v); err != nil {
		t.Fatal(err)
	}
	if err = f.store.Remove(ctx, f.otherSub, l); err != nil {
		t.Fatal(err)
	}
	if f.page().Total != 2 {
		t.Fatal("foreign removal")
	}
	otherIDs, err := f.store.IDs(ctx, f.otherSub)
	if err != nil || !reflect.DeepEqual(otherIDs, []uuid.UUID{v}) {
		t.Fatal(otherIDs, err)
	}
	stamp := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	assert := func(id uuid.UUID, availability string, closed *time.Time) {
		t.Helper()
		for _, item := range f.page().Items {
			if item.JobID == id {
				if item.Availability != availability || !reflect.DeepEqual(item.ClosedAt, closed) {
					t.Fatal(item, availability, closed)
				}
				return
			}
		}
		t.Fatal("missing item")
	}
	f.exec(`UPDATE vacancy_processes SET status='paused',paused_at=$2 WHERE id=$1`, v, stamp)
	assert(v, "closed", &stamp)
	f.exec(`UPDATE vacancy_processes SET status='closed',closed_at=$2 WHERE id=$1`, v, stamp.Add(time.Hour))
	closed := stamp.Add(time.Hour)
	assert(v, "closed", &closed)
	f.exec(`UPDATE vacancy_processes SET status='published' WHERE id=$1`, v)
	assert(v, "open", nil)
	f.exec(`UPDATE companies SET status='suspended' WHERE id=$1`, f.company)
	assert(v, "closed", nil)
	assert(l, "closed", nil)
	f.exec(`UPDATE companies SET status='active',deleted_at=now() WHERE id=$1`, f.company)
	assert(v, "closed", nil)
	assert(l, "closed", nil)
	f.exec(`UPDATE companies SET deleted_at=NULL WHERE id=$1`, f.company)
	f.exec(`UPDATE jobs SET status='draft' WHERE id=$1`, l)
	assert(l, "closed", nil)
	f.exec(`UPDATE jobs SET status='published',deleted_at=$2 WHERE id=$1`, l, stamp)
	assert(l, "closed", &stamp)
	f.exec(`UPDATE companies SET status='suspended' WHERE id=$1`, f.company)
	assert(l, "closed", &stamp)
	f.exec(`UPDATE companies SET status='active' WHERE id=$1`, f.company)
	removed, err := f.store.RemoveClosed(ctx, f.otherSub)
	if err != nil || removed != 0 {
		t.Fatal(removed, err)
	}
	removed, err = f.store.RemoveClosed(ctx, f.sub)
	if err != nil || removed != 1 || f.page().Total != 1 {
		t.Fatal(removed, err)
	}
	assert(v, "open", nil)
	if err = f.store.Remove(ctx, f.sub, v); err != nil {
		t.Fatal(err)
	}
	if err = f.store.Remove(ctx, f.sub, v); err != nil || f.page().Total != 0 {
		t.Fatal(err)
	}
	ids, err = f.store.IDs(ctx, f.sub)
	if err != nil || ids == nil || len(ids) != 0 {
		t.Fatal(ids, err)
	}
}
func TestApplicationsAndHardDeleteCascade(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	v, l := f.vacancy(), f.legacy()
	f.save(v)
	f.save(l)
	cv, participation := uuid.New(), uuid.New()
	f.exec(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,10,'application/pdf')`, cv, f.actor, hex.EncodeToString([]byte(uuid.NewString()[:32])))
	applied := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	f.exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,created_at) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6)`, participation, v, f.actor, uuid.New(), cv, applied)
	for _, item := range f.page().Items {
		if item.JobID == v {
			if item.Application == nil || item.Application.ID != participation || !item.Application.AppliedAt.Equal(applied) {
				t.Fatal(item)
			}
		} else if item.Application != nil {
			t.Fatal("legacy application", item)
		}
	}
	f.exec(`DELETE FROM process_participations WHERE id=$1`, participation)
	f.exec(`DELETE FROM jobs WHERE id=$1`, l)
	f.exec(`DELETE FROM vacancy_public_projections WHERE id=$1`, v)
	f.exec(`DELETE FROM vacancy_processes WHERE id=$1`, v)
	if f.page().Total != 0 {
		t.Fatal("hard delete did not cascade")
	}
	ids, err := f.store.IDs(ctx, f.sub)
	if err != nil || len(ids) != 0 {
		t.Fatal(ids, err)
	}
}
