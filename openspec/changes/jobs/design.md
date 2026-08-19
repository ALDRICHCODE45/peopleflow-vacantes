# Design: `jobs` (vacantes) — public-read slice

Public, full-text searchable job board. Read-only hexagonal slice mirroring `companies`/`candidates`: `GET /jobs` (search + filters + keyset pagination) and `GET /jobs/{id}`. Read-side visibility is enforced in SQL, not in Go.

## Layer Layout (Decision 1)

```
backend/internal/features/jobs/
├── domain/
│   ├── entities/job.go                 # Job read model + ErrJobNotFound
│   ├── valueobjects/work_mode.go       # Parse/ String VOs
│   ├── valueobjects/employment_type.go
│   ├── valueobjects/seniority.go
│   ├── valueobjects/job_status.go      # full lifecycle; reserved for write side
│   ├── valueobjects/salary_currency.go
│   └── repositories/jobRepository.go   # port: Search, GetByID
├── application/
│   ├── dtos/searchJobsDto.go           # SearchJobsDto in / JobResult out + Cursor
│   └── usecases/{jobService,searchJobs,getJobByID}.go
└── infrastructure/
    ├── http/handler.go                 # JobHandler{service} + Routes()
    └── postgres/jobRepository.go       # *db.Queries adapter
```

Dependency direction: `infrastructure → application → domain`. Handlers depend on `JobService`; `JobService` depends on the `repositories.JobRepository` port; the postgres adapter implements the port (compile-time `var _` assertion). This is the exact pattern in `companies`/`candidates`.

**Read-only nuance**: no `NewJob` factory, no `uuid.NewV7`, no `mapCreateError`. The entity is a pure read model rebuilt by `toEntity`; VOs still `Parse*` from string columns so an unrecognized value fails loud rather than silently zeroing.

## Architecture Decisions

| # | Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|---|
| 2 | Search query shape | Single raw `:many` query, `JOIN companies`, explicit column list | CTE / `SELECT *` | Explicit columns avoid scanning `search_vector` (sqlc maps `tsvector → interface{}`); one query keeps filters+rank in the DB. |
| 3 | Keyset pagination | Opaque base64url cursor `{ts, id}`; page 20; `LIMIT n+1` | Offset (`OFFSET`), exposing raw `(ts,id)` | Offset degrades on deep pages and skips/dups on insert; opaque cursor is evolvable. |
| 4 | Envelope | `{ items: [...], next_cursor: string\|null }`; detail = bare job object | Wrapped detail, `total` count | `total` forces a full count; bare detail matches `GET /companies/{id}`. |
| 5 | Company in response | Embed `company: { id, name }` | `company_id` only | Name is already joined (same query, zero extra round-trip); board UI needs it. |
| 6 | Rank/parser location | In-SQL `websearch_to_tsquery('spanish', @q)` + `ts_rank` (raw sqlc) | Go-side post-processing | Safe parser never throws; keeps ranking inside the GIN-using query. |
| 7 | Dev seed | Self-contained `00008_jobs_seed.sql` provisions 3 active companies + 6 jobs | Reference existing companies | No deterministic seed companies exist; self-contained + idempotent (`ON CONFLICT DO NOTHING`, fixed UUIDs). |
| 8 | Errors | 404 on invisible/nonexistent id; malformed cursor → tolerant first page; reuse `httpjson` | 400 on bad cursor | Spec: unknown/invalid params are ignored, no 400; opaque cursor should degrade, not error. |

## Response Envelope (Decisions 4 + 5)

`GET /jobs`:

```json
{
  "items": [
    {
      "id": "018f…", "title": "Backend Engineer", "description": "…",
      "work_mode": "remote", "employment_type": "full_time", "seniority": "senior",
      "location": "CDMX",
      "salary_min": 40000, "salary_max": 60000, "salary_currency": "MXN",
      "published_at": "2026-08-19T12:00:00Z",
      "company": { "id": "018e…", "name": "Acme SA" }
    }
  ],
  "next_cursor": "eyJ0IjoiMjAyNi0…"   // null on last page
}
```

