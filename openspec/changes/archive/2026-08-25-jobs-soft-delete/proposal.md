# Proposal: `jobs-soft-delete`

Status: proposal (pre-spec, pre-user-round). Artifacts produced in this phase: this file only (no spec, design, or tasks yet). Grounded by the canonical `openspec/specs/jobs/spec.md` (29 requirements, 124 scenarios — read-side 8 + PATCH write-side 9 + POST create-side 8 + re-open delta 4 = 29 reqs; 124 scenarios) and the archived write slices `openspec/changes/archive/2026-08-24-jobs-write-side/`, `openspec/changes/archive/2026-08-25-jobs-create/`, and `openspec/changes/archive/2026-08-25-jobs-reopen/`.

## 1. Intent

Introduce **soft-delete a job vacancy** via `DELETE /jobs/{id}`. A successful DELETE sets `jobs.deleted_at = now()` (the tombstone), keeps the row in the DB for audit, and makes the job invisible on every read path. It is **not** a hard delete — the row survives.

This is the **only** remaining deferred write capability from the canonical jobs spec. It is a **new endpoint** (not a body shape on `PATCH /jobs/{id}`, not a body shape on `POST /jobs`, not a re-open transition). Restore/undelete, hard delete, and bulk operations stay out of scope.

## 2. Problem / opportunity

Today the canonical `jobs` write surface covers `POST /jobs` (create draft) and `PATCH /jobs/{id}` (field edits + publish/close/re-open). There is no API path that removes a vacancy. Every "we closed this role forever" today requires either (a) leaving the row in `status='closed'` forever (it stays in the audit history but pollutes future "drafts" / "open" filters that callers may add) or (b) direct SQL `UPDATE jobs SET deleted_at = now()` from a maintenance script, which bypasses the `RequireCompanyRole(recruiter)` gate, bypasses the CAS concurrency control, and bypasses the active-company atomic guard that `jobs-reopen` just added to `UpdateJob`.

The schema is already prepared: the `jobs` table carries `deleted_at TIMESTAMPTZ NULL` (migration `00007_jobs.sql`), every read-side query (`SearchJobs`, `GetJobByID`, `GetJobForUpdate`, and the `UpdateJob` WHERE clause) already filters `deleted_at IS NULL`, and the partial index `jobs_public_listing_idx` is already predicated on `deleted_at IS NULL`. The read-side visibility is already correct — every existing test fixture that proves "soft-deleted row is hidden on read" already passes. There is **no schema change**. What is missing is the single write path that sets the tombstone behind the same gate, CAS, and active-company guard every other write goes through.

## 3. Target users and situations

- **Recruiter removing a vacancy** — `DELETE /jobs/{id}` with `If-Unmodified-Since: <last_known_updated_at>`. The job disappears from `GET /jobs` and `GET /jobs/{id}` immediately; the row stays in the DB for audit (who deleted it, when). The recruiter sees `204 No Content` on success. Reopening is not possible (the row stays invisible to all read paths; the future restore endpoint is out of scope).
- **Owner removing a vacancy** — passes the `recruiter` gate automatically (`owner(2) ≥ recruiter(1)` via `MemberRole` ordinal). Same as PATCH and POST.
- **Recruiter of a non-active company** — the atomic active-company guard yields `409 {"error":"company is not active"}`, identical to the gate `jobs-reopen` just added to PATCH. The row is NOT tombstoned.
- **Recruiter with a stale `If-Unmodified-Since`** — the CAS compare fails before any write; the response is `409 Conflict` with the latest editor view in the body (the same shape as the PATCH `409`). The client re-reads, decides whether to re-issue with the fresh token.
- **Recruiter deleting an already-soft-deleted job** — `GetForUpdate` (the read-for-delete) returns `ErrJobNotFound` because `deleted_at IS NULL` is part of its WHERE clause; the response is `404 job not found` (consistent with the "soft-deleted is invisible on every read path" invariant pinned by the canonical spec scenarios "soft-deleted id returns 404").
- **Cross-company recruiter** — `GetForUpdate` returns `ErrJobNotFound` (same-company invariant). No leak of row existence (identical body shape to a non-existent id).
- **Recruiter deleting a row that was `published` and visible on the public board** — DELETE immediately takes it down: the next `GET /jobs/{id}` returns `404`, the next `GET /jobs` excludes it (the `deleted_at IS NULL` predicate). This is the user-visible "remove from job board" affordance the change provides.

## 4. Locked business decisions (DO NOT re-open)

These are pinned by the prior sessions and the canonical spec. They MUST be honored verbatim in spec, design, and apply; the proposal question round (§15) surfaces only the **open** product decisions, not these.

