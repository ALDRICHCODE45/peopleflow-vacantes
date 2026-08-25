# Proposal: `jobs-reopen`

Status: proposal (user round resolved 2026-08-25 — ready for spec). Grounded by `openspec/specs/jobs/spec.md` (canonical read + write side, 25 requirements, 106 scenarios) and the archived write slices `openspec/changes/archive/2026-08-24-jobs-write-side/` and `openspec/changes/archive/2026-08-25-jobs-create/`. Artifacts produced in this phase: this file only (no spec, design, or tasks yet).

This proposal **MODIFIES** the canonical spec's `closed` rule, which is currently declared terminal across three places: the `Status Transition Table` requirement (every `closed → {draft, published, closed}` row is `NO → 400`), the `closed is terminal` scenario (rejects any body on a closed row, including field-only edits), and the canonical spec's `Out of scope (deferred)` list (line 7: "re-opening a closed job (`closed → {draft,published}`)"). Re-open removes that terminality for the explicit `closed → draft` and `closed → published` transitions on the existing `PATCH /jobs/{id}` endpoint.

## 1. Intent

Remove the `closed` terminality so a recruiter can bring a closed vacancy back to life (position opened again, hiring restarted). Concretely: a `PATCH /jobs/{id}` body of `{"status":"draft"}` or `{"status":"published"}` against a row whose current `status='closed'` MUST succeed (subject to the existing `If-Unmodified-Since` CAS, the existing same-company invariant, and the existing gated route). No new endpoint, no new handler, no new gate, no new repository method.

This is the **only** deferred capability from the canonical jobs spec being lifted. Soft-delete, notification/event publishing, `company_members` ownership changes, and a separate reopen endpoint stay out of scope.

## 2. Problem / opportunity

Today `closed` is terminal. A recruiter who closes a vacancy has no API path to bring it back — the row is frozen at `status='closed'`, edits of any kind are rejected with `400 invalid status transition`. The only escape is a direct SQL update, which bypasses audit, the `RequireCompanyRole(recruiter)` gate, and the CAS concurrency control. Re-open lifts that limitation through the same gated, audited, CAS-guarded PATCH path every other write goes through.

## 3. Target users and situations

- **Recruiter re-opening a closed role** — `PATCH /jobs/{id}` with body `{"status":"draft"}` (back to draft to revise before re-publishing) or `{"status":"published"}` (re-open to live immediately). Uses the editor-view `updated_at` they last read (or the one returned by a hypothetical editor `GET`) as the `If-Unmodified-Since` token. The same CAS guard the existing PATCH uses keeps two concurrent re-opens race-safe: exactly one wins, the other gets `409` with the latest editor view.
- **Recruiter re-opening AND editing in one call** — `PATCH /jobs/{id}` with `{"status":"published","title":"Senior Go Engineer (re-hire)"}` is allowed; the transition + field edits apply atomically and `published_at` follows the same SQL rule as `draft → published` (see §6.4).
- **Owner re-opening** — passes the existing `RequireCompanyRole(recruiter)` gate automatically (`owner(2) ≥ recruiter(1)` via `MemberRole` ordinal). Rule #2 ("any recruiter of the company edits any job") extends to re-open by the same gate; this is flagged as an assumption for the user round.

## 4. Locked business decisions (DO NOT re-open)

These decisions are pinned by the product owner this session and MUST be honored verbatim in spec and design.

