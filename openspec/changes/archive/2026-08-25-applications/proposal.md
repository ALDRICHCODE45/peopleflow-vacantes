# Proposal: `applications` — Job Applications (candidate submit + recruiter pipeline)

## Intent

Deliver the **job applications** bounded context — the bridge between candidates and jobs. A candidate applies to a published job; a recruiter manages applications for their company's jobs and moves them through a three-step pipeline. This is the next roadmap item (`docs/ROADMAP.md` §"QUÉ SIGUE" #5) and every prerequisite is already delivered: `company_members` (recruiter role), `jobs` full write side (incl. POST/PATCH/DELETE with CAS + atomic active-company gate), `candidates /me/profile` (self-service profile), and `RequireAuth` on the `/me/*` subtree.

The first slice delivers an end-to-end, reviewable candidate-apply + recruiter-manage flow so we don't ship a candidate apply that has no recruiter destination.

## Scope (first slice)

- **Candidate apply.** `POST /jobs/{jobId}/applications` behind `RequireAuth`. Resolves the candidate from JWT `sub` → `users.id` (mirrors `candidates /me/*`). Atomic SQL gate ensuring the target job is `status='published'` AND `deleted_at IS NULL` AND the owning company is `status='active'` (same rule the read side uses, enforced at INSERT — no TOCTOU). Rejects re-application with `409` via `UNIQUE(job_id, candidate_id)`.
- **Candidate self-view.** `GET /me/applications` behind `RequireAuth`. List the caller's applications ordered `created_at DESC`; each row carries `status` and a tiny `job` summary `{id, title, company: {id, name}}`. Does NOT redact by `jobs.deleted_at` on purpose: the candidate's own history persists even if the job is later soft-deleted.
- **Recruiter list — one job's applications.** `GET /jobs/{jobId}/applications` behind `RequireAuth + RequireCompanyRole(recruiter)`. Lists submissions to a job the recruiter's company owns. Body items carry the application + a small `candidate` snippet (no PII like salary/birth_date, just `user_id` + `full_name` + `professional_title` + `years_of_experience`), so the recruiter can act on a queue without rendering the full profile.
- **Recruiter detail.** `GET /jobs/{jobId}/applications/{id}` behind the same gate. Returns the full row plus the joined candidate profile.
- **Recruiter transition.** `PATCH /jobs/{jobId}/applications/{id}/transition` body `{status: "in_review"|"rejected"|"hired"}` behind the same gate. Three edges allowed: `submitted → in_review`, `in_review → rejected`, `in_review → hired`. `submitted → rejected` and `submitted → hired` are explicitly REJECTED with `400` (a recruiter must first review). `rejected` and `hired` are terminal. Response is `200` with the updated application + the queued `updated_at`.
- **Schema.** Migration `00010_create_applications.sql` materializes the table designed in `docs/modelo-de-datos-proyecto-04.md` §3.8 verbatim (columns, CHECKs, UNIQUE, both B-tree indexes).
- **Wire**: split the recruiter subtree `r.With(requireAuth, requireRecruiter).Route("/jobs/{jobId}/applications", ...)` from the public `GET /jobs/{id}` mount via per-route `Routes()` accessor + AST guard test (same defense `jobs-soft-delete` used).
- **NO CAS on transitions.** Status moves are low-contention and monotonic in the happy path; the response itself projects the new state, so there is no editor view to send back on a stale view. If a row collapses under us, we surface `ErrApplicationNotFound` (the row was just deleted/tombstoned) and let the recruiter re-fetch.

### First-slice boundaries

