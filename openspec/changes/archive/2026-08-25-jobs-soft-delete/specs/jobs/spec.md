# Delta for Jobs

This delta adds a **soft-delete write path** `DELETE /jobs/{id}` to the existing gated write surface of the jobs slice. A successful DELETE sets `jobs.deleted_at = now()` (the tombstone) and `jobs.updated_at = now()` in a single SQL `UPDATE`; the row survives in the table for audit (the `deleted_at` timestamp IS the audit record), and the row is immediately invisible on every existing read path because the visibility predicate `status='published' AND deleted_at IS NULL AND companies.status='active'` already filters tombstoned rows. The change adds a `SoftDeleteJob` use case, a port extension (`JobRepository.SoftDelete`), a single new sqlc query (`SoftDeleteJob :one` with the atomic active-company CTE guard that `UpdateJob` already uses), a new handler, and one new gated route line on the composition root. The read side is unchanged; the existing 404 / CAS / active-company invariants are inherited verbatim. The change does NOT add a hard delete, a restore/undelete endpoint, a `deleted_by_user_id` column, a `deleted_reason` field, a deletion log table, candidate-side behavior, notification or event publishing, or a new migration. Re-open on a soft-deleted row stays `404` (the canonical `Re-Open Inherits CAS and Same-Company Invariants` requirement already pins this).

## Out of scope (deferred)

This delta does NOT cover: a hard delete / purge endpoint, a restore / undelete endpoint, a `deleted_by_user_id` column, a `deleted_reason` field, a deletion log table, notification or event publishing, candidate-side behavior (no impact on applicants), a `closed_at` or `reopened_at` column (audit trail lives in `published_at` + `updated_at` + the new `deleted_at`), a bulk DELETE endpoint, a feature-flag-gated rollout, a new migration, a new package, a new env var, or a `search_vector` write (the STORED column is naturally unchanged because its inputs `title` and `description` are not touched; the partial index `jobs_public_listing_idx` is automatically maintained by Postgres).

## ADDED Requirements

### Requirement: DELETE /jobs/{id} Endpoint, Gate, and Route Boundary

