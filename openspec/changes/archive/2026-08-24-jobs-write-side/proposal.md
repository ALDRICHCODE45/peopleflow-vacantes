# Proposal: `jobs-write-side`

Status: proposal (pre-spec). Grounded by `openspec/changes/jobs-write-side/exploration.md`. Artifacts produced in this phase: this file only (no spec, design, or tasks yet).

## 1. Intent

Introduce the **write-side** to the `jobs` feature (currently public read-only) so that recruiters and owners of a company can edit a vacancy end-to-end: change field values, move a vacancy through the `draft → published → closed` lifecycle, and detect concurrent edits via optimistic concurrency. The first slice is a single `PATCH /jobs/{id}` endpoint plus its supporting use case, repository methods, sqlc queries, and handler wiring. No new infrastructure dependency, no new migration.

## 2. Problem / opportunity

Today the `jobs` slice is read-only. There is no API surface a recruiter can call to publish a draft, close a published role, fix a typo on a live vacancy, or update compensation. Business rule #2 from the product owner — *any recruiter of a company can edit any vacancy of that same company* — is therefore unenforceable: the only "edit" channel today is a direct SQL update. This change turns that business rule into a real, audited, gated HTTP path and lays the write-side groundwork (use case, repository port, sqlc patterns) that future slices (creation, re-open, delete) will extend.

## 3. Target users and situations

- **Recruiter drafting a role** — creates the row out-of-band (or via a future `POST /jobs`), then calls `PATCH /jobs/{id}` with `status: "published"` to publish; the DB's `status ↔ published_at` CHECK forces `published_at = now()` in the same transaction.
- **Recruiter editing a live vacancy** — fixes a typo in `description`, lowers `salary_max`, or relocates the role; field-only edits to a `published` job preserve `published_at` and let the Postgres `STORED` `search_vector` regenerate automatically.
- **Recruiter closing a role** — calls `PATCH /jobs/{id}` with `status: "closed"`; the row leaves the public listing and becomes terminal in this change.
- **Two recruiters editing concurrently** — the slower writer's CAS token no longer matches and the server returns `409 Conflict`; the client re-reads and retries.
- **Owner performing any of the above** — passes the `recruiter` gate automatically because `MemberRole` is ordinal and `owner(2) ≥ recruiter(1)`.

## 4. Locked business decisions (DO NOT re-open)

These decisions are pinned by the product owner this session and are reflected verbatim in the proposal; subsequent phases (spec, design) MUST honor them.

1. **Endpoint shape**: `PATCH /jobs/{id}`. Partial update. Fields that are absent from the request body are NOT touched. For the explicitly nullable fields (`location`, `salary_min`, `salary_max`) the wire distinguishes "not provided" (absent) from "explicitly null" (present and `null`) in the JSON payload.
2. **Publish/close authority**: any recruiter of the company may execute `draft → published` and `published → closed`. Owner passes the `recruiter` gate automatically (`MemberRole` ordinal). Single gate: `RequireCompanyRole(recruiter)`.
3. **Lifecycle**: published jobs are editable; `published_at` is preserved on field-only edits and the Postgres `STORED` `search_vector` regenerates automatically. **Closed is terminal in this change** — there is no re-open transition.
4. **Optimistic concurrency**: client sends the last-known `updated_at` value; server runs `UPDATE … WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND updated_at = $token`; zero rows on the CAS precondition → `409 Conflict`. The CAS token is the **pre-edit** `updated_at` (i.e., the value the client last read, before its user started typing).
5. **Draft → published invariant**: the same SQL `UPDATE` MUST set `published_at = now()` whenever `status` transitions to `published`, so the DB CHECK `status <> 'published' OR published_at IS NOT NULL` holds. The transition is one transaction, not two writes.

## 5. Scope (first slice)

### 5.1 HTTP surface

- **NEW** `PATCH /jobs/{id}` — gated by `RequireAuth` + `RequireCompanyRole(recruiter)`. Path `{id}` is the job UUID; `company_id` is **never** read from the body or the path — it is taken from `security.CompanyContext{CompanyID}` injected by the middleware.

### 5.2 Application / domain additions

