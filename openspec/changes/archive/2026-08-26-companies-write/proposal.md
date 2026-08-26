# Proposal: `companies-write`

Status: proposal (pre-spec, pre-user-round). Artifacts produced in this phase: this file only (no spec, design, or tasks yet). Grounded by the canonical schema (`backend/db/migrations/00002_create_companies.sql`, `00003_companies_profile.sql`, `00007_jobs.sql`), the existing `companies` slice (`backend/internal/features/companies/`), the `jobs` slice write-side precedents (`backend/internal/features/jobs/application/usecases/{updateJob.go,softDeleteJob.go}`), the transactional multi-write precedent (`backend/internal/features/applications/infrastructure/postgres/applicationRepository.go` + `backend/internal/features/companies/infrastructure/postgres/companyBootstrapRepository.go` + `backend/internal/features/candidates/infrastructure/postgres/candidateRepository.go::ReplaceLanguagesByUserID`), the authz seam (`backend/internal/features/identity/infrastructure/http/requireCompanyRole.go` + `backend/internal/features/identity/domain/security/companyContext.go`), and the archived membership slice (`openspec/changes/archive/2026-08-20-company-members/`).

## 1. Intent

Introduce the **owner-only write surface for the `companies` aggregate** that completes the MVP write loop today shipped by `POST /companies` (create) and `GET /companies/{id}` (read):

- `PATCH /me/company` — **partial update** of the owner's company. RFC and industry are immutable; `name` and every profile field (`website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`) are patchable. Optimistic concurrency is enforced via `If-Unmodified-Since` against `companies.updated_at`, mirroring the `EditJob` CAS pattern.
- `DELETE /me/company` — **soft-delete** the owner's company. Sets `companies.deleted_at = now()` AND transactionally closes every job of the company (draft/published → closed) in the same SQL transaction. Company memberships and applications stay untouched as history.

Both endpoints are gated by the existing `RequireCompanyRole(owner)` middleware (the same one the membership mutation routes already use), live under `/me/company` next to the existing `GET /me/company`, and read `company_id` exclusively from `security.CompanyContext{CompanyID, UserID, Role}` injected by the middleware. The path never carries `company_id`; the body never carries `company_id`.

**This proposal deliberately stops at the companies slice.** Audit events for company updates / soft-deletes are **explicitly deferred** to a follow-up cycle (see §4.13 + §4.14 + §8). The `audit_events` bounded context stays applications-only for now.

## 2. Problem / opportunity

Today the `companies` slice exposes exactly two operations: `POST /companies` (create) and `GET /companies/{id}` (read). The owner of a company cannot:

1. **Edit the company's name or any profile field after creation.** There is no API path. Every correction ("fix the logo URL", "update the LinkedIn handle", "rename after rebrand", "add the year of founding") today requires either a direct SQL `UPDATE companies SET …` from a maintenance script (which bypasses the `RequireCompanyRole(owner)` gate and the CAS concurrency control) or, worse, a `DELETE FROM companies` + `POST /companies` rebuild (which loses `company_id`, cascades to `company_members`, breaks `jobs.company_id` FK references, and invalidates every application row referencing those jobs).
2. **Soft-delete the company when it shuts down or rebrands.** Without a tombstone path, the company's public profile (`GET /companies/{id}`) stays forever visible, the company's `draft` and `published` jobs stay on the public job board (`GET /jobs`, `GET /jobs/{id}` filter by `companies.status = 'active'` only — they do NOT yet filter by `companies.deleted_at IS NULL`, but the inline close-jobs step below makes the leak moot), and any new applications to those jobs continue to be accepted. There is no admin takedown path and no self-serve shutdown path.

The schema is already prepared for both:

- `companies` already has `deleted_at TIMESTAMPTZ` (migration `00002`, column 9) — the tombstone column exists, is nullable, and is partially unique (`companies_rfc_unique ON (rfc) WHERE deleted_at IS NULL`) so a soft-deleted RFC can be reused.
- `companies.updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` already exists (migration `00002`, column 8) — the CAS token column is in place.
- `jobs.status` already has the closed terminal value (`draft → published → closed` vocabulary, `migration 00007`, CHECK constraint). The transition from `draft`/`published` to `closed` is already a legal transition (jobs-reopen slice).

What is missing is the two write paths that set those columns behind the same gate, CAS, and transactional guarantee every other write goes through.

## 3. Target users and situations

- **Owner fixing the company profile** — `PATCH /me/company` with a JSON body carrying the fields to change and the `If-Unmodified-Since: <last_known_updated_at>` header. Absent fields are unchanged; `rfc` and `industry_id` are silently ignored if sent (the handler maps them to "no change"; the use case never even reads them — `encoding/json` drops unknown / re-declared fields from the DTO). The owner sees `200 OK` with the updated company record (RFC + industry + status omitted from the response — see §4.11).
- **Owner rebranding (name change)** — same `PATCH /me/company` flow with `{"name": "New Co."}`. Same response shape.
- **Owner shuttering the company** — `DELETE /me/company` with `If-Unmodified-Since: <last_known_updated_at>`. The atomic transaction sets `deleted_at = now()` on `companies` AND transitions every non-closed job of the company from `draft`/`published` to `closed` AND touches `updated_at` on `companies` for the post-write read. Response: `204 No Content` (empty body). The company record is invisible to every subsequent `GET /companies/{id}` (the existing read SQL filters `deleted_at IS NULL`); the company's jobs disappear from `GET /jobs` and `GET /jobs/{id}` (the inline close flips them out of the visibility predicate `status='published'` AND the `GetJobByID` predicate already excludes `companies.status='active'` for tombstoned companies via the inline close — see §4.8 read-side hardening delta).
- **Owner with a stale CAS token** — `PATCH` or `DELETE` returns `409 Conflict` with the latest company record (PATCH) or no body (DELETE — see §6.7). The client re-reads, decides whether to re-issue with the fresh token.
- **Recruiter (non-owner) attempting write** — the gate short-circuits with `403 forbidden` BEFORE the handler runs. The owner-only constraint is enforced by the middleware, not the handler; the handler never has to defend against a non-owner.
- **Non-member attempting write** — the middleware's membership-resolver returns `403 not a member of any company`. The handler never runs.
- **Unauthenticated request** — `RequireAuth` short-circuits with `401 unauthenticated` (env-not-set fail-closed verifier → every token rejected; IDENTITY_JWT_* set → JWT signature verified → sub resolved).
- **Recruiter of a soft-deleted company** — `GET /me/company` still returns the membership record + company (read is unchanged in this slice; the soft-delete write does NOT touch `company_members`), but `PATCH /me/company` returns `404 company not found` because the write path's `GetCompanyForUpdate` filters `deleted_at IS NULL`. `DELETE /me/company` likewise returns `404 company not found`. A second `DELETE` on the already-soft-deleted company returns the same `404` (the `deleted_at IS NULL` predicate already filters it out at the read-for-delete step).
- **Concurrent soft-deletes** — exactly one wins (`204`), the other gets `404 company not found` (the read-for-delete already sees `deleted_at IS NOT NULL` on the second call). Same indistinguishability as PATCH and DELETE on jobs.

## 4. Locked business decisions (DO NOT re-open)

These were answered explicitly by the user in this session. They MUST be honored verbatim in spec, design, and apply.

