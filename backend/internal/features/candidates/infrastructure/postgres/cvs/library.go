package cvs

import (
	"context"
	"errors"
	"io"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StorageLock is shared by uploads and exclusively held by the
// reconciler. It is database-wide, protecting file-first writes across instances.
const StorageLock int64 = 75210410021

type Library struct {
	pool    *pgxpool.Pool
	storage app.Storage
}

func NewLibrary(pool *pgxpool.Pool, storage app.Storage) *Library { return &Library{pool, storage} }

var _ app.Library = (*Library)(nil)

func candidate(ctx context.Context, tx pgx.Tx, subject string) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1 AND deleted_at IS NULL AND user_type='candidate' FOR UPDATE`, subject).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, app.ErrNotFound
	}
	return id, err
}

const viewSQL = `SELECT l.id,l.name,v.size,v.content_type,v.uploaded_at,EXISTS(SELECT 1 FROM process_participations p WHERE p.cv_version_id=v.id) FROM candidate_cv_library l JOIN candidate_cv_versions v ON v.id=l.version_id `

func readCV(row pgx.Row) (app.CV, error) {
	var c app.CV
	err := row.Scan(&c.ID, &c.Name, &c.Size, &c.ContentType, &c.UploadedAt, &c.InUse)
	c.UploadedAt = c.UploadedAt.UTC()
	return c, err
}
func (s *Library) begin(ctx context.Context, sub string) (pgx.Tx, uuid.UUID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, uuid.Nil, err
	}
	id, err := candidate(ctx, tx, sub)
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, uuid.Nil, err
	}
	return tx, id, nil
}
func (s *Library) List(ctx context.Context, sub string) ([]app.CV, error) {
	tx, id, err := s.begin(ctx, sub)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, viewSQL+`WHERE l.candidate_id=$1 AND l.removed_at IS NULL ORDER BY v.uploaded_at DESC,l.id DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []app.CV{}
	for rows.Next() {
		c, err := readCV(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Library) Upload(ctx context.Context, sub, name, filename string, data []byte) (app.CV, error) {
	name, err := app.NormalizeName(name)
	if err != nil {
		return app.CV{}, err
	}
	typ, err := app.Inspect(filename, data)
	if err != nil {
		return app.CV{}, err
	}
	tx, actor, err := s.begin(ctx, sub)
	if err != nil {
		return app.CV{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared($1)`, StorageLock); err != nil {
		return app.CV{}, err
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM candidate_cv_library WHERE candidate_id=$1 AND removed_at IS NULL`, actor).Scan(&count); err != nil {
		return app.CV{}, err
	}
	if count >= app.MaxCVs {
		return app.CV{}, app.ErrLibraryFull
	}
	key, err := s.storage.Put(ctx, data)
	if err != nil {
		return app.CV{}, err
	}
	// On ordinary row-write failure remove the private object even if the
	// request was cancelled. An uncertain commit is reconciled, never guessed.
	cleanup := true
	defer func() {
		if cleanup {
			_ = s.storage.Delete(context.WithoutCancel(ctx), key)
		}
	}()
	id := uuid.New()
	version := uuid.New()
	if _, err = tx.Exec(ctx, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,$4,$5)`, version, actor, key, len(data), typ); err != nil {
		return app.CV{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO candidate_cv_library(id,candidate_id,version_id,name) VALUES($1,$2,$3,$4)`, id, actor, version, name); err != nil {
		return app.CV{}, err
	}
	c, err := readCV(tx.QueryRow(ctx, viewSQL+`WHERE l.id=$1`, id))
	if err != nil {
		return app.CV{}, err
	}
	cleanup = false
	if err = tx.Commit(ctx); err != nil {
		return app.CV{}, err
	}
	return c, nil
}
func (s *Library) Rename(ctx context.Context, sub string, id uuid.UUID, name string) (app.CV, error) {
	name, err := app.NormalizeName(name)
	if err != nil {
		return app.CV{}, err
	}
	tx, actor, err := s.begin(ctx, sub)
	if err != nil {
		return app.CV{}, err
	}
	defer tx.Rollback(ctx)
	tag, err := tx.Exec(ctx, `UPDATE candidate_cv_library SET name=$3 WHERE id=$1 AND candidate_id=$2 AND removed_at IS NULL`, id, actor, name)
	if err != nil {
		return app.CV{}, err
	}
	if tag.RowsAffected() == 0 {
		return app.CV{}, app.ErrNotFound
	}
	c, err := readCV(tx.QueryRow(ctx, viewSQL+`WHERE l.id=$1`, id))
	if err != nil {
		return app.CV{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return app.CV{}, err
	}
	return c, nil
}
func (s *Library) Remove(ctx context.Context, sub string, id uuid.UUID) error {
	tx, actor, err := s.begin(ctx, sub)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var key string
	var used bool
	err = tx.QueryRow(ctx, `SELECT v.storage_key,EXISTS(SELECT 1 FROM process_participations p WHERE p.cv_version_id=v.id) FROM candidate_cv_library l JOIN candidate_cv_versions v ON v.id=l.version_id WHERE l.id=$1 AND l.candidate_id=$2 AND l.removed_at IS NULL FOR UPDATE OF l`, id, actor).Scan(&key, &used)
	if errors.Is(err, pgx.ErrNoRows) {
		return app.ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE candidate_cv_library SET removed_at=now() WHERE id=$1`, id); err != nil {
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return err
	}
	if !used {
		return s.storage.Delete(context.WithoutCancel(ctx), key)
	}
	return nil
}
func (s *Library) File(ctx context.Context, sub string, id uuid.UUID) (app.CV, io.ReadCloser, error) {
	tx, actor, err := s.begin(ctx, sub)
	if err != nil {
		return app.CV{}, nil, err
	}
	defer tx.Rollback(ctx)
	c, err := readCV(tx.QueryRow(ctx, viewSQL+`WHERE l.id=$1 AND l.candidate_id=$2 AND l.removed_at IS NULL`, id, actor))
	if errors.Is(err, pgx.ErrNoRows) {
		return app.CV{}, nil, app.ErrNotFound
	}
	if err != nil {
		return app.CV{}, nil, err
	}
	var key string
	if err = tx.QueryRow(ctx, `SELECT v.storage_key FROM candidate_cv_versions v JOIN candidate_cv_library l ON l.version_id=v.id WHERE l.id=$1`, id).Scan(&key); err != nil {
		return app.CV{}, nil, err
	}
	f, err := s.storage.Open(ctx, key)
	return c, f, err
}

// Reconcile removes both true orphans and files of removed, unused entries.
// A failed lookup fails closed. Used versions survive removal indefinitely.
func (s *Library) Reconcile(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, StorageLock); err != nil {
		return err
	}
	return app.ReconcileOrphans(ctx, s.storage, func(ctx context.Context, key string) (bool, error) {
		var keep bool
		err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM candidate_cv_versions v WHERE v.storage_key=$1 AND (EXISTS(SELECT 1 FROM candidate_cv_library l WHERE l.version_id=v.id AND l.removed_at IS NULL) OR EXISTS(SELECT 1 FROM process_participations p WHERE p.cv_version_id=v.id)))`, key).Scan(&keep)
		return keep, err
	})
}
