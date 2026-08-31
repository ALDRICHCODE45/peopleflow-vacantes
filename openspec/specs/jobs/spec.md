# Jobs Specification

Public, full-text searchable job board for `peopleflow-vacantes`. Read path: candidates browse published jobs from active companies. Gated write path: recruiters edit jobs via `PATCH /jobs/{id}`. The `jobs` table carries the full status domain (`draft → published → closed`), and only `published` rows are exposed on read.

## Out of scope (deferred)

This slice does NOT cover: notification or event publishing, `company_members` ownership, a recruiter subtree beyond the gated `POST /jobs`, `PATCH /jobs/{id}`, and `DELETE /jobs/{id}` write routes, frontend job board, production seed strategy, and currency conversion (FX). The gated write side IS delivered: `POST /jobs` creates a draft behind `RequireAuth` + `RequireCompanyRole(recruiter)` with an atomic live-company gate (`409` when the company is not active or is soft-deleted at INSERT time); `PATCH /jobs/{id}` performs partial field edits and publish/close/re-open transitions (re-open is allowed via `closed → {draft, published}`) via the gated endpoint, behind an atomic live-company update gate (`409` when the company is not active or is soft-deleted at UPDATE time) and CAS concurrency control; `DELETE /jobs/{id}` soft-deletes a row by setting `deleted_at = now()` (the tombstone — the row survives in the table for audit) via the gated endpoint, behind an atomic live-company soft-delete gate (`409` when the company is not active or is soft-deleted at UPDATE time) and CAS concurrency control — the read side is unchanged because the existing `deleted_at IS NULL` predicate already filters tombstoned rows from `GET /jobs` and `GET /jobs/{id}`; `PUT /jobs/{id}` is NOT part of this API. The dev seed (`00008_jobs_seed.sql`) ships ~6 published jobs as a developer convenience only — it is NOT a runtime requirement.

## ADDED Requirements

### Requirement: Public Read Endpoints

The system MUST expose `GET /jobs` (search/listing) and `GET /jobs/{id}` (detail) as public, unauthenticated endpoints. Neither MUST require an `Authorization` header; if present, it MUST be ignored. `GET /jobs/{id}` MUST return a published job or 404 for non-existent, draft, closed, soft-deleted, non-active-company, or soft-deleted-company jobs.

#### Scenario: GET /jobs is public

- GIVEN no `Authorization` header
- WHEN `GET /jobs` runs
- THEN response is 200 with the public listing

#### Scenario: GET /jobs/{id} returns a published job

- GIVEN a published job from an active company
- WHEN `GET /jobs/{id}` runs
- THEN response is 200 with that job

#### Scenario: GET /jobs/{id} hides non-visible jobs

- GIVEN a job with `status='draft'` OR `status='closed'` OR `deleted_at IS NOT NULL` OR owning company `status != 'active'` OR owning company `deleted_at IS NOT NULL`
- WHEN `GET /jobs/{id}` runs
- THEN response is 404

### Requirement: Read-Side Visibility Rule

A job MUST surface in read responses ONLY if ALL of: `jobs.status='published'`, `jobs.deleted_at IS NULL`, the related `companies.status='active'`, and the related `companies.deleted_at IS NULL`. The read path MUST NOT surface draft, closed, soft-deleted, non-active-company, or soft-deleted-company jobs in any response.

#### Scenario: visible job is listed

- GIVEN a job with `status='published'`, `deleted_at IS NULL`, owning company `status='active'` and `deleted_at IS NULL`
- WHEN `GET /jobs` runs
- THEN the job is in the response

#### Scenario: draft, closed, soft-deleted, non-active-company, or soft-deleted-company jobs are hidden

- GIVEN any of `status='draft'`, `status='closed'`, `deleted_at IS NOT NULL`, owning company `status != 'active'`, or owning company `deleted_at IS NOT NULL`
- WHEN `GET /jobs` runs
- THEN that job is not in the response

### Requirement: Jobs Schema Migration