- `application/dtos/updateJobDto.go` — input DTO with raw string/pointer fields for the editable set plus an optional `status` pointer and an `IfUnmodifiedSince` (CAS) token.
- `application/dtos/jobEditorViewDto.go` — editor-facing response DTO (must include `status` and `updated_at`, which the public read item omits).
- `application/usecases/updateJob.go` — `EditJob(ctx, companyID, jobID, dto)` use case:
  1. `repo.GetJobForUpdate(ctx, id, companyID)` → load current `status` + `updated_at` + editable cols.
  2. Validate CAS precondition (`dto.IfUnmodifiedBefore` matches current `updated_at`); mismatch → `ErrConcurrencyConflict` → 409.
  3. Parse optional VOs (`ParseJobStatus`, `ParseWorkMode`, `ParseEmploymentType`, `ParseSeniority`, `ParseSalaryCurrency`); unknown / empty values → 400.
  4. Enforce the locked status-transition table (see §6); illegal transition → `ErrInvalidStatusTransition` → 400.
  5. Enforce non-empty `title`/`description` and `salary_min ≤ salary_max` at the domain layer (no DB guard today).
  6. Build the column patch; `repo.Update(ctx, id, companyID, patch, casToken)` inside the same tx where applicable.
- `application/usecases/jobService.go` — add `EditJob` to `JobService` so the composition root stays a single wiring point.

### 5.3 Domain

- Extend `domain/entities/job.go` with the small write projection needed for `GetJobForUpdate`: `CompanyID uuid.UUID`, `Status JobStatus`, `UpdatedAt time.Time` (read model already has the editable columns).
- Extend `domain/repositories/jobRepository.go` with:
  - `GetForUpdate(ctx, id, companyID) (*Job, error)` — non-visibility-narrowed, company-scoped (used only by the gated write path; 0 rows → `ErrJobNotFound`).
  - `Update(ctx, id, companyID, patch UpdatePatch, casUpdatedAt time.Time) error` — same-company guard in SQL, `:execrows` 0-rows → `ErrJobNotFound` (cross-company or soft-deleted); 0-rows-on-CAS-but-row-exists → `ErrConcurrencyConflict`.
- New domain sentinels: `entities.ErrConcurrencyConflict`, `entities.ErrInvalidStatusTransition`. Validation errors stay use-case-level (no sentinel; `classifyXxxError` decides 400 vs 500).

### 5.4 Persistence (sqlc)

- **NEW** `backend/db/queries/jobs.sql`:
  - `GetJobForUpdate :one` — `SELECT … FROM jobs WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL` (no `status='published'` filter, no `companies.status='active'` filter; the write path needs to see drafts and rows of non-active companies).
  - `UpdateJob :execrows` — `UPDATE jobs SET <editable columns conditional on patch>, updated_at = now() WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND updated_at = $3`. Status-aware: when the patch sets `status='published'`, also sets `published_at = COALESCE(published_at, now())`; when `status='closed'`, leaves `published_at` alone (see §6.4).
- Regen `backend/internal/db/jobs.sql.go` via `sqlc generate`. The existing two queries (`SearchJobs`, `GetJobByID`) are unchanged.

### 5.5 Infrastructure / wiring

- New `infrastructure/postgres/jobRepository.go` method bodies for `GetForUpdate` and `Update`; add `mapUpdateError` that handles SQLSTATE `23514` (CHECK violation) → `ErrInvalidStatusTransition` (defense-in-depth; the use case should already block the bad transition).
- Extend `infrastructure/http/jobHandler.go` with `JobHandlers()` accessor (mirrors `companies/infrastructure/http/memberHandler.go::MemberHandlers()`): returns a `JobHandlers{ UpdateJob http.HandlerFunc }` struct so the composition root can mount the write route with its own middleware.
- `cmd/api/main.go` wiring change: split the existing public `r.Mount("/jobs", jobHandler.Routes())` block. Keep `r.Get("/jobs", …)` and `r.Get("/jobs/{id}", …)` public. Add `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)` on the gated subtree. The public mount MUST NOT gain the write route.

## 6. Business rules (locked, spec-ready)

### 6.1 Field editability matrix