The system MUST expose `DELETE /jobs/{id}` as a gated write route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(recruiter)`. The handler MUST derive `company_id` exclusively from the `security.CompanyContext` injected by the middleware; the request carries no body and the path carries no `company_id`, so no client-supplied value is ever honored. Because `MemberRole` is ordinal and `owner ≥ recruiter`, an owner of the job's company MUST pass the gate. The handler MUST short-circuit fail-closed (return `500 internal server error`) if no `CompanyContext` is present on the request context. The request MUST NOT carry a body. On success the response MUST be `204 No Content` with an empty body — no editor view is projected because the post-delete row's `deleted_at` is not meaningful to surface back to the client and the canonical `Editor Response DTO` requirement scopes the editor view to write operations whose response body carries the row's `status` and `updated_at`. The required request headers are `Authorization: Bearer <jwt>` (RequireAuth) and `If-Unmodified-Since: <RFC 3339 timestamp>` (CAS — see Soft-Delete Concurrency Controls).

The gated `DELETE /jobs/{id}` route MUST be mounted on a per-route middleware subtree (for example, `r.With(requireAuth, requireRecruiter).Delete(...)`), separate from the public `Routes()` mount. A request without an `Authorization` header to `DELETE /jobs/{id}` MUST return `401`. The public `r.Mount("/jobs", ...)` MUST NOT serve `DELETE`; a request to the public mount with method `DELETE` MUST NOT be matched (the router returns `404 not found` because the gated subtree — not the public mount — is what serves the soft-delete route).

#### Scenario: recruiter can soft-delete a vacancy of their company

- GIVEN a recruiter membership in an `active` company `A` and a `draft` job owned by company `A` with `updated_at='T'`
- WHEN `DELETE /jobs/{id}` is sent with `If-Unmodified-Since: T`
- THEN the response is `204 No Content` with an empty body and the row's `deleted_at` is set within the request window

#### Scenario: owner passes the recruiter gate

- GIVEN an owner membership in an `active` company `A` and a job owned by company `A`
- WHEN `DELETE /jobs/{id}` is sent with `If-Unmodified-Since` matching the row's `updated_at`
- THEN the response is `204 No Content` (owner is treated as recruiter for this gate via the `MemberRole` ordinal)

#### Scenario: no Authorization header returns 401

- GIVEN a `DELETE /jobs/{id}` request with no `Authorization` header
- WHEN the request reaches the gated write route
- THEN the response is `401 unauthenticated` (RequireAuth short-circuit, not 404, not 403)

#### Scenario: authenticated but non-member returns 403

- GIVEN an authenticated user who is not a member of the job's owning company
- WHEN `DELETE /jobs/{id}` is sent
- THEN the response is `403 not a member / role too low` (RequireCompanyRole short-circuit; the handler is never reached)

#### Scenario: role too low returns 403

- GIVEN a `viewer` (or any role below `recruiter`) membership in the job's owning company
- WHEN `DELETE /jobs/{id}` is sent
- THEN the response is `403 not a member / role too low`

#### Scenario: invalid job id returns 400

- GIVEN a request to `DELETE /jobs/not-a-uuid`
- WHEN the request reaches the gated route
- THEN the response is `400 invalid job id` (the handler parses the path `{id}` as a UUID and rejects before any read-for-delete runs)

#### Scenario: response is 204 No Content with empty body on success

- GIVEN any successful soft-delete
- WHEN the response is inspected
- THEN the status is `204`, the body is empty, and no editor view is projected (the post-delete row's `deleted_at` is not surfaced)

#### Scenario: missing CompanyContext fails closed

- GIVEN a request that bypasses the middleware and reaches the handler with no `CompanyContext` on the request context
- WHEN the handler runs
- THEN the response is `500 internal server error` and no row is tombstoned

#### Scenario: DELETE is not reachable through the public mount

- GIVEN the composition root splits the public read mount from the gated write mount
- WHEN a `DELETE /jobs/{id}` request reaches the public mount
- THEN the route is not matched by the public mount and the gated subtree is the only path that serves the soft-delete (a structural separation that survives refactors of the composition root)

### Requirement: Soft-Delete Concurrency Controls

The soft-delete write MUST be governed by two concurrent-control surfaces, both additive to the existing canonical concurrency story.

The first surface is the `If-Unmodified-Since` CAS guard, mirroring the canonical `CAS Optimistic Concurrency` requirement verbatim: the system MUST require an `If-Unmodified-Since` request header carrying the client's last-known `updated_at` formatted as an RFC 3339 timestamp string; the server MUST compare the header value against the current `updated_at` loaded by the read-for-delete (the same `GetForUpdate` call the PATCH flow uses) inside the same write transaction; the comparison MUST be against the row, NOT against any value supplied by the client. A mismatch MUST yield `409 Conflict` and the response body MUST contain the latest version of the job (including its current `updated_at` and `status`) using the same editor view DTO the PATCH `200`/`409` bodies already use so the client can re-read without an extra round-trip. A missing or malformed `If-Unmodified-Since` header MUST be treated as a zero-valued token (RFC 3339 zero time) and MUST yield `409 Conflict` with the editor view. After a successful soft-delete, the row's `updated_at` advances exactly once in the same SQL statement that sets `deleted_at` so the next PATCH or DELETE the client sends against the row uses the fresh `updated_at` as its CAS token.

The second surface is the atomic active-company soft-delete gate, mirroring the canonical `Active-Company Update Gate` requirement verbatim: the active-company predicate MUST be enforced atomically inside the same SQL `UPDATE` statement that writes the tombstone (no read-then-write TOCTOU window between the gate middleware and the UPDATE). A non-active company (`status='suspended'` or `status='pending_verification'`) MUST yield the existing `entities.ErrCompanyNotActive` sentinel, and the HTTP layer MUST map that sentinel to `409 Conflict` with body `{"error":"company is not active"}` (reusing the `classifyError` branch added by `jobs-create`). A zero-row outcome on the SQL guard (whether the company is suspended, pending, or — defensively — missing) MUST surface as the same sentinel and the same `409 Conflict` response, and the row MUST NOT be tombstoned.

#### Scenario: matching updated_at allows the soft-delete

- GIVEN a job whose current `updated_at` is `T`
- WHEN `DELETE /jobs/{id}` is sent with `If-Unmodified-Since: T`
- THEN the response is `204 No Content` and the row is tombstoned within the request window

#### Scenario: stale updated_at returns 409 with latest editor view

- GIVEN a job whose current `updated_at` is `2026-02-02T11:00:00Z` (changed by another writer since the client last read it)
- WHEN `DELETE /jobs/{id}` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- THEN the response is `409 Conflict` and the body is the editor view of the row with `updated_at='2026-02-02T11:00:00Z'`

#### Scenario: missing If-Unmodified-Since returns 409 with editor view

- GIVEN a job
- WHEN `DELETE /jobs/{id}` is sent without an `If-Unmodified-Since` header
- THEN the response is `409 Conflict` and the body is the editor view of the latest row (zero-token mismatch against any non-zero row; `parseIfUnmodifiedSince` yields the zero value when the header is absent)

#### Scenario: malformed If-Unmodified-Since returns 409 with editor view

- GIVEN a job
- WHEN `DELETE /jobs/{id}` is sent with `If-Unmodified-Since: not-a-timestamp`
- THEN the response is `409 Conflict` and the body is the editor view of the latest row (the handler's `parseIfUnmodifiedSince` yields a zero token on a parse failure, the CAS compare mismatches, and `ErrConcurrencyConflict` is returned)

#### Scenario: CAS conflict is independent of company visibility

- GIVEN a job owned by company `A` with current `updated_at='2026-02-02T11:00:00Z'`
- AND a recruiter of company `A` sends `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- WHEN `DELETE /jobs/{id}` is sent
- THEN the response is `409 Conflict` (NOT `404`); the cross-company 404 is a different code path and the CAS compare runs before the cross-company filter would surface the row as not-found

