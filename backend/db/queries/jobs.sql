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