| Field | Editable? | Nullable? | Wire presence | Notes |
|---|---|---|---|---|
| `id` | NO | n/a | n/a | Path param; immutable. |
| `company_id` | NO | n/a | n/a | Comes from `CompanyContext`; body/path value ignored. |
| `created_at` | NO | n/a | n/a | DB default. |
| `updated_at` | NO | n/a | n/a | Server-managed; CAS token. |
| `published_at` | NO | n/a | n/a | Server-managed per status transitions. |
| `search_vector` | NO | n/a | n/a | Postgres `STORED` generated; app MUST NOT write it. |
| `deleted_at` | NO | n/a | n/a | Soft-delete only via future endpoint. |
| `title` | YES | NO | required-if-present | Non-empty enforced in domain. |
| `description` | YES | NO | required-if-present | Non-empty enforced in domain. |
| `work_mode` | YES | NO | required-if-present | VO `ParseWorkMode`. |
| `employment_type` | YES | NO | required-if-present | VO `ParseEmploymentType`. |
| `seniority` | YES | NO | required-if-present | VO `ParseSeniority`. |
| `location` | YES | YES | optional, may be `null` | `null` or absent-as-empty clears the value. |
| `salary_min` | YES | YES | optional, may be `null` | If both set: `salary_min ≤ salary_max`. |
| `salary_max` | YES | YES | optional, may be `null` | If both set: `salary_min ≤ salary_max`. |
| `salary_currency` | YES | NO | required-if-present | VO `ParseSalaryCurrency`. |
| `status` | YES (transition only) | NO | optional | See transition table. |

### 6.2 Status transition table

| Current `status` | Requested `status` | Allowed? | Side effects |
|---|---|---|---|
| `draft` | `draft` | YES | Field-only edit; no `published_at` change. |
| `draft` | `published` | YES (gated: recruiter) | Server sets `published_at = now()`. |
| `draft` | `closed` | NO | 400 `ErrInvalidStatusTransition`. |
| `published` | `draft` | NO | 400 — no un-publish in this slice. |
| `published` | `published` | YES | Field-only edit; `published_at` preserved; `search_vector` regenerates. |
| `published` | `closed` | YES (gated: recruiter) | `published_at` is **kept** as audit history (closes the lifecycle but the original publish timestamp stays). |
| `closed` | `draft` | NO | 400 — `closed` is terminal. |
| `closed` | `published` | NO | 400 — `closed` is terminal in this change. |
| `closed` | `closed` | NO | 400 — terminal rows are immutable. |

When `status` is NOT present in the request body, the field is not touched; the transition table only applies to rows where the patch explicitly sets `status`.

### 6.3 CAS precondition semantics

- Client reads the job (via a future `GET /jobs/{id}` editor view OR by holding the previous response), captures `updated_at`.
- Client sends `PATCH /jobs/{id}` with the editable fields and an `If-Unmodified-Since` header (RFC 3339) carrying the captured `updated_at`.
- Server compares against the row's current `updated_at` (loaded by `GetJobForUpdate`); mismatch → 409 with the latest version in the response body so the client can re-read without an extra round-trip.
- Mismatch on the CAS token is a 409 even when the row exists; mismatch on the same-company guard is a 404 (the row is not visible to this company).

### 6.4 Same-company invariant

- The `Update` SQL carries `WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`. A job that exists but belongs to another company MUST surface as `ErrJobNotFound` (404), identical to the existing `UpdateMemberRole` pattern in the `companies` slice. This is the IDOR defense.

### 6.5 Gate

- Single gate: `RequireCompanyRole(recruiter)`. Owner passes because `MemberRole` is ordinal (`owner(2) ≥ recruiter(1)`). No owner-only distinction is drawn for publish/close in this slice.

## 7. Explicit non-goals (out of scope for this change)

- **No `POST /jobs`** — vacancy creation is a separate future cycle. Out of scope.
- **No re-open** — `closed → {draft, published}` is forbidden in this change.
- **No deletion** — soft-delete (`deleted_at`) is exposed only via future endpoints.
- **No new migration** — the `jobs` table already has every column the write path needs (`company_id`, all editable fields, `status`, `published_at`, `updated_at`, `deleted_at`, STORED `search_vector`). The two domain-only checks (`title/description` non-empty, `salary_min ≤ salary_max`) are enforced in the use case, not the DB.
- **No notification / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous.
- **No change to the public read API** — `GET /jobs` and `GET /jobs/{id}` shapes are unchanged; `SearchJobsItem` still omits `status`/`updated_at` so public consumers are unaffected.
- **No search reindexing changes** — the Postgres `STORED` `search_vector` and its `tsvector` expression are untouched.

