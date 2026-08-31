# Companies Specification

## Purpose

The `companies` bounded context owns the company aggregate and its write surface. A `companies` row is the canonical company record (name, RFC, industry, profile fields, status) materialized by migrations `00002_create_companies.sql` + `00003_companies_profile.sql` and exposed on the public read path through `GET /companies/{id}`. This slice covers the **owner-only write surface** that closes the MVP write loop: `POST /companies` (create with founder as owner, delivered by the existing slice), `PATCH /me/company` (owner-only partial update of the owner's company — the centerpiece of this delta), and `DELETE /me/company` (owner-only soft-delete that transactionally closes every non-closed job of the company). The read side (`GET /companies/{id}`, `GET /me/company`, `GET /me/company/members`, the membership mutations) is unchanged in shape and behavior — the soft-delete write sets `companies.deleted_at` and the existing `deleted_at IS NULL` read-side predicates hide the row from public visibility. The bounded context owns the table, the use cases, the transactional multi-write path (soft-delete + inline close + co-write audit append), the wire DTOs, and the gate; it does NOT own the `audit_events` table schema (the audit row is co-written inside the same `pgx.Tx` — see `Audit Events for Companies` for the emission contract), the `jobs` write surface (job status moves are owned by the `jobs` bounded context), the `company_members` write surface (membership mutations stay as audit history — the soft-delete write does NOT touch them), or the candidate-facing read surface (candidates are a separate bounded context). A successful `PATCH /me/company` adds exactly one `CompanyUpdated` row to `audit_events`; a successful `DELETE /me/company` adds exactly one `CompanyDeleted` row.

## Out of scope (deferred)

This specification does NOT cover: company `status` field manipulation (the field is owned by the manual takedown flow pinned in `docs/flujo-verificacion-empresas.md` — `status` is NOT in the `PATCH /me/company` DTO; no API path changes it); `industry_id` field change after creation (the `PATCH /me/company` DTO has NO `industry_id` field — clients sending it are silently ignored; a future "industry migration" feature is a separate concern); `rfc` field change after creation (the `PATCH /me/company` DTO has NO `rfc` field — clients sending it are silently ignored; the partial unique index `companies_rfc_unique ON (rfc) WHERE deleted_at IS NULL` is a write-time guard at INSERT only and is NOT re-checked on PATCH); hard delete (`DELETE FROM companies` is out of scope forever — bypasses audit and breaks the soft-delete + close invariant); restore / undelete (`POST /me/company/restore` or `PATCH /me/company {"deleted_at": null}` is out of scope — the soft-delete + inline close cycle is one-way; a future restore endpoint operates on the intact member + applications data and re-opens the inline close); notification / event publishing (no outbox, no SNS/SQS, no webhooks — the slice stays synchronous); bulk operations (`PATCH /me/companies?ids=...` or `DELETE /me/companies?ids=...` is out of scope — one company per request); a `deleted_by_user_id` column or a `deleted_reason` column on `companies` (`companies.deleted_at` IS the audit timestamp; no extra audit columns in this slice); `PUT /me/company` (full replacement, no CAS, no field-mutability distinction — out of scope); admin / system takedown routes (the MVP takedown flow is manual — a future admin slice adds `POST /companies/{id}/suspend`, etc.); cross-company write paths (no `PATCH /companies/{id}` or `DELETE /companies/{id}` — both writes live exclusively under `/me/company`); frontend, SQS worker, email, FX conversion, and CV / S3 storage.

## Requirements

### Requirement: PATCH /me/company Endpoint, Owner-Only Gate, and Field Mutability

The system MUST expose `PATCH /me/company` as an owner-only write route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(owner)`. The `RequireCompanyRole` middleware MUST probe the resolved member company's liveness (the same SQL `WHERE deleted_at IS NULL` predicate used by `GetCompanyByID`) AFTER membership resolution and BEFORE role comparison — a tombstoned company (`deleted_at IS NOT NULL`) and a missing company row (`ErrCompanyNotFound`) collapse to the SAME `403 Forbidden` with reason `company is inactive`, the handler is NEVER invoked, and no `CompanyContext` is injected (so the handler cannot see the row). The handler MUST derive `company_id` exclusively from the `security.CompanyContext` injected by the middleware; any `company_id` value supplied in the request body MUST be ignored by the server. Because `MemberRole` is ordinal and `owner` is the highest role in the matrix, only an owner of a LIVE company passes the gate — a recruiter (role `< owner`) and an owner of a tombstoned company are both rejected with `403` from the middleware BEFORE the handler runs (three branches — role below owner, no `company_members` row, tombstoned company — collapse to the same `403`). The handler MUST short-circuit fail-closed (return `500 internal server error`) if no `CompanyContext` is present on the request context (mirroring the canonical `RequireCompanyContext` invariant from the `jobs` slice).

The PATCH body MUST be a JSON object that carries OPTIONAL fields only — no field is required. Absent fields MUST be left untouched on the server (partial update). The editable set is exactly: `name` (string, re-validated via `valueobjects.CompanyName` — `≥ 4` characters after trim) and the eleven profile fields `website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`. The PATCH DTO MUST NOT carry `rfc`, `industry_id`, or `status`; `encoding/json` silently drops unknown JSON keys, so a client that sends any of those keys gets the same outcome as if they did not send them — the row's `rfc`, `industry_id`, and `status` are unchanged. For text columns (`website`, `logo_url`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`), the server MUST distinguish `null` (present and JSON `null`, meaning "clear the column to SQL `NULL`") from absent (field omitted from the JSON, meaning "do not touch"). For the nullable profile columns (`description`, `size`, `founded_year`), the tri-state semantics MUST apply: absent leaves the column unchanged, explicit `null` clears the column to SQL `NULL`, present value sets the column to the parsed value (the use case MUST re-validate through the corresponding `valueobjects` VO — `CompanyDescription`, `CompanySize`, `FoundedYear` — before the SQL UPDATE runs).

