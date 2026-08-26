-- name: SearchJobs :many
-- Public read listing for jobs (§spec/jobs). The visibility rule
-- (§Read-Side Visibility Rule) is enforced here, not in Go: a row
-- surfaces only when `jobs.status='published'`, `jobs.deleted_at IS NULL`,
-- and the owning company is `active`. The column list is explicit (not
-- `SELECT *`) so the STORED generated `search_vector` (sqlc would map it
-- to `interface{}`) never enters the scan — every field on the row is
-- typed (uuid.UUID, string, pgtype.Text, pgtype.Int4, pgtype.Timestamptz).
-- `companies.{id,name}` are joined in the same query (zero extra round
-- trip) to embed `{company: {id, name}}` in the API response.
--
-- All optional inputs use `sqlc.narg` (nullable named params). When the
-- adapter doesn't pass a value, the predicate degenerates to TRUE — the
-- same query serves both search and browse modes without a branch in Go.
--
-- FTS uses `websearch_to_tsquery` (safe parser; never throws on
-- malformed input — matches spec scenario "malformed q does not 500").
-- The tsquery is computed in WHERE and again in ORDER BY; Postgres CSEs
-- it in the planner, so the cost is negligible. `COALESCE(..., '')` on
-- the ORDER BY side is what makes browse-mode safe: when `q` is NULL,
-- `websearch_to_tsquery('spanish', '')` yields an empty tsquery and
-- `ts_rank` returns 0 for every row, degenerating the ORDER BY to
-- `published_at DESC, id DESC` exactly as the spec requires.
--
-- Keyset pagination (Decision 3): cursor = opaque base64url(JSON). When
-- the adapter passes `cursor_ts` + `cursor_id`, the row-tuple predicate
-- `(published_at, id) < (cursor_ts, cursor_id)` narrows to the next
-- page; otherwise the predicate degenerates to TRUE (first page).
--
-- `LIMIT @limit+1` from the adapter — the +1 row is dropped in Go and
-- its presence signals "has more" (see Decision 3).
--
-- Dropped `j.company_id` from the SELECT (redundant with
-- `c.id AS company_id` via the JOIN on this same column — keeping it
-- would produce two columns with the same output name, which sqlc
-- cannot map to a single struct field) to keep all output column names
-- unique. `j.status` and `j.deleted_at` are included so the adapter
-- can assert visibility at the row level; they are not exposed in the
-- API response per spec.
SELECT
    j.id,
    j.title,
    j.description,
    j.location,
    j.work_mode,
    j.employment_type,
    j.seniority,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.status,
    j.published_at,
    j.deleted_at,
    c.id AS company_id,
    c.name AS company_name,
    ts_rank(
        j.search_vector,
        websearch_to_tsquery('spanish', COALESCE(sqlc.narg('q')::text, ''))
    ) AS search_rank
FROM jobs j
JOIN companies c ON c.id = j.company_id
WHERE j.status = 'published'
  AND j.deleted_at IS NULL
  AND c.status = 'active'
  AND (sqlc.narg('q')::text IS NULL
       OR j.search_vector @@ websearch_to_tsquery('spanish', sqlc.narg('q')::text))
  AND (sqlc.narg('seniority')::text IS NULL
       OR j.seniority = sqlc.narg('seniority')::text)
  AND (sqlc.narg('work_mode')::text IS NULL
       OR j.work_mode = sqlc.narg('work_mode')::text)
  AND (sqlc.narg('employment_type')::text IS NULL
       OR j.employment_type = sqlc.narg('employment_type')::text)
  AND (sqlc.narg('location')::text IS NULL
       OR j.location ILIKE '%' || sqlc.narg('location')::text || '%')
  AND (sqlc.narg('salary_currency')::text IS NULL
       OR j.salary_currency = sqlc.narg('salary_currency')::text)
  AND (sqlc.narg('cursor_ts')::timestamptz IS NULL
       OR (ts_rank(
              j.search_vector,
              websearch_to_tsquery('spanish', COALESCE(sqlc.narg('q')::text, ''))
           ),
           j.published_at,
           j.id)
          < (COALESCE(sqlc.narg('cursor_rank')::float8, 0),
             sqlc.narg('cursor_ts')::timestamptz,
             sqlc.narg('cursor_id')::uuid))
ORDER BY search_rank DESC,
         j.published_at DESC,
         j.id DESC
LIMIT sqlc.narg('limit')::int;