`00007_jobs.sql` MUST create `jobs` (`id UUID PK` with no DB default — application generates UUID v7, `company_id UUID NOT NULL REFERENCES companies(id)`, `title TEXT NOT NULL`, `description TEXT NOT NULL`, `work_mode TEXT NOT NULL` constrained by `jobs_work_mode_check` to `'onsite'|'remote'|'hybrid'`, `employment_type TEXT NOT NULL` constrained by `jobs_employment_type_check` to `'full_time'|'part_time'|'contract'|'internship'`, `seniority TEXT NOT NULL` constrained by `jobs_seniority_check` to `'intern'|'junior'|'mid'|'senior'|'lead'`, `status TEXT NOT NULL DEFAULT 'draft'` constrained by `jobs_status_check` to `'draft'|'published'|'closed'`, `location TEXT NULL`, `salary_min INTEGER NULL`, `salary_max INTEGER NULL`, `salary_currency TEXT DEFAULT 'MXN'` constrained by `jobs_salary_currency_check` to `'USD'|'MXN'`, `published_at TIMESTAMPTZ NULL`, `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `deleted_at TIMESTAMPTZ NULL`). The table MUST include a STORED generated `search_vector tsvector` built as `setweight(to_tsvector('spanish', coalesce(title,'')), 'A') || setweight(to_tsvector('spanish', coalesce(description,'')), 'B')`, a GIN index `jobs_search_idx` on `search_vector`, a B-tree `jobs_company_id_idx`, and a partial index `jobs_public_listing_idx` on `published_at DESC` with predicate `WHERE status='published' AND deleted_at IS NULL`. `goose down` MUST drop the table and all indexes.

#### Scenario: up creates named objects

- GIVEN DB at `00006`
- WHEN `goose up` runs `00007`
- THEN `jobs`, all four CHECK constraints, `search_vector`, and all three indexes exist

#### Scenario: down drops table and indexes

- GIVEN `00007` applied
- WHEN `goose down` runs
- THEN `jobs` and its indexes are gone

#### Scenario: required fields reject NULL

- GIVEN the `jobs` table
- WHEN an INSERT with `title = NULL` OR `description = NULL` OR `work_mode = NULL` OR `seniority = NULL` OR `employment_type = NULL` is attempted
- THEN the DB rejects the row

#### Scenario: optional fields accept NULL and salary_currency defaults to MXN

- GIVEN the `jobs` table
- WHEN a row is inserted with `location`, `salary_min`, `salary_max`, and `salary_currency` omitted
- THEN the row is created with `salary_currency='MXN'` (default) and the other three fields NULL

### Requirement: Status Domain

Jobs MUST be born `status='draft'` (DB default). Only `status='published'` rows are exposed on read. The transitions (publish/close) and their endpoints are OUT of scope.

#### Scenario: default insert produces a draft

- GIVEN a row inserted without an explicit `status`
- WHEN the row is read
- THEN `status='draft'`

#### Scenario: only published rows are exposed on read

- GIVEN rows with `status IN ('draft', 'published', 'closed')`
- WHEN `GET /jobs` runs
- THEN only the `published` row is in the response

### Requirement: Full-Text Search

The `q` parameter on `GET /jobs` MUST be matched against the stored `search_vector` using `websearch_to_tsquery('spanish', $1)` (safe parser — never throws on malformed input). The system MUST order matching rows by `ts_rank(search_vector, q)` DESC. An empty or absent `q` MUST return all visible jobs (subject to filters).

#### Scenario: title hit is returned

- GIVEN a published job whose title contains "go"
- WHEN `GET /jobs?q=go` runs
- THEN the job is in the response

#### Scenario: description hit is returned

- GIVEN a published job whose description contains "kubernetes" and whose title does not
- WHEN `GET /jobs?q=kubernetes` runs
- THEN the job is in the response

#### Scenario: malformed q does not 500

- GIVEN a `q` value that would be invalid under `to_tsquery` (e.g., trailing `:`)
- WHEN `GET /jobs?q=<bad>` runs
- THEN response is 200

#### Scenario: title hits outrank description hits

- GIVEN one job whose title contains "go" and another whose description only contains "go"
- WHEN `GET /jobs?q=go` runs
- THEN the title-match job appears before the description-match job

#### Scenario: missing q returns all visible jobs

- GIVEN visible published jobs
- WHEN `GET /jobs` runs (no `q`)
- THEN response lists all visible jobs (filtered only by other query params)

### Requirement: Listing Filters

`GET /jobs` MUST accept these optional filters: `seniority`, `work_mode`, `employment_type`, `location`, `currency`. Filters MUST combine with AND. Unknown query params or invalid filter values MUST be ignored (no 400). The `currency` filter MUST match `salary_currency` exactly — no cross-currency conversion.

#### Scenario: single filter narrows results

- GIVEN visible jobs across multiple seniorities
- WHEN `GET /jobs?seniority=senior` runs
- THEN response contains only jobs with `seniority='senior'`

#### Scenario: combined filters use AND

- GIVEN visible jobs across `seniority` and `work_mode`
- WHEN `GET /jobs?seniority=senior&work_mode=remote` runs
- THEN response contains only jobs matching both filters

#### Scenario: unknown query param is ignored

- GIVEN a request with `?foo=bar`
- WHEN `GET /jobs` runs
- THEN response is 200 and the param has no effect

#### Scenario: invalid filter value is ignored

- GIVEN a request with `?seniority=expert`
- WHEN `GET /jobs` runs
- THEN response is 200 and `seniority` is treated as unfiltered

#### Scenario: currency filter is exact match

- GIVEN a USD job and an MXN job
- WHEN `GET /jobs?currency=USD` runs
- THEN response contains only the USD job (no FX conversion)

### Requirement: Keyset Pagination

`GET /jobs` MUST paginate with keyset (cursor) pagination on the 3-tuple `(ts_rank, published_at, id)` ordered DESC, matching the `ORDER BY` of the listing query. The cursor is opaque to the client (base64url JSON) and carries the same three components.

The `ts_rank` component MUST be omitted from the cursor in browse mode (no `q`), where it is substituted with `0`. Because `ts_rank` against an empty tsquery is `0` for every row, the comparator degenerates to the 2-tuple `(published_at, id)` and browse-mode ordering is unchanged.

When more rows exist, the response MUST include a `next_cursor`; the client MAY pass `cursor` to fetch the next page. Rows with identical `published_at` MUST be tie-broken by `id` DESC, and rows with identical `ts_rank` MUST fall through to `(published_at, id)` DESC. Pagination MUST be stable (no row duplication or loss across calls).

#### Scenario: first page returns a cursor

- GIVEN more visible rows than the page size
- WHEN `GET /jobs` runs
- THEN response includes a `next_cursor` referencing the last row of the page

#### Scenario: cursor advances the page

- GIVEN a `next_cursor` from a previous page
- WHEN `GET /jobs?cursor=<cursor>` runs
- THEN response is the next page with no overlap

#### Scenario: search-mode pagination is stable across rank ties

- GIVEN a `q` whose matching rows all score the same `ts_rank`
- WHEN every page is walked via `next_cursor` until it is absent
- THEN each matching row is returned exactly once, in the same order a single unpaginated query produces

#### Scenario: cursor past the end returns empty

- GIVEN a cursor that matches no row
- WHEN `GET /jobs?cursor=<cursor>` runs
- THEN response is 200 with an empty list and no `next_cursor`

### Requirement: Enum Invariants

The `jobs` table MUST enforce the CHECK constraints: `work_mode IN ('onsite','remote','hybrid')`, `employment_type IN ('full_time','part_time','contract','internship')`, `seniority IN ('intern','junior','mid','senior','lead')`, `salary_currency IN ('USD','MXN')`. The DB MUST NOT accept a row with an out-of-enum value.

#### Scenario: work_mode rejects invalid values

- GIVEN the `jobs` table
- WHEN an INSERT with `work_mode='telecommute'` is attempted
- THEN the DB rejects the row with a CHECK violation

#### Scenario: seniority rejects invalid values

- GIVEN the `jobs` table
- WHEN an INSERT with `seniority='principal'` is attempted
- THEN the DB rejects the row with a CHECK violation

#### Scenario: employment_type rejects invalid values

- GIVEN the `jobs` table
- WHEN an INSERT with `employment_type='freelance'` is attempted
- THEN the DB rejects the row with a CHECK violation

#### Scenario: salary_currency rejects invalid values

- GIVEN the `jobs` table
- WHEN an INSERT with `salary_currency='EUR'` is attempted
- THEN the DB rejects the row with a CHECK violation

### Requirement: PATCH /jobs/{id} Endpoint and Gate

The system MUST expose `PATCH /jobs/{id}` as a gated write route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(recruiter)`. The handler MUST derive `company_id` exclusively from the `security.CompanyContext` injected by the middleware; any `company_id` value supplied in the request body or path MUST be ignored. Because `MemberRole` is ordinal and `owner ≥ recruiter`, an owner of the job's company MUST pass the gate. The handler MUST short-circuit fail-closed (return `500 internal`) if no `CompanyContext` is present on the request context. On success the response MUST be the editor view described in the editor response DTO requirement.

#### Scenario: recruiter can edit a vacancy of their company

- GIVEN a recruiter membership in company `A` and a job owned by company `A` with `status='draft'`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `200` with the editor view

#### Scenario: owner passes the recruiter gate

- GIVEN an owner membership in company `A` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `200` (owner is treated as recruiter for this gate)

#### Scenario: no Authorization header returns 401

- GIVEN a `PATCH /jobs/{id}` request with no `Authorization` header
- WHEN the request reaches the gated write route
- THEN the response is `401 unauthenticated`

#### Scenario: non-member returns 403

- GIVEN an authenticated user who is not a member of the job's owning company
- WHEN `PATCH /jobs/{id}` is sent
- THEN the response is `403`

#### Scenario: company_id from body is ignored

- GIVEN a recruiter membership in company `A` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with `{"company_id":"<uuid-of-company-B>"}` in the body
- THEN the write targets the row owned by company `A` from `CompanyContext`, not the value in the body

### Requirement: Field Editability Matrix

The PATCH body MUST treat fields as partial: a field absent from the JSON payload MUST NOT be touched on the server. The editable set, nullability, and immutability rules MUST be as follows.

| Field | Editable | Nullable | Wire presence |
|---|---|---|---|
| `id`, `company_id`, `created_at`, `updated_at`, `published_at`, `deleted_at`, `search_vector` | NO | n/a | n/a |
| `title`, `description` | YES | NO | required-if-present, MUST be non-empty |
| `work_mode`, `employment_type`, `seniority`, `salary_currency` | YES | NO | required-if-present, MUST parse as a known VO |
| `location`, `salary_min`, `salary_max` | YES | YES | optional; `null` clears the value, absent leaves it unchanged |
| `status` | YES (transition only — see the status transition table requirement) | NO | optional |

For the explicitly nullable fields (`location`, `salary_min`, `salary_max`), the system MUST distinguish `null` (present and JSON `null`, meaning "clear the value") from absent (field omitted from the JSON, meaning "do not touch"). Any immutable field present in the request body MUST be ignored by the server.

#### Scenario: absent fields are not touched

- GIVEN a job with `title='Old'` and `description='Old body'`
- WHEN `PATCH /jobs/{id}` is sent with `{"description":"New body"}`
- THEN `title` remains `'Old'` and `description` becomes `'New body'`

#### Scenario: explicit null clears location

- GIVEN a job with `location='Mexico City'`
- WHEN `PATCH /jobs/{id}` is sent with `{"location":null}`
- THEN the row's `location` is `NULL`

#### Scenario: absent location leaves existing value intact

- GIVEN a job with `location='Mexico City'`
- WHEN `PATCH /jobs/{id}` is sent with no `location` key in the body
- THEN `location` remains `'Mexico City'`

#### Scenario: immutable fields in body are ignored

- GIVEN any job
- WHEN `PATCH /jobs/{id}` is sent with `{"id":"<other-uuid>","company_id":"<other-uuid>","created_at":"...","published_at":"...","search_vector":"..."}`
- THEN the row's immutable fields remain unchanged

#### Scenario: salary_min absent leaves existing value intact

- GIVEN a job with `salary_min=1000`
- WHEN `PATCH /jobs/{id}` is sent with `{"salary_max":2000}` and no `salary_min` key
- THEN `salary_min` remains `1000` and `salary_max` becomes `2000`

### Requirement: Status Transition Table

(Previously: every transition out of `closed` was illegal; the table marked `closed → {draft, published}` as `NO → 400`, and the requirement carried a `closed is terminal` scenario that rejected ANY body on a closed row. This delta lifts `closed → {draft, published}` to `YES`, tightens the wording for the `published_at` write to match the audit-history policy, and removes the obsolete `closed is terminal` scenario; the remaining seven scenarios and the integrity-guard sentence are unchanged.)

The `status` field on PATCH MUST obey the following transition matrix; every illegal transition MUST return `400 invalid status transition`. When `status` is absent from the request body, the transition table MUST NOT apply and the field MUST be left untouched.

| Current `status` | Requested `status` | Allowed | Side effect |
|---|---|---|---|
| `draft` | `draft` | YES | Field-only edit; no `published_at` change. |
| `draft` | `published` | YES | Server MUST set `published_at = COALESCE(published_at, now())` in the same SQL UPDATE; on a fresh draft (`published_at IS NULL`) this resolves to `now()`; on a re-open (`closed → published` from a row that was previously published) this preserves the row's prior `published_at` (audit-history policy). |
| `draft` | `closed` | NO | `400`. |
| `published` | `draft` | NO | `400` — no un-publish in this change. |
| `published` | `published` | YES | Field-only edit; `published_at` preserved; `search_vector` regenerates via the STORED column. |
| `published` | `closed` | YES | `published_at` is preserved as audit history. |
| **`closed`** | **`draft`** | **YES (NEW — re-open)** | **Transition + field edits in the same call MUST apply atomically. `published_at` is preserved as audit history (the column is left unchanged by the SQL `ELSE` branch).** |
| **`closed`** | **`published`** | **YES (NEW — re-open)** | **Transition + field edits in the same call MUST apply atomically. `published_at` is preserved (audit-history policy — the existing `COALESCE(published_at, now())` branch already encodes "preserve on re-publish to published"; no SQL change for the timestamp).** |
| `closed` | `closed` | NO | `400` — no-op transition on a closed row is a pointless write. |

The DB integrity guard `CHECK (status <> 'published' OR published_at IS NOT NULL)` MUST continue to hold: when the patch sets `status='published'`, the same SQL UPDATE MUST also set `published_at = COALESCE(published_at, now())` atomically (one statement, not two writes). For a fresh draft this resolves to `now()`; for a re-open of a previously-published row, the original `published_at` is preserved.

#### Scenario: draft → published sets published_at now

- GIVEN a job with `status='draft'` and `published_at IS NULL`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"published"}`
- THEN the response is `200` and the row's `status='published'` and `published_at` is within the request window

#### Scenario: published → closed preserves published_at

- GIVEN a job with `status='published'` and `published_at='2026-01-15T12:00:00Z'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"closed"}`
- THEN `status='closed'` and `published_at` remains `'2026-01-15T12:00:00Z'`

#### Scenario: status + field mix applies atomically

- GIVEN a job with `status='draft'` and `title='Old'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"published","title":"New"}`
- THEN the response is `200` and the row's `status='published'`, `title='New'`, and `published_at` is set within the request window

#### Scenario: published field-only edit preserves published_at

- GIVEN a job with `status='published'`, `published_at='2026-01-10T00:00:00Z'`, and `description='Old'`
- WHEN `PATCH /jobs/{id}` is sent with `{"description":"New"}` and no `status`
- THEN `description='New'`, `status` remains `'published'`, and `published_at` remains `'2026-01-10T00:00:00Z'`

#### Scenario: published → draft is rejected

- GIVEN a job with `status='published'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"draft"}`
- THEN the response is `400`

#### Scenario: draft → closed is rejected

- GIVEN a job with `status='draft'`
- WHEN `PATCH /jobs/{id}` is sent with `{"status":"closed"}`
- THEN the response is `400`

#### Scenario: closed → draft re-open is allowed (NEW — replaces the obsolete "closed is terminal" scenario)

- GIVEN a job with `status='closed'`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `200` with the editor view (the transition is legal under this delta)

#### Scenario: closed → published re-open is allowed (NEW — replaces the obsolete "closed is terminal" scenario)

- GIVEN a job with `status='closed'` and `published_at='2025-03-01T00:00:00Z'`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published"}` and a matching CAS token
- THEN the response is `200` and `published_at` remains `'2025-03-01T00:00:00Z'` (audit-history policy)