| Belongs in this slice (✅) | Out of scope (explicit non-goals) |
|---|---|
| Migration `00010` (applications schema, EXACTLY the spec design) | CV upload / S3 storage (the `cv_s3_key` column is created NULL-only; populating it is a later slice) |
| `POST /jobs/{jobId}/applications` (candidate submit, atomic gate) | LFPDPPP `anonymized_at` flow + CV S3 delete |
| `GET /me/applications` (candidate's own list) | `audit_events` integration (`ApplicationSubmitted` etc.) |
| `GET /jobs/{jobId}/applications` (recruiter queue) | In-process domain events + EventBridge (`ApplicationSubmitted` → notify recruiter) |
| `GET /jobs/{jobId}/applications/{id}` (recruiter detail) | Candidate withdraw / cancel endpoint |
| `PATCH /jobs/{jobId}/applications/{id}/transition` (recruiter state machine) | Re-apply after rejection, reopen a `hired`/`rejected` row |
| `PATCH /applications/{id}` re-apply on a soft-deleted job (job QA) | Stage columns (`reviewed_at`, `hired_at`, `rejected_at`) |
| Status CHECK in DB + VO `ApplicationStatus` + transition matrix in use case | Bulk transitions / multi-row updates |
| UNIQUE `(job_id, candidate_id)` (no double-apply) | Source-attribution analytics / funnel reports |
| Same-company invariant (recruiter can only manage applications TO their company's jobs) | Public applications listing |
| Stub-driven unit tests + handler tests + integration tests (per `openspec/config.yaml` strict_tdd) | Frontend changes, SQS worker, email |

### Affected areas

| Path | Operation | Purpose |
|---|---|---|
| `backend/db/migrations/00010_create_applications.sql` | NEW | Schema: `applications` table + indexes; `goose Up` mirrors the design doc §3.8 verbatim; `Down` drops in reverse. |
| `backend/db/queries/applications.sql` | NEW | sqlc source for `CreateApplication`, `GetApplicationByID`, `ListMyApplications`, `ListByJob`, `TransitionStatus`. |
| `backend/internal/features/applications/domain/entities/application.go` | NEW | `Application` + `ApplicationStatus` VO + transition table + errors (`ErrApplicationNotFound`, `ErrJobNotApplicable`, `ErrAlreadyApplied`, `ErrInvalidStatusTransition`, `ErrCoverLetterTooLong`). |
| `backend/internal/features/applications/domain/valueobjects/applicationStatus.go` | NEW | `ApplicationStatus` VO (`submitted|in_review|rejected|hired`) with `ParseApplicationStatus` + `String` + transition table (`CanTransitionTo`). |
| `backend/internal/features/applications/domain/repositories/applicationRepository.go` | NEW | `ApplicationRepository` port: `Create`, `GetByID`, `ListByJob`, `ListByCandidate`, `Transition`. |
| `backend/internal/features/applications/application/usecases/applyToJob.go` | NEW | Use case: candidate resolve (sub → users.id) → atomic apply. |
| `backend/internal/features/applications/application/usecases/transitionApplication.go` | NEW | Use case: recruiter-only (already gated) → VO transition matrix → repo.Transition. |
| `backend/internal/features/applications/application/usecases/listApplications.go` | NEW | Use cases: `ListMyApplications` (caller is candidate), `ListByJobForRecruiter`, `GetApplicationDetailForRecruiter`. |
| `backend/internal/features/applications/application/usecases/applicationService.go` | NEW | Composition target — bundles the use cases against the two ports (`ApplicationRepository`, `identity.UserRepository`). |
| `backend/internal/features/applications/application/dtos/applicationDtos.go` | NEW | Wire shapes: `ApplyRequestDto`, `TransitionRequestDto`, `ApplicationListItemDto`, `ApplicationDetailDto`, `MyApplicationListItemDto`, `JobSummaryDto`. |
| `backend/internal/features/applications/infrastructure/postgres/applicationRepository.go` | NEW | sqlc adapter; `mapCreateError` mirrors `mapCreateError`-style dispatch: `23505` → `ErrAlreadyApplied`, `23503` → `ErrJobNotFound` (defense-in-depth), `pgx.ErrNoRows` from `CreateApplication :one` guard → `ErrJobNotApplicable`; `mapTransitionError` separately. |
| `backend/internal/features/applications/infrastructure/postgres/` `*_integration_test.go` | NEW | Integration tests + adapter unit tests for `map*Error`. |
| `backend/internal/features/applications/infrastructure/http/applicationHandler.go` | NEW | Handlers: `applyToJob`, `listMyApplications`, `listJobApplications`, `getApplication`, `transitionApplication`. Per-method accessor for `JobHandlers`-style gating. |
| `backend/internal/features/applications/infrastructure/http/` `*_test.go` | NEW | Handler tests (401/403/400/404/409/200/201), AST route guard (gate tree behind `requireAuth + requireRecruiter`). |
| `backend/cmd/api/main.go` | MOD | Wire `applicationRepo` + `applicationService` + `applicationHandler`; mount three gated subtrees (apply is gated by RequireAuth only; recruiter list/detail/transition gated by RequireAuth + RequireCompanyRole(recruiter)). |
| `backend/cmd/api/main_test.go` | MOD | AST guard tests: `TestApplicationRoutes_AllRecruiterGated`, `TestApplicationApply_BehindRequireAuth`. |

### Rules and invariants (baked into the slice)

1. **Candidate identity is JWT-only.** `applyToJob` resolves `cognitoSub → users.id` via the existing `identity.UserRepository.GetByCognitoSub`. Path/body `candidate_id` is structurally impossible — `POST /jobs/{jobId}/applications` has no `{candidateId}` path segment.
2. **Same-company invariant (rule #2) extends to applications.** A recruiter can list/get/transition applications ONLY for jobs owned by their `CompanyContext.company_id`. Cross-company → `404 application not found` (indistinguishable from non-existent — same defense as `PATCH /jobs/{id}`). **This is the locked-confirmation assumption** referenced in the question round.
3. **Apply eligibility gate.** Atomic SQL CTE inside the INSERT — the row is only inserted when `(jobs.status='published' AND jobs.deleted_at IS NULL AND companies.status='active')` matches. 0 rows → `ErrJobNotApplicable` → `404 job not applicable` (distinct from generic `404 not found` to preserve UX, but the spec scenario "non-applicable job → candidate cannot apply" is satisfied).
4. **No double-apply.** `UNIQUE(job_id, candidate_id)` is the structural rule; the `Create` insert catches `23505` (partial unique is already NOT partial since `applications` does not soft-delete in this slice) and maps to `ErrAlreadyApplied` → `409 already applied`.
5. **Status is monotonic in this slice.** `submitted → in_review → {rejected, hired}`. There is NO `submitted → rejected` / `submitted → hired` shortcut; `rejected` and `hired` are TERMINAL. The DB CHECK enforces the closed vocabulary (`'submitted'|'in_review'|'rejected'|'hired'`); the use case enforces the transition matrix. Illegal request → `ErrInvalidStatusTransition` → `400 invalid status transition`.
6. **`cv_s3_key` is nullable, intentionally unused in this slice.** Created as `TEXT NULL`, no write path sets it. Documented as a column reservation for the snapshot-at-apply invariant from `docs/modelo-de-datos-proyecto-04.md` §3.8.
7. **`anonymized_at` is nullable, never set in this slice.** No PII-cancellation path is being shipped; the column exists for the future LFPDPPP flow.
8. **Soft-deleted job, recruiter view still works.** When a job is soft-deleted (`jobs.deleted_at IS NOT NULL`), `GET /jobs/{jobId}/applications` for the owning recruiter STILL returns the applications (audit history). `POST /jobs/{jobId}/applications` REJECTS with `404` (the gate predicate excludes soft-deleted). This asymmetry is intentional: applying requires a published job; reviewing past applications does not.
9. **Public read surface is untouched.** `GET /jobs` and `GET /jobs/{id}` are unchanged. No public applications read endpoint in this slice.

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **`mapCreateError` ordering drift** — the `pgx.ErrNoRows` branch (gate miss → `ErrJobNotApplicable`) must be checked BEFORE `errors.As(err, &pgErr)`, matching the `jobs-soft-delete` D3 discipline. | Unit test pins ordering; same RED pattern. |
| R2 | **Same-company invariant leak** — a recruiter of company `A` must NOT be able to list applications for a job owned by `B`; surfacing `403` would leak existence. | Use the `(jobId, companyID)` same-company pattern mirrored from `GetForUpdate`; cross-company read returns `ErrApplicationNotFound` (404), identical to a non-existent application. |
| R3 | **Recruiter transition race** — two recruiters move `submitted → in_review` simultaneously. | No CAS; SQL guard with `WHERE id = ... AND status = <expected>` returns 0 rows on a stale view; adapter maps to `ErrApplicationNotFound` (caller re-fetches the queue). The response itself surfaces the new state, so there is no useful `409` body to project (no editor view). |
| R4 | **Routing split** — adding subtrees under `/jobs/{jobId}/applications` could collide with the public `/jobs/{jobId}` GET pattern. | Mount recruiter subtrees on the ROOT router (not under `r.Mount("/jobs", ...)`); per-method accessor + AST guard test pattern (same as `jobs-soft-delete`). |
| R5 | **Atomic gate drift** — a non-active company must not accept applications even if the cached membership says `active`. | Same SQL CTE pattern as `CreateJob` (companies.status enforced inside the INSERT statement). |
| R6 | **JWT unknown sub vs. anonymous apply** — a JWT with an unknown `cognito_sub` must NEVER 500. | Use the existing `ErrUnknownSubject` sentinel (already mapped to `401` by `classifyCandidateError`); mirror the same classifier pattern in the new `classifyApplicationError`. |
| R7 | **`RequireCompanyRole` re-fetches `company_members` per request** — listing applications for a job triggers a JWT verify + a `company_members` lookup + a jobs read. | Accepted cost for this slice (matches the recruiter write paths); no cache yet. Same precedent as `POST/PATCH/DELETE /jobs/{id}`. |

### Rollback

- The feature lives in `backend/internal/features/applications/` — deleting that directory removes all Go code (handlers, use cases, repos, DTOs).
- `backend/cmd/api/main.go` reverts by removing the new wiring lines and the gated subtree mounts; `go test` stays green (the rest of the route surface is unchanged).
- `backend/db/migrations/00010_create_applications.sql` `Down` drops the `applications` table and indexes (no FK reference to `applications` from any other table in this slice, so `Down` is safe).
- Because there is no prior `applications` data (first slice on a green table), `Down` is a clean drop; no data migration in either direction.
- A defensive guard for partial deploys: if the migration went up but the API binary is the old one, the table simply sits empty (no writes happen, no reads happen, no FK violations).

### Success criteria

A candidate `C` with an `active` JWT can `POST /jobs/{pubJobId}/applications` with a valid body and receive `201 Created` carrying the application, `status='submitted'`, and the `id`. A second `POST` from the same candidate to the same job returns `409 already applied`. `POST` to a draft / closed / soft-deleted job returns `404 job not applicable`. `POST` while the owning company is `suspended` returns `404 job not applicable` (gate wins, no row inserted). `GET /me/applications` lists the caller's applications in `created_at DESC` order, including applications whose job has since been soft-deleted (history preserved).

A recruiter `R` of an active company `A` can `GET /jobs/{jobId}/applications` for a job owned by `A`, receiving items with `status`, `source`, `cover_letter`, and the candidate snippet. A recruiter of `B` on the same job receives `404 application not found`. `PATCH /jobs/{jobId}/applications/{id}/transition` with `{"status":"in_review"}` against an existing `submitted` row returns `200` with the updated row; the same call against the new `in_review` row returns `400 invalid status transition`. `{rejected,hired}` are reachable only from `in_review` and are terminal.

`cd backend && go test ./...` green; `cd backend && go vet ./...` clean; `cd backend && go build ./...` clean; `make db-migrate` then `make db-migrate-rollback` round-trips cleanly with no other migration affected.

## Open questions

### Proposal question round (RESOLVED — user answers 2026-08-25, all confirmed the defaults)

1. **Slice scope — RESOLVED: full pipeline** (candidate apply + recruiter list/detail/transition + candidate `/me/applications`) in one slice.
2. **Recruiter transitions — RESOLVED: proposed matrix.** `submitted → in_review → {rejected, hired}`; `submitted → {rejected, hired}` direct REJECTED with `400`; `rejected`/`hired` TERMINAL; NO CAS on transitions (lost race → `404` + re-fetch).
3. **Candidate withdraw — RESOLVED: OUT of this slice.** No `withdrawn` status, no hard-delete. Decided in a future cycle with specified behavior.
4. **`cv_s3_key` — RESOLVED: NULL-only reservation** (column created per §3.8, no write path sets it). No S3 infra in this slice.
5. **Apply eligibility — RESOLVED: mirror the read visibility predicate** atomically at INSERT time; soft-deleted job's existing applications remain recruiter-visible.
6. **(Bonus) Status timestamps — RESOLVED: no per-stage columns.** `updated_at` is the single action timestamp.

### Proceed-to-design assumptions (locked unless corrected above)

- **Rule #2 (recruiter-of-company) extends to applications** — list / detail / transition only on jobs the recruiter's `CompanyContext.company_id` owns. Cross-company → `404` (no existence leak).
- **`cv_s3_key` and `anonymized_at` are both nullable columns, neither populated in this slice.**
- **No re-apply on a soft-deleted job.** Trying to apply to a soft-deleted job returns `404 job not applicable`; existing applications on that job are unchanged and remain visible to the recruiter.
- **No `audit_events` row written for `ApplicationSubmitted` / `ApplicationTransitioned`** — this slice has no dependency on the `audit_events` table (which does not yet have a migration in the repo). Defer until the audit-events slice.
- **Recruiter `GET /jobs/{jobId}/applications/{id}` joins `candidate_profiles`** (left join) to render `professional_title` / `years_of_experience` for context, but does NOT render `salary_*` / `birth_date` (PII minimization). The full profile is reachable by a future `/me/candidates/{id}` slice on the candidates feature side.
- **Cross-feature SQL lives in the applications adapter — the `jobs` port is NOT extended.** The atomic apply-gate reads `jobs` and `companies` in the same SQL statement that inserts the application (`INSERT ... WHERE EXISTS (SELECT 1 FROM jobs JOIN companies WHERE ...) RETURNING id`), so no `jobs` repository method is added. The recruiter list queries JOIN `users` and `candidate_profiles` directly inside the applications adapter. The `jobs` port, `jobs` service, `jobs` handler, and the public `/jobs`/`/jobs/{id}` mount are **untouched** — a strict scoping that survives future refactors.
- **No pagination on the recruiter list in this slice.** Hard cap to 100 rows (a single job's queue rarely exceeds that in MVP); keyset pagination is a follow-up if needed. The candidate `/me/applications` is similarly capped and unsorted-paginated.
- **`source` defaults to `NULL` on the wire if not provided** (the candidate may not remember or be unwilling to disclose), even though the column allows it. The DTO accepts `*string`; the use case passes through.
- **Hexagonal layout is faithful.** `domain/valueobjects/` holds `ApplicationStatus`; `domain/entities/` holds `Application`; `domain/repositories/` holds the port; `application/usecases/` holds the service; `application/dtos/` holds wire shapes; `infrastructure/postgres/` holds the sqlc adapter + integration tests; `infrastructure/http/` holds the handlers + handler tests. No cross-feature import except `identity.UserRepository` (the established `cognitoSub → users.id` seam) and `jobs` repository for the gate (`GetJobForApply(ctx, jobID) → (companyID, jobStatus, ...)` — read-only, used inside the atomic CTE-driven `CreateApplication`, not a separate Go call).