`GET /jobs/{id}` returns the same job object (no envelope). Exposed fields: `id, title, description, work_mode, employment_type, seniority, location, salary_min, salary_max, salary_currency, published_at, company{id,name}`. **Not exposed**: `search_vector`, `status`, `deleted_at`, `created_at`, `updated_at`, `company_id` (replaced by embedded `company`). Nullable `location`/`salary_min`/`salary_max` are `*string`/`*int` with `omitempty`; `salary_currency` always present (DB default `MXN`). `items` is always a non-nil slice (`[]`, never `null`).

## sqlc Query Shapes (Decisions 2 + 6)

```sql
-- name: SearchJobs :many
SELECT j.id, j.title, j.description, j.location,
       j.work_mode, j.employment_type, j.seniority,
       j.salary_min, j.salary_max, j.salary_currency,
       j.published_at, c.id AS company_id, c.name AS company_name
FROM jobs j
JOIN companies c ON c.id = j.company_id
WHERE j.status = 'published'
  AND j.deleted_at IS NULL
  AND c.status = 'active'
  AND (@q::text = '' OR j.search_vector @@ websearch_to_tsquery('spanish', @q::text))
  AND (@seniority::text = '' OR j.seniority = @seniority::text)
  AND (@work_mode::text = '' OR j.work_mode = @work_mode::text)
  AND (@employment_type::text = '' OR j.employment_type = @employment_type::text)
  AND (@location::text = '' OR j.location ILIKE '%' || @location::text || '%')
  AND (@currency::text = '' OR j.salary_currency = @currency::text)
  AND (sqlc.narg('cursor_ts')::timestamptz IS NULL
       OR (j.published_at, j.id) < (sqlc.narg('cursor_ts')::timestamptz, sqlc.narg('cursor_id')::uuid))
ORDER BY ts_rank(j.search_vector, websearch_to_tsquery('spanish', @q::text)) DESC,
         j.published_at DESC, j.id DESC
LIMIT @limit::int;

-- name: GetJobByID :one
SELECT j.id, j.title, j.description, j.location,
       j.work_mode, j.employment_type, j.seniority,
       j.salary_min, j.salary_max, j.salary_currency,
       j.published_at, c.id AS company_id, c.name AS company_name
FROM jobs j JOIN companies c ON c.id = j.company_id
WHERE j.id = $1 AND j.status = 'published'
  AND j.deleted_at IS NULL AND c.status = 'active';
```

Notes: `@`/`sqlc.narg` named params map to positional `$n`; empty-string sentinel for text/enum filters, `sqlc.narg` for nullable cursor. `search_vector` never appears in the SELECT, so no `interface{}` scan. `websearch_to_tsquery('spanish','')` yields an empty tsquery → `ts_rank` is `0` for every row, so browse degenerates to `published_at DESC, id DESC`.

## Keyset Predicate (Decision 3)

- Cursor = `base64url(JSON)`. Browse: `{"t":"<published_at RFC3339Nano>","i":"<uuid>"}` (rank nil). Search (`q` present): `{"r":<ts_rank float>,"t":…,"i":…}`. Keyset predicate is a UNIFIED 3-tuple: `(ts_rank(...), published_at, id) < (COALESCE(cursor_rank,0), cursor_ts, cursor_id)`. In browse mode `ts_rank` is 0 for every row (empty tsquery), so the 3-tuple degenerates to `(published_at, id)`. The `SearchJobs` SELECT MUST include `ts_rank(...) AS search_rank` so the adapter can populate `Job.Rank`. **(Corrected 2026-08-19: a 2-tuple keyset while ordering by `ts_rank DESC` first would skip/duplicate rows when rank changes across pages.)**
- Page size `20`; `LIMIT @limit + 1` in the adapter — return first `limit`, set `next_cursor` from the last returned row only if the `n+1`th exists.

