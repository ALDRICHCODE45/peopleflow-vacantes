# Delta for Companies

This delta removes the deferred "no audit events for companies" requirement and adds the explicit emission requirement for the owner-only write paths (`PATCH /me/company` → `CompanyUpdated`, `DELETE /me/company` → `CompanyDeleted`). The Purpose paragraph (the summary prose at the top of the canonical spec) is updated to declare the new emission fact in place of the prior "audit_events row count MUST NOT change" sentence; the "Out of scope (deferred)" bullet for `audit_events` integration is removed (this change closes that deferral). Both prose edits are downstream consequences of the REMOVED + ADDED pair below and are the summary the archive phase will paste into the canonical Purpose and Out-of-scope sections.

The audit_events bounded context's vocabulary and metadata invariants for the two new events are owned by the sibling `openspec/changes/companies-audit/specs/audit_events/spec.md` delta (the audit_events context owns its declarative vocabulary and the closed-key metadata invariant). The companies spec continues to own the emission contract: which write paths emit, which response codes trigger or skip emission, who the actor is, and the co-write fail-closed behavior.

## REMOVED Requirements

### Requirement: No Audit Events for Companies (Deferred)

(Reason: the deferral closes in this change. The `companies` owner-only write paths (`PATCH /me/company`, `DELETE /me/company`) now co-write exactly one `audit_events` row per successful write inside the same `pgx.Tx` as the domain write. The closed event-type vocabulary that this requirement protects expands from two to four — see the sibling `audit_events` delta's MODIFIED `Event Type Vocabulary (Closed Set for This Cycle)` requirement. The `audit_events` bounded context is no longer applications-only for emission: it is co-equal between applications and companies. The two scenarios that pinned the pre-change "row count unchanged" behavior — `PATCH /me/company` success and `DELETE /me/company` success — are replaced by the success-side scenarios of the new ADDED `Audit Events for Companies` requirement, which assert `+1` row with the exact event_type, entity_type, actor_type, actor_id, and metadata shape per event.)
(Migration:
- `audit_events/domain/entities/auditEvent.go` MUST add the constants `EventCompanyUpdated = "CompanyUpdated"`, `EventCompanyDeleted = "CompanyDeleted"`, and `EntityCompany = "company"` (sibling to the existing `EventApplicationSubmitted`, `EventApplicationTransitioned`, `EntityApplication`).
- `audit_events/domain/entities/auditEvent_test.go::TestEventVocabularyIsClosed` MUST expand its `want` map to include the three new literals; the emit-literal walk continues to pass because the new literals stay in the entities package.
- `companies/application/usecases/companyService.go` MUST add the sentinel `ErrMissingActorIdentity = errors.New("missing actor identity")`.
- `companies/application/usecases/updateCompany.go` and `deleteCompany.go` MUST gain a `userID uuid.UUID` parameter (sourced from `CompanyContext.UserID`), MUST fail closed with `ErrMissingActorIdentity` when `userID == uuid.Nil` as the FIRST step (before `GetCompanyForUpdate` and before the CAS compare), and MUST build the `AuditEvent` themselves (the use case is the single source of truth for the event shape and metadata).
- A new file `companies/application/usecases/eventIntent.go` MUST hold `newCompanyUpdatedEvent`, `newCompanyDeletedEvent`, and `buildCompanyDeletedMetadata` (single source of truth for metadata assembly).
- A sibling `companies/application/usecases/eventIntent_test.go` MUST pin the closed-key vocabulary for company events (`{jobs_closed}` only) and the exact shape per event.
- `companies/domain/repositories/companyRepository.go` (the port) MUST gain an `event auditentities.AuditEvent` value parameter (last position; value not pointer) on `UpdateCompany` and `SoftDeleteCompany`.
- `companies/infrastructure/postgres/companyRepository.go` (the adapter) MUST gain an `audit auditrepositories.AuditEventRepository` constructor argument (mirror of `NewApplicationRepository(pool, audit)`), MUST call `r.audit.Append(ctx, tx, event)` inside the same `pgx.Tx` after the write succeeds (and after the inline `CloseCompanyJobs` for DELETE) and before `tx.Commit`, and MUST surface the `CloseCompanyJobs` rowcount so the use case can stringify it into `jobs_closed`.
- `companies/infrastructure/http/handler.go` MUST pass `cc.UserID` to both use cases; `classifyUpdateCompanyError` and `classifyDeleteCompanyError` MUST gain the branch `case errors.Is(err, usecases.ErrMissingActorIdentity): return 500, "internal server error"` (no existence leak; mirror of `classifyApplicationError`).
- `backend/cmd/api/main.go` MUST change `companyRepo := postgres.NewCompanyRepository(pool)` to `postgres.NewCompanyRepository(pool, auditRepo)`, reusing the existing `auditRepo := auditpostgres.NewAuditEventRepository()` singleton (line 139).
- `backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go` MUST flip its audit-row-count assertion from "unchanged" to `+1` for both PATCH and DELETE, MUST assert the new row carries `event_type='CompanyUpdated'` (PATCH) or `'CompanyDeleted'` (DELETE) and `entity_type='company'`, and MUST widen the `entity_type` cleanup predicate at line 222–228 from `entity_type = 'companies'` (plural, legacy test-fixture literal) to `entity_type IN ('companies', 'company')` (defensive — the test now produces rows under both literals in different phases).
- All test-stub repositories that capture the companies repository port (5 files mirroring applications D16) MUST be updated atomically with the port signature change.
- The `Out of scope (deferred)` section of the canonical spec MUST drop the bullet "`audit_events` integration for `CompanyUpdated` / `CompanyDeleted` / `CompanySoftDeleted` (deferred to a follow-up cycle — this slice does NOT extend the `audit_events` port, query file, or entity; the `audit_events` bounded context stays applications-only)" and the related sentence in the Purpose paragraph claiming audit emission is deferred — both are replaced by the success-emission contract in the new ADDED requirement.)

## ADDED Requirements

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

#### Scenario: PATCH or DELETE 404 on not-found, cross-company, or already-soft-deleted appends zero audit rows

- GIVEN an owner of company `A` with a baseline `N` rows in `audit_events` and `A` either non-existent, cross-company, or already soft-deleted (`deleted_at IS NOT NULL`)
- WHEN `PATCH /me/company` or `DELETE /me/company` is sent
- AND the response is `404 company not found`
- THEN `audit_events` has `N` rows (no new row appended; the read-for-update `GetCompanyForUpdate` failed BEFORE the adapter write)

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

- GIVEN an unauthenticated `PATCH /me/company` or `DELETE /me/company` request (no `Authorization` header), OR an authenticated non-owner (recruiter — role `< owner`) member, OR an authenticated user with no `company_members` row
- WHEN the request reaches the gated write route
- AND the response is `401 Unauthorized` or `403 Forbidden`
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