#### Scenario: owner patches a single field

- GIVEN an owner of company `A` and a body with `{"website": "https://new.example.com"}`
- WHEN `PATCH /me/company` is sent with a matching `If-Unmodified-Since` header
- THEN the response is `200 OK` with the redacted public company shape (see `PATCH /me/company Response Shape`), `website` is updated to the new value, and `name`, `rfc`, `industry_id`, `status`, and every other profile field remain unchanged

#### Scenario: owner patches multiple fields in one call

- GIVEN an owner of company `A` and a body with `{"name": "New Co.", "logo_url": "https://cdn.example/logo.png"}`
- WHEN `PATCH /me/company` is sent with a matching `If-Unmodified-Since` header
- THEN the response is `200 OK`, `name` is updated to `"New Co."` (re-validated via `CompanyName`), `logo_url` is updated, and every other column remains unchanged

#### Scenario: absent fields leave columns unchanged

- GIVEN a company `A` with `website='old.example.com'`, `city='Mexico City'`, `description='Old bio'`
- WHEN `PATCH /me/company` is sent with `{"logo_url": "https://cdn.example/new.png"}` and no `website`, `city`, or `description` keys
- THEN the response is `200 OK`, `logo_url` is updated, and `website`, `city`, `description` are unchanged from their pre-call values

#### Scenario: explicit JSON null clears a nullable column (text + tri-state profile)

- GIVEN a company `A` with `logo_url='https://cdn.example/old.png'` and a non-NULL `description` value
- WHEN `PATCH /me/company` is sent with `{"logo_url": null, "description": null}`
- THEN the response is `200 OK`, the row's `logo_url` is `NULL` (plain pointer-clear semantics for text columns), and the row's `description` is `NULL` (tri-state clear semantics for the genuinely-nullable profile columns); every other column is unchanged

#### Scenario: immutable fields in body are silently dropped

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with `{"rfc": "NEW123", "industry_id": "industries_other", "status": "suspended"}`
- THEN the response is `200 OK` and the row's `rfc`, `industry_id`, and `status` are unchanged (the DTO has no `rfc`/`industry_id`/`status` fields; `encoding/json` drops the unknown keys; no `400`, no echo)

#### Scenario: company_id in body is ignored (IDOR defense)

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with `{"company_id": "<uuid-of-company-B>", "website": "https://x.example.com"}`
- THEN the response is `200 OK`, the write targets company `A` from `CompanyContext` (NOT company `B`), and `website` is updated on company `A`'s row only

#### Scenario: name shorter than 4 characters is rejected

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with `{"name": "AB"}` and a matching `If-Unmodified-Since`
- THEN the response is `400 Bad Request` with body `{"error":"el nombre de la compañía no puede ser menor a 4 caracteres"}` (the `CompanyName` VO rejects pre-SQL) and no row is updated

#### Scenario: description exceeding the 3000-character cap is rejected

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with `{"description": "<a 3001-character string>"}`
- THEN the response is `400 Bad Request` (the `CompanyDescription` VO rejects pre-SQL) and no row is updated

#### Scenario: founded_year out of range is rejected

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with `{"founded_year": 1500}`
- THEN the response is `400 Bad Request` with body `{"error":"el año de fundación está fuera del rango permitido (1800 a año actual + 1)"}` (the `FoundedYear` VO rejects pre-SQL) and no row is updated

#### Scenario: invalid company size is rejected

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with `{"size": "gigantic"}`
- THEN the response is `400 Bad Request` (the `ParseCompanySize` VO rejects pre-SQL) and no row is updated

#### Scenario: invalid JSON body returns 400

- GIVEN an owner of company `A`
- WHEN `PATCH /me/company` is sent with a body that is not valid JSON
- THEN the response is `400 Bad Request` and no row is updated

#### Scenario: non-owner, non-member, and tombstoned company are rejected with 403

- GIVEN a recruiter (role `< owner`) membership in company `A`, OR an authenticated user with no `company_members` row, OR an owner of company `A` whose `companies.deleted_at IS NOT NULL` (tombstoned)
- WHEN `PATCH /me/company` is sent
- THEN the response is `403 Forbidden` and the handler is never invoked (the middleware short-circuits; the role-below-owner branch, the no-membership-row branch, and the tombstoned-company branch all collapse to the same `403`; the tombstoned-company branch additionally carries reason `company is inactive` and injects no `CompanyContext`)

#### Scenario: unauthenticated request returns 401

- GIVEN a `PATCH /me/company` request with no `Authorization` header
- WHEN the request reaches the gated write route
- THEN the response is `401 Unauthorized` and the handler is never invoked (RequireAuth short-circuits)

#### Scenario: missing CompanyContext fails closed

- GIVEN a request that bypasses the middleware and reaches the handler with no `CompanyContext` on the request context
- WHEN `PATCH /me/company` is sent
- THEN the response is `500 Internal Server Error` and no row is updated (mirroring the canonical fail-closed invariant)



