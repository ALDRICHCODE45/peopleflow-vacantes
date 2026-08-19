# Tasks: `jobs` (vacantes) — public-read slice

Strict TDD: `cd backend && go test ./...`. Delivery: `single-pr`. RED precedes every GREEN.

## Review Workload Forecast

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

Authored ~1550 lines. Excluded: generated `internal/db/jobs.sql.go`, `models.go`. Counted: every Go file under `internal/features/jobs/**`, both migrations, `main.go`. Author requests `size:exception` or scopes down.

## Phase 1 — `00007_jobs.sql`

- [x] 1.1 (RED) `backend/internal/features/jobs/infrastructure/postgres/migration_00007_test.go` (skip no `DATABASE_URL`): table/4 CHECKs/`search_vector`/3 indexes exist after up; Down drops; NOT NULL rejects NULL; 23514 per out-of-enum; `salary_currency` defaults `'MXN'`; `status='published'` without `published_at` fails 23514.
- [x] 1.2 (GREEN) `backend/db/migrations/00007_jobs.sql` Up+Down per spec. Refinements: `salary_currency TEXT NOT NULL DEFAULT 'MXN'`; `CHECK (status <> 'published' OR published_at IS NOT NULL)`; `location` via `ILIKE`.

## Phase 2 — `00008_jobs_seed.sql`

- [x] 2.1 (RED) `migration_00008_test.go` (skip no `DATABASE_URL`): 3 active companies (fixed UUIDs); 6 published jobs (`published_at NOT NULL`, `deleted_at` NULL); rerun idempotent; Down removes seeded.
- [x] 2.2 (GREEN) `backend/db/migrations/00008_jobs_seed.sql`: `INSERT … ON CONFLICT (id) DO NOTHING` (3 companies + 6 jobs, fixed UUIDs). Down: delete by UUID.

## Phase 3 — sqlc

- [x] 3.1 (GREEN) `backend/db/queries/jobs.sql` with `SearchJobs :many` + `GetJobByID :one` per design.md (explicit cols, JOIN `companies`, `ORDER BY ts_rank DESC, j.published_at DESC, j.id DESC`, `LIMIT @limit + 1`, `sqlc.narg`).
- [x] 3.2 (GREEN) `make sqlc`. Verify `internal/db/jobs.sql.go` + `models.go` compile, no `interface{}` for `search_vector`.

## Phase 4 — Domain VOs

- [ ] 4.1 (RED) `workMode_test.go`. 4.2 (GREEN) `workMode.go`.
- [ ] 4.3 (RED) `employmentType_test.go`. 4.4 (GREEN) `employmentType.go`.
- [ ] 4.5 (RED) `seniority_test.go`. 4.6 (GREEN) `seniority.go`.
- [ ] 4.7 (RED) `jobStatus_test.go`. 4.8 (GREEN) `jobStatus.go` (`JobStatus` + `ErrInvalidJobStatus`; `Draft` zero).
- [ ] 4.9 (RED) `salaryCurrency_test.go` (USD/MXN; reject EUR/empty). 4.10 (GREEN) `salaryCurrency.go`.

## Phase 5 — Entity + port

- [ ] 5.1 (RED) `domain/entities/job_test.go` (read model: fields accessible, VOs hold values, `CompanyRef{ID,Name}`, `ErrJobNotFound`).
- [ ] 5.2 (GREEN) `job.go` — `Job{ID, Title, Description, VOs, optional Location/SalaryMin/SalaryMax, SalaryCurrency, PublishedAt *time.Time, Company CompanyRef}`, `CompanyRef{ID, Name}`, `ErrJobNotFound`. NOTE: NO `toEntity` here — the sqlc-row → entity mapping lives in the postgres adapter (task 7.2), matching the `companies` pattern; `domain` MUST NOT import `internal/db`.
- [ ] 5.3 (RED) `jobRepository_test.go` (stub satisfies port).
- [ ] 5.4 (GREEN) `jobRepository.go` port: `Search(ctx, SearchParams) ([]Job, error)` + `GetByID(ctx, uuid.UUID) (*Job, error)`; `SearchParams{Q, *string filters, *Cursor, Limit int}`.

