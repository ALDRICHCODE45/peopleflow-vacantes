package pool

import (
	"context"

	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// requireTalentBase re-checks, inside the write's own transaction and before it
// looks up any candidate, that the actor may still use the talent base. It makes
// sure the settings row exists and takes it FOR SHARE: the owner's setting
// change locks it FOR UPDATE, so a write either finishes before a revocation or
// waits for it and is refused. A company that never saved the setting is
// all_recruiters. The company row is key-share locked first, the same order as
// the setting PUT (company, then setting): the write's later inserts reference
// companies, and taking that lock after the setting row would deadlock with it.
func requireTalentBase(ctx context.Context, tx pgx.Tx, company, actor uuid.UUID) error {
	if _, err := tx.Exec(ctx, `SELECT 1 FROM companies WHERE id=$1 FOR KEY SHARE`, company); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO company_talent_base_settings(company_id,mode) VALUES($1,'all_recruiters') ON CONFLICT DO NOTHING`, company); err != nil {
		return err
	}
	var allowed bool
	if err := tx.QueryRow(ctx, `SELECT s.mode='all_recruiters'
 OR EXISTS(SELECT 1 FROM company_members m WHERE m.company_id=s.company_id AND m.user_id=$2 AND m.role='owner')
 OR EXISTS(SELECT 1 FROM company_talent_base_viewers v WHERE v.company_id=s.company_id AND v.user_id=$2)
 FROM company_talent_base_settings s WHERE s.company_id=$1 FOR SHARE OF s`, company, actor).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return companies.ErrTalentBaseRestricted
	}
	return nil
}