### Requirement: PATCH /me/company CAS Optimistic Concurrency Control

The system MUST require an `If-Unmodified-Since` request header carrying the client's last-known `updated_at` formatted as an RFC 3339 timestamp string. The server MUST compare the header value against the current `updated_at` loaded by the read-for-update inside the same write transaction; the comparison MUST be against the row, NOT against any value supplied by the client. The header MUST be required — missing or malformed header yields a zero `time.Time{}` token, which compares unequal to the row's `updated_at`, producing a `409 Conflict` (same body shape as a stale token). On a CAS mismatch, the response MUST be `409 Conflict` and the body MUST contain the latest redacted company record (see `PATCH /me/company Response Shape`) so the client can re-read without an extra round-trip. The `409` body MUST use the same shape as the `200` body so the editor view is identical across success and conflict. A successful PATCH MUST advance the row's `updated_at` exactly once in the same SQL statement that writes the field patches so the next PATCH or DELETE the client sends against the same company uses the fresh `updated_at` as its CAS token.

#### Scenario: matching If-Unmodified-Since allows the write

- GIVEN a company `A` whose current `updated_at` is `2026-02-01T10:00:00Z`
- WHEN `PATCH /me/company` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z` and a valid body
- THEN the response is `200 OK` with the redacted public company shape, the new `updated_at` is strictly greater than `2026-02-01T10:00:00Z`, and the patched columns are persisted

#### Scenario: stale If-Unmodified-Since returns 409 with the latest view

- GIVEN a company `A` whose current `updated_at` is `2026-02-02T11:00:00Z` (changed by another writer since the client last read it)
- WHEN `PATCH /me/company` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z` and a valid body
- THEN the response is `409 Conflict` with the redacted public company shape carrying `updated_at='2026-02-02T11:00:00Z'` and no row is updated

#### Scenario: missing If-Unmodified-Since returns 409 with the latest view

- GIVEN a company `A`
- WHEN `PATCH /me/company` is sent without an `If-Unmodified-Since` header
- THEN the response is `409 Conflict` with the redacted public company shape (the zero token mismatches any non-zero row `updated_at`) and no row is updated

#### Scenario: malformed If-Unmodified-Since returns 409 with the latest view

- GIVEN a company `A`
- WHEN `PATCH /me/company` is sent with `If-Unmodified-Since: not-a-timestamp` and a valid body
- THEN the response is `409 Conflict` with the redacted public company shape (the parser yields a zero token on a parse failure; the CAS compare mismatches) and no row is updated

#### Scenario: two concurrent writers, exactly one wins

- GIVEN a company `A` whose current `updated_at` is `T`
- WHEN two owners send `PATCH /me/company` at the same time, both with `If-Unmodified-Since: T` and disjoint field patches
- THEN exactly one response is `200 OK` with the redacted public company shape (its patch persists), and the other is `409 Conflict` with the latest view (the second caller's CAS compare fails because the first caller's UPDATE advanced `updated_at`)

### Requirement: PATCH /me/company Response Shape

The PATCH response body — on both `200 OK` and `409 Conflict` — MUST be the redacted public company shape used by `GET /companies/{id}` (the existing `companyPublicResponse` from `companies/infrastructure/http/handler.go` is the canonical reference for the field set), plus the fresh `updated_at` value the client echoes as the next CAS token. The body MUST include `id`, `name`, `website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`, and `updated_at`. The body MUST NOT include `rfc` (tax id — never in the public shape), `industry_id` (the public shape omits it; the existing `companyPublicResponse` does not expose it), `status` (internal), `deleted_at` (internal tombstone), or `created_at` (the public shape omits creation timestamps). The `200` and `409` bodies MUST use the same wire shape so a re-read after a CAS conflict returns the same fields as a successful write (mirroring the canonical PATCH `200`/`409` symmetry from the `jobs` slice).

#### Scenario: 200 body carries the redacted public company shape

- GIVEN a successful `PATCH /me/company`
- WHEN the response is returned
- THEN the body includes the patched company profile fields (`website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`, plus `name` if it was patched) and the new `updated_at`

#### Scenario: 200 and 409 bodies omit rfc, industry_id, status, and deleted_at

- GIVEN any `PATCH /me/company` `200` or `409` response
- WHEN the body is inspected
- THEN `rfc`, `industry_id`, `status`, and `deleted_at` are NOT in the body (the public shape never exposes them; the owner knows their own RFC and industry because they set them at create time)

#### Scenario: 200 and 409 bodies use the same wire shape

- GIVEN a CAS conflict on `PATCH /me/company`
- WHEN the response is returned
- THEN the `409` body uses the same field set, JSON ordering, and `updated_at` value as a successful `200` body would (the client can swap shapes without a second round-trip)

### Requirement: DELETE /me/company Endpoint, Owner-Only Gate, and Idempotency