1. **Endpoint**: re-open happens through the existing `PATCH /jobs/{id}`. No new route, no new handler. Body shape: `{"status":"draft"}` or `{"status":"published"}` (no other fields required; field-mix is allowed).
2. **Gate**: the existing `RequireAuth` + `RequireCompanyRole(recruiter)` middleware on the gated write subtree. Owner passes via `MemberRole` ordinal. Same gate as `PATCH /jobs/{id}` for edit/publish/close and as `POST /jobs` for create.
3. **Transitions lifted**: `closed → draft` and `closed → published` become legal. `closed → closed` stays illegal (no-op on a closed row is a pointless write).
4. **Concurrency**: the existing `If-Unmodified-Since` header on `PATCH /jobs/{id}` is the CAS token. The existing `Update` SQL guard `id = $1 AND company_id = $2 AND deleted_at IS NULL AND updated_at = $3` is reused unchanged. A re-open lost to a concurrent edit returns `409 Conflict` with the latest editor view in the body.
5. **Same-company invariant**: the existing `WHERE company_id = $2` guard in the Update SQL is reused unchanged. A re-open of another company's job surfaces as `404 job not found`, identical to PATCH and CREATE flows.
6. **Born-state parity**: a re-opened row has the same invariants any `draft`/`published` row has — `jobs_published_integrity_check CHECK (status <> 'published' OR published_at IS NOT NULL)` MUST hold after the UPDATE.
7. **No schema change**: no migration. The `jobs` table already has every column the re-open write needs. The single SQL-column question (whether to preserve or reset `published_at` on `closed → published`) is OPEN — see §6.4 and the proposal question round.

## 5. Locked technical decisions (DO NOT re-open)

These are pinned by the prior archived write-side slices and reused verbatim. They are NOT re-litigated here.

1. **Reuse the `UpdatePatch` port** — the existing `repositories.UpdatePatch` value type carries `Status *valueobjects.JobStatus`. A re-open request is a `repo.Update(ctx, id, companyID, patch{Status: &Draft}, casToken)` call — zero port extension.
2. **Reuse `JobForUpdate` and `toEditorView`** — the editor view projection carries `status`, `updated_at`, and `company{id,name}`. Re-open's `200` and `409` responses both render through `toEditorView` (D2 reuse map from `jobs-create`).
3. **Reuse `ErrInvalidStatusTransition`** — the existing sentinel handles illegal transition rejection. Re-open's "non-closed starting point with `closed` target" or "non-draft/non-published target from closed" maps to the same `400 invalid status transition` the handler already returns.
4. **Reuse the `If-Unmodified-Since` RFC 3339 wire format** — the handler's existing `parseIfUnmodifiedSince` and the use case's CAS compare need no change.
5. **No new route in `main.go`** — `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)` already exists. The change is invisible at the routing layer.
6. **No new domain entity / sentinel / port method** — `entities.ErrInvalidStatusTransition`, `entities.JobForUpdate`, `repositories.JobRepository.Update`, `repositories.UpdatePatch` are all the surface the change needs. The compile-time `var _ repositories.JobRepository = (*JobRepository)(nil)` adapter assertion is NOT touched (D-prior rule: extending the port breaks all stubs + the assertion; we are not extending the port).
7. **Active-company gate on re-open** — to be confirmed by the user round. Proposal default: re-open MUST run behind the same atomic active-company predicate CreateJob uses (mirrored in the Update SQL via a CTE guard). This protects a recruiter of a company that was `active` at close but is now `suspended` from re-opening via stale UI state.

## 6. Business rules (proposed — flag the open ones for the user round)

### 6.1 Modified status transition table (delta vs canonical spec)

The canonical spec's `Status Transition Table` is extended by lifting two of its `closed → ?` rows from `NO → 400` to `YES → side effects`. The unchanged rows stay as-is.

| Current `status` | Requested `status` | Allowed | Side effect |
|---|---|---|---|
| `draft` | `draft` | YES | Field-only edit; no `published_at` change. |
| `draft` | `published` | YES | Server sets `published_at = COALESCE(published_at, now())` in the same SQL UPDATE. |
| `draft` | `closed` | NO | `400`. |
| `published` | `draft` | NO | `400`. |
| `published` | `published` | YES | Field-only edit; `published_at` preserved; `search_vector` regenerates. |
| `published` | `closed` | YES | `published_at` preserved as audit history. |
| **`closed`** | **`draft`** | **YES (NEW)** | **Transition + field edits in the same call. `published_at` preserved as audit history (column is preserved by the SQL `ELSE` branch; no SQL change needed).** |
| **`closed`** | **`published`** | **YES (NEW)** | **Transition + field edits in the same call. `published_at` preserved (policy (a), §6.4 — LOCKED by user round).** |
| `closed` | `closed` | NO | `400` — terminal rows are immutable on no-op transition. |

