# Delta for Companies

## ADDED Requirements

### Requirement: Public Company Create Endpoint

The system MUST expose `POST /companies` as an authenticated create route running behind `RequireAuth`. The creator subject MUST resolve exclusively from the JWT claims placed by `RequireAuth`; a missing subject (mis-wired middleware) MUST fail closed with `401` and no row written. The body MUST carry the required fields `name` (validated via `CompanyName`), `rfc` (validated via the RFC VO), and `industry_id` (non-empty — `ErrEmptyIndustry` pre-SQL), plus the optional profile fields `website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url` (each validated by its corresponding `valueobjects` constructor when present). On success the system MUST persist the company AND its founding owner `company_members` row (role `owner`) atomically in a single transaction — on any failure both writes roll back and neither row is visible — and MUST respond `201 Created` with the full creator record: `id`, `name`, `rfc`, `industry_id`, `status`, all supplied profile fields, `created_at`, and `updated_at` (the creator just submitted the record, so this shape is NOT redacted). A duplicate live RFC (collision on the partial unique index `companies_rfc_unique`) MUST be rejected with `409` and no row written.

#### Scenario: creator gets 201 with the full creator record

- GIVEN an authenticated user and a valid body with required fields and a subset of profile fields
- WHEN `POST /companies` is sent
- THEN the response is `201 Created` carrying `id`, `name`, `rfc`, `industry_id`, `status`, the supplied profile fields, `created_at`, and `updated_at`

#### Scenario: company and founding owner are created atomically

- GIVEN a valid `POST /companies` request
- WHEN the create succeeds
- THEN one `companies` row and one `company_members` row (the creator as `owner`) are persisted in the same transaction; a failure in either write leaves neither row visible

#### Scenario: invalid name, RFC, or empty industry_id is rejected pre-SQL

- GIVEN a body with an invalid `name`, an invalid `rfc`, or a blank `industry_id`
- WHEN `POST /companies` is sent
- THEN the response is `400` with the corresponding validation outcome, and no company or membership row is written

#### Scenario: duplicate live RFC is rejected

- GIVEN an existing live company with RFC `R`
- WHEN `POST /companies` is sent with `rfc = R`
- THEN the response is `409` and no second company row is created

#### Scenario: missing authenticated subject fails closed

- GIVEN a request that reaches the handler with no subject in context (middleware mis-wired)
- WHEN the handler runs
- THEN the response is `401` and no row is written

### Requirement: Public Company Read Endpoint

