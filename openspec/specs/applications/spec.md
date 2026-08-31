# Applications Specification

## Purpose

The `applications` bounded context is the bridge between candidates and jobs. A candidate with a valid JWT may submit one application to a published job owned by an active company; a recruiter of the owning company may list, view, and transition that application through a three-step pipeline (`submitted → in_review → {rejected, hired}`). The context is deliberately narrow: there is no withdraw, no re-apply, no per-stage timestamp, no pagination, and no public applications read surface; the two application write paths (apply, transition) co-write `audit_events` rows in the same database transaction (fail-closed — see `Fail-Closed Application + Audit Co-Write` and the canonical `audit_events` spec). The schema is the one defined in `docs/modelo-de-datos-proyecto-04.md` §3.8, materialized by migration `00010_create_applications.sql`. This slice owns the table, the candidate apply + `/me/applications` subtree, the recruiter list / detail / transition subtree, and the wire/DTO surface; it does NOT touch the `jobs` public read surface, the `candidates` profile shape, the `identity.UserRepository` seam (reused, not extended), or any other bounded context's port. The `jobs` port is NOT extended for this slice — the atomic apply gate and the cross-feature joins for the recruiter subtree live inside the `applications` adapter SQL.

## Out of scope (deferred)

This specification does NOT cover: CV upload or S3 storage (the `cv_s3_key` column is reserved `NULL` only and no write path in this slice sets it); the LFPDPPP `anonymized_at` flow + CV S3 deletion (the column is reserved `NULL` only); in-process domain events and EventBridge fan-out; candidate withdraw, hard delete, or reopen of a `rejected` / `hired` row; per-stage timestamp columns (`reviewed_at`, `hired_at`, `rejected_at` — `updated_at` is the single action timestamp); bulk transitions or multi-row updates; source-attribution analytics or funnel reports; keyset or cursor pagination on the recruiter list or the candidate `/me/applications` list (both hard-capped at 100 rows); `GET /applications/{id}` or any public applications read endpoint; frontend, SQS worker, and email. There is no re-apply on a soft-deleted job (the atomic apply gate excludes soft-deleted rows); existing applications on a soft-deleted job remain visible AND transitionable to the owning recruiter (historical pipeline — see `Soft-Deleted Job Applications Stay Recruiter-Accessible`). The `audit_events` read/query surface is out of scope for this slice (write-only — see the canonical `audit_events` spec for the table, port, and co-write contract); outbox / SNS / SQS / EventBridge fan-out of `ApplicationSubmitted` or `ApplicationTransitioned` is deferred; the jobs, companies, and identity write paths emit no audit events in this cycle.

## Requirements

### Requirement: Applications Schema Migration

Migration `00010_create_applications.sql` MUST create the `applications` table with the following columns: `id UUID PRIMARY KEY` (no DB default — the application generates a UUID v7); `job_id UUID NOT NULL REFERENCES jobs(id)`; `candidate_id UUID NOT NULL REFERENCES users(id)`; `status TEXT NOT NULL DEFAULT 'submitted'` constrained by `applications_status_check` to `'submitted'|'in_review'|'rejected'|'hired'`; `source TEXT NULL` constrained by `applications_source_check` to `'referral'|'linkedin'|'job_board'|'direct'|'other'` when present; `cover_letter TEXT NULL`; `cv_s3_key TEXT NULL` (reserved — never set by any write path in this slice); `anonymized_at TIMESTAMPTZ NULL` (reserved — never set by any write path in this slice); `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`. The table MUST include a UNIQUE constraint named `applications_job_candidate_unique` on `(job_id, candidate_id)` (plain UNIQUE — NOT partial, because `applications` does not soft-delete in this slice and there is no re-apply path) and two B-tree indexes: `applications_by_job_idx` on `(job_id, status, created_at DESC)` and `applications_by_candidate_idx` on `(candidate_id, created_at DESC)`. The `job_id` and `candidate_id` columns MUST have foreign keys to `jobs(id)` and `users(id)` respectively; the DB MUST reject rows whose referenced rows do not exist. `goose down` MUST drop the table and both indexes (no other table references `applications` in this slice, so `Down` is a clean drop).

#### Scenario: up creates named objects

- GIVEN the DB at migration `00009`
- WHEN `goose up` runs `00010`
- THEN `applications`, both CHECK constraints (`applications_status_check`, `applications_source_check`), the `applications_job_candidate_unique` UNIQUE, `applications_by_job_idx`, and `applications_by_candidate_idx` exist

#### Scenario: down drops table and indexes

- GIVEN `00010` applied
- WHEN `goose down` runs
- THEN `applications` and both indexes are gone (clean drop; no other migration affected)

#### Scenario: required fields reject NULL

- GIVEN the `applications` table
- WHEN an INSERT with `job_id = NULL` OR `candidate_id = NULL` is attempted
- THEN the DB rejects the row

#### Scenario: status defaults to submitted on insert

- GIVEN the `applications` table
- WHEN a row is inserted with only `id`, `job_id`, `candidate_id`
- THEN the persisted row has `status='submitted'` and `created_at`/`updated_at` are server time

#### Scenario: status rejects unknown values

- GIVEN the `applications` table
- WHEN an INSERT with `status='withdrawn'` is attempted
- THEN the DB rejects the row with a CHECK violation (closed vocabulary enforced at the DB boundary)

#### Scenario: source rejects unknown values

- GIVEN the `applications` table
- WHEN an INSERT with `source='newspaper'` is attempted
- THEN the DB rejects the row with a CHECK violation

#### Scenario: duplicate (job_id, candidate_id) is rejected by the UNIQUE

- GIVEN an existing application `(job_id=J, candidate_id=C)`
- WHEN another INSERT with `(job_id=J, candidate_id=C)` is attempted
- THEN the DB rejects the row with a UNIQUE violation (SQLSTATE `23505`)

#### Scenario: cv_s3_key is nullable and unused in this slice

- GIVEN the `applications` table
- WHEN the schema is inspected
- THEN `cv_s3_key` exists as `TEXT NULL` and no production write path in this slice sets it (it is reserved for the snapshot-at-apply invariant documented in `docs/modelo-de-datos-proyecto-04.md` §3.8)

#### Scenario: anonymized_at is nullable and unused in this slice

- GIVEN the `applications` table
- WHEN the schema is inspected
- THEN `anonymized_at` exists as `TIMESTAMPTZ NULL` and no production write path in this slice sets it (it is reserved for the future LFPDPPP flow)

### Requirement: Status Domain

Applications MUST be born `status='submitted'` (DB default, no client write path sets a different value on create). The closed status vocabulary is `submitted|in_review|rejected|hired`; the DB CHECK `applications_status_check` enforces this and the DB MUST NOT accept a row with an out-of-vocabulary value. No other lifecycle state exists in this slice (no `withdrawn`, no `pending`, no `draft`).

#### Scenario: closed vocabulary is the only accepted status

- GIVEN the `applications` table
- WHEN `status` is set to `'submitted'`, `'in_review'`, `'rejected'`, or `'hired'`
- THEN the DB accepts the row

#### Scenario: out-of-vocabulary status is rejected

- GIVEN the `applications` table
- WHEN `status` is set to anything other than `submitted|in_review|rejected|hired`
- THEN the DB rejects the row with a CHECK violation

### Requirement: Status Transition Matrix

The `status` field MUST obey the following transition matrix. Every illegal transition MUST return `400 invalid status transition`. `rejected` and `hired` are TERMINAL (no outbound edge).

