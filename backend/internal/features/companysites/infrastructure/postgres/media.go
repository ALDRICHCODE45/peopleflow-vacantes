package postgres

import (
	"context"
	"errors"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) InsertMedia(ctx context.Context, company, user uuid.UUID, m app.StoredMedia, data []byte, storage app.Storage) (result app.StoredMedia, retErr error) {
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
	if count >= 300 {
		return m, app.ErrMediaLimit
	}
	key, err := storage.Put(ctx, data)
	if err != nil {
		return m, err
	}
	committed := false
	// Cleanup must survive client cancellation; a failed cleanup is surfaced rather than hidden.
	defer func() {
		if !committed {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			retErr = errors.Join(retErr, storage.Delete(cleanup, key))
		}
	}()
	m.ID = uuid.New()
	m.URL = "/v2/company-sites/media/" + m.ID.String()
	m.StorageKey = key
	m.ByteSize = int64(len(data))
	_, err = tx.Exec(ctx, `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, m.ID, company, m.Kind, key, m.ContentType, m.Width, m.Height, m.ByteSize, user)
	if err != nil {
		return m, err
	}
	err = tx.Commit(ctx)
	committed = err == nil
	return m, err
}
func (s *Store) FindMedia(ctx context.Context, id uuid.UUID) (app.StoredMedia, error) {
	var m app.StoredMedia
	err := s.pool.QueryRow(ctx, `SELECT id,kind,storage_key,content_type,width,height,byte_size FROM company_site_media WHERE id=$1`, id).Scan(&m.ID, &m.Kind, &m.StorageKey, &m.ContentType, &m.Width, &m.Height, &m.ByteSize)
	if errors.Is(err, pgx.ErrNoRows) {
		err = app.ErrMediaNotFound
	}
	return m, err
}