#### Scenario: two concurrent writers, exactly one wins

- GIVEN a job whose current `updated_at` is `T`
- WHEN two recruiters of the same company send `DELETE /jobs/{id}` at the same time, both with `If-Unmodified-Since: T`
- THEN exactly one response is `204 No Content` and the other is `409 Conflict` with the latest editor view (the second caller's read-for-delete sees the row's advanced `updated_at` and the CAS compare fails before the tombstone write runs)

#### Scenario: soft-delete advances updated_at exactly once

- GIVEN a job with `updated_at='T'`
- WHEN `DELETE /jobs/{id}` succeeds
- THEN the row's `updated_at` advances to a value strictly greater than `T` and `deleted_at` is set within the same SQL statement (one statement, two columns set atomically — the next PATCH or DELETE the client issues MUST use the fresh `updated_at` as its CAS token)

#### Scenario: suspended company DELETE returns 409 company is not active

- GIVEN a recruiter membership in company `A` whose `companies.status='suspended'` and a job owned by company `A`
- WHEN `DELETE /jobs/{id}` is sent with a matching `If-Unmodified-Since`
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT tombstoned (the atomic SQL guard yields 0 rows; the adapter maps `GuardPassed=false` to `ErrCompanyNotActive`; `classifyError` returns `409 company is not active`)

#### Scenario: pending_verification company DELETE returns 409 company is not active

- GIVEN a recruiter membership in company `A` whose `companies.status='pending_verification'` and a job owned by company `A`
- WHEN `DELETE /jobs/{id}` is sent with a matching `If-Unmodified-Since`
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT tombstoned

#### Scenario: active company DELETE passes the gate

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and a job owned by company `A`
- WHEN `DELETE /jobs/{id}` is sent with a matching `If-Unmodified-Since`
- THEN the response is `204 No Content` (the SQL guard produces 1 row; the active predicate passes; the row is tombstoned within the request window)

#### Scenario: the active check is atomic with the UPDATE

- GIVEN the SQL guard encodes the active predicate in the same statement that writes the tombstone (the `WITH active AS (SELECT id FROM companies WHERE id = sqlc.arg('company_id')::uuid AND status = 'active') , upd AS (UPDATE jobs SET deleted_at = now(), updated_at = now() WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND updated_at = $3 AND EXISTS (SELECT 1 FROM active) RETURNING id) SELECT EXISTS (SELECT 1 FROM active) AS guard_passed, (SELECT count(*) FROM upd) AS deleted_count;` shape — mirroring `UpdateJob :one`)
- WHEN `DELETE /jobs/{id}` is sent for a job whose company is `active` at the middleware gate but is `suspended` immediately after the gate middleware resolves the membership
- THEN the SQL predicate STILL wins — the company was not active at UPDATE time, so the UPDATE yields 0 rows and the response is `409 Conflict` (no TOCTOU window between middleware and write)