### 6.2 Field edits on a closed row (LOCKED — user round 2026-08-25: reject)

A `PATCH /jobs/{id}` body that contains ONLY field edits and NO `status` against a row whose current `status='closed'` is rejected with `400 invalid status transition` (the canonical `closed is terminal` scenario). A closed row is "frozen for content" — the only way out is an explicit status transition. Re-open is a one-step operation (set `status` to `draft` or `published`; if the recruiter also wants to edit fields, they go in the same call).

**DECIDED**: the alternative (allowing field-only edits on a closed row) was presented to the user and rejected.

### 6.3 Active-company gate on re-open (LOCKED — user round 2026-08-25: gate required)

A re-open PATCH is gated by the same `RequireCompanyRole(recruiter)` middleware that admits edit/publish/close. The middleware resolves the caller's membership once. Today there is no runtime "is the company active?" check on PATCH — `Update` only filters by `(id, company_id, deleted_at IS NULL, updated_at = cas_token)`. A company that was `active` at close and is `suspended` at re-open could still re-open today.

**DECIDED**: re-open MUST run behind an atomic SQL guard mirroring CreateJob's `WITH active AS (SELECT id, name FROM companies WHERE id = $1 AND status = 'active') ...` shape. A non-active company at re-open yields `409 Conflict {"error":"company is not active"}` (reuses `entities.ErrCompanyNotActive` and the existing `classifyError` branch). The gate applies to the whole `PATCH /jobs/{id}` write path, not only re-open transitions (behavior change for ALL PATCHes accepted by the user; consistent with `CreateJob`).

**DECIDED**: the alternative (relaxing the active-company check — membership gate only) was presented to the user and rejected.

### 6.4 `published_at` on `closed → published` re-open (LOCKED — user round 2026-08-25: policy (a) preserve)

Two equally defensible policies; the choice is product, not technical:

- **(a) Preserve original `published_at`** — the audit-history answer. The row's `published_at` carries "first published at" across any close/re-open cycle. Zero SQL change; the existing `published_at = COALESCE(published_at, now())` branch already does this. Pros: "when was this role first live?" is always queryable; the audit trail is monotonic. Cons: a `published_at` from `2025-03-01` on a row re-opened in `2026-09` is misleading for ranking (`ORDER BY published_at DESC`) — the row would sort as if newly published when it is actually re-published.
- **(b) Reset `published_at = now()` on `closed → published`** — the re-publish signal. The SQL CASE changes from `WHEN status='published' THEN COALESCE(published_at, now())` to `WHEN status='published' AND (old_status<>'closed' OR published_at IS NULL) THEN now() WHEN status='published' THEN published_at ELSE published_at END`. Pros: re-opened jobs sort naturally as fresh on the public listing; "current publish event" semantics. Cons: the original publish timestamp is lost (or has to live elsewhere — out of scope).

**DECIDED**: policy **(a) preserve original `published_at`** (audit-history answer). Zero SQL change for the timestamp — the existing `COALESCE(published_at, now())` branch already preserves it. The design phase reuses the existing `UpdateJob` CASE unchanged for the timestamp and only adds the §6.3 active-company CTE guard. The integrity check `jobs_published_integrity_check` holds (every `published` row has a non-NULL `published_at`). Accepted trade-off: re-opened jobs sort by their original `published_at` on `published_at DESC` listings (not as freshly re-published).

### 6.5 `published_at` on `closed → draft` re-open (locked)

`closed → draft` re-open leaves `published_at` as-is. The SQL `ELSE published_at` branch already covers this case (the CASE in `UpdateJob` only sets `published_at` on the `status='published'` branch). Re-opening to draft is a "back to edit" state, and the audit `published_at` stays so a later `draft → published` knows whether to preserve or refresh. If the recruiter later publishes, the existing `COALESCE(published_at, now())` rule applies (preserves the original publish timestamp from when the row was first live, per §6.4(a) — LOCKED).

