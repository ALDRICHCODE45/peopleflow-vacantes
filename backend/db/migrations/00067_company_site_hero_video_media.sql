-- +goose Up
-- +goose StatementBegin
-- Careers site sections v2 slice B (contract §2.4): the hero `background_loop` variant plays an uploaded MP4 of the
-- new kind `hero_video` (video/mp4 only, ≤ 20 MiB, 1..30000 ms). Its width/height come from the first video track
-- and may be unknown (NULL, both or neither); images keep their NOT NULL dimensions and 5 MiB cap. Adds the nullable
-- `duration_ms`, required iff kind = 'hero_video'. Relaxes the 00047/00066 CHECKs under the same names; no row changes.
ALTER TABLE company_site_media
    ADD COLUMN duration_ms INTEGER,
    ALTER COLUMN width DROP NOT NULL,
    ALTER COLUMN height DROP NOT NULL,
    DROP CONSTRAINT company_site_media_kind_check,
    DROP CONSTRAINT company_site_media_content_type_check,
    DROP CONSTRAINT company_site_media_byte_size_check,
    DROP CONSTRAINT company_site_media_width_check,
    DROP CONSTRAINT company_site_media_height_check,
    ADD CONSTRAINT company_site_media_kind_check
        CHECK (kind IN ('cover','gallery','portrait','story','logo','hero_video')),
    ADD CONSTRAINT company_site_media_content_type_check
        CHECK (content_type IN ('image/jpeg','image/png','image/webp','video/mp4')),
    ADD CONSTRAINT company_site_media_byte_size_check
        CHECK (byte_size BETWEEN 1 AND CASE WHEN kind = 'hero_video' THEN 20971520 ELSE 5242880 END),
    ADD CONSTRAINT company_site_media_width_check
        CHECK (CASE WHEN kind = 'hero_video' THEN width IS NULL OR width BETWEEN 1 AND 16384
                    ELSE width IS NOT NULL AND width BETWEEN CASE WHEN kind = 'logo' THEN 64 ELSE 200 END AND 6000 END),
    ADD CONSTRAINT company_site_media_height_check
        CHECK (CASE WHEN kind = 'hero_video' THEN height IS NULL OR height BETWEEN 1 AND 16384
                    ELSE height IS NOT NULL AND height BETWEEN CASE WHEN kind = 'logo' THEN 64 ELSE 200 END AND 6000 END),
    ADD CONSTRAINT company_site_media_dimensions_check
        CHECK ((width IS NULL) = (height IS NULL)),
    ADD CONSTRAINT company_site_media_video_format_check
        CHECK ((kind = 'hero_video') = (content_type = 'video/mp4')),
    ADD CONSTRAINT company_site_media_duration_ms_check
        CHECK (CASE WHEN kind = 'hero_video' THEN duration_ms IS NOT NULL AND duration_ms BETWEEN 1 AND 30000
                    ELSE duration_ms IS NULL END);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$
BEGIN
    -- Lock out concurrent uploads before checking for lossy rollback.
    LOCK TABLE company_site_media IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM company_site_media WHERE kind = 'hero_video') THEN
        RAISE EXCEPTION 'cannot remove hero_video site media kind: hero_video media exist';
    END IF;
END $$;
ALTER TABLE company_site_media
    DROP CONSTRAINT company_site_media_duration_ms_check,
    DROP CONSTRAINT company_site_media_video_format_check,
    DROP CONSTRAINT company_site_media_dimensions_check,
    DROP CONSTRAINT company_site_media_kind_check,
    DROP CONSTRAINT company_site_media_content_type_check,
    DROP CONSTRAINT company_site_media_byte_size_check,
    DROP CONSTRAINT company_site_media_width_check,
    DROP CONSTRAINT company_site_media_height_check,
    DROP COLUMN duration_ms,
    ALTER COLUMN width SET NOT NULL,
    ALTER COLUMN height SET NOT NULL,
    ADD CONSTRAINT company_site_media_kind_check
        CHECK (kind IN ('cover','gallery','portrait','story','logo')),
    ADD CONSTRAINT company_site_media_content_type_check
        CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
    ADD CONSTRAINT company_site_media_byte_size_check
        CHECK (byte_size BETWEEN 1 AND 5242880),
    ADD CONSTRAINT company_site_media_width_check
        CHECK (width BETWEEN CASE WHEN kind = 'logo' THEN 64 ELSE 200 END AND 6000),
    ADD CONSTRAINT company_site_media_height_check
        CHECK (height BETWEEN CASE WHEN kind = 'logo' THEN 64 ELSE 200 END AND 6000);
-- +goose StatementEnd
