//go:build integration

// Migration 00063 (`replacement_processes`): vacancy_replacements,
// vacancy_replacement_credits and process_participations.carried_from_participation_id
// carry the constraints of docs/contracts/replacement-processes-v1.md «Data model»;
// Down refuses while any replacement or carried participation exists (each
// disjunct on its own, atomically) and otherwise removes the three additions.
package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

type replacementSeed struct {
	company, actor uuid.UUID
	pool           *pgxpool.Pool
	t              *testing.T
}

func (s replacementSeed) exec(q string, args ...any) error {
	s.t.Helper()
	_, err := s.pool.Exec(context.Background(), q, args...)
	return err
}

func (s replacementSeed) must(q string, args ...any) {
	s.t.Helper()
	if err := s.exec(q, args...); err != nil {
		s.t.Fatal(err)
	}
}

func (s replacementSeed) process() uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	s.must(`INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,'{}')`, id, s.company, s.actor)
	s.must(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, s.company, s.actor)
	return id
}

func (s replacementSeed) credit() uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	s.must(`INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status) VALUES($1,$2,$3,$1,$1,now(),$4,'with_responsible','did_not_hold')`, id, s.company, uuid.New(), s.actor)
	return id
}

func (s replacementSeed) replacement(process, source, root uuid.UUID, sequence, target int) error {
	s.t.Helper()
	return s.exec(`INSERT INTO vacancy_replacements(process_id,company_id,source_process_id,root_process_id,sequence,started_at,started_by,target_quantity) VALUES($1,$2,$3,$4,$5,now(),$6,$7)`, process, s.company, source, root, sequence, s.actor, target)
}

func (s replacementSeed) participation(process uuid.UUID, carriedFrom any) uuid.UUID {
	s.t.Helper()
	id, user, cv := uuid.New(), uuid.New(), uuid.New()
	s.must(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Carried candidate','candidate')`, user, uuid.NewString(), uuid.NewString()+"@example.test")
	s.must(`INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, user, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	s.must(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,carried_from_participation_id) VALUES($1,$2,$3,$4,$5,'[]','[]','organic',$6)`, id, process, user, uuid.New(), cv, carriedFrom)
	return id
}

func newReplacementSeed(t *testing.T, pool *pgxpool.Pool) replacementSeed {
	t.Helper()
	_, company, actor := seedPrereqs(context.Background(), t, pool)
	return replacementSeed{company: company, actor: actor, pool: pool, t: t}
}

func TestMigration00063ModelConstraints(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	s := newReplacementSeed(t, pool)
	root, second, third, other := s.process(), s.process(), s.process(), s.process()
	for name, err := range map[string]error{
		"sequence below one":     s.replacement(second, root, root, 0, 1),
		"target below one":       s.replacement(second, root, root, 1, 0),
		"target above 999":       s.replacement(second, root, root, 1, 1000),
		"process is its source":  s.replacement(second, second, root, 1, 1),
		"process is its root":    s.replacement(second, root, second, 1, 1),
		"unknown source process": s.replacement(second, uuid.New(), root, 1, 1),
	} {
		if err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
	if err := s.replacement(second, root, root, 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := s.replacement(third, second, root, 1, 1); err == nil {
		t.Fatal("(root, sequence) accepted twice")
	}
	if err := s.replacement(second, root, root, 2, 1); err == nil {
		t.Fatal("a process became two replacements")
	}
	if err := s.replacement(third, second, root, 2, 1); err != nil {
		t.Fatal(err)
	}
	if err := s.replacement(other, root, other, 1, 1); err == nil {
		t.Fatal("a root replacing itself accepted")
	}
	credit := s.credit()
	if err := s.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, second, credit); err != nil {
		t.Fatal(err)
	}
	if err := s.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, third, credit); err == nil {
		t.Fatal("a credit was replaced twice")
	}
	if err := s.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, second, uuid.New()); err == nil {
		t.Fatal("unknown credit accepted")
	}
	if err := s.exec(`INSERT INTO vacancy_replacement_credits(replacement_process_id,placement_credit_id) VALUES($1,$2)`, root, s.credit()); err == nil {
		t.Fatal("the original process has no replacement row; credit link accepted")
	}
	template := s.participation(root, nil)
	carried := s.participation(second, template)
	var linked *string
	if err := pool.QueryRow(context.Background(), `SELECT carried_from_participation_id::text FROM process_participations WHERE id=$1`, carried).Scan(&linked); err != nil || linked == nil || *linked != template.String() {
		t.Fatalf("carried lineage=%v %v", linked, err)
	}
	if err := s.exec(`INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source,carried_from_participation_id)
 SELECT $1,process_id,candidate_id,$2,cv_version_id,'[]','[]','organic',$3 FROM process_participations WHERE id=$4`, uuid.New(), uuid.New(), uuid.New(), carried); err == nil {
		t.Fatal("carried_from_participation_id accepted an unknown participation")
	}
	var indexes int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM pg_indexes WHERE indexname IN ('vacancy_replacements_source_idx','process_participations_carried_idx')`).Scan(&indexes); err != nil || indexes != 2 {
		t.Fatalf("indexes=%d %v", indexes, err)
	}
}

// Each disjunct of the guard is exercised alone, and a refused Down leaves
// schema, data and goose's version row untouched.
func TestMigration00063DownRefusesReplacementData(t *testing.T) {
	for _, tc := range []struct {
		name string
		seed func(replacementSeed)
	}{
		{"replacement row", func(s replacementSeed) {
			if err := s.replacement(s.process(), s.process(), s.process(), 1, 1); err != nil {
				s.t.Fatal(err)
			}
		}},
		{"carried participation", func(s replacementSeed) {
			process := s.process()
			s.participation(process, s.participation(process, nil))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, pool, cleanup := isolatedMigrationDB(t)
			defer cleanup()
			gooseUpAll(t, db)
			tc.seed(newReplacementSeed(t, pool))
			err := gooseDownOnce(t, db)
			if err == nil || !strings.Contains(err.Error(), "cannot remove replacement processes: replacements or carried participations exist") {
				t.Fatalf("Down refusal: %v", err)
			}
			if version, err := goose.GetDBVersion(db); err != nil || version != 63 {
				t.Fatalf("version=%d: %v", version, err)
			}
			if !columnExists(t, pool, "process_participations", "carried_from_participation_id") || !tableExists(t, pool, "vacancy_replacements") || !tableExists(t, pool, "vacancy_replacement_credits") {
				t.Fatal("rejected Down changed the schema")
			}
		})
	}
}

func TestMigration00063DownAndUpWithoutReplacementData(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	s := newReplacementSeed(t, pool)
	s.participation(s.process(), nil)
	if err := gooseDownOnce(t, db); err != nil {
		t.Fatal(err)
	}
	if columnExists(t, pool, "process_participations", "carried_from_participation_id") || tableExists(t, pool, "vacancy_replacements") || tableExists(t, pool, "vacancy_replacement_credits") {
		t.Fatal("Down left replacement structures behind")
	}
	var participations int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM process_participations`).Scan(&participations); err != nil || participations != 1 {
		t.Fatalf("participations=%d %v", participations, err)
	}
	gooseUpAll(t, db)
	if !tableExists(t, pool, "vacancy_replacements") {
		t.Fatal("Up did not restore the schema")
	}
}

func tableExists(t *testing.T, pool *pgxpool.Pool, table string) bool {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT to_regclass($1) IS NOT NULL`, "public."+table).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	return exists
}