#### Scenario: status-only PATCH is allowed

- GIVEN a job with `status='draft'`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published"}` and no other field
- THEN the response is `200` with the editor view

### Requirement: CAS Optimistic Concurrency

The system MUST require an `If-Unmodified-Since` request header carrying the client's last-known `updated_at` formatted as an RFC 3339 timestamp string. The server MUST compare the header value against the current `updated_at` loaded by a fresh read of the row inside the same write transaction; the comparison MUST be against the row, NOT against any value in the patch body. A mismatch MUST yield `409 Conflict` and the response body MUST contain the latest version of the job (including its current `updated_at` and `status`) so the client can re-read without an extra round-trip. The body of the `409` MUST use the same editor view DTO as a successful `200`.

#### Scenario: matching updated_at allows the write

- GIVEN a job whose current `updated_at` is `2026-02-01T10:00:00Z`
- WHEN `PATCH /jobs/{id}` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- THEN the write succeeds and the response is `200`

#### Scenario: stale updated_at returns 409 with latest version

- GIVEN a job whose current `updated_at` is `2026-02-02T11:00:00Z` (changed by another writer)
- WHEN `PATCH /jobs/{id}` is sent with `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- THEN the response is `409` and the body is the editor view of the row with `updated_at='2026-02-02T11:00:00Z'`

#### Scenario: missing If-Unmodified-Since returns 409

- GIVEN a job
- WHEN `PATCH /jobs/{id}` is sent without an `If-Unmodified-Since` header
- THEN the response is `409`

#### Scenario: CAS conflict is independent of company visibility

- GIVEN a job owned by company `A` with current `updated_at='2026-02-02T11:00:00Z'`
- AND a recruiter of company `A` sends `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- WHEN `PATCH /jobs/{id}` is sent
- THEN the response is `409` (NOT `404`); the cross-company 404 is a different code path

#### Scenario: two concurrent writers, exactly one wins

- GIVEN a job whose current `updated_at` is `T`
- WHEN two recruiters send `PATCH /jobs/{id}` at the same time, both with `If-Unmodified-Since: T`
- THEN exactly one response is `200` and the other is `409` with the latest version in the body

### Requirement: Domain Validation Rules

The use case MUST enforce the following rules in the domain layer (no DB guard is added in this change): `title` and `description`, when present in the patch, MUST be non-empty after trimming; `salary_min` and `salary_max`, when both present and non-null, MUST satisfy `salary_min ≤ salary_max`; VO fields (`work_mode`, `employment_type`, `seniority`, `salary_currency`, and `status`) MUST parse via their respective `Parse…` functions and MUST be rejected when unknown. Failure of any rule MUST yield `400 validation`.

#### Scenario: empty title is rejected

- GIVEN a job
- WHEN `PATCH /jobs/{id}` is sent with `{"title":"   "}`
- THEN the response is `400`

#### Scenario: empty description is rejected

- GIVEN a job
- WHEN `PATCH /jobs/{id}` is sent with `{"description":""}`
- THEN the response is `400`

#### Scenario: salary_min greater than salary_max is rejected

- GIVEN a job
- WHEN `PATCH /jobs/{id}` is sent with `{"salary_min":10000,"salary_max":5000}`
- THEN the response is `400`

#### Scenario: unknown work_mode is rejected

- GIVEN a job
- WHEN `PATCH /jobs/{id}` is sent with `{"work_mode":"telecommute"}`
- THEN the response is `400`

#### Scenario: unknown salary_currency is rejected

- GIVEN a job
- WHEN `PATCH /jobs/{id}` is sent with `{"salary_currency":"EUR"}`
- THEN the response is `400`

### Requirement: Same-Company Invariant and IDOR Defense

