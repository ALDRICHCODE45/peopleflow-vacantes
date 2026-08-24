# Delta for Jobs

## Out of scope (deferred)

This delta does NOT cover: `POST /jobs`, re-opening a closed job (`closed → {draft,published}`), deletion (soft-delete via endpoint), new schema migrations, notification or event publishing, any change to the public read API shape (`GET /jobs`, `GET /jobs/{id}`, and `SearchJobsItem` stay exactly as the canonical read-side spec defines them), or search reindexing changes (the Postgres `STORED` `search_vector` and its expression are untouched).

## ADDED Requirements

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