1. **Soft-delete only — no hard delete** — the row survives in `jobs` with `deleted_at` set. No `DELETE FROM jobs` path exists in this change (and never will: hard delete bypasses audit, breaks referential expectations, and is out of scope per canonical spec §Out of scope).
2. **Soft-deletion is invisible on every read path** — the read-side visibility predicate (`status='published' AND deleted_at IS NULL AND companies.status='active'`) already hides soft-deleted rows from `GET /jobs` and `GET /jobs/{id}`. The write-side `GetForUpdate` and `UpdateJob` WHERE clauses already filter `deleted_at IS NULL`. The 404 surface (cross-company, non-existent, soft-deleted) is **indistinguishable** by design (canonical spec §Same-Company Invariant and IDOR Defense).
3. **Re-open does NOT restore a soft-deleted job** — soft-deleted stays 404 even on `PATCH /jobs/{id}` `{"status":"draft"}` or `{"status":"published"}`. The `jobs-reopen` proposal §14.5 explicitly deferred this: "Soft-delete stays a separate future endpoint." This proposal delivers that separate endpoint; the inverse (restore from soft-delete) stays a future separate endpoint.
4. **Same gate as PATCH and CREATE** — `RequireAuth` + `RequireCompanyRole(recruiter)`. Owner passes via `MemberRole` ordinal (`owner(2) ≥ recruiter(1)`). The handler reads `company_id` from `CompanyContext`; the body never carries `company_id`; DELETE has no body.
5. **Same-company invariant** — the soft-delete write path scopes by `company_id` from `CompanyContext`. A row owned by another company surfaces as `404 job not found`, identical to PATCH and CREATE. No `403` (would leak existence).
6. **Active-company atomic guard on DELETE** — mirrors the `UpdateJob` gate `jobs-reopen` just landed. A non-active company at the moment of the UPDATE yields `409 Conflict {"error":"company is not active"}` (reuses `entities.ErrCompanyNotActive`; the `classifyError` branch already exists). The guard is in the same SQL statement as the tombstone write (no TOCTOU window).
7. **CAS via `If-Unmodified-Since`** — mirrors the PATCH CAS. The header carries the client's last-known `updated_at`; the server compares it to the row's current `updated_at` loaded by the read-for-delete; mismatch yields `409 Conflict` with the latest editor view in the body (same body shape as PATCH `409`). Missing header → zero token → mismatch → `409`.
8. **No `deleted_at` audit column added** — `deleted_at` IS the audit timestamp. No separate `deleted_by_user_id`, no separate `deleted_reason`, no separate `deletion_log` table. Audit trail is the row + `deleted_at`.
9. **No candidates impact** — soft-deleting a vacancy does NOT notify previous applicants, does NOT carry applicant history forward, does NOT auto-withdraw their applications. Candidates are a separate bounded context (out of scope here).
10. **No notifications / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous, matching `jobs-write-side`, `jobs-create`, and `jobs-reopen`.
11. **No new migration** — the `jobs` table already has every column the change needs.
12. **No new domain entity** — `JobForUpdate` already carries `UpdatedAt` (for the CAS compare). No `DeletedAt` field is added to `JobForUpdate` because the success response has no body (204), so the use case never re-reads after the soft-delete write.

## 5. Locked technical decisions (DO NOT re-open)

These are pinned by the prior archived write-side slices and reused verbatim. They are NOT re-litigated here.

1. **Reuse the gate middleware** — the existing `r.With(requireAuth, requireRecruiter).…` subtree at `cmd/api/main.go` (already hoisted at `run()` scope) gains one new line: `r.With(requireAuth, requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)`. No new middleware.
2. **Reuse `ErrCompanyNotActive` and the `classifyError` branch** — `classifyError` already maps `ErrCompanyNotActive → 409 {"error":"company is not active"}` (added by `jobs-create` and used by `jobs-reopen`). No new branch.
3. **Reuse `ErrJobNotFound`** — the read-for-delete (`GetForUpdate`) returns `ErrJobNotFound` for non-existent, cross-company, AND already-soft-deleted rows, identically to the PATCH flow. The handler maps `ErrJobNotFound → 404 job not found`.
4. **Reuse `ErrConcurrencyConflict` + `409-with-view` special-case** — the use case returns the editor view on CAS mismatch (same as PATCH); the handler's existing `errors.Is(err, entities.ErrConcurrencyConflict)` branch writes the view before `classifyError`.
5. **Reuse the atomic active-company CTE guard shape from `UpdateJob :one`** — same `WITH active AS (SELECT id FROM companies WHERE id = sqlc.arg('company_id')::uuid AND status = 'active')`, same `AND EXISTS (SELECT 1 FROM active)` predicate on the UPDATE WHERE, same `:one` scalar SELECT returning `{guard_passed, updated_count}`. Adapter's `SoftDelete` inspects `GuardPassed` exactly like `Update` does. **Decision: the soft-delete query is `:one` returning the same `{guard_passed, deleted_count}` shape** (mirroring `UpdateJob`'s `{guard_passed, updated_count}`).
6. **Reuse the `If-Unmodified-Since` RFC 3339 wire format and `parseIfUnmodifiedSince`** — handler helper is unchanged. Use case compares `current.UpdatedAt` to the parsed token.
7. **Reuse `toEditorView` for the `409` body** — same projection function from `updateJob.go` (package-private, same package). The 200/`204` success path emits no body, but the `409` body MUST be the editor view (consistent with PATCH).
8. **No new package, no new env var, no new docker-compose service** — slice reuses `uuid` (google/uuid), `pgx/v5`, `pgconn`, `pgtype`, `chi`, `slog`.
9. **Stub repair is atomic** — extending the port with `SoftDelete` requires touching every stub (`stubJobRepository`, `writeStubRepo`, `writeStubHandlerRepo`) AND the `var _ repositories.JobRepository = (*JobRepository)(nil)` compile-time assertion. The five-stub repair ships in **one** commit (prior session learning: the port extension breaks every stub + the assertion in lockstep — design-time decision per `jobs-create` D10).
10. **sqlc regen on query shape change** — the new `SoftDeleteJob` query is a `:one` scalar SELECT (no row projection), so `jobs.sql.go` gains `SoftDeleteJobParams` + `SoftDeleteJobRow {GuardPassed bool; DeletedCount int64}` + `SoftDeleteJob(ctx, …) (SoftDeleteJobRow, error)`. `querier.go`'s `Querier` interface signature changes to match. Existing four queries (`SearchJobs`, `GetJobByID`, `GetJobForUpdate`, `CreateJob`, `UpdateJob`) are regenerated verbatim and unchanged.

## 6. Business rules (proposed — flagged for the user round)

### 6.1 Endpoint surface