The write path MUST scope every read and write by the `company_id` from `CompanyContext`. A job that exists but belongs to another company MUST surface as `404 job not found` — identical to the existing same-company pattern in the `companies` slice. The system MUST NOT return `403 forbidden` for cross-company access (that would leak the row's existence); the system MUST NOT return any body hint that the row exists in another company. A soft-deleted row (`deleted_at IS NOT NULL`) and a non-existent id MUST also surface as `404 job not found` with the same body shape. A row owned by a soft-deleted (tombstoned) company — `companies.deleted_at IS NOT NULL`, regardless of the company's `status`, because `SoftDeleteCompany` preserves `status='active'` and only sets the tombstone — is rejected with `403 Forbidden` from `RequireCompanyRole`'s liveness gate BEFORE the handler runs (a tombstoned member company never reaches the SQL same-company read); the write-path SQL `GetForUpdate` and atomic live-company guard remain in place as defense-in-depth for a bypassed or mis-wired call (the SQL guard would surface as `404 job not found` / `ErrJobNotFound` in that edge case, but the production API MUST NOT reach it for a tombstoned member company). The write-path read (`GetForUpdate`) MUST NOT surface the editor view of a row owned by a tombstoned company (write-side hardening, mirroring the read-side `companies.deleted_at IS NULL` predicate).

#### Scenario: cross-company id returns 404

- GIVEN a job owned by company `B`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` for that job with a valid CAS token
- THEN the response is `404` and the body shape is identical to a non-existent id

#### Scenario: soft-deleted id returns 404

- GIVEN a soft-deleted job (`deleted_at IS NOT NULL`) owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent by a recruiter of company `A`
- THEN the response is `404`

#### Scenario: row of a soft-deleted company returns 403

- GIVEN a job owned by company `A` whose `companies.status='active'` and `companies.deleted_at IS NOT NULL` (tombstoned)
- WHEN `PATCH /jobs/{id}` or `DELETE /jobs/{id}` is sent by a recruiter of company `A`
- THEN the response is `403 Forbidden` with reason `company is inactive` from `RequireCompanyRole`'s liveness gate — the handler is NEVER invoked and the SQL `GetForUpdate` is NEVER reached; the SQL `c.deleted_at IS NULL` predicate and `ErrJobNotFound` mapping are preserved as defense-in-depth for a bypassed or mis-wired call but the production API MUST NOT reach them for a tombstoned member company

#### Scenario: non-existent id returns 404

- GIVEN a UUID that matches no row
- WHEN `PATCH /jobs/{id}` is sent by an authenticated recruiter of any company
- THEN the response is `404`

### Requirement: Editor Response DTO

The PATCH response body MUST be a dedicated editor view (named `JobEditorView` or equivalent) that includes `status` and `updated_at` in addition to the fields the public read item carries. The system MUST NOT modify `SearchJobsItem` to expose `status` or `updated_at`; the editor view is a separate DTO. The `409 Conflict` body MUST carry the same editor view shape so a re-read after conflict returns the same fields. The public read responses (`GET /jobs`, `GET /jobs/{id}`) MUST remain unchanged.

#### Scenario: PATCH 200 body carries status and updated_at

- GIVEN a job
- WHEN `PATCH /jobs/{id}` succeeds
- THEN the response body includes the job's `status` and the new `updated_at`

#### Scenario: 409 body carries the latest version

- GIVEN a CAS conflict on a job
- WHEN the response is returned
- THEN the body is the editor view of the latest row, including `updated_at` and `status`

#### Scenario: public read response is unchanged

- GIVEN the existing public read slice
- WHEN `GET /jobs` and `GET /jobs/{id}` are exercised
- THEN those responses continue to omit `status` and `updated_at`

### Requirement: Write Route Security Boundary

The gated `PATCH /jobs/{id}` route MUST be mounted on a per-route middleware subtree (for example, `r.With(requireAuth, requireRecruiter).Patch(...)`), separate from the public `Routes()` mount. A request without an `Authorization` header to `PATCH /jobs/{id}` MUST return `401`. The public mount MUST NOT gain the write route, including after refactors of the composition root; a request to the public mount with method `PATCH` MUST NOT be matched.

#### Scenario: unauthenticated PATCH returns 401

- GIVEN a `PATCH /jobs/{id}` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` (not `404`, not `403`)

#### Scenario: PATCH is not reachable through the public mount

- GIVEN the composition root splits the public read mount from the gated write mount
- WHEN a `PATCH /jobs/{id}` request reaches the public mount
- THEN the route is not matched and the response is `404 not found` from the router (the gated route, not the public one, serves the write)

### Requirement: Error Taxonomy

(Previously: the `PATCH /jobs/{id}` error taxonomy did not include an active-company branch; `ErrCompanyNotActive` and its `409 company is not active` mapping existed only for `POST /jobs`. This delta adds one new `409` row to the taxonomy so the new atomic active-company update gate (see `Active-Company Update Gate`) classifies correctly; every other outcome and the three scenarios below are unchanged.)

The HTTP layer MUST classify PATCH errors into the following status codes. The body MUST carry enough information for the client to surface a useful message. Classification MUST NOT leak row existence beyond the `404` / `409` cases pinned by the same-company invariant and CAS requirements.

| Outcome | HTTP status | Body |
|---|---|---|
| `{id}` is not a valid UUID | `400 invalid job id` | error message |
| Status transition is illegal | `400 invalid status transition` | error message naming the offending transition |
| Unknown VO, empty `title` / `description`, or `salary_min > salary_max` | `400 validation` | error message naming the failing field |
| No `Authorization` header / unverifiable token | `401 unauthenticated` | error message |
| Authenticated but not a member of the job's owning company, or role too low | `403 not a member / role too low` | error message |
| Row does not exist for the caller's company (cross-company, soft-deleted JOB, or non-existent). The `403` for a tombstoned member company is a separate row above — it is intercepted by `RequireCompanyRole`'s liveness gate BEFORE the handler runs and never reaches this 404 | `404 job not found` | error message |
| `If-Unmodified-Since` mismatches the row's current `updated_at` (or header missing) | `409 conflict` | editor view of the latest row |
| **Owning company is not `active` at the moment of the `UPDATE` (suspended, `pending_verification`, or 0 rows on the atomic SQL guard — applies to ALL `PATCH /jobs/{id}` writes, not only re-open). For a tombstoned member company (`deleted_at IS NOT NULL`), `RequireCompanyRole`'s liveness gate intercepts BEFORE the handler runs with `403 Forbidden` reason `company is inactive`; the `409 company is not active` row is defense-in-depth for a bypassed middleware (suspended / pending) and is unreachable for tombstoned in the production API.** | **`409 company is not active`** | **error message (`ErrCompanyNotActive` — reuses the `classifyError` branch added by `jobs-create`)** |
| Anything else | `500 internal` | error message |

#### Scenario: invalid job id returns 400

- GIVEN a request to `PATCH /jobs/not-a-uuid`
- WHEN the request reaches the gated route
- THEN the response is `400`

#### Scenario: 404 is identical for cross-company and non-existent

- GIVEN a recruiter of company `A`
- WHEN `PATCH /jobs/<id-of-company-B>` is sent and `PATCH /jobs/<random-uuid>` is sent
- THEN both responses are `404` with the same body shape (no leak of existence)

#### Scenario: 409 carries the latest editor view

- GIVEN a CAS conflict
- WHEN the response is returned
- THEN the body is the editor view of the latest row (the same shape as a `200` response)

#### Scenario: 409 for a suspended/pending company carries "company is not active"

- GIVEN a recruiter of company `A` whose `companies.status='suspended'` (or `'pending_verification'`) and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT updated (the atomic SQL guard yields 0 rows; `mapUpdateError` maps the guard miss to `ErrCompanyNotActive`; `classifyError` returns `409 company is not active`; the liveness gate does NOT catch `suspended` / `pending_verification` because `status` is not `active` only — only tombstoned companies are caught by the liveness gate with `403 company is inactive`)

#### Scenario: 403 for a tombstoned company carries "company is inactive" (middleware, NEW)

- GIVEN a recruiter of company `A` whose `companies.status='active'` and `companies.deleted_at IS NOT NULL` (tombstoned) and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `403 Forbidden` with reason `company is inactive` and the row is NOT updated — `RequireCompanyRole`'s liveness gate short-circuits BEFORE the handler runs and BEFORE the atomic SQL guard; the `409 company is not active` SQL guard remains as defense-in-depth for a bypassed or mis-wired call but the production API MUST NOT reach it for a tombstoned member company

### Requirement: Job Creation Endpoint

The system MUST expose `POST /jobs` as a gated write route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(recruiter)`. The handler MUST derive `company_id` exclusively from the `security.CompanyContext` injected by the middleware; any `company_id` value supplied in the request body or path MUST be ignored. Because `MemberRole` is ordinal and `owner ≥ recruiter`, an owner of the company MUST pass the gate. The handler MUST short-circuit fail-closed (return `500 internal server error`) if no `CompanyContext` is present on the request context. On success the response MUST be the create response described in the Create Response requirement (`201 Created` with the full editor view).

#### Scenario: recruiter creates a draft via POST /jobs

- GIVEN a recruiter membership in an `active` company `A`
- AND a request body carrying every required field (`title`, `description`, `work_mode`, `employment_type`, `seniority`) and any subset of optional fields
- WHEN `POST /jobs` is sent
- THEN the response is `201 Created` and the body is the editor view of the freshly-created row with `status='draft'` and a server-side `updated_at`

#### Scenario: owner passes the recruiter gate

- GIVEN an owner membership in an `active` company `A`
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `201 Created` (owner is treated as recruiter for this gate)

#### Scenario: no Authorization header returns 401

- GIVEN a `POST /jobs` request with no `Authorization` header
- WHEN the request reaches the gated write route
- THEN the response is `401 unauthenticated` (not `404`, not `403`)

#### Scenario: authenticated but non-member returns 403

- GIVEN an authenticated user who is not a member of any company OR is a member with a role below `recruiter`
- WHEN `POST /jobs` is sent
- THEN the response is `403` and the handler is never reached (the middleware short-circuits)

#### Scenario: company_id from body is ignored

- GIVEN a recruiter membership in company `A`
- WHEN `POST /jobs` is sent with `{"title":"...","description":"...","work_mode":"remote","employment_type":"full_time","seniority":"senior","company_id":"<uuid-of-company-B>"}`
- THEN the new row's `company_id` is the company `A` id from `CompanyContext`, not the value in the body

#### Scenario: missing CompanyContext fails closed

- GIVEN a request that bypasses the middleware and reaches the handler with no `CompanyContext` on the request context
- WHEN the handler runs
- THEN the response is `500 internal server error` and no row is inserted

### Requirement: Create Field Set

The `POST /jobs` body MUST carry exactly the fields below. The system MUST reject with `400` any field whose presence and shape violate the table. The server MUST ignore any field not in the table; in particular the body MUST NOT carry `id`, `company_id`, `status`, `created_at`, `updated_at`, `published_at`, `deleted_at`, or `search_vector`, and the presence of any such field MUST NOT affect the create.

| Field | Required in body | Wire type | Default on absent |
|---|---|---|---|
| `title` | YES | non-empty `string` | — (`400` if absent or empty after trim) |
| `description` | YES | non-empty `string` | — (`400` if absent or empty after trim) |
| `work_mode` | YES | `string` parsed as `WorkMode` VO | — (`400` if unknown VO) |
| `employment_type` | YES | `string` parsed as `EmploymentType` VO | — (`400` if unknown VO) |
| `seniority` | YES | `string` parsed as `Seniority` VO | — (`400` if unknown VO) |
| `location` | NO | `*string` | SQL `NULL` |
| `salary_min` | NO | `*int` | SQL `NULL` |
| `salary_max` | NO | `*int` | SQL `NULL` |
| `salary_currency` | NO | `*string` | `'MXN'` |

#### Scenario: required fields are written to the row

- GIVEN a recruiter of an active company `A`
- WHEN `POST /jobs` is sent with valid required fields and no optional fields
- THEN the new row carries the supplied `title`, `description`, `work_mode`, `employment_type`, and `seniority`

#### Scenario: absent optional fields become NULL

- GIVEN a recruiter of an active company `A`
- WHEN `POST /jobs` is sent with only required fields (no `location`, `salary_min`, `salary_max`, `salary_currency`)
- THEN the new row has `location IS NULL`, `salary_min IS NULL`, `salary_max IS NULL`, and `salary_currency='MXN'`

#### Scenario: salary_currency absent defaults to MXN

- GIVEN a recruiter of an active company `A`
- WHEN `POST /jobs` is sent without `salary_currency` in the body
- THEN the new row's `salary_currency` is `'MXN'`

#### Scenario: server-managed fields are not in the DTO

- GIVEN any `POST /jobs` request
- WHEN the handler decodes the body
- THEN `id`, `company_id`, `status`, `created_at`, `updated_at`, `published_at`, `deleted_at`, and `search_vector` are not part of the input shape and any values supplied for them by the client MUST be ignored

### Requirement: Draft Creation Semantics

A row created via `POST /jobs` MUST be born with `status='draft'` (written explicitly in the INSERT, not relying solely on the schema default) and `published_at IS NULL`. The new row MUST NOT be surfaced by the public read endpoints (`GET /jobs` and `GET /jobs/{id}`) until its `status` is later transitioned to `'published'` via `PATCH /jobs/{id}`; the canonical read-side visibility predicate (`jobs.status='published' AND jobs.deleted_at IS NULL AND companies.status='active' AND companies.deleted_at IS NULL`) enforces this behavior.

#### Scenario: created row is born draft with published_at NULL

- GIVEN a recruiter of an active company `A`
- WHEN `POST /jobs` succeeds
- THEN the persisted row has `status='draft'` and `published_at IS NULL`

#### Scenario: freshly-created draft is invisible to GET /jobs

- GIVEN a row just created via `POST /jobs` (status `draft`)
- WHEN `GET /jobs` runs without any authentication header
- THEN the response is `200` and the new row is NOT in the listing

#### Scenario: freshly-created draft is invisible to GET /jobs/{id}

- GIVEN a row just created via `POST /jobs` (status `draft`, returning `id = J`)
- WHEN `GET /jobs/J` runs without any authentication header
- THEN the response is `404` (the existing visibility predicate hides the draft)

#### Scenario: status field is not accepted on create

- GIVEN a recruiter of an active company `A`
- WHEN `POST /jobs` is sent with a `status` field in the body (e.g., `{"status":"published", ...}`)
- THEN the response is `201` with `status='draft'` (the body value is ignored — the row is born draft regardless of what the client supplied)

### Requirement: Active Company Creation Gate

Only a company whose `status='active'` AND `deleted_at IS NULL` (a live company) at the moment of the INSERT MAY create jobs via `POST /jobs`. The live-company predicate is enforced by TWO complementary layers: `RequireCompanyRole`'s liveness gate (the production API) rejects any request whose member company is tombstoned (`deleted_at IS NOT NULL`) with `403 Forbidden` reason `company is inactive` BEFORE the handler runs; the atomic SQL guard (defense-in-depth for a bypassed or mis-wired call) enforces the same predicate inside the same SQL statement that writes the row (no read-then-write TOCTOU window). A non-active company (`status='suspended'` or `status='pending_verification'`) — which the liveness gate does NOT catch because its `status` is not `active` — or a tombstoned company that somehow bypassed the middleware MUST yield the domain sentinel `entities.ErrCompanyNotActive`, and the HTTP layer MUST map that sentinel to `409 Conflict` with body `{"error":"company is not active"}`. A zero-row outcome on the SQL guard (whether the company is suspended, pending, tombstoned, or — defensively — missing) MUST surface as the same sentinel and the same `409 Conflict` response. The production API MUST reject a tombstoned member company with `403` (middleware) before ever reaching the `409` SQL guard — `ErrCompanyNotActive` for tombstoned companies is reachable only on a middleware bypass.

#### Scenario: suspended company is rejected with 409

- GIVEN a recruiter membership in company `A` whose `companies.status='suspended'`
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and no row is inserted

#### Scenario: pending_verification company is rejected with 409

- GIVEN a recruiter membership in company `A` whose `companies.status='pending_verification'`
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and no row is inserted

#### Scenario: soft-deleted company is rejected with 403 (middleware) before the 409 SQL guard

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and `companies.deleted_at IS NOT NULL` (tombstoned — `SoftDeleteCompany` preserves the status and only sets the tombstone)
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `403 Forbidden` with reason `company is inactive` and no row is inserted — `RequireCompanyRole`'s liveness gate intercepts the request BEFORE the handler runs and BEFORE the atomic SQL guard; the SQL `c.deleted_at IS NULL` guard and `ErrCompanyNotActive` (`409 company is not active`) mapping remain as defense-in-depth for a bypassed or mis-wired call but the production API MUST NOT reach them for a tombstoned member company (the write-side counterpart of the read-side `companies.deleted_at IS NULL` hardening: `status='active'` alone is not a live-company gate)

#### Scenario: active company passes the gate

- GIVEN a recruiter membership in company `A` whose `companies.status='active'`
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `201 Created` (the SQL guard produces 1 row; the active predicate passes)

#### Scenario: the active check is atomic with the INSERT

- GIVEN the SQL guard encodes the active predicate in the same statement that writes the row (CTE / `WHERE`-on-INSERT shape)
- WHEN `POST /jobs` is sent for a company that is `active` at the guard but `suspended` immediately after the gate middleware resolves the membership
- THEN the SQL predicate STILL wins — the company was not active at INSERT time, so the INSERT yields 0 rows and the response is `409 Conflict` (no TOCTOU window between middleware and write)

### Requirement: Create Domain Validation

The use case MUST enforce the following rules in the domain layer (no DB `CHECK` is added for them in this change). Failure of any rule MUST yield `400` with the corresponding sentinel message.

- `title` MUST be non-empty after trimming whitespace; otherwise `ErrEmptyTitle`.
- `description` MUST be non-empty after trimming whitespace; otherwise `ErrEmptyDescription`.
- `work_mode`, `employment_type`, `seniority` MUST each parse via their `Parse…` functions; an unknown VO MUST yield `ErrInvalidWorkMode` / `ErrInvalidEmploymentType` / `ErrInvalidSeniority` respectively.
- `salary_currency`, when present, MUST parse via `ParseSalaryCurrency`; an unknown value MUST yield `ErrInvalidSalaryCurrency`.
- `salary_min` and `salary_max`, when BOTH are present and non-null, MUST satisfy `salary_min ≤ salary_max`; otherwise `ErrInvalidSalaryRange`. A lone `salary_min` (with `salary_max` absent or null) MUST be permitted; the cross-field check is NOT a final-state rule on create (mirrors the PATCH behavior exactly).

#### Scenario: empty title is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"title":"   "` (whitespace only) or `"title":""`
- THEN the response is `400` with the empty-title message

#### Scenario: empty description is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"description":""`
- THEN the response is `400` with the empty-description message

#### Scenario: unknown work_mode is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"work_mode":"telecommute"`
- THEN the response is `400` with the invalid-`work_mode` message

#### Scenario: unknown employment_type is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"employment_type":"freelance"`
- THEN the response is `400` with the invalid-`employment_type` message

#### Scenario: unknown seniority is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"seniority":"principal"`
- THEN the response is `400` with the invalid-`seniority` message

#### Scenario: unknown salary_currency is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"salary_currency":"EUR"`
- THEN the response is `400` with the invalid-`salary_currency` message

#### Scenario: salary_min greater than salary_max (both present) is rejected

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"salary_min":10000,"salary_max":5000`
- THEN the response is `400` with the salary-range message

#### Scenario: salary_min-only (no max) is allowed and produces 201

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"salary_min":10000` and no `salary_max` key in the body
- THEN the response is `201 Created` and the new row has `salary_min=10000` and `salary_max IS NULL`

#### Scenario: salary_max-only (no min) is allowed and produces 201

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` is sent with `"salary_max":5000` and no `salary_min` key in the body
- THEN the response is `201 Created` and the new row has `salary_max=5000` and `salary_min IS NULL`

### Requirement: Create Response

The `POST /jobs` response on success MUST be `201 Created` with the full `JobEditorViewDto` as the response body. The freshly-created row renders `status='draft'`, omits `published_at` (NULL → `omitempty` strips the field), and carries `updated_at` set by the DB at INSERT time. The response MUST embed `company: {id, name}` populated from the row's owning company. The response MUST NOT be the public `SearchJobsItem` shape — the public read DTO does not carry `status` or `updated_at`, and the editor view does. The `updated_at` returned in this response is the authoritative value the client SHOULD use as the `If-Unmodified-Since` CAS token on an immediately-following `PATCH /jobs/{id}` to publish the draft.

#### Scenario: 201 body is the editor view

- GIVEN a recruiter of an active company `A`
- WHEN `POST /jobs` succeeds with a valid body
- THEN the response is `201 Created` and the body is the full `JobEditorViewDto` carrying `status`, `updated_at`, and `company{id,name}`

#### Scenario: response status is draft and updated_at is server-supplied

- GIVEN a recruiter of an active company
- WHEN `POST /jobs` succeeds at server-time `T`
- THEN the response body's `status` is `"draft"`, the response body's `updated_at` is `T` (within the request window), and `published_at` is omitted from the body

#### Scenario: response embeds company id and name

- GIVEN a recruiter of an active company `A` named `"Acme"`
- WHEN `POST /jobs` succeeds
- THEN the response body's `company.id` is company `A`'s id and `company.name` is `"Acme"`

#### Scenario: response is not the public read DTO

- GIVEN any successful `POST /jobs`
- WHEN the response body is inspected
- THEN it carries the `status` and `updated_at` fields (which the public read DTOs MUST NOT expose) and it is NOT a `SearchJobsItem` shape

### Requirement: Create Route Security Boundary

The gated `POST /jobs` route MUST be mounted on a per-route middleware subtree (for example, `r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)`), separate from the public `Routes()` mount. A request without an `Authorization` header to `POST /jobs` MUST return `401`. The public `r.Mount("/jobs", ...)` MUST NOT serve `POST`; a request to the public mount with method `POST` MUST NOT be matched (the router returns `404 not found` because the gated subtree — not the public mount — is what serves the create route).

#### Scenario: unauthenticated POST /jobs returns 401

- GIVEN a `POST /jobs` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` (not `404`, not `403`)