1. **Owner-only authorization (both PATCH and DELETE)** — the gate is `RequireCompanyRole(owner)` (`backend/internal/features/identity/infrastructure/http/requireCompanyRole.go` with `minRole = valueobjects.OwnerRole`). The middleware resolves `cognito_sub → users.id → company_members` per request (the D6 "resolves once" pattern) and injects `security.CompanyContext{CompanyID, UserID, Role}` into the request context. The handler reads `cc.CompanyID` and never consults the JWT subject again; the path carries no `company_id`; the body carries no `company_id`. Recruiter (role=recruiter, ordinal < owner) gets `403` from the middleware before the handler runs. There is no `PATCH /companies/{id}` or `DELETE /companies/{id}` endpoint — both live under `/me/company`.
2. **Delete semantics — soft-delete + transactional close of all company jobs** — `DELETE /me/company` is a single SQL transaction: `UPDATE companies SET deleted_at = now(), updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL` (the soft-delete) PLUS `UPDATE jobs SET status = 'closed', updated_at = clock_timestamp() WHERE company_id = $1 AND deleted_at IS NULL AND status IN ('draft','published')` (the inline close — `closed` is excluded because closing an already-closed row is a no-op). The two writes happen inside the SAME `pgx.Tx` (adapter owns the `pool.Begin → db.New(tx) → tx.Commit` sequence; defer rollback on error — mirror the `companyBootstrapRepository.CreateWithOwner` and `applicationRepository.Create` patterns). On any error the transaction rolls back and NEITHER the tombstone NOR the close is visible. Company memberships (`company_members`) and applications (`applications`) stay UNTOUCHED as audit history — a soft-deleted company still has its member list and its application ledger intact for analytics / compliance / future restore.
3. **Field mutability — `rfc` and `industry_id` IMMUTABLE after creation** — the `PATCH /me/company` DTO has NO `rfc` field and NO `industry_id` field. The use case never reads them. `encoding/json` silently drops unknown keys, so a client that sends `{"rfc": "NEW123"}` gets the same outcome as if they didn't send it — RFC stays unchanged. (RFC uniqueness is enforced by the partial unique index `companies_rfc_unique ON (rfc) WHERE deleted_at IS NULL`; changing RFC after creation would require a uniqueness re-check that the MVP deliberately doesn't do — see §4.12.) MUTABLE fields are: `name`, `website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`. All eleven mutable fields use the pointer-DTO pattern (absent = unchanged), mirroring `EditJob`'s `UpdateJobDto` and `UpsertMyProfile`'s `UpsertMyProfileDto`.
4. **Audit events — DEFERRED to a follow-up cycle** — this cycle does NOT emit `audit_events` for companies. The `audit_events` bounded context stays applications-only (the only bounded context that co-writes events today). No `CompanyUpdated`, `CompanyDeleted`, or `CompanySoftDeleted` event types are added in this change. No `co-write` transaction wraps the audit append. The `audit_events` table, port, query file (`backend/db/queries/audit_events.sql`), and adapter are untouched. The follow-up cycle will (a) decide on the company event-type catalog (`CompanyUpdated`, `CompanyDeleted`, future `CompanySuspended`, future `CompanyRestored`); (b) extend the `audit_events` query file with the per-event INSERT; (c) update the port + the `events` JSON shape; (d) extend `audit_events.spec.md` with company-event requirements. This is an explicit non-goal (§8).
5. **CAS via `If-Unmodified-Since`** — `PATCH` and `DELETE` both require the header (RFC 3339, same wire format as `PATCH /jobs/{id}`). The server compares the parsed token to the row's current `updated_at` (loaded by the read-for-update / read-for-delete). Mismatch → `409 Conflict`; PATCH body is the latest company record (same wire shape as `200`); DELETE body is empty (matching `DELETE /jobs/{id}`). Missing or malformed header → zero token → mismatch → `409`. The handler helper `parseIfUnmodifiedSince` is the existing one in `backend/internal/features/jobs/infrastructure/http/jobHandler.go` (reused verbatim — copy into the companies handler if the jobs package can't be imported from the companies handler; the cleanest fix is to lift `parseIfUnmodifiedSince` into a small shared helper in `internal/shared/httpheaders` or duplicate the ~10-line function and add a comment that says "intentionally duplicated from jobs handler").
6. **No new migration** — `companies.deleted_at` (migration `00002`, column 9), `companies.updated_at` (migration `00002`, column 8), and `jobs.status` closed terminal (migration `00007`, CHECK constraint) are already in place. The only DB change is the addition of two new sqlc queries in `backend/db/queries/companies.sql` and one new sqlc query in `backend/db/queries/jobs.sql` (the inline close). The `companies` row write is `UPDATE`, not `ALTER TABLE` — no goose migration is needed.
7. **Same gate as PATCH and DELETE on jobs** — `RequireAuth` + `RequireCompanyRole(owner)`. The existing gated subtree at `backend/cmd/api/main.go` already wires `requireOwner := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, valueobjects.OwnerRole)` inside the `/me` block for the membership mutation routes. PATCH and DELETE on `/me/company` reuse the same hoisted `requireOwner` gate.
8. **Soft-delete is invisible on every read path** — the existing `GetCompanyByID` SQL (`backend/db/queries/companies.sql::GetCompanyByID`) already filters `deleted_at IS NULL`, so a soft-deleted company is invisible on `GET /companies/{id}`. The inline close (decision #2) ensures the company's jobs disappear from `GET /jobs` and `GET /jobs/{id}` (both filter `status='published'`; a closed job fails the predicate). **Read-side hardening delta** — the existing `SearchJobs` and `GetJobByID` SQL JOINs `companies` and filters `c.status = 'active'` but does NOT filter `c.deleted_at IS NULL`. A soft-deleted company with stale data (none, by the inline close — but defense-in-depth) could in principle leak through if a row's `status` was already `'closed'` (no inline transition) but its company is tombstoned. The cleanest fix is `AND c.deleted_at IS NULL` on both queries, but that adds a join predicate to the most-read query in the system. **Recommendation: keep the read-side hardening delta OUT of this cycle** and list as a follow-up. The inline close already removes the leak (a tombstoned company has zero non-closed jobs by the end of the DELETE transaction). The follow-up cycle adds the predicate for defense-in-depth only.
9. **Memberships stay — no cascade, no purge** — `DELETE /me/company` does NOT touch `company_members`. The member list stays as audit history (who was the owner at the time of shutdown, who was a recruiter). A future restore/undelete endpoint (out of scope) operates on the intact member list.
10. **Applications stay — no cascade, no auto-withdraw** — `DELETE /me/company` does NOT touch `applications`. Application rows stay as audit history (who applied to which job of this company). The jobs they reference are now `closed`, which the applications slice surfaces as a terminal state; the existing `GET /me/applications` flow continues to render those rows (the applications slice does not filter by `jobs.status` on the candidate-facing list — the row stays in the candidate's history).
11. **PATCH response shape — RFC, industry_id, status OMITTED; deleted_at OMITTED** — the `PATCH /me/company` 200 response is the redacted public company shape (no `rfc`, no `industry_id`, no `status`, no `deleted_at`). It reuses `companyPublicResponse` from `backend/internal/features/companies/infrastructure/http/handler.go` (the shape `GET /companies/{id}` already returns). `200` and `409` (CAS mismatch) MUST use the same shape so the client can re-read without a second round-trip (same invariant the jobs editor view enforces — spec requirement). The body's `updated_at` is the authoritative post-write value the client echoes as the next CAS token. `created_at` and `id` are also omitted on PATCH (no need to re-render identity / creation timestamps; same shape as `GET /companies/{id}`).
12. **RFC + industry re-uniqueness on PATCH is intentionally not implemented** — because PATCH cannot change RFC (decision #3), the partial unique index `companies_rfc_unique` is never re-checked on PATCH. This is fine: the index is a write-time uniqueness guard at INSERT (canonical create path) and a defense-in-depth on raw SQL writes; it does NOT participate in the PATCH flow.
13. **No `CompanyDeleted` / `CompanyUpdated` event_type catalog entry in this cycle** — see decision #4. The `audit_events` slice is untouched. The follow-up audit cycle adds the company-event catalog.
14. **No future-proofing for restore / undelete / hard delete** — restore (`POST /me/company/restore` or `PATCH /me/company {"deleted_at": null}`) is out of scope. Hard delete (`DELETE FROM companies`) is out of scope forever (bypasses audit). Re-suspension / status manipulation (`PATCH /me/company {"status": "suspended"}`) is out of scope — `status` is owned by the manual takedown flow pinned in `docs/flujo-verificacion-empresas.md` and the MVP defers the proactive flow.
15. **No notifications / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous, matching `jobs-soft-delete`, `jobs-create`, `jobs-reopen`, `applications`, and `audit_events`.

## 5. Locked technical decisions (DO NOT re-open)

These are pinned by the prior archived slices and reused verbatim. They are NOT re-litigated here.

1. **Reuse the existing `RequireCompanyRole(owner)` middleware** — `r.With(requireAuth, requireOwner).Patch("/me/company", …)` and `r.With(requireAuth, requireOwner).Delete("/me/company", …)` lines at `backend/cmd/api/main.go` inside the `/me` block, next to the existing `r.With(requireOwner).Post("/me/company/members", …)` lines. `requireOwner` is already wired in `cmd/api/main.go::run` (the `/me` block, line where the membership mutation gates are built). No new middleware.
2. **Reuse `security.CompanyContext` + the `requireCompanyContext` handler helper** — `identitysecurity.CompanyContextFromContext(r.Context())` is the gate-output reader. The fail-closed 500 invariant (missing CompanyContext from context → `500 internal server error`, NOT a misleading 401) is the same as `memberHandler.go::requireCompanyContext` and `jobHandler.go::requireCompanyContext`. The handler helper is duplicated verbatim (~10 lines) in the new companies handler so the import direction stays clean (the companies handler does NOT import the jobs handler).
3. **Reuse `If-Unmodified-Since` RFC 3339 wire format and `parseIfUnmodifiedSince`** — handler helper from `jobHandler.go` is duplicated in the companies handler (same rationale: no cross-feature import). The use case compares `current.UpdatedAt` to the parsed token. Trailing-precision behavior matches `EditJob` exactly: zero `time.Time{}` on absent/malformed header → guaranteed mismatch → `409`.
4. **Reuse the `UpdateJob :one` atomic CTE guard shape** — for the new `CloseCompanyJobs` query (the inline close in the DELETE transaction). The query is a plain `UPDATE jobs SET status='closed', updated_at=clock_timestamp() WHERE company_id=$1 AND deleted_at IS NULL AND status IN ('draft','published')` (NOT a `:one` scalar SELECT — no guard_passed / closed_count because the soft-delete write is in the same transaction and the soft-delete WHERE already scopes by company_id; no second guard is needed). The adapter surfaces rowcount via `cmdtag.RowsAffected()` and the use case does NOT branch on it (0 rows = "company had no non-closed jobs" = success).
5. **Reuse the transactional multi-write pattern from `CompanyBootstrapRepository.CreateWithOwner` + `ApplicationRepository.Create`** — the new `DeleteCompany` use case writes through a single `pgx.Tx` opened by the postgres adapter. The adapter owns `pool.Begin(ctx) → defer tx.Rollback(ctx) → db.New(tx).UpdateCompanySoftDelete(...) → db.New(tx).CloseCompanyJobs(...) → tx.Commit(ctx)`. The use case never imports `pgx`. The error-mapping contract follows `mapCompanyCreateError` (extends with `23503` on a missing company FK as defense-in-depth — unreachable via the designed flow).
6. **Reuse the `RequireCompanyContext` fail-closed 500 invariant** — every gated handler in the companies slice already implements this; the new `updateCompany` + `deleteCompany` handlers do the same.
7. **Reuse the `ErrCompanyNotFound` 404 mapping** — the existing `classifyError` (in the companies handler) maps `ErrCompanyNotFound → 404`. The new handlers add `ErrConcurrencyConflict → 409` (PATCH only; DELETE has no body on conflict either way) + `ErrClosedJobsTransition` (defense-in-depth for SQLSTATE 23514 on the inline close — unreachable via the designed flow because the use case only sets `closed` from `draft`/`published`) + `ErrIndustryNotFound` (reused from the create handler) into a new `classifyUpdateCompanyError` / `classifyDeleteCompanyError` flat dispatcher.
8. **Stub repair is atomic** — extending the `CompanyRepository` port with `UpdateCompany(...)` and `SoftDeleteCompany(...)` breaks every stub (`companyMemberService_test.go`'s `stubMemberRepo` and `updateCompanyStubRepo`, `companyMemberService_integration_test.go`'s repo, etc.) plus the `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)` compile-time assertion in the postgres adapter. The repair ships in **one commit** (mirroring `jobs-create` D10 atomic five-stub repair and `jobs-soft-delete` D9).
9. **sqlc regen on query shape change** — three new queries land: `UpdateCompany :one` (companies.sql), `SoftDeleteCompany :one` (companies.sql), `CloseCompanyJobs :exec` (jobs.sql). `companies.sql.go` + `jobs.sql.go` + `querier.go` regenerate via `cd backend && go tool sqlc generate`. Existing queries (`CreateCompany`, `GetCompanyByID`, `CreateCompanyMember`, `GetMembershipByUserID`, `ListByCompanyID`, `UpdateMemberRole`, `RemoveCompanyMember`, all jobs queries) are regenerated verbatim and unchanged.
10. **No new package, no new env var, no new docker-compose service** — slice reuses `uuid` (google/uuid), `pgx/v5`, `pgconn`, `pgtype`, `chi`, `slog`. The `pgxpool` is already wired in `cmd/api/main.go` and passed to the existing `companyBootstrapRepo` (and to the existing `applicationRepo`); the new `companyRepo` (or a new sibling `companyWriteRepo` for the transactional soft-delete path — see §7.3) needs the pool instead of the `*db.Queries` handle. Decision: refactor the existing `CompanyRepository` to hold the pool (mirrors `ApplicationRepository::NewApplicationRepository(pool, audit)`); the read path switches from `db.New(queries)` to `db.New(pool)` (one-line change, no semantic difference for read queries).

## 6. Business rules (proposed — flagged for the user round)

### 6.1 Endpoint surface

| Aspect | PATCH `/me/company` | DELETE `/me/company` |
|---|---|---|
| Method | `PATCH` | `DELETE` |
| Path | `/me/company` | `/me/company` |
| Auth | `RequireAuth` + `RequireCompanyRole(owner)` | `RequireAuth` + `RequireCompanyRole(owner)` |
| Request body | **JSON**: optional `name` + 11 optional profile fields (see decision #3); absent field = unchanged | **NONE** (DELETE has no body) |
| Required request headers | `Authorization: Bearer <jwt>` (RequireAuth); `If-Unmodified-Since: <RFC 3339>` (CAS) | `Authorization: Bearer <jwt>` (RequireAuth); `If-Unmodified-Since: <RFC 3339>` (CAS) |
| Response (success) | `200 OK` + redacted company shape (no rfc/industry/status/deleted_at) | `204 No Content` (empty body) |
| Response (CAS mismatch) | `409 Conflict` + latest redacted company shape (same as 200) | `409 Conflict` + empty body (CAS body intentionally empty — see §6.7) |
| Response (non-existent / cross-company / soft-deleted) | `404 company not found` (indistinguishable; `ErrCompanyNotFound`) | `404 company not found` (same) |
| Response (invalid request body) | `400 invalid JSON body` | n/a |
| Response (no `Authorization`) | `401 unauthenticated` (RequireAuth) | `401 unauthenticated` (RequireAuth) |
| Response (non-member / role < owner) | `403 not a member of any company` / `403 insufficient role` (RequireCompanyRole) | `403` (same) |
| Response (internal failure) | `500 internal server error` (real error logged at `slog.Error`) | `500` (same) |

### 6.2 Field mutability matrix (PATCH)

| Field | Mutable? | VO / type | Nullable? |
|---|---|---|---|
| `name` | **YES** | `valueobjects.CompanyName` (≥ 4 chars after trim) | no (NOT NULL) |
| `rfc` | **NO** (immutable) | `valueobjects.CompanyRfc` | no |
| `industry_id` | **NO** (immutable) | `string` (FK to `industries`) | no |
| `status` | **NO** (admin/manual takedown only) | `valueobjects.CompanyStatus` | no |
| `website` | **YES** | `*string` | YES (pointer-absent = unchanged; pointer-null = clear to NULL) |
| `logo_url` | **YES** | `*string` | YES |
| `description` | **YES** | `*string` (≤ 3000 chars via `CompanyDescription` VO when present) | YES |
| `size` | **YES** | `*string` (closed set via `ParseCompanySize` when present) | YES |
| `founded_year` | **YES** | `*int` (interval [1800, currentYear+1] via `FoundedYear` VO when present) | YES |
| `city` | **YES** | `*string` | YES |
| `country` | **YES** | `*string` | YES |
| `linkedin_url` | **YES** | `*string` | YES |
| `instagram_url` | **YES** | `*string` | YES |
| `facebook_url` | **YES** | `*string` | YES |
| `twitter_url` | **YES** | `*string` | YES |
| `cover_image_url` | **YES** | `*string` | YES |

**Pointer DTO semantics** — match the existing `EditJob` (`UpdateJobDto`) and `UpsertMyProfile` patterns:

- Field absent from JSON → pointer-nil → SQL `COALESCE(pgtype, col)` degenerates to the column value (untouched).
- Field present as JSON `null` → pointer-non-nil → SQL `CASE WHEN set_<field> THEN pgtype ELSE col END` with `set_=true` and pgtype-invalid → column cleared to SQL NULL.
- Field present with a value → pointer-non-nil → SQL `CASE WHEN set_<field> THEN pgtype ELSE col END` with `set_=true` and pgtype-valid → column set to the value.

For the text columns (`website`, `logo_url`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`) the encoding mirrors `jobs.location` (plain `*string` → `pgtype.Text`, no tri-state). For `description`, `size`, `founded_year` the encoding mirrors `jobs.salary_min` (`Optional[T]` tri-state — null vs absent distinction matters because the columns are genuinely nullable and the VO validation only runs when the value is present).

**Alternative considered:** single pointer semantics for all fields (no tri-state). Rejected because `description` and `size` are nullable in the schema and the spec requires "absent = unchanged, null = clear to NULL" for those fields (consistency with jobs design D2).

### 6.3 `name` validation on PATCH (proposal default)

When `name` is present in the body, the use case MUST re-validate it through `valueobjects.NewCompanyName` (≥ 4 chars after trim, same VO as create). The HTTP layer maps the sentinel `ErrCompanyNameTooShort` to `400` with the message `"el nombre de la compañía no puede ser menor a 4 caracteres"`. The DB has no CHECK on `name` length (the schema trusts the VO), so a VO failure is the only defense.

### 6.4 RFC / industry_id / status silently dropped on PATCH (proposal default)

The DTO has NO `rfc`, NO `industry_id`, NO `status` field. `encoding/json` silently drops unknown JSON keys, so a client sending `{"rfc":"NEW123","industry_id":"new_id","status":"suspended"}` gets the same outcome as if they sent `{}` — those keys are ignored. **No 400, no warning, no echo.** This matches the canonical spec pattern ("silently drop unknown keys is the convention for the immutable fields") and matches `EditJob` (which silently drops `company_id` from the body).

### 6.5 Industry FK change attempts on PATCH — NOT a 400 (proposal default)

A client sending `{"industry_id":"industries_does_not_exist"}` gets the same outcome as if they didn't send it — the DTO has no `industry_id` field, so the use case never reads it, and the existing row's `industry_id` is unchanged. This is a documentation / convention decision: the wire surface is contract-shaped by the DTO, not by the DB schema.

### 6.6 `industry_id` change is impossible from the API (locked by decision #3)

There is no API path to change `industry_id` after creation. A client that needs to change industry today must soft-delete + recreate (and would lose `company_id`, `company_members`, all `jobs.company_id` FK references, and all `applications` — same blast radius as the maintenance-script problem decision #2 was trying to avoid). A future "industry migration" feature is a separate concern.

### 6.7 DELETE response shape on CAS mismatch (proposal default)

A `DELETE /me/company` with a stale `If-Unmodified-Since` returns `409 Conflict` with an EMPTY body (no latest company record, no editor view). Rationale: the success path has no body (`204`), so the `409` body is intentionally empty to keep the wire contract symmetric — the client re-reads via `GET /me/company` (which would either still return the company or return 404 if a concurrent DELETE won).

**Alternative considered:** `409` + latest redacted company shape (mirroring PATCH). Rejected: it requires the use case to re-read on CAS mismatch (an extra DB round trip) just to project a record the client will see transiently before their next `GET /me/company`. The PATCH `409`-with-view is necessary because PATCH has a structured body that includes `updated_at` for the next CAS round-trip; DELETE's CAS is a one-shot (the client either re-issues with the fresh token from a `GET /me/company` read or abandons the shutdown). Empty `409` body is the simpler contract.

### 6.8 Inline close semantics on DELETE (proposal default)

The same SQL transaction as the soft-delete sets `jobs.status='closed'` on every row of the company WHERE `deleted_at IS NULL AND status IN ('draft','published')`. Rows already in `status='closed'` are NOT touched (closing a closed job is a no-op; the SQL `IN` predicate excludes them). The adapter surfaces the rowcount via `cmdtag.RowsAffected()` but the use case does NOT branch on it — `0 rows closed` is a legitimate success ("this company had no non-closed jobs at delete time"). The adapter does NOT map a 0-rowcount to an error.

**Alternative considered:** closing ALL jobs (including already-closed ones, just to bump `updated_at`). Rejected: no business purpose, and bumping `updated_at` on a closed row would invalidate the post-write `companies.updated_at` consistency (the companies row gets a NEW `updated_at`, the already-closed job rows get a DIFFERENT new `updated_at` — no consistency gain).

### 6.9 Active-company guard on PATCH (proposal default — NOT required, matches existing GET)

PATCH does NOT enforce the active-company guard (the CTE pattern `UpdateJob :one` uses). A recruiter of a `suspended` company can STILL update the company profile — `GET /companies/{id}` (which does NOT filter by status) already surfaces suspended companies to the public, so a suspended company can fix its logo URL without admin intervention. The PATCH write is a metadata edit, not a publish action. (The `status` field is NOT mutable via PATCH per decision #14, so a suspended company cannot unsuspend itself.) The atomic guard is reserved for the `jobs` write path where it carries business meaning ("don't let a suspended company publish a job").

**Alternative considered:** gating PATCH behind the active-company guard. Rejected: PATCH does not change `status`; the guard would be defense-in-depth without semantic payoff and would surprise owners who want to fix their profile after suspension.

### 6.10 Active-company guard on DELETE (proposal default — NOT required)

DELETE also does NOT enforce the active-company guard for the same reason: shutting down a suspended company is a legitimate operation (the owner might want to formally close it now that it's already suspended). The inline close still runs (the closed jobs are already invisible on the public board because of the `c.status = 'active'` predicate; the inline close is idempotent for those jobs because they are already `closed` — they don't match `status IN ('draft','published')` so the UPDATE skips them). The semantic remains: a successful DELETE removes the company from the public profile + ensures no future published jobs leak.

**Alternative considered:** gating DELETE behind the active-company guard. Rejected for the same reason as PATCH — owner self-service shutdown is a legitimate path even for suspended companies.

### 6.11 Read-side hardening delta — DEFERRED (locked by decision #8)

`SearchJobs` and `GetJobByID` gain NO new predicate in this cycle. The inline close already removes the leak (decision #8). A follow-up cycle adds `AND c.deleted_at IS NULL` to both queries for defense-in-depth (so a future code path that writes a `'published'` job while the company is tombstoned is caught at the read layer too, not just the close transaction). The follow-up also adds an integration test that proves the predicate hides a tombstoned-company-with-stale-published-job row.

### 6.12 PATCH response — RFC + industry + status + deleted_at OMITTED (decision #11)

The PATCH 200 / 409 body uses `companyPublicResponse` (the same shape `GET /companies/{id}` already returns) with one tweak: `updated_at` is the new authoritative post-write value. `rfc`, `industry_id`, `status`, and `deleted_at` are NOT in the shape. The owner knows their own RFC and industry (they set them at create time); the public profile doesn't need them; the deleted_at is internal. The shape is wire-compatible with `GET /companies/{id}` — clients can swap shapes without a second round-trip.

### 6.13 Owner-only on the response — no PII redaction needed (proposal default)

The owner is the caller's own company; the redaction is the public-shape redaction (no `rfc` etc.), NOT a privacy redaction. Membership-level PII (other members of the company) is not in the company shape; the `GET /me/company` endpoint handles that. The owner can `GET /me/company/members` for the member list. No new authorization surface is needed for the company write endpoints.

### 6.14 Stub repair scope (proposal default)

The port extension breaks:

- `backend/internal/features/companies/application/usecases/companyMemberService_test.go` — stub repos gain `UpdateCompany` + `SoftDeleteCompany` methods (default return `nil` to keep existing tests green).
- `backend/internal/features/companies/application/usecases/companyMemberService_integration_test.go` — same.
- `backend/internal/features/companies/infrastructure/postgres/companyRepository_test.go` — same.
- `backend/internal/features/companies/infrastructure/postgres/companyBootstrapRepository_*_test.go` — same.
- The `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)` assertion in the adapter — fixed in the same commit by adding the new methods to the adapter.

Atomic five-stub repair ships in one commit (decision #8).

## 7. Scope (first slice)

### 7.1 HTTP surface

**NEW** `PATCH /me/company` — gated by `RequireAuth` + `RequireCompanyRole(owner)`. JSON body carries optional `name` + 11 optional profile fields (see §6.2). `If-Unmodified-Since` header carries the CAS token (RFC 3339). Success returns `200 OK` + redacted company shape.

**NEW** `DELETE /me/company` — gated by `RequireAuth` + `RequireCompanyRole(owner)`. No request body. `If-Unmodified-Since` header carries the CAS token (RFC 3339). Success returns `204 No Content`. The handler is mounted on the `/me` subtree at `backend/cmd/api/main.go`, sharing the existing `requireOwner` gate with the membership mutation routes.

### 7.2 Application / domain additions

- **NEW** `backend/internal/features/companies/application/usecases/updateCompany.go` — `UpdateCompany(ctx, companyID uuid.UUID, in dtos.UpdateCompanyDto, ifUnmodifiedSince time.Time) (*dtos.CompanyEditorViewDto, error)`. The orchestrator's flow:
  1. `GetCompanyForUpdate(ctx, companyID)` → `ErrCompanyNotFound` propagates → handler 404 (covers non-existent, soft-deleted).
  2. CAS compare: `if !ifUnmodifiedSince.Equal(current.UpdatedAt) { return (toRedactedView(current), entities.ErrConcurrencyConflict) }` → handler 409 + view.
  3. VO parse on `name` if present (empty → `ErrCompanyNameTooShort` → 400); VO parse on `description`, `size`, `founded_year` if present (VO sentinels → 400).
  4. Build `repositories.UpdateCompanyPatch` (eleven optional fields + name pointer).
  5. `repo.UpdateCompany(ctx, companyID, patch, casUpdatedAt := current.UpdatedAt)` — atomic UPDATE with the row predicates `(id, deleted_at IS NULL)` and CAS `updated_at = casUpdatedAt`. Adapter inspects rowcount:
     - 1 row → success → re-read → return `(toRedactedView(fresh), nil)` → handler 200.
     - 0 rows → `ErrCompanyNotFound` → handler 404 (CAS lost / cross-company / soft-delete race).
  6. Re-read on success for the authoritative post-write `updated_at` (the next CAS token).
- **NEW** `backend/internal/features/companies/application/usecases/deleteCompany.go` — `SoftDeleteCompany(ctx, companyID uuid.UUID, ifUnmodifiedSince time.Time) error`. The orchestrator's flow:
  1. `GetCompanyForUpdate(ctx, companyID)` → `ErrCompanyNotFound` propagates → handler 404.
  2. CAS compare: `if !ifUnmodifiedSince.Equal(current.UpdatedAt) { return entities.ErrConcurrencyConflict }` → handler 409 (empty body per §6.7).
  3. `repo.SoftDeleteCompany(ctx, companyID, casUpdatedAt := current.UpdatedAt)` — atomic transactional UPDATE: `UPDATE companies SET deleted_at = now(), updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL AND updated_at = $2` PLUS `UPDATE jobs SET status='closed', updated_at=clock_timestamp() WHERE company_id=$1 AND deleted_at IS NULL AND status IN ('draft','published')`. Both in the same `pgx.Tx`. Adapter inspects the soft-delete rowcount:
     - 1 row → success → return `nil` → handler 204.
     - 0 rows → `ErrCompanyNotFound` (CAS lost / already-soft-deleted) → handler 404.
  4. **No** re-read on success (no view to project; the response is 204).
- **MOD** `backend/internal/features/companies/application/usecases/companyService.go` — add `UpdateCompany` + `SoftDeleteCompany` methods. The constructor signature gains the `*pgxpool.Pool` (the adapter owns the transaction for the soft-delete write; the read methods can borrow a `db.Queries` from `db.New(pool)` to keep their existing semantics). `NewCompanyService(repo, pool)` replaces `NewCompanyService(repo)` and `NewCompanyServiceWithBootstrap(repo, userRepo, bootstrapRepo)` retains its current signature (the bootstrap path is unchanged).
- **NEW** `backend/internal/features/companies/application/dtos/updateCompanyDto.go` — `UpdateCompanyDto` (eleven optional pointer fields + name pointer; see §6.2). Encoding: `*string` for text fields (pointer-absent = unchanged), `Optional[T]` for the three genuinely-nullable columns (`description`, `size`, `founded_year`) using `valueobjects.Optional[T]` (same tri-state as `jobs.salary_min`). Note: `Optional[T]` is currently in `internal/features/jobs/domain/valueobjects/optional.go`; the cleanest fix is to lift it to a shared `internal/shared/valueobjects/optional.go` and have BOTH jobs and companies import from there (one-time cross-feature import). Decision: do the lift in this cycle (refactor scope: ~20 lines moved + 2 import updates). Alternative: duplicate `Optional[T]` into the companies slice and add a "// intentionally duplicated from jobs/.../optional.go" comment. Either is acceptable; the lift is preferred because `Optional[T]` is a generic presence codec, not a jobs-specific concept.
- **NEW** `backend/internal/features/companies/application/dtos/companyEditorViewDto.go` — `CompanyEditorViewDto` (the wire shape for PATCH 200 / 409 bodies; matches `companyPublicResponse` with `updated_at` added).
- **MOD** `backend/internal/features/companies/domain/repositories/companyRepository.go` — extend the port with `UpdateCompany(ctx, companyID uuid.UUID, patch UpdateCompanyPatch, casUpdatedAt time.Time) error` + `SoftDeleteCompany(ctx, companyID uuid.UUID, casUpdatedAt time.Time) error`. The port extension breaks the assertion; the adapter adds the methods in the same commit.
- **MOD** `backend/internal/features/companies/domain/entities/company.go` — **NO CHANGE** (entity carries all fields; no new sentinels; `ErrCompanyNotFound` is reused).
- **MOD** `backend/internal/features/companies/domain/entities/company_test.go` — **NO CHANGE** (entity invariants are unchanged; new behavior lives in the use case + adapter).

### 7.3 Persistence (sqlc)

- **MOD** `backend/internal/db/db.go` + `backend/db/queries/companies.sql`:
  - **NEW** `GetCompanyForUpdate :one` — non-visibility-narrowed by `status`, but `deleted_at IS NULL`-scoped (the write path MUST see active, suspended, pending_verification companies; MUST NOT see tombstoned ones). Column list mirrors `GetCompanyByID` exactly (sqlc requires explicit lists to avoid `search_vector`-style generated-column pollution; `companies` has no STORED generated columns so the list can also use `SELECT *` — but explicit is preferred for symmetry with `GetJobForUpdate`). The adapter maps `pgx.ErrNoRows → ErrCompanyNotFound`.
  - **NEW** `UpdateCompany :one` — atomic single-statement partial update + CAS. The shape mirrors `UpdateJob :one` minus the active-company CTE (decision #9): 11 `COALESCE(sqlc.narg(...), col)` clauses for the text columns + 3 `CASE WHEN sqlc.arg('set_<field>') THEN sqlc.narg(...) ELSE col END` clauses for the nullable trio + 1 `COALESCE(sqlc.narg('name'), name)` for name. `updated_at = clock_timestamp()`. WHERE: `id = $company_id AND deleted_at IS NULL AND updated_at = $cas_token`. RETURNING: scalar `{updated_count}` (no editor view projection needed because the use case re-reads via `GetCompanyForUpdate`). The adapter inspects `row.UpdatedCount`:
    - `1` → success.
    - `0` → `ErrCompanyNotFound` (CAS lost / soft-deleted / cross-company).
  - **NEW** `SoftDeleteCompany :one` — atomic single-statement soft-delete + CAS. Mirrors `UpdateJob :one`'s shape: `UPDATE companies SET deleted_at = now(), updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL AND updated_at = $2 RETURNING (SELECT count(*) FROM upd) AS updated_count`. No active-company CTE (decision #10). Adapter inspects `row.UpdatedCount`:
    - `1` → success.
    - `0` → `ErrCompanyNotFound`.
- **MOD** `backend/internal/db/db.go` + `backend/db/queries/jobs.sql`:
  - **NEW** `CloseCompanyJobs :exec` — `UPDATE jobs SET status='closed', updated_at=clock_timestamp() WHERE company_id=$1 AND deleted_at IS NULL AND status IN ('draft','published')`. The adapter calls it inside the same `pgx.Tx` as `SoftDeleteCompany`. The adapter surfaces rowcount via `cmdtag.RowsAffected()` but does NOT branch on it (`0 rows` = success path; the inline close is "no-op when nothing to close").
- **MOD** `backend/internal/features/companies/infrastructure/postgres/companyRepository.go`:
  - Refactor the adapter to hold the `*pgxpool.Pool` (decision #10): `NewCompanyRepository(pool *pgxpool.Pool) *CompanyRepository`. The `queries *db.Queries` field is dropped; reads borrow `db.New(r.pool)`; writes open their own tx via `r.pool.Begin(ctx)` (mirrors `ApplicationRepository`, `CandidateRepository`, `CompanyBootstrapRepository`).
  - **MOD** `GetByID` — calls `db.New(r.pool).GetCompanyByID(...)` (one-line change; no semantic difference).
  - **NEW** `GetCompanyForUpdate(ctx, companyID uuid.UUID) (*entities.Company, error)` — calls `db.New(r.pool).GetCompanyForUpdate(...)`, maps `pgx.ErrNoRows → ErrCompanyNotFound`, returns the row → entity.
  - **NEW** `UpdateCompany(ctx, companyID uuid.UUID, patch repositories.UpdateCompanyPatch, casUpdatedAt time.Time) error` — opens `pool.Begin(ctx)`, runs `db.New(tx).UpdateCompany(...)`, inspects `row.UpdatedCount`, commits (or rolls back via defer), returns the matching sentinel.
  - **NEW** `SoftDeleteCompany(ctx, companyID uuid.UUID, casUpdatedAt time.Time) error` — opens `pool.Begin(ctx)`, runs `db.New(tx).SoftDeleteCompany(...)` (the `companies` soft-delete), runs `db.New(tx).CloseCompanyJobs(...)` (the inline close), commits. The defer Rollback covers every error path.
  - **NEW** `buildUpdateCompanyParams` — translates `(companyID, patch, casUpdatedAt)` into the sqlc `UpdateCompanyParams` struct. The arg order is pinned by first textual appearance in the SQL `WHERE` clause (CAS pattern): `company_id` first (in WHERE), `cas_token` second (in WHERE), then the 15 SET-list args.
  - **NEW** `mapUpdateCompanyError` — `pgx.ErrNoRows → ErrCompanyNotFound` (defense-in-depth; the `:one` scalar SELECT always returns one row), `23514 → ErrCompanyNameTooShort` or `ErrInvalidCompanySize` or `ErrFoundedYearOutOfRange` or `ErrCompanyDescriptionTooLong` depending on `ConstraintName` (defense-in-depth; the use case parses VOs before SQL so this branch is unreachable). Pass-through for unknown errors.
  - **NEW** `mapSoftDeleteCompanyError` — `pgx.ErrNoRows → ErrCompanyNotFound` (defense-in-depth), `23514 → ErrInvalidCompanyStatusTransition` (new sentinel, defense-in-depth; the inline close only sets `closed` from `draft`/`published`, which the `jobs_status_check` accepts). Pass-through for unknown errors.
- **MOD** `backend/internal/db/jobs.sql.go` + `backend/internal/db/companies.sql.go` + `backend/internal/db/querier.go` — regen via `cd backend && go tool sqlc generate`. Existing 8 + 4 queries are regenerated verbatim and unchanged.

### 7.4 Infrastructure / wiring

- **MOD** `backend/internal/features/companies/infrastructure/http/handler.go`:
  - Extend `CompanyHandlers` accessor struct with `UpdateCompany http.HandlerFunc` + `DeleteCompany http.HandlerFunc` next to the existing `CreateCompany` + `GetCompany`.
  - **NEW** `updateCompanyRequest` struct (JSON body; eleven optional pointer fields + name pointer; matches `UpdateCompanyDto`).
  - **NEW** `updateCompany(w, r)` handler — `requireCompanyContext` (fail-closed 500 if missing) → decode body as `dtos.UpdateCompanyDto` (400 on malformed) → parse `If-Unmodified-Since` (RFC 3339; absent/malformed → zero time) → `service.UpdateCompany(ctx, cc.CompanyID, in, ifUnmodifiedSince)` → on `ErrConcurrencyConflict` write the editor view with `409` (same special-case `EditJob` already has) → on success write the editor view with `200` → on any other error `classifyAndWriteError`.
  - **NEW** `deleteCompany(w, r)` handler — `requireCompanyContext` (fail-closed 500) → parse `If-Unmodified-Since` → `service.SoftDeleteCompany(ctx, cc.CompanyID, ifUnmodifiedSince)` → on `ErrConcurrencyConflict` write `409` with empty body (decision #7) → on success write `204 No Content` → on any other error `classifyAndWriteError`.
  - **NEW** `classifyUpdateCompanyError` / `classifyDeleteCompanyError` — flat `errors.Is` dispatchers mirroring `classifyCreateCompanyError`. New sentinels:
    - `ErrConcurrencyConflict → 409 "conflict"` (PATCH handler special-cases the 409-with-view path BEFORE the classifier).
    - `ErrCompanyNameTooShort / ErrInvalidCompanySize / ErrFoundedYearOutOfRange / ErrCompanyDescriptionTooLong → 400`.
    - `ErrInvalidCompanyStatusTransition → 400` (defense-in-depth on the inline close).
    - `ErrCompanyNotFound → 404`.
    - `default → 500`.
- **MOD** `backend/cmd/api/main.go`:
  - Two new route lines on the `/me` subtree, between the existing `GET /me/company` and the `members` routes:
    - `r.With(requireAuth, requireOwner).Patch("/company", companyHandlers.UpdateCompany)`.
    - `r.With(requireAuth, requireOwner).Delete("/company", companyHandlers.DeleteCompany)`.
  - `requireAuth` is hoisted at `run()` scope; `requireOwner` is already wired inside the `/me` block (the membership mutation routes use it). No new middleware.
  - Update `companyRepo := postgres.NewCompanyRepository(queries)` to `companyRepo := postgres.NewCompanyRepository(pool)` (decision #10). Verify the existing `CreateCompany` + `GetCompany` flows still work with the refactored adapter (one-line test smoke).

### 7.5 Schema verification

- `companies.deleted_at TIMESTAMPTZ` — **EXISTS** (migration `00002`, column 9). Verified.
- `companies.updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — **EXISTS** (migration `00002`, column 8). Verified.
- `jobs.status` CHECK constraint including `closed` — **EXISTS** (migration `00007`, CHECK constraint). Verified.
- `jobs.deleted_at TIMESTAMPTZ` — **EXISTS** (migration `00007`). The inline close excludes already-deleted rows (`AND deleted_at IS NULL`) so a soft-deleted job is NOT touched by the inline close (no `status='closed'` overwrite on a tombstoned job — the tombstone stands).
- **NO new migration is needed.** Confirmed. The only DB change is the addition of three sqlc queries (no DDL).

## 8. Explicit non-goals (out of scope for this change)

- **Audit events for companies** — explicitly deferred (decision #4 + #13). No `CompanyUpdated`, `CompanyDeleted`, `CompanySoftDeleted`, `CompanyRestored` event types. No `audit_events` port extension. No `co-write` transaction. Follow-up cycle adds the company event catalog and extends `audit_events.spec.md`.
- **Read-side `c.deleted_at IS NULL` predicate on jobs queries** — deferred to a follow-up cycle (decision #11). The inline close removes the leak today; the predicate is defense-in-depth for a future code path that could write a `'published'` job while the company is tombstoned.
- **Hard delete** — out of scope forever. A future `DELETE FROM companies` is never going to ship (bypasses audit, breaks referential expectations, breaks the soft-delete + close invariant). Restore is the inverse of soft-delete, and restore is out of scope (§8 next).
- **Restore / undelete** — `POST /me/company/restore` or `PATCH /me/company {"deleted_at": null}` is out of scope. The memberships + applications stay intact as history (decision #9 + #10); a future restore endpoint operates on the intact member + applications data and un-tombstones the company. That endpoint re-opens the inline close too (flip closed jobs back to draft / published? — design phase for a separate change).
- **Status manipulation (`status` field mutable via PATCH)** — out of scope (decision #14). `status` is owned by the manual takedown flow pinned in `docs/flujo-verificacion-empresas.md` (MVP rule: takedown is reactive, not proactive). The proactive flow (verification queue, RFC lookup, etc.) is a future post-MVP slice.
- **Industry change** — out of scope (decision #6 + §6.6). No API path changes `industry_id` after creation. A future "industry migration" feature is a separate concern.
- **RFC change** — out of scope (decision #3 + decision #12). The partial unique index `companies_rfc_unique` is a write-time guard at INSERT only; PATCH cannot touch RFC because the DTO has no `rfc` field.
- **Notifications / event publishing** — no outbox, no SNS/SQS, no webhooks. The slice stays synchronous.
- **Bulk operations** — `PATCH /me/companies?ids=...` or `DELETE /me/companies?ids=...` is out of scope. One company per request.
- **No new migration** — verified (§7.5).
- **No new domain entity** — `Company` already carries all fields; no `CompanyForUpdate` is introduced because the editor view is the same `Company` with the same `UpdatedAt` (the `*db.Queries` row projection reuses `toEntity`).
- **No `company_members` write impact** — memberships stay (decision #9). The owner stays an owner; recruiters stay recruiters; no role demotion on soft-delete. A future restore endpoint may revisit this if the owner resigned before shutdown.
- **No `applications` write impact** — applications stay (decision #10). The candidate's history is preserved.

## 9. Affected areas (file inventory)

All under `backend/`. New files marked **NEW**; modified files marked **MOD**. The locked scope is `~10 authored + 3 generated` files for the production code, plus `~5 stub files` for the test surface (atomic stub repair per decision #8).

### Production code

- **NEW** `backend/internal/features/companies/application/usecases/updateCompany.go` — `UpdateCompany` use case (GetCompanyForUpdate → CAS → VO parse → repo.UpdateCompany → re-read → redacted view).
- **NEW** `backend/internal/features/companies/application/usecases/deleteCompany.go` — `SoftDeleteCompany` use case (GetCompanyForUpdate → CAS → repo.SoftDeleteCompany → no re-read on success).
- **MOD** `backend/internal/features/companies/application/usecases/companyService.go` — `UpdateCompany` + `SoftDeleteCompany` methods; constructor signature gains `*pgxpool.Pool`.
- **NEW** `backend/internal/features/companies/application/dtos/updateCompanyDto.go` — `UpdateCompanyDto`.
- **NEW** `backend/internal/features/companies/application/dtos/companyEditorViewDto.go` — `CompanyEditorViewDto` (PATCH 200/409 wire shape).
- **MOD** `backend/internal/features/companies/domain/repositories/companyRepository.go` — extend port with `GetCompanyForUpdate`, `UpdateCompany`, `SoftDeleteCompany` (and `UpdateCompanyPatch` struct).
- **MOD** `backend/internal/features/companies/infrastructure/postgres/companyRepository.go` — refactor to hold `*pgxpool.Pool` (decision #10); add `GetCompanyForUpdate`, `UpdateCompany`, `SoftDeleteCompany` methods + `buildUpdateCompanyParams` + `mapUpdateCompanyError` + `mapSoftDeleteCompanyError`. `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)` assertion stays; the port extension forces a compile break in the adapter (resolved in the same commit).
- **MOD** `backend/internal/features/companies/infrastructure/http/handler.go` — `updateCompany` + `deleteCompany` handlers + `CompanyHandlers.UpdateCompany` + `CompanyHandlers.DeleteCompany` fields + `classifyUpdateCompanyError` + `classifyDeleteCompanyError` + `parseIfUnmodifiedSince` (duplicated from jobs handler).
- **MOD** `backend/cmd/api/main.go` — two new route lines + refactor `NewCompanyRepository(queries)` → `NewCompanyRepository(pool)`.
- **NEW (refactor)** `backend/internal/shared/valueobjects/optional.go` — lift `Optional[T]` from `internal/features/jobs/domain/valueobjects/optional.go` (decision in §7.2). The jobs file becomes a thin re-export (`package valueobjects` → `package valueobjects` with `type Optional[T] = shared.Optional[T]` via a type alias — exact mechanism depends on Go 1.23 alias support; fall back to a wrapper type if aliases are unavailable).
- **MOD** `backend/internal/features/jobs/domain/valueobjects/optional.go` — re-export `Optional[T]` from the shared package (or update all jobs references to import `shared/valueobjects`).
- **MOD (generated)** `backend/internal/db/companies.sql.go` — regen; gains `GetCompanyForUpdateParams/Row`, `UpdateCompanyParams/Row`, `SoftDeleteCompanyParams/Row`.
- **MOD (generated)** `backend/internal/db/jobs.sql.go` — regen; gains `CloseCompanyJobsParams`.
- **MOD (generated)** `backend/internal/db/querier.go` — regen; interface signatures for `GetCompanyForUpdate`, `UpdateCompany`, `SoftDeleteCompany`, `CloseCompanyJobs`.

### Test surface (atomic stub repair + new tests)

- **MOD** `backend/internal/features/companies/application/usecases/companyMemberService_test.go` — stub repos gain `UpdateCompany` + `SoftDeleteCompany` + `GetCompanyForUpdate` methods with programmable `updateCompanyErr` / `softDeleteCompanyErr` / `getCompanyForUpdateErr` fields; default returns `nil` to keep existing tests green.
- **MOD** `backend/internal/features/companies/application/usecases/createCompanyWithOwner_test.go` — same.
- **MOD** `backend/internal/features/companies/application/usecases/createCompany_test.go` — same.
- **MOD** `backend/internal/features/companies/application/usecases/getCompany_test.go` (or equivalent) — same.
- **MOD** `backend/internal/features/companies/infrastructure/postgres/companyRepository_test.go` — same.
- **NEW** `backend/internal/features/companies/application/usecases/updateCompany_test.go` — use-case tests (absent-field = unchanged; name validation; description VO failure → 400; founded_year VO failure → 400; CAS mismatch → 409 + view; cross-company → 404; soft-deleted → 404; success → 200 + view with new `updated_at`; atomic port-extended stub).
- **NEW** `backend/internal/features/companies/application/usecases/deleteCompany_test.go` — use-case tests (CAS mismatch → 409 (empty body); cross-company → 404; soft-deleted → 404; already-soft-deleted → 404; success → nil; stubbed repo returns SoftDelete rowcount=1 + CloseCompanyJobs rowcount=N).
- **NEW** `backend/internal/features/companies/infrastructure/http/updateCompanyHandler_test.go` — handler tests (missing CompanyContext → 500; missing `Authorization` → 401; non-owner → 403; invalid JSON → 400; missing CAS → 409 + view; CAS mismatch → 409 + view; cross-company → 404; soft-deleted → 404; success → 200 + view; immutable-field silently dropped → no behavior change).
- **NEW** `backend/internal/features/companies/infrastructure/http/deleteCompanyHandler_test.go` — handler tests (missing CompanyContext → 500; missing `Authorization` → 401; non-owner → 403; missing CAS → 409 (empty body); CAS mismatch → 409 (empty body); cross-company → 404; soft-deleted → 404; already-soft-deleted → 404; success → 204).
- **NEW** `backend/internal/features/companies/infrastructure/postgres/companyRepository_update_test.go` (unit, no DB) — `mapUpdateCompanyError` + `mapSoftDeleteCompanyError` + `buildUpdateCompanyParams` + row inspection tests.
- **NEW** `backend/internal/features/companies/infrastructure/postgres/companyRepository_update_integration_test.go` (SQL-level, `//go:build integration`) — PATCH any-field / name validation / soft-delete sets `deleted_at` / soft-delete closes company jobs / soft-delete preserves memberships / soft-delete preserves applications / soft-delete is invisible to `GetByID` / second-soft-delete returns `ErrCompanyNotFound`.

### UNCHANGED

- `backend/internal/features/companies/domain/entities/company.go` (and `_test.go`) — entity invariants unchanged; new behavior lives in use case + adapter.
- `backend/internal/features/companies/domain/valueobjects/*.go` (and `_test.go`) — all VOs unchanged; `NewCompanyName`, `NewCompanyRfc`, `NewCompanyDescription`, `ParseCompanySize`, `NewFoundedYear` are reused verbatim.
- `backend/internal/features/companies/infrastructure/postgres/companyBootstrapRepository.go` — unchanged (the bootstrap path stays separate from the write path).
- `backend/internal/features/companies/infrastructure/postgres/companyMemberRepository.go` — unchanged (membership slice is untouched; decision #9).
- `backend/internal/features/companies/infrastructure/http/memberHandler.go` — unchanged (membership HTTP stays separate).
- `backend/internal/features/applications/**` — unchanged (applications stay; decision #10).
- `backend/internal/features/audit_events/**` — unchanged (audit deferred; decision #4 + #13).
- `backend/internal/features/identity/infrastructure/http/requireCompanyRole.go` — unchanged (gate is reused verbatim; decision #1).
- `backend/internal/features/identity/domain/security/companyContext.go` — unchanged (the context struct is reused; the `UserID` field already supports the audit actor future).
- `backend/db/migrations/*.sql` — all 11 migrations unchanged (no new migration; §7.5).
- `backend/db/queries/audit_events.sql` + `backend/db/queries/companies.sql` (other than the 3 new queries) — unchanged.
- `backend/db/queries/candidates.sql`, `company_members.sql`, `industries.sql`, `users.sql` — unchanged.
- `backend/db/queries/jobs.sql` (other than the 1 new query) — unchanged.

## 10. New infrastructure dependency

None. No new package, no new env var, no new docker-compose service, no new migration. The slice reuses `uuid` (google/uuid), `pgx/v5`, `pgconn`, `pgtype`, `pgxpool`, `chi`, `slog`. The `pgxpool.Pool` is already wired in `cmd/api/main.go::run` and passed to `companyBootstrapRepo` + `applicationRepo` + `candidateRepo` + `auditRepo`; this slice adds the pool as a constructor argument to `companyRepo` (decision #10).

## 11. Risks

1. **Routing split on `/me/company`** — the new PATCH and DELETE share the path root with the existing GET. If a future refactor reverts to a single `chi.Mount("/me/company", …)` subrouter that includes the writes, the PATCH and DELETE become unreachable from the chi router (because chi routes by method, the GET would still work, but the writes would silently fail). The per-method `CompanyHandlers()` accessor + the explicit gated `Patch(...)` + `Delete(...)` lines in `main.go` is the defense; an AST guard test (`TestCompanyWriteRoutes_MountedBehindGates` mirroring `TestJobsSoftDeleteRoute_MountedBehindGates`) pins the gates. Same defense pattern as PATCH / POST / DELETE on `/jobs` and as PATCH / DELETE on `/me/company/members`.
2. **IDOR — company_id from path/body** — locked by decision #1: the handler never accepts `company_id` from path or body. The middleware injects `CompanyContext.CompanyID`. A handler test that sends a body with `{"company_id": "..."}` MUST assert the field is silently dropped (mirroring `EditJob`'s body-id-is-ignored test).
3. **Cross-company / non-existent / soft-deleted 404 indistinguishability** — by design (decision #1, IDOR). The `GetCompanyForUpdate` filters `deleted_at IS NULL` and is scoped by `company_id` from `CompanyContext`; cross-company / soft-deleted / non-existent all collapse to `ErrCompanyNotFound → 404`. No leak of row existence.
4. **CAS interaction with concurrent write** — a recruiter (no — only owner can write, but the concurrency shape is identical) holding a stale `If-Unmodified-Since` (e.g., they last read the company at T1, then another owner PATCH at T2, then they PATCH at T3 with T1's token) sees `409` with the latest view (PATCH) or empty body (DELETE). The client re-reads via `GET /me/company`, decides whether to re-issue. Same `409`-with-view body shape that PATCH /jobs/{id} already returns.
5. **Atomicity of soft-delete + close-jobs** — the two writes happen inside one `pgx.Tx` opened by the adapter. On any error (the `companies` UPDATE fails OR the `jobs` UPDATE fails), the transaction rolls back and NEITHER write is visible. There is no TOCTOU window because the soft-delete WHERE includes `deleted_at IS NULL` (so a concurrent second DELETE collapses to 0 rows); there is no race on the inline close because both writes use the same `clock_timestamp()` (Postgres guarantees monotonic time within a transaction; the jobs `updated_at` advances by the same instant as the companies `updated_at`). The use case does NOT need a separate "all closed" check before commit.
6. **CAS precision — RFC 3339 vs RFC 3339Nano** — `parseIfUnmodifiedSince` parses `time.RFC3339` (whole-second precision). A client using `time.RFC3339Nano` may hit a mismatch on a freshly-written row whose `updated_at` has sub-second precision. The behavior matches `EditJob` exactly (same helper, same parser). No special handling in this slice; the existing convention is "client echoes the `updated_at` from the previous response, which Go's default `time.Time` JSON marshaling produces as RFC 3339Nano".
7. **Stub-repair atomicity** — extending the port with `GetCompanyForUpdate` + `UpdateCompany` + `SoftDeleteCompany` breaks every stub + the `var _` compile-time assertion. The five-plus stubs (per the test file inventory in §9) plus the assertion must be touched in the **same commit** as the port extension, exactly mirroring `jobs-create` D10 and `jobs-soft-delete` D9 atomic stub repair.
8. **`rfc` / `industry_id` DTO drop is silent** — locked by decision #4 (audit deferred) + decision #3 (RFC immutable) + §6.4. A client that sends `{"rfc": "NEW"}` gets the same outcome as if they didn't send it. No warning. This is the established convention (`EditJob` drops `company_id` silently) and matches the canonical spec pattern. Documentation in the OpenAPI / docs PR is the right place to surface this, not in the wire response.
9. **Memberships + applications stay as orphans on soft-delete** — locked by decision #9 + #10. After a soft-delete, `company_members.company_id` and `applications.job_id` still reference the (now-tombstoned) company and its (now-closed) jobs. The `company_members` table does NOT have a FK with `ON DELETE CASCADE` (the FK is plain `REFERENCES companies(id)`); the `jobs.company_id` FK is the same. So the tombstone does NOT cascade. The memberships and applications stay as orphans visible only via the admin / future restore path. The `GET /me/company` route stays ungated-by-role and continues to return the owner's membership + company record on a soft-deleted company (read is unchanged in this slice). A future slice may add `WHERE companies.deleted_at IS NULL` to the membership read queries for the owner-facing membership view (similar to the deferred jobs read-side predicate).
10. **RFC re-uniqueness on PATCH is impossible** — locked by decision #12 + #3. The PATCH DTO has no `rfc` field. If a future feature ever needs to allow RFC change (e.g., a company rebrands and gets a new RFC), the partial unique index `companies_rfc_unique` MUST be re-checked at UPDATE time. Today it is NOT. This is a deliberate MVP simplification; the follow-up "industry migration" feature re-checks both `industry_id` and `rfc`.
11. **No `CompanyDeleted` event in the audit log** — locked by decision #4 + #13 + #8. Today, a soft-delete leaves NO audit trail beyond the `companies.deleted_at` + `companies.updated_at` columns + the `jobs.updated_at` bumps on the inline close. There is no record of which `users.id` issued the DELETE. The follow-up audit cycle adds `CompanyDeleted { actor_user_id, company_id, closed_job_ids }` and `CompanyUpdated { actor_user_id, company_id, changed_fields }`. This is a known gap, not a bug; the audit cycle is queued.
12. **Migration 00009 / 00010 / 00011 stay** — `company_members`, `applications`, `audit_events` migrations are NOT touched by this slice. The memberships + applications stay untouched as history (decision #9 + #10); the audit slice is deferred (decision #4 + #13).

## 12. Rollback plan

Simplest safe rollback: **revert the merge commit**. Because there is no new migration, no schema change, no new package, no new env var, no new docker-compose service:

- Reverting `main.go` removes the two new `Patch("/me/company", …)` and `Delete("/me/company", …)` route registrations. The pre-existing `GET /me/company` (and the membership subtree) keeps working. The `NewCompanyRepository(queries) → NewCompanyRepository(pool)` refactor is also reverted, restoring the read-only adapter signature.
- Reverting the handler / use case / repository / sqlc files restores the prior `companies` slice; any caller that had integrated against the new endpoints loses them on deploy.
- No data migration is needed in either direction:
  - **PATCH rollback:** the slice sets `companies.updated_at = clock_timestamp()` on every successful PATCH. Reverting the slice does NOT unset `updated_at`; the column is just a `now()` timestamp. Existing rows are unaffected.
  - **DELETE rollback:** the slice sets `companies.deleted_at = now()` AND `jobs.status='closed'` for every non-closed job of the company. Reverting the slice does NOT un-tombstone the company or un-close the jobs. If the rollback is followed by a manual `UPDATE companies SET deleted_at = NULL WHERE id = ...; UPDATE jobs SET status='draft' WHERE company_id=... AND deleted_at IS NULL;` (per-company, by hand), the data is restored. There is no automated un-tombstone; the follow-up restore endpoint (out of scope) is the proper mechanism.
- No feature flag is required for the first rollout; if a staged rollout is later desired, gating PATCH + DELETE behind an env flag (e.g., `FEATURE_COMPANIES_WRITE_ENABLED`) in `main.go` is a two-line addition that costs nothing in this slice.

**Risk-adjusted rollback consideration:** the inline close on DELETE is destructive to the `jobs.status` column (draft/published → closed). If the slice is rolled back AFTER a DELETE was issued in production, the company's jobs stay in `status='closed'` (which is a legitimate terminal state; rolling back does NOT un-close them). This is the correct behavior — the user explicitly asked for the company to shut down; the close is part of the shutdown; rolling back the slice should NOT un-shut-down the company. The follow-up restore endpoint is the proper mechanism to un-shut-down (and it would also un-close the jobs).

## 13. Success criteria

- An owner of company `A` can `PATCH /me/company` with `{"name": "New Co."}` and a matching `If-Unmodified-Since` header; the response is `200 OK` with the updated company record (redacted: no rfc, no industry_id, no status, no deleted_at). The new `name` is persisted; `updated_at` is fresh.
- An owner of company `A` can `PATCH /me/company` with `{"website": "https://new.example.com"}` (a single-field update); `name`, `rfc`, `industry_id`, `status`, and all other profile fields stay unchanged.
- An owner of company `A` can `PATCH /me/company` with `{"logo_url": null}` (a single-field clear); `logo_url` becomes NULL in the DB; every other field stays unchanged.
- An owner of company `A` sending `PATCH /me/company` with `{"rfc": "NEW123"}` gets the same outcome as if they sent `{}` — RFC stays unchanged (the DTO has no `rfc` field; encoding/json drops it).
- An owner of company `A` sending `PATCH /me/company` with `{"name": "AB"}` (too short) receives `400` with the message `"el nombre de la compañía no puede ser menor a 4 caracteres"`. No row written.
- An owner of company `A` sending `PATCH /me/company` with `{"founded_year": 1500}` (out of range) receives `400` with the message `"el año de fundación está fuera del rango permitido (1800 a año actual + 1)"`. No row written.
- An owner of company `A` sending `PATCH /me/company` with a stale `If-Unmodified-Since` (or no header) receives `409 Conflict` with the latest redacted company record in the body. No row written.
- An owner of company `A` sending `DELETE /me/company` with a matching `If-Unmodified-Since` header receives `204 No Content` with an empty body. `companies.deleted_at` is set to `now()`; every `draft` and `published` job of the company is set to `closed` in the SAME transaction; every `closed` job of the company is unchanged; memberships and applications are unchanged.
- Immediately after a successful DELETE, `GET /companies/{id}` for the same id returns `404 company not found` (the existing read-side `deleted_at IS NULL` predicate hides the row).
- Immediately after a successful DELETE, `GET /jobs` excludes the company's jobs (they are all `closed`, so the `status='published'` predicate hides them) and `GET /jobs/{id}` for any of the company's job ids returns `404` (same predicate).
- Immediately after a successful DELETE, `GET /me/company` (the owner-facing ungated read) still returns the owner's membership record + the company record (read is unchanged in this slice). The owner can still call `GET /me/company/members` and see the intact member list. The owner can no longer call `PATCH /me/company` or `DELETE /me/company` — `GetCompanyForUpdate` returns `ErrCompanyNotFound` (the `deleted_at IS NULL` predicate filters it out), the handler maps to `404 company not found`.
- An owner of company `A` sending `DELETE /me/company` with a stale `If-Unmodified-Since` (or no header) receives `409 Conflict` with an empty body. No row written.
- An owner of company `A` sending `DELETE /me/company` a second time (after a successful first DELETE) receives `404 company not found` (the read-for-delete already sees `deleted_at IS NOT NULL`).
- A recruiter (non-owner) of company `A` sending `PATCH /me/company` or `DELETE /me/company` receives `403 forbidden` from the middleware BEFORE the handler runs.
- A non-member of company `A` (i.e., not in `company_members`) sending `PATCH /me/company` or `DELETE /me/company` receives `403 not a member of any company` from the middleware BEFORE the handler runs.
- An unauthenticated request receives `401 unauthenticated` from `RequireAuth` BEFORE the role gate runs.
- A malformed JSON body (`PATCH /me/company` with `{"name": 42}` — wrong type) returns `400 invalid JSON body`.
- A `PATCH` or `DELETE` request sent through the public `r.Get("/companies/{id}", …)` mount returns chi 405 (or 404) — the public mount never serves the writes; the gated routes on the `/me` subtree are the only path that does.
- Strict TDD: every behavior above has a RED test that pre-dates its GREEN implementation; `cd backend && go test ./...` is green; `cd backend && go vet ./...` is clean.
- `cd backend && go tool sqlc generate` is idempotent (a second run produces an empty `git diff`).
- The integration test (`//go:build integration`) for the inline close asserts: (a) before DELETE, the company has 1 draft + 1 published + 1 closed job; (b) after DELETE, the company is tombstoned, the 1 draft and 1 published are now `closed`, the 1 already-closed job is unchanged (no `updated_at` bump), all 3 jobs' `deleted_at` is unchanged; (c) `company_members` is unchanged (same row count, same roles); (d) `applications` referencing the closed jobs are unchanged (same row count, same statuses).
- The `audit_events` table has zero rows added by the slice (no `CompanyUpdated` / `CompanyDeleted` events are emitted). Confirmed by a test that asserts the audit row count is unchanged after a successful PATCH and a successful DELETE.

## 14. Open items for the design phase

The user round (§15) will resolve items 1–4; the design phase picks up the rest:

1. **`UpdateCompany :one` SQL guard shape** — the proposal recommends a single-statement partial update WITHOUT the active-company CTE (decision #9): `UPDATE companies SET <11 COALESCE clauses + 3 CASE clauses + name COALESCE> ..., updated_at = clock_timestamp() WHERE id = $company_id AND deleted_at IS NULL AND updated_at = $cas_token RETURNING (SELECT count(*) FROM (UPDATE ... RETURNING id) AS upd) AS updated_count` (or equivalent scalar SELECT shape mirroring `UpdateJob :one` minus the CTE). Design phase confirms.
2. **`SoftDeleteCompany :one` SQL guard shape** — the proposal recommends a single-statement soft-delete WITHOUT the active-company CTE (decision #10): `UPDATE companies SET deleted_at = now(), updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL AND updated_at = $2 RETURNING (SELECT count(*) FROM (UPDATE ... RETURNING id) AS upd) AS updated_count`. Design phase confirms.
3. **`CloseCompanyJobs :exec` SQL** — the proposal recommends the straightforward `UPDATE jobs SET status='closed', updated_at=clock_timestamp() WHERE company_id=$1 AND deleted_at IS NULL AND status IN ('draft','published')`. No guard, no CTE. The use case does NOT branch on the rowcount. Design phase confirms.
4. **`Optional[T]` lift or duplicate** — §7.2 flags the choice: lift to `internal/shared/valueobjects/optional.go` (preferred — one-time cross-feature import) vs duplicate into `internal/features/companies/domain/valueobjects/optional.go` (~30 lines duplicated). Design phase picks one and sticks with it across both jobs and companies.
5. **`buildUpdateCompanyParams` ergonomics** — at minimum `(companyID, patch, casUpdatedAt)`. The `UpdateCompanyParams` sqlc struct gains `ID uuid.UUID`, `CasToken pgtype.Timestamptz`, `Name pgtype.Text`, 9 text `pgtype.Text` for the optional text columns, 3 `Set_<field> bool` + 3 `<field> pgtype.<type>` for the nullable trio. Design phase confirms the exact arg ordering (pinned by SQL first-textual-appearance).
6. **`UpdateCompanyRow` field naming** — `UpdatedCount int64` only (no editor-view projection; the use case re-reads). The name is pinned by the SQL alias. Design phase confirms.
7. **Use-case `CAS compare` semantics** — proposal default: `if !ifUnmodifiedSince.Equal(current.UpdatedAt) { return (view, ErrConcurrencyConflict) }` for PATCH; same shape with `return entities.ErrConcurrencyConflict` (no view) for DELETE. Edge cases: zero token (missing header) → guaranteed mismatch → `409`. Trailing-precision mismatch (RFC 3339 vs RFC 3339Nano) — the existing `parseIfUnmodifiedSince` parses `RFC3339` (whole-second precision); a client using `time.RFC3339Nano` may hit a mismatch on a freshly-written row. The behavior matches `EditJob` / `SoftDeleteJob` exactly (no special handling). Design phase confirms.
8. **Stub repair shape** — every stub gains `UpdateCompany` + `SoftDeleteCompany` + `GetCompanyForUpdate` methods. Design phase confirms the captured fields (`lastUpdateCompany*`, `lastSoftDeleteCompany*`, `lastGetCompanyForUpdate*`, programmable `*Err` fields) and the default return (`nil` to keep existing tests green).
9. **SQL-level integration test fixtures** — `companies_write_integration_test.go` (new file) needs fixtures for: (a) an active owner with their company; (b) a recruiter of the same company (for the 403 test); (c) a foreign owner of a different company (for the cross-company 404 test); (d) a tombstoned company (for the second-DELETE 404 test); (e) a company with 1 draft + 1 published + 1 closed + 1 deleted job (for the inline-close integration test). The new integration tests reuse the existing `companies` fixture seed (the create flow already provides active companies).
10. **`mapUpdateCompanyError` defense-in-depth** — proposal default: `pgx.ErrNoRows → ErrCompanyNotFound` (defense-in-depth; the `:one` scalar SELECT always returns one row), `23514 → ErrCompanyNameTooShort` / `ErrInvalidCompanySize` / `ErrFoundedYearOutOfRange` / `ErrCompanyDescriptionTooLong` (dispatched by `ConstraintName`), pass-through for unknown errors. `23503` is NOT mapped (PATCH does not insert or reassign FKs). Design phase confirms the `ConstraintName` dispatch logic.
11. **`mapSoftDeleteCompanyError` defense-in-depth** — proposal default: `pgx.ErrNoRows → ErrCompanyNotFound`, `23514 → ErrInvalidCompanyStatusTransition` (new sentinel, defense-in-depth; the inline close only sets `closed` from `draft`/`published`, which the `jobs_status_check` accepts — so this branch is unreachable via the designed flow). Pass-through for unknown errors. `23503` is NOT mapped. Design phase confirms.
12. **`Optional[T]` lift refactor scope** — if the design picks "lift" (decision §7.2), the refactor touches: `backend/internal/features/jobs/domain/valueobjects/optional.go` (becomes re-export), `backend/internal/features/jobs/domain/valueobjects/optional_test.go` (stays put, exercises the shared type), every import of `jobs/domain/valueobjects` that uses `Optional[T]` (UpdateJobDto, UpdatePatch, buildUpdateJobParams, optionalStringToText, optionalIntToInt4) — switched to `shared/valueobjects.Optional[T]`. ~10 import lines + 1 file move. Design phase lists every call site.

## 15. Proposal question round (RESOLVED — user answers in-session)

The user answered all four blocking decisions in this session; all answers are baked into §4 and §6. Locked decisions now stand:

1. **Ownership on PATCH + DELETE — RESOLVED: owner-only.** `RequireCompanyRole(owner)` is the gate for both endpoints. The middleware resolves `sub → users.id → company_members` per request and injects `CompanyContext{CompanyID, UserID, Role}`. CompanyID always comes from the resolved context; the path/body never carry `company_id`.
2. **Delete semantics — RESOLVED: soft delete + transactional close of all company jobs.** `DELETE /me/company` sets `companies.deleted_at = now()` AND closes every `draft`/`published` job of the company in the SAME SQL transaction (`pool.Begin → db.New(tx) → commit, defer rollback`). Company memberships and applications stay untouched as history. No restore endpoint in this cycle.
3. **Field mutability — RESOLVED: `rfc` + `industry_id` IMMUTABLE after creation.** Mutable: `name` + all 11 profile fields. Partial update DTO: absent field = unchanged (pointer-based; matches `EditJob` / `UpsertMyProfile`).
4. **Audit events — RESOLVED: DEFERRED to a follow-up cycle.** This cycle does NOT emit `audit_events` for companies. The `audit_events` bounded context stays applications-only. Explicit non-goal (§8). Follow-up cycle adds the company event-type catalog (`CompanyUpdated`, `CompanyDeleted`, future `CompanySuspended`, future `CompanyRestored`).

## 16. Cross-references

- `backend/db/migrations/00002_create_companies.sql` — `companies` schema with `deleted_at TIMESTAMPTZ` (column 9), `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` (column 8), `companies_rfc_unique ON (rfc) WHERE deleted_at IS NULL`. No new migration needed.
- `backend/db/migrations/00003_companies_profile.sql` — `companies` profile columns (`description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`) + `companies_size_check` + `companies_founded_year_check` CHECK constraints. The use case parses VOs before SQL so the CHECKs are defense-in-depth.
- `backend/db/migrations/00007_jobs.sql` — `jobs` schema with `status` CHECK including `closed`. The inline close sets `status='closed'`; the `jobs_status_check` accepts it. `jobs.deleted_at IS NULL` predicate excludes already-tombstoned jobs from the inline close.
- `backend/db/queries/companies.sql::CreateCompany` + `GetCompanyByID` — the existing queries that stay unchanged. `GetCompanyByID` filters `deleted_at IS NULL` (the read-side hiding invariant).
- `backend/db/queries/jobs.sql::UpdateJob :one` — the atomic single-statement partial update + CAS pattern to mirror for `UpdateCompany :one` (minus the active-company CTE).
- `backend/db/queries/jobs.sql::SoftDeleteJob :one` — the atomic single-statement soft-delete + CAS pattern to mirror for `SoftDeleteCompany :one` (minus the active-company CTE).
- `backend/internal/features/jobs/application/usecases/updateJob.go` — the `EditJob` orchestrator and `toEditorView` projection to mirror for `UpdateCompany` (minus the status transition table + validation).
- `backend/internal/features/jobs/application/usecases/softDeleteJob.go` — the `SoftDeleteJob` orchestrator to mirror for `SoftDeleteCompany` (minus the editor-view 409 body).
- `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go::Update` + `::mapUpdateError` + `::SoftDelete` + `::mapSoftDeleteError` — the adapter pattern to mirror for `UpdateCompany` + `SoftDeleteCompany`. Same `pgx.ErrNoRows → ErrCompanyNotFound` ordering (BEFORE the `errors.As` into `*pgconn.PgError`).
- `backend/internal/features/jobs/domain/valueobjects/optional.go` — the `Optional[T]` tri-state type. Decision §7.2: lift to `shared/valueobjects` (preferred) or duplicate into companies slice.
- `backend/internal/features/companies/infrastructure/postgres/companyBootstrapRepository.go` — the transactional multi-write pattern to mirror for `SoftDeleteCompany` (`pool.Begin → defer Rollback → db.New(tx).X → db.New(tx).Y → tx.Commit`).
- `backend/internal/features/applications/infrastructure/postgres/applicationRepository.go::Create` — the same transactional multi-write pattern, with the additional audit co-write step that this slice deliberately OMITS (decision #4).
- `backend/internal/features/candidates/infrastructure/postgres/candidateRepository.go::ReplaceLanguagesByUserID` — the third transactional multi-write precedent.
- `backend/internal/features/identity/infrastructure/http/requireCompanyRole.go` — the gate middleware that resolves `sub → users.id → company_members` and injects `security.CompanyContext`. Reused verbatim.
- `backend/internal/features/identity/domain/security/companyContext.go` — the `CompanyContext` struct. Reused verbatim. `UserID` field already in place for the future audit actor.
- `backend/internal/features/companies/infrastructure/http/handler.go` — the existing `CompanyHandler` + `CompanyHandlers` accessor + `companyPublicResponse` shape + `classifyCreateCompanyError` flat dispatcher. Extended with `UpdateCompany` + `DeleteCompany` handlers + `classifyUpdateCompanyError` + `classifyDeleteCompanyError` + `parseIfUnmodifiedSince` (duplicated from jobs handler).
- `backend/cmd/api/main.go` — the composition root. Two new route lines on the `/me` subtree + the `NewCompanyRepository(pool)` refactor.
- `openspec/changes/archive/2026-08-20-company-members/{proposal.md,design.md,specs/company-membership/spec.md}` — the membership slice that ships `RequireCompanyRole` + the membership routes this proposal sits next to.
- `openspec/changes/archive/2026-08-25-jobs-soft-delete/{proposal.md,design.md,specs/jobs/spec.md}` — the most recent write-side delivery; reuses D1 (atomic CTE guard via `:one` scalar SELECT — minus the active-company CTE), D2 (CAS via If-Unmodified-Since), D4/D5 (the read-for-delete pattern), D8 (the routing-split defense), D9 (the atomic stub repair).
- `openspec/changes/archive/2026-08-25-jobs-reopen/{proposal.md,design.md,specs/jobs/spec.md}` — the most recent write-side delivery; reuses D1 (the `:one` scalar SELECT shape) + D6 (the published_at preservation invariant, mapped to the "jobs closing preserves deleted_at and other audit columns" equivalent on this slice).
- `openspec/changes/archive/2026-08-25-jobs-create/{proposal.md,design.md,specs/jobs/spec.md}` — the create delivery; reuses the atomic active-company SQL guard precedent + the routing-split defense.
- `openspec/changes/archive/2026-08-25-applications/{proposal.md,design.md,specs/applications/spec.md}` — the transactional multi-write precedent (audit co-write, deliberately omitted in this slice).
- `openspec/changes/archive/2026-08-25-audit_events/{proposal.md,design.md,specs/audit_events/spec.md}` — the audit_events slice that this proposal deliberately does NOT extend (decision #4 + #13 + §8). The follow-up cycle adds `CompanyUpdated` + `CompanyDeleted` (and future `CompanySuspended` + `CompanyRestored`) to the catalog.
- `docs/flujo-verificacion-empresas.md` — the canonical decision that `status` is owned by manual takedown, not by PATCH. Decision §6.6 + decision #14 + §8 honor this.
- `openspec/config.yaml` (`proposal` rules) — rollback, file paths under `backend/internal/features/<domain>/`, infra dependencies all honored. No new infrastructure dependency beyond the existing `pgxpool.Pool` already wired in `cmd/api/main.go::run`.