| Current `status` | Requested `status` | Allowed | Notes |
|---|---|---|---|
| `submitted` | `in_review` | YES | The recruiter has begun reviewing the application. |
| `submitted` | `rejected` | NO | `400` — recruiter MUST first transition to `in_review`. |
| `submitted` | `hired` | NO | `400` — recruiter MUST first transition to `in_review`. |
| `in_review` | `submitted` | NO | `400` — no rolling back from `in_review`. |
| `in_review` | `rejected` | YES | Terminal. |
| `in_review` | `hired` | YES | Terminal. |
| `rejected` | any | NO | `400` — terminal. |
| `hired` | any | NO | `400` — terminal. |
| same as current | same as current | NO | `400` — no-op self-transition is a pointless write. |

The transition matrix MUST be enforced in the use case (the domain layer); the DB does NOT add a separate transition CHECK (the closed vocabulary is already enforced by `applications_status_check`, and trigger-based transition checks are out of scope for this slice). The single `updated_at` column is the action timestamp — there are no per-stage timestamp columns in this slice.

#### Scenario: submitted → in_review is allowed

- GIVEN an application with `status='submitted'`
- WHEN the recruiter transitions it to `'in_review'`
- THEN the response is `200` with the updated application carrying `status='in_review'` and a fresh `updated_at`

#### Scenario: submitted → rejected is rejected

- GIVEN an application with `status='submitted'`
- WHEN the recruiter transitions it to `'rejected'`
- THEN the response is `400 invalid status transition`

#### Scenario: submitted → hired is rejected

- GIVEN an application with `status='submitted'`
- WHEN the recruiter transitions it to `'hired'`
- THEN the response is `400 invalid status transition`

#### Scenario: in_review → rejected is allowed

- GIVEN an application with `status='in_review'`
- WHEN the recruiter transitions it to `'rejected'`
- THEN the response is `200` with the updated application carrying `status='rejected'` (terminal)

#### Scenario: in_review → hired is allowed

- GIVEN an application with `status='in_review'`
- WHEN the recruiter transitions it to `'hired'`
- THEN the response is `200` with the updated application carrying `status='hired'` (terminal)

#### Scenario: rejected is terminal

- GIVEN an application with `status='rejected'`
- WHEN the recruiter transitions it to `'in_review'`, `'submitted'`, or `'hired'`
- THEN the response is `400 invalid status transition`

#### Scenario: hired is terminal

- GIVEN an application with `status='hired'`
- WHEN the recruiter transitions it to `'in_review'`, `'submitted'`, or `'rejected'`
- THEN the response is `400 invalid status transition`

#### Scenario: no-op self-transition is rejected

- GIVEN an application with `status='in_review'`
- WHEN the recruiter transitions it to `'in_review'`
- THEN the response is `400 invalid status transition`

### Requirement: Apply Endpoint

The system MUST expose `POST /jobs/{jobId}/applications` as a candidate-only write route. The route MUST run behind `RequireAuth`. The request body MAY carry an optional `source` (one of `referral|linkedin|job_board|direct|other` or `null`) and an optional `cover_letter` (string, length ≤ 2000 characters after trim). The body MUST NOT carry `id`, `job_id`, `candidate_id`, `status`, `cv_s3_key`, `anonymized_at`, `created_at`, or `updated_at`; any such fields MUST be ignored by the server. The path `{jobId}` MUST be parsed as a UUID; non-UUID values yield `400 invalid job id` and no row is inserted. On success the response MUST be `201 Created` with the full application body and the row's `id` (see `Apply Response`).

#### Scenario: authenticated candidate applies successfully

- GIVEN a valid JWT, a published job from an active company, and a request body with optional `source` and `cover_letter`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `201 Created` with the full application body carrying `status='submitted'`, the server-supplied `id`, `created_at`, and `updated_at`

#### Scenario: missing Authorization header returns 401