## Phase 6 — Application

- [ ] 6.1 (RED) `cursor_test.go` (round-trip; rank/no-rank; malformed → tolerant first page).
- [ ] 6.2 (GREEN) `cursor.go` — opaque `base64url(JSON)`: `{t,i}` browse; `{r,t,i}` search.
- [ ] 6.3 (RED) `searchJobs_test.go` (stub; keyset encodes last row when limit+1 hit).
- [ ] 6.4 (GREEN) `jobService.go` + `searchJobs.go` — `JobService{repo}`; empty filters → DB sentinel.
- [ ] 6.5 (RED) `getJobByID_test.go` (`ErrJobNotFound` invisible). 6.6 (GREEN) `getJobByID.go`. 6.7 (GREEN) `dtos/searchJobsDto.go` (`SearchJobsDto`/`SearchJobsItem`/`SearchJobsResult{Items, NextCursor *string}`).

## Phase 7 — Postgres adapter

- [ ] 7.0 (GREEN) Fix `backend/db/queries/jobs.sql` `SearchJobs`: add `ts_rank(j.search_vector, websearch_to_tsquery('spanish', COALESCE(sqlc.narg('q')::text,''))) AS search_rank` to the SELECT; replace the 2-tuple keyset with the unified 3-tuple `(ts_rank(...), j.published_at, j.id) < (COALESCE(sqlc.narg('cursor_rank')::float8, 0), sqlc.narg('cursor_ts')::timestamptz, sqlc.narg('cursor_id')::uuid)`; `ORDER BY search_rank DESC, j.published_at DESC, j.id DESC`. Regenerate sqlc. Rationale: ordering by rank first requires rank in the keyset.
- [ ] 7.1 (RED) `infrastructure/postgres/jobRepository_test.go` (build params: empty sentinels, nil cursor → invalid pgtypes; `toEntity` incl. `search_rank`→`Job.Rank`; `mapGetError` ErrNoRows→ErrJobNotFound; `Search` returns `NextCursor` only when +1 row).
- [ ] 7.2 (GREEN) `jobRepository.go` — port impl; `toEntity(db.JobRow)` rebuilds `Job` + VOs (full/nullable/invalid/`search_vector` ignored) and maps `search_rank`→`Job.Rank` (nil when browse/`Q` nil); `Search` requests `limit+1`; passes `cursor_rank = COALESCE(cursor.Rank, 0)`; `var _ repositories.JobRepository = (*jobRepository)(nil)`.

## Phase 8 — HTTP handler

- [ ] 8.1 (RED) `infrastructure/http/handler_test.go` (stub `JobService`): `GET /jobs` 200 envelope (items non-nil empty); `GET /jobs/{id}` 200 bare; 404/`ErrJobNotFound`; 400 bad UUID; 500 unknown; invalid filters + unknown param ignored; 200 on malformed `q`.
- [ ] 8.2 (GREEN) `jobHandler.go` — public `GET /` + `GET /{id}`; envelope `{Items, NextCursor *string}`; embed `company{id,name}`; `classifyError` 404/500.

## Phase 9 — Wiring

- [x] 9.1 (GREEN) Edit `backend/cmd/api/main.go`: import `jobshttp`/`jobspostgres`/`jobsusecases`; build repo→service→handler; `r.Mount("/jobs", handler.Routes())`.
- [x] 9.2 (RED) Extend `cmd/api/main_test.go` asserting `/jobs` + `/jobs/{id}` reachable.
- [x] 9.3 (GREEN) `go build ./...` + `go vet ./...` clean.

## Phase 10 — Verify prep

- [x] 10.1 `gofmt -l .` empty; `go vet ./...` clean; `go test ./...` green; `go test -tags=integration ./...` against `make db-up` green.
- [x] 10.2 Mark resolved in `proposal.md`/`design.md` open-questions: `salary_currency NOT NULL DEFAULT 'MXN'`; `CHECK (status<>'published' OR published_at IS NOT NULL)`; `location ILIKE`.

## Acceptance

RED compiles + fails for named path. GREEN: prior RED passes, no regression. REFACTOR: `gofmt -l .` empty, `go vet ./...` clean.