## 8. Affected areas (file inventory)

All under `backend/`. New files marked **NEW**; modified files marked **MOD**.

- **MOD** `backend/db/queries/jobs.sql` — add `GetJobForUpdate`, `UpdateJob`.
- **MOD** `backend/internal/db/jobs.sql.go` — regen via `sqlc generate` (do not hand-edit).
- **MOD** `backend/internal/features/jobs/domain/entities/job.go` — write projection fields (`CompanyID`, `Status`, `UpdatedAt`); new sentinels (`ErrConcurrencyConflict`, `ErrInvalidStatusTransition`).
- **MOD** `backend/internal/features/jobs/domain/repositories/jobRepository.go` — add `GetForUpdate`, `Update` (and an `UpdatePatch` value type); keep `Search`/`GetByID` unchanged.
- **NEW** `backend/internal/features/jobs/application/dtos/updateJobDto.go`.
- **NEW** `backend/internal/features/jobs/application/dtos/jobEditorViewDto.go`.
- **NEW** `backend/internal/features/jobs/application/usecases/updateJob.go`.
- **MOD** `backend/internal/features/jobs/application/usecases/jobService.go` — add `EditJob` method.
- **MOD** `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` — `GetForUpdate`, `Update`, `mapUpdateError`.
- **MOD** `backend/internal/features/jobs/infrastructure/http/jobHandler.go` — `JobHandlers()` accessor, `updateJob` handler, `classifyAndWriteError` extended for the two new sentinels, status+field DTO projection.
- **MOD** `backend/cmd/api/main.go` — split `r.Mount("/jobs", …)`; add the gated `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)` route.

No changes under `backend/internal/features/identity`, `backend/internal/features/companies`, or `backend/db/migrations/`.

## 9. New infrastructure dependency

None. No new package, no new env var, no new docker-compose service, no new migration.

## 10. Risks