### 6.6 Editability matrix on re-open

UNCHANGED from canonical spec. All editable fields (`title`, `description`, `work_mode`, `employment_type`, `seniority`, `location`, `salary_min`, `salary_max`, `salary_currency`) remain editable in the same PATCH call that performs the `closed → {draft, published}` transition. All immutable fields (`id`, `company_id`, `created_at`, `updated_at`, `published_at`, `deleted_at`, `search_vector`) remain immutable. `published_at` is server-managed per §6.4 / §6.5.

### 6.7 Gate (no change)

Single gate: `RequireAuth` + `RequireCompanyRole(recruiter)`. Owner passes via `MemberRole` ordinal. Same as PATCH and CREATE flows.

### 6.8 Error taxonomy (delta vs canonical spec)

The canonical spec's `Error Taxonomy` table for `PATCH /jobs/{id}` is reused unchanged for re-open. The two transitions `closed → draft` and `closed → published` are legal, so they never surface `400 invalid status transition`. The non-transition illegal outcomes still map to:

| Outcome | HTTP status | Body |
|---|---|---|
| `{id}` not a valid UUID | `400 invalid job id` | error message |
| Unknown VO / empty title / empty description / `salary_min > salary_max` | `400 validation` | error message |
| `closed → closed` (no-op) | `400 invalid status transition` | error message |
| No `Authorization` header | `401 unauthenticated` | error message |
| Non-member or role too low | `403 not a member / role too low` | error message |
| Cross-company / soft-deleted / non-existent | `404 job not found` | error message |
| `If-Unmodified-Since` mismatch | `409 conflict` | editor view of latest row |
| Owning company not `active` (if §6.3 active-company gate is added) | `409 company is not active` | error message (reuses existing `classifyError` branch) |
| Anything else | `500 internal` | error message |

The `409` for active-company is a NEW branch only if §6.3 is adopted as proposal default. Without §6.3, the existing taxonomy is untouched.

## 7. Scope (first slice)

### 7.1 HTTP surface

UNCHANGED. `PATCH /jobs/{id}` continues to be the only endpoint the change touches. The route, the gate, the per-method `JobHandlers()` accessor line in `main.go`, and the `r.With(requireAuth, requireRecruiter).Patch(...)` mount line all stay as they are.

### 7.2 Application / domain changes

- `application/usecases/updateJob.go` — **MOD**:
  - Relax `isTransitionAllowed(from, to)` so the `default:` branch (Closed) returns `true` for `to == Draft || to == Published`. All other transitions are unchanged.
  - Adjust the closed-terminal early-return in `EditJob`: instead of rejecting ANY body on a closed row, allow the body when it explicitly sets `status` to `draft` or `published` (and rejects when it does not — the proposal default per §6.2). The minimal patch: keep the early-return BUT add a bypass when `newStatus != nil && (newStatus == Draft || newStatus == Published)`.
  - **ZERO** other changes to `EditJob`. The CAS compare, VO parse, salary range validation, patch build, `repo.Update` call, re-read, `toEditorView` projection, and the `409`-with-view special-case in the handler all run unchanged.

### 7.3 Domain

- `domain/entities/job.go` — **UNCHANGED**. `ErrInvalidStatusTransition`, `ErrJobNotFound`, `ErrConcurrencyConflict`, and the existing `ErrCompanyNotActive` (added by `jobs-create`) cover every error the change can surface.
- `domain/repositories/jobRepository.go` — **UNCHANGED**. `Update(ctx, id, companyID, patch, casUpdatedAt)` already accepts `Status *valueobjects.JobStatus` in the patch and applies the CAS guard in SQL. No port extension. (If §6.3 is adopted as proposal default, the port MAY need a new method or the existing `Update` SQL gets the active-company guard injected via a `companyID` parameter it already takes — the SQL is amended in-place; the port signature stays. **Open for design.**)

### 7.4 Persistence (sqlc)