- GIVEN a `POST /jobs/{jobId}/applications` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401 unauthenticated` and no row is inserted (RequireAuth short-circuits before the handler runs)

#### Scenario: invalid job id returns 400

- GIVEN a `POST /jobs/not-a-uuid/applications` request
- WHEN the request reaches the gated route
- THEN the response is `400 invalid job id` and no row is inserted

#### Scenario: server-managed fields in body are ignored

- GIVEN an authenticated candidate and a published job
- WHEN `POST /jobs/{jobId}/applications` is sent with `{"id":"<other-uuid>","job_id":"<other-uuid>","candidate_id":"<other-uuid>","status":"hired","created_at":"...","updated_at":"...","cv_s3_key":"...","anonymized_at":"..."}`
- THEN the persisted row uses the server-supplied `id`, the path's `job_id`, the JWT-derived `candidate_id`, `status='submitted'`, server `created_at`/`updated_at`, and `cv_s3_key`/`anonymized_at` are NULL

#### Scenario: source absent is stored as NULL

- GIVEN an authenticated candidate and a published job
- WHEN `POST /jobs/{jobId}/applications` is sent with no `source` key
- THEN the persisted row has `source IS NULL`

#### Scenario: source explicit null is stored as NULL

- GIVEN an authenticated candidate and a published job
- WHEN `POST /jobs/{jobId}/applications` is sent with `{"source":null}`
- THEN the persisted row has `source IS NULL` (JSON `null` on the wire maps to SQL `NULL`)

#### Scenario: cover_letter absent is stored as NULL

- GIVEN an authenticated candidate and a published job
- WHEN `POST /jobs/{jobId}/applications` is sent with no `cover_letter` key
- THEN the persisted row has `cover_letter IS NULL`

### Requirement: Candidate Identity Resolution (No IDOR)

The candidate identity MUST resolve only from the JWT `sub` claim via `users.cognito_sub`. The path carries `{jobId}` only — there is no `{candidateId}` path segment and no path/body field can supply a different candidate id. The system MUST reuse the existing `identity.UserRepository.GetByCognitoSub` seam — no new identity port is introduced. An unknown `cognito_sub` (the JWT `sub` matches no live `users.cognito_sub`) MUST yield `401 unauthenticated` (never `500`); the same `ErrUnknownSubject` sentinel already classified by the candidates slice is reused here.

#### Scenario: JWT sub resolves to the apply's candidate

- GIVEN an authenticated user with `cognito_sub=S` that maps to `users.id=U`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the persisted row has `candidate_id=U`

#### Scenario: unknown cognito_sub returns 401

- GIVEN a valid JWT whose `sub` matches no live `users.cognito_sub`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `401 unauthenticated` and no row is inserted (the handler never runs)

#### Scenario: candidate_id in body is ignored

- GIVEN user A is authenticated (`users.id=A`), user B is a different candidate
- WHEN user A sends `POST /jobs/{jobId}/applications` with `{"candidate_id":"<user-B-id>", ...}`
- THEN the persisted row's `candidate_id` is `A`, not `B` (no IDOR — body `candidate_id` is ignored)

### Requirement: Atomic Apply Eligibility Gate

The `applications` row MUST be inserted only when the target job satisfies ALL four visibility predicates ATOMICALLY inside the same SQL statement (no read-then-write TOCTOU window between the gate middleware and the INSERT):

1. `jobs.status='published'`
2. `jobs.deleted_at IS NULL`
3. `companies.status='active'` (joined via `jobs.company_id`)
4. `companies.deleted_at IS NULL` (joined via `jobs.company_id` — the write-side counterpart of the read-side hardening: `SoftDeleteCompany` preserves `status='active'` and only sets the tombstone, so `status='active'` alone is not a live-company gate)

The atomic gate MUST be encoded as an `INSERT ... WHERE EXISTS (SELECT 1 FROM jobs JOIN companies WHERE ...) RETURNING id` shape (or equivalent CTE) — the apply path does NOT use a separate Go-level `GetJobForApply` read; the predicate lives entirely in SQL. A zero-row outcome on the SQL guard MUST surface as the new domain sentinel `entities.ErrJobNotApplicable`, and the HTTP layer MUST map that sentinel to `404` with body `{"error":"job not applicable"}`. A zero-row outcome caused by a missing `jobs` row, a draft/closed/soft-deleted `jobs` row, or a suspended/pending/soft-deleted (tombstoned)/missing `companies` row MUST surface as the same sentinel — the HTTP layer MUST NOT distinguish among these reasons (no existence leak beyond what the public `GET /jobs/{id}` already surfaces).

#### Scenario: published job from active company is applicable

- GIVEN a job with `status='published'`, `deleted_at IS NULL`, and an owning company with `status='active'`
- WHEN `POST /jobs/{jobId}/applications` is sent by an authenticated candidate
- THEN the response is `201 Created` and one row is inserted (the SQL guard produced 1 row)

#### Scenario: draft job is not applicable

- GIVEN a job with `status='draft'`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted

#### Scenario: closed job is not applicable

- GIVEN a job with `status='closed'`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted

#### Scenario: soft-deleted job is not applicable

- GIVEN a job with `deleted_at IS NOT NULL`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted (no re-apply on a soft-deleted job)

#### Scenario: job from suspended company is not applicable

- GIVEN a job with `status='published'`, `deleted_at IS NULL`, and an owning company with `status='suspended'`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted (the gate wins; no row touches the table)

#### Scenario: job from pending_verification company is not applicable

- GIVEN a job with `status='published'`, `deleted_at IS NULL`, and an owning company with `status='pending_verification'`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted

#### Scenario: job from a soft-deleted company is not applicable

- GIVEN a job with `status='published'`, `deleted_at IS NULL`, and an owning company with `status='active'` and `deleted_at IS NOT NULL` (tombstoned — `SoftDeleteCompany` preserves the status and only sets the tombstone)
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted (`status='active'` alone is not a live-company gate — the write-side counterpart of the read-side `companies.deleted_at IS NULL` hardening)

#### Scenario: non-existent job is not applicable

- GIVEN a `{jobId}` UUID that matches no row in `jobs`
- WHEN `POST /jobs/{jobId}/applications` is sent
- THEN the response is `404 job not applicable` and no row is inserted (the SQL guard yields 0 rows; same body shape as draft/closed/soft-deleted/suspended/tombstoned — no leak of existence)

#### Scenario: the eligibility check is atomic with the INSERT

- GIVEN the SQL guard encodes the visibility predicate in the same statement that writes the row (no Go-level read between middleware and INSERT)
- WHEN `POST /jobs/{jobId}/applications` is sent for a job whose company is `active` at the middleware gate but `suspended` immediately after
- THEN the SQL predicate STILL wins — the company was not active at INSERT time, so the INSERT yields 0 rows and the response is `404 job not applicable` (no TOCTOU window)

### Requirement: No Double-Apply

A candidate MUST NOT be able to apply twice to the same job. The structural rule is `UNIQUE(job_id, candidate_id)` on the `applications` table (`applications_job_candidate_unique`). The adapter MUST catch SQLSTATE `23505` from the INSERT and surface it as the new domain sentinel `entities.ErrAlreadyApplied`; the HTTP layer MUST map that sentinel to `409` with body `{"error":"already applied"}`. Because `applications` does not soft-delete in this slice and there is no re-apply path, the UNIQUE constraint is plain (NOT partial). The `23505` branch MUST be checked AFTER the eligibility-gate `pgx.ErrNoRows` branch in `mapCreateError` ordering, mirroring the `mapCreateError` discipline from `jobs-soft-delete` D3 — the gate miss must NOT shadow the UNIQUE violation path; a unit test pins the ordering.

#### Scenario: duplicate apply returns 409

- GIVEN an existing application `(job_id=J, candidate_id=C)`
- WHEN the same candidate sends `POST /jobs/J/applications`
- THEN the response is `409 already applied` and no second row is inserted

#### Scenario: cross-job re-apply is permitted

- GIVEN candidate C has applied to job J1
- WHEN C sends `POST /jobs/J2/applications` (J2 is published and active)
- THEN the response is `201 Created` and a second row `(job_id=J2, candidate_id=C)` exists (UNIQUE is per `(job_id, candidate_id)`, not per `candidate_id` alone)

### Requirement: Apply Domain Validation

The use case MUST enforce the following rules in the domain layer; failure MUST yield `400` with the corresponding sentinel message. No DB CHECK is added for these (the DB does not bound `cover_letter` length in this slice — the application enforces it).

- `cover_letter`, when present and non-null, MUST be non-empty after trimming whitespace and MUST NOT exceed 2000 characters after trim; otherwise `ErrCoverLetterEmpty` or `ErrCoverLetterTooLong` respectively. A `null` cover_letter on the wire is allowed and stored as SQL `NULL`.
- `source`, when present and non-null, MUST parse as one of `referral|linkedin|job_board|direct|other`; otherwise `ErrInvalidSource`. A `null` source on the wire is allowed and stored as SQL `NULL`.

#### Scenario: empty cover_letter is rejected

- GIVEN an authenticated candidate
- WHEN `POST /jobs/{jobId}/applications` is sent with `"cover_letter":"   "` (whitespace only)
- THEN the response is `400` and no row is inserted

#### Scenario: cover_letter exceeding 2000 characters is rejected

- GIVEN an authenticated candidate
- WHEN `POST /jobs/{jobId}/applications` is sent with `"cover_letter":"<a 2001-character string>"`
- THEN the response is `400` and no row is inserted

#### Scenario: cover_letter exactly 2000 characters is accepted

- GIVEN an authenticated candidate
- WHEN `POST /jobs/{jobId}/applications` is sent with `"cover_letter":"<a 2000-character string>"`
- THEN the response is `201 Created` (the boundary is inclusive)

#### Scenario: unknown source is rejected

- GIVEN an authenticated candidate
- WHEN `POST /jobs/{jobId}/applications` is sent with `"source":"newspaper"`
- THEN the response is `400` and no row is inserted

### Requirement: Apply Response

The `POST /jobs/{jobId}/applications` response on success MUST be `201 Created` with the full application row as the body. The body MUST carry `id`, `job_id`, `candidate_id`, `status` (always `'submitted'` on creation), `source` (`null` on the wire if the stored value is `NULL`), `cover_letter` (omitted or `null` if stored `NULL`), `created_at`, and `updated_at`. The body MUST NOT include `cv_s3_key` (the column is reserved; even if non-NULL it is omitted — the slice does not exercise the field). The body MUST NOT include `anonymized_at` (the column is reserved; always NULL and omitted). The `id`, `created_at`, and `updated_at` are server-supplied; the client MUST NOT be allowed to set them.

#### Scenario: 201 body carries the full application row

- GIVEN an authenticated candidate and a published job
- WHEN `POST /jobs/{jobId}/applications` succeeds
- THEN the response body includes `id`, `job_id`, `candidate_id`, `status='submitted'`, `created_at`, `updated_at`, and any optional `source` / `cover_letter` that was supplied

#### Scenario: 201 body omits reserved columns

- GIVEN any successful apply
- WHEN the response body is inspected
- THEN `cv_s3_key` and `anonymized_at` are not present in the body (the slice never sets them)

### Requirement: Apply Error Taxonomy

The HTTP layer MUST classify `POST /jobs/{jobId}/applications` errors into the following status codes. The body MUST carry enough information for the client to surface a useful message.

| Outcome | HTTP status | Body |
|---|---|---|
| Body is not valid JSON | `400` | `{"error":"invalid JSON body"}` |
| `{jobId}` is not a valid UUID | `400` | `{"error":"invalid job id"}` |
| `cover_letter` empty (after trim) or longer than 2000 characters | `400` | `{"error":"<cover_letter_empty or cover_letter_too_long>"}` |
| Unknown `source` value | `400` | `{"error":"invalid source"}` |
| No `Authorization` header / unverifiable token | `401` | `{"error":"unauthenticated"}` |
| JWT `sub` matches no live `users.cognito_sub` | `401` | `{"error":"unauthenticated"}` (reuses the `ErrUnknownSubject` sentinel) |
| Job does not exist OR is not visible (draft / closed / soft-deleted / non-active company / suspended / pending_verification / tombstoned company) | `404` | `{"error":"job not applicable"}` (single body shape for all reasons — no leak) |
| Candidate already applied to this job (`UNIQUE(job_id, candidate_id)` → SQLSTATE `23505`) | `409` | `{"error":"already applied"}` |
| Anything else (DB unavailable, unexpected pg error, missing mapping) | `500` | `{"error":"internal server error"}` (real error logged at `slog.Error`) |

#### Scenario: invalid JSON body returns 400

- GIVEN an authenticated candidate
- WHEN `POST /jobs/{jobId}/applications` is sent with a body that is not valid JSON
- THEN the response is `400 invalid JSON body` and no row is inserted

#### Scenario: 401 short-circuits the handler

- GIVEN a request without `Authorization`
- WHEN `POST /jobs/{jobId}/applications` reaches the server
- THEN the response is `401` and the handler is never invoked

#### Scenario: 404 for non-applicable job does not leak existence

- GIVEN two candidates: one sends `POST /jobs/<draft-job-uuid>/applications` and another sends `POST /jobs/<non-existent-uuid>/applications`
- WHEN both requests reach the apply route
- THEN both responses are `404` with the same body `{"error":"job not applicable"}` (no leak of why the row is not applicable)

#### Scenario: 409 maps the UNIQUE violation correctly

- GIVEN a candidate who has already applied to a published job
- WHEN the candidate sends a second `POST /jobs/{jobId}/applications`
- THEN the response is `409 already applied` and no second row exists (the adapter catches SQLSTATE `23505`; the ordering of `mapCreateError` is pinned by a unit test so the eligibility-gate `pgx.ErrNoRows` branch never shadows the UNIQUE violation)

### Requirement: Apply Route Security Boundary

The `POST /jobs/{jobId}/applications` route MUST be mounted on a per-route middleware subtree (`r.With(requireAuth).Post("/jobs/{jobId}/applications", ...)`), behind `RequireAuth` only — the candidate's company membership is NOT consulted by this route. A request without an `Authorization` header MUST return `401`. The route MUST be mounted on the ROOT router (NOT under `r.Mount("/jobs", ...)`) so the path-prefix collision with the public `GET /jobs/{id}` mount cannot reach it. An AST guard test (`TestApplicationApply_BehindRequireAuth` in `backend/cmd/api/main_test.go`) MUST pin the subtree shape across refactors.

#### Scenario: unauthenticated apply returns 401

- GIVEN a `POST /jobs/{jobId}/applications` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` (not `404`, not `403`)