-- name: GetJobByID :one
-- Public detail endpoint. Same visibility rule as SearchJobs, plus the
-- positional `$1` id. Explicit column list keeps `search_vector` out of
-- the scan and matches the embedded `{company: {id, name}}` shape.
SELECT
    j.id,
    j.title,
    j.description,
    j.location,
    j.work_mode,
    j.employment_type,
    j.seniority,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.status,
    j.published_at,
    j.deleted_at,
    c.id AS company_id,
    c.name AS company_name
FROM jobs j
JOIN companies c ON c.id = j.company_id
WHERE j.id = $1
  AND j.status = 'published'
  AND j.deleted_at IS NULL
  AND c.status = 'active';

-- name: GetJobForUpdate :one
-- Write-path read for the gated PATCH /jobs/{id} endpoint (design D3).
-- NON-visibility-narrowed: the write path MUST see drafts (so a
-- recruiter can publish them) and closed rows (so the use case can
-- reject them with the terminal-rule 400). Only the company scope and
-- `deleted_at IS NULL` apply.
--
-- Joined to `companies` for `name` only - the editor view embeds
-- `{id, name}` (design D7), so one round-trip is enough.
--
-- The explicit column list keeps `search_vector` (STORED generated)
-- and every other internal column OUT of the scan. `j.status` is
-- included so the use case can run the transition table; `j.updated_at`
-- so the use case can CAS-compare against `If-Unmodified-Since`.
SELECT
    j.id,
    j.title,
    j.description,
    j.location,
    j.work_mode,
    j.employment_type,
    j.seniority,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    j.status,
    j.published_at,
    j.updated_at,
    j.company_id,
    c.name AS company_name
FROM jobs j
JOIN companies c ON c.id = j.company_id
WHERE j.id = $1
  AND j.company_id = $2
  AND j.deleted_at IS NULL;


-- name: UpdateJob :one
-- Atomic partial update + CAS + active-company guard for PATCH /jobs/{id}
-- (design D1/D2/D3, jobs-reopen slice).
--
-- Three column-update shapes (unchanged from the pre-guard statement):
--   - COALESCE(sqlc.narg(...), col)  for the five closed-set + text
--     fields: nullable text param, default = column value (untouched).
--   - CASE WHEN sqlc.arg('set_<field>')::boolean THEN sqlc.narg(...)
--     ELSE col END  for the three nullable columns (location,
--     salary_min, salary_max): the boolean flag toggles "write this
--     column"; the value NULL clears, a real value sets.
--   - status = COALESCE(sqlc.narg('status')::text, status): nullable
--     text param, default = current column value.
--
-- Side effect on `published_at` (atomic in the same statement so the
-- `jobs_published_integrity_check` always holds):
--     published_at = CASE WHEN sqlc.narg('status')::text = 'published'
--                         THEN COALESCE(published_at, now())
--                         ELSE published_at END
--   - draft -> published   : sets published_at = now() (was NULL).
--   - published -> published: preserves the existing published_at.
--   - published -> closed   : preserves the existing published_at.
--   - closed -> published   : preserves the existing published_at (D6
--                             — audit history; the row was previously
--                             published, so published_at is non-NULL
--                             and COALESCE keeps it).
--   - any other transition : leaves published_at alone.
--
-- Active-company guard (D1/D2):
--   - The `active` CTE selects the owning company ONLY when
--     companies.status = 'active'. A suspended / pending_verification
--     / missing company yields zero rows in `active`, so the UPDATE
--     inside `upd` matches zero rows AND the final SELECT reports
--     guard_passed = false.
--   - The UPDATE's WHERE clause adds `AND EXISTS (SELECT 1 FROM active)`
--     so the guard and the write are the same statement — no TOCTOU
--     window between a separate check and the UPDATE.
--   - The final scalar SELECT returns
--     `EXISTS (SELECT 1 FROM active) AS guard_passed,
--      (SELECT count(*) FROM upd) AS updated_count`
--     so the adapter can distinguish:
--       guard_passed = false, updated_count = 0
--         → ErrCompanyNotActive (suspended/pending/missing company)
--       guard_passed = true,  updated_count = 0
--         → ErrJobNotFound (CAS lost / cross-company / soft-delete race
--           with active company — D3; use case re-reads)
--       guard_passed = true,  updated_count = 1
--         → success (1 row affected)
--
-- CAS in the UPDATE WHERE: `updated_at = sqlc.arg('cas_token')` -
-- the atomic race-free guard for the row predicates
-- (id, company_id, deleted_at IS NULL). Two writers holding the same
-- CAS: only one UPDATE returns 1 row in `upd`; the other returns 0.
--
-- The final SELECT is scalar (no FROM, no WHERE), so it ALWAYS returns
-- exactly one row. `pgx.ErrNoRows` is therefore unreachable via the
-- designed flow — the `pgx.ErrNoRows → ErrCompanyNotActive` branch in
-- `mapUpdateError` is defense-in-depth (mirrors `mapCreateError`).
--
-- Never touched: search_vector (STORED generated), company_id,
-- created_at, id, deleted_at.
WITH active AS (
    SELECT id
    FROM companies
    WHERE id = sqlc.arg('company_id')::uuid
      AND status = 'active'
),
upd AS (
    UPDATE jobs
    SET
        title           = COALESCE(sqlc.narg('title')::text,           title),
        description     = COALESCE(sqlc.narg('description')::text,     description),
        work_mode       = COALESCE(sqlc.narg('work_mode')::text,       work_mode),
        employment_type = COALESCE(sqlc.narg('employment_type')::text, employment_type),
        seniority       = COALESCE(sqlc.narg('seniority')::text,       seniority),
        salary_currency = COALESCE(sqlc.narg('salary_currency')::text, salary_currency),
        location        = CASE WHEN sqlc.arg('set_location')::boolean
                                THEN sqlc.narg('location')::text
                                ELSE location END,
        salary_min      = CASE WHEN sqlc.arg('set_salary_min')::boolean
                                THEN sqlc.narg('salary_min')::int
                                ELSE salary_min END,
        salary_max      = CASE WHEN sqlc.arg('set_salary_max')::boolean
                                THEN sqlc.narg('salary_max')::int
                                ELSE salary_max END,
        status          = COALESCE(sqlc.narg('status')::text, status),
        published_at    = CASE WHEN sqlc.narg('status')::text = 'published'
                                THEN COALESCE(published_at, now())
                                ELSE published_at END,
        updated_at      = clock_timestamp()
    WHERE id         = sqlc.arg('id')::uuid
      AND company_id = sqlc.arg('company_id')::uuid
      AND deleted_at IS NULL
      AND updated_at = sqlc.arg('cas_token')::timestamptz
      AND EXISTS (SELECT 1 FROM active)
    RETURNING id
)
SELECT
    EXISTS (SELECT 1 FROM active) AS guard_passed,
    (SELECT count(*) FROM upd)    AS updated_count;

