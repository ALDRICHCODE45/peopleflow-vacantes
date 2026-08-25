# Exploration: `jobs-create`

Status: exploration (pre-proposal grounding). Read-only; no code changes.

Scope: introduce the **create** write endpoint `POST /jobs` to the `jobs` feature, anchored on the
delivered `jobs-write-side` change (archived at `openspec/changes/archive/2026-08-24-jobs-write-side/`),
which already built the read-for-write projection, the editor view, the gated route pattern, and the VO
parsing surface. Locked business decisions (DO NOT re-litigate):

1. POST creates in `draft` (DB default, hidden from public).
2. Required fields = NOT NULL set: `title`, `description`, `work_mode`, `employment_type`, `seniority`;
   `salary_currency` defaults `MXN`; `location`/`salary_min`/`salary_max` optional.
3. Only an `active` company can create.
4. No dedupe.

`company_id` comes from `CompanyContext` (never body/path). Gate: `RequireAuth` + `RequireCompanyRole(recruiter)`.

---

## 1. Reuse map — what `jobs-write-side` already gives us

All paths under `backend/internal/features/jobs/`. The delivered PATCH slice already provides almost the
entire vertical-slice scaffolding; `POST /jobs` is a **new method on an existing machine**, not a new slice.

| Artifact | File | Reuse for create? |
|---|---|---|
| `WorkMode` + `ParseWorkMode` | `domain/valueobjects/workMode.go` | **YES** — parse `work_mode` input; `.String()` for projection. |
| `EmploymentType` + `ParseEmploymentType` | `domain/valueobjects/employmentType.go` | **YES** — same. |
| `Seniority` + `ParseSeniority` | `domain/valueobjects/seniority.go` | **YES** — same. |
| `SalaryCurrency` + `ParseSalaryCurrency` | `domain/valueobjects/salaryCurrency.go` | **YES** — parse optional `salary_currency` (nil → default `MXN`). |
| `JobStatus` + `ParseJobStatus` | `domain/valueobjects/jobStatus.go` | **Partial** — create always yields `Draft` (DB default); `ParseJobStatus` not needed on input, but `JobStatus.String()` used by projection. |
| `valueobjects.Optional[T]` | `domain/valueobjects/optional.go` | **NO** — PATCH-only tri-state (absent vs null vs value). Create has no partial semantics: optional fields are plain `*string`/`*int` pointers (absent == null == leave NULL). |
| `entities.JobForUpdate` | `domain/entities/jobForUpdate.go` | **YES (likely)** — the editor-view projection carries exactly `{id,title,description,work_mode,employment_type,seniority,location,salary_min,salary_max,salary_currency,status,published_at,updated_at,company{id,name}}`. If `CreateJob` RETURNING produces this column set, the adapter can map into `JobForUpdate` and reuse the existing `toEditorView`. |
| `entities.CompanyRef` | `domain/entities/job.go` | **YES** — embedded `{id,name}` in the editor view. |
| `entities.ErrJobNotFound` | `domain/entities/job.go` | **Indirect** — create does not 404 a job (it's a new row); see §3 for the active-company sentinel. |
| `entities.ErrEmptyTitle` / `ErrEmptyDescription` / `ErrInvalidSalaryRange` | `domain/entities/job.go` | **YES** — create MUST enforce non-empty title/description and (both-present) `salary_min <= salary_max`, same sentinels as PATCH. |
| `repositories.JobRepository` + `UpdatePatch` | `domain/repositories/jobRepository.go` | **Extend** — add a `Create` method; `UpdatePatch` is PATCH-only, not reused. |
| `dtos.JobEditorViewDto` + `dtos.CompanyDto` | `application/dtos/jobEditorViewDto.go`, `searchJobsDto.go` | **YES** — the POST response; it already carries `status` + `updated_at` + `company{id,name}`. |
| `usecases.JobService` / `NewJobService` | `application/usecases/jobService.go` | **Extend** — add `CreateJob`. |
| `usecases.toEditorView` | `application/usecases/updateJob.go` | **YES** — the single `JobForUpdate → JobEditorViewDto` projection (package-private, same package). |
| `http.JobHandler` / `JobHandlers()` / `requireCompanyContext` / `classifyError` | `infrastructure/http/jobHandler.go` | **Extend** — add `CreateJob` handler func to the accessor; add new sentinel branch(es) to `classifyError`. |
| postgres `JobRepository` / `NewJobRepository` / compile-time assertion / pgtype helpers | `infrastructure/postgres/jobRepository.go` | **Extend** — add `Create` + `buildCreateJobParams` + a create-specific `mapCreateError`; reuse `pgTextToStringPtr`/`pgInt4ToIntPtr`/`pgTimestamptzToTime`/`toJobForUpdateEntity`. |
| `main.go` hoisted `requireAuth` + `requireRecruiter` | `backend/cmd/api/main.go` | **YES** — already hoisted at `run()` scope; the POST route is a one-line `r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)`. |
| `mapUpdateError` (23514 → `ErrInvalidStatusTransition`) | `infrastructure/postgres/jobRepository.go` | **NO** — that is UPDATE-specific. Create needs its own `mapCreateError` (mirroring `companies`'s `mapCompanyCreateError`): `23503` → company FK gone; `23514` → CHECK defense-in-depth. |

**Net-new for create** (no reuse): a `CreateJob :one` sqlc query + regen; the repository `Create` port
method + adapter; `buildCreateJobParams`; `mapCreateError`; `CreateJobDto` (input); the `CreateJob` use
case; the `createJob` handler; one `main.go` route line; and at least one new domain sentinel
(`ErrCompanyNotActive`).

---

## 2. Schema facts — `backend/db/migrations/00007_jobs.sql`

`jobs` columns, classified by who supplies the value on an INSERT:

| Column | Type / constraint | Who fills on create |
|---|---|---|
| `id` | `UUID PRIMARY KEY` | **App MUST supply** — UUID v7, no DB default (comment: "UUID v7 is generated by the application — no DB default on `id`"). |
| `company_id` | `UUID NOT NULL REFERENCES companies(id)` | **App MUST supply** — from `CompanyContext.CompanyID`, never body/path. |
| `title` | `TEXT NOT NULL` | **App MUST supply** (required). Non-empty enforced in domain only (no CHECK). |
| `description` | `TEXT NOT NULL` | **App MUST supply** (required). Non-empty enforced in domain only. |
| `work_mode` | `TEXT NOT NULL` + CHECK (`onsite|remote|hybrid`) | **App MUST supply** (required, parsed VO). |
| `employment_type` | `TEXT NOT NULL` + CHECK (`full_time|part_time|contract|internship`) | **App MUST supply** (required, parsed VO). |
| `seniority` | `TEXT NOT NULL` + CHECK (`intern|junior|mid|senior|lead`) | **App MUST supply** (required, parsed VO). |
| `status` | `TEXT NOT NULL DEFAULT 'draft'` + CHECK | **DB fills** (default `draft`). Create may omit it; if supplied must be `draft` (locked decision #1). |
| `location` | `TEXT` (nullable) | **Optional** (nil → NULL). |
| `salary_min` | `INTEGER` (nullable) | **Optional** (nil → NULL). |
| `salary_max` | `INTEGER` (nullable) | **Optional** (nil → NULL). |
| `salary_currency` | `TEXT NOT NULL DEFAULT 'MXN'` + CHECK (`USD|MXN`) | **Optional** — nil → DB default `MXN` (locked decision #2). |
| `published_at` | `TIMESTAMPTZ` (nullable) | **DB leaves NULL** (draft has no publish timestamp). |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | **DB fills**. |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | **DB fills**. |
| `deleted_at` | `TIMESTAMPTZ` (nullable) | **DB leaves NULL**. |
| `search_vector` | `tsvector GENERATED ALWAYS AS (...) STORED` | **DB fills — app MUST NOT write it.** The INSERT column list and RETURNING list must both exclude `search_vector` (a `GENERATED ALWAYS` column rejects explicit writes; and sqlc would map a tsvector to `interface{}` — the existing queries deliberately use explicit column lists for this reason). |

Integrity guard `jobs_published_integrity_check CHECK (status <> 'published' OR published_at IS NOT NULL)`
is trivially satisfied by a `draft` row.

**No cross-field CHECK** for `salary_min <= salary_max`; **no non-empty CHECK** for title/description
(only NOT NULL). Both rules are domain-enforced — exactly as `jobs-write-side` did for PATCH.

---

## 3. Active-company status resolution

**Today there is no runtime "is this company active?" check.** The only active enforcement is the SQL
predicate `c.status = 'active'` inside the two public read queries (`jobs.sql`: `SearchJobs` and
`GetJobByID`) and a one-off data backfill in migration `00004_companies_active_default.sql`
(`UPDATE companies SET status='active' WHERE status='pending_verification'` — data, not runtime).

Facts that the create check can build on:

- `entities.Company` has `Status valueobjects.CompanyStatus` (enum: `PendingVerification`=0, `Active`=1,
  `Suspended`=2; `String()` → `active`/`suspended`/`pending_verification`), parsed by
  `valueobjects.ParseCompanyStatus`.
- `companies/repositories.CompanyRepository.GetByID(ctx, id)` returns the full entity **including
  `Status`** (adapter `toEntity` runs `ParseCompanyStatus(row.Status)`). This is an existing, reusable
  query.
- There is **no** `IsActive`, `GetCompanyStatus`, `ErrCompanyNotActive`, or "company active" helper
  anywhere in the codebase.

So the active gate is **new** either way. Two candidate homes (see §7 open questions):

- **(A) Use-case check via the companies repo** — inject `repositories.CompanyRepository` (from
  `companies/domain`) into `JobService`, call `GetByID(companyID)`, and reject when
  `Status != valueobjects.Active`. Cross-feature dependency is **precedented**:
  `CompanyMemberService` already depends on both `identity` user repo and `companies` repo
  (`companyService.go::NewCompanyServiceWithBootstrap`). Pro: reuses an existing query, no new SQL.
  Con: TOCTOU window between check and INSERT (a company could be suspended in between); couples jobs →
  companies domain.
- **(B) SQL guard inside the INSERT** — `INSERT INTO jobs (...) SELECT <values> FROM companies c WHERE
  c.id = $company_id AND c.status = 'active'` (or a CTE), returning 0 rows → sentinel. Pro: atomic (no
  TOCTOU), mirrors the read path's SQL-level `status='active'` invariant, keeps jobs independent of the
  companies port. Con: a new query shape and a new 0-rows → sentinel mapping in the adapter.

**Sentinel**: a new `entities.ErrCompanyNotActive` (or `ErrCompanyInactive`) is required regardless of
(A) or (B). Note the company is guaranteed to *exist* by the time create runs — `RequireCompanyRole`
resolved a membership row (`company_members`) before the handler was reached — so the realistic reject
case is "suspended / pending-verification", not "missing company". If option (B) is chosen, its 0-rows
also collapses "company missing" into the same sentinel (defense-in-depth; unreachable via the designed
flow). Mirror the `jobs-write-side` precedent of reusing a flat `classifyError` branch: the sentinel maps
to a 4xx (status code open — see §7).

---

## 4. Reference create flow — `companies`

`POST /companies` (`CreateCompanyWithOwner`) is the closest POST precedent and the pattern to mirror:

| Layer | File | What it does |
|---|---|---|
| DTO | `application/dtos/createCompanyDto.go` | Raw strings/primitives; required fields non-pointer, optional profile fields `*string`/`*int`. The use case owns VO parsing. |
| Use case | `application/usecases/createCompany.go` / `createCompanyWithOwner.go` | `buildCompany` → `entities.NewCompany(name, rfc, industryID, profile)`. The **entity factory** validates VOs and generates `id` via `uuid.NewV7()`. `CreateCompanyWithOwner` additionally resolves `sub → users.id` and builds the owner membership. |
| Entity | `domain/entities/company.go::NewCompany` | `uuid.NewV7()` for id; sets `Status = Active` (MVP: companies are born active); returns the aggregate. |
| Repository port | `domain/repositories/companyRepository.go` | `Create(ctx, *entities.Company) error` + `GetByID`. |
| Adapter | `infrastructure/postgres/companyRepository.go` | `Create` → `queries.CreateCompany(ctx, buildCreateParams(company))` → `mapCompanyCreateError`. `GetByID` → `pgx.ErrNoRows` → `ErrCompanyNotFound`. |
| sqlc | `db/queries/companies.sql` | `CreateCompany :one` — `INSERT INTO companies (...) VALUES ($1..$16) RETURNING *`; `GetCompanyByID :one` — `SELECT * WHERE id=$1 AND deleted_at IS NULL`. Generated `CreateCompanyParams` + `(Company, error)`. |
| Error mapping | `mapCompanyCreateError` | SQLSTATE `23505` (unique_violation) → `ErrDuplicateCompany` (409); `23503` (foreign_key_violation) → `ErrIndustryNotFound` (400). Unknown → pass-through (500). |
| Handler | `infrastructure/http/handler.go::createCompany` | Reads `security.Claims` (RequireAuth) → decode body → `CreateCompanyWithOwner` → `classifyCreateCompanyError` → **`http.StatusCreated` (201)** with the full `companyResponse` body. |
| Wiring | `cmd/api/main.go` | `r.With(RequireAuth).Post("/companies", companyHandlers.CreateCompany)` via the `CompanyHandlers()` accessor (split from the public `GET /companies/{id}`). |

**What a `CreateJob` use case + repository `Create` + sqlc `CreateJob :one` would mirror:**

- `CreateJob(ctx, companyID uuid.UUID, in dtos.CreateJobDto) (*dtos.JobEditorViewDto, error)`.
- Generate `id := uuid.NewV7()` (the **same call** `companies`/`identity` use in their entity factories —
  `company.go`, `companyMember.go`, `user.go`; no shared helper beyond `uuid.NewV7()`).
- Parse `work_mode`/`employment_type`/`seniority` via `Parse*`; parse optional `salary_currency` (nil →
  `MXN`); trim + non-empty `title`/`description`; `salary_min <= salary_max` when both non-nil.
- Resolve active-company (see §3), then `repo.Create(...)`.
- Map `23503` (company FK gone) and `23514` (CHECK) in a create-specific `mapCreateError`; `23505` is
  **not** expected (no unique business key; business decision #4 = no dedupe; the only unique constraint
  is the app-generated UUID v7 PK).
- Handler returns **201** (matching `companies` POST) or 200 (open — §7).

---

## 5. Gap analysis — `POST /jobs` end-to-end

### 5.1 sqlc — new `CreateJob :one` (required)

Add to `backend/db/queries/jobs.sql` + regen (`go tool sqlc generate`). `INSERT ... RETURNING` the
**editor-view columns** so the adapter can map to `entities.JobForUpdate` and reuse `toEditorView`:

```sql
-- name: CreateJob :one
INSERT INTO jobs (
    id, company_id, title, description, work_mode, employment_type,
    seniority, status, location, salary_min, salary_max, salary_currency
)
VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    'draft',
    sqlc.narg('location')::text,
    sqlc.narg('salary_min')::int,
    sqlc.narg('salary_max')::int,
    COALESCE(sqlc.narg('salary_currency')::text, 'MXN')
)
RETURNING <explicit editor-view columns>;
```

Two shape decisions (see §7):

- **`RETURNING` column set + company name**: the editor view embeds `company{id,name}`. A plain
  `INSERT ... RETURNING jobs.*` cannot return `company_name`. Either (a) a CTE
  (`WITH ins AS (INSERT ... RETURNING ...) SELECT ins.<cols>, c.name AS company_name FROM ins JOIN
  companies c ON c.id = ins.company_id`) in one round trip, or (b) `RETURNING` the job-only columns then
  have the use case re-read via the existing `GetForUpdate` (second round trip, but reuses the existing
  `toJobForUpdateEntity` mapping verbatim).
- **Active guard (option B from §3)** folds the `WHERE EXISTS (SELECT 1 FROM companies WHERE id=$company_id
  AND status='active')` predicate into the INSERT (or CTE).

`status` is written explicitly as `'draft'` (locked decision #1) rather than relying on the DEFAULT,
which keeps the INSERT self-documenting and immune to a future DEFAULT change. `search_vector` is
excluded from both the column list and RETURNING (STORED generated — must not be written/scanned).

### 5.2 Repository port + adapter

- Extend `repositories.JobRepository` with `Create(ctx, id, companyID uuid.UUID, params CreateJobParams)
  (*entities.JobForUpdate, error)` (exact signature is a design call — see §7). A `CreateJobParams`
  value type (or reuse the DTO-free param struct) carries the validated, parsed values.
- Adapter `Create`: call `queries.CreateJob(ctx, buildCreateJobParams(...))`; `pgx.ErrNoRows` (only
  possible if the active-guard predicate matches 0 rows) → `entities.ErrCompanyNotActive`; else
  `mapCreateError` (`23503` → company FK gone; `23514` → CHECK defense-in-depth); then map the row to
  `JobForUpdate` (reuse `toJobForUpdateEntity` if the column set matches `GetJobForUpdateRow`, else a
  sibling mapper).

### 5.3 Use case — `CreateJob`

Signature: `func (s *JobService) CreateJob(ctx context.Context, companyID uuid.UUID, in dtos.CreateJobDto)
(*dtos.JobEditorViewDto, error)`.

Flow (mirrors `EditJob`'s validation ordering, minus CAS/transition):

1. Active-company check (§3) — reject non-active with `ErrCompanyNotActive`.
2. Validate `title`/`description` non-empty after trim → `ErrEmptyTitle`/`ErrEmptyDescription`.
3. Parse required `work_mode`/`employment_type`/`seniority` → VO sentinels on unknown.
4. Parse optional `salary_currency` → `ParseSalaryCurrency`; nil → `MXN` (default).
5. `salary_min <= salary_max` when both non-nil → `ErrInvalidSalaryRange` (mirror PATCH rule).
6. `id := uuid.NewV7()`.
7. Build `CreateJobParams` + `repo.Create(...)`.
8. Project the returned row via `toEditorView` (200/201 body).

No optimistic concurrency (a new row has nothing to CAS against); no status transition (always born
`draft`).

### 5.4 DTOs

- **Input** `application/dtos/createJobDto.go::CreateJobDto` (new):
  `Title string`, `Description string`, `WorkMode string`, `EmploymentType string`, `Seniority string`
  (all required non-pointer), `Location *string`, `SalaryMin *int`, `SalaryMax *int`,
  `SalaryCurrency *string` (optional). No `company_id` (from `CompanyContext`), no `id`/`status`/
  timestamps (immutable/server-managed).
- **Response** — reuse `dtos.JobEditorViewDto` (already carries `status`, `updated_at`, `company`). For a
  freshly-created draft this renders `status="draft"`, `published_at` omitted (NULL), `updated_at` =
  DB `now()`. Returning the editor view is the **right** choice: `updated_at` is exactly the
  `If-Unmodified-Since` token the recruiter needs to immediately `PATCH /jobs/{id}` to publish.

### 5.5 Handler + wiring

- `http.JobHandler`: add `CreateJob http.HandlerFunc` to the `JobHandlers` struct + accessor; add
  unexported `createJob` (mirror `updateJob` but no path id, no CAS header): `requireCompanyContext`
  (fail-closed 500) → decode `CreateJobDto` (400 on malformed) → `service.CreateJob(ctx, cc.CompanyID,
  in)` → `classifyAndWriteError`. Note: `requireCompanyContext` is the existing helper in
  `jobHandler.go`.
- `classifyError`: add `ErrCompanyNotActive` → 4xx (status open, §7). The required-field/validation
  sentinels already exist and already classify correctly.
- `main.go`: `jobHandlers := jobHandler.JobHandlers()` already exists; add
  `r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)` next to the existing
  `Patch("/jobs/{id}", …)` line. `requireAuth`/`requireRecruiter` are already hoisted — no new wiring.
  The public `r.Mount("/jobs", jobHandler.Routes())` (GETs) must NOT gain the POST.

---

## 6. Facts that constrain the proposal (already grounded)

- `company_id` is directly on the `jobs` row; the create writes it from `CompanyContext` only.
- `search_vector` is Postgres STORED generated — create MUST NOT list it in the INSERT column list or
  RETURNING list (same rationale as the existing explicit-column-list queries).
- UUID v7 generation is `uuid.NewV7()` (google/uuid) — already used by `companies`/`identity` entity
  factories; no new helper needed.
- `requireAuth` + `requireRecruiter` are already hoisted in `main.go`; `requireRecruiter` =
  `RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.RecruiterRole)` (owner passes via
  ordinal `owner(2) >= recruiter(1)`).
- The public read path stays visibility-narrowed (`status='published' AND deleted_at IS NULL AND
  company.status='active'`), so a freshly-created `draft` is automatically hidden from `GET /jobs` and
  `GET /jobs/{id}` — no read-side change needed.

---

## 7. Open design questions (for the proposal round — flag only)

1. **Response status code**: `200` vs `201`. Reference `POST /companies` returns `201 Created`. Recommend
   `201` for create semantics, but pin it.
2. **Response shape**: editor view (`JobEditorViewDto`) vs a minimal `{id}` envelope. Recommend the
   editor view — it carries `status="draft"` and the authoritative `updated_at` the client needs as the
   CAS token for the follow-up `PATCH /jobs/{id}`.
3. **`CreateJob` RETURNING shape**: CTE join for `company_name` in one round trip vs `RETURNING` job-only
   columns then re-read via the existing `GetForUpdate` (reuses `toJobForUpdateEntity` verbatim, two
   round trips). The reuse map (§1) leans on `GetForUpdate`-shaped columns either way.
4. **Where the active-company check lives**: use-case check via injected `companies.CompanyRepository`
   (reuses `GetByID`, but TOCTOU + cross-feature dep) vs SQL guard inside the INSERT (atomic, mirrors the
   read path's `status='active'`, new query shape). Recommend the SQL guard for atomicity.
5. **`ErrCompanyNotActive` HTTP status**: 403 (forbidden — the caller's company may not act) vs 409/422/
   400. The middleware guarantees membership, so this is strictly an "inactive company" case, not a
   missing-resource case.
6. **`salary_min <= salary_max` on create**: mirror the PATCH "both present and non-null" rule exactly, or
   also reject a lone `salary_min` that exceeds an absent `salary_max`? PATCH deliberately allows the
   transient lone-field state; create should pin whether it does the same or a stricter final-state check.
7. **Repository `Create` signature / params**: reuse a `repositories.CreateJobParams` value type (parsed
   VOs + optional pointers) vs passing the already-built `*entities.JobForUpdate`. The domain currently
   has no jobs factory (read model + projection only); decide whether to introduce an `entities.NewJob`
   factory (mirroring `companies.NewCompany`) or keep UUID generation + param construction in the use case.
8. **`status` explicit vs default**: write `'draft'` explicitly in the INSERT (self-documenting) vs omit
   and rely on the DB DEFAULT. Both satisfy locked decision #1; pin for clarity.
