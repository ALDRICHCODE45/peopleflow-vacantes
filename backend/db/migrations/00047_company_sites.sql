-- +goose Up
-- +goose StatementBegin
CREATE TABLE company_sites (
 company_id UUID PRIMARY KEY REFERENCES companies(id),
 draft JSONB NOT NULL CHECK (jsonb_typeof(draft)='object'),
 draft_version BIGINT NOT NULL DEFAULT 1 CHECK (draft_version >= 1),
 draft_slug TEXT UNIQUE,
 published JSONB CHECK (published IS NULL OR jsonb_typeof(published)='object'),
 published_version BIGINT CHECK (published_version >= 1),
 published_slug TEXT UNIQUE,
 published_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_by UUID NOT NULL REFERENCES users(id),
 CHECK ((published IS NULL AND published_version IS NULL AND published_slug IS NULL AND published_at IS NULL)
 OR (published IS NOT NULL AND published_version IS NOT NULL AND published_slug IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE company_site_slug_history (
 slug TEXT PRIMARY KEY,
 company_id UUID NOT NULL REFERENCES company_sites(company_id),
 retired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX company_site_slug_history_company_idx ON company_site_slug_history(company_id);
CREATE TABLE company_site_media (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id UUID NOT NULL REFERENCES companies(id),
 kind TEXT NOT NULL CHECK (kind IN ('cover','gallery','portrait','story')),
 storage_key TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
 width INTEGER NOT NULL CHECK (width BETWEEN 200 AND 6000),
 height INTEGER NOT NULL CHECK (height BETWEEN 200 AND 6000),
 byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 created_by UUID NOT NULL REFERENCES users(id)
);
CREATE INDEX company_site_media_company_idx ON company_site_media(company_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE company_sites, company_site_slug_history, company_site_media IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM company_sites)
 OR EXISTS (SELECT 1 FROM company_site_slug_history)
 OR EXISTS (SELECT 1 FROM company_site_media) THEN
  RAISE EXCEPTION 'company site data exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE company_site_slug_history;
DROP TABLE company_site_media;
DROP TABLE company_sites;
-- +goose StatementEnd
