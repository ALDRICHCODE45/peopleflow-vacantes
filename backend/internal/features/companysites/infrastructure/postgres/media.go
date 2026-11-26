package postgres

import (
	"context"
	"errors"
	"io"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const maxMediaPerCompany = 300

// InsertMedia stores an image under the company lock: lock, count, Put, row.
func (s *Store) InsertMedia(ctx context.Context, company, user uuid.UUID, m app.StoredMedia, data []byte, storage app.Storage) (app.StoredMedia, error) {
	return s.insertMedia(ctx, company, user, m, int64(len(data)), storage, "", func(ctx context.Context) (string, error) { return storage.Put(ctx, data) })
}

// InsertMediaStream stores a hero video file-first: the (slow) upload runs
// before the transaction so the company row is never locked while bytes move,
// then the row is written under the same lock and quota as images. A quota hit
// or any later failure deletes the stored object.
func (s *Store) InsertMediaStream(ctx context.Context, company, user uuid.UUID, m app.StoredMedia, body io.ReadSeeker, size int64, storage app.Storage) (app.StoredMedia, error) {
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, company).Scan(&count); err != nil {
		return m, err
	}
	if count >= maxMediaPerCompany {
		return m, app.ErrMediaLimit
	}
	key, err := storage.PutStream(ctx, body, size)
	if err != nil {
		return m, err
	}
	return s.insertMedia(ctx, company, user, m, size, storage, key, nil)
}

// insertMedia writes the row; put (when non-nil) stores the bytes after the
// lock and count. Whatever key was stored is deleted unless the row commits.
func (s *Store) insertMedia(ctx context.Context, company, user uuid.UUID, m app.StoredMedia, size int64, storage app.Storage, key string, put func(context.Context) (string, error)) (result app.StoredMedia, retErr error) {
	committed := false
	// Cleanup must survive client cancellation; a failed cleanup is surfaced rather than hidden.
	defer func() {
		if !committed && key != "" {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			retErr = errors.Join(retErr, storage.Delete(cleanup, key))
		}
	}()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return m, err
	}
	defer tx.Rollback(ctx)
	if err = ensure(ctx, tx, company, user); err != nil {
		return m, err
	}
	var locked uuid.UUID
	if err = tx.QueryRow(ctx, `SELECT company_id FROM company_sites WHERE company_id=$1 FOR UPDATE`, company).Scan(&locked); err != nil {
		return m, err
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM company_site_media WHERE company_id=$1`, company).Scan(&count); err != nil {
		return m, err
	}
	if count >= maxMediaPerCompany {
		return m, app.ErrMediaLimit
	}
	if put != nil {
		if key, err = put(ctx); err != nil {
			key = ""
			return m, err
		}
	}
	m.ID = uuid.New()
	m.URL = "/v2/company-sites/media/" + m.ID.String()
	m.StorageKey = key
	m.ByteSize = size
	_, err = tx.Exec(ctx, `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,duration_ms,byte_size,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, m.ID, company, m.Kind, key, m.ContentType, m.Width, m.Height, m.DurationMS, m.ByteSize, user)
	if err != nil {
		return m, err
	}
	err = tx.Commit(ctx)
	committed = err == nil
	return m, err
}
func (s *Store) FindMedia(ctx context.Context, id uuid.UUID) (app.StoredMedia, error) {
	var m app.StoredMedia
	err := s.pool.QueryRow(ctx, `SELECT id,kind,storage_key,content_type,width,height,duration_ms,byte_size FROM company_site_media WHERE id=$1`, id).Scan(&m.ID, &m.Kind, &m.StorageKey, &m.ContentType, &m.Width, &m.Height, &m.DurationMS, &m.ByteSize)
	if errors.Is(err, pgx.ErrNoRows) {
		err = app.ErrMediaNotFound
	}
	return m, err
}
