# Proposal: `jobs` (vacantes) — public-read slice

Public, full-text searchable job board for `peopleflow-vacantes`. **Read-only slice**: candidates browse published jobs from active companies. Write side, ownership, and recruiter subtree are deferred by design.

## Intent

Ship the `docs/ROADMAP.md` headline — *vacantes con búsqueda full-text* — via Postgres tsvector + GIN. Enforce **"solo empresa `active` publica"** on read: a job surfaces only when `jobs.status='published' AND jobs.deleted_at IS NULL AND companies.status='active'`. Lifecycle born `draft` (`draft → published → closed`); transitions deferred, full status domain in the schema.

## Scope

**In.** `GET /jobs` (full-text + filters + pagination), `GET /jobs/{id}` (published). `jobs` table + search infra. Hexagonal slice under `backend/internal/features/jobs/` mirroring `companies` / `candidates`. Use cases `SearchJobs`, `GetJobByID`. sqlc adapter.

**Out (deferred).** `POST/PUT /jobs`, publish/close. `company_members` ownership (prerequisite for write). "Active company" enforcement on write. Recruiter subtree. Frontend. Production seed strategy.

## Capabilities

- **New**: `jobs` — public-read board; search, filters, pagination, detail; status domain modeled, only `published` exposed.
## Approach

Hexagonal slice mirroring `companies`. **STORED generated `search_vector`** (`setweight(title,'A') || setweight(description,'B')`, `'spanish'`) + **GIN index**. Search uses `websearch_to_tsquery('spanish', $1)` + `ts_rank`. Listing joins `jobs` + `companies` with the active-company + published filter; filters pushed into the same query.

## Requirements (draft — expanded in `sdd-spec`)

- The system MUST expose `GET /jobs` and `GET /jobs/{id}` as public, unauthenticated endpoints.
- A job MUST surface only if `jobs.status='published' AND jobs.deleted_at IS NULL AND companies.status='active'`.
- `GET /jobs` MUST accept `q`, `seniority`, `work_mode`, `employment_type`, `location`, pagination; unsupported params MUST be ignored (no 400).
- Full-text MUST use `'spanish'` + `websearch_to_tsquery`; rows MUST validate enums against CHECK.

## Affected Areas

- `backend/internal/features/jobs/**` (new) — hexagonal slice
- `backend/cmd/api/main.go` (modified) — wire use cases, repos, handler
- `backend/db/migrations/00007_jobs.sql` (new) — goose Up/Down + indexes
- `backend/db/queries/jobs.sql` (new) — sqlc queries (generated code lands in `backend/internal/db/`)
- `openspec/specs/jobs/spec.md` (new) — capability spec

## Risks

| Risk | Lik | Mitigation |
|---|---|---|
| Generated column + GIN on initial migration | Low | Empty table; additive, concurrent build |
| Ownership gap on read path | Med | Write blocked until `company_members` ships |
| Spanish stemming mishandles English tech terms | Med | `setweight` ranking; revisit post-MVP with telemetry |

## Rollback Plan

goose down drops `jobs` + indexes. Routes removed in `main.go`. sqlc file deleted; regen. No loss outside `jobs` (FK inbound to `companies.id` only). `changes/jobs/` preserved per `rules.archive`. **No new infra dependency** — Postgres only.


## Decisions (resolved 2026-08-19)

1. **Seed data**: ship a dev-only goose seed (`00008_jobs_seed.sql`) with ~6 `published` jobs. Note: the seed must also provision seed companies (active) or reference existing ones — see design.
2. **Pagination**: keyset on `(published_at, id)`.
3. **`salary_currency`**: support BOTH `'USD'` and `'MXN'` — `CHECK (salary_currency IN ('USD','MXN'))`, no single-default lock-in. `GET /jobs` accepts an optional `currency` filter so viewers can choose. Currency **conversion (FX)** is DEFERRED (would need external rates).