#### Scenario: POST /jobs is not reachable through the public mount

- GIVEN the composition root splits the public read mount from the gated write mount
- WHEN a `POST /jobs` request reaches the public mount
- THEN the route is not matched by the public mount and the gated subtree is the only path that serves the create (a structural separation that survives refactors of the composition root)

### Requirement: Create Error Taxonomy

The HTTP layer MUST classify `POST /jobs` errors into the following status codes. The body MUST carry enough information for the client to surface a useful message. Classification MUST NOT leak the row's existence (a non-active company is reported as `409` per the active-company gate, NOT as `404`; cross-company scenarios do not apply to create because `company_id` is fixed by `CompanyContext`).

| Outcome | HTTP status | Body |
|---|---|---|
| Body is not valid JSON | `400` | `{"error":"invalid JSON body"}` |
| Empty `title` / `description` (after trim) | `400` | `{"error":"<field> must not be empty"}` (`ErrEmptyTitle` / `ErrEmptyDescription`) |
| Unknown VO (`work_mode` / `employment_type` / `seniority` / `salary_currency`) | `400` | `{"error":"invalid <vo_name>"}` |
| `salary_min > salary_max` (both present) | `400` | `{"error":"salary_min must be less than or equal to salary_max"}` (`ErrInvalidSalaryRange`) |
| No `Authorization` header / unverifiable token | `401` | `{"error":"unauthenticated"}` (RequireAuth short-circuit) |
| Authenticated but not a member of any company, or role below `recruiter` | `403` | `{"error":"<not a member / role too low>"}` (RequireCompanyRole short-circuit) |
| Owning company is not `active` (suspended / pending_verification / 0 rows on the SQL guard) | `409` | `{"error":"company is not active"}` (`ErrCompanyNotActive`) |
| Anything else (DB unavailable, unexpected pg error, missing `CompanyContext`) | `500` | `{"error":"internal server error"}` (real error logged at `slog.Error`) |

