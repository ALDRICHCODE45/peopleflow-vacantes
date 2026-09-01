-- name: CreateCompany :one
-- Locks the active industry before INSERT so creation and deactivation serialize.
-- Missing or inactive industries return no row.
WITH active_industry AS MATERIALIZED (
    SELECT id
    FROM industries
    WHERE id = $4 AND active = true
    FOR UPDATE
)
INSERT INTO companies (
    id, name, rfc, industry_id, website, logo_url,
    description, size, founded_year, city, country,
    linkedin_url, instagram_url, facebook_url, twitter_url, cover_image_url
)
SELECT
    $1, $2, $3, $4, $5, $6,
    $7, $8, $9, $10, $11,
    $12, $13, $14, $15, $16
FROM active_industry
RETURNING *;


-- name: GetCompanyByID :one
SELECT * FROM companies
WHERE id = $1 AND deleted_at IS NULL;

-- name: IsCompanyLive :one
-- Atomic liveness probe for the RequireCompanyRole middleware
-- (require-company-role-tombstone-gate slice). Returns `deleted_at IS NULL`
-- for the exact company id WITHOUT filtering away tombstones:
--
--   - Row present, deleted_at IS NULL    → true  (live company)
--   - Row present, deleted_at IS NOT NULL → false (tombstoned company)
--   - Row absent (no such id)           → pgx.ErrNoRows → adapter maps
--                                          to entities.ErrCompanyNotFound
--                                          (the middleware collapses
--                                          ErrCompanyNotFound + false to
--                                          the same 403 — the gate cannot
--                                          reveal which one it saw)
--
-- The probe is ONE column (boolean) so it is cheaper than GetCompanyByID
-- (which SELECTs 22 columns and rebuilds the entity). The `id = $1`
-- predicate carries NO `deleted_at IS NULL` filter — the gate must see
-- the tombstone, not skip past it.
--
-- `:one` (not `:exec`) is chosen deliberately: the middleware needs
-- the boolean to dispatch, and `:one` matches the per-row scalar
-- semantics used by every other read in this file. A missing row
-- surfaces as pgx.ErrNoRows at the adapter boundary.
SELECT ((deleted_at IS NULL)::boolean) AS is_live
FROM companies
WHERE id = $1;