- `backend/db/queries/jobs.sql` — **MOD under §6.4(b) only**.
  - §6.4(a) (preserve original `published_at`): **ZERO SQL change**. The existing `UpdateJob` SQL `published_at = CASE WHEN sqlc.narg('status')::text = 'published' THEN COALESCE(published_at, now()) ELSE published_at END` already encodes "preserve on re-publish to published". No regen needed.
  - §6.4(b) (reset on `closed → published`): **REJECTED by user round — policy (a) chosen.** No reset SQL.
  - §6.3 (active-company gate, LOCKED by user round): amend `UpdateJob` SQL with the same `WITH active AS (SELECT id FROM companies WHERE id = sqlc.arg('company_id')::uuid AND status = 'active')` guard CreateJob uses, plus an extra `AND EXISTS (SELECT 1 FROM active)` on the UPDATE's WHERE clause. The adapter's `mapUpdateError` gains a branch mapping the guard-miss `pgx.ErrNoRows` to `entities.ErrCompanyNotActive` (mirroring CreateJob's `mapCreateError`). **Exact CTE shape is design-phase detail; `jobs.sql.go` regen via `go tool sqlc generate`.**

- `backend/internal/db/jobs.sql.go` — **MOD only if `jobs.sql` changes**. Regen via `go tool sqlc generate`; do not hand-edit.

### 7.5 Infrastructure / wiring

- `infrastructure/http/jobHandler.go` — **MOD under §6.3 only**. If the active-company gate is added, `classifyError` already has the `ErrCompanyNotActive → 409 "company is not active"` branch (added by `jobs-create`); no change needed. Without §6.3, **UNCHANGED**.
- `infrastructure/postgres/jobRepository.go` — **MOD under §6.3 only**. The existing `mapUpdateError` handles 23514 → `ErrInvalidStatusTransition`. If §6.3 is added, extend `mapUpdateError` to map `pgx.ErrNoRows` → `ErrCompanyNotActive` (mirrors `mapCreateError`). Without §6.3, **UNCHANGED**. The `buildUpdateJobParams` and `toJobForUpdateEntity` helpers are not touched.
- `cmd/api/main.go` — **UNCHANGED**. The existing `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)` line serves the re-open request. No new route, no new wiring.

## 8. Explicit non-goals (out of scope for this change)

- **No new endpoint** — re-open is on `PATCH /jobs/{id}`. A dedicated `POST /jobs/{id}/reopen` is out of scope.
- **No migration** — the `jobs` table already has every column the change needs (no `closed_at`, no `reopened_at`; "audit history" lives in `published_at` + `updated_at`).
- **No `closed_at` column** — the canonical schema has no close timestamp. Adding one is a separate change (and would invite a backfill decision for existing closed rows).
- **No candidates impact** — a re-opened job does NOT notify previous applicants, does NOT carry applicant history forward in the API, does NOT auto-re-open their applications. Candidates are a separate bounded context (out of scope here, flagged in the proposal question round).
- **No notifications / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous (matches `jobs-write-side` and `jobs-create` precedent).
- **No change to public read API** — `GET /jobs` and `GET /jobs/{id}` shapes stay exactly as the canonical spec defines them. A re-opened job in `status='published'` automatically surfaces via the existing `status='published' AND deleted_at IS NULL AND company.status='active'` predicate (zero read-side change).
- **No change to `closed → closed` (no-op)** — the no-op transition stays illegal. A re-open to the current status is a meaningless write.
- **No `company_members` ownership** — out of scope (still deferred from canonical spec).
- **No soft-delete endpoint** — out of scope (still deferred from canonical spec).

## 9. Affected areas (file inventory)

All under `backend/`. Modified files marked **MOD**. User round (2026-08-25) locked §6.3 (active-company gate REQUIRED) and §6.4(a) (preserve `published_at`, zero timestamp SQL change); §6.4(b) (reset) is REJECTED — no reset SQL anywhere.

- **MOD** `backend/internal/features/jobs/application/usecases/updateJob.go` — relax `isTransitionAllowed` for `Closed → Draft / Published`; bypass the closed-terminal early-return when the patch explicitly sets `status` to `draft` or `published`; propagate `ErrCompanyNotActive` unchanged (same pattern as `CreateJob`).
- **MOD** `backend/db/queries/jobs.sql` — add `WITH active AS ...` CTE guard + `AND EXISTS (SELECT 1 FROM active)` predicate to `UpdateJob` (§6.3 LOCKED). No `published_at` CASE change (§6.4(a) LOCKED).
- **MOD** `backend/internal/db/jobs.sql.go` — regen via `go tool sqlc generate` (same regen, driven by the `jobs.sql` change).
- **MOD** `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` — extend `mapUpdateError` with `pgx.ErrNoRows → ErrCompanyNotActive`.
- **MOD** `backend/internal/features/jobs/application/usecases/updateJob_test.go` — add unit tests for `isTransitionAllowed(Closed, Draft)` and `isTransitionAllowed(Closed, Published)` returning `true`; `isTransitionAllowed(Closed, Closed)` returning `false`. Add a use-case integration test that a `PATCH {"status":"draft"}` on a closed row returns `200` with `status="draft"`.
- **MOD** `backend/internal/features/jobs/application/usecases/updateJob_test.go` — add a use-case integration test for the closed-terminal bypass (PATCH with `status` field on a closed row is allowed; PATCH WITHOUT `status` on a closed row still 400s per §6.2 LOCKED).
- **MOD** `backend/internal/features/jobs/application/usecases/updateJob_test.go` — add a use-case integration test asserting that a recruiter of a suspended company gets `ErrCompanyNotActive` (§6.3 LOCKED).
- **MOD** `backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go` — add a SQL-level test for the re-open transition (CAS, same-company, active-company guard).

**UNCHANGED**: `cmd/api/main.go`, `application/dtos/updateJobDto.go`, `application/dtos/jobEditorViewDto.go`, `application/usecases/jobService.go`, `domain/entities/job.go`, `domain/entities/jobForUpdate.go`, `domain/valueobjects/jobStatus.go`, `domain/repositories/jobRepository.go` (port signature unchanged — the guard is internal to the adapter), `infrastructure/http/jobHandler.go` (`classifyError` already maps `ErrCompanyNotActive → 409`), `application/usecases/createJob.go`, `application/usecases/createJob_test.go`, the read-side queries, all migrations.

## 10. New infrastructure dependency

None. No new package, no new env var, no new docker-compose service, no new migration. The slice reuses the existing `uuid` (google/uuid), `pgx/v5`, `pgconn`, `pgtype`, `chi`, and `slog` packages already imported by the `jobs` slice.

## 11. Risks

1. **Re-open's two new legal transitions collide with the `closed is terminal` spec scenario** — the canonical spec scenario "closed is terminal" rejects ANY body on a closed row. The change partially invalidates that scenario. The spec delta MUST replace it with the four cases from §6.1 + §6.2 (or whatever the user round pins); an obsolete scenario would still pass spec verification but contradict production behavior.
2. **`published_at` reset vs preserve (§6.4) — RESOLVED (policy (a) preserve)** — no SQL change for the timestamp. Remaining risk is purely UX: re-opened jobs sort by their original `published_at` on `published_at DESC` listings, which may surprise recruiters re-opening a position. Accepted by user round.
3. **Active-company gate on re-open (§6.3) — DECIDED (gate required for ALL PATCHes)** — adding the gate retroactively to `UpdateJob` is a behavior change for ALL PATCHes, not just re-open. A PATCH on a `suspended` company that was previously `200` is now `409 company is not active`. The user accepted this as a feature (consistent with `CreateJob`). No alternative SQL CASE is needed.
4. **CAS interaction with re-open** — a recruiter holding a stale `If-Unmodified-Since` (e.g., they last read the job when it was `published`, then the job was `closed`, and they `PATCH {"status":"published"}` thinking they're publishing) sees `409` with the latest editor view. The editor view now shows `status="closed"` and a new `updated_at` — the client must re-read and decide whether to re-issue with the new token. The same `409`-with-view body shape already exists; no new error path.
5. **Routing split** — the existing `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", jobHandlers.UpdateJob)` line serves re-open; no new mount. The routing-split defense (the existing AST guard test) is not touched.
6. **`closed → draft` followed by `draft → published` race** — a recruiter who re-opens to draft and then publishes may lose the publish to a concurrent closer (a different recruiter re-closing the role). The CAS guard handles this correctly (`409` with the latest view). The behavior is no different from a normal `draft → published` race.
7. **Audit gap on `closed → published`** — neither `closed_at` nor `reopened_at` columns exist. The "this job was closed at T and re-opened at T'" audit trail is not queryable from the schema. The proposal accepts this gap (a `closed_at` column is out of scope; `published_at` carries the "first published at" timestamp per §6.4(a) LOCKED). Accepted by user round.
8. **`search_vector` regenerates on re-open edits** — a re-open PATCH that also changes `title` or `description` triggers the STORED `search_vector` regeneration, identical to any other PATCH. The re-opened job re-enters search ranking with the new text. This is the correct behavior for a recruiter re-hiring with an updated description; flagging only so a future spec scenario can pin it explicitly.
9. **`salary_min <= salary_max` validation on a closed row** — the use case's salary-range check applies to every PATCH, including re-open. A re-open PATCH that lowers `salary_min` below an existing `salary_max` (both present and non-null in the patch) returns `400`. The behavior matches every other PATCH and is not re-open-specific.

## 12. Rollback plan

Simplest safe rollback: **revert the merge commit**. Because there is no migration, no schema change, no new package, no env var, and (most likely) no SQL change under §6.4(a):

- Reverting `application/usecases/updateJob.go` restores the closed-terminal rule: `isTransitionAllowed` rejects all transitions out of `Closed`; the closed-terminal early-return in `EditJob` rejects every body on a closed row.
- If §6.3 was adopted, reverting `backend/db/queries/jobs.sql` and `mapUpdateError` restores the old SQL; the recruiter of a now-suspended company can still re-open via PATCH (the prior behavior). The `jobs.sql.go` regen must be reverted in lockstep.
- No data migration is needed in either direction (no column added, no column dropped, no data backfill).
- The HTTP routing and the `cmd/api/main.go` mount are untouched; reverting never removes the route, only restores its pre-change semantics.
- No feature flag is required for the first rollout; if a staged rollout is later desired, gating re-open behind an env flag (e.g., `FEATURE_JOBS_REOPEN_ENABLED`) in `updateJob.go` is a one-line addition that costs nothing in this slice.

## 13. Success criteria

- A recruiter of company `A` whose job is `status='closed'` can `PATCH /jobs/{id}` with body `{"status":"draft"}` and a matching CAS token; the response is `200` with the editor view showing `status="draft"`, the same `published_at` as before (audit preserved), and a new `updated_at`.
- The same recruiter can `PATCH /jobs/{id}` with `{"status":"published"}`; the response is `200` with `status="published"`. `published_at` is preserved (policy (a) — LOCKED by user round).
- The same recruiter can `PATCH /jobs/{id}` with `{"status":"draft","title":"New title"}`; the response is `200`, both the transition and the field edit apply atomically, `updated_at` advances once, `search_vector` reflects the new title.
- A recruiter of company `B` sending `PATCH /jobs/{id}` for company `A`'s closed job receives `404 job not found` (same-company invariant unchanged).
- A recruiter sending a stale `If-Unmodified-Since` (or no header) receives `409 Conflict` with the latest editor view in the body (CAS unchanged).
- A recruiter sending `{"status":"closed"}` against a closed row receives `400 invalid status transition` (no-op transition still illegal).
- A recruiter sending a field-only patch (no `status`) against a closed row receives `400 invalid status transition` (terminal for content — §6.2 LOCKED by user round).
- A recruiter of a `suspended` company sending re-open receives `409 Conflict {"error":"company is not active"}` (§6.3 LOCKED by user round).
- A re-opened (`status='published'`) job from an active company surfaces on `GET /jobs` and `GET /jobs/{id}` within one read (the existing visibility predicate surfaces it; zero read-side change).
- Strict TDD: every behavior above has a RED test that pre-dates its GREEN implementation; `go test ./...` is green; `go vet ./...` is clean.

## 14. Open items for the design phase

User round (2026-08-25) resolved items 1–5 below; only 6–7 remain as design-phase decisions.

1. **Re-open target state — RESOLVED**: both `closed → draft` and `closed → published` via PATCH body `status`.
2. **`published_at` policy — RESOLVED**: policy (a) preserve original; zero SQL change for the timestamp.
3. **Field-only edits on a closed row — RESOLVED**: still rejected with `400 invalid status transition`.
4. **Active-company gate — RESOLVED**: atomic SQL guard required; applies to ALL PATCHes (behavior change accepted).
5. **Re-open on a soft-deleted job — RESOLVED**: no exception; soft-deleted stays `404 job not found`. Soft-delete remains a separate future endpoint.
6. **Audit timestamp** — should the change add a `closed_at` column? Out of scope per §8; flagged because the absence of `closed_at` limits the audit story. **Proposal default: no column.**
7. **The `closed is terminal` spec scenario replacement** — once the change lands, the canonical spec's "closed is terminal" scenario must be replaced by the four cases from §6.1 + §6.2. The spec phase rewrites it.

## 15. Proposal question round (RESOLVED — user answers 2026-08-25)

The user answered all four blocking questions; all answers match the proposal defaults. Locked decisions land in §6 / §14:

1. **Who may re-open?** — CONFIRMED: rule #2 extension stands. Any recruiter of the company (owner via ordinal) re-opens any closed job of the company, same gate as PATCH and CREATE.
2. **Re-open target state** — **both** (`closed → draft` and `closed → published`).
3. **`published_at` on `closed → published`** — **preserve original** (policy (a), audit history).
4. **Field-only edits on a closed row** — **still reject** `400 invalid status transition`.
5. **Active-company gate on re-open** — **must be active**; atomic SQL guard mirroring CreateJob, applies to all PATCHes.
6. **Edge cases** — candidates impact stays out of scope (no job-candidate links in the API); a closed AND soft-deleted job stays `404` (no re-open exception).

## 16. Cross-references

- `openspec/specs/jobs/spec.md` — the canonical spec (25 requirements, 106 scenarios); the `Status Transition Table` and `closed is terminal` requirement/scenario are the ones this change MODIFIES.
- `openspec/changes/archive/2026-08-24-jobs-write-side/{proposal.md,design.md,specs/jobs/spec.md}` — the delivered PATCH precedent (status transition table, CAS, same-company invariant, editor view, error taxonomy, routing-split defense).
- `openspec/changes/archive/2026-08-25-jobs-create/{proposal.md,design.md,specs/jobs/spec.md}` — the delivered POST precedent (atomic active-company SQL guard via CTE, `ErrCompanyNotActive → 409`, `mapCreateError`, `classifyError` branch).
- `backend/internal/features/jobs/application/usecases/updateJob.go` — `EditJob` orchestrator and `isTransitionAllowed` table (the only application-layer file the change touches).
- `backend/internal/features/jobs/domain/repositories/jobRepository.go` — the `Update` port (unchanged; reuses Status in the patch).
- `backend/internal/features/jobs/domain/entities/job.go` — `ErrInvalidStatusTransition`, `ErrJobNotFound`, `ErrConcurrencyConflict`, `ErrCompanyNotActive` sentinels (reused unchanged).
- `backend/db/queries/jobs.sql::UpdateJob` — the SQL whose `published_at` CASE may need amending under §6.4(b) and whose WHERE may need the active-company guard under §6.3.
- `backend/db/migrations/00007_jobs.sql` — the `jobs` schema (no migration added; no column change).
- `backend/cmd/api/main.go` (lines around `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", …)`) — the composition-root pattern; unchanged.
- `openspec/config.yaml` (`proposal` rules) — rollback, file paths, infra dependencies all honored.
