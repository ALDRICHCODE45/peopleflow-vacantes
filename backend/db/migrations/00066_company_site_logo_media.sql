-- +goose Up
-- +goose StatementBegin
-- Careers site sections v2 (contract §2.3, §3.4): the `logos` block uploads media of the new kind `logo`, PNG or WebP
-- (alpha kept) with at least 64 px per side. Other kinds keep JPEG/PNG/WebP and their 200 px floor. Relaxes the
-- column CHECKs created by 00047 under the same names and adds one format rule for logos; no row changes.
ALTER TABLE company_site_media
    DROP CONSTRAINT company_site_media_kind_check,
    DROP CONSTRAINT company_site_media_width_check,
    DROP CONSTRAINT company_site_media_height_check,
    ADD CONSTRAINT company_site_media_kind_check
        CHECK (kind IN ('cover','gallery','portrait','story','logo')),
    ADD CONSTRAINT company_site_media_width_check
        CHECK (width BETWEEN CASE WHEN kind = 'logo' THEN 64 ELSE 200 END AND 6000),
    ADD CONSTRAINT company_site_media_height_check
        CHECK (height BETWEEN CASE WHEN kind = 'logo' THEN 64 ELSE 200 END AND 6000),
    ADD CONSTRAINT company_site_media_logo_format_check
        CHECK (kind <> 'logo' OR content_type IN ('image/png','image/webp'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    -- Lock out concurrent uploads before checking for lossy rollback.
    LOCK TABLE company_site_media IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM company_site_media WHERE kind = 'logo') THEN
        RAISE EXCEPTION 'cannot remove logo site media kind: logo media exist';
    END IF;
END $$;
ALTER TABLE company_site_media
    DROP CONSTRAINT company_site_media_logo_format_check,
    DROP CONSTRAINT company_site_media_kind_check,
    DROP CONSTRAINT company_site_media_width_check,
    DROP CONSTRAINT company_site_media_height_check,
    ADD CONSTRAINT company_site_media_kind_check CHECK (kind IN ('cover','gallery','portrait','story')),
    ADD CONSTRAINT company_site_media_width_check CHECK (width BETWEEN 200 AND 6000),
    ADD CONSTRAINT company_site_media_height_check CHECK (height BETWEEN 200 AND 6000);
-- +goose StatementEnd