### Requirement: Soft-Delete Eligibility, Audit, and Read-Side Invariants

A `DELETE /jobs/{id}` MUST succeed against a row in ANY current `status` (`draft`, `published`, or `closed`) subject to the existing gate (see DELETE /jobs/{id} Endpoint, Gate, and Route Boundary), the Soft-Delete Concurrency Controls, the existing same-company invariant (canonical `Same-Company Invariant and IDOR Defense`), and the existing re-open invariants (canonical `Re-Open Inherits CAS and Same-Company Invariants`). The SQL UPDATE MUST set ONLY `deleted_at = now()` and `updated_at = now()`; `published_at`, `title`, `description`, `status`, `work_mode`, `employment_type`, `seniority`, `location`, `salary_min`, `salary_max`, and `salary_currency` MUST be preserved as audit history (no other column is touched). The STORED `search_vector` is naturally unchanged because its inputs (`title`, `description`) are not touched; the partial index `jobs_public_listing_idx` (predicated on `deleted_at IS NULL`) MUST drop the row from the index automatically when `deleted_at` is set (Postgres maintains partial indexes on UPDATE).

A successful DELETE makes the row invisible on every read path immediately. The canonical `Read-Side Visibility Rule` and the canonical `GET /jobs/{id} hides non-visible jobs` scenario already pin this invariant; this delta does NOT modify the read side. Specifically: immediately after a successful DELETE, `GET /jobs/{id}` returns `404 job not found` and `GET /jobs` excludes the row from its listing (the existing `deleted_at IS NULL` predicate hides the row from both).

A second `DELETE /jobs/{id}` against a soft-deleted row MUST return `404 job not found` because `GetForUpdate`'s `deleted_at IS NULL` predicate filters the row out (the read-for-delete returns `ErrJobNotFound`, identical body shape to a non-existent id — no leak of existence, consistent with the canonical `soft-deleted id returns 404` scenario for PATCH). A `DELETE /jobs/{id}` against a row owned by another company MUST return `404 job not found` (same-company invariant; identical body shape to a non-existent id and to an already-soft-deleted id — three cases indistinguishable by design). A `PATCH /jobs/{id}` against a soft-deleted row (e.g., `{"status":"draft"}` or `{"status":"published"}`) MUST continue to return `404 job not found`; the canonical `re-open on a soft-deleted closed job returns 404 job not found` scenario already pins this and is unchanged by this delta. The `deleted_at` column IS the audit timestamp; no `deleted_by_user_id`, no `deleted_reason`, no `deletion_log` table is added.

#### Scenario: draft row is soft-deletable in one step

- GIVEN a job owned by company `A` with `status='draft'`, `published_at IS NULL`, and `updated_at='T'`
- WHEN a recruiter of company `A` sends `DELETE /jobs/{id}` with `If-Unmodified-Since: T`
- THEN the response is `204 No Content`, `deleted_at` is set within the request window, `status` remains `'draft'`, and `published_at` remains `NULL`

#### Scenario: published row is soft-deletable in one step

- GIVEN a job owned by company `A` with `status='published'`, `published_at='2026-01-15T12:00:00Z'`, and `updated_at='T'`
- WHEN a recruiter of company `A` sends `DELETE /jobs/{id}` with `If-Unmodified-Since: T`
- THEN the response is `204 No Content`, `deleted_at` is set, `status` remains `'published'`, and `published_at` remains `'2026-01-15T12:00:00Z'` (audit-history preserved)

#### Scenario: closed row is soft-deletable in one step

- GIVEN a job owned by company `A` with `status='closed'`, `published_at='2025-03-01T00:00:00Z'`, and `updated_at='T'`
- WHEN a recruiter of company `A` sends `DELETE /jobs/{id}` with `If-Unmodified-Since: T`
- THEN the response is `204 No Content`, `deleted_at` is set, `status` remains `'closed'`, and `published_at` remains `'2025-03-01T00:00:00Z'` (audit-history preserved)

