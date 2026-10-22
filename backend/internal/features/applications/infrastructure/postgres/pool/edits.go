package pool

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/pool"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var _ app.Editor = (*Store)(nil)

// Lock first, then compare the version under READ COMMITTED. A waiter observes
// the winner's committed version, so identical If-Match requests cannot both win.
func (s *Store) Edit(ctx context.Context, company, actor, id uuid.UUID, etag string, body []byte) (app.Detail, error) {
	var out app.Detail
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	var version int64
	err = tx.QueryRow(ctx, `SELECT version FROM company_candidates WHERE company_id=$1 AND id=$2 FOR UPDATE`, company, id).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, board.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if etag != app.ETag("manual", id, version) {
		return out, app.ErrPreconditionFailed
	}
	set, err := board.ParseManualEdit(body)
	if err != nil {
		return out, err
	}
	var raw []byte
	if err = tx.QueryRow(ctx, manualValuesSQL, company, id).Scan(&raw); err != nil {
		return out, err
	}
	before := map[string]json.RawMessage{}
	if err = json.Unmarshal(raw, &before); err != nil {
		return out, err
	}
	after, changes, candidate, err := app.PrepareManualEdit(ctx, editGeoLookup{db.New(tx)}, before, set)
	if err != nil {
		return out, err
	}
	if len(changes) > 0 {
		raw, err = json.Marshal(after)
		if err != nil {
			return out, err
		}
		if _, err = tx.Exec(ctx, updateManualSQL, company, id, actor, raw); err != nil {
			return out, err
		}
		if _, changed := set["education"]; changed {
			if err = replaceEducation(ctx, tx, id, candidate); err != nil {
				return out, err
			}
		}
		if _, changed := set["languages"]; changed {
			if err = replaceLanguages(ctx, tx, id, candidate); err != nil {
				return out, err
			}
		}
		if err = recordEdit(ctx, tx, company, actor, id, "manual", changes); err != nil {
			return out, err
		}
	}
	out, err = s.detail(ctx, tx, company, "manual", id)
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}

func replaceEducation(ctx context.Context, tx pgx.Tx, id uuid.UUID, c *board.ManualCandidate) error {
	if _, err := tx.Exec(ctx, `DELETE FROM company_candidate_educations WHERE company_candidate_id=$1`, id); err != nil {
		return err
	}
	for i, e := range c.Education {
		if _, err := tx.Exec(ctx, `INSERT INTO company_candidate_educations(company_candidate_id,position,level,institution,field,status,start_year,end_year) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, i, e.Level, e.Institution, e.Field, e.Status, e.StartYear, e.EndYear); err != nil {
			return err
		}
	}
	return nil
}
func replaceLanguages(ctx context.Context, tx pgx.Tx, id uuid.UUID, c *board.ManualCandidate) error {
	if _, err := tx.Exec(ctx, `DELETE FROM company_candidate_languages WHERE company_candidate_id=$1`, id); err != nil {
		return err
	}
	for _, l := range c.Languages {
		if _, err := tx.Exec(ctx, `INSERT INTO company_candidate_languages(company_candidate_id,code,level) VALUES($1,$2,$3)`, id, l.Code, l.Level); err != nil {
			return err
		}
	}
	return nil
}

const manualValuesSQL = `SELECT jsonb_build_object(
 'full_name',cc.full_name,'email',cc.email,'phone',cc.phone,
 'location',jsonb_build_object('country',cc.country_code,'state',cc.state_code,'municipality',cc.municipality_code,'postal_code',cc.postal_code),
 'professional_title',cc.professional_title,'current_company',cc.current_company,'seniority',cc.seniority,
 'years_of_experience',trim_scale(cc.years_of_experience)::text,'skills',cc.skills,'linkedin_url',cc.linkedin_url,'portfolio_url',cc.portfolio_url,
 'education',COALESCE((SELECT jsonb_agg(jsonb_build_object('level',e.level,'institution',e.institution,'field',e.field,'status',e.status,'start_year',e.start_year,'end_year',e.end_year) ORDER BY e.position,e.id) FROM company_candidate_educations e WHERE e.company_candidate_id=cc.id),'[]'::jsonb),
 'languages',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.code,'level',l.level) ORDER BY l.code) FROM company_candidate_languages l WHERE l.company_candidate_id=cc.id),'[]'::jsonb))
 FROM company_candidates cc WHERE cc.company_id=$1 AND cc.id=$2`

const updateManualSQL = `UPDATE company_candidates SET
 full_name=$4::jsonb->>'full_name',email=$4::jsonb->>'email',email_normalized=lower(btrim($4::jsonb->>'email')),phone=$4::jsonb->>'phone',
 country_code=$4::jsonb#>>'{location,country}',state_code=$4::jsonb#>>'{location,state}',municipality_code=$4::jsonb#>>'{location,municipality}',postal_code=$4::jsonb#>>'{location,postal_code}',
 professional_title=$4::jsonb->>'professional_title',current_company=$4::jsonb->>'current_company',seniority=$4::jsonb->>'seniority',years_of_experience=($4::jsonb->>'years_of_experience')::numeric,
 skills=ARRAY(SELECT jsonb_array_elements_text($4::jsonb->'skills')),linkedin_url=$4::jsonb->>'linkedin_url',portfolio_url=$4::jsonb->>'portfolio_url',
 version=version+1,updated_at=clock_timestamp(),updated_by=$3 WHERE company_id=$1 AND id=$2`