-- name: UpdateCompany :one
-- Atomic partial update + CAS for PATCH /me/company (companies-write slice,
-- design D3). Mirrors UpdateJob :one minus the `active` CTE (companies
-- has no active-company guard on PATCH/DELETE — a suspended company may
-- edit its profile; `status` is not patchable).
--
-- Column-update shapes:
--   - name            via COALESCE(sqlc.narg('name')::text, name)  (non-nullable, no clear-to-NULL)
--   - 12 profile cols via CASE WHEN sqlc.arg('set_<field>')::boolean
--                            THEN sqlc.narg('<field>')::...
--                            ELSE col END                          (tri-state — design D7)
--   - updated_at      = clock_timestamp()                          (advances in the same statement)
--
-- Tri-state decode per column (matches jobs design D7):
--   Set=false              -> CASE branch: ELSE col      (untouched)
--   Set=true, Valid=false  -> CASE branch: THEN narg     -> NULL    (clear)
--   Set=true, Valid=true   -> CASE branch: THEN narg     -> value
--
-- CAS in the UPDATE WHERE: `updated_at = sqlc.arg('cas_token')` — atomic
-- race-free guard for the row predicates (id, deleted_at IS NULL). Two
-- writers holding the same CAS: only one UPDATE returns 1 row in `upd`;
-- the other returns 0.
--
-- The final SELECT is scalar (no FROM, no WHERE) and ALWAYS returns
-- exactly one row. pgx.ErrNoRows is unreachable via the designed flow;
-- mapUpdateCompanyError keeps it as defense-in-depth (mirrors jobs
-- mapUpdateError).
--
-- Never touched: rfc, industry_id, status, created_at, id, deleted_at.
WITH upd AS (
    UPDATE companies
    SET
        name            = COALESCE(sqlc.narg('name')::text, name),
        website         = CASE WHEN sqlc.arg('set_website')::boolean
                                THEN sqlc.narg('website')::text ELSE website END,
        logo_url        = CASE WHEN sqlc.arg('set_logo_url')::boolean
                                THEN sqlc.narg('logo_url')::text ELSE logo_url END,
        description     = CASE WHEN sqlc.arg('set_description')::boolean
                                THEN sqlc.narg('description')::text ELSE description END,
        size            = CASE WHEN sqlc.arg('set_size')::boolean
                                THEN sqlc.narg('size')::text ELSE size END,
        founded_year    = CASE WHEN sqlc.arg('set_founded_year')::boolean
                                THEN sqlc.narg('founded_year')::int2 ELSE founded_year END,
        city            = CASE WHEN sqlc.arg('set_city')::boolean
                                THEN sqlc.narg('city')::text ELSE city END,
        country         = CASE WHEN sqlc.arg('set_country')::boolean
                                THEN sqlc.narg('country')::text ELSE country END,
        linkedin_url    = CASE WHEN sqlc.arg('set_linkedin_url')::boolean
                                THEN sqlc.narg('linkedin_url')::text ELSE linkedin_url END,
        instagram_url   = CASE WHEN sqlc.arg('set_instagram_url')::boolean
                                THEN sqlc.narg('instagram_url')::text ELSE instagram_url END,
        facebook_url    = CASE WHEN sqlc.arg('set_facebook_url')::boolean
                                THEN sqlc.narg('facebook_url')::text ELSE facebook_url END,
        twitter_url     = CASE WHEN sqlc.arg('set_twitter_url')::boolean
                                THEN sqlc.narg('twitter_url')::text ELSE twitter_url END,
        cover_image_url = CASE WHEN sqlc.arg('set_cover_image_url')::boolean
                                THEN sqlc.narg('cover_image_url')::text ELSE cover_image_url END,
        updated_at      = clock_timestamp()
    WHERE id         = sqlc.arg('company_id')::uuid
      AND deleted_at IS NULL
      AND updated_at = sqlc.arg('cas_token')::timestamptz
    RETURNING id
)
SELECT (SELECT count(*) FROM upd) AS updated_count;

-- name: SoftDeleteCompany :one
-- Atomic soft-delete + CAS for DELETE /me/company (companies-write
-- slice, design D4). Minimal SET list: ONLY deleted_at = now() and
-- updated_at = clock_timestamp(). rfc / industry_id / status /
-- created_at / id and the 12 profile columns are PRESERVED as audit
-- history (a future restore endpoint operates on the intact row).
--
-- No `active` CTE (locked §6.10: no active-company guard on PATCH/DELETE
-- — a suspended company may be tombstoned). The WHERE scopes by id +
-- `deleted_at IS NULL` + CAS `updated_at`.
--
-- Outcome matrix (adapter D4 + D11):
--   deleted_count = 0  → ErrCompanyNotFound (CAS lost / already
--                          soft-deleted / cross-company / non-existent —
--                          indistinguishable by design)
--   deleted_count = 1  → nil (success: 1 row tombstoned)
--
-- The final scalar SELECT (no FROM, no WHERE) ALWAYS returns exactly
-- one row, so pgx.ErrNoRows is unreachable via the designed flow;
-- mapSoftDeleteCompanyError keeps it as defense-in-depth.
--
-- `closed_count` / 23514 dispatch — `companies` has no CHECK
-- constraints the minimal SET list can trip (the `name` length /
-- `description` length are VO-only; `companies_size_check` /
-- `companies_founded_year_check` only fire on UPDATE with NEW values;
-- `companies_status_check` is unreachable since `status` is never
-- touched). `23514 → ErrInvalidCompanyStatusTransition` is kept as
-- defense-in-depth.
WITH upd AS (
    UPDATE companies
    SET
        deleted_at = now(),
        updated_at = clock_timestamp()
    WHERE id         = sqlc.arg('company_id')::uuid
      AND deleted_at IS NULL
      AND updated_at = sqlc.arg('cas_token')::timestamptz
    RETURNING id
)
SELECT (SELECT count(*) FROM upd) AS deleted_count;