#### Scenario: apply is not reachable through the public /jobs mount

- GIVEN the composition root mounts the public read surface separately from the apply subtree
- WHEN a `POST /jobs/{jobId}/applications` request reaches the public mount
- THEN the route is not matched by the public mount and the gated subtree is the only path that serves the apply (a structural separation that survives refactors of the composition root)

### Requirement: Candidate My Applications Endpoint

The system MUST expose `GET /me/applications` as a candidate-only read route. The route MUST run behind `RequireAuth`. The handler MUST list the caller's applications — and ONLY the caller's applications — ordered `created_at DESC`. Each item MUST carry `id`, `job_id`, `status`, `source`, `cover_letter`, `created_at`, `updated_at`, plus a tiny `job` summary `{id, title, company: {id, name}}` (see `Candidate My Applications DTO Shape`). The handler MUST NOT redact by `jobs.deleted_at` on purpose: the candidate's own history persists even if the job has since been soft-deleted. The list MUST be capped at 100 rows in this slice (no pagination, no `next_cursor`, no offset — a hard LIMIT). The response MUST be `200 OK` with a top-level `applications` array.

#### Scenario: GET /me/applications lists the caller's applications

- GIVEN an authenticated candidate C with applications on jobs J1 and J2 (J1 created earlier than J2)
- WHEN `GET /me/applications` is sent
- THEN the response is `200` and the `applications` array contains both rows in `created_at DESC` order (J2 first, J1 second)

#### Scenario: GET /me/applications returns only the caller's rows

- GIVEN an authenticated candidate C and a different candidate D with applications on the same job
- WHEN C sends `GET /me/applications`
- THEN the response contains only C's applications (no rows belonging to D)

#### Scenario: GET /me/applications preserves history on a soft-deleted job

- GIVEN candidate C has applied to job J, and J has since been soft-deleted (`jobs.deleted_at IS NOT NULL`)
- WHEN C sends `GET /me/applications`
- THEN the response includes C's application on J (the candidate's own history is not redacted by `jobs.deleted_at`)

#### Scenario: GET /me/applications returns empty list when caller has no applications

- GIVEN an authenticated candidate with no applications
- WHEN `GET /me/applications` is sent
- THEN the response is `200` with `{"applications": []}`

#### Scenario: GET /me/applications hard-caps at 100 rows

- GIVEN an authenticated candidate with 150 applications
- WHEN `GET /me/applications` is sent
- THEN the response is `200` with the 100 most-recent applications (no pagination cursor in this slice)

#### Scenario: unauthenticated GET /me/applications returns 401

- GIVEN a `GET /me/applications` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` and the handler is never invoked

#### Scenario: unknown cognito_sub returns 401

- GIVEN a valid JWT whose `sub` matches no live `users.cognito_sub`
- WHEN `GET /me/applications` is sent
- THEN the response is `401` (the same `ErrUnknownSubject` sentinel reused from the candidates slice)

### Requirement: Candidate My Applications DTO Shape

Each item in the `applications` array MUST carry: `id` (UUID), `job_id` (UUID), `status` (one of the closed vocabulary), `source` (`null` on the wire if stored `NULL`), `cover_letter` (`null` on the wire if stored `NULL`), `created_at` (RFC 3339), `updated_at` (RFC 3339). The item MUST embed a `job` summary with `id` (UUID), `title` (string), and `company: {id, name}`. The job summary MUST omit other job fields (no `description`, no `salary_*`, no `work_mode`, no `employment_type`, no `seniority`, no `location`, no `published_at`, no `deleted_at`, no `status`); this DTO is a thin pointer back to the job, NOT a re-projection of the public `JobDetailDto`. The `cv_s3_key` and `anonymized_at` columns MUST NOT appear in the DTO.

#### Scenario: list item carries job summary and application fields

- GIVEN an application `(id=A, job_id=J, candidate_id=C, status='in_review', source='linkedin', cover_letter='Hi')` for a job titled `'Senior Go Engineer'` owned by company `'Acme'`
- WHEN `GET /me/applications` returns
- THEN the corresponding item has `id=A`, `job_id=J`, `status='in_review'`, `source='linkedin'`, `cover_letter='Hi'`, and `job: {id: J, title: 'Senior Go Engineer', company: {id: <Acme id>, name: 'Acme'}}`

#### Scenario: list item omits reserved and extraneous fields

- GIVEN any application in the response
- WHEN the item is inspected
- THEN `cv_s3_key`, `anonymized_at`, and the public `JobDetailDto` extra fields (`description`, `salary_*`, `work_mode`, `employment_type`, `seniority`, `location`, `published_at`, `deleted_at`, `status`) are not present

### Requirement: Recruiter List Endpoint

The system MUST expose `GET /jobs/{jobId}/applications` as a recruiter-only read route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(recruiter)`. The handler MUST scope the read by the caller's `CompanyContext.company_id` AND the path `{jobId}`: the listing is the set of applications whose `job_id` equals the path's `{jobId}` AND whose job is owned by the caller's company. The list MUST be ordered `created_at DESC`. Each item MUST carry `id`, `job_id`, `candidate_id`, `status`, `source`, `cover_letter`, `created_at`, `updated_at`, plus a small `candidate` snippet (see `Recruiter Detail PII Minimization`). The list MUST be capped at 100 rows in this slice (no pagination). The response MUST be `200 OK` with a top-level `applications` array.

