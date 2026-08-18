-- +goose Up
ALTER TABLE companies
    ADD COLUMN description       TEXT,
    ADD COLUMN size              TEXT,
    ADD COLUMN founded_year      SMALLINT,
    ADD COLUMN city              TEXT,
    ADD COLUMN country           TEXT,
    ADD COLUMN linkedin_url      TEXT,
    ADD COLUMN instagram_url     TEXT,
    ADD COLUMN facebook_url      TEXT,
    ADD COLUMN twitter_url       TEXT,
    ADD COLUMN cover_image_url   TEXT;

ALTER TABLE companies
    ADD CONSTRAINT companies_size_check
    CHECK (size IS NULL OR size IN ('startup', 'small', 'medium', 'large', 'enterprise'));

-- founded_year range CHECK.
--
-- This CHECK is intentionally static (1800..2200) and intentionally permissive
-- on the upper bound. It is defense-in-depth: it guarantees no garbage ever
-- lands in the column even if a future code path bypasses the domain layer.
--
-- The AUTHORITATIVE business rule — including the rolling upper bound of
-- `currentYear+1` — lives in the `FoundedYear` value object
-- (internal/features/companies/domain/valueobjects/foundedYear.go). All
-- application writes are validated by the VO before they reach the database,
-- so the two bounds are intentionally divergent by design:
--
--   * DB CHECK:  static, generous, never needs a migration to roll forward.
--   * VO check:  dynamic, strict, rolls forward with the calendar.
--
-- A value in (currentYear+1, 2200] would pass the DB but be rejected by the
-- VO, which runs first on the normal write path. Conversely, the DB would
-- only reject a value the VO also rejects (e.g. year < 1800), so the DB
-- constraint never overrides the business rule. Do NOT tighten the DB upper
-- bound without also updating the VO — they must move together.
ALTER TABLE companies
    ADD CONSTRAINT companies_founded_year_check
    CHECK (founded_year IS NULL OR (founded_year >= 1800 AND founded_year <= 2200));

-- +goose Down
ALTER TABLE companies
    DROP CONSTRAINT IF EXISTS companies_founded_year_check;

ALTER TABLE companies
    DROP CONSTRAINT IF EXISTS companies_size_check;

ALTER TABLE companies
    DROP COLUMN IF EXISTS cover_image_url,
    DROP COLUMN IF EXISTS twitter_url,
    DROP COLUMN IF EXISTS facebook_url,
    DROP COLUMN IF EXISTS instagram_url,
    DROP COLUMN IF EXISTS linkedin_url,
    DROP COLUMN IF EXISTS country,
    DROP COLUMN IF EXISTS city,
    DROP COLUMN IF EXISTS founded_year,
    DROP COLUMN IF EXISTS size,
    DROP COLUMN IF EXISTS description;