#### Scenario: 400 for validation failures

- GIVEN any of: empty `title`, empty `description`, unknown VO, `salary_min > salary_max`
- WHEN `POST /jobs` is sent with the offending body
- THEN the response is `400` with the corresponding sentinel message

#### Scenario: 401 for unauthenticated

- GIVEN a `POST /jobs` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401`

#### Scenario: 403 for non-member or role too low

- GIVEN an authenticated user who is not a member of any company OR whose role is below `recruiter`
- WHEN `POST /jobs` is sent
- THEN the response is `403` (the middleware short-circuits before the handler runs)

#### Scenario: 409 for non-active company

- GIVEN a recruiter membership in a `suspended` (or `pending_verification`) company
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and no row is inserted

#### Scenario: 500 for internal failure

- GIVEN an unexpected internal error (DB unreachable, unexpected pg error, missing `CompanyContext` reaching the handler)
- WHEN `POST /jobs` is sent
- THEN the response is `500` with the generic internal-error body and the real error is logged at `slog.Error`

### Requirement: Re-Open Transitions

A `PATCH /jobs/{id}` body that explicitly sets `status` to `'draft'` or `'published'` against a row whose current `status='closed'` MUST succeed subject to the existing CAS guard, the existing same-company invariant, the existing `RequireAuth` + `RequireCompanyRole(recruiter)` gate, and the new atomic active-company update gate. The two transitions `closed → draft` and `closed → published` are legal; the no-op `closed → closed` is rejected with `400 invalid status transition`. `published_at` MUST be preserved across a `closed → published` re-open (the existing `published_at = COALESCE(published_at, now())` branch in the `UpdateJob` SQL already encodes this — no SQL change is needed for the timestamp).

#### Scenario: closed → draft re-opens the row to draft

- GIVEN a job owned by company `A` with `status='closed'`, `published_at='2025-03-01T00:00:00Z'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` with the editor view of the row carrying `status="draft"`, `published_at='2025-03-01T00:00:00Z'` (preserved as audit history), and a new `updated_at`

#### Scenario: closed → published re-opens the row and preserves the original published_at

- GIVEN a job owned by company `A` with `status='closed'`, `published_at='2025-03-01T00:00:00Z'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` and the row's `status='published'`, `published_at` remains `'2025-03-01T00:00:00Z'`, and `updated_at` is within the request window

#### Scenario: closed → published preserves published_at across close/reopen cycles

- GIVEN a job that was first published at `'2025-03-01T00:00:00Z'`, then `closed`, then re-opened via `closed → published`
- WHEN the row is read after the re-open
- THEN the row's `published_at` is still `'2025-03-01T00:00:00Z'` (audit-history semantics; a re-open does not reset the original first-publish timestamp)

#### Scenario: closed → closed (no-op) returns 400 invalid status transition

- GIVEN a job owned by company `A` with `status='closed'` and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"closed"}` and a matching `If-Unmodified-Since`
- THEN the response is `400 invalid status transition` because a no-op write against a closed row is meaningless