#### Scenario: recruiter lists own company's job applications

- GIVEN a recruiter membership in company A and a job J owned by A with applications from candidates C1 and C2 (C1 applied first)
- WHEN `GET /jobs/J/applications` is sent
- THEN the response is `200` and the `applications` array contains both rows in `created_at DESC` order (C2 first, C1 second)

#### Scenario: no Authorization header returns 401

- GIVEN a `GET /jobs/{jobId}/applications` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` and the handler is never invoked

#### Scenario: authenticated but not a member returns 403

- GIVEN an authenticated user with no `company_members` row
- WHEN `GET /jobs/{jobId}/applications` is sent
- THEN the response is `403` and the handler is never invoked (the middleware short-circuits)

#### Scenario: member with role below recruiter returns 403

- GIVEN an authenticated user with a `company_members` role below `recruiter` (a future role; today only `owner` and `recruiter` exist, but the gate MUST still reject any future role below the threshold)
- WHEN `GET /jobs/{jobId}/applications` is sent
- THEN the response is `403`

#### Scenario: invalid job id returns 400

- GIVEN a request to `GET /jobs/not-a-uuid/applications`
- WHEN the request reaches the gated route
- THEN the response is `400 invalid job id` and no query runs

#### Scenario: own-company job with zero applications returns 200 empty

- GIVEN a recruiter of company A and a job J owned by A with no applications
- WHEN `GET /jobs/J/applications` is sent
- THEN the response is `200` with `{"applications": []}` (the `404` body shape is reserved for cross-company / non-existent cases)

### Requirement: Recruiter List Same-Company Invariant

A recruiter of company A MUST NOT be able to list applications for a job owned by company B; the response MUST be `404` (NOT `403`) with the same body shape as a non-existent job — this prevents existence leak across companies (mirrors the canonical `Same-Company Invariant and IDOR Defense` for `PATCH /jobs/{id}`). A cross-company read MUST surface as the new domain sentinel `entities.ErrApplicationNotFound` and the HTTP layer MUST map it to `404` with body `{"error":"application not found"}`. The same response body shape MUST be used for cross-company jobs and non-existent job ids — no leak.

#### Scenario: cross-company job returns 404

- GIVEN a recruiter of company A and a job J owned by company B
- WHEN `GET /jobs/J/applications` is sent
- THEN the response is `404 application not found` and no application rows are projected (the same `(jobId, companyID)` same-company pattern from the canonical `GetForUpdate` is reused; the adapter SQL joins `applications` with `jobs` and filters by the caller's `company_id` from `CompanyContext`)

#### Scenario: non-existent job id returns 404

- GIVEN a recruiter of any company and a `{jobId}` UUID that matches no row in `jobs`
- WHEN `GET /jobs/{jobId}/applications` is sent
- THEN the response is `404 application not found` (same body shape as cross-company — no leak)

### Requirement: Recruiter List Cap

The list returned by `GET /jobs/{jobId}/applications` MUST be capped at 100 rows. No pagination cursor, no `next_cursor`, no offset — a hard `LIMIT`. The cap applies to the full ordered set (ordered `created_at DESC`); rows beyond the cap are silently omitted. If the queue grows past 100 in production, keyset pagination is a follow-up slice.

#### Scenario: hard cap is 100 rows

- GIVEN a recruiter of company A and a job J with 150 applications
- WHEN `GET /jobs/J/applications` is sent
- THEN the response is `200` with exactly 100 items (the 100 most recent)

### Requirement: Soft-Deleted Job Applications Stay Recruiter-Accessible

When a job is soft-deleted (`jobs.deleted_at IS NOT NULL`), `GET /jobs/{jobId}/applications` for the owning recruiter MUST continue to return the applications (audit history). `POST /jobs/{jobId}/applications` (apply) MUST continue to return `404 job not applicable` (the apply gate excludes soft-deleted rows — see `Atomic Apply Eligibility Gate`). `PATCH /jobs/{jobId}/applications/{id}/transition` MUST continue to be allowed (transitions on applications of soft-deleted jobs remain legal — historical pipeline). This asymmetry is intentional: applying requires a published job, but reviewing past applications does not. Cross-company / non-existent rules from `Recruiter List Same-Company Invariant` and `Recruiter Detail Same-Company Invariant` are unchanged.

#### Scenario: applications on a soft-deleted job remain visible to the recruiter

- GIVEN a recruiter of company A and a soft-deleted job J (`deleted_at IS NOT NULL`) owned by A with two applications
- WHEN `GET /jobs/J/applications` is sent
- THEN the response is `200` with both rows (soft-delete does NOT hide the historical pipeline)

#### Scenario: applying to a soft-deleted job is still rejected (cross-reference)

- GIVEN a soft-deleted job J owned by company A
- WHEN a candidate sends `POST /jobs/J/applications`
- THEN the response is `404 job not applicable` (the atomic gate excludes soft-deleted rows)

#### Scenario: transition on a soft-deleted job's application is still allowed

- GIVEN a recruiter of company A and an `in_review` application on a soft-deleted job J owned by A
- WHEN the recruiter sends `PATCH /jobs/J/applications/{id}/transition` with `{"status":"hired"}`
- THEN the response is `200` with the updated application (the soft-delete of the parent job does NOT lock the application's status; recruiters continue to close out historical pipelines)

### Requirement: Recruiter Detail Endpoint

The system MUST expose `GET /jobs/{jobId}/applications/{id}` as a recruiter-only read route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(recruiter)`. The handler MUST scope the read by the caller's `CompanyContext.company_id`, the path `{jobId}`, AND the path `{id}`: the row's `job_id` MUST equal `{jobId}` and that job MUST be owned by the caller's company. On success the response MUST be `200 OK` with the full application row and the joined candidate snippet.

#### Scenario: recruiter gets an application's detail

- GIVEN a recruiter of company A and an application A1 on a job J owned by A
- WHEN `GET /jobs/J/applications/A1` is sent
- THEN the response is `200` with the application row, `status`, timestamps, and the joined `candidate` snippet

#### Scenario: no Authorization header returns 401

