package postgres

import (
	"context"
	"errors"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
	"github.com/jackc/pgx/v5"
)

var _ app.PublicReader = (*Store)(nil)

func (s *Store) Public(ctx context.Context, slug string) (app.PublicSnapshot, error) {
	var out app.PublicSnapshot
	// A single statement resolves current ownership before history. A draft claim
	// drops history on save; never infer ownership from draft_slug here.
	var snapshot []byte
	err := s.pool.QueryRow(ctx, `SELECT s.company_id,s.published,s.published_slug,s.published_at
 FROM company_sites s JOIN companies c ON c.id=s.company_id
 WHERE s.published IS NOT NULL AND c.deleted_at IS NULL AND c.status='active'
 AND s.company_id = COALESCE(
  (SELECT company_id FROM company_sites WHERE published_slug=$1 AND published IS NOT NULL),
  (SELECT company_id FROM company_site_slug_history WHERE slug=$1))`, slug).Scan(&out.CompanyID, &snapshot, &out.Slug, &out.PublishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, app.ErrSiteNotFound
	}
	if err != nil {
		return out, err
	}
	value, err := s.decode(snapshot)
	if err != nil {
		return out, err
	}
	doc, err := s.validator.VisibleDocument(value)
	if err != nil {
		return out, err
	}
	out.Site = doc.Canonical
	out.PublishedAt = out.PublishedAt.UTC()
	out.Media = []app.Media{}
	seen := map[string]bool{}
	for _, ref := range doc.Media {
		if seen[ref.ID] {
			continue
		}
		seen[ref.ID] = true
		var m app.Media
		err = s.pool.QueryRow(ctx, `SELECT id,kind,width,height FROM company_site_media WHERE id=$1 AND company_id=$2 AND kind=$3`, ref.ID, out.CompanyID, ref.Kind).Scan(&m.ID, &m.Kind, &m.Width, &m.Height)
		if err != nil {
			return out, err
		}
		m.URL = "/v2/company-sites/media/" + m.ID.String()
		out.Media = append(out.Media, m)
	}
	return out, nil
}
