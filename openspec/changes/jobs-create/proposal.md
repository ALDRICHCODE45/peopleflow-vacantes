# Proposal: `jobs-create`

Status: proposal (pre-spec). Grounded by `openspec/changes/jobs-create/exploration.md`. Artifacts produced in this phase: this file only (no spec, design, or tasks yet).

## 1. Intent

Introduce the **create** write endpoint `POST /jobs` to the `jobs` feature so that a recruiter of an active company can draft a new vacancy through the public API instead of inserting rows out-of-band. The first slice is a single `POST /jobs` endpoint plus its supporting use case, repository method, sqlc query, and handler wiring. No new infrastructure dependency, no new migration, no change to the public read API or the existing `PATCH /jobs/{id}` write path.

## 2. Problem / opportunity

Today the write-side slice (`jobs-write-side`, archived at `openspec/changes/archive/2026-08-24-jobs-write-side/`) lets recruiters edit, publish, and close an existing job — but there is no API surface that creates one. Every "new vacancy" today is a row inserted by direct SQL, which is the only channel that exists for `INSERT INTO jobs`. That asymmetry closes the write-side loop half-built: the recruiter can transition a draft to published, but cannot reach `status='draft'` without bypassing the API. This change closes that gap by turning "draft a vacancy" into a real, audited, gated HTTP path that reuses the `jobs-write-side` machine (VOs, editor-view projection, gated route pattern, error classification).

## 3. Target users and situations

- **Recruiter drafting a new vacancy** — `POST /jobs` with the required field set, receives the editor view, then immediately calls `PATCH /jobs/{id}` (with `If-Unmodified-Since` set to the just-returned `updated_at`) to publish. The CAS token for the follow-up PATCH is the `updated_at` from the create response — the same editor view `jobs-write-side` already produces, so the client code path is identical.
- **Owner drafting a new vacancy** — passes the `recruiter` gate automatically because `MemberRole` is ordinal (`owner(2) ≥ recruiter(1)`).
- **Recruiter of a non-active (suspended / `pending_verification`) company** — the SQL guard returns 0 rows; the response is `ErrCompanyNotActive`. Because `RequireCompanyRole` already resolved a valid membership, the realistic reject case is "company state blocks the action", not "membership missing".
- **Recruiter whose company was active at the gate but suspended between the middleware resolution and the INSERT** — impossible under the SQL guard: the active check lives inside the same statement that writes the row, so the predicate cannot drift between read and write.

## 4. Locked business decisions (DO NOT re-open)

These decisions are pinned by the product owner this session and are reflected verbatim in the proposal; subsequent phases (spec, design) MUST honor them.

1. **POST creates in `draft`** — the row's `status` is born `'draft'` via an explicit INSERT value (the DB DEFAULT is also `'draft'`; the explicit value is self-documenting and immune to a future DEFAULT change). A freshly-created draft is invisible to `GET /jobs` and `GET /jobs/{id}` because the existing visibility predicate requires `status='published'`.
2. **Required fields** = `title`, `description`, `work_mode`, `employment_type`, `seniority` (NOT NULL columns on `jobs`). `salary_currency` is optional in the body and defaults to `MXN`. `location`, `salary_min`, `salary_max` are optional.
3. **Only an `active` company can create** — the active check is enforced atomically inside the INSERT (no TOCTOU window); a non-active company is rejected with a new sentinel `entities.ErrCompanyNotActive`.
4. **No dedupe** — there is no unique business key beyond the app-generated UUID v7 primary key. SQLSTATE 23505 is therefore not a design concern on this path.
5. **`company_id` is authoritative from `CompanyContext`** — never from the body or the path. The middleware injects `security.CompanyContext{CompanyID}`; the handler and use case MUST ignore any `company_id` value supplied by the client.
6. **Gate** = `RequireAuth` + `RequireCompanyRole(recruiter)`. Owner passes via ordinal `owner(2) ≥ recruiter(1)`. Same as `PATCH /jobs/{id}`.

## 5. Locked technical decisions (from the proposal question round, DO NOT re-open)

These are pinned by the architect round and MUST be honored verbatim in spec and design.