- GIVEN a `GET /jobs/{jobId}/applications/{id}` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` and the handler is never invoked

#### Scenario: authenticated but not a member returns 403

- GIVEN an authenticated user with no `company_members` row
- WHEN `GET /jobs/{jobId}/applications/{id}` is sent
- THEN the response is `403` and the handler is never invoked

#### Scenario: invalid job id returns 400

- GIVEN a request to `GET /jobs/not-a-uuid/applications/{id}`
- WHEN the request reaches the gated route
- THEN the response is `400 invalid job id` and no query runs

#### Scenario: invalid application id returns 400

- GIVEN a request to `GET /jobs/{jobId}/applications/not-a-uuid`
- WHEN the request reaches the gated route
- THEN the response is `400 invalid application id` and no query runs

### Requirement: Recruiter Detail Same-Company Invariant

A recruiter of company A MUST NOT be able to fetch an application that belongs to a job owned by company B. The response MUST be `404 application not found` (NOT `403`) with the same body shape as a non-existent application — the same defense as `PATCH /jobs/{id}` and `GET /jobs/{jobId}/applications`. The cross-company check MUST be encoded as a single SQL predicate joining `applications`, `jobs`, and the caller's `company_id` from `CompanyContext` (no Go-level pre-check that would leak the row's existence).

#### Scenario: cross-company application returns 404

- GIVEN a recruiter of company A and an application on a job owned by company B
- WHEN `GET /jobs/{B-job-id}/applications/{A1}` is sent
- THEN the response is `404 application not found` and no application row is projected (no `candidate` snippet, no `status` — identical body shape to a non-existent id)

#### Scenario: application id with a mismatched job id returns 404

- GIVEN a recruiter of company A, an application A1 on job J1 (owned by A), and a different job J2 (also owned by A but with no applications)
- WHEN `GET /jobs/J2/applications/A1` is sent
- THEN the response is `404 application not found` (the row's `job_id` does not match the path's `{jobId}` — same body shape as non-existent)

#### Scenario: non-existent application id returns 404

- GIVEN a recruiter of company A and an `{id}` UUID that matches no row in `applications`
- WHEN `GET /jobs/{jobId}/applications/{id}` is sent
- THEN the response is `404 application not found` (same body shape as cross-company — no leak)

### Requirement: Recruiter Detail PII Minimization

The recruiter detail response MUST join `users` (for `full_name`) and `candidate_profiles` (LEFT JOIN — a candidate without a profile still surfaces their `users` row) to render a `candidate` snippet. The snippet MUST carry: `user_id` (UUID), `full_name` (string), `professional_title` (string, `null` on the wire if `candidate_profiles.professional_title IS NULL`), `years_of_experience` (integer, `null` on the wire if `candidate_profiles.years_of_experience IS NULL`). The snippet MUST NOT carry `salary_*`, `birth_date`, `phone`, `email`, `skills`, `languages`, `expected_salary`, `expected_salary_period`, `education_level`, `city`, `address`, `bio`, or any other PII field from `candidate_profiles` or `users`. The full profile is reachable by a future `/me/candidates/{id}` slice on the candidates feature side and is NOT in this slice.

#### Scenario: candidate snippet renders professional_title and years_of_experience only

- GIVEN an application with a candidate who has a `candidate_profiles` row with `professional_title='Senior Go Engineer'`, `years_of_experience=7`, `salary_min=1000`, `birth_date='1990-01-01'`
- WHEN `GET /jobs/{jobId}/applications/{id}` returns
- THEN the `candidate` object has `user_id`, `full_name`, `professional_title='Senior Go Engineer'`, `years_of_experience=7` and does NOT have `salary_min`, `birth_date`, `phone`, `email`, `skills`, `languages`, `expected_salary`, `city`, `address`, or `bio`

#### Scenario: candidate without a profile still renders user fields

- GIVEN an application with a candidate who has NO `candidate_profiles` row
- WHEN `GET /jobs/{jobId}/applications/{id}` returns
- THEN the `candidate` object has `user_id` and `full_name` (from `users`); `professional_title` and `years_of_experience` are `null` on the wire (LEFT JOIN yields NULL for the missing row)

### Requirement: Recruiter Transition Endpoint

The system MUST expose `PATCH /jobs/{jobId}/applications/{id}/transition` as a recruiter-only write route. The route MUST run behind `RequireAuth` followed by `RequireCompanyRole(recruiter)`. The body MUST carry `status` (one of `in_review|rejected|hired`; the use case MUST reject `submitted` because the slice does not allow back-edges). The path `{jobId}` MUST be parsed as a UUID; non-UUID values yield `400 invalid job id`. The path `{id}` MUST be parsed as a UUID; non-UUID values yield `400 invalid application id`. The handler MUST scope the write by the caller's `CompanyContext.company_id`, the path `{jobId}`, AND the path `{id}`: the row's `job_id` MUST equal `{jobId}` and that job MUST be owned by the caller's company. There is NO CAS guard on transitions (low-contention, monotonic in the happy path; the response surfaces the new state so the client can re-fetch on a lost race — see `Recruiter Transition Lost Race`).

#### Scenario: recruiter transitions submitted → in_review

- GIVEN a recruiter of company A and a `submitted` application A1 on a job J owned by A
- WHEN `PATCH /jobs/J/applications/A1/transition` is sent with `{"status":"in_review"}`
- THEN the response is `200` with the updated application (`status='in_review'`, fresh `updated_at`)

#### Scenario: recruiter transitions in_review → rejected

- GIVEN a recruiter of company A and an `in_review` application A1 on a job J owned by A
- WHEN `PATCH /jobs/J/applications/A1/transition` is sent with `{"status":"rejected"}`
- THEN the response is `200` with `status='rejected'` (terminal)

#### Scenario: recruiter transitions in_review → hired

- GIVEN a recruiter of company A and an `in_review` application A1 on a job J owned by A
- WHEN `PATCH /jobs/J/applications/A1/transition` is sent with `{"status":"hired"}`
- THEN the response is `200` with `status='hired'` (terminal)

#### Scenario: no Authorization header returns 401

- GIVEN a `PATCH /jobs/{jobId}/applications/{id}/transition` request with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` and the handler is never invoked

#### Scenario: authenticated but not a member returns 403

- GIVEN an authenticated user with no `company_members` row
- WHEN `PATCH /jobs/{jobId}/applications/{id}/transition` is sent
- THEN the response is `403` and the handler is never invoked

#### Scenario: invalid job id returns 400

- GIVEN a request to `PATCH /jobs/not-a-uuid/applications/{id}/transition`
- WHEN the request reaches the gated route
- THEN the response is `400 invalid job id`

#### Scenario: invalid application id returns 400

- GIVEN a request to `PATCH /jobs/{jobId}/applications/not-a-uuid/transition`
- WHEN the request reaches the gated route
- THEN the response is `400 invalid application id`

### Requirement: Recruiter Transition Matrix Enforcement

The use case MUST enforce the matrix from `Status Transition Matrix` exactly. Each illegal transition MUST yield `400 invalid status transition` with a body that names the offending transition (`{"error":"invalid status transition: <from> -> <to>"}`). The DB does NOT add a separate transition CHECK (the closed vocabulary is enforced by `applications_status_check`; the transition matrix is a use-case-level invariant). Illegal transitions include: `submitted → rejected`, `submitted → hired`, `in_review → submitted`, `rejected → anything`, `hired → anything`, and `same → same` (no-op self-transition). Legal transitions: `submitted → in_review`, `in_review → rejected`, `in_review → hired`. The body field name `status` is preserved as the use case's `TransitionRequestDto` input.

#### Scenario: submitted → rejected is rejected with 400

- GIVEN a `submitted` application
- WHEN the recruiter sends `{"status":"rejected"}`
- THEN the response is `400 invalid status transition`

#### Scenario: submitted → hired is rejected with 400

- GIVEN a `submitted` application
- WHEN the recruiter sends `{"status":"hired"}`
- THEN the response is `400 invalid status transition`

#### Scenario: in_review → submitted is rejected with 400

- GIVEN an `in_review` application
- WHEN the recruiter sends `{"status":"submitted"}`
- THEN the response is `400 invalid status transition`

#### Scenario: rejected → in_review is rejected with 400