| Aspect | Decision |
|---|---|
| Method | `DELETE` |
| Path | `/jobs/{id}` (id is the row's UUID) |
| Auth | `RequireAuth` + `RequireCompanyRole(recruiter)` (owner via ordinal) |
| Request body | **NONE** (DELETE has no body) |
| Required request headers | `Authorization: Bearer <jwt>` (RequireAuth); `If-Unmodified-Since: <RFC 3339 timestamp>` (CAS) |
| Response (success) | `204 No Content` (empty body) — proposal default; `200` + view is the alternative (§15 Q2) |
| Response (CAS mismatch) | `409 Conflict` with the latest editor view in the body (same shape as PATCH `409`) |
| Response (non-active company) | `409 Conflict {"error":"company is not active"}` (reuses existing `classifyError` branch) |
| Response (cross-company / non-existent / already-soft-deleted) | `404 job not found` (indistinguishable; `ErrJobNotFound`) |
| Response (malformed UUID) | `400 invalid job id` |
| Response (no `Authorization`) | `401 unauthenticated` (RequireAuth) |
| Response (non-member) | `403 not a member / role too low` (RequireCompanyRole) |
| Response (internal failure) | `500 internal server error` (real error logged at `slog.Error`) |

### 6.2 Status eligibility — any-status deletable (proposal default)

A row is deletable from **any** `status`: `draft`, `published`, or `closed`. Specifically:

| Current `status` | Soft-delete allowed? | Side effect |
|---|---|---|
| `draft` | YES | Tombstone set; row invisible everywhere; `published_at` is NULL (no change). |
| `published` | YES | Tombstone set; row invisible everywhere; `published_at` preserved as audit history (not touched). |
| `closed` | YES | Tombstone set; row invisible everywhere; `published_at` preserved as audit history (not touched). |

**Rationale:** a recruiter removing a vacancy doesn't care about its current status — they want it gone from every read path. The status domain is orthogonal to the "should this row exist?" question. Alternative considered: restricting soft-delete to non-published rows (`draft` / `closed`) so a "live" job has to be `closed` first. Rejected as friction — DELETE is the explicit "I want this off the board" signal, and forcing a `PATCH {"status":"closed"}` round-trip before `DELETE` adds steps without adding safety (the row disappears from the public listing either way).

### 6.3 CAS via `If-Unmodified-Since` (proposal default)

The DELETE handler MUST require an `If-Unmodified-Since` request header carrying the client's last-known `updated_at` (RFC 3339). The server compares against the row's current `updated_at` (loaded by the read-for-delete in the same handler). Mismatch → `409 Conflict` with the latest editor view in the body. Missing or malformed header → zero token → mismatch → `409`.

**Rationale:** matches the PATCH flow exactly — a recruiter deleting a job is a write that needs the same concurrency control as editing one. Two recruiters deleting the same row at the same time: exactly one wins (`204`), the other gets `409` with the latest editor view (re-read says `deleted_at IS NOT NULL` is impossible from the read-for-delete side — it would have surfaced as `404` first; the realistic `409` race is two recruiters editing then deleting, where the deleter's CAS token has been invalidated by an intervening PATCH).

### 6.4 Idempotency — second DELETE → `404` (proposal default)

A second DELETE on an already-soft-deleted row returns `404 job not found`, identical to a non-existent id.

**Rationale:** consistent with the canonical invariant "soft-deleted is invisible on every read path" (canonical spec §Same-Company Invariant and IDOR Defense, scenario "soft-deleted id returns 404"). The read-for-delete (`GetForUpdate`) filters `deleted_at IS NULL` (it always has; the predicate is part of the existing `GetJobForUpdate` SQL), so the second DELETE's `GetForUpdate` returns `ErrJobNotFound`, and the handler maps to `404`. The body shape is identical to a non-existent id — no leak of row existence.

**Alternative considered:** `204` (idempotent: the row is already in the desired end state, success). Rejected: it would require either (a) a special-case in the use case that distinguishes "row is gone because soft-deleted" from "row never existed" (which leaks existence) or (b) a separate read query that does NOT filter `deleted_at IS NULL` (which contradicts the locked invariant that soft-deleted is invisible to every read path). The 404 is the simpler, more consistent answer.

### 6.5 Response shape — `204 No Content` (proposal default)

A successful DELETE returns `204 No Content` with an empty body. The use case does NOT re-read after the soft-delete write (no projection needed; the editor view of a soft-deleted row is not meaningful — the row is gone from the client's perspective).

**Alternative considered:** `200 OK` with the editor view of the post-delete row. Rejected: the post-delete row has `deleted_at` set, and the editor view DTO has no `deleted_at` field — there's nothing meaningful to project back. The wire stays simpler with `204`.

### 6.6 Active-company gate on DELETE (proposal default)

Mirrors the PATCH active-company guard `jobs-reopen` just landed. A non-active company at the moment of the UPDATE yields `409 Conflict {"error":"company is not active"}`. The guard is in the same SQL statement as the tombstone write (no TOCTOU window between a separate company check and the UPDATE). Reuses `entities.ErrCompanyNotActive` and the existing `classifyError` branch.

**Rationale:** a recruiter of a now-suspended company deleting a job would let the row disappear from the board after the company was supposed to stop acting. The gate protects that.

### 6.7 Read-side — zero change (proposal default)

No read-side change. The visibility predicate `status='published' AND deleted_at IS NULL AND companies.status='active'` is unchanged on `SearchJobs` and `GetJobByID`. The `GetJobForUpdate` SQL is unchanged. The `UpdateJob` WHERE is unchanged. A soft-deleted row is already invisible on every read path.

### 6.8 Interaction with re-open (locked)

`PATCH /jobs/{id}` with `{"status":"draft"}` or `{"status":"published"}` against a soft-deleted row returns `404 job not found` (the `GetJobForUpdate` returns `ErrJobNotFound` because `deleted_at IS NOT NULL`). This is consistent with the canonical spec scenario "soft-deleted id returns 404" and the locked decision #3 above.

### 6.9 Audit — `deleted_at` is the audit timestamp (proposal default)

No new column. `deleted_at TIMESTAMPTZ` carries "when was this row tombstoned?". The recruiter who issued the DELETE is not recorded (would require a `deleted_by_user_id` column; out of scope per locked decision #8; can be added later as a separate column without breaking this change).

## 7. Scope (first slice)

### 7.1 HTTP surface

**NEW** `DELETE /jobs/{id}` — gated by `RequireAuth` + `RequireCompanyRole(recruiter)`. Path carries the row's UUID. No request body. Success returns `204 No Content`. `If-Unmodified-Since` header carries the CAS token (RFC 3339).

The route is mounted on the ROOT router at `cmd/api/main.go`, outside the public `r.Mount("/jobs", jobHandler.Routes())` mount. The per-method `JobHandlers()` accessor exposes `SoftDeleteJob http.HandlerFunc` next to `UpdateJob` / `CreateJob`. The structural guarantee that DELETE never lands on the public mount is the same routing-split defense that `PATCH` and `POST` already use.

### 7.2 Application / domain additions

- `application/usecases/softDeleteJob.go` (**NEW**) — `SoftDeleteJob(ctx, companyID, jobID uuid.UUID, ifUnmodifiedSince time.Time) error`. The orchestrator's flow:
  1. `GetForUpdate(jobID, companyID)` → `ErrJobNotFound` propagates → handler 404.
  2. CAS compare: `ifUnmodifiedSince.Equal(current.UpdatedAt)` — mismatch → `toEditorView(current), entities.ErrConcurrencyConflict` → handler `409` + editor view (matches the PATCH `409` body shape).
  3. `repo.SoftDelete(ctx, jobID, companyID, casUpdatedAt := current.UpdatedAt)` — atomic UPDATE with active-company CTE guard. Adapter inspects `row.GuardPassed` and `row.DeletedCount`:
     - `!GuardPassed` → `ErrCompanyNotActive` → handler 409.
     - `GuardPassed, DeletedCount == 0` → `ErrJobNotFound` (CAS lost / cross-company / soft-delete race with active company — same D3 matrix as `UpdateJob`).
     - `GuardPassed, DeletedCount == 1` → success → `nil`.
  4. **No** re-read for the success path (no view to project; the response is `204`).
- `application/usecases/jobService.go` (**MOD**) — add `SoftDeleteJob` method; declare `SoftDeleteJobUseCase` interface next to `EditJob` / `CreateJobUseCase`; `NewJobService` signature unchanged (the repo port is the only constructor argument).
- `application/dtos/updateJobDto.go` — **UNCHANGED** (DELETE has no body).
- `domain/entities/job.go` — **UNCHANGED** (no new sentinels; `ErrJobNotFound`, `ErrConcurrencyConflict`, `ErrCompanyNotActive` are reused).
- `domain/repositories/jobRepository.go` (**MOD**) — extend the port with `SoftDelete(ctx, id, companyID uuid.UUID, casUpdatedAt time.Time) error`. Signature mirrors `Update(...) error` exactly (same `casUpdatedAt` shape, same error semantics).

### 7.3 Persistence (sqlc)

- **NEW** query in `backend/db/queries/jobs.sql`:
  - `SoftDeleteJob :one` — atomic single-statement soft-delete with the active-company CTE guard. The shape mirrors `UpdateJob`'s `WITH active AS … , upd AS (UPDATE … RETURNING id) SELECT guard_passed, deleted_count` so the adapter reads the result matrix identically. Column list in the `RETURNING` is just `id` (the adapter only needs `deleted_count` and `guard_passed`; no editor-view projection because the success response has no body).
- **MOD** `mapSoftDeleteError` in the postgres adapter (new function) — mirrors `mapUpdateError` exactly: `pgx.ErrNoRows → ErrCompanyNotActive` (defense-in-depth; the `:one` scalar SELECT always returns one row), `23514 → ErrInvalidStatusTransition` (defense-in-depth), pass-through for unknown errors. `23503` is NOT mapped (soft-delete does not insert or reassign `company_id`; not applicable).
- **NEW** `buildSoftDeleteJobParams` — translates `(id, companyID, casUpdatedAt)` into the sqlc `SoftDeleteJobParams` struct. Mirrors the id/CAS portion of `buildUpdateJobParams` (no patch fields).
- **MOD** the postgres adapter's `SoftDelete` method — calls `queries.SoftDeleteJob`, runs `mapSoftDeleteError`, inspects `row.GuardPassed` and `row.DeletedCount`, returns the matching domain sentinel or `nil`.
- Regen `backend/internal/db/jobs.sql.go` + `backend/internal/db/querier.go` via `cd backend && go tool sqlc generate`. Existing five queries (`SearchJobs`, `GetJobByID`, `GetJobForUpdate`, `CreateJob`, `UpdateJob`) regenerated verbatim and unchanged.

### 7.4 Infrastructure / wiring

- `infrastructure/http/jobHandler.go` (**MOD**):
  - Add `softDeleteJob` handler func, mirroring `updateJob` but with no body and no `If-Unmodified-Since` is required (zero token → CAS mismatch → 409 — same as PATCH): `requireCompanyContext` (fail-closed 500 if missing) → parse path `{id}` as UUID (400 on malformed) → parse `If-Unmodified-Since` (RFC 3339; absent/malformed → zero time) → `service.SoftDeleteJob(ctx, cc.CompanyID, id, ifUnmodifiedSince)` → on `ErrConcurrencyConflict` write the editor view with `409` (the same special-case `updateJob` already has) → on success write `204 No Content` (empty body) → on any other error `classifyAndWriteError`.
  - Extend `JobHandlers` accessor struct with `SoftDeleteJob http.HandlerFunc`.
  - `classifyError` is **UNCHANGED** — `ErrCompanyNotActive`, `ErrJobNotFound`, `ErrConcurrencyConflict` are already classified.
- `cmd/api/main.go` (**MOD**):
  - One new route line on the gated subtree: `r.With(requireAuth, requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)`. `requireAuth` and `requireRecruiter` are already hoisted at `run()` scope. The public `r.Mount("/jobs", jobHandler.Routes())` MUST NOT gain the DELETE — same routing-split defense as PATCH and POST.

## 8. Explicit non-goals (out of scope for this change)

- **No hard delete / PURGE** — the row stays in `jobs` with `deleted_at` set. A future `DELETE /jobs/{id}/purge` (or an admin endpoint) is a separate change.
- **No restore / undelete endpoint** — `PATCH /jobs/{id}` `{"deleted_at": null}` is **not** accepted (the PATCH DTO has no `deleted_at` field; even if it did, restore would need to bypass the read-side `deleted_at IS NULL` filter in `GetForUpdate`, which contradicts the locked invariant). Restore is a separate future endpoint.
- **No notifications / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous.
- **No candidates impact** — a soft-deleted job does NOT notify previous applicants, does NOT carry applicant history forward in the API, does NOT auto-withdraw applications. Candidates are a separate bounded context (out of scope here).
- **No public read-side change** — `GET /jobs` and `GET /jobs/{id}` shapes are unchanged. A soft-deleted row is invisible to both because the existing visibility predicate requires `deleted_at IS NULL`.
- **No `deleted_by_user_id` column** — out of scope; the audit trail is the row's `deleted_at` + `updated_at` (the latter captures the CAS-token advance).
- **No bulk DELETE** — `DELETE /jobs?ids=...` or `DELETE /jobs/{id1},{id2}` is out of scope. One vacancy per request.
- **No re-open path that restores soft-deleted rows** — locked decision #3. Soft-deleted stays `404` on `PATCH /jobs/{id}`.
- **No `search_vector` write** — `search_vector` is STORED generated; the soft-delete UPDATE does NOT touch `title` or `description`, so the STORED column is naturally unchanged. The partial index `jobs_public_listing_idx` (predicated on `deleted_at IS NULL`) correctly drops the row from the index after the tombstone is set (Postgres maintains partial indexes automatically).
- **No `closed_at` column** — the canonical schema has no close timestamp. Adding one is out of scope. The "first published at" timestamp is `published_at` (preserved); the "tombstoned at" timestamp is `deleted_at` (newly set).
- **No change to `closed → closed`, `draft → closed`, or any other transition** — soft-delete is orthogonal to status; the status transitions on `PATCH /jobs/{id}` are unchanged.
- **No `company_members` ownership** — out of scope (still deferred from canonical spec).
- **No new migration** — the `jobs` table already has `deleted_at`.

## 9. Affected areas (file inventory)

All under `backend/`. New files marked **NEW**; modified files marked **MOD**. The locked scope is `4 authored + 2 generated` files for the production code, plus `5 stub files` for the test surface (atomic stub repair per locked decision #9).

### Production code

- **NEW** `backend/internal/features/jobs/application/usecases/softDeleteJob.go` — `SoftDeleteJob` use case (GetForUpdate → CAS → repo.SoftDelete; no re-read on success).
- **MOD** `backend/internal/features/jobs/application/usecases/jobService.go` — `SoftDeleteJob` method + `SoftDeleteJobUseCase` interface; `NewJobService` signature unchanged.
- **MOD** `backend/internal/features/jobs/domain/repositories/jobRepository.go` — extend port with `SoftDelete` method (signature mirrors `Update`).
- **MOD** `backend/db/queries/jobs.sql` — add `SoftDeleteJob :one` query (CTE guard + scalar SELECT).
- **MOD** `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` — `SoftDelete` method + `buildSoftDeleteJobParams` + `mapSoftDeleteError`. `var _ repositories.JobRepository = (*JobRepository)(nil)` assertion stays; the port extension forces a compile break in the adapter (resolved in the same commit).
- **MOD** `backend/internal/features/jobs/infrastructure/http/jobHandler.go` — `softDeleteJob` handler + `JobHandlers.SoftDeleteJob` field; `classifyError` unchanged.
- **MOD** `backend/cmd/api/main.go` — one new line: `r.With(requireAuth, requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)`.
- **MOD (generated)** `backend/internal/db/jobs.sql.go` — regen via `go tool sqlc generate`; gains `SoftDeleteJobParams` + `SoftDeleteJobRow {GuardPassed bool; DeletedCount int64}` + `SoftDeleteJob` method.
- **MOD (generated)** `backend/internal/db/querier.go` — regen; `Querier.SoftDeleteJob` interface method signature changes.

### Test surface (atomic stub repair + new tests)

- **MOD** `backend/internal/features/jobs/application/usecases/searchJobs_test.go` — `stubJobRepository` gains a `SoftDelete` method (atomic stub repair per locked decision #9); default returns `nil` to keep existing tests green.
- **MOD** `backend/internal/features/jobs/application/usecases/updateJob_test.go` — `writeStubRepo` gains a `SoftDelete` method with a programmable `softDeleteErr`; default returns `nil`.
- **MOD** `backend/internal/features/jobs/application/usecases/createJob_test.go` — `writeStubRepo` (shared type) gains the same `SoftDelete` method; default returns `nil`.
- **MOD** `backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go` — `writeStubHandlerRepo` gains a `SoftDelete` method with a programmable `softDeleteErr` and capture fields; default returns `nil`.
- **MOD** `backend/internal/features/jobs/infrastructure/http/createJobHandler_test.go` — `writeStubHandlerRepo` (shared type) gains the same `SoftDelete` method.
- **NEW** `backend/internal/features/jobs/application/usecases/softDeleteJob_test.go` — use-case tests (any-status, CAS mismatch, gate propagation, success path).
- **NEW** `backend/internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go` — handler tests (missing CompanyContext → 500, invalid UUID → 400, missing `Authorization` → 401, DELETE not served by public mount → 404/405, missing CAS → 409, CAS mismatch → 409 + view, cross-company → 404, success → 204, company-not-active → 409, owner passes recruiter gate).
- **NEW** `backend/internal/features/jobs/infrastructure/postgres/jobRepository_softDelete_test.go` (unit, no DB) — `mapSoftDeleteError` + `buildSoftDeleteJobParams` + `SoftDelete` row inspection tests.
- **MOD** `backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go` — add SQL-level integration tests (`//go:build integration`): any-status soft-delete, `deleted_at` is set, public read after soft-delete returns `ErrJobNotFound` (read invisibility), active-company gate, soft-delete of an already-soft-deleted row returns `ErrJobNotFound`, soft-delete of a cross-company row returns `ErrJobNotFound`.

### UNCHANGED

- `cmd/api/main.go` other than the one new route line.
- `application/dtos/updateJobDto.go`, `application/dtos/createJobDto.go`, `application/dtos/jobEditorViewDto.go`, `application/dtos/searchJobsDto.go`, `application/cursor/cursor.go`.
- `application/usecases/updateJob.go`, `application/usecases/createJob.go`, `application/usecases/searchJobs.go`, `application/usecases/getJobByID.go` (zero use-case changes outside the new file).
- `domain/entities/job.go`, `domain/entities/jobForUpdate.go`, all `domain/valueobjects/*.go`.
- `infrastructure/postgres/jobRepository.go::Search`, `::GetByID`, `::GetForUpdate`, `::Update`, `::Create` — unchanged. New method only.
- All migrations under `backend/db/migrations/` (no new migration; `00007_jobs.sql` already has `deleted_at`).
- All read-side SQL queries (`SearchJobs`, `GetJobByID`) and `GetJobForUpdate` — unchanged.
- The `UpdateJob` SQL — unchanged (the soft-delete path is a separate query, not a flag on Update).
- `internal/db/jobs.sql.go` other than the regenerated method/row additions.

## 10. New infrastructure dependency

None. No new package, no new env var, no new docker-compose service, no new migration. The slice reuses `uuid` (google/uuid), `pgx/v5`, `pgconn`, `pgtype`, `chi`, and `slog` already imported by the `jobs` slice.

## 11. Risks

1. **Routing split** — the DELETE route shares the path root (`/jobs`) with the public GETs. If a future refactor reverts to a single `chi.Mount("/jobs", …)` subrouter that includes the DELETE, the soft-delete path becomes publicly reachable. The per-method `JobHandlers()` accessor + the explicit gated `Delete(...)` line in `main.go` is the defense; the spec MUST call it out, and a handler test that hits the route with no `Authorization` header MUST assert `401`. Same defense pattern as PATCH and POST.
2. **Cross-company / non-existent / soft-deleted 404 indistinguishability** — by design (canonical spec §Same-Company Invariant). No leak of row existence. Pinned by the existing `TestGetForUpdate_CrossCompanyReturnsErrJobNotFound`, `TestGetForUpdate_SoftDeletedReturnsErrJobNotFound`, `TestGetForUpdate_NonExistentReturnsErrJobNotFound`.
3. **CAS interaction with concurrent PATCH** — a recruiter holding a stale `If-Unmodified-Since` (e.g., they last read the job when it was `published`, then a PATCH closed it, then they DELETE) sees `409` with the latest editor view. The editor view shows `status="closed"` and a new `updated_at` — the client must re-read and decide whether to re-issue with the new token (or accept that the row's state has moved and re-evaluate). Same `409`-with-view body shape that PATCH already returns. No new error path.
4. **Active-company race** — between the `RequireCompanyRole` middleware and the soft-delete UPDATE, a company could be suspended. The atomic SQL guard eliminates the window because the active predicate lives in the same statement that writes the tombstone (`WITH active AS … AND EXISTS (SELECT 1 FROM active)`). There is no "check then write" sequence in the use case to race.
5. **Second DELETE on already-soft-deleted ** — returns `404` (consistent with soft-deleted-is-invisible on every read path). The `GetJobForUpdate` SQL already filters `deleted_at IS NULL`, so the read-for-delete returns `ErrJobNotFound`. No new SQL change is needed to enforce this; the existing predicate handles it.
6. **`deleted_at` immutability on PATCH** — `deleted_at` is NOT touched by `UpdateJob`'s `SET` list (verified by the existing `TestUpdate_ImmutablesNeverTouched`). The soft-delete write is the ONLY way to set `deleted_at`. This is a property the existing tests already pin; the soft-delete slice adds the SQL that sets it.
7. **`search_vector` after soft-delete** — the STORED generated column is computed from `title` and `description`. Soft-delete does not touch those, so the STORED column is unchanged. The partial index `jobs_public_listing_idx` (predicated on `deleted_at IS NULL`) automatically drops the row from the index when `deleted_at` is set — Postgres maintains partial indexes on UPDATE. No additional SQL is needed.
8. **`published_at` preserved on soft-delete** — soft-delete sets only `deleted_at = now()` and `updated_at = now()`. `published_at` is untouched (audit history). For a `published` or `closed` row, `published_at` carries the "first published at" timestamp from the canonical schema; the soft-delete does not erase it. The use case does not need to read `published_at` (no editor view is projected); the SQL UPDATE simply does not include `published_at` in its `SET` list.
9. **No candidates impact** — explicitly out of scope. A future change may carry applicant history forward or auto-withdraw applications; this slice does neither.
10. **Stub-repair atomicity** — adding `SoftDelete` to the port breaks every stub + the `var _` compile-time assertion. The five stubs (`stubJobRepository`, `writeStubRepo` in two test files, `writeStubHandlerRepo` in two handler test files) plus the assertion must be touched in the **same commit** as the port extension, exactly mirroring the `jobs-create` D10 atomic five-stub repair.

## 12. Rollback plan

Simplest safe rollback: **revert the merge commit**. Because there is no migration, no schema change, no new package, and no env var:

- Reverting `main.go` removes the `DELETE /jobs/{id}` route registration. The pre-existing public `GET /jobs` and `GET /jobs/{id}` keep working; the pre-existing gated `PATCH /jobs/{id}` and `POST /jobs` keep working.
- Reverting the handler / use case / repository / sqlc files restores the prior write-side slice; any caller that had integrated against the new endpoint loses it on deploy.
- No data migration is needed in either direction: `deleted_at` is the only new value the slice sets; no column is added or dropped. (If a future restore/undelete endpoint is built, it operates on rows whose `deleted_at IS NOT NULL`; reverting this slice does NOT touch those rows.)
- No feature flag is required for the first rollout; if a staged rollout is later desired, gating DELETE behind an env flag (e.g., `FEATURE_JOBS_SOFT_DELETE_ENABLED`) in `main.go` is a one-line addition that costs nothing in this slice.

## 13. Success criteria

- A recruiter of an `active` company `A` can `DELETE /jobs/{id}` with a matching `If-Unmodified-Since` header; the response is `204 No Content` with an empty body.
- Immediately after a successful soft-delete, `GET /jobs/{id}` for the same id returns `404 job not found` (the existing read-side `deleted_at IS NULL` predicate hides the row).
- Immediately after a successful soft-delete, `GET /jobs` excludes the row (the same predicate hides it from the listing; the partial index drops it).
- A recruiter of a `suspended` company `A` sending `DELETE /jobs/{id}` with a matching CAS token receives `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT tombstoned (the atomic SQL guard produces 0 rows; the adapter maps `GuardPassed=false` to `ErrCompanyNotActive`; `classifyError` returns `409 company is not active`).
- A recruiter of company `B` sending `DELETE /jobs/{id-of-company-A}` receives `404 job not found` (same-company invariant; identical body to a non-existent id).
- A recruiter sending a stale `If-Unmodified-Since` (or no header) receives `409 Conflict` with the latest editor view in the body (CAS compare; same shape as PATCH `409`).
- A recruiter sending `DELETE /jobs/{id}` for a row that is already soft-deleted receives `404 job not found` (the read-for-delete returns `ErrJobNotFound` because `GetJobForUpdate`'s `deleted_at IS NULL` predicate filters it out).
- A recruiter of an `active` company can soft-delete a job in **any** status (`draft`, `published`, or `closed`); `published_at` is preserved across the soft-delete (audit history).
- An unauthenticated `DELETE /jobs/{id}` receives `401 unauthenticated` (RequireAuth short-circuit).
- A non-member of the job's owning company receives `403 not a member / role too low` (RequireCompanyRole short-circuit).
- A malformed UUID (`DELETE /jobs/not-a-uuid`) returns `400 invalid job id`.
- A `DELETE` request sent through the PUBLIC `r.Mount("/jobs", …)` mount returns chi 405 (or 404) — the public mount never serves the DELETE; the gated route on the ROOT router is the only path that does.
- Strict TDD: every behavior above has a RED test that pre-dates its GREEN implementation; `cd backend && go test ./...` is green; `cd backend && go vet ./...` is clean.
- `go tool sqlc generate` is idempotent (a second run produces an empty `git diff`).

## 14. Open items for the design phase

The user round (§15) will resolve items 1–5; the design phase picks up the rest:

1. **`SoftDeleteJob :one` SQL guard shape** — the proposal recommends mirroring `UpdateJob :one` exactly: `WITH active AS … , upd AS (UPDATE jobs SET deleted_at = now(), updated_at = now() WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND updated_at = $3 AND EXISTS (SELECT 1 FROM active) RETURNING id) SELECT EXISTS (SELECT 1 FROM active) AS guard_passed, (SELECT count(*) FROM upd) AS deleted_count;`. The SET list is intentionally minimal (`deleted_at` + `updated_at` only); `published_at` is preserved. Design phase confirms or refines.
2. **`buildSoftDeleteJobParams` ergonomics** — at minimum `(id, companyID, casUpdatedAt)`; the `SoftDeleteJobParams` sqlc struct gains `ID uuid.UUID`, `CompanyID uuid.UUID`, `CasToken pgtype.Timestamptz`. Design phase confirms.
3. **`SoftDeleteJobRow` field naming** — `GuardPassed bool` + `DeletedCount int64`. The names are pinned by the SQL aliases. Design phase confirms.
4. **Use-case `CAS compare` semantics** — proposal default: `if !ifUnmodifiedSince.Equal(current.UpdatedAt) { return (view, ErrConcurrencyConflict) }`. Edge cases: zero token (missing header) → guaranteed mismatch → `409`. Trailing-precision mismatch (RFC 3339 vs RFC 3339Nano) — the existing `parseIfUnmodifiedSince` parses `RFC3339` (whole-second precision). A client using `time.RFC3339Nano` may hit a mismatch on a freshly-written row whose `updated_at` has sub-second precision. The PATCH flow has the same edge case; design phase confirms the SoftDelete behavior matches PATCH exactly (no special handling).
5. **Stub repair shape** — every stub gains a `SoftDelete` method. Design phase confirms the captured fields (`lastSoftDeleteID`, `lastSoftDeleteCompany`, `lastSoftDeleteCas`, `softDeleteErr`) and the default return (`nil` to keep existing tests green).
6. **SQL-level integration test fixtures** — `wpDeletedID` already exists in `jobRepository_write_integration_test.go` as a soft-deleted row (status=`published`, `deleted_at IS NOT NULL`). The new integration tests use `wpDraftID` (draft), `wpClosedID` (closed), and `wpPublishedID` (published) as the "deletable" fixtures, and `wpDeletedID` as the "already-deleted" fixture. The test for "public read invisibility after soft-delete" re-reads via the existing `repo.GetByID` (visibility-narrowed) and asserts `ErrJobNotFound`.
7. **`closed → …` and soft-delete interaction** — `PATCH {"status":"draft"}` on a soft-deleted closed row stays `404` (locked decision #3; the read-for-update sees the row filtered by `deleted_at IS NULL`). No new test is required (the existing `TestGetForUpdate_SoftDeletedReturnsErrJobNotFound` covers the read-for-update side; the `EditJob` closed-row rejection tests cover the transition table side; the composition is naturally 404).
8. **`mapSoftDeleteError` defense-in-depth** — proposal default: same as `mapUpdateError` (`pgx.ErrNoRows → ErrCompanyNotActive` defense-in-depth; `23514 → ErrInvalidStatusTransition` defense-in-depth). `23503` (FK violation) is not mapped (soft-delete does not insert or reassign `company_id`). Design phase confirms.

## 15. Proposal question round (RESOLVED — user answers 2026-08-25)

The user answered all four blocking questions; all answers match the proposal defaults. Locked decisions now stand in §6 / §14:

1. **CAS on DELETE — RESOLVED: required.** `If-Unmodified-Since` header, RFC 3339, same as PATCH. Stale/missing header → `409 Conflict` with latest editor view (same body shape as PATCH 409). Coupled with #4: the second DELETE with a stale token returns `409`, with the current token returns `404`.
2. **Response shape — RESOLVED: `204 No Content`** (empty body). The editor view has no `deleted_at` and would render phantom content; `204` is the cleaner contract for "the row is gone".
3. **Status eligibility — RESOLVED: any status** (`draft`, `published`, `closed` all soft-deletable in one DELETE). Removing a `published` job from the board is one step, not PATCH-close + DELETE.
4. **Second-delete idempotency — RESOLVED: `404 job not found`** (consistent with the soft-deleted-is-invisible invariant; read-for-delete returns `ErrJobNotFound`).
5. **Rule #2 extension — CONFIRMED**: any recruiter of the company soft-deletes any job of the company (owner via ordinal), mirroring the PATCH and CREATE gates.

## 16. Cross-references

- `openspec/specs/jobs/spec.md` — the canonical spec (29 requirements, 124 scenarios). The relevant existing scenarios this change reuses without modification: "GET /jobs/{id} hides non-visible jobs" (soft-deleted), "Read-Side Visibility Rule", "soft-deleted id returns 404", "non-existent id returns 404", "cross-company id returns 404". No canonical scenario is invalidated; the soft-delete write is a new addition.
- `openspec/changes/archive/2026-08-25-jobs-reopen/{proposal.md,design.md,specs/jobs/spec.md}` — the most recent write-side delivery. Reuses D1 (atomic active-company CTE guard via `:one` scalar SELECT), D4/D5 (transition table), D6 (published_at preservation), D7 (sqlc regen touches both generated files).
- `openspec/changes/archive/2026-08-25-jobs-create/{proposal.md,design.md,specs/jobs/spec.md}` — the create delivery. Reuses the atomic active-company SQL guard precedent on the INSERT; mirrors the routing-split defense (per-method `JobHandlers()` accessor + explicit gated `Delete(...)` line on the ROOT router).
- `openspec/changes/archive/2026-08-24-jobs-write-side/{proposal.md,design.md,specs/jobs/spec.md}` — the original PATCH delivery. Reuses the editor view DTO (`toEditorView` for the `409` body), the `ErrConcurrencyConflict` handler special-case, the `parseIfUnmodifiedSince` helper, and the `RequireCompanyContext` fail-closed 500 invariant.
- `backend/db/queries/jobs.sql::UpdateJob` — the `:one` atomic guard shape to mirror (D1 from `jobs-reopen`).
- `backend/db/migrations/00007_jobs.sql` — the `jobs` schema with `deleted_at TIMESTAMPTZ NULL` already present (column 16); `jobs_public_listing_idx` already predicated on `deleted_at IS NULL`; no new migration.
- `backend/internal/features/jobs/application/usecases/updateJob.go` — the `EditJob` orchestrator and the `toEditorView` projection; `SoftDeleteJob` mirrors the read-for-update + CAS portion of `EditJob`'s step 1 + step 2, then calls `repo.SoftDelete` (a new port method) instead of `repo.Update`. The `toEditorView` helper is reused for the `409` body.
- `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go::Update` + `::mapUpdateError` — the adapter pattern to mirror for `SoftDelete` + `mapSoftDeleteError`. Same `pgx.ErrNoRows → ErrCompanyNotActive` ordering (BEFORE the `errors.As` into `*pgconn.PgError`).
- `backend/cmd/api/main.go` (lines around `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", …)` and `.Post("/jobs", …)`) — the composition-root pattern for layered per-route middleware; the new DELETE lives on the same gated subtree, one line below POST.
- `backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go::wpDeletedID` — existing fixture (a soft-deleted row with `status='published'`, `deleted_at = '2026-07-03T12:00:00Z'`); the new integration tests reuse this as the "already-deleted" fixture and add `wpDraftID` / `wpClosedID` / `wpPublishedID` as "deletable from any status" fixtures.
- `backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go::TestUpdate_ImmutablesNeverTouched` — existing test pinning `deleted_at` as immutable across PATCH; the soft-delete slice adds the SQL that sets it.
- `openspec/config.yaml` (`proposal` rules) — rollback, file paths, infra dependencies all honored.