1. **Routing split** — the write route shares its path (`/jobs/{id}`) with the public read. If a future refactor reverts to a single `chi.Mount("/jobs", …)` subrouter, the write route would become publicly reachable. The per-method `JobHandlers()` accessor + explicit `r.With(...).Patch(...)` line in `main.go` is the defense; the spec must call it out, and a handler test that hits the route with no `Authorization` header MUST assert 401.
2. **CAS interaction with partial PATCH** — clients can PATCH only `description`, only `status`, or a mix. The use case MUST always re-read via `GetJobForUpdate` and compare the CAS token against that fresh read; it MUST NOT compare against the values in the patch body.
3. **Status + field mix** — a PATCH that sets `status='published'` AND changes `title` in the same call is allowed; the transaction must apply both atomically and set `published_at = now()` exactly once.
4. **Same-company 404 vs IDOR** — `Update` returning `ErrJobNotFound` for a cross-company id is the IDOR defense; the spec MUST NOT relax this to a 403 (leaking existence).
5. **Domain-only validation** — `title`/`description` non-empty and `salary_min ≤ salary_max` are NOT DB-enforced. A future migration could harden them; this slice leaves them in the use case.
6. **CAS clock skew** — `updated_at` is `TIMESTAMPTZ DEFAULT now()`; clients that round-trip through `time.Parse(time.RFC3339, …)` should be safe, but the spec must pin the wire format (see Open Item #5).
7. **`published_at` retention on close** — keeping `published_at` after a `published → closed` transition is an audit choice. A future "when was this last published?" question will rely on it; the spec must call it out so a later refactor doesn't accidentally null it.

## 11. Rollback plan

Simplest safe rollback: **revert the merge commit**. Because there is no migration, no schema change, no new package, and no env var:

- Reverting `main.go` removes the `PATCH /jobs/{id}` route registration. The pre-existing public `GET /jobs` and `GET /jobs/{id}` keep working.
- Reverting the handler / use case / repository / sqlc files restores the prior read-only slice; any caller that had integrated against the new route loses the endpoint on deploy.
- No data migration is needed in either direction (no column added, no column dropped, no data backfill).
- No feature flag is required for the first rollout; if a staged rollout is later desired, gating `PATCH /jobs/{id}` behind an env flag (e.g., `FEATURE_JOBS_WRITE_ENABLED`) in `main.go` is a one-line addition that costs nothing in this slice.

## 12. Success criteria

- A recruiter of company `A` can `PATCH /jobs/{id}` (status `draft → published`) and the public `GET /jobs` listing surfaces the job within one read.
- A recruiter of company `B` sending the same `PATCH` against the same `{id}` receives `404 job not found` (no IDOR leak).
- Two concurrent `PATCH`es with the same `updated_at` token: exactly one returns `200`; the other returns `409` with the latest version in the body.
- Editing a `published` job's `description` preserves `published_at` and causes `search_vector` to reflect the new text (verified by a re-search returning the job).
- Closing a job moves it out of the public `GET /jobs` listing and keeps `published_at` intact.
- A `closed` job rejects every further `PATCH` with `400` (terminal state).
- Strict TDD: every behavior above has a RED test that pre-dates its GREEN implementation; `go test ./...` is green; `go vet ./...` is clean.

## 13. Open items for the design phase (flag, do not pre-decide)

These are explicitly routed to design; the proposal does NOT pin them.

1. **Exact `GetJobForUpdate` return columns** — full `*Job` entity vs a narrower write projection (`id, company_id, status, updated_at, title, description, …`). Pro: reuse `*Job`. Con: `*Job` currently carries `Company.Name` from a JOIN it doesn't need.
2. **Editor response DTO shape** — extend `SearchJobsItem` (breaks public-read purity) vs introduce a dedicated `JobEditorView` DTO. The DTO MUST carry `status` and `updated_at`; whether it carries the company embedding and field set is the design call.
3. **Status-only PATCH** — whether `PATCH /jobs/{id}` with body `{"status":"published"}` and no field changes is allowed (and whether the response still carries the editor view). The transition table answers the legality; the ergonomics of a status-only call are a design call.
4. **Error taxonomy** — exact status code + body shape for each case:
   - `400 invalid job id` (UUID parse failure) — already pinned by the read path.
   - `400 invalid status transition` — locked decision maps to 400.
   - `400 validation` (unknown VO, empty title, `salary_min > salary_max`) — 400.
   - `401 unauthenticated` — RequireAuth.
   - `403 not a member / role too low` — RequireCompanyRole.
   - `404 job not found` — covers cross-company + soft-deleted + non-existent.
   - `409 conflict` — CAS precondition failed; body carries the current `updated_at`.
   - `500 internal` — everything else.
5. **`updated_at` wire format** — RFC 3339 string (human-friendly, matches typical `If-Unmodified-Since` semantics) vs Unix epoch int (cheap to compare). Recommend RFC 3339 for parity with the rest of the API, but spec must pin.
6. **CAS header vs body** — `If-Unmodified-Since` HTTP header vs `updated_at` field inside the JSON body. The header is the idiomatic HTTP choice and survives caching proxies; the body field survives `preflight` quirks. The spec must pick one.
7. **`JobHandlers` accessor naming** — `JobHandlers()` (matching `MemberHandlers()`) vs `Handlers()` (shorter). Trivial; record for consistency.

## 14. Cross-references

- `openspec/changes/jobs-write-side/exploration.md` — the grounding (read first).
- `backend/internal/features/companies/infrastructure/http/memberHandler.go` — `MemberHandlers()` per-method accessor pattern.
- `backend/internal/features/companies/infrastructure/postgres/memberRepository.go` — `UpdateMemberRole` SQL with same-company guard + 0-rows → `ErrMemberNotFound`.
- `backend/cmd/api/main.go` (lines around 183–225) — composition root pattern for layered per-route middleware.
- `backend/db/migrations/00007_jobs.sql` — schema invariant `CHECK (status <> 'published' OR published_at IS NOT NULL)`.
- `openspec/config.yaml` (`proposal` rules) — rollback, file paths, infra dependencies all honored.