The system MUST expose `DELETE /me/company` as an owner-only write route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(owner)`. The `RequireCompanyRole` middleware MUST probe the resolved member company's liveness (the same SQL `WHERE deleted_at IS NULL` predicate used by `GetCompanyByID`) AFTER membership resolution and BEFORE role comparison — a tombstoned company (`deleted_at IS NOT NULL`) and a missing company row (`ErrCompanyNotFound`) collapse to the SAME `403 Forbidden` with reason `company is inactive`, the handler is NEVER invoked, and no `CompanyContext` is injected (so the handler cannot see the row). The handler MUST derive `company_id` exclusively from the `security.CompanyContext` injected by the middleware; the request carries no body and the path carries no `company_id`, so no client-supplied value is ever honored. Only an owner of a LIVE company passes the gate — a recruiter (role `< owner`) and an owner of a tombstoned company are both rejected with `403` from the middleware BEFORE the handler runs. The handler MUST short-circuit fail-closed (return `500 internal server error`) if no `CompanyContext` is present on the request context. The request MUST NOT carry a body. On success the response MUST be `204 No Content` with an empty body (no editor view is projected — see `DELETE /me/company CAS Optimistic Concurrency Control` for the deliberately-empty `409` body shape on CAS mismatch). A second `DELETE /me/company` against an already-soft-deleted company MUST return `403 Forbidden` with reason `company is inactive` from the `RequireCompanyRole` liveness gate (the gate intercepts before the handler runs); the handler / use-case / repository `ErrCompanyNotFound` path remains in place as defense-in-depth for a bypassed or mis-wired call (and would surface as `404 company not found` in that edge case), but the production API MUST NOT reach it for a tombstoned company. The `404` body shape for that defense-in-depth path MUST remain identical to the body shape for a non-existent company id (no leak of existence, consistent with the canonical `Same-Company Invariant and IDOR Defense` for `PATCH /jobs/{id}` and `DELETE /jobs/{id}`).

#### Scenario: owner soft-deletes their company

- GIVEN an owner of company `A` whose `companies.updated_at` is `T` and whose `companies.deleted_at IS NULL`
- WHEN `DELETE /me/company` is sent with `If-Unmodified-Since: T`
- THEN the response is `204 No Content` with an empty body (no editor view is projected — the post-delete row's `deleted_at` is not surfaced), `companies.deleted_at` is set within the request window, `companies.updated_at` advances to a value strictly greater than `T`, and every draft/published job of company `A` is transitioned to `status='closed'` in the same SQL transaction (see `Soft-Delete Atomic Transactional Close of Jobs`)

#### Scenario: non-owner, non-member, and tombstoned company are rejected with 403

- GIVEN a recruiter (role `< owner`) membership in company `A`, OR an authenticated user with no `company_members` row, OR an owner of company `A` whose `companies.deleted_at IS NOT NULL` (tombstoned)
- WHEN `DELETE /me/company` is sent
- THEN the response is `403 Forbidden` and the handler is never invoked (the middleware short-circuits; the role-below-owner branch, the no-membership-row branch, and the tombstoned-company branch all collapse to the same `403`; the tombstoned-company branch additionally carries reason `company is inactive` and injects no `CompanyContext`)

#### Scenario: unauthenticated request returns 401

- GIVEN a `DELETE /me/company` request with no `Authorization` header
- WHEN the request reaches the gated write route
- THEN the response is `401 Unauthorized` and the handler is never invoked

#### Scenario: missing CompanyContext fails closed

- GIVEN a request that bypasses the middleware and reaches the handler with no `CompanyContext` on the request context
- WHEN `DELETE /me/company` is sent
- THEN the response is `500 Internal Server Error` and no row is tombstoned

#### Scenario: second DELETE on an already-soft-deleted company returns 403

- GIVEN a company `A` with `companies.deleted_at IS NOT NULL` and an owner whose `company_members.role='owner'` for `A`
- WHEN the owner sends `DELETE /me/company` with any `If-Unmodified-Since`
- THEN the response is `403 Forbidden` with reason `company is inactive` and the handler is NEVER invoked — `RequireCompanyRole`'s liveness gate sees the tombstoned company and short-circuits BEFORE `GetCompanyForUpdate` runs (the handler / repository `ErrCompanyNotFound` path is preserved as defense-in-depth for a bypassed or mis-wired call and would surface as `404 company not found` in that edge case, but the production API MUST NOT reach it for a tombstoned company)

### Requirement: DELETE /me/company CAS Optimistic Concurrency Control

The system MUST require an `If-Unmodified-Since` request header carrying the client's last-known `updated_at` formatted as an RFC 3339 timestamp string. The server MUST compare the header value against the current `updated_at` loaded by the read-for-delete inside the same write transaction; the comparison MUST be against the row, NOT against any value supplied by the client. The header MUST be required — missing or malformed header yields a zero `time.Time{}` token, which compares unequal to the row's `updated_at`, producing a `409 Conflict`. On a CAS mismatch, the response MUST be `409 Conflict` with an EMPTY body (no latest company record, no editor view) — this is a deliberate asymmetry versus PATCH: PATCH's CAS body MUST carry the editor view because PATCH has a structured body that includes `updated_at` for the next CAS round-trip; DELETE's CAS is a one-shot and the success path has no body, so the `409` body is intentionally empty to keep the wire contract symmetric. The client re-reads via `GET /me/company` (which returns either the company or `404` if a concurrent DELETE won) and decides whether to re-issue with the fresh token. After a successful soft-delete, the row's `updated_at` advances exactly once in the same SQL transaction that sets `deleted_at` and closes the company's jobs so the next PATCH or DELETE the client sends uses the fresh `updated_at` as its CAS token.

#### Scenario: matching If-Unmodified-Since allows the soft-delete

- GIVEN a company `A` whose current `updated_at` is `2026-02-01T10:00:00Z` and `deleted_at IS NULL`
- WHEN `DELETE /me/company` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- THEN the response is `204 No Content`, the row's `deleted_at` is set within the request window, the row's `updated_at` advances to a value strictly greater than `2026-02-01T10:00:00Z`, and the inline close on the company's jobs runs in the same transaction (see `Soft-Delete Atomic Transactional Close of Jobs`)

#### Scenario: stale If-Unmodified-Since returns 409 with empty body

- GIVEN a company `A` whose current `updated_at` is `2026-02-02T11:00:00Z` (changed by another writer since the client last read it)
- WHEN `DELETE /me/company` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- THEN the response is `409 Conflict` with an empty body (the CAS body is intentionally empty on DELETE — see `DELETE /me/company CAS Optimistic Concurrency Control`) and no row is tombstoned

#### Scenario: missing If-Unmodified-Since returns 409 with empty body

- GIVEN a company `A`
- WHEN `DELETE /me/company` is sent without an `If-Unmodified-Since` header
- THEN the response is `409 Conflict` with an empty body (the zero token mismatches any non-zero row `updated_at`) and no row is tombstoned

#### Scenario: malformed If-Unmodified-Since returns 409 with empty body

- GIVEN a company `A`
- WHEN `DELETE /me/company` is sent with `If-Unmodified-Since: not-a-timestamp`
- THEN the response is `409 Conflict` with an empty body (the parser yields a zero token on a parse failure; the CAS compare mismatches) and no row is tombstoned

#### Scenario: two concurrent owners, exactly one wins

- GIVEN a company `A` whose current `updated_at` is `T`
- WHEN two owners send `DELETE /me/company` at the same time, both with `If-Unmodified-Since: T`
- THEN exactly one response is `204 No Content` (its DELETE persists: the company is tombstoned and its jobs are closed in the same transaction) and the other is `409 Conflict` with an empty body (the second caller's CAS compare fails because the first caller's transaction advanced `updated_at`)

### Requirement: Soft-Delete Atomic Transactional Close of Jobs

A successful `DELETE /me/company` MUST run two SQL writes inside the same database transaction (one `pgx.Tx` opened by the postgres adapter; defer-rollback covers every error path): (1) `UPDATE companies SET deleted_at = now(), updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL AND updated_at = $cas_token` — the soft-delete of the company record; (2) `UPDATE jobs SET status = 'closed', updated_at = clock_timestamp() WHERE company_id = $1 AND deleted_at IS NULL AND status IN ('draft', 'published')` — the inline close of every non-closed, non-tombstoned job of the company. Both writes MUST commit atomically; on any error in either statement, the transaction MUST roll back and NEITHER the tombstone NOR the close is visible. Rows already in `jobs.status = 'closed'` MUST NOT be touched (the `IN ('draft', 'published')` predicate excludes them — closing a closed job is a no-op; `updated_at` is NOT bumped on those rows). The adapter MAY surface the rowcount of the inline close via `cmdtag.RowsAffected()` for telemetry, but the use case MUST NOT branch on it — `0 rows closed` is a legitimate success path ("this company had no non-closed jobs at delete time") and MUST NOT surface as an error. The soft-delete write MUST NOT touch `company_members` (memberships stay as audit history — owner stays owner, recruiters stay recruiters, no role demotion on soft-delete). The soft-delete write MUST NOT touch `applications` (application rows stay as audit history — candidates' own applications remain visible to them via `GET /me/applications`, the job's status is `closed` but the application row's status is unchanged).

#### Scenario: inline close transitions draft + published to closed

- GIVEN a company `A` with 1 draft job, 1 published job, and 1 closed job
- WHEN `DELETE /me/company` is sent with a matching `If-Unmodified-Since`
- THEN the response is `204 No Content`, the company's `deleted_at` is set within the request window, the draft and published jobs are now `status='closed'` with a fresh `updated_at`, and the soft-delete + the two `jobs.status='closed'` writes all persist in the SAME `pgx.Tx` (no TOCTOU window)

#### Scenario: already-closed jobs are NOT touched

- GIVEN a company `A` with 1 closed job whose `updated_at` is `T_closed`
- WHEN `DELETE /me/company` is sent with a matching `If-Unmodified-Since`
- THEN the response is `204 No Content`, the company's `deleted_at` is set, and the already-closed job's `status` stays `'closed'`, its `deleted_at` stays `NULL` (untouched), and its `updated_at` stays at `T_closed` (NOT bumped — the inline close's `IN ('draft', 'published')` predicate excludes it)

#### Scenario: company_members row count is unchanged after DELETE

- GIVEN a company `A` with `N` rows in `company_members` (the owner + recruiters)
- WHEN `DELETE /me/company` is sent with a matching `If-Unmodified-Since`
- THEN the response is `204 No Content` and the row count of `company_members WHERE company_id = A` is still `N` (no role demotion, no purge — the member list stays as audit history for any future restore/undelete endpoint)

#### Scenario: applications row count is unchanged after DELETE

- GIVEN a company `A` with `M` rows in `applications` referencing jobs of company `A`
- WHEN `DELETE /me/company` is sent with a matching `If-Unmodified-Since`
- THEN the response is `204 No Content` and the row count of `applications WHERE job_id IN (SELECT id FROM jobs WHERE company_id = A)` is still `M` (applications stay as audit history; the candidate's own history persists even though the parent job is now `closed`)

#### Scenario: failure on the inline close rolls back the soft-delete

- GIVEN the inline close `UPDATE jobs SET status='closed' …` fails inside the same `pgx.Tx` as the soft-delete (e.g., a transient DB error mid-transaction)
- WHEN `DELETE /me/company` is sent
- THEN the transaction rolls back, neither `companies.deleted_at` nor any `jobs.status` value is visible after the failure, and the response is `500 Internal Server Error` (the deferred rollback restores the row to its pre-call state; there is no partial commit)

### Requirement: Soft-Deleted Company Read Visibility

A company whose `companies.deleted_at IS NOT NULL` MUST be invisible on every public-facing read path. The existing `GET /companies/{id}` SQL (`backend/db/queries/companies.sql::GetCompanyByID`) already filters `deleted_at IS NULL`, so a soft-deleted company is hidden from public candidate reads. The inline close (see `Soft-Delete Atomic Transactional Close of Jobs`) ensures the company's jobs disappear from `GET /jobs` and `GET /jobs/{id}` because the `status='published'` predicate fails for closed jobs; the public jobs read queries (`SearchJobs` and `GetJobByID`) additionally carry the `c.deleted_at IS NULL` predicate as delivered read-side hardening (defense-in-depth against a future code path that writes a `'published'` job while the company is tombstoned). The owner-facing `GET /me/company` route resolves the company through the SAME `GetCompanyByID` query, so a soft-deleted company is also invisible there: the owner receives `404 company not found` for their own soft-deleted company. The membership row (`company_members`) survives in the DB as audit history (the soft-delete write does NOT touch `company_members`), but no read path re-surfaces a tombstoned company in this slice; a future restore endpoint is the proper un-tombstone mechanism.

#### Scenario: GET /companies/{id} hides a soft-deleted company

- GIVEN a company `A` with `deleted_at IS NOT NULL`
- WHEN `GET /companies/{id_of_A}` is sent (public, no `Authorization` header required)
- THEN the response is `404 company not found` (the existing `GetCompanyByID` `deleted_at IS NULL` predicate filters the row out — the read-side visibility invariant holds without any read-side change in this slice)

#### Scenario: GET /jobs excludes jobs of a soft-deleted company

- GIVEN a company `A` with `deleted_at IS NOT NULL` and 1 published job of company `A`
- WHEN `DELETE /me/company` was the previous successful call (so the inline close set the job to `status='closed'`)
- AND `GET /jobs` is sent
- THEN the company's job is NOT in the response listing (the inline close flipped the job's `status` out of the `status='published'` visibility predicate; the partial index `jobs_public_listing_idx` drops it automatically)

#### Scenario: GET /me/company hides a soft-deleted company from the owner (R7-S3 preservation)

- GIVEN a soft-deleted company `A` (`deleted_at IS NOT NULL`) and the owner whose `company_members.role='owner'` for `A`
- WHEN the owner sends `GET /me/company`
- THEN the response is `404 company not found` — `GET /me/company` is `RequireAuth`-only (NOT gated by `RequireCompanyRole`'s liveness check), so the tombstone gate does NOT apply on this read; the membership read resolves the company through `GetCompanyByID`, whose `WHERE deleted_at IS NULL` predicate filters the tombstoned row; the `company_members` row itself survives in the DB as audit history but no archived-company response is returned (the 404 hides the company projection; a future restore endpoint is the proper un-tombstone mechanism); every role-gated write subtree (under `RequireCompanyRole`'s liveness probe) returns `403 company is inactive` on the same tombstone

### Requirement: Authorization Dispatch Order for /me/company Writes

The `PATCH /me/company` and `DELETE /me/company` routes MUST share the same authorization dispatch order, layered strictly: `RequireAuth` MUST run first and reject with `401 Unauthorized` if no valid JWT is present (or if the JWT signature is unverifiable, or if the JWT `sub` matches no live `users.cognito_sub`); `RequireCompanyRole(owner)` MUST run second and pass through FOUR ordered sub-checks — (a) resolve the JWT `sub` to `users.id` (a missing subject is `401`), (b) resolve `users.id` to a `company_members` row (a missing row is `403 not a member of any company`), (c) probe the resolved company's liveness via the narrow `CompanyLivenessRepository` (a tombstoned company — `deleted_at IS NOT NULL` — or a missing company row — `ErrCompanyNotFound` — collapses to `403 company is inactive`; an unexpected liveness error is `500`), (d) compare the membership role to `owner` (a role strictly below `owner` is `403 insufficient role`). The tombstone liveness probe (sub-check c) runs AFTER membership resolution (so a stranger cannot probe company existence via the gate) and BEFORE role comparison (so the handler NEVER receives a `CompanyContext` for a tombstoned company); the gated handler MUST run third and short-circuit fail-closed with `500 Internal Server Error` if the request context is missing a `CompanyContext` (the `RequireCompanyContext` invariant — the middleware was mis-wired if `CompanyContext` is absent). The dispatch order MUST NOT be reordered: a request without `Authorization` MUST return `401` (NOT `403`, NOT `500`); a request with a valid `Authorization` but no `company_members` row MUST return `403` (NOT `500`, NOT `401`); a request whose membership's company is tombstoned or missing MUST return `403 company is inactive` (NOT `500`, NOT `401`); a request that bypasses the middleware and reaches the handler with no `CompanyContext` MUST return `500` (NOT `401`, NOT `403`). This is the canonical `401 → 403 → handler` chain — the same dispatch order every gated write subtree in the codebase enforces.

#### Scenario: 401 short-circuits before the role gate

- GIVEN a `PATCH /me/company` (or `DELETE /me/company`) request with no `Authorization` header
- WHEN the request reaches the gated write route
- THEN the response is `401 Unauthorized` and `RequireCompanyRole` is never invoked (RequireAuth short-circuits; no membership lookup runs)

#### Scenario: 403 short-circuits before the handler

- GIVEN a `PATCH /me/company` (or `DELETE /me/company`) request with a valid `Authorization` header but the authenticated user has no `company_members` row OR a row with a role below `owner`
- WHEN the request reaches the gated write route
- THEN the response is `403 Forbidden` (RequireCompanyRole short-circuits; the handler is never invoked)

#### Scenario: 403 for a tombstoned member company short-circuits before the handler

- GIVEN a `PATCH /me/company` (or `DELETE /me/company`) request with a valid `Authorization` header and an authenticated owner whose `companies.deleted_at IS NOT NULL` (tombstoned)
- WHEN the request reaches the gated write route
- THEN the response is `403 Forbidden` with reason `company is inactive` (the `RequireCompanyRole` liveness probe collapses tombstoned and missing-company rows to the same `403`; the handler is never invoked and no `CompanyContext` is injected)

#### Scenario: 500 fail-closed if CompanyContext is missing

- GIVEN a `PATCH /me/company` (or `DELETE /me/company`) request that bypasses `RequireCompanyRole` and reaches the handler with no `CompanyContext` on the request context (a mis-wired route, a future refactor that forgets to apply the gate)
- WHEN the handler runs
- THEN the response is `500 Internal Server Error` and no row is touched (the `requireCompanyContext` helper fails closed; mirroring the canonical invariant from the `jobs` slice and the `company_membership` subtree)

### Requirement: Audit Events for Companies

The system MUST emit exactly one `audit_events` row per successful owner-only write path on `companies`:

- A successful `PATCH /me/company` (HTTP `200 OK`) MUST append exactly one row carrying `event_type='CompanyUpdated'`, `entity_type='company'`, `entity_id=<company.id>`, `actor_type='user'`, `actor_id=<CompanyContext.UserID>`, `metadata='{}'` (the empty JSON object).
- A successful `DELETE /me/company` (HTTP `204 No Content`) MUST append exactly one row carrying `event_type='CompanyDeleted'`, `entity_type='company'`, `entity_id=<company.id>`, `actor_type='user'`, `actor_id=<CompanyContext.UserID>`, `metadata='{"jobs_closed": "<n>"}'`, where `<n>` is the stringified integer rowcount of the inline `CloseCompanyJobs` UPDATE; the `jobs_closed` key MUST be present even when `<n>` is `"0"` (stable shape).

The audit append MUST run inside the same `pgx.Tx` as the domain write (co-write atomicity — mirror of the applications slice); an append failure MUST abort the domain write via the deferred `tx.Rollback` (fail-closed — no write without its audit trail). The `audit_events` row count MUST change by exactly `+1` for each successful write; pre-write failures and any non-`200` / non-`204` outcome MUST append zero rows (see the no-emission matrix in the scenarios below). The `PATCH /me/company` DTO MUST NOT carry an `actor_id` field; the actor provenance is `CompanyContext.UserID` exclusively (`encoding/json` drops any smuggled actor — same IDOR defense as the applications handler).

The event MUST be built in the application layer (the use case is the single source of truth for the event shape and metadata); the handler MUST NOT build the event and MUST pass `CompanyContext.UserID` to the use case. The use case MUST be called with a non-zero `userID`; `userID == uuid.Nil` MUST fail closed with `ErrMissingActorIdentity` (HTTP `500 internal server error`, no write, no event) as the FIRST step of the use case — before `GetCompanyForUpdate` and before the CAS compare — so the audit append is never even attempted for a zero-actor request.

#### Scenario: PATCH success appends exactly one CompanyUpdated row with empty metadata

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events`
- WHEN `PATCH /me/company` is sent with a valid body and a matching `If-Unmodified-Since`
- AND the response is `200 OK`
- THEN `audit_events` has `N+1` rows, with one new row carrying `event_type='CompanyUpdated'`, `entity_type='company'`, `entity_id=<A>`, `actor_type='user'`, `actor_id=<CompanyContext.UserID>`, `metadata='{}'`

