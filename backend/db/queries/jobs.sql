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


-- name: UpdateJob :execrows
-- Atomic partial update + CAS for PATCH /jobs/{id} (design D3).
--
-- Three column-update shapes:
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
--   - any other transition : leaves published_at alone.
--
-- CAS in the WHERE clause: `updated_at = sqlc.arg('cas_token')` -
-- this is the atomic race-free guard. Two writers holding the same
-- CAS: only one UPDATE returns 1 row; the other returns 0 rows. The
-- adapter maps 0 rows to entities.ErrJobNotFound; the use case
-- re-interprets it as ErrConcurrencyConflict because it already read
-- the row via GetForUpdate.
--
-- Never touched: search_vector (STORED generated), company_id,
-- created_at, id, deleted_at.
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
    updated_at      = now()
WHERE id         = sqlc.arg('id')::uuid
  AND company_id = sqlc.arg('company_id')::uuid
  AND deleted_at IS NULL
  AND updated_at = sqlc.arg('cas_token')::timestamptz;
