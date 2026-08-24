# Exploration: `jobs-write-side`

Status: exploration (pre-proposal grounding). Read-only; no code changes.

Scope: introduce the **write-side** to the `jobs` feature (currently public read-only), anchored on
"edit a vacancy" end-to-end. Business rule #2 (decided, not re-litigated here): **any recruiter of a
company can edit any vacancy of that same company**; owner ⊇ recruiter, and both can create/edit.
Membership is modeled in `company_members` (migration `00009`), enforced by the `RequireCompanyRole`
middleware.

---

## 1. Current-state map — `jobs` feature slice

All paths under `backend/internal/features/jobs/`. The slice is **read-only today**: no factory, no
write use case, no write repository method, no write sqlc query.

| Layer | File | What it holds |
|---|---|---|
| domain/entities | `job.go` | `Job` read model (no factory), `CompanyRef{ID,Name}`, `ErrJobNotFound` |
| domain/valueobjects | `jobStatus.go` | `JobStatus{Draft,Published,Closed}` + `ParseJobStatus`/`String` |
| | `employmentType.go` | `FullTime,PartTime,Contract,Internship` |
| | `seniority.go` | `Intern,Junior,Mid,Senior,Lead` |
| | `workMode.go` | `Onsite,Remote,Hybrid` |
| | `salaryCurrency.go` | `USD,MXN` |
| domain/repositories | `jobRepository.go` | `JobRepository` port: `Search`, `GetByID`; `SearchParams`, `Cursor` |
| application/dtos | `searchJobsDto.go` | `SearchJobsDto`, `CompanyDto`, `SearchJobsItem`, `SearchJobsResult` |
| application/usecases | `jobService.go` | `JobService{repo}` composition target |
| | `searchJobs.go` | `SearchJobs` (normalize → cursor → limit+1 → DTO) |
| | `getJobByID.go` | `GetJobByID` (thin delegate) |
| application/cursor | `cursor.go` | base64url(JSON) keyset codec |
| infrastructure/http | `jobHandler.go` | `JobHandler{service}`, `Routes()`, `classifyError` |
| infrastructure/postgres | `jobRepository.go` | `*db.Queries` adapter: `Search`, `GetByID`, `toEntity`, `mapGetError` |

### Public API today (exact surface)

- `GET /jobs` — **public**, no auth. Query params (all optional + tolerant): `q`, `seniority`,
  `work_mode`, `employment_type`, `location`, `currency`, `cursor`, `limit` (default 20). Envelope
  `{items:[...], next_cursor:string|null}`. Invalid/unknown params are silently ignored (no 400).
- `GET /jobs/{id}` — **public**, no auth. Returns the **bare** job object (same shape as a list item),
  or 404 for non-existent/draft/closed/soft-deleted/non-active-company.

Wire item shape (`SearchJobsItem`): `id, title, description, work_mode, employment_type, seniority,
location*, salary_min*, salary_max*, salary_currency, published_at*, company{id,name}`. Asterisk =
`omitempty` pointer (absent when NULL). **Not exposed**: `status`, `deleted_at`, `created_at`,
`updated_at`, `search_vector`, and raw `company_id` (replaced by embedded `company`).

### sqlc queries today

`backend/db/queries/jobs.sql` has exactly two queries; `backend/internal/db/jobs.sql.go` generates only
`SearchJobs` + `GetJobByID` (plus their `Params`/`Row` types). **No write query exists.** Both read
queries are visibility-narrowed (`status='published' AND deleted_at IS NULL AND company.status='active'`),
so **neither can back the write path** (a draft/closed job, or a job of a non-active company, is invisible
to both).

### Schema (`00007_jobs.sql`)