- GIVEN a `rejected` application
- WHEN the recruiter sends `{"status":"in_review"}`
- THEN the response is `400 invalid status transition`

#### Scenario: hired → rejected is rejected with 400

- GIVEN a `hired` application
- WHEN the recruiter sends `{"status":"rejected"}`
- THEN the response is `400 invalid status transition`

#### Scenario: no-op self-transition is rejected with 400

- GIVEN an `in_review` application
- WHEN the recruiter sends `{"status":"in_review"}`
- THEN the response is `400 invalid status transition`

#### Scenario: missing status field is rejected with 400

- GIVEN any application
- WHEN the recruiter sends `PATCH .../transition` with `{}` (no `status` key)
- THEN the response is `400 status is required`

#### Scenario: unknown status value is rejected with 400

- GIVEN an `in_review` application
- WHEN the recruiter sends `{"status":"withdrawn"}`
- THEN the response is `400 invalid status transition` (the closed vocabulary is enforced)

### Requirement: Recruiter Transition Lost Race

The slice does NOT implement optimistic concurrency control on transitions (no `If-Unmodified-Since` header is required, no `version` field, no CAS token). Status moves are low-contention and monotonic in the happy path; the response surfaces the new state so the client can re-fetch on a stale view. The SQL `UPDATE` MUST include a `WHERE status = <expected current>` guard: if the row collapses under us (concurrent transition by another recruiter), the update yields 0 rows and the adapter MUST map that to `entities.ErrApplicationNotFound` (the row was just transitioned). The HTTP layer MUST map that sentinel to `404 application not found` with the same body shape as a non-existent application — identical to the cross-company / non-existent case. The slice deliberately does NOT embed a CAS token in the transition response; the recruiter re-reads via `GET /jobs/{jobId}/applications/{id}`.

#### Scenario: concurrent transition by two recruiters of the same company