The system MUST expose `GET /companies/{id}` as a public, unauthenticated read. A non-UUID `{id}` MUST return `400`. The read MUST return the redacted public shape — `id`, `name`, `industry_id`, and the profile fields (`website`, `logo_url`, `description`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`) — and MUST NOT expose `rfc`, `status`, `deleted_at`, or timestamps. A missing or soft-deleted company (the read query filters `deleted_at IS NULL`) MUST return `404` with a body shape identical for both cases (no leak of existence). Any unexpected read failure MUST return `500` with the shared stable error envelope and the real error logged server-side.

#### Scenario: GET /companies/{id} returns the redacted public shape

- GIVEN a live company
- WHEN `GET /companies/{id}` is sent without authentication
- THEN the response is `200` carrying `id`, `name`, `industry_id`, and the profile fields, and `rfc`, `status`, `deleted_at`, `created_at`, and `updated_at` are NOT in the body

#### Scenario: missing and soft-deleted companies are indistinguishable 404s

- GIVEN a non-existent id OR a company with `deleted_at IS NOT NULL`
- WHEN `GET /companies/{id}` is sent
- THEN the response is `404` with the same body shape in both cases

#### Scenario: non-UUID id returns 400

- GIVEN `{id}` is not a valid UUID
- WHEN `GET /companies/{id}` is sent
- THEN the response is `400`

### Requirement: Atomic Active-Industry Create Gate

Company creation MUST succeed only when the supplied `industry_id` references an industry that exists AND has `active = true`, checked atomically inside the same SQL statement/transaction as the company INSERT (decision C2 — no read-then-write TOCTOU window). An unknown industry OR an inactive industry MUST reject the create with no row written and surface as `409` with the shared stable error envelope (code for the inactive/unknown-industry outcome per the canonical catalog). The FK alone MUST NOT be the enforcement mechanism: an existing but inactive industry row MUST NOT be selectable for a new company. The gate MUST run inside the bootstrap transaction so a failed gate rolls back the company AND owner-membership writes.

#### Scenario: active industry allows creation

- GIVEN an industry row with `active = true` and a valid create body referencing it
- WHEN `POST /companies` is sent
- THEN the response is `201 Created` and the row is persisted with that `industry_id`

#### Scenario: inactive industry is rejected atomically

- GIVEN an industry row that exists with `active = false`
- WHEN `POST /companies` is sent referencing it
- THEN the response is `409` with the stable error envelope and neither a `companies` row nor an owner `company_members` row is written

#### Scenario: unknown industry is rejected

- GIVEN an `industry_id` matching no `industries` row
- WHEN `POST /companies` is sent
- THEN the response is `409` (NOT a 500 FK leak) with the stable error envelope and no row is written

#### Scenario: deactivation racing the create cannot slip through

- GIVEN the industry is `active` when the handler starts but is set `active = false` before the INSERT commits
- WHEN `POST /companies` is sent
- THEN the atomic SQL predicate wins — the INSERT does not yield a company row for the now-inactive industry (no TOCTOU window between application check and write)

### Requirement: Companies Write-Surface Evidence Contract

The companies write surface MUST carry direct, executable evidence (test/evidence requirements naming acceptance semantics, not brittle helper details):

- W1 — the soft-delete close-rollback path MUST be exercised by a deterministic failure-injection test (injected transaction/query seam or transaction-local trigger with guaranteed cleanup, serial integration only) proving that a close failure rolls back the tombstone; the placeholder skip `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` MUST be replaced (no intentional skip survives — R4).
- W2/W3 — direct live-DB evidence for `CompanyRepository.Create` and `GetByID` adapters, plus PATCH coverage for missing and malformed `If-Unmodified-Since` CAS and a multi-field single-call update.
- W4/W5 — the `200` response body and the `409` envelope's `data` field MUST carry the same redacted company DTO (same schema and constructor); the `409`'s `error` and `code` are additional stable-envelope fields. Failed outcomes MUST be explicitly asserted to append ZERO audit rows.
- W6 — a true two-writer concurrent CAS race test MUST prove exactly one winner on both PATCH and DELETE.
- Constraint evidence — live tests MUST assert BOTH the SQLSTATE (`23514`) AND the named constraint identity for `companies_size_check` and `companies_founded_year_check`, with fixture cleanup/isolation.

All error outcomes named by this evidence MUST be emitted through the shared stable error envelope defined by `backend-runtime` (codes referenced by contract, not restated here).

#### Scenario: close-failure rollback is proven deterministically

- GIVEN the failure-injection seam (or transaction-local trigger) is armed so the inline jobs-close UPDATE fails
- WHEN `DELETE /me/company` is sent
- THEN the test proves the transaction rolls back (no `deleted_at` set, no job closed), the injection is cleaned up (no shared-schema mutation survives), and the test runs in serial integration with no skip

#### Scenario: direct live Create/GetByID adapter evidence exists

- GIVEN the companies integration suite
- WHEN it runs against a live database
- THEN `CompanyRepository.Create` and `CompanyRepository.GetByID` are each exercised directly (not only through the HTTP handler) with asserted persistence and read-back outcomes

#### Scenario: PATCH CAS degenerate inputs return 409 with the redacted view

- GIVEN `PATCH /me/company` sent with a missing OR malformed `If-Unmodified-Since` header
- WHEN the tests run
- THEN both cases yield `409` with the redacted public company shape, and a multi-field single-call update is proven to persist every supplied field while leaving others untouched

#### Scenario: redaction parity and zero-audit on failure are asserted

- GIVEN a successful `200` and a conflicting `409` on `PATCH /me/company`
- WHEN the response bodies are compared
- THEN the `200` response body and the `409` envelope's `data` field are the same redacted company DTO; the `409` additionally carries `error` and `code`; and for every failed outcome (400/403/404/409) the tests explicitly assert `audit_events` row count is unchanged

#### Scenario: true concurrent CAS race yields exactly one winner

- GIVEN two concurrent writers issuing `PATCH /me/company` (or `DELETE /me/company`) with the same `If-Unmodified-Since` token
- WHEN the race test runs against a live database
- THEN exactly one write wins (`200`/`204`) and the other receives `409`

#### Scenario: named constraints are asserted with SQLSTATE

- GIVEN insert attempts violating `companies_size_check` and `companies_founded_year_check`
- WHEN the constraint tests run
- THEN each test asserts both the `23514` SQLSTATE and the violated constraint's name, and cleans up its fixtures
