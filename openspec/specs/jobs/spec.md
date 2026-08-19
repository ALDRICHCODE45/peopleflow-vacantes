# Jobs Specification

Public, full-text searchable job board for `peopleflow-vacantes`. Read-only slice: candidates browse published jobs from active companies. The `jobs` table carries the full status domain (`draft → published → closed`), but only `published` rows are exposed on read.

## Out of scope (deferred)

This slice does NOT cover: `POST /jobs`, `PUT /jobs/{id}`, publish/close transitions, `company_members` ownership, "solo empresa `active` publica" enforcement on write, recruiter subtree, frontend job board, production seed strategy, and currency conversion (FX). The dev seed (`00008_jobs_seed.sql`) ships ~6 published jobs as a developer convenience only — it is NOT a runtime requirement.

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
