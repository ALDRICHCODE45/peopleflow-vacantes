//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestPsychometricProfileMigrationGuardedDown(t *testing.T) {
	if testing.Short() {
		t.Skip("isolated migration database")
	}
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseDownTo(t, db, 48)
	var absent bool
	if err := pool.QueryRow(context.Background(), `SELECT to_regclass('job_draft_psychometric_profiles') IS NULL`).Scan(&absent); err != nil || !absent {
		t.Fatal(absent, err)
	}
	gooseUpAll(t, db)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	id := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) VALUES($1,$2,$3,$3,$4)`, id, company, actor, []byte(`{"schema_version":2,"fields":{}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO job_draft_psychometric_profiles VALUES($1,1,'{}')`, id); err != nil {
		t.Fatal(err)
	}
	if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "psychometric profile data exist; rollback requires an explicit retention decision") {
		t.Fatalf("guard=%v", err)
	}
	if v, err := goose.GetDBVersion(db); err != nil || v != 49 {
		t.Fatal(v, err)
	}
	var stored string
	var version int64
	if err := pool.QueryRow(ctx, `SELECT profile::text,version FROM job_draft_psychometric_profiles WHERE draft_id=$1`, id).Scan(&stored, &version); err != nil || stored != "{}" || version != 1 {
		t.Fatal(stored, version, err)
	}
	// FK cascade removes only this disposable fixture, allowing the empty Down.
	if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	gooseDownTo(t, db, 48)
	if err := pool.QueryRow(ctx, `SELECT to_regclass('job_draft_psychometric_profiles') IS NULL`).Scan(&absent); err != nil || !absent {
		t.Fatal(absent, err)
	}
}