#### Scenario: DELETE success appends exactly one CompanyDeleted row with jobs_closed

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events` and `N_jobs` non-closed jobs at delete time (where `N_jobs` is the rowcount the adapter will return from `CloseCompanyJobs`)
- WHEN `DELETE /me/company` is sent with a matching `If-Unmodified-Since`
- AND the response is `204 No Content`
- THEN `audit_events` has `N+1` rows, with one new row carrying `event_type='CompanyDeleted'`, `entity_type='company'`, `entity_id=<A>`, `actor_type='user'`, `actor_id=<CompanyContext.UserID>`, `metadata='{"jobs_closed": "<N_jobs>"}'`

#### Scenario: DELETE on a company with no non-closed jobs still records jobs_closed="0"

- GIVEN an owner of company `A` whose inline `CloseCompanyJobs` UPDATE affected `0` rows (the company had no `draft` or `published` jobs at delete time)
- WHEN `DELETE /me/company` is sent with a matching `If-Unmodified-Since`
- AND the response is `204 No Content`
- THEN the `CompanyDeleted` event has `metadata={"jobs_closed": "0"}` (the key is always present — stable shape; the empty-inline-close case is a legitimate success path, not an error)

#### Scenario: jobs_closed is the stringified rowcount of CloseCompanyJobs

- GIVEN a successful `DELETE /me/company` whose inline `CloseCompanyJobs` UPDATE affected exactly `2` rows
- WHEN the `CompanyDeleted` event is built
- THEN `metadata.jobs_closed` is the string `"2"` (the integer rowcount converted via `strconv.Itoa`, not the bare integer and not the rowcount of the soft-delete write itself)

#### Scenario: PATCH 400 on VO rejection or malformed JSON appends zero audit rows

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events`
- WHEN `PATCH /me/company` is sent with a body that fails a value-object constructor (`CompanyNameTooShort` / `InvalidCompanySize` / `FoundedYearOutOfRange` / `CompanyDescriptionTooLong`) or with malformed JSON
- AND the response is `400 Bad Request`
- THEN `audit_events` has `N` rows (no new row appended; the use case never invoked `repo.UpdateCompany`)