- GIVEN a `submitted` application A1 and two recruiters R1 and R2 of the owning company, both sending `PATCH .../transition` with `{"status":"in_review"}` at the same time
- WHEN both requests reach the SQL guard
- THEN exactly one response is `200` with `status='in_review'` and the other is `404 application not found` (the second writer's `WHERE status='submitted'` clause sees the now-`in_review` row, yields 0 rows, and the adapter maps to `ErrApplicationNotFound`)

#### Scenario: lost race allows the recruiter to re-fetch

- GIVEN a recruiter R who received `404 application not found` from a transition (lost race)
- WHEN R immediately re-reads the application via `GET /jobs/{jobId}/applications/{id}`
- THEN the response is `200` with the current `status`

### Requirement: Recruiter Transition Same-Company Invariant

A recruiter of company A MUST NOT be able to transition an application that belongs to a job owned by company B. The response MUST be `404 application not found` (NOT `403`) with the same body shape as a non-existent application. This is the same defense as `Recruiter Detail Same-Company Invariant`: the read-for-update MUST be scoped by `(jobId, companyID)` so a cross-company target cannot leak the row's existence.

#### Scenario: cross-company transition returns 404

- GIVEN a recruiter of company A and an `in_review` application on a job owned by company B
- WHEN the recruiter sends `PATCH /jobs/{B-job-id}/applications/{A1}/transition` with `{"status":"rejected"}`
- THEN the response is `404 application not found` and the row's `status` is unchanged

#### Scenario: non-existent application transition returns 404

- GIVEN a recruiter of company A and an `{id}` UUID that matches no row in `applications`
- WHEN the recruiter sends `PATCH /jobs/{jobId}/applications/{id}/transition` with `{"status":"rejected"}`
- THEN the response is `404 application not found` (same body shape as cross-company — no leak)

### Requirement: Recruiter Transition Error Taxonomy

The HTTP layer MUST classify `PATCH /jobs/{jobId}/applications/{id}/transition` errors into the following status codes.

| Outcome | HTTP status | Body |
|---|---|---|
| Body is not valid JSON | `400` | `{"error":"invalid JSON body"}` |
| `{jobId}` is not a valid UUID | `400` | `{"error":"invalid job id"}` |
| `{id}` is not a valid UUID | `400` | `{"error":"invalid application id"}` |
| Missing `status` field in body | `400` | `{"error":"status is required"}` |
| Unknown `status` value | `400` | `{"error":"invalid status transition: <from> -> <to>"}` |
| Illegal transition per `Status Transition Matrix` | `400` | `{"error":"invalid status transition: <from> -> <to>"}` |
| No `Authorization` header / unverifiable token | `401` | `{"error":"unauthenticated"}` |
| JWT `sub` matches no live `users.cognito_sub` | `401` | `{"error":"unauthenticated"}` |
| Authenticated but not a member / role below `recruiter` | `403` | `{"error":"<not a member / role too low>"}` |
| Cross-company target, non-existent id, or lost-race `WHERE status` guard (zero rows on the SQL UPDATE) | `404` | `{"error":"application not found"}` (single body shape — no leak) |
| Anything else (DB unavailable, unexpected pg error) | `500` | `{"error":"internal server error"}` (real error logged at `slog.Error`) |

#### Scenario: invalid JSON body returns 400

- GIVEN a recruiter of company A
- WHEN `PATCH /jobs/J/applications/A1/transition` is sent with a body that is not valid JSON
- THEN the response is `400 invalid JSON body` and no row is updated

#### Scenario: 401 short-circuits the handler

- GIVEN a request without `Authorization`
- WHEN `PATCH /jobs/{jobId}/applications/{id}/transition` reaches the server
- THEN the response is `401` and the handler is never invoked

#### Scenario: 404 is identical for cross-company, non-existent, and lost-race

- GIVEN a recruiter of company A
- WHEN one request targets a job owned by B, one targets a non-existent id, and one is a lost-race transition (concurrent recruiter just moved the row)
- THEN all three responses are `404 application not found` with identical body shape (no leak of which case triggered the 404)

### Requirement: Recruiter Route Security Boundary

The recruiter subtree (`GET /jobs/{jobId}/applications`, `GET /jobs/{jobId}/applications/{id}`, `PATCH /jobs/{jobId}/applications/{id}/transition`) MUST be mounted on a per-route middleware subtree (`r.With(requireAuth, requireRecruiter).Route("/jobs/{jobId}/applications", ...)`), behind `RequireAuth` + `RequireCompanyRole(recruiter)`. The subtree MUST be mounted on the ROOT router (NOT under `r.Mount("/jobs", ...)`) so the path-prefix collision with the public `GET /jobs/{id}` mount cannot reach it. An AST guard test (`TestApplicationRoutes_AllRecruiterGated` in `backend/cmd/api/main_test.go`) MUST pin the subtree shape across refactors: every method declared on the subtree MUST be wrapped by the recruiter gate.

#### Scenario: unauthenticated recruiter route returns 401

- GIVEN any of `GET /jobs/{jobId}/applications`, `GET /jobs/{jobId}/applications/{id}`, `PATCH /jobs/{jobId}/applications/{id}/transition` with no `Authorization` header
- WHEN the request reaches the server
- THEN the response is `401` (not `404`, not `403`)

#### Scenario: authenticated non-member returns 403

- GIVEN any of the three recruiter routes and an authenticated user with no `company_members` row
- WHEN the request reaches the gated subtree
- THEN the response is `403` and the handler is never invoked

#### Scenario: recruiter subtree is not reachable through the public /jobs mount

- GIVEN the composition root mounts the public read surface separately from the recruiter subtree
- WHEN a `GET /jobs/{jobId}/applications` request reaches the public mount
- THEN the route is not matched by the public mount and the gated subtree is the only path that serves it (a structural separation that survives refactors of the composition root)

### Requirement: ApplicationSubmitted Audit Emission

`applyToJob` (`POST /jobs/{jobId}/applications`) MUST, on a `201 Created`, append exactly one `ApplicationSubmitted` audit event in the same database transaction as the application INSERT. The event MUST carry: `event_type='ApplicationSubmitted'`, `entity_type='application'`, `entity_id` = the new application row's `id`, `actor_type='user'`, `actor_id` = the candidate's `users.id` (the same JWT-resolved identity used for `candidate_id`), and `metadata` per the `audit_events` metadata contract (`job_id` always; `source` only when the application row's `source` is non-NULL; never `cover_letter` or candidate PII). `occurred_at` is server time (`now()`). A `400` / `401` / `403` / `404` / `409` outcome MUST append no event — the application write never happened, so there is nothing to audit.

#### Scenario: successful apply appends exactly one ApplicationSubmitted event

- GIVEN a valid JWT candidate, a published job from an active company, and a request body with optional `source` and `cover_letter`
- WHEN `POST /jobs/{jobId}/applications` succeeds with `201 Created`
- THEN exactly one `audit_events` row exists with `event_type='ApplicationSubmitted'`, `entity_type='application'`, `entity_id=<new application.id>`, `actor_type='user'`, `actor_id=<candidate users.id>`, and `occurred_at` within the request window

#### Scenario: metadata carries job_id and source when source was supplied

- GIVEN a successful apply with `"source":"linkedin"`
- WHEN the `201 Created` response is returned
- THEN the appended event's `metadata` is exactly `{"job_id": <jobId>, "source": "linkedin"}`

#### Scenario: metadata carries job_id only when source is NULL

- GIVEN a successful apply with no `source` key in the body
- WHEN the `201 Created` response is returned
- THEN the appended event's `metadata` is exactly `{"job_id": <jobId>}` (no `source` key — the minimal PII-free shape)

#### Scenario: cover_letter never enters the event metadata

- GIVEN a successful apply that supplied a `cover_letter`
- WHEN the `201 Created` response is returned
- THEN the appended event's `metadata` contains no `cover_letter` key and no candidate PII (the event builder never receives `cover_letter`)

### Requirement: ApplicationTransitioned Audit Emission

`transitionApplication` (`PATCH /jobs/{jobId}/applications/{id}/transition`) MUST, on a `200 OK`, append exactly one `ApplicationTransitioned` audit event in the same database transaction as the application UPDATE. The event MUST carry: `event_type='ApplicationTransitioned'`, `entity_type='application'`, `entity_id` = the transitioned application row's `id`, `actor_type='user'`, `actor_id` = the acting recruiter's `users.id` (from `CompanyContext.UserID` — see `Transition Actor Identity`), and `metadata` exactly `{"job_id": <jobId>, "from_status": <pre-transition status>, "to_status": <new status>}`. The event MUST be appended for every legal transition (`submitted → in_review`, `in_review → rejected`, `in_review → hired` — including terminal ones). A `400` (illegal transition / validation), `401`, `403`, or `404` (cross-company, non-existent, or lost race) outcome MUST append no event.

#### Scenario: successful transition appends exactly one ApplicationTransitioned event

- GIVEN a recruiter of company A and an `in_review` application A1 on a job J owned by A
- WHEN `PATCH /jobs/J/applications/A1/transition` with `{"status":"rejected"}` returns `200`
- THEN exactly one `audit_events` row exists with `event_type='ApplicationTransitioned'`, `entity_type='application'`, `entity_id=A1`, `actor_type='user'`, `actor_id=<recruiter users.id>`, and `metadata={"job_id": J, "from_status": "in_review", "to_status": "rejected"}`

#### Scenario: every legal transition appends exactly one event

- GIVEN the three legal transitions applied across applications (`submitted → in_review`, `in_review → rejected`, `in_review → hired`)
- WHEN each `PATCH .../transition` returns `200`
- THEN each application has exactly one `ApplicationTransitioned` row and each row's `from_status` is the pre-transition status and `to_status` is the new status (terminal transitions are audited too)

#### Scenario: a lost-race 404 appends no event

- GIVEN two recruiters of company A transition the same `submitted` application concurrently
- WHEN one response is `200` and the other is `404 application not found`
- THEN exactly one `ApplicationTransitioned` row exists (the winner's) and the loser's attempted transition left no audit row

### Requirement: Transition Actor Identity (CompanyContext UserID)

The `security.CompanyContext` on the transition path MUST carry the acting user's `users.id` as `UserID` in addition to the existing `company_id` and `role` — an additive identity change; no existing field is removed, re-typed, or re-sourced. The `ApplicationTransitioned` event's `actor_id` MUST be that `CompanyContext.UserID` with `actor_type='user'`. The handler MUST NOT accept an `actor_id` from the request body or path (the actor comes exclusively from the authenticated session). A request that reaches the transition use case without a resolvable `CompanyContext.UserID` MUST fail closed: `500 internal server error`, no status change, no audit event.

#### Scenario: the acting recruiter's users.id is recorded

- GIVEN recruiter R (`users.id=R`) of company A transitions an application owned by A with `200`
- WHEN the appended event is inspected
- THEN `actor_id=R` and `actor_type='user'` (the actor comes from `CompanyContext.UserID`, not from any request-supplied value)

#### Scenario: actor_id in the request body is ignored

- GIVEN a transition request body carrying an `"actor_id"` field
- WHEN the transition succeeds with `200`
- THEN the appended event's `actor_id` is the authenticated recruiter's `users.id`, not the body value

#### Scenario: missing CompanyContext.UserID fails closed

- GIVEN a transition request that reaches the use case without a resolvable `CompanyContext.UserID`
- WHEN the handler runs
- THEN the response is `500 internal server error`, the application row's `status` is unchanged, and no audit event exists

### Requirement: Fail-Closed Application + Audit Co-Write

The application write (the INSERT on apply, the UPDATE on transition) and its audit event MUST commit atomically in the same database transaction, and the applications adapter MUST own that transaction. If the audit INSERT fails for any reason, the whole transaction MUST roll back: no application row (apply) or no status change (transition) AND no audit event, and the HTTP response MUST be `500 internal server error` with the real error logged at `slog.Error`. The system MUST NOT commit an application write without its audit trail (fail-closed — the audit event is not best-effort). Conversely, a committed application write MUST have exactly one audit event (no duplication, no silent gap). No event is appended for any non-write outcome: `400` (validation / illegal transition), `401`, `403`, `404` (gate miss / cross-company / lost race), or `409` (already applied) — the application write never happened, so no audit row exists.

#### Scenario: an audit INSERT failure rolls back the application write

- GIVEN the `audit_events` INSERT fails (DB constraint, unavailable table, or unexpected pg error)
- WHEN `POST /jobs/{jobId}/applications` or `PATCH .../transition` reaches the co-write
- THEN the response is `500 internal server error`, no application row exists (apply) or the `status` is unchanged (transition), and no `audit_events` row exists (atomic rollback — the write and the event stand or fall together)

#### Scenario: a committed write implies exactly one event

- GIVEN a successful apply or transition (the co-write transaction committed)
- WHEN the `audit_events` table is queried for that application
- THEN exactly one audit row exists for that write (one event per committed write; a rollback leaves zero — no duplication, no silent gap)

#### Scenario: non-write outcomes append no event

- GIVEN each of: an illegal transition (`400`), a non-applicable job (`404 job not applicable`), a duplicate apply (`409 already applied`), an unauthenticated request (`401`), and a non-member request (`403`)
- WHEN the request reaches its route
- THEN the response is the pinned status AND no `audit_events` row is inserted (the application write never happened, so there is nothing to audit)
