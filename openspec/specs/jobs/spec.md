# Jobs Specification

Public, full-text searchable job board for `peopleflow-vacantes`. Read path: candidates browse published jobs from active companies. Gated write path: recruiters edit jobs via `PATCH /jobs/{id}`. The `jobs` table carries the full status domain (`draft → published → closed`), and only `published` rows are exposed on read.

## Out of scope (deferred)

This slice does NOT cover: `POST /jobs` (creation), re-opening a closed job (`closed → {draft,published}`), a soft-delete endpoint, notification or event publishing, `company_members` ownership, "solo empresa `active` publica" enforcement on creation, a recruiter subtree beyond the gated `PATCH /jobs/{id}` write route, frontend job board, production seed strategy, and currency conversion (FX). The gated write side IS delivered: `PATCH /jobs/{id}` performs partial field edits, publish/close transitions (with `closed` terminal) via the gated endpoint, and CAS concurrency control; `PUT /jobs/{id}` is NOT part of this API. The dev seed (`00008_jobs_seed.sql`) ships ~6 published jobs as a developer convenience only — it is NOT a runtime requirement.

## ADDED Requirements

### Requirement: Public Read Endpoints

The system MUST expose `GET /jobs` (search/listing) and `GET /jobs/{id}` (detail) as public, unauthenticated endpoints. Neither MUST require an `Authorization` header; if present, it MUST be ignored. `GET /jobs/{id}` MUST return a published job or 404 for non-existent, draft, closed, soft-deleted, or non-active-company jobs.

#### Scenario: GET /jobs is public

- GIVEN no `Authorization` header
- WHEN `GET /jobs` runs
- THEN response is 200 with the public listing

#### Scenario: GET /jobs/{id} returns a published job

- GIVEN a published job from an active company
- WHEN `GET /jobs/{id}` runs
- THEN response is 200 with that job

#### Scenario: GET /jobs/{id} hides non-visible jobs

- GIVEN a job with `status='draft'` OR `status='closed'` OR `deleted_at IS NOT NULL` OR owning company `status != 'active'`
- WHEN `GET /jobs/{id}` runs
- THEN response is 404

### Requirement: Read-Side Visibility Rule

A job MUST surface in read responses ONLY if ALL of: `jobs.status='published'`, `jobs.deleted_at IS NULL`, and the related `companies.status='active'`. The read path MUST NOT surface draft, closed, soft-deleted, or non-active-company jobs in any response.

#### Scenario: visible job is listed

- GIVEN a job with `status='published'`, `deleted_at IS NULL`, owning company `status='active'`
- WHEN `GET /jobs` runs
- THEN the job is in the response

#### Scenario: draft, closed, soft-deleted, or non-active-company jobs are hidden

- GIVEN any of `status='draft'`, `status='closed'`, `deleted_at IS NOT NULL`, or owning company `status != 'active'`
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

The `status` field on PATCH MUST obey the following transition matrix; every illegal transition MUST return `400 invalid status transition`. When `status` is absent from the request body, the transition table MUST NOT apply and the field MUST be left untouched.

| Current `status` | Requested `status` | Allowed | Side effect |
|---|---|---|---|
| `draft` | `draft` | YES | Field-only edit; no `published_at` change. |
| `draft` | `published` | YES | Server MUST set `published_at = now()` in the same SQL UPDATE. |
| `draft` | `closed` | NO | `400`. |
| `published` | `draft` | NO | `400` — no un-publish in this change. |
| `published` | `published` | YES | Field-only edit; `published_at` preserved; `search_vector` regenerates via the STORED column. |
| `published` | `closed` | YES | `published_at` is preserved as audit history. |
| `closed` | `draft` | NO | `400` — `closed` is terminal. |
| `closed` | `published` | NO | `400` — `closed` is terminal in this change. |
| `closed` | `closed` | NO | `400` — terminal rows are immutable. |

The DB integrity guard `CHECK (status <> 'published' OR published_at IS NOT NULL)` MUST continue to hold: when the patch sets `status='published'`, the same SQL UPDATE MUST also set `published_at = now()` atomically (one statement, not two writes).

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

#### Scenario: closed is terminal

- GIVEN a job with `status='closed'`
- WHEN `PATCH /jobs/{id}` is sent with any body (any status or field change)
- THEN the response is `400` because every transition out of `closed` is illegal

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

The write path MUST scope every read and write by the `company_id` from `CompanyContext`. A job that exists but belongs to another company MUST surface as `404 job not found` — identical to the existing same-company pattern in the `companies` slice. The system MUST NOT return `403 forbidden` for cross-company access (that would leak the row's existence); the system MUST NOT return any body hint that the row exists in another company. A soft-deleted row (`deleted_at IS NOT NULL`) and a non-existent id MUST also surface as `404 job not found` with the same body shape.

#### Scenario: cross-company id returns 404

- GIVEN a job owned by company `B`
- WHEN a recruiter of company `A` sends `PATCH /jobs/{id}` for that job with a valid CAS token
- THEN the response is `404` and the body shape is identical to a non-existent id

#### Scenario: soft-deleted id returns 404

- GIVEN a soft-deleted job (`deleted_at IS NOT NULL`) owned by company `A`
- WHEN `PATCH /jobs/{id}` is sent by a recruiter of company `A`
- THEN the response is `404`

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

The HTTP layer MUST classify PATCH errors into the following status codes. The body MUST carry enough information for the client to surface a useful message. Classification MUST NOT leak row existence beyond the `404` / `409` cases pinned by the same-company invariant and CAS requirements.

| Outcome | HTTP status | Body |
|---|---|---|
| `{id}` is not a valid UUID | `400 invalid job id` | error message |
| Status transition is illegal | `400 invalid status transition` | error message naming the offending transition |
| Unknown VO, empty `title` / `description`, or `salary_min > salary_max` | `400 validation` | error message naming the failing field |
| No `Authorization` header / unverifiable token | `401 unauthenticated` | error message |
| Authenticated but not a member of the job's owning company, or role too low | `403 not a member / role too low` | error message |
| Row does not exist for the caller's company (cross-company, soft-deleted, or non-existent) | `404 job not found` | error message |
| `If-Unmodified-Since` mismatches the row's current `updated_at` (or header missing) | `409 conflict` | editor view of the latest row |
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