#### Scenario: PATCH or DELETE 404 on not-found or cross-company appends zero audit rows

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events` and `A` either non-existent or cross-company (membership row pointing to a different company id than the request is scoped to)
- WHEN `PATCH /me/company` or `DELETE /me/company` is sent
- AND the response is `404 company not found`
- THEN `audit_events` has `N` rows (no new row appended; the read-for-update `GetCompanyForUpdate` failed BEFORE the adapter write)

#### Scenario: PATCH or DELETE 403 on tombstoned company appends zero audit rows

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events` and `A` already soft-deleted (`deleted_at IS NOT NULL`)
- WHEN `PATCH /me/company` or `DELETE /me/company` is sent
- AND the response is `403 Forbidden` with reason `company is inactive`
- THEN `audit_events` has `N` rows (no new row appended; `RequireCompanyRole`'s liveness gate short-circuits BEFORE the handler / use case / adapter runs — the audit append is never reached; the handler / repository `ErrCompanyNotFound` path is preserved as defense-in-depth but is unreachable for a tombstoned company in the production API)

#### Scenario: PATCH or DELETE 409 on CAS mismatch appends zero audit rows

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events`
- WHEN `PATCH /me/company` or `DELETE /me/company` is sent with a stale, missing, or malformed `If-Unmodified-Since`
- AND the response is `409 Conflict`
- THEN `audit_events` has `N` rows (no new row appended; the CAS compare in the use case failed BEFORE the adapter write — the audit append is not reached)

#### Scenario: PATCH lost-race appends zero audit rows

- GIVEN an owner of company `A` and a concurrent writer that bumped `A.updated_at` between use-case `GetCompanyForUpdate` and the SQL UPDATE
- WHEN `PATCH /me/company` is sent and the adapter `UpdateCompany` returns `updated == 0`
- THEN the use case maps the zero-row outcome to a `404` (or re-reads and maps to `409`); no audit append is attempted; `audit_events` row count is unchanged

#### Scenario: 401 or 403 short-circuits before the use case and appends zero audit rows

- GIVEN an unauthenticated `PATCH /me/company` or `DELETE /me/company` request (no `Authorization` header), OR an authenticated non-owner (recruiter — role `< owner`) member, OR an authenticated user with no `company_members` row, OR an authenticated owner whose `companies.deleted_at IS NOT NULL` (tombstoned)
- WHEN the request reaches the gated write route
- AND the response is `401 Unauthorized` or `403 Forbidden` (the tombstoned-company branch additionally carries reason `company is inactive`)
- THEN `audit_events` row count is unchanged (the middleware short-circuits BEFORE the handler / use case / adapter runs)

#### Scenario: uuid.Nil actor fails closed with 500 and appends zero audit rows

- GIVEN a request that reaches the use case with `userID == uuid.Nil` (a mis-wired route or middleware bypass)
- WHEN `PATCH /me/company` or `DELETE /me/company` would otherwise run
- THEN the use case returns `ErrMissingActorIdentity` as its FIRST step (before `GetCompanyForUpdate` and before the CAS compare); the handler classifier maps it to `500 internal server error`; no domain write happens; no audit append is attempted; `audit_events` row count is unchanged

#### Scenario: audit INSERT failure rolls back the domain write (fail-closed co-write)

- GIVEN the `audit_events` INSERT inside the co-write `pgx.Tx` fails mid-transaction
- WHEN `PATCH /me/company` or `DELETE /me/company` is sent
- THEN the deferred `tx.Rollback` aborts the domain write too; no `companies` row is mutated (PATCH) and no `companies.deleted_at` is set (DELETE), no `jobs.status` is changed (DELETE), and no `audit_events` row is visible after the failure; the response is `500 Internal Server Error`

#### Scenario: handler does not build the event; use case is the single source of truth

- GIVEN the companies HTTP handler for `PATCH /me/company` or `DELETE /me/company`
- WHEN the handler code is inspected
- THEN it does NOT construct an `auditentities.AuditEvent` value, does NOT call `audit.Append`, and does NOT carry an `actor_id` from the request body — it only passes `cc.UserID` and the request inputs to the use case, which builds the event and passes it to the repository port