## Seed (Decision 7)

`00008_jobs_seed.sql` (goose Up/Down), dev-only. Up: `INSERT … ON CONFLICT (id) DO NOTHING` for 3 deterministic active companies (fixed UUIDs, `status='active'`, existing `industries` FKs from `00001`), then 6 `published` jobs with explicit `published_at` (staggered) and `deleted_at IS NULL`. Down: delete seeded job/company ids by UUID. Fixed UUIDs keep re-runs idempotent. No runtime requirement.

## Sequence Diagram (Decision 9)

```
Client → JobHandler.listJobs                 (infra/http)
           │  parse q/filters/cursor/limit → SearchJobsDto
           ▼
        JobService.SearchJobs(ctx, dto)      (application)
           │  Decode(cursor) → (ts, id)
           ▼
        JobRepository.Search(ctx, q)         (domain port)
           │  build sqlc params (pgtype for cursor)
           ▼
        db.Queries.SearchJobs(ctx, params)   (sqlc generated)
           │  SELECT … websearch_to_tsquery + ts_rank
           ▼
        Postgres 16 (GIN search_vector + partial idx) → rows (+1 has-more)
           ▲
        toEntity rows → []Job; encode last row → NextCursor
           ▼
        JobHandler: WriteJSON(200, {items, next_cursor})
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/db/migrations/00007_jobs.sql` | Create | `jobs` table + 4 CHECKs + `search_vector` STORED + 3 indexes |
| `backend/db/migrations/00008_jobs_seed.sql` | Create | Dev-only seed companies + 6 published jobs |
| `backend/db/queries/jobs.sql` | Create | `SearchJobs :many`, `GetJobByID :one` |
| `backend/internal/features/jobs/**` | Create | domain / application / infrastructure slice |
| `backend/internal/db/jobs.sql.go` etc. | Generate | `make sqlc` (do not hand-edit) |
| `backend/cmd/api/main.go` | Modify | wire repo → service → handler; `r.Mount("/jobs", …)` (public, no `RequireAuth`) |

**Migration-before-code rule**: `00007` + `00008` land before `jobs.sql` is added to `db/queries/` and regenerated — sqlc `schema: db/migrations` requires the table to exist for codegen.

## Testing Strategy

| Layer | Test | Approach |
|-------|------|----------|
| Unit (RED-first) | VO `Parse*` valid/invalid; cursor encode/decode round-trip; handler error mapping (404/200) | stdlib `go test`, mirror `companies` tests |
| Integration | CHECK constraints (23514); visibility rule; keyset stability; `ts_rank` title>description | `//go:build integration`, `make test-integration`, mirror `migration_check_test.go` |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable classification, or process-integration boundary. SQL injection is mitigated by sqlc parameterized placeholders (no string concat) and the safe parser `websearch_to_tsquery`. Public routes carry no auth surface (spec: ignore `Authorization`).

## Migration / Rollout

Additive migration on an empty table; no data migration. Rollback = `goose down` (drops `jobs` + indexes), remove `/jobs` mount, delete `jobs.sql` + regen. FK is inbound to `companies.id` only — no loss outside `jobs`.

## Open Questions

- [ ] `salary_currency` spec omits `NOT NULL` (DEFAULT `MXN`); recommend adding `NOT NULL` to match `candidates`. Confirm before tasks.
- [ ] `published_at` nullable for `published` rows only via future publish flow — add `CHECK (status <> 'published' OR published_at IS NOT NULL)`? Optional defensive guard.
- [ ] `location` filter semantics unstated in spec — design uses `ILIKE` substring. Confirm.

## Risks

| Risk | Mitigation |
|---|---|
| `ts_rank` + deep pagination ties (search) | 3-tuple cursor includes rank; stable per (doc, query) |
| Spanish stemming mishandles tech terms | `setweight` ranking; revisit post-MVP |
| Seed drift vs future write flow | Fixed UUIDs + `ON CONFLICT DO NOTHING`; dev-only |