#### Scenario: deleted_at is the audit timestamp and no other column is touched

- GIVEN a job owned by company `A` with `title='Old'`, `description='Old'`, `status='published'`, `published_at='2026-01-15T12:00:00Z'`, `location='Mexico City'`, `salary_min=1000`, `salary_max=2000`, `salary_currency='MXN'`, and `updated_at='T'`
- WHEN a recruiter of company `A` sends `DELETE /jobs/{id}` with `If-Unmodified-Since: T`
- THEN the row's `deleted_at` is set within the request window, `updated_at` advances exactly once, and every other column (`title`, `description`, `status`, `published_at`, `location`, `salary_min`, `salary_max`, `salary_currency`, `work_mode`, `employment_type`, `seniority`) is unchanged

#### Scenario: search_vector and partial index are naturally consistent after soft-delete

- GIVEN a published job with `title='Old title'`, `description='Old body'`, and a STORED `search_vector` computed from those values
- WHEN a recruiter soft-deletes the job via `DELETE /jobs/{id}`
- THEN the row's `search_vector` still reflects `'Old title' + 'Old body'` (the STORED column's inputs are not touched), and the partial index `jobs_public_listing_idx` automatically drops the row from the index because `deleted_at` is now non-NULL

#### Scenario: second DELETE on an already-soft-deleted row returns 404

- GIVEN a soft-deleted (`deleted_at IS NOT NULL`) job owned by company `A`
- WHEN a recruiter of company `A` sends `DELETE /jobs/{id}` with any `If-Unmodified-Since`
- THEN the response is `404 job not found` (the read-for-delete `GetForUpdate` returns `ErrJobNotFound` because its `deleted_at IS NULL` predicate filters the row out — same body shape as a non-existent id; consistent with the canonical `soft-deleted id returns 404` scenario for PATCH; the row's already-set `deleted_at` is not modified)

#### Scenario: cross-company DELETE returns 404

- GIVEN a non-soft-deleted job owned by company `B`
- WHEN a recruiter of company `A` sends `DELETE /jobs/{id}` with `If-Unmodified-Since` matching the row's `updated_at`
- THEN the response is `404 job not found` and the body shape is identical to a non-existent id (no leak of existence — the same-company invariant is unchanged by soft-delete; `GetForUpdate` returns `ErrJobNotFound`)

#### Scenario: non-existent id DELETE returns 404

- GIVEN a UUID that matches no row in the `jobs` table
- WHEN an authenticated recruiter of any company sends `DELETE /jobs/{id}`
- THEN the response is `404 job not found` (the read-for-delete returns `ErrJobNotFound`; the handler maps to `404`)

#### Scenario: PATCH re-open on a soft-deleted row returns 404 (cross-reference)

- GIVEN a soft-deleted row owned by company `A`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` with `{"status":"draft"}` or `{"status":"published"}` and a matching CAS token
- THEN the response is `404 job not found` (the canonical `re-open on a soft-deleted closed job returns 404 job not found` scenario already pins this — `GetForUpdate`'s `deleted_at IS NULL` predicate hides the row from the read-for-update; soft-delete is not relaxed by re-open)

#### Scenario: soft-deleted row is hidden from GET /jobs/{id} (cross-reference)

- GIVEN a row soft-deleted via a successful `DELETE /jobs/{id}`
- WHEN `GET /jobs/{id}` runs (with or without an `Authorization` header)
- THEN the response is `404` (the canonical `GET /jobs/{id} hides non-visible jobs` scenario already pins this — the existing `deleted_at IS NULL` predicate filters the row out; no read-side change ships in this slice)

#### Scenario: soft-deleted row is excluded from GET /jobs (cross-reference)

- GIVEN a row soft-deleted via a successful `DELETE /jobs/{id}`
- WHEN `GET /jobs` runs (with or without an `Authorization` header)
- THEN the row is not in the response listing (the canonical `draft, closed, soft-deleted, or non-active-company jobs are hidden` scenario already pins this — the existing `deleted_at IS NULL` predicate filters the row out; the partial index `jobs_public_listing_idx` drops it automatically)