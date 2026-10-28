package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	pool      *pgxpool.Pool
	decode    app.Decode
	validator *app.Validator
	lookup    geo.Lookup
	audit     auditrepo.AuditEventRepository
}

func New(pool *pgxpool.Pool, decode app.Decode, validator *app.Validator, lookup geo.Lookup, events auditrepo.AuditEventRepository) *Store {
	return &Store{pool: pool, decode: decode, validator: validator, lookup: lookup, audit: events}
}

var _ app.Store = (*Store)(nil)

func (s *Store) Publish(ctx context.Context, company, user uuid.UUID, version int64) (app.Current, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Current{}, err
	}
	defer tx.Rollback(ctx)
	if err = ensure(ctx, tx, company, user); err != nil {
		return app.Current{}, err
	}
	current, err := s.read(ctx, tx, company)
	if err != nil {
		return current, err
	}
	if current.DraftVersion != version {
		return current, app.ErrVersionConflict
	}
	doc, err := s.storedDocument(current.Draft)
	if err != nil {
		return current, err
	}
	var logo, name bool
	if err = tx.QueryRow(ctx, `SELECT COALESCE(btrim(logo_url),'')<>'', btrim(name)<>'' FROM companies WHERE id=$1 FOR SHARE`, company).Scan(&logo, &name); err != nil {
		return current, err
	}
	if issues := app.PublishIssues(doc, logo, name); len(issues) > 0 {
		return current, &app.PublishBlocked{Issues: issues}
	}
	slug := doc.Value["slug"].(string)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, slug); err != nil {
		return current, err
	}
	ok, err := available(ctx, tx, company, slug)
	if err != nil {
		return current, err
	}
	if !ok {
		return current, app.ErrSlugTaken
	}
	if current.Published != nil && current.Published.Slug != slug {
		if _, err = tx.Exec(ctx, `INSERT INTO company_site_slug_history(slug,company_id) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET company_id=EXCLUDED.company_id,retired_at=clock_timestamp()`, current.Published.Slug, company); err != nil {
			return current, err
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM company_site_slug_history WHERE slug=$1`, slug); err != nil {
		return current, err
	}
	if _, err = tx.Exec(ctx, `UPDATE company_sites SET published=draft,published_version=draft_version,published_slug=draft_slug,published_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=$2 WHERE company_id=$1`, company, user); err != nil {
		return current, err
	}
	if err = s.appendEvent(ctx, tx, company, user, audit.EventCompanySitePublished, version); err != nil {
		return current, err
	}
	out, err := s.read(ctx, tx, company)
	if err != nil {
		return current, err
	}
	return out, tx.Commit(ctx)
}

func (s *Store) Unpublish(ctx context.Context, company, user uuid.UUID) (app.Current, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Current{}, err
	}
	defer tx.Rollback(ctx)
	if err = ensure(ctx, tx, company, user); err != nil {
		return app.Current{}, err
	}
	current, err := s.read(ctx, tx, company)
	if err != nil {
		return current, err
	}
	if current.Published == nil {
		return current, tx.Commit(ctx)
	}
	if _, err = tx.Exec(ctx, `UPDATE company_sites SET published=NULL,published_version=NULL,published_slug=NULL,published_at=NULL,updated_at=clock_timestamp(),updated_by=$2 WHERE company_id=$1`, company, user); err != nil {
		return current, err
	}
	if err = s.appendEvent(ctx, tx, company, user, audit.EventCompanySiteUnpublished, current.Published.Version); err != nil {
		return current, err
	}
	out, err := s.read(ctx, tx, company)
	if err != nil {
		return current, err
	}
	return out, tx.Commit(ctx)
}

func (s *Store) appendEvent(ctx context.Context, tx pgx.Tx, company, user uuid.UUID, kind string, version int64) error {
	return s.audit.Append(ctx, tx, audit.AuditEvent{ID: uuid.New(), ActorType: audit.ActorTypeUser, ActorID: &user, EventType: kind, EntityType: audit.EntityCompanySite, EntityID: company, Metadata: map[string]string{"version": strconv.FormatInt(version, 10)}})
}

func ensure(ctx context.Context, tx pgx.Tx, company, user uuid.UUID) error {
	_, err := tx.Exec(ctx, `INSERT INTO company_sites(company_id,draft,updated_by) VALUES($1,$2,$3) ON CONFLICT(company_id) DO NOTHING`, company, app.DefaultDocument(), user)
	return err
}
func (s *Store) read(ctx context.Context, tx pgx.Tx, company uuid.UUID) (app.Current, error) {
	var out app.Current
	var published []byte
	var version *int64
	var slug *string
	var at *time.Time
	err := tx.QueryRow(ctx, `SELECT draft,draft_version,published,published_version,published_slug,published_at,updated_at FROM company_sites WHERE company_id=$1 FOR UPDATE`, company).Scan(&out.Draft, &out.DraftVersion, &published, &version, &slug, &at, &out.UpdatedAt)
	if err != nil {
		return out, err
	}
	if version != nil {
		out.Published = &app.Published{Version: *version, Slug: *slug, PublishedAt: *at}
	}
	out.HasUnpublishedChanges = len(published) == 0 || !equalJSON(out.Draft, published)
	doc, err := s.storedDocument(out.Draft)
	if err != nil {
		return out, err
	}
	out.Draft = doc.Canonical
	out.Media = []app.Media{}
	seen := map[string]bool{}
	for _, ref := range doc.Media {
		if seen[ref.ID] {
			continue
		}
		seen[ref.ID] = true
		var m app.Media
		err := tx.QueryRow(ctx, `SELECT id,kind,width,height FROM company_site_media WHERE id=$1 AND company_id=$2`, ref.ID, company).Scan(&m.ID, &m.Kind, &m.Width, &m.Height)
		if err != nil {
			return out, err
		}
		m.URL = "/v2/company-sites/media/" + m.ID.String()
		out.Media = append(out.Media, m)
	}
	return out, nil
}

// storedDocument is shared by draft reads and publish preflight.
func (s *Store) storedDocument(raw []byte) (*app.Document, error) {
	value, err := s.decode(raw)
	if err != nil {
		return nil, err
	}
	doc, fields := s.validator.ValidateStoredDocument(value)
	if len(fields) > 0 {
		return nil, fmt.Errorf("stored site document invalid")
	}
	return doc, nil
}

func equalJSON(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	ac, _ := json.Marshal(x)
	bc, _ := json.Marshal(y)
	return bytes.Equal(ac, bc)
}
func (s *Store) Get(ctx context.Context, company, user uuid.UUID) (app.Current, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Current{}, err
	}
	defer tx.Rollback(ctx)
	if err = ensure(ctx, tx, company, user); err != nil {
		return app.Current{}, err
	}
	out, err := s.read(ctx, tx, company)
	if err != nil {
		return out, err
	}
	return out, tx.Commit(ctx)
}
func available(ctx context.Context, tx pgx.Tx, company uuid.UUID, slug string) (bool, error) {
	var taken bool
	err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_sites WHERE company_id<>$1 AND (draft_slug=$2 OR published_slug=$2))`, company, slug).Scan(&taken)
	return !taken, err
}
func (s *Store) SlugAvailable(ctx context.Context, company uuid.UUID, slug string) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	ok, err := available(ctx, tx, company, slug)
	if err != nil {
		return false, err
	}
	return ok, tx.Commit(ctx)
}
func (s *Store) Save(ctx context.Context, company, user uuid.UUID, version int64, doc *app.Document) (app.Current, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return app.Current{}, err
	}
	defer tx.Rollback(ctx)
	if err = ensure(ctx, tx, company, user); err != nil {
		return app.Current{}, err
	}
	current, err := s.read(ctx, tx, company)
	if err != nil {
		return current, err
	}
	if current.DraftVersion != version {
		return current, app.ErrVersionConflict
	}
	fields := []app.Field{}
	for _, ref := range doc.Media {
		var ok bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM company_site_media WHERE id=$1 AND company_id=$2 AND kind=$3)`, ref.ID, company, ref.Kind).Scan(&ok)
		if err != nil {
			return current, err
		}
		if !ok {
			fields = append(fields, app.Field{Field: ref.Field, Code: "invalid"})
		}
	}
	for _, ref := range doc.Locations {
		raw, err := json.Marshal(ref.Value)
		if err != nil {
			return current, err
		} // Optional null keys are omitted for LocationInput's code-only shape.
		var codes map[string]any
		if err = json.Unmarshal(raw, &codes); err != nil {
			return current, err
		}
		for k, v := range codes {
			if v == nil {
				delete(codes, k)
			}
		}
		raw, err = json.Marshal(codes)
		if err != nil {
			return current, err
		}
		var location geo.LocationInput
		if err = json.Unmarshal(raw, &location); err != nil {
			fields = append(fields, app.Field{Field: ref.Field, Code: "invalid"})
			continue
		}
		if err = geo.ValidateLocation(ctx, s.lookup, &location, true); err != nil {
			var invalid *geo.InvalidLocation
			if !errors.As(err, &invalid) {
				return current, err
			}
			for _, d := range invalid.Details {
				code := d.Reason
				if code != "required" && code != "not_allowed" {
					code = "invalid"
				}
				fields = append(fields, app.Field{Field: ref.Field + strings.TrimPrefix(d.Field, "location"), Code: code})
			}
		}
	}
	if len(fields) > 0 {
		return current, &app.InvalidFields{Fields: fields}
	}
	var slug *string
	if value, ok := doc.Value["slug"].(string); ok {
		slug = &value
		// All future published-slug claims must use the same advisory namespace.
		if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, value); err != nil {
			return current, err
		}
		ok, err := available(ctx, tx, company, value)
		if err != nil {
			return current, err
		}
		if !ok {
			return current, app.ErrSlugTaken
		}
	}
	if equalJSON(current.Draft, doc.Canonical) {
		return current, tx.Commit(ctx)
	}
	if slug != nil {
		if _, err = tx.Exec(ctx, `DELETE FROM company_site_slug_history WHERE slug=$1`, *slug); err != nil {
			return current, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE company_sites SET draft=$2,draft_slug=$3,draft_version=draft_version+1,updated_at=clock_timestamp(),updated_by=$4 WHERE company_id=$1`, company, doc.Canonical, slug, user)
	if err != nil {
		return current, err
	}
	out, err := s.read(ctx, tx, company)
	if err != nil {
		return current, err
	}
	return out, tx.Commit(ctx)
}
