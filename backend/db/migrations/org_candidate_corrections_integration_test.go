//go:build integration

package migrations_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

func TestOrgCandidateCorrectionsGuardedDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 44)
	gooseUpTo(t, db, 45)
	company, user, actor := uuid.New(), uuid.New(), uuid.New()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Corrections Company',$2,'technology','active')`, company, uuid.NewString())
	for _, id := range []uuid.UUID{user, actor} {
		exec(`INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Migration Actor','candidate')`, id, uuid.NewString(), uuid.NewString()+"@example.test")
	}
	exec(`INSERT INTO company_candidate_corrections(company_id,user_id) VALUES($1,$2)`, company, user)
	var version int64
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT version,corrections FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2`, company, user).Scan(&version, &raw); err != nil || version != 1 || string(raw) != "{}" {
		t.Fatal(version, string(raw), err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO company_candidate_corrections(company_id,user_id) VALUES($1,$2)`, company, user); err == nil {
		t.Fatal("duplicate correction identity accepted")
	}
	guard := func() {
		t.Helper()
		if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "retention decision") {
			t.Fatal(err)
		}
		if v, err := goose.GetDBVersion(db); err != nil || v != 45 {
			t.Fatal(v, err)
		}
		if err := pool.QueryRow(ctx, `SELECT version FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2`, company, user).Scan(&version); err != nil {
			t.Fatal("non-atomic Down", err)
		}
	}
	for _, tc := range []struct{ name, update, restore string }{
		{"correction", `corrections='{"phone":null}'`, `corrections='{}'`},
		{"version", `version=2`, `version=1`},
		{"timestamp", `updated_at=now()`, `updated_at=NULL`},
		{"actor", `updated_by=user_id`, `updated_by=NULL`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exec(`UPDATE company_candidate_corrections SET ` + tc.update)
			guard()
			exec(`UPDATE company_candidate_corrections SET ` + tc.restore)
		})
	}
	t.Run("history alone", func(t *testing.T) {
		exec(`INSERT INTO company_candidate_history(id,company_id,candidate_kind,candidate_id,actor_id,changes) VALUES($1,$2,'organic',$3,$4,'[{"field":"phone","contact":true,"reset":true}]')`, uuid.New(), company, user, actor)
		guard()
		exec(`DELETE FROM company_candidate_history WHERE company_id=$1`, company)
	})
	gooseDownTo(t, db, 44)
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('company_candidate_corrections') IS NOT NULL`).Scan(&exists); err != nil || exists {
		t.Fatal(exists, err)
	}
	gooseUpTo(t, db, 45)
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM company_candidate_corrections`).Scan(&version); err != nil || version != 0 {
		t.Fatal(version, err)
	}
}
