// Package savedjobs implements the private saved catalog using pgx transactions.
package savedjobs

import (
	"context"
	"encoding/json"
	"errors"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/savedjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ pool *pgxpool.Pool }

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

var _ app.Store = (*Store)(nil)

func (s *Store) begin(ctx context.Context, subject string, lock bool) (pgx.Tx, uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, uuid.Nil, err
	}
	query := `SELECT id FROM users WHERE cognito_sub=$1 AND deleted_at IS NULL AND user_type='candidate'`
	if lock {
		query += ` FOR UPDATE`
	}
	var actor uuid.UUID
	if err = tx.QueryRow(ctx, query, subject).Scan(&actor); err != nil {
		_ = tx.Rollback(ctx)
		if errors.Is(err, pgx.ErrNoRows) {
			err = app.ErrNotFound
		}
		return nil, uuid.Nil, err
	}
	return tx, actor, nil
}
func readSaved(row pgx.Row) (app.Saved, error) {
	var out app.Saved
	err := row.Scan(&out.JobID, &out.SavedAt)
	out.SavedAt = out.SavedAt.UTC()
	return out, err
}
func (s *Store) Save(ctx context.Context, subject string, id uuid.UUID) (app.Saved, bool, error) {
	tx, actor, err := s.begin(ctx, subject, true)
	if err != nil {
		return app.Saved{}, false, err
	}
	defer tx.Rollback(ctx)
	// The candidate row lock serializes count + insert across all API instances.
	// Replay precedes target visibility and the cap, preserving the original time.
	saved, err := readSaved(tx.QueryRow(ctx, `SELECT job_id,saved_at FROM saved_jobs WHERE candidate_id=$1 AND job_id=$2`, actor, id))
	if err == nil {
		return saved, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return app.Saved{}, false, err
	}
	var source, status string
	err = tx.QueryRow(ctx, `SELECT 'vacancy',v.status FROM vacancy_processes v JOIN vacancy_public_projections p ON p.id=v.id AND p.company_id=v.company_id JOIN companies c ON c.id=v.company_id WHERE v.id=$1 AND v.status IN ('published','paused','closed') AND c.status='active' AND c.deleted_at IS NULL
 UNION ALL SELECT 'legacy',j.status FROM jobs j JOIN companies c ON c.id=j.company_id WHERE j.id=$1 AND j.status='published' AND j.deleted_at IS NULL AND j.published_at IS NOT NULL AND c.status='active' AND c.deleted_at IS NULL`, id).Scan(&source, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.Saved{}, false, app.ErrNotFound
	}
	if err != nil {
		return app.Saved{}, false, err
	}
	if status != "published" {
		return app.Saved{}, false, app.ErrUnavailable
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM saved_jobs WHERE candidate_id=$1`, actor).Scan(&count); err != nil {
		return app.Saved{}, false, err
	}
	if count >= app.MaxSaved {
		return app.Saved{}, false, app.ErrLimit
	}
	var process, legacy *uuid.UUID
	if source == "vacancy" {
		process = &id
	} else {
		legacy = &id
	}
	saved, err = readSaved(tx.QueryRow(ctx, `INSERT INTO saved_jobs(candidate_id,process_id,legacy_job_id) VALUES($1,$2,$3) RETURNING job_id,saved_at`, actor, process, legacy))
	if err != nil {
		return app.Saved{}, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return app.Saved{}, false, err
	}
	return saved, true, nil
}

// Both listing and bulk removal use the same instantaneous availability rule.
// Snapshot expressions mirror db/queries/public_jobs.sql, without visibility
// filters: unavailable saved jobs retain enough public metadata to recognize them.
const catalogSQL = `WITH catalog AS (
 SELECT s.job_id,s.saved_at,
 (v.status='published' AND c.status='active' AND c.deleted_at IS NULL) AS is_open,
 CASE WHEN c.status<>'active' OR c.deleted_at IS NOT NULL THEN NULL WHEN v.status='closed' THEN v.closed_at WHEN v.status='paused' THEN v.paused_at ELSE NULL END AS closed_at,
 CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id',a.id,'applied_at',a.created_at) END AS application,
 jsonb_build_object('source','vacancy','title',p.title,'company',jsonb_build_object('id',c.id,'name',c.name,'logo_url',c.logo_url),
 'location_label',COALESCE(gm.name || ', ' || gs.name,gs.name,gc.name_es),'work_mode',p.work_mode,'compensation',p.compensation,'legacy_salary',NULL,'published_at',p.published_at) AS job
 FROM saved_jobs s JOIN vacancy_processes v ON v.id=s.process_id
 JOIN vacancy_public_projections p ON p.id=v.id AND p.company_id=v.company_id JOIN companies c ON c.id=v.company_id
 LEFT JOIN geo_countries gc ON gc.code=p.country_code
 LEFT JOIN geo_states gs ON gs.country_code=p.country_code AND gs.code=p.state_code
 LEFT JOIN geo_municipalities gm ON gm.country_code=p.country_code AND gm.code=p.municipality_code
 LEFT JOIN process_participations a ON a.process_id=v.id AND a.candidate_id=s.candidate_id
 WHERE s.candidate_id=$1
 UNION ALL
 SELECT s.job_id,s.saved_at,
 (j.status='published' AND j.deleted_at IS NULL AND c.status='active' AND c.deleted_at IS NULL),
 j.deleted_at,NULL::jsonb,
 jsonb_build_object('source','legacy','title',j.title,'company',jsonb_build_object('id',c.id,'name',c.name,'logo_url',c.logo_url),
 'location_label',j.location,'work_mode',j.work_mode,'compensation',NULL,
 'legacy_salary',CASE WHEN j.salary_min IS NULL AND j.salary_max IS NULL THEN NULL ELSE jsonb_build_object('min',CASE WHEN j.salary_min IS NULL THEN NULL ELSE j.salary_min::text || '.00' END,'max',CASE WHEN j.salary_max IS NULL THEN NULL ELSE j.salary_max::text || '.00' END,'currency',j.salary_currency) END,'published_at',j.published_at)
 FROM saved_jobs s JOIN jobs j ON j.id=s.legacy_job_id JOIN companies c ON c.id=j.company_id WHERE s.candidate_id=$1
) `

func (s *Store) List(ctx context.Context, subject string) (app.Page, error) {
	tx, actor, err := s.begin(ctx, subject, false)
	if err != nil {
		return app.Page{}, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, catalogSQL+`SELECT jsonb_build_object('job_id',job_id,'saved_at',saved_at,'availability',CASE WHEN is_open THEN 'open' ELSE 'closed' END,'closed_at',closed_at,'application',application,'job',job) FROM catalog ORDER BY saved_at DESC,job_id ASC`, actor)
	if err != nil {
		return app.Page{}, err
	}
	defer rows.Close()
	page := app.Page{Items: []app.Item{}, Limit: app.MaxSaved}
	for rows.Next() {
		var raw []byte
		var item app.Item
		if err = rows.Scan(&raw); err != nil {
			return app.Page{}, err
		}
		if err = json.Unmarshal(raw, &item); err != nil {
			return app.Page{}, err
		}
		item.SavedAt = item.SavedAt.UTC()
		item.Job.PublishedAt = item.Job.PublishedAt.UTC()
		if item.ClosedAt != nil {
			v := item.ClosedAt.UTC()
			item.ClosedAt = &v
		}
		if item.Application != nil {
			item.Application.AppliedAt = item.Application.AppliedAt.UTC()
		}
		page.Items = append(page.Items, item)
	}
	page.Total = len(page.Items)
	return page, rows.Err()
}
func (s *Store) IDs(ctx context.Context, subject string) ([]uuid.UUID, error) {
	tx, actor, err := s.begin(ctx, subject, false)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT job_id FROM saved_jobs WHERE candidate_id=$1 ORDER BY saved_at DESC,job_id ASC`, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
func (s *Store) Remove(ctx context.Context, subject string, id uuid.UUID) error {
	tx, actor, err := s.begin(ctx, subject, false)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM saved_jobs WHERE candidate_id=$1 AND job_id=$2`, actor, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) RemoveClosed(ctx context.Context, subject string) (int, error) {
	tx, actor, err := s.begin(ctx, subject, false)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, catalogSQL+`DELETE FROM saved_jobs s USING catalog c WHERE s.candidate_id=$1 AND s.job_id=c.job_id AND NOT c.is_open`, actor)
	if err != nil {
		return 0, err
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