-- name: SoftDeleteJob :one
-- Atomic soft-delete + CAS + active-company guard for DELETE /jobs/{id}
-- (design D1/D2/D3, jobs-soft-delete slice).
--
-- Minimal SET list: ONLY deleted_at = now() and updated_at = now().
-- published_at / title / description / status / work_mode /
-- employment_type / seniority / location / salary_min / salary_max /
-- salary_currency are PRESERVED as audit history. search_vector (STORED
-- generated) is naturally unchanged because its inputs (title,
-- description) are not touched; the partial index jobs_public_listing_idx
-- (predicated on deleted_at IS NULL) drops the row automatically.
--
-- Active-company guard (mirrors UpdateJob D1):
--   - the `active` CTE selects the owning company ONLY when
--     companies.status = 'active'. suspended / pending_verification /
--     missing company yields zero rows in `active`, so the UPDATE inside
--     `upd` matches zero rows AND the final SELECT reports
--     guard_passed = false.
--   - the UPDATE's WHERE adds `AND EXISTS (SELECT 1 FROM active)` so the
--     guard and the write are the same statement — no TOCTOU window.
--
-- Outcome matrix (adapter D2):
--   guard_passed = false, deleted_count = 0
--     → ErrCompanyNotActive (suspended/pending/missing company)
--   guard_passed = true,  deleted_count = 0
--     → ErrJobNotFound (CAS lost / already-soft-deleted / cross-company
--       race with an active company; the use case already CAS-compared,
--       so this is a residual tight race — mapped to 404, no re-read)
--   guard_passed = true,  deleted_count = 1
--     → success (1 row tombstoned)
--
-- CAS in the UPDATE WHERE: `updated_at = sqlc.arg('cas_token')` — the
-- atomic race-free guard. The final scalar SELECT (no FROM, no WHERE)
-- ALWAYS returns exactly one row, so pgx.ErrNoRows is unreachable via the
-- designed flow (mapSoftDeleteError keeps it as defense-in-depth).
WITH active AS (
    SELECT id
    FROM companies
    WHERE id = sqlc.arg('company_id')::uuid
      AND status = 'active'
),
upd AS (
    UPDATE jobs
    SET
        deleted_at = now(),
        updated_at = clock_timestamp()
    WHERE id         = sqlc.arg('id')::uuid
      AND company_id = sqlc.arg('company_id')::uuid
      AND deleted_at IS NULL
      AND updated_at = sqlc.arg('cas_token')::timestamptz
      AND EXISTS (SELECT 1 FROM active)
    RETURNING id
)
SELECT
    EXISTS (SELECT 1 FROM active) AS guard_passed,
    (SELECT count(*) FROM upd)    AS deleted_count;