1. **Status code** on success: `201 Created` (mirrors `POST /companies`; create semantics, not update).
2. **Response body**: the **full `dtos.JobEditorViewDto`** — same wire shape as the PATCH 200/409 response. The freshly-created row renders `status="draft"`, `published_at` omitted (NULL), `updated_at` = DB `now()`. Returning the editor view gives the client the `updated_at` it needs as the `If-Unmodified-Since` CAS token for the immediate follow-up PATCH, with no extra round trip.
3. **Active-company check location**: an **atomic SQL guard inside the INSERT** (no TOCTOU; mirrors the read path's `c.status='active'` predicate in `SearchJobs` / `GetJobByID`). The exact guard shape is open for design (see §15 open items); the proposal recommends a `WITH active AS (SELECT id, name FROM companies WHERE id = $1 AND status = 'active') INSERT … FROM active RETURNING …` so 0 rows on a non-active company maps directly to the new sentinel.
4. **`salary_min <= salary_max`** is validated by the use case **only when both fields are present and non-nil** — mirror the PATCH rule verbatim (decision recorded for `jobs-write-side`, design §11). A lone `salary_min` is permitted; the cross-field check is not a final-state rule on create.

## 6. Scope (first slice)

### 6.1 HTTP surface

- **NEW** `POST /jobs` — gated by `RequireAuth` + `RequireCompanyRole(recruiter)`. Path carries no id; the `{id}` is generated by the server (UUID v7) and returned in the body. `company_id` is **never** read from the body or path — it is taken from `security.CompanyContext{CompanyID}` injected by the middleware. Success returns `201 Created` with the editor view.

### 6.2 Application / domain additions

- `application/dtos/createJobDto.go` (NEW) — input DTO with raw string/pointer fields mirroring the required/optional set pinned by locked decision #2. Required fields are non-pointer `string`s; optional fields are `*string` / `*int` so the wire distinguishes absent (nil) from present-null (the JSON `null` semantic is identical to absent on the create path because optional columns go to NULL regardless — see §15 open item #6). No `company_id`, no `id`, no `status`, no timestamps.
- `application/usecases/createJob.go` (NEW) — `CreateJob(ctx, companyID uuid.UUID, in dtos.CreateJobDto) (*dtos.JobEditorViewDto, error)`:
  1. Parse required `work_mode` / `employment_type` / `seniority` via `Parse*`; unknown VO → 400.
  2. Parse optional `salary_currency` via `ParseSalaryCurrency`; nil → `MXN` (default; see §15 open item #6).
  3. Trim + non-empty check on `title` / `description` → `ErrEmptyTitle` / `ErrEmptyDescription`.
  4. `salary_min <= salary_max` when both non-nil → `ErrInvalidSalaryRange`.
  5. Generate `id := uuid.NewV7()` (same call used by `entities.NewCompany` / `NewCompanyMember` / `NewUser` factories — no new helper).
  6. `repo.Create(ctx, …)` — returns the row mapped to `*entities.JobForUpdate` (so `toEditorView` is reused verbatim) or `ErrCompanyNotActive` on the 0-rows guard.
  7. `toEditorView(row)` for the 201 body.
- `application/usecases/jobService.go` (MOD) — add `CreateJob` method, declare `CreateJobUseCase` interface next to `EditJob`, keep `NewJobService` signature unchanged (the repo port is the only constructor argument).

### 6.3 Domain

- `domain/entities/job.go` (MOD) — add a new sentinel `ErrCompanyNotActive` (`errors.New("company is not active")`). No other sentinels are added; the existing `ErrEmptyTitle`, `ErrEmptyDescription`, `ErrInvalidSalaryRange`, and the four `valueobjects.ErrInvalid*` are reused verbatim from PATCH.
- `domain/repositories/jobRepository.go` (MOD) — extend the `JobRepository` port with a `Create(ctx, id, companyID uuid.UUID, params CreateJobParams) (*entities.JobForUpdate, error)` method. The signature takes a `CreateJobParams` value type (parsed VOs + optional pointers) rather than a `*entities.JobForUpdate` so the port stays free of generated SQL types and so the use case owns UUID generation + param construction (no `entities.NewJob` factory is introduced — the domain remains a pure read model for jobs, matching the existing package contract).

### 6.4 Persistence (sqlc)

- **NEW** query in `backend/db/queries/jobs.sql`:
  - `CreateJob :one` — an atomic `WITH active AS (SELECT id, name FROM companies WHERE id = $1 AND status = 'active') INSERT INTO jobs (...) SELECT … FROM active RETURNING <editor-view columns + company_name>` shape (precise column list and guard shape are open design items — see §15). The active guard collapses the "company gone" and "company not active" cases to the same 0-rows outcome; the adapter maps that to `entities.ErrCompanyNotActive` (defense-in-depth; the gate guarantees a valid membership row).
- **NEW** `mapCreateError` in the postgres adapter — `pgx.ErrNoRows` → `ErrCompanyNotActive` (0 rows on the guard); SQLSTATE `23503` (FK on `company_id`) → distinct sentinel `ErrCompanyGone` (defense-in-depth — unreachable via the designed flow because `RequireCompanyRole` already resolved a real membership); SQLSTATE `23514` (CHECK on `status` / `work_mode` / `employment_type` / `seniority` / `salary_currency`) → `ErrInvalidStatusTransition` (defense-in-depth for the CHECKs; unreachable via the designed flow because the use case parses the VOs first). `23505` is not mapped (no dedupe — locked decision #4).
- **NEW** `buildCreateJobParams` — translates `CreateJobParams` into the sqlc `CreateJobParams` struct (mirror of `buildUpdateJobParams`; closed-set VOs go through `workModeToText` / `employmentTypeToText` / `seniorityToText` / `salaryCurrencyToText`; optional nullable pointers through `pgTextToStringPtr` / `pgInt4ToIntPtr`; the identity columns `id` and `company_id` are always populated).
- **NEW** `toJobForUpdateFromCreateRow` — sibling mapper from the `CreateJobRow` shape to `entities.JobForUpdate`. If the RETURNING column set is identical to `GetJobForUpdate`'s, the existing `toJobForUpdateEntity` is reused verbatim (recommended path — see §15 open item #3).
- Regen `backend/internal/db/jobs.sql.go` via `go tool sqlc generate`. The existing four queries (`SearchJobs`, `GetJobByID`, `GetJobForUpdate`, `UpdateJob`) are unchanged.

### 6.5 Infrastructure / wiring

- `infrastructure/http/jobHandler.go` (MOD):
  - Add a `createJob` handler func, mirroring `updateJob` but with no path id and no CAS header: `requireCompanyContext` (fail-closed 500 if missing) → decode `CreateJobDto` (400 on malformed JSON) → `service.CreateJob(ctx, cc.CompanyID, in)` → write `201 Created` with the editor view on success / `classifyAndWriteError` on failure.
  - Extend `JobHandlers` accessor struct with `CreateJob http.HandlerFunc`.
  - Extend `classifyError` with one new branch: `ErrCompanyNotActive` → `409 Conflict` with message `"company is not active"` (see §7 for the rationale). The other error sentinels are already classified.
- `cmd/api/main.go` (MOD):
  - One new route line on the gated subtree:
    `r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)`.
  - `requireAuth` and `requireRecruiter` are already hoisted at `run()` scope (`jobs-write-side` already added them); no new wiring.
  - The public `r.Mount("/jobs", jobHandler.Routes())` MUST NOT gain the POST — same routing-split defense as `PATCH /jobs/{id}` (the per-method `JobHandlers()` accessor + the explicit gated `Post(...)` line is the structural guarantee).

## 7. Error taxonomy decision — pin `ErrCompanyNotActive` to `409 Conflict`

The middleware (`RequireCompanyRole`) has already admitted the request — the caller IS a member of the company. The reject is therefore not about who the caller is, but about the company state: the company's `status` is `suspended` (or `pending_verification`), which conflicts with the requested action. `409 Conflict` is the standard HTTP semantic for a state-machine conflict between the request and the current resource state. The mapping is added as one new branch to `classifyError`:

| Outcome | HTTP status | Body |
|---|---|---|
| `ErrCompanyNotActive` | `409 Conflict` | `{"error": "company is not active"}` |

Alternatives considered and rejected:
- **`403 Forbidden`** — the caller IS a member; forbidding them would obscure the state vs permission distinction and is also exactly the status that risks leaking row existence when membership and resource visibility overlap. The membership is fine; the company state is not.
- **`422 Unprocessable Entity`** — semantically adjacent but typically used for validation failures on the request body. The conflict here is on a server-side resource state, not on the request payload.
- **`400 Bad Request`** — same problem as `422`; the body is well-formed.

The precedent on the same handler already maps `ErrConcurrencyConflict` to `409 Conflict` (the `PATCH /jobs/{id}` flow's CAS race). Both are "the request was well-formed and authorized, but the system state refuses it" — `409` is the consistent choice.

## 8. Business rules (locked, spec-ready)

### 8.1 Required vs optional input

| Field | Required in body? | Wire type | Default on absent |
|---|---|---|---|
| `title` | YES | `string` | — (400 if absent or empty after trim) |
| `description` | YES | `string` | — (400 if absent or empty after trim) |
| `work_mode` | YES | `string` | — (400 if unknown VO) |
| `employment_type` | YES | `string` | — (400 if unknown VO) |
| `seniority` | YES | `string` | — (400 if unknown VO) |
| `location` | NO | `*string` | SQL NULL |
| `salary_min` | NO | `*int` | SQL NULL |
| `salary_max` | NO | `*int` | SQL NULL |
| `salary_currency` | NO | `*string` | `'MXN'` (DB DEFAULT; use case may also default in Go — see §15 open item #6) |
| `status` | NO | n/a (not in DTO) | always `'draft'` (locked decision #1) |
| `company_id` | NO | n/a (not in DTO) | from `CompanyContext` (locked decision #5) |
| `id`, `created_at`, `updated_at`, `published_at`, `deleted_at`, `search_vector` | NO | n/a | server-managed / immutable / STORED generated |

The wire does NOT distinguish `null` from absent on the create path: optional fields go to SQL NULL regardless (no "clear to null" semantics — there is no prior value to clear). This is why plain `*string` / `*int` pointers are used instead of `valueobjects.Optional[T]`. The PATCH path's tri-state codec is irrelevant here.

### 8.2 Validation rules

- `title`, `description` MUST be non-empty after `strings.TrimSpace`.
- `work_mode` MUST parse via `valueobjects.ParseWorkMode` (`onsite` / `remote` / `hybrid`).
- `employment_type` MUST parse via `valueobjects.ParseEmploymentType` (`full_time` / `part_time` / `contract` / `internship`).
- `seniority` MUST parse via `valueobjects.ParseSeniority` (`intern` / `junior` / `mid` / `senior` / `lead`).
- `salary_currency`, when present, MUST parse via `valueobjects.ParseSalaryCurrency` (`USD` / `MXN`).
- `salary_min <= salary_max` when both are present and non-nil. A lone `salary_min` is allowed (a transient min-only state is permitted; the cross-field check is not a final-state rule — matches the PATCH behavior).
- The owning company MUST be `active` at INSERT time (atomic SQL guard).

### 8.3 Error taxonomy

| Outcome | HTTP status | Body / sentinel |
|---|---|---|
| Body is not valid JSON | `400 Bad Request` | `{"error": "invalid JSON body"}` |
| Empty title (whitespace-only or empty string) | `400 Bad Request` | `{"error": "title must not be empty"}` (`ErrEmptyTitle`) |
| Empty description | `400 Bad Request` | `{"error": "description must not be empty"}` (`ErrEmptyDescription`) |
| `salary_min > salary_max` (both present) | `400 Bad Request` | `{"error": "salary_min must be less than or equal to salary_max"}` (`ErrInvalidSalaryRange`) |
| Unknown `work_mode` | `400 Bad Request` | `{"error": "invalid work_mode"}` (`ErrInvalidWorkMode`) |
| Unknown `employment_type` | `400 Bad Request` | `{"error": "invalid employment_type"}` (`ErrInvalidEmploymentType`) |
| Unknown `seniority` | `400 Bad Request` | `{"error": "invalid seniority"}` (`ErrInvalidSeniority`) |
| Unknown `salary_currency` | `400 Bad Request` | `{"error": "invalid salary_currency"}` (`ErrInvalidSalaryCurrency`) |
| No `Authorization` header / unverifiable token | `401 Unauthorized` | `RequireAuth` short-circuit |
| Authenticated but not a member of any company / role below `recruiter` | `403 Forbidden` | `RequireCompanyRole` short-circuit |
| `company_id` from body / path (would be a leak) | n/a | handler MUST ignore any body/path `company_id`; the middleware is the only source |
| Owning company is not `active` (suspended / pending_verification / 0 rows on the SQL guard) | **`409 Conflict`** | `{"error": "company is not active"}` (`ErrCompanyNotActive`) |
| Anything else (DB unavailable, unexpected pg error, …) | `500 Internal Server Error` | `{"error": "internal server error"}` (real error logged at `slog.Error`) |

### 8.4 Gate

- Single gate: `RequireAuth` + `RequireCompanyRole(recruiter)`. Owner passes via `MemberRole` ordinal. No owner-only distinction is drawn for create in this slice (recruiter and owner have the same authoring capability).

### 8.5 Response body

- `201 Created` with `dtos.JobEditorViewDto`. The freshly-created draft renders `status="draft"`, `published_at` omitted (NULL column → `omitempty` strips it), `updated_at` = the row's DB `now()`, `company: {id, name}` populated.

## 9. Non-goals (out of scope for this change)

- **No dedupe** — locked decision #4. There is no unique business key beyond UUID v7.
- **No draft-count limits** — a company may create an unlimited number of drafts.
- **No `status` field in the request body** — the row is always born `draft` (locked decision #1). A client wanting `published` calls `PATCH /jobs/{id}` immediately after create.
- **No notifications / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous.
- **No public read change** — `GET /jobs` and `GET /jobs/{id}` shapes are unchanged. A freshly-created draft is invisible to both because the existing visibility predicate requires `status='published'`.
- **No new migration** — the `jobs` table already has every column the create path needs. No DB hardening is added (the `title` / `description` non-empty rule and the `salary_min <= salary_max` rule stay domain-enforced, mirroring PATCH).
- **No `Optional[T]`** — create uses plain `*string` / `*int` pointers; the tri-state codec is PATCH-only (see §8.1 and §15 open item #6).
- **No `entities.NewJob` factory** — the domain stays a pure read model (matches the package contract). UUID generation lives in the use case (consistent with `companies.NewCompany` factory that the `companies` slice already owns).

## 10. Affected areas (file inventory)

All under `backend/`. New files marked **NEW**; modified files marked **MOD**.

- **MOD** `backend/db/queries/jobs.sql` — add `CreateJob` query.
- **MOD** `backend/internal/db/jobs.sql.go` — regen via `go tool sqlc generate` (do not hand-edit). Gains `CreateJobRow`, `CreateJobParams`, `CreateJob`.
- **MOD** `backend/internal/features/jobs/domain/entities/job.go` — new sentinel `ErrCompanyNotActive`.
- **MOD** `backend/internal/features/jobs/domain/repositories/jobRepository.go` — extend port with `Create` + `CreateJobParams` value type.
- **NEW** `backend/internal/features/jobs/application/dtos/createJobDto.go`.
- **NEW** `backend/internal/features/jobs/application/usecases/createJob.go`.
- **MOD** `backend/internal/features/jobs/application/usecases/jobService.go` — add `CreateJob` method + `CreateJobUseCase` interface; `NewJobService` signature unchanged.
- **MOD** `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` — `Create`, `buildCreateJobParams`, `mapCreateError`, sibling mapper (or reuse `toJobForUpdateEntity` per §15 open item #3).
- **MOD** `backend/internal/features/jobs/infrastructure/http/jobHandler.go` — `createJob` handler, `JobHandlers.CreateJob` field, `classifyError` extended with `ErrCompanyNotActive → 409`.
- **MOD** `backend/cmd/api/main.go` — one new line: `r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)`.

No changes under `backend/internal/features/identity`, `backend/internal/features/companies`, `backend/internal/features/candidates`, or `backend/db/migrations/`.

## 11. New infrastructure dependency

None. No new package, no new env var, no new docker-compose service, no new migration. The slice reuses the existing `uuid` (google/uuid), `pgx/v5`, `pgconn`, and `pgtype` packages already imported by the `jobs` slice.

## 12. Risks

1. **Routing split** — the POST route shares the path root (`/jobs`) with the public GETs. If a future refactor reverts to a single `chi.Mount("/jobs", …)` subrouter that includes the write route, the create path becomes publicly reachable. The per-method `JobHandlers()` accessor + the explicit `r.With(...).Post(...)` line in `main.go` is the defense; the spec must call it out, and a handler test that hits the route with no `Authorization` header MUST assert `401`.
2. **Company-id injection in body** — a client sending `{"company_id":"<other-uuid>"}` MUST NOT affect the write target. The DTO does not declare `company_id` (it is intentionally absent from the struct), so `encoding/json` decodes the field as a no-op. The middleware is the single source of `company_id`. The spec MUST pin this.
3. **Active-company race** — between the `RequireCompanyRole` middleware and the INSERT, a company could be suspended. The atomic SQL guard eliminates the window because the active predicate lives in the same statement that writes the row. There is no "check then write" sequence in the use case to race.
4. **`search_vector` write attempt** — the STORED generated column rejects explicit writes. The INSERT column list MUST exclude `search_vector` (sqlc would also map a `tsvector` to `interface{}`); the existing queries already establish this explicit-column-list convention. The spec MUST pin the exclusion.
5. **`status` default drift** — the proposal writes `'draft'` explicitly in the INSERT rather than relying on the DB DEFAULT so the create is self-documenting and immune to a future DEFAULT change. The spec MUST pin the explicit value.
6. **`salary_min <= salary_max` consistency with PATCH** — the create rule must match PATCH exactly so a "create then later patch" round-trip does not silently flip legality. Both reject the violation only when both fields are present; both permit the lone-field transient state.
7. **`pgx.ErrNoRows` on the guard** — the only path that produces 0 rows is "company is not active" (the `WITH active AS …` CTE yields zero rows). The adapter maps that to `ErrCompanyNotActive`; `ErrJobNotFound` is NOT surfaced here (the row never existed, and `pgx.ErrNoRows` already maps to a distinct sentinel — the spec MUST NOT reuse `ErrJobNotFound` for this case).
8. **Domain-only validation** — `title` / `description` non-empty and `salary_min <= salary_max` are NOT DB-enforced (no `CHECK` in migration `00007_jobs.sql`). A future migration could harden them; this slice leaves them in the use case, matching PATCH.

## 13. Rollback plan

Simplest safe rollback: **revert the merge commit**. Because there is no migration, no schema change, no new package, and no env var:

- Reverting `main.go` removes the `POST /jobs` route registration. The pre-existing public `GET /jobs` and `GET /jobs/{id}` keep working; the pre-existing gated `PATCH /jobs/{id}` keeps working.
- Reverting the handler / use case / repository / sqlc files restores the prior write-side slice; any caller that had integrated against the new route loses the endpoint on deploy.
- No data migration is needed in either direction (no column added, no column dropped, no data backfill).
- No feature flag is required for the first rollout; if a staged rollout is later desired, gating `POST /jobs` behind an env flag (e.g., `FEATURE_JOBS_CREATE_ENABLED`) in `main.go` is a one-line addition that costs nothing in this slice.

## 14. Success criteria

- A recruiter of an active company `A` can `POST /jobs` with the required fields and receive `201 Created` with a `JobEditorViewDto` body carrying `status="draft"` and the authoritative `updated_at`.
- The same `POST /jobs` followed immediately by `PATCH /jobs/{id}` with `If-Unmodified-Since: <updated_at>` and `{"status":"published"}` succeeds; the row moves to `status="published"` and `published_at` is set within the request window. The round-trip exercises the editor-view projection as both the create response and the CAS source for the publish.
- A recruiter of a `suspended` company `A` sending `POST /jobs` receives `409 Conflict` with body `{"error":"company is not active"}`.
- A recruiter of an active company `A` sending `{"company_id":"<uuid-of-company-B>"}` in the body writes a row owned by `A` (the body value is ignored; the middleware is the only source).
- An unauthenticated request to `POST /jobs` receives `401` (the route is behind `RequireAuth`).
- A recruiter of company `B` sending `POST /jobs` is rejected with `403` by `RequireCompanyRole` before the handler runs (non-member of `A`).
- Empty `title`, empty `description`, `salary_min > salary_max`, unknown `work_mode` / `employment_type` / `seniority` / `salary_currency` each return `400` with the corresponding sentinel message.
- A freshly-created `draft` is invisible to `GET /jobs` and `GET /jobs/{id}` (the existing `status='published'` predicate hides it; verified by a re-read after create).
- Strict TDD: every behavior above has a RED test that pre-dates its GREEN implementation; `go test ./...` is green; `go vet ./...` is clean.

## 15. Open items for the design phase (flag, do not pre-decide)

These are explicitly routed to design; the proposal does NOT pin them.

1. **Exact `CreateJob :one` SQL guard shape** — the proposal recommends a CTE-based `WITH active AS (SELECT id, name FROM companies WHERE id = $1 AND status = 'active') INSERT … FROM active RETURNING …` so 0 rows on the guard maps directly to `ErrCompanyNotActive` and `company.name` is available for the editor-view projection in the same round trip. Alternatives: (a) a `WHERE EXISTS` predicate in the INSERT, (b) `INSERT … RETURNING <job cols>` then a second `SELECT` for `company.name` (two round trips), (c) `INSERT … RETURNING …, (SELECT name FROM companies WHERE id = $1)` so the company subquery is a scalar subselect in the RETURNING list. All three satisfy the atomicity requirement; the design phase picks one based on sqlc ergonomics and the column-shape reuse question below.
2. **`RETURNING` column set** — must be wire-shape-compatible with `JobForUpdate` / `JobEditorViewDto`. If the design picks the same explicit column list as `GetJobForUpdate` (15 cols + `company_name`), the adapter reuses `toJobForUpdateEntity` verbatim. If the design picks a narrower list (no `company_id` / `company_name` because the values are already known at the use case), the adapter needs a sibling mapper. The design phase picks one.
3. **UUID v7 generation site** — use case (recommended; consistent with `companies.NewCompany`) vs sqlc `RETURNING id` from a DB default. The schema comment pins UUID v7 to be generated by the application — DB default on `id` is deliberately absent. The use case MUST call `uuid.NewV7()`. (Recorded for design to prevent drift.)
4. **`JobForUpdate` vs a lighter create projection** — should the create path reuse the existing `JobForUpdate` entity (the editor view is then `toEditorView(*entities.JobForUpdate)` reused verbatim) or introduce a narrower `entities.CreatedJob` that the adapter maps to the editor view? The reuse map in `exploration.md §1` leans on `JobForUpdate` — the design phase either confirms or rejects.
5. **`salary_currency` default handling** — let the DB DEFAULT (`'MXN'`) do the work (omit the column from the INSERT list, rely on the schema default) vs have the use case fill `salary_currency = "MXN"` in Go when the body omitted it (then include the column in the INSERT). Both satisfy locked decision #2. The design phase picks one for clarity.
6. **`pgx.ErrNoRows` → `ErrCompanyNotActive`** — the adapter maps 0 rows on the guard to `ErrCompanyNotActive` (NOT `ErrJobNotFound`). The HTTP layer maps `ErrCompanyNotActive` to `409`. The `pgx.ErrNoRows` message itself is generic; the mapping is the contract. (Recorded because the explicit mapping is easy to confuse with the existing `mapGetError` precedent.)
7. **`CreateJobDto` optional fields as plain `*string` / `*int`** vs re-using `valueobjects.Optional[T]` — the locked decision is plain pointers (no tri-state on create), but the design phase should re-confirm that absent and JSON-`null` are semantically identical on the create path (both → SQL NULL). The PATCH codec is intentionally NOT reused because the create path has no "leave the column untouched" semantic — every optional field either becomes NULL or takes the supplied value.

## 16. Cross-references

- `openspec/changes/jobs-create/exploration.md` — the grounding (read first).
- `openspec/changes/archive/2026-08-24-jobs-write-side/proposal.md` and `…/specs/jobs/spec.md` — the delivered PATCH precedent (reused VOs, editor-view projection, gated route pattern, error classification).
- `backend/internal/features/companies/infrastructure/http/handler.go::createCompany` — the POST precedent (201 + full response body; RequireAuth + claims.Subject for `company_id` resolution; `classifyCreateCompanyError` flat dispatcher).
- `backend/internal/features/companies/infrastructure/postgres/companyRepository.go::mapCompanyCreateError` — the create-error-mapping precedent (SQLSTATE → domain sentinel; `pgx.ErrNoRows` → `ErrCompanyNotFound`).
- `backend/internal/features/companies/infrastructure/http/memberHandler.go::MemberHandlers()` — the per-method accessor pattern mirrored by `JobHandlers()`.
- `backend/internal/features/companies/domain/entities/company.go::NewCompany` — the `uuid.NewV7()` factory precedent.
- `backend/db/migrations/00007_jobs.sql` — the `jobs` schema (NOT NULL set, CHECKs, STORED `search_vector`, DB DEFAULTs on `status` and `salary_currency`).
- `backend/cmd/api/main.go` (lines around `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", …)`) — the composition-root pattern for layered per-route middleware; the new POST lives next to the existing PATCH on the same gated subtree.
- `openspec/config.yaml` (`proposal` rules) — rollback, file paths, infra dependencies all honored.