`jobs`: `id UUID PK` (app-generated UUID v7, no DB default), `company_id UUID NOT NULL REFERENCES
companies(id)`, `title/description TEXT NOT NULL`, `work_mode/employment_type/seniority TEXT NOT NULL` with
CHECKs, `status TEXT NOT NULL DEFAULT 'draft'` CHECK `draft|published|closed`, `location TEXT`,
`salary_min/salary_max INTEGER`, `salary_currency TEXT NOT NULL DEFAULT 'MXN'` CHECK `USD|MXN`,
`published_at TIMESTAMPTZ`, `created_at/updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
`deleted_at TIMESTAMPTZ`, STORED generated `search_vector tsvector` (Postgres-maintained; app MUST NOT
write it), plus 3 indexes. Integrity guard: `CHECK (status <> 'published' OR published_at IS NOT NULL)`.

Notable: **no** cross-field CHECK for `salary_min <= salary_max`; **no** length/non-empty CHECK on
`title`/`description` (only NOT NULL). `company_id` is directly on the row.

---

## 2. Authn/authz chain

Resolution order: `Cognito sub → users.id → company_members → (company_id, role)`.

1. **`RequireAuth`** (`identity/infrastructure/http/middleware.go`): reads `Authorization: Bearer`,
   calls `security.Verifier.Verify` → `security.Claims{Subject, Groups}`; injects via
   `security.ContextWithClaims`. Failure → 401 (`respondUnauthorized`).
2. **`security.Verifier`** port (`identity/domain/security/verifier.go`); RSA impl
   (`identity/infrastructure/auth/rsa_verifier.go`) pinned to `IDENTITY_JWT_*` env; fail-closed
   `denyAllVerifier` when env absent (never silently admits).
3. **`RequireCompanyRole(users, members, minRole)`** (`identity/infrastructure/http/requireCompanyRole.go`):
   - `Claims.Subject` empty → 401.
   - `users.GetByCognitoSub(sub)` → `users.id`; `ErrUserNotFound` → 401.
   - `members.GetMembershipByUserID(user.ID)` → membership; `ErrNotAMember` → 403.
   - `member.Role < minRole` → 403 (ordinal comparison).
   - success → injects `security.CompanyContext{CompanyID, Role}` via `security.ContextWithCompanyContext`.
4. **`CompanyContext`** (`identity/domain/security/companyContext.go`): consumers read with
   `CompanyContextFromContext(ctx) (CompanyContext, bool)`; handlers short-circuit fail-closed on
   `ok=false`.

### `company_members` model + roles

`company_members` (`00009`): `id`, `user_id UNIQUE`, `company_id`, `role` CHECK `owner|recruiter`,
timestamps. `MemberRole` VO (`companies/domain/valueobjects/memberRole.go`): `UnknownMemberRole(0)`,
`RecruiterRole(1)`, `OwnerRole(2)`. `role >= minRole` means **owner passes any recruiter gate**
(owner ⊇ recruiter) — exactly the business rule.

### `/me/company` routes (existing gating reference)

- `GET /me/company` — `RequireAuth` only (ungated by role; non-member → 404).
- `GET /me/company/members` — `RequireCompanyRole(recruiter)`.
- `POST/PATCH/DELETE /me/company/members[/{id}]` — `RequireCompanyRole(owner)`.

**What a gated handler receives**: `security.CompanyContext{CompanyID uuid.UUID, Role MemberRole}`.
The handler must use `cc.CompanyID` for all mutating queries; path/body company identifiers are ignored.

---

## 3. Reference slice — `companies` (per `openspec/config.yaml`)

Write-side patterns to reuse (all confirmed in `backend/internal/features/companies/`):

- **Use-case structure**: `CompanyService`/`CompanyMemberService` as composition targets. Gated use
  cases take `companyID uuid.UUID` (from `CompanyContext`) — **not** `cognitoSub`; only the ungated
  `GetMyMembership`/`CreateCompanyWithOwner` resolve `sub`. Business-rule validation lives in the use
  case (`AddMember` checks `target.UserType == recruiter` before persisting).
- **Repository port + adapter**: domain `repositories.*` interface; postgres adapter wraps
  `*db.Queries` (or a narrow `memberQuerier` seam for stub-ability), `var _ repositories.X = (*X)(nil)`
  compile-time assertion. Same-company guard lives **in SQL** (`WHERE id=$1 AND company_id=$2`),
  `:execrows` 0-rows → `ErrMemberNotFound`.
- **DTOs**: raw strings/primitives in `application/dtos`; the use case owns parsing via VOs.
- **Error mapping**: domain sentinels in `entities`; `classifyXxxError` flat `errors.Is` dispatch in the
  HTTP layer (400/404/409/500); `mapCreateError` in postgres adapter maps SQLSTATE `23505`→duplicate,
  `23503`→FK-missing; unknown SQLSTATE pass-through → 500.
- **Handler test patterns**: stdlib `httptest` + `chi.Mux` + hand-rolled stub repos; a
  `newMemberRouter` helper injects `Claims` and/or `CompanyContext` into the request context. Strict
  TDD (`strict_tdd: true`): RED-first.
- **Composition root** (`backend/cmd/api/main.go`): manual wiring repo → service → handler; per-method
  `MemberHandlers()`/`CompanyHandlers()` accessors so main.go can layer per-route middleware
  (`r.With(requireOwner).Post(...)`) that a single `chi.Mount(Routes())` subrouter can't express.

---

## 4. Gap analysis — "edit a vacancy" end-to-end

### 4.1 New sqlc query (required)

Add to `backend/db/queries/jobs.sql` + regen:

- **`UpdateJob :execrows`** (or `:one` with `RETURNING`): `UPDATE jobs SET <editable cols>,
  updated_at = now() WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`. 0 rows → `ErrJobNotFound`
  (same-company guard, mirroring `UpdateMemberRole`). Must **not** touch `search_vector`, `company_id`,
  `created_at`, `id`. Status/`published_at` handling must be deliberate (see 4.4).
- **`GetJobForUpdate :one`** (recommended) — a company-scoped, **non-visibility-narrowed** read:
  `SELECT ... FROM jobs WHERE id=$1 AND company_id=$2 AND deleted_at IS NULL` (returns `status`,
  `updated_at`, `company_id`, all editable cols) so the use case can validate the current status/version
  before updating. The existing `GetJobByID`/`SearchJobs` are visibility-narrowed and **cannot** serve
  drafts/closed/inactive-company jobs.

### 4.2 Repository port + adapter

- Extend `repositories.JobRepository` (or add a separate write port) with `Update(ctx, id, companyID,
  params)` and `GetForUpdate(ctx, id, companyID)`.
- Adapter (`infrastructure/postgres/jobRepository.go`): map `:execrows` 0-rows → `entities.ErrJobNotFound`;
  add `mapUpdateError` if any SQLSTATE (e.g., 23514 for the published-integrity CHECK) should map to a
  4xx rather than a raw 500.

### 4.3 Use case + DTOs

- `UpdateJobDto` (input): editable fields as raw strings/primitives + `status` (optional) + an
  optimistic-concurrency token (see 4.5). `company_id` NOT on the input (comes from `CompanyContext`).
- Use case `EditJob(ctx, companyID, jobID, dto)`: parse VOs (`ParseJobStatus`, `ParseWorkMode`, etc.),
  enforce non-empty title/description and `salary_min <= salary_max`, enforce status-transition rules,
  then `repo.Update`.
- Response DTO: decide shape — likely mirror `SearchJobsItem` but with `status` (the public read item
  omits `status`). The editor needs `status` back.

### 4.4 Validation / status-transition rules (to be pinned in proposal)

- **Editable fields**: `title, description, work_mode, employment_type, seniority, location, salary_min,
  salary_max, salary_currency, status`. **Not editable**: `id`, `company_id`, `created_at`, `published_at`
  (derived from status), `search_vector` (Postgres-owned).
- **Status transitions** (domain-level; DB only enforces the published→published_at invariant):
  - `draft → published`: MUST set `published_at = now()` (same transaction).
  - `published → closed`: `published_at` policy (keep for audit vs NULL it) — open.
  - `closed → ?`: reopen policy (re-publish resets `published_at`?) — open.
  - Editing a `published` job's non-status fields: preserve `published_at`; `search_vector` auto-refreshes
    (STORED generated).
- **Non-empty** title/description and `salary_min <= salary_max` are **not** DB-enforced today — enforce
  in the domain use case (or optionally add a CHECK migration).

### 4.5 Optimistic concurrency

`jobs.updated_at` already exists (no `version`/`xmin` column). Options: (a) compare-and-set on
`updated_at` (client sends last-known `updated_at`; `UPDATE ... AND updated_at = $n` → 0 rows = 409/412),
or (b) skip for MVP. `updated_at` is touched by the `UPDATE` itself, so it is the natural precondition.
This is an **open design question** (see §5).

### 4.6 Authz wiring

- Write route must be `RequireAuth` + `RequireCompanyRole(recruiter)` (owner passes via `role >= minRole`).
  The existing `r.Mount("/jobs", jobHandler.Routes())` is **public** and must not gain the write route.
- Use the per-method handler pattern (`JobHandlers()` accessor) and mount in main.go, e.g.
  `r.With(requireRecruiter).Patch("/jobs/{id}", jobsHandlers.UpdateJob)`. `requireRecruiter` is already
  constructible in main.go (`RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.RecruiterRole)`);
  `identityUserRepo` and `memberRepo` are already wired.
- The handler reads `security.CompanyContextFromContext` → `cc.CompanyID`, fails closed (500) if absent,
  and passes `cc.CompanyID` (never a body/path company id) to the use case.

### 4.7 Migration

**Prefer NO migration** — the `jobs` table already contains every column the write-side needs
(`company_id`, all editable fields, `status`, `published_at`, `updated_at`, `deleted_at`). The only
candidate schema additions are optional hardening (not required for the feature):
- `CHECK (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max)`.
- non-empty `title`/`description` CHECK — **not** recommended (would diverge from existing seed data and
  invite a data-migration decision).

No migration is required to deliver edit; enforce those two rules in the domain layer.

### 4.8 Entity gap

The domain `Job` is a **pure read model**: no `company_id` field (flattened into `CompanyRef`), no
factory. The write-side needs either (a) a small write projection/entity carrying `company_id`,
`status`, `updated_at` (from `GetJobForUpdate`), or (b) extend `Job` with a `CompanyID uuid.UUID` field
and a factory. This is a design decision to resolve in the proposal (lean `GetJobForUpdate` row vs.
full write aggregate).

---

## 5. Risks and open design questions (for the proposal round)

1. **Endpoint shape**: `PATCH /jobs/{id}` (partial) vs `PUT /jobs/{id}` (full replace). Reference slice
   uses `PATCH` for partial updates (`PATCH /me/company/members/{id}` updates only `role`). Recommend
   `PATCH` with explicit field presence semantics, but confirm.
2. **Status transition policy**: single `PATCH` with `status` in the body vs dedicated publish/close
   endpoints. Who may publish/close (recruiter? owner-only?) — business rule #2 says any recruiter can
   "edit", but publish/close may deserve a tighter policy. Must be pinned.
3. **Can you edit a published vacancy?** If yes, what happens to `published_at` (preserve on field-only
   edits; reset only on a re-publish transition)? Does editing a published job re-rank the board
   (`search_vector` auto-updates — acceptable)? Is `closed` terminal or re-openable?
4. **Field-level editability** of `salary_min`/`salary_max` and `salary_currency` (partial patch must not
   clobber absent fields; distinguish "not provided" vs "set to NULL/empty").
5. **Optimistic concurrency**: use `updated_at` as a compare-and-set precondition, or accept last-write-wins
   for MVP? If CAS, wire it as an `If-Unmodified-Since` header vs a body field, and map conflict to 409/412.
6. **Read-for-write visibility**: the write path needs a non-visibility-narrowed, company-scoped fetch;
   decide whether to add `GetJobForUpdate` (recommended) and its exact return columns.
7. **Response shape**: editor-facing response should include `status` (omitted from the public read item).
   Decide whether to extend `SearchJobsItem` or add a `JobDetail`/`JobWrite` response DTO.
8. **`salary_min <= salary_max` and empty title/description**: DB has no guard; domain validation only, or
   a hardening migration? Recommend domain-only for now (no migration).
9. **Routing/security**: the write route shares the `/jobs/{id}` path with the public read; ensure the
   public `Routes()` mount and the gated write are wired with the per-method-handler split so no write is
   ever reachable without `RequireAuth`+`RequireCompanyRole`.

---

## Key decisions already grounded (not re-litigated)

- Business rule #2: recruiter can edit any vacancy of the same company; owner ⊇ recruiter.
- `company_id` is on the `jobs` row; status domain is `draft → published → closed` with the
  `published ⇒ published_at IS NOT NULL` DB CHECK.
- `search_vector` is Postgres-maintained; app code MUST NOT write it.
- Reference implementation is `companies` (hexagonal vertical slice, manual composition root).