-- name: CreateJob :one
-- Atomic create for POST /jobs (design D1/D2/D3).
--
-- Two guarantees live in this single statement:
--   1. Active-company gate: the `active` CTE selects the owning company
--      ONLY when status='active'. A suspended / pending_verification /
--      missing company yields zero rows in `active`, so `ins` inserts
--      zero rows and the final SELECT returns zero rows -> the adapter
--      maps pgx.ErrNoRows -> entities.ErrCompanyNotActive (the
--      predicate and the write are the same statement -- no TOCTOU
--      window).
--   2. Single-round-trip editor view: the final SELECT joins `ins`
--      back to `active` to carry company_name, so the output column
--      set is EXACTLY the GetJobForUpdate column set and the adapter
--      reuses toJobForUpdateEntity via a thin row lift.
--
-- status is written explicitly as 'draft' (locked decision #1): the
-- row is born hidden from the public read path (status='published'
-- predicate) and the explicit value is immune to a future DEFAULT drift.
--
-- salary_currency is always supplied by the use case (nil -> MXN in Go),
-- so it is a required arg, never NULL. location / salary_min /
-- salary_max are nullable (sqlc.narg).
--
-- search_vector (STORED generated) is EXCLUDED from BOTH the INSERT
-- column list and every output list -- a `RETURNING *` would map
-- tsvector to interface{} and a generated column rejects explicit
-- writes (D3).
WITH active AS (
    SELECT id, name
    FROM companies
    WHERE id = sqlc.arg('company_id')::uuid
      AND status = 'active'
),
ins AS (
    INSERT INTO jobs (
        id, company_id, title, description, work_mode, employment_type,
        seniority, status, location, salary_min, salary_max, salary_currency
    )
    SELECT
        sqlc.arg('id')::uuid,
        active.id,
        sqlc.arg('title')::text,
        sqlc.arg('description')::text,
        sqlc.arg('work_mode')::text,
        sqlc.arg('employment_type')::text,
        sqlc.arg('seniority')::text,
        'draft',
        sqlc.narg('location')::text,
        sqlc.narg('salary_min')::int,
        sqlc.narg('salary_max')::int,
        sqlc.arg('salary_currency')::text
    FROM active
    RETURNING
        id, title, description, location, work_mode, employment_type,
        seniority, salary_min, salary_max, salary_currency, status,
        published_at, updated_at, company_id
)
SELECT
    ins.id,
    ins.title,
    ins.description,
    ins.location,
    ins.work_mode,
    ins.employment_type,
    ins.seniority,
    ins.salary_min,
    ins.salary_max,
    ins.salary_currency,
    ins.status,
    ins.published_at,
    ins.updated_at,
    ins.company_id,
    active.name AS company_name
FROM ins
JOIN active ON active.id = ins.company_id;


-- name: CloseCompanyJobs :execrows
-- Inline close of all non-closed, non-tombstoned jobs of a company
-- (companies-write slice, design D5). Runs in the SAME pgx.Tx as the
-- `SoftDeleteCompany` write so the soft-delete + the inline close are
-- atomic; on any error in either statement, the transaction rolls back
-- and NEITHER the tombstone NOR the close is visible.
--
-- No `active` CTE / no guard needed: the soft-delete WHERE already
-- scopes by `company_id`, so the second statement scopes by the same
-- column (no TOCTOU window).
--
-- Predicate:
--   - `company_id = $1`         scopes to the soft-deleted company
--   - `deleted_at IS NULL`      excludes already-tombstoned jobs (the
--                                tombstone stands — a soft-deleted job's
--                                status is not overwritten)
--   - `status IN ('draft',
--                'published')` excludes already-closed jobs (closing a
--                                closed job is a no-op; updated_at is NOT
--                                bumped on those rows — design §14.12
--                                five-invariant inline-close assertion)
--
-- `:execrows` (not `:exec`) is chosen deliberately: sqlc `:exec` returns
-- only `error`, so the adapter could not surface RowsAffected as the
-- proposal requires. `:execrows` returns `(int64, error)`. The adapter
-- captures the count and explicitly ignores it (`_ = closedCount`) — the
-- use case does NOT branch on it; `0 rows closed` is a legitimate success
-- ("this company had no non-closed jobs at delete time").
UPDATE jobs
SET
    status     = 'closed',
    updated_at = clock_timestamp()
WHERE company_id = sqlc.arg('company_id')::uuid
  AND deleted_at IS NULL
  AND status IN ('draft', 'published');