#### Scenario: closed → draft re-opens through the same gate as PATCH and CREATE

- GIVEN a recruiter membership in company `A` and a closed job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `200` (the request passes the same `RequireAuth` + `RequireCompanyRole(recruiter)` middleware the existing `POST /jobs` and `PATCH /jobs/{id}` flows pass — rule #2 extends to re-open)

### Requirement: Re-Open + Field Edits Apply Atomically

A `PATCH /jobs/{id}` body that combines an explicit re-open transition (`status='draft'` or `status='published'`) with one or more field edits MUST apply both in the same SQL `UPDATE` statement: `updated_at` advances exactly once, the STORED `search_vector` regenerates from the new `title`/`description`, and `published_at` follows the re-open policy above. A `PATCH /jobs/{id}` body that contains ONLY field edits and NO `status` against a row whose current `status='closed'` is rejected with `400 invalid status transition` — the closed row is frozen for content, and the only escape is an explicit `closed → {draft, published}` transition.

#### Scenario: closed → draft + title edit applies atomically

- GIVEN a job owned by company `A` with `status='closed'`, `title='Old'`, `description='Old'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft","title":"New"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` and the row's `status='draft'`, `title='New'`, `description='Old'`, `updated_at` advances exactly once within the request window, and `published_at` is preserved

#### Scenario: closed → published + description edit applies atomically and regenerates search_vector

- GIVEN a job owned by company `A` with `status='closed'`, `title='Engineer'`, `description='old body'`, `published_at='2025-03-01T00:00:00Z'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"published","description":"new body"}` and a matching `If-Unmodified-Since: T`
- THEN the response is `200` and the row's `status='published'`, `description='new body'`, `published_at='2025-03-01T00:00:00Z'` (preserved), and the STORED `search_vector` reflects the new `description` text on the next read

#### Scenario: field-only PATCH on a closed row returns 400 invalid status transition

- GIVEN a job owned by company `A` with `status='closed'`, `title='Old'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"title":"New"}` and NO `status` key
- THEN the response is `400 invalid status transition` (the closed row is frozen for content — only an explicit `status` transition out of `closed` unlocks it; LOCKED by user round 2026-08-25)

#### Scenario: PATCH with status absent on a closed row leaves status unchanged

- GIVEN a job owned by company `A` with `status='closed'`, `updated_at='T'`, and a recruiter membership in company `A`
- WHEN `PATCH /jobs/{id}` is sent with body `{"description":"New body"}` and NO `status` key
- THEN the response is `400` and the row's `status` remains `'closed'` (the transition table does not apply because `status` is absent; the closed-terminal early-return still rejects the field-only body per the rule above)

### Requirement: Active-Company Update Gate

Every `PATCH /jobs/{id}` write — not only re-open transitions — MUST be gated by the same atomic live-company predicate the `POST /jobs` flow uses (the `Active Company Creation Gate` requirement). The live-company predicate is enforced by TWO complementary layers: `RequireCompanyRole`'s liveness gate (the production API) rejects any request whose member company is tombstoned (`deleted_at IS NOT NULL`) with `403 Forbidden` reason `company is inactive` BEFORE the handler runs; the atomic SQL guard (defense-in-depth for a bypassed or mis-wired call) MUST enforce the same predicate inside the same SQL `UPDATE` statement that writes the row (no read-then-write TOCTOU window). A non-active company (`status='suspended'` or `status='pending_verification'`) — which the liveness gate does NOT catch because its `status` is not `active` — or a tombstoned company that somehow bypassed the middleware MUST yield the existing `entities.ErrCompanyNotActive` sentinel, and the HTTP layer MUST map that sentinel to `409 Conflict` with body `{"error":"company is not active"}` (reusing the `classifyError` branch added by `jobs-create`). A zero-row outcome on the SQL guard (whether the company is suspended, pending, tombstoned, or — defensively — missing) MUST surface as the same sentinel and the same `409 Conflict` response. The production API MUST reject a tombstoned member company with `403` (middleware) before ever reaching the `409` SQL guard — `ErrCompanyNotActive` for tombstoned companies is reachable only on a middleware bypass.

#### Scenario: suspended company PATCH returns 409 company is not active

- GIVEN a recruiter membership in company `A` whose `companies.status='suspended'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT updated

#### Scenario: pending_verification company PATCH returns 409 company is not active

- GIVEN a recruiter membership in company `A` whose `companies.status='pending_verification'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and the row is NOT updated

#### Scenario: soft-deleted company PATCH returns 403 (middleware) before the 409 SQL guard

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and `companies.deleted_at IS NOT NULL` (tombstoned) and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `403 Forbidden` with reason `company is inactive` and the row is NOT updated — `RequireCompanyRole`'s liveness gate intercepts the request BEFORE the handler runs and BEFORE the atomic SQL guard; the SQL `c.deleted_at IS NULL` guard and `ErrCompanyNotActive` (`409 company is not active`) mapping remain as defense-in-depth for a bypassed or mis-wired call but the production API MUST NOT reach them for a tombstoned member company (the write-side counterpart of the read-side `companies.deleted_at IS NULL` hardening)

#### Scenario: active company PATCH passes the gate

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and a job owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent with a valid body and a matching CAS token
- THEN the response is `200` (the SQL guard produces 1 row; the active predicate passes; LOCKED by user round 2026-08-25 — gate is required for ALL `PATCH /jobs/{id}` writes, not just re-open)

#### Scenario: the active check is atomic with the UPDATE

- GIVEN the SQL guard encodes the active predicate in the same statement that writes the row (CTE / `WHERE`-on-`UPDATE` shape, mirroring `CreateJob`)
- WHEN `PATCH /jobs/{id}` is sent for a job whose company is `active` at the middleware gate but is `suspended` immediately after the gate middleware resolves the membership
- THEN the SQL predicate STILL wins — the company was not active at `UPDATE` time, so the `UPDATE` yields 0 rows and the response is `409 Conflict` (no TOCTOU window between middleware and write)

### Requirement: Re-Open Inherits CAS and Same-Company Invariants

A re-open `PATCH /jobs/{id}` MUST inherit the existing CAS, same-company, and soft-delete invariants unchanged: a stale `If-Unmodified-Since` returns `409 Conflict` with the editor view of the latest row (same shape as a successful `200`); a re-open of another company's closed job surfaces as `404 job not found`; a re-open of a soft-deleted job also surfaces as `404 job not found`. The two new legal transitions and the active-company update gate are additive — they do not relax or bypass any existing concurrency, IDOR, or soft-delete defense.

#### Scenario: re-open with a stale If-Unmodified-Since returns 409 with the latest editor view

- GIVEN a job owned by company `A` with `status='closed'` and current `updated_at='2026-02-02T11:00:00Z'` (changed by a concurrent writer since the client last read it)
- AND a recruiter of company `A` sends `If-Unmodified-Since: 2026-02-01T10:00:00Z`
- WHEN `PATCH /jobs/{id}` is sent with body `{"status":"draft"}`
- THEN the response is `409 Conflict` and the body is the editor view of the row carrying `status="closed"` and `updated_at='2026-02-02T11:00:00Z'` so the client can re-read without an extra round-trip

#### Scenario: cross-company re-open returns 404 job not found

- GIVEN a closed job owned by company `B`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` for that job with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `404 job not found` and the body shape is identical to a non-existent id (no leak of existence — the same-company invariant is unchanged by re-open)

#### Scenario: re-open on a soft-deleted closed job returns 404 job not found

- GIVEN a soft-deleted (`deleted_at IS NOT NULL`) closed job owned by company `A`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` with body `{"status":"draft"}` and a matching CAS token
- THEN the response is `404 job not found` (soft-delete is not relaxed by re-open — a re-open exception on a soft-deleted row is out of scope; LOCKED by user round 2026-08-25)

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

The second surface is the atomic active-company soft-delete gate, mirroring the canonical `Active-Company Update Gate` requirement verbatim: the live-company predicate (active status AND not soft-deleted) MUST be enforced atomically inside the same SQL `UPDATE` statement that writes the tombstone (no read-then-write TOCTOU window between the gate middleware and the UPDATE). The live-company predicate is enforced by TWO complementary layers: `RequireCompanyRole`'s liveness gate (the production API) rejects any request whose member company is tombstoned (`deleted_at IS NOT NULL`) with `403 Forbidden` reason `company is inactive` BEFORE the handler runs; the atomic SQL guard (defense-in-depth for a bypassed or mis-wired call) MUST enforce the same predicate inside the same SQL `UPDATE` statement. A non-active company (`status='suspended'` or `status='pending_verification'`) — which the liveness gate does NOT catch because its `status` is not `active` — or a tombstoned company that somehow bypassed the middleware MUST yield the existing `entities.ErrCompanyNotActive` sentinel, and the HTTP layer MUST map that sentinel to `409 Conflict` with body `{"error":"company is not active"}` (reusing the `classifyError` branch added by `jobs-create`). A zero-row outcome on the SQL guard (whether the company is suspended, pending, tombstoned, or — defensively — missing) MUST surface as the same sentinel and the same `409 Conflict` response, and the row MUST NOT be tombstoned. The production API MUST reject a tombstoned member company with `403` (middleware) before ever reaching the `409` SQL guard — `ErrCompanyNotActive` for tombstoned companies is reachable only on a middleware bypass.

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

#### Scenario: soft-deleted company DELETE returns 403 (middleware) before the 409 SQL guard

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and `companies.deleted_at IS NOT NULL` (tombstoned — `SoftDeleteCompany` preserves the status and only sets the tombstone) and a job owned by company `A`
- WHEN `DELETE /jobs/{id}` is sent with a matching `If-Unmodified-Since`
- THEN the response is `403 Forbidden` with reason `company is inactive` and the row is NOT tombstoned — `RequireCompanyRole`'s liveness gate intercepts the request BEFORE the handler runs and BEFORE the atomic SQL guard; the SQL `c.deleted_at IS NULL` guard and `ErrCompanyNotActive` (`409 company is not active`) mapping remain as defense-in-depth for a bypassed or mis-wired call but the production API MUST NOT reach them for a tombstoned member company (the write-side counterpart of the read-side `companies.deleted_at IS NULL` hardening: `status='active'` alone is not a live-company gate)

#### Scenario: active company DELETE passes the gate

- GIVEN a recruiter membership in company `A` whose `companies.status='active'` and a job owned by company `A`
- WHEN `DELETE /jobs/{id}` is sent with a matching `If-Unmodified-Since`
- THEN the response is `204 No Content` (the SQL guard produces 1 row; the active predicate passes; the row is tombstoned within the request window)

#### Scenario: the active check is atomic with the UPDATE

- GIVEN the SQL guard encodes the active predicate in the same statement that writes the tombstone (the `WITH active AS (SELECT id FROM companies WHERE id = sqlc.arg('company_id')::uuid AND status = 'active' AND deleted_at IS NULL) , upd AS (UPDATE jobs SET deleted_at = now(), updated_at = now() WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL AND updated_at = $3 AND EXISTS (SELECT 1 FROM active) RETURNING id) SELECT EXISTS (SELECT 1 FROM active) AS guard_passed, (SELECT count(*) FROM upd) AS deleted_count;` shape — mirroring `UpdateJob :one`)
- WHEN `DELETE /jobs/{id}` is sent for a job whose company is `active` at the middleware gate but is `suspended` immediately after the gate middleware resolves the membership
- THEN the SQL predicate STILL wins — the company was not active at UPDATE time, so the UPDATE yields 0 rows and the response is `409 Conflict` (no TOCTOU window between middleware and write)

### Requirement: Soft-Delete Eligibility, Audit, and Read-Side Invariants

A `DELETE /jobs/{id}` MUST succeed against a row in ANY current `status` (`draft`, `published`, or `closed`) subject to the existing gate (see DELETE /jobs/{id} Endpoint, Gate, and Route Boundary), the Soft-Delete Concurrency Controls, the existing same-company invariant (canonical `Same-Company Invariant and IDOR Defense`), and the existing re-open invariants (canonical `Re-Open Inherits CAS and Same-Company Invariants`). A second `DELETE /jobs/{id}` against a row whose member company has since been tombstoned returns `403 Forbidden` reason `company is inactive` from `RequireCompanyRole`'s liveness gate (the gate intercepts before the handler runs); the SQL `c.deleted_at IS NULL` predicate and `ErrJobNotFound` mapping remain as defense-in-depth for a bypassed or mis-wired call but the production API MUST NOT reach them for a tombstoned member company. The SQL UPDATE MUST set ONLY `deleted_at = now()` and `updated_at = now()`; `published_at`, `title`, `description`, `status`, `work_mode`, `employment_type`, `seniority`, `location`, `salary_min`, `salary_max`, and `salary_currency` MUST be preserved as audit history (no other column is touched). The STORED `search_vector` is naturally unchanged because its inputs (`title`, `description`) are not touched; the partial index `jobs_public_listing_idx` (predicated on `deleted_at IS NULL`) MUST drop the row from the index automatically when `deleted_at` is set (Postgres maintains partial indexes on UPDATE).

A successful DELETE makes the row invisible on every read path immediately. The canonical `Read-Side Visibility Rule` and the canonical `GET /jobs/{id} hides non-visible jobs` scenario pin this invariant. Specifically: immediately after a successful DELETE, `GET /jobs/{id}` returns `404 job not found` and `GET /jobs` excludes the row from its listing (the `jobs.deleted_at IS NULL` predicate hides the row from both).

A second `DELETE /jobs/{id}` against a soft-deleted row whose member company is still live MUST return `404 job not found` because `GetForUpdate`'s `jobs.deleted_at IS NULL` predicate filters the row out (the read-for-delete returns `ErrJobNotFound`, identical body shape to a non-existent id — no leak of existence, consistent with the canonical `soft-deleted id returns 404` scenario for PATCH). If the member company has since been tombstoned, the second `DELETE` is intercepted by `RequireCompanyRole`'s liveness gate with `403 Forbidden` reason `company is inactive` BEFORE the handler runs (see the canonical `Same-Company Invariant and IDOR Defense` and the `Soft-Delete Concurrency Controls` requirement). A `DELETE /jobs/{id}` against a row owned by another company (and a live member company) MUST return `404 job not found` (same-company invariant; identical body shape to a non-existent id and to an already-soft-deleted id — three cases indistinguishable by design). A `PATCH /jobs/{id}` against a soft-deleted row (e.g., `{"status":"draft"}` or `{"status":"published"}`) MUST continue to return `404 job not found`; the canonical `re-open on a soft-deleted closed job returns 404 job not found` scenario already pins this and is unchanged by this delta. The `deleted_at` column IS the audit timestamp; no `deleted_by_user_id`, no `deleted_reason`, no `deletion_log` table is added.

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
- THEN the response is `404` (the canonical `GET /jobs/{id} hides non-visible jobs` scenario pins this — the `jobs.deleted_at IS NULL` predicate filters the row out)

#### Scenario: soft-deleted row is excluded from GET /jobs (cross-reference)

- GIVEN a row soft-deleted via a successful `DELETE /jobs/{id}`
- WHEN `GET /jobs` runs (with or without an `Authorization` header)
- THEN the row is not in the response listing (the canonical `draft, closed, soft-deleted, non-active-company, or soft-deleted-company jobs are hidden` scenario pins this — the `jobs.deleted_at IS NULL` predicate filters the row out; the partial index `jobs_public_listing_idx` drops it automatically)
