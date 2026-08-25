# Delta for Jobs

This delta ADDs the `POST /jobs` create endpoint to the `jobs` capability. It does NOT modify the canonical read-side or `PATCH /jobs/{id}` requirements already present in `openspec/specs/jobs/spec.md` — the PATCH-side `Write Route Security Boundary`, `Error Taxonomy`, and `Domain Validation Rules` requirements stay intact and continue to govern `PATCH /jobs/{id}` exclusively. The create-specific requirements below govern `POST /jobs` exclusively.

## ADDED Requirements

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

A row created via `POST /jobs` MUST be born with `status='draft'` (written explicitly in the INSERT, not relying solely on the schema default) and `published_at IS NULL`. The new row MUST NOT be surfaced by the public read endpoints (`GET /jobs` and `GET /jobs/{id}`) until its `status` is later transitioned to `'published'` via `PATCH /jobs/{id}`; the existing read-side visibility predicate (`status='published' AND deleted_at IS NULL AND companies.status='active'`) is the mechanism and MUST NOT be modified.

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

Only a company whose `status='active'` at the moment of the INSERT MAY create jobs via `POST /jobs`. The active-company predicate MUST be enforced atomically inside the same SQL statement that writes the row (no read-then-write TOCTOU window): a non-active company (`status='suspended'` or `status='pending_verification'`) MUST yield a new domain sentinel `entities.ErrCompanyNotActive`, and the HTTP layer MUST map that sentinel to `409 Conflict` with body `{"error":"company is not active"}`. A zero-row outcome on the SQL guard (whether the company is suspended, pending, or — defensively — missing) MUST surface as the same sentinel and the same `409 Conflict` response.

#### Scenario: suspended company is rejected with 409

- GIVEN a recruiter membership in company `A` whose `companies.status='suspended'`
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and no row is inserted

#### Scenario: pending_verification company is rejected with 409

- GIVEN a recruiter membership in company `A` whose `companies.status='pending_verification'`
- WHEN `POST /jobs` is sent with a valid body
- THEN the response is `409 Conflict` with body `{"error":"company is not active"}` and no row is inserted

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