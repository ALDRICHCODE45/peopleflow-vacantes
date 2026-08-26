# Proposal: `companies-audit` — extend `audit_events` to company write paths

Status: proposal (pre-spec). Artifacts produced in this phase: this file only (no spec, design, or tasks yet). Grounded by `openspec/changes/companies-audit/exploration.md` (the canonical factual base for this change), `openspec/specs/audit_events/spec.md` (the bounded context being extended), `openspec/specs/companies/spec.md` (the emitting owner-only write paths), and the applications slice as the established co-write precedent (`backend/internal/features/applications/`). This is a **seam change, not a migration**: no new goose migration, no new sqlc query (the audit INSERT already exists and `event_type` is deliberately NOT DB CHECK-constrained; the closed vocabulary is a code-level invariant).

---

## 1. Intent

Close the deferred follow-up that `openspec/changes/archive/2026-08-26-companies-write/proposal.md` explicitly left open ("Audit events for companies — explicitly deferred … No `CompanyUpdated`, `CompanyDeleted`, `CompanySoftDeleted`, `CompanyRestored` event types. No `audit_events` port extension. No `co-write` transaction"). This change extends the `audit_events` bounded context to emit **`CompanyUpdated`** from `PATCH /me/company` → `CompanyService.UpdateCompany` and **`CompanyDeleted`** from `DELETE /me/company` → `CompanyService.SoftDeleteCompany`, in the SAME `pgx.Tx` as the domain write (fail-closed co-write, mirroring the applications slice exactly).

The emission is **synchronous, transactionally co-written, and bounded**: only the two owner-only write paths emit; no outbox, no SNS/SQS fan-out, no read surface on `audit_events`. The catalog of company events this cycle is **exactly two** (`CompanyUpdated`, `CompanyDeleted`) — `CompanySoftDeleted` and `CompanyRestored` are deliberately future-only (see §4.1).

## 2. Problem / opportunity

Today the `audit_events` table has exactly two emitters — `applications.Create` and `applications.Transition` — and the companies owner-only write paths (`PATCH /me/company`, `DELETE /me/company`) silently mutate `companies` and (for DELETE) `jobs.status` with **no audit trail**. A company owner who edits the company profile or who soft-deletes their company leaves no record in the append-only log, while the corresponding application lifecycle events are fully audited. The asymmetry shows up operationally:

- **Compliance / takedown forensics** — the manual takedown flow (`docs/flujo-verificacion-empresas.md`) needs to know who soft-deleted a company and when. Today `companies.deleted_at` is the only signal, but it carries no actor.
- **Support burden** — "who changed the company logo?" / "who soft-deleted company X yesterday?" is currently unanswerable from the system of record. The owning user is identifiable via `CompanyContext.UserID` (already populated by `RequireCompanyRole` and currently IGNORED by the companies PATCH/DELETE handlers — a one-line seam).
- **Reconciliation drift** — `openspec/specs/companies/spec.md` R9 ("No Audit Events for Companies (Deferred)") and `openspec/specs/audit_events/spec.md` Purpose ("the jobs, companies, and identity write paths emit nothing") are now both wrong about the same fact; one spec set contradicts itself and the slice's tests assert the contradiction (`companyRepository_write_integration_test.go` line 491–493 and 606–615 pin "audit_events row count unchanged" as the spec contract).

## 3. Target users and situations

- **Owner editing the company profile** — `PATCH /me/company` succeeds (`200 OK`); one new `audit_events` row is appended with `event_type='CompanyUpdated'`, `entity_type='company'`, `entity_id=<company.id>`, `actor_type='user'`, `actor_id=<CompanyContext.UserID>`, `metadata={}`. The metadata is intentionally empty — the `200` body already carries the post-write state, so a "what changed" diff would be redundant and PII-risky.
- **Owner soft-deleting their company** — `DELETE /me/company` succeeds (`204 No Content`); one new `audit_events` row is appended with `event_type='CompanyDeleted'`, `entity_type='company'`, `entity_id=<company.id>`, `actor_type='user'`, `actor_id=<CompanyContext.UserID>`, `metadata={"jobs_closed": "<n>"}` (the integer rowcount of the inline `CloseCompanyJobs` UPDATE, stringified). The `jobs_closed` key is ALWAYS present (even when `n=0`) so the metadata shape is stable and machine-parseable.
- **Forensics / compliance reader** — the same `audit_events_entity_idx (entity_type, entity_id, occurred_at DESC)` B-tree already supports the lookup: `SELECT … WHERE entity_type='company' AND entity_id=<id> ORDER BY occurred_at DESC` returns the per-company history.
- **Failed writes** — `400` (VO rejection / malformed JSON), `404` (`GetCompanyForUpdate` returns `ErrCompanyNotFound` — non-existent / cross-company / already-soft-deleted), `409` (CAS mismatch — stale / missing / malformed `If-Unmodified-Since`): NO `audit_events` row is appended (the use-case flow fails BEFORE the adapter write, and the adapter fails BEFORE the audit append).
- **Audit INSERT failure** (hypothetical — `audit_events` row INSERT itself fails mid-transaction): the deferred `tx.Rollback` aborts the domain write too (fail-closed). The client sees `500 internal server error`; no company row is mutated, no audit row exists.

## 4. Resolved decisions (the 8 open questions)

### 4.1 Event-type catalog — exactly `CompanyUpdated` + `CompanyDeleted`

The catalog this cycle is exactly two: `CompanyUpdated` and `CompanyDeleted`. **`CompanySoftDeleted` is intentionally NOT introduced**: today the only delete path is soft-delete (no hard delete — `openspec/specs/companies/spec.md` "Out of scope" pins hard delete as forbidden); naming a separate `CompanySoftDeleted` would imply a `CompanyHardDeleted` companion that the slice forbids forever. Naming the event `CompanyDeleted` reflects the only delete verb the system actually exposes.

`CompanyRestored` is explicitly future-only (the soft-delete + inline close is one-way today; a restore endpoint is a future slice that "operates on the intact member + applications data and re-opens the inline close" — companies spec "Out of scope"). Adding the constant now would create an unused typed string in the closed-vocabulary AST guard (`TestEventVocabularyIsClosed`) and invite misuse.

**Decision**: constants added are `EventCompanyUpdated = "CompanyUpdated"` and `EventCompanyDeleted = "CompanyDeleted"` (sibling to `EventApplicationSubmitted` / `EventApplicationTransitioned`). The closed-vocabulary unit test expands from `{ApplicationSubmitted, ApplicationTransitioned, EntityApplication}` to `{…, CompanyUpdated, CompanyDeleted, EntityCompany}`.

### 4.2 `entity_type` — singular `"company"` (NOT plural)

`EntityCompany = "company"` (singular) — consistent with `EntityApplication = "application"` (singular). The integration-test fixture currently seeds one audit row with `entity_type = 'companies'` (plural, **test-only**); that seed is for the pre-change "row count unchanged" assertion and is never read by the production code. After this change:

- Production events use `entity_type = 'company'` (singular).
- The fixture seed keeps `entity_type = 'companies'` (plural, test-only) — its cleanup predicate in `companyRepository_write_integration_test.go` line 222–228 (`WHERE entity_type = 'companies' AND entity_id = ANY($1)`) still cleans the seed row.
- The cleanup predicate is extended to also match `'company'` (singular) for the `writeCoA` ID, so the new production `CompanyDeleted` row produced by the very same test doesn't leak across runs.

**Decision**: domain constant `EntityCompany = "company"` (singular); integration-test cleanup predicate widens to `entity_type IN ('companies', 'company')` (defensive — the test produces rows under both literals in different phases).

### 4.3 Metadata shape per event

Per the closed-vocabulary invariant (PII-free, minimal, fixed key set per event — see `auditEvent.go` doc and `applications/eventIntent.go::buildSubmittedMetadata` precedent):

| Event type | Metadata keys | Values | Rationale |
| --- | --- | --- | --- |
| `CompanyUpdated` | `{}` (empty map) | — | The `200 OK` body already carries the post-write row state. Capturing a "what changed" diff (a) is redundant with the wire response, (b) would carry the new values verbatim — PII/leak risk for free-text profile columns (`description`, `name`), (c) inflates the JSONB for low operational value. Empty metadata stays consistent with the PII-free principle. |
| `CompanyDeleted` | `{"jobs_closed": "<n>"}` | `<n>` = `strconv.Itoa(int(closedCount))` from the inline `CloseCompanyJobs` rowcount; the key is ALWAYS present, even when `n=0` | Documents the side-effect of the soft-delete (the inline close on the company's draft/published jobs) which is otherwise opaque from the `204 No Content` wire. PII-free (integer count). Stable shape enables machine-parseable forensics. See §4.5 for the rationale on including the rowcount. |

The `AuditEvent.Metadata` field is `map[string]string` (values are strings); the rowcount must be stringified. A unit test (`companies/application/usecases/eventIntent_test.go`) pins the closed metadata vocabulary `{jobs_closed}` for company events so a future edit cannot leak PII into the JSONB — mirror of `applications/eventIntent_test.go::TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID`.

### 4.4 No-emission matrix (per response code)

| Outcome | Emits? | Why |
| --- | --- | --- |
| `200 OK` (PATCH success, 1 row patched, post-write re-read succeeded) | **Yes — `CompanyUpdated`** | Write succeeded → audit append runs inside the same `pgx.Tx` → both commit. |
| `204 No Content` (DELETE success, 1 row tombstoned, inline close ran) | **Yes — `CompanyDeleted`** | Write + inline close succeeded → audit append runs inside the same `pgx.Tx` → all three commit. |
| `200 OK` PATCH + 0 rows updated (lost race — concurrent writer bumped `updated_at` between use-case `GetCompanyForUpdate` and SQL UPDATE) | **No** | Adapter `UpdateCompany` returns `ErrCompanyNotFound` BEFORE the audit append; the use case re-reads and either maps to `404` (no event) or `409 + view` (no event). |
| `409 Conflict` PATCH (CAS stale / missing / malformed `If-Unmodified-Since`) | **No** | CAS compare in use case runs BEFORE `repo.UpdateCompany`; the adapter is never called. |
| `409 Conflict` DELETE (CAS stale / missing / malformed `If-Unmodified-Since`) | **No** | Same — CAS compare in use case runs BEFORE `repo.SoftDeleteCompany`; the adapter is never called. |
| `400 Bad Request` (malformed JSON / VO rejection — name `<4`, description `>3000`, founded_year out of range, invalid `size`) | **No** | JSON decode / VO constructor fails BEFORE `repo.UpdateCompany`; the adapter is never called. |
| `404 company not found` (`GetCompanyForUpdate` → `ErrCompanyNotFound` — non-existent / cross-company / already-soft-deleted) | **No** | Read-for-update fails BEFORE `repo.UpdateCompany` / `repo.SoftDeleteCompany`; the adapter is never called. |
| `403 Forbidden` (RequireCompanyRole rejects — non-owner / no membership) | **No** | Middleware short-circuits BEFORE the handler / use case runs. |
| `401 Unauthorized` (no JWT) | **No** | `RequireAuth` short-circuits BEFORE the gated subtree. |
| `500 Internal Server Error` — audit INSERT itself fails mid-`pgx.Tx` | **No write, no event** | Deferred `tx.Rollback` aborts the domain write too (fail-closed co-write). |
| `500 Internal Server Error` — `CompanyContext.UserID == uuid.Nil` | **No** | Use-case fail-closed guard (`ErrMissingActorIdentity`) runs BEFORE the adapter write; no event built, no append attempted. |

### 4.5 `jobs_closed` rowcount in `CompanyDeleted` metadata — **YES, include it**

Rationale: today the soft-delete path captures the inline-close rowcount via `cmdtag.RowsAffected()` and immediately discards it (`_ = closedCount` in `companyRepository.go::SoftDeleteCompany`). Including it in the audit metadata is a **strict observability win** with no extra cost beyond `strconv.Itoa`:

- PII-free (integer count of jobs affected).
- Documents the side-effect of the soft-delete — the inline `jobs.status='closed'` UPDATE on the company's draft/published jobs — which is **invisible from the `204 No Content` wire**. A support engineer answering "what did this DELETE actually do?" can read the audit row directly.
- Stable shape: the key is always present (`"0"` for the legitimate "company had no non-closed jobs at delete time" success path), so consumers can rely on a fixed schema rather than a present-or-absent branch.
- Captures the **secondary write** that the soft-delete has on a different table (`jobs`), which the `companies` table alone cannot express.

**Counter-argument rejected**: storing the rowcount could be argued as "telemetry, not audit". Reply: telemetry that the audit log already captures (the rowcount is computed inside the same transaction) is the cheapest telemetry — promoting it to the audit row costs one `strconv.Itoa` call and one extra `map[string]string` insert; the alternative is a separate observability surface that the slice does not own.

**Decision**: adapter threads `closedCount` through to the use case (or the use case receives `closedCount` as a port-level return — design decision deferred to §13); the `eventIntent.go` builder stringifies it. Always-present key (`"0"` allowed).

### 4.6 Event-intent builder location — new `companies/application/usecases/eventIntent.go`

Mirrors `applications/application/usecases/eventIntent.go` exactly:

- Single source of truth for metadata assembly (the closed-vocabulary test asserts here, not in the adapter or handler).
- Cleanly separates "what's the event?" (intent) from "where does the event go?" (adapter).
- Same package as the use cases (`usecases`) so the builders are importable by `updateCompany.go` / `deleteCompany.go` without crossing layer boundaries.
- Same package-local test (`eventIntent_test.go`) for the closed-vocabulary assertion.

**Decision**: new file `backend/internal/features/companies/application/usecases/eventIntent.go` + sibling `eventIntent_test.go`. NOT inline in `updateCompany.go` / `deleteCompany.go` (would scatter the closed vocabulary across two files and force a duplicate PII-free test).

### 4.7 Fail-closed `uuid.Nil` actor guard — **CONFIRMED, mirror applications D8**

`CompanyContext.UserID == uuid.Nil` → `companiesusecases.ErrMissingActorIdentity` → mapped to `500 internal server error` in `classifyUpdateCompanyError` and `classifyDeleteCompanyError`. No write, no event. Same wire contract as `applicationHandler.go::classifyApplicationError` lines 324–327.

**Implementation shape**:

- New sentinel `var ErrMissingActorIdentity = errors.New("missing actor identity")` in `backend/internal/features/companies/application/usecases/companyService.go` (sibling to `NewCompanyService`).
- `UpdateCompany(ctx, companyID, userID uuid.UUID, in dtos.UpdateCompanyDto, ifUnmodifiedSince time.Time)` — new `userID` parameter (the handler reads `cc.UserID` and passes it through, mirror of `applications/applicationHandler.go` line 253).
- `SoftDeleteCompany(ctx, companyID, userID uuid.UUID, ifUnmodifiedSince time.Time)` — same.
- Guard placement: FIRST step in each use case (before `GetCompanyForUpdate`, before the CAS compare) — fail fast for the mis-wired case so the audit append is never even attempted for a zero-actor request.
- Handler classifier: `case errors.Is(err, usecases.ErrMissingActorIdentity): return 500, "internal server error"` (no existence leak; mirror of applications' classification).

**Decision**: confirmed. The fail-closed guard is defense-in-depth for a mis-wired or middleware-bypassed route; the `RequireCompanyRole` middleware always resolves a real `users.id`, so the guard is unreachable via the designed flow but MUST stay in place.

### 4.8 Spec reconciliation — both sides get a precise delta

The change **reconciles** the two specs (currently self-contradictory):

**`openspec/specs/audit_events/spec.md`** — MODIFIED:

- **Purpose** paragraph: replace "Exactly two event types are emitted in this cycle — `ApplicationSubmitted` and `ApplicationTransitioned` — both from the `applications` write paths; the jobs, companies, and identity write paths emit nothing." with "Four event types are emitted in this cycle: `ApplicationSubmitted` and `ApplicationTransitioned` from the `applications` write paths; `CompanyUpdated` and `CompanyDeleted` from the `companies` owner-only write paths. Jobs and identity write paths emit nothing."
- **Requirement "Event Type Vocabulary (Closed Set for This Cycle)"**: closed set expands from `{ApplicationSubmitted, ApplicationTransitioned}` to `{ApplicationSubmitted, ApplicationTransitioned, CompanyUpdated, CompanyDeleted}`. The corresponding scenarios ("exactly N event-type constants exist this cycle") update the count from 2 to 4 and add the two new literals.
- **Requirement "Metadata Shape (PII-Free)"**: add the company rows to the per-event table (`CompanyUpdated` → `{}`; `CompanyDeleted` → `{"jobs_closed": "<n>"}`). Update the closed-key vocabulary unit-test assertion from `{job_id, source, from_status, to_status}` to `{job_id, source, from_status, to_status, jobs_closed}`.

**`openspec/specs/companies/spec.md`** — MODIFIED:

- **Purpose** paragraph: replace "The `audit_events` row count MUST NOT change as a result of any company write path in this slice." with "A successful `PATCH /me/company` adds exactly one `CompanyUpdated` row to `audit_events`; a successful `DELETE /me/company` adds exactly one `CompanyDeleted` row."
- **Requirement "No Audit Events for Companies (Deferred)"** — **REPLACED** by **"Audit Events for Companies"** requirement with the success scenarios:
  - `Given` baseline `N` rows in `audit_events` `When` `PATCH /me/company` succeeds `Then` row count is `N+1` with one `CompanyUpdated` row carrying `entity_type='company'`, `entity_id=<company.id>`, `actor_id=<CompanyContext.UserID>`, `metadata={}`.
  - `Given` baseline `N` rows `When` `DELETE /me/company` succeeds `Then` row count is `N+1` with one `CompanyDeleted` row carrying `entity_type='company'`, `entity_id=<company.id>`, `actor_id=<CompanyContext.UserID>`, `metadata={"jobs_closed":"<n>"}`.
  - `Given` a `404` / `409` / `400` / `403` / `401` outcome `When` any of those fires `Then` no `audit_events` row is appended (no write happened).
- **Out of scope (deferred)** paragraph: REMOVE the bullet "`audit_events` integration for `CompanyUpdated` / `CompanyDeleted` / `CompanySoftDeleted` (deferred to a follow-up cycle — this slice does NOT extend the `audit_events` port, query file, or entity; the `audit_events` bounded context stays applications-only)". Also REMOVE the related sentence in Purpose ("the bounded context owns the table, the use cases, the transactional multi-write path (soft-delete + inline close), the wire DTOs, and the gate; it does NOT own the `audit_events` table (audit emission is deferred — see `No Audit Events for Companies`)"). The `audit_events` table ownership statement stays applications-owned for the schema; the bounded-context coupling on emission becomes co-equal between applications and companies.

**Decision**: spec reconciliation is part of the change, not a follow-up. The two specs MUST land in the same archive cycle or the spec set is self-contradictory (audit_events spec forbids the events the companies spec promises).

---

## 5. Business rules (added / modified)

1. **Owner-only emission** — only the gated `/me/company` write paths emit. `RequireCompanyRole(owner)` MUST run before any use case; the handler MUST NOT call the use case without a real `CompanyContext` (the existing `requireCompanyContext` 500 fail-closed invariant is preserved).
2. **Actor provenance = `CompanyContext.UserID`** — the body's never carries `actor_id` (the DTO has no such field); `encoding/json` silently drops any smuggled actor. Same IDOR defense as `applications/applicationHandler_test.go::TestTransitionApplication_BodyActorIDIgnored`.
3. **Co-write atomicity** — audit append runs in the same `pgx.Tx` as the domain write. Audit INSERT failure rolls back the domain write (fail-closed — no write without its audit trail). Mirrors `applicationRepository.go::Create` and `::Transition` D5/D6 contract exactly.
4. **No-emission on non-write outcomes** — `400 / 403 / 404 / 409 / 401` produce zero new `audit_events` rows (see §4.4 matrix).
5. **PII-free metadata** — `CompanyUpdated` carries `{}`; `CompanyDeleted` carries `{"jobs_closed": "<n>"}` only. No `description`, no `name`, no `website`, no `cover_image_url`, no RFC, no `industry_id`. Closed-vocabulary test pins the key set.
6. **Inline-close rowcount is observable, not just successful** — the `jobs_closed` key documents the `CloseCompanyJobs` side-effect even when `n=0` (the legitimate "company had no non-closed jobs at delete time" success path). Stable shape always.
7. **Audit INSERT failure is a `500`, not a partial commit** — fail-closed co-write. Mirror of applications' wire contract.

## 6. Scope (first slice)

### 6.1 Domain layer — `audit_events/domain/entities/`

- `EventCompanyUpdated = "CompanyUpdated"`, `EventCompanyDeleted = "CompanyDeleted"`, `EntityCompany = "company"` constants added to `backend/internal/features/audit_events/domain/entities/auditEvent.go` (sibling to `EventApplicationSubmitted` etc.). The untyped string constant surface expands from 3 to 6 values.
- The closed-vocabulary AST guard in `auditEvent_test.go::TestEventVocabularyIsClosed` expands its `want` map to include the three new literals and the test continues to enforce "no emit call site outside this package".

### 6.2 Application layer — `companies/application/usecases/`

- New sentinel `ErrMissingActorIdentity = errors.New("missing actor identity")` in `companyService.go` (sibling to the existing service struct).
- `UpdateCompany` signature gains `userID uuid.UUID` parameter (between `companyID` and `in`); guard `if userID == uuid.Nil { return nil, ErrMissingActorIdentity }` as the FIRST step (before `GetCompanyForUpdate`).
- `SoftDeleteCompany` signature gains the same `userID uuid.UUID` parameter; same guard placement.
- New file `eventIntent.go` (mirror of applications'): `newCompanyUpdatedEvent(eventID, companyID, userID uuid.UUID) auditentities.AuditEvent` + `newCompanyDeletedEvent(eventID, companyID, userID uuid.UUID, jobsClosed int) auditentities.AuditEvent` + `buildCompanyDeletedMetadata(jobsClosed int) map[string]string` helper. Empty metadata for Updated (no helper needed).
- Sibling `eventIntent_test.go` pinning the closed key vocabulary (`jobs_closed` only — see §4.3) and the exact shape per event (mirror of `applications/eventIntent_test.go`).

### 6.3 Domain port — `companies/domain/repositories/companyRepository.go`

- `UpdateCompany(ctx, companyID uuid.UUID, patch UpdateCompanyPatch, casUpdatedAt time.Time, event auditentities.AuditEvent) error` — new value-param `event` (last position, value not pointer).
- `SoftDeleteCompany(ctx, companyID uuid.UUID, casUpdatedAt time.Time, event auditentities.AuditEvent) error` — same.
- The atomic stub-repair pattern (5 stub files mirroring applications D16): the 5 test-repo stubs gain the `event` param. The `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)` assertion stays.

### 6.4 Infrastructure — postgres adapter

- `CompanyRepository` struct gains `audit auditrepositories.AuditEventRepository` field; `NewCompanyRepository(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository)` constructor (mirror of `applicationRepository.go::NewApplicationRepository`).
- `UpdateCompany` body: after `db.New(tx).UpdateCompany` returns `updated == 1`, call `r.audit.Append(ctx, tx, event)` BEFORE `tx.Commit`. On `updated == 0` (the lost-race / not-found path), return `ErrCompanyNotFound` WITHOUT calling append.
- `SoftDeleteCompany` body: after `db.New(tx).SoftDeleteCompany` returns `deleted == 1` AND after the inline `CloseCompanyJobs` succeeds, call `r.audit.Append(ctx, tx, event)` BEFORE `tx.Commit`. The inline close's rowcount flows to the use case so the builder can stringify it — exact seam deferred to design (one of: the adapter returns `(closedCount int, err error)`; the use case receives the count via the port; OR the adapter builds the event itself — but the use case is the single source of truth for the event per D7, so the use case MUST build the event and the adapter MUST surface `closedCount`).
- `defer tx.Rollback` covers every error path; an audit append failure aborts the whole transaction (fail-closed co-write).

### 6.5 Infrastructure — HTTP handler

- `updateCompany` handler: pass `cc.UserID` as the new second arg to `h.service.UpdateCompany(r.Context(), cc.CompanyID, cc.UserID, in, ifUnmodifiedSince)` (mirror of `applicationHandler.go` line 253).
- `deleteCompany` handler: same — pass `cc.UserID` to `h.service.SoftDeleteCompany(r.Context(), cc.CompanyID, cc.UserID, ifUnmodifiedSince)`.
- `classifyUpdateCompanyError` and `classifyDeleteCompanyError` gain the `case errors.Is(err, usecases.ErrMissingActorIdentity): return 500, "internal server error"` branch.
- No new routes; no middleware changes; no handler additions.

### 6.6 Composition root — `cmd/api/main.go`

- Single wiring change: `companyRepo := postgres.NewCompanyRepository(pool)` → `postgres.NewCompanyRepository(pool, auditRepo)` (the `auditRepo := auditpostgres.NewAuditEventRepository()` singleton already exists at line 139 for the applications adapter — reused verbatim).
- No new packages, no new env vars, no new docker-compose services, no new migrations, no new sqlc queries.

### 6.7 Tests

- `auditEvent_test.go` AST-guard `want` map expands to include `EventCompanyUpdated`, `EventCompanyDeleted`, `EntityCompany`. The emit-literal-walk guard continues to pass because the literals stay in the entities package.
- `eventIntent_test.go` (NEW): pins metadata shape for both events and the closed-vocabulary key set.
- `updateCompany_test.go` / `deleteCompany_test.go`: add `TestUpdateCompany_MissingUserIDFailsClosed` / `TestSoftDeleteCompany_MissingUserIDFailsClosed` mirror of `applications/transitionApplication_test.go::TestTransitionApplication_MissingUserIDFailsClosed`. Update existing stubs to capture the new `event` param.
- Handler tests: extend `handler_test.go` (or equivalent) with `TestUpdateCompany_MissingUserIDReturns500` / `TestDeleteCompany_MissingUserIDReturns500`, mirror of `applications/applicationHandler_test.go::TestTransitionApplication_MissingUserIDReturns500`. Add `TestUpdateCompany_PassesCompanyUpdatedEvent` / `TestDeleteCompany_PassesCompanyDeletedEvent` asserting the captured event has `ActorType=user`, `ActorID=<cc.UserID>`, `EntityType=company`, `EntityID=<companyID>`, `Metadata={}` (PATCH) / `Metadata={"jobs_closed":"0"}` (DELETE — with no jobs to close).
- `companyRepository_write_integration_test.go`: the assertion at line 491–493 / 606–615 FLIPS from "row count unchanged" to "row count `+1` for SoftDeleteCompany", AND the new row has `entity_type='company'` and `event_type='CompanyDeleted'`. The cleanup predicate at line 222–228 widens to `entity_type IN ('companies', 'company')`. A parallel test for the PATCH path asserts `+1` row with `event_type='CompanyUpdated'`.
- `cmd/api/main_test.go` (composition-root AST guard, if present for applications): add a guard that `companyRepo := postgres.NewCompanyRepository(pool, auditRepo)` (the audit param is wired).

### 6.8 Spec delta — `openspec/specs/audit_events/spec.md` + `openspec/specs/companies/spec.md`

Per §4.8 above. The two specs MUST land in the same archive cycle.

## 7. Explicit non-goals (out of scope for this change)

- **`CompanySoftDeleted` / `CompanyRestored` event types** — future-only (see §4.1). No constant added.
- **Hard delete** — permanently forbidden by companies spec ("Out of scope").
- **Restore / undelete endpoint** — companies spec non-goal; no event to emit until the endpoint exists.
- **Admin / system takedown (`POST /companies/{id}/suspend`)** — companies spec non-goal. When it lands, it brings its own `CompanySuspended` event.
- **Cross-company write paths** (`PATCH /companies/{id}` / `DELETE /companies/{id}`) — companies spec non-goal; no event emission needed for paths that don't exist.
- **Audit read surface** — append-only stays. No `GET /audit_events`, no `Backfill`, no `Read`.
- **Outbox / SNS / SQS / EventBridge fan-out** — synchronous co-write only. Same as applications.
- **Audit row retention / archival / pruning** — same as applications (no retention policy in this slice).
- **Audit event for `POST /companies` (CreateCompanyWithOwner)** — deferred (the create path does not currently emit; mirroring the deferred scope of `companies-write` proposal §8). When the create path lands audit emission, it brings `CompanyCreated` as a future constant.
- **`audit_events` schema migration** — none. `event_type` is not CHECK-constrained (audit_events spec §1.3 exception); the new event literals are a code-only change.
- **No new sqlc queries** — `InsertAuditEvent :exec` already exists in `audit_events.sql` (generated at `internal/db/audit_events.sql.go`); the `*db.Queries` interface surface does not change.
- **No new package, no new env var, no new docker-compose service** — slice reuses `uuid`, `pgx/v5`, `pgconn`, `pgtype`, `chi`, `slog` and the existing `pgxpool.Pool` already passed to `applicationRepo` / `companyBootstrapRepo` / `candidateRepo` / `auditRepo` at `cmd/api/main.go`.

## 8. Affected areas (file inventory)

Under `backend/`. **NEW** / **MOD** annotations. Production code first, then tests, then OpenSpec.

| Path | Op | Purpose |
| --- | --- | --- |
| `backend/internal/features/audit_events/domain/entities/auditEvent.go` | MOD | Add `EventCompanyUpdated`, `EventCompanyDeleted`, `EntityCompany` constants (sibling to existing). |
| `backend/internal/features/audit_events/domain/entities/auditEvent_test.go` | MOD | Expand the AST guard `want` map; the emit-literal walk stays unchanged. |
| `backend/internal/features/companies/application/usecases/companyService.go` | MOD | Add `ErrMissingActorIdentity` sentinel. |
| `backend/internal/features/companies/application/usecases/updateCompany.go` | MOD | New `userID` param; fail-closed guard; build `CompanyUpdated` event; pass `event` to `repo.UpdateCompany`. |
| `backend/internal/features/companies/application/usecases/deleteCompany.go` | MOD | New `userID` param; fail-closed guard; build `CompanyDeleted` event (with `closedCount`); pass `event` to `repo.SoftDeleteCompany`. |
| `backend/internal/features/companies/application/usecases/eventIntent.go` | NEW | `newCompanyUpdatedEvent`, `newCompanyDeletedEvent`, `buildCompanyDeletedMetadata` builders (single source of truth for metadata). |
| `backend/internal/features/companies/application/usecases/eventIntent_test.go` | NEW | Pin closed metadata vocabulary (`jobs_closed`); exact shape per event; never-PII structural assertion. |
| `backend/internal/features/companies/application/usecases/updateCompany_test.go` | MOD | Add `MissingUserIDFailsClosed`; update stub to capture event param. |
| `backend/internal/features/companies/application/usecases/deleteCompany_test.go` | MOD | Add `MissingUserIDFailsClosed`; update stub to capture event param. |
| `backend/internal/features/companies/domain/repositories/companyRepository.go` | MOD | Add `event auditentities.AuditEvent` value param to `UpdateCompany` + `SoftDeleteCompany` (port extension). |
| `backend/internal/features/companies/infrastructure/postgres/companyRepository.go` | MOD | Add `audit` field; `NewCompanyRepository(pool, audit)`; call `r.audit.Append(ctx, tx, event)` after `updated==1` / `deleted==1` (+ inline close) and before `tx.Commit`; surface `closedCount` for the use case. |
| `backend/internal/features/companies/infrastructure/http/handler.go` | MOD | Pass `cc.UserID` into both use cases; extend classifiers with `ErrMissingActorIdentity` → 500. |
| `backend/internal/features/companies/infrastructure/http/handler_test.go` (or equivalent) | MOD | Add `MissingUserIDReturns500` for both PATCH and DELETE; add `PassesCompanyUpdatedEvent` / `PassesCompanyDeletedEvent`. |
| `backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go` | MOD | Flip the audit-count assertion from "unchanged" to "+1 CompanyDeleted"; assert `entity_type='company'`, `event_type='CompanyDeleted'`; widen cleanup predicate to `'companies' OR 'company'`; add parallel PATCH test asserting `+1 CompanyUpdated`. |
| Stub repos in 5 test files (atomic stub repair per D16) | MOD | Add `event` param capture; the stub seam mirrors applications' precedent. |
| `backend/cmd/api/main.go` | MOD | `postgres.NewCompanyRepository(pool)` → `postgres.NewCompanyRepository(pool, auditRepo)`. Reuses the `auditRepo` singleton at line 139. |
| `openspec/specs/audit_events/spec.md` | MOD | Reconcile per §4.8 (closed-set expands to 4; metadata shape adds company rows; closed-key vocabulary expands to include `jobs_closed`). |
| `openspec/specs/companies/spec.md` | MOD | Reconcile per §4.8 (R9 "No Audit Events for Companies" REPLACED; Purpose paragraph updated; "Out of scope" bullet removed). |

The `audit_events` query file (`backend/db/queries/audit_events.sql`) and the generated `backend/internal/db/audit_events.sql.go` / `querier.go:153 InsertAuditEvent :exec` are **UNCHANGED** — the existing INSERT is reused verbatim.

## 9. New infrastructure dependency

**None.** No new migration, no new sqlc query, no new package, no new env var, no new docker-compose service, no new external service. The `audit_events` table already exists (migration `00011_create_audit_events.sql`); the `InsertAuditEvent` INSERT is already generated; the `pgxpool.Pool` and the `AuditEventRepository` singleton are already wired in `cmd/api/main.go::run` (line 139) and passed to `applicationRepo`. This slice passes the existing `auditRepo` to `companyRepo` — one additional constructor argument.

## 10. Risks

1. **Constructor seam break** — `NewCompanyRepository(pool)` → `NewCompanyRepository(pool, audit)` breaks 9 call sites (1 in `cmd/api/main.go` + 8 in `companyRepository_write_integration_test.go`). The atomic stub repair (5 stub repos + the 8 integration test sites) is mandatory in the same commit. Mitigation: `go build ./...` after the constructor change fails closed at the first non-migrated call site; the apply phase fixes them in one pass (mirror of `companies-write` D16).
2. **Closed-vocabulary AST guard flip** — `TestEventVocabularyIsClosed` will turn RED the moment the new constants are added but the `want` map is not yet expanded. Mitigation: update `auditEvent_test.go` in the SAME commit as the constants are added; the test's `want` map expansion is mechanical.
3. **`audit_events` row count assertion flip** — the integration test at line 491–493 / 606–615 pins the pre-change behavior ("no audit_events added"). It will turn RED on the first run after the change unless updated in the same commit. Mitigation: the assertion update is mechanical (count `+1`, plus `entity_type='company'` + `event_type='CompanyDeleted'` / `'CompanyUpdated'` assertions).
4. **Append ordering strictness** — the audit `Append` MUST run after `updated==1` / `deleted==1` (+ inline close) and before `tx.Commit`. Any append failure MUST return before `Commit` so the deferred `tx.Rollback` aborts the whole tx (fail-closed). Mitigation: code review (mirror of `applicationRepository.go` D5/D6); integration test for the rollback-on-audit-failure path (mirror of `TestSoftDeleteCompany_RollbackOnCloseFailure` style).
5. **`jobs_closed` int → string** — `map[string]string` requires `strconv.Itoa(int(closedCount))`. Off-by-one is impossible (the field is `int64` from `cmdtag.RowsAffected()` and the slice value is `int`). Mitigation: covered by `eventIntent_test.go::TestBuildCompanyDeletedMetadata_PinsJobsClosedInt`.
6. **Spec contradiction on landing** — if `audit_events/spec.md` and `companies/spec.md` are not updated in the SAME archive cycle, the spec set is self-contradictory for one cycle. Mitigation: §4.8 makes spec reconciliation part of the change; the apply phase edits both specs before any code lands.
7. **Metadata PII leakage via future refactor** — `eventIntent.go` is the single source of truth for metadata keys; a future edit adding e.g. `description` would leak free-text into the JSONB. Mitigation: `eventIntent_test.go::TestBuildCompanyDeletedMetadata_ClosedVocabulary` pins the allowed key set (`{jobs_closed}`) — same structural defense as `applications/eventIntent_test.go::TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID`.
8. **Integration-test cleanup predicate** — the cleanup at line 222–228 (`WHERE entity_type = 'companies' AND entity_id = ANY($1)`) currently targets the test's seed row (plural). The new production events use singular `'company'`. The cleanup widens to `IN ('companies', 'company')` so the new test-produced production row is also cleaned. Mitigation: applied mechanically in the same commit.
9. **No new migration = no DB-level rollback lever** — if a `CompanyDeleted` event needs to be deleted from `audit_events` in production, there is no DB mechanism (the table is append-only by design); recovery is via a hand-rolled DELETE. Mitigation: this is the existing audit invariant — same as the applications slice.
10. **Future `CompanyRestored` / `CompanySuspended` may conflict with the closed-vocabulary test** — if a future slice adds a constant to `auditEvent.go` without updating the AST guard, the test fails closed. Mitigation: the AST guard is the canary; the change pattern (update constants + update guard in same commit) is established by this slice.

## 11. Rollback plan

This is a **seam change** (no migration, no schema change, no new env var, no new docker-compose service, no new package, no new sqlc query). Simplest safe rollback: **revert the merge commit**.

Per `openspec/config.yaml::rules.proposal` ("Include a rollback plan for risky changes (schema migrations, breaking API surface)") and `companies-write` proposal §12 precedent:

- Reverting `cmd/api/main.go` reverts the `postgres.NewCompanyRepository(pool, auditRepo)` wiring to `postgres.NewCompanyRepository(pool)`.
- Reverting the companies adapter (`companyRepository.go`), use cases (`updateCompany.go`, `deleteCompany.go`), domain port (`companyRepository.go`), HTTP handler (`handler.go`), and the new `eventIntent.go` + `eventIntent_test.go` restores the pre-change companies slice. Any caller that had integrated against the new event emission loses it on deploy.
- Reverting the audit events constants (`auditEvent.go`) and the AST guard (`auditEvent_test.go`) restores the pre-change 2-event vocabulary.
- Reverting the spec deltas (`openspec/specs/audit_events/spec.md`, `openspec/specs/companies/spec.md`) restores the prior "companies emit nothing" / "no audit events for companies" wording — the two specs go back to being self-consistent (in their pre-change state).
- **No data migration in either direction**: the `audit_events` rows produced between merge and revert stay in the DB. They are valid (well-formed metadata, well-formed actor); consumers that depended on them continue to see them. If a subsequent rollback of the spec set is desired, a hand-rolled `DELETE FROM audit_events WHERE event_type IN ('CompanyUpdated', 'CompanyDeleted')` removes them — no DB-level cascade (the table has no FKs on `entity_id` by design).
- **Risk-adjusted rollback consideration** — `DELETE /me/company` continues to flip `jobs.status` to `closed` even after the audit emission is reverted (the inline close is unchanged). Rolling back the audit emission does NOT un-close the jobs. This is correct: the company shutdown is the user-requested effect; the audit row is the secondary effect that documents who/when.

**Partial-deploy guard**: if the new code is deployed but the audit_events vocabulary constants are accidentally not added (RED state of the AST guard), `cd backend && go test ./...` fails closed at compile time. If only some of the call sites are reverted, `go build ./...` fails closed at the constructor seam (the `NewCompanyRepository(pool)` signature no longer matches). Both states are detectable by CI; no silent gap.

## 12. Success criteria

- An owner of company `A` can `PATCH /me/company` with a valid body and a matching `If-Unmodified-Since` header; the response is `200 OK` with the redacted public company shape; **one** new `audit_events` row exists with `event_type='CompanyUpdated'`, `entity_type='company'`, `entity_id=<A>`, `actor_id=<CompanyContext.UserID>`, `actor_type='user'`, `metadata={}`.
- An owner of company `A` can `DELETE /me/company` with a matching `If-Unmodified-Since` header; the response is `204 No Content`; **one** new `audit_events` row exists with `event_type='CompanyDeleted'`, `entity_type='company'`, `entity_id=<A>`, `actor_id=<CompanyContext.UserID>`, `actor_type='user'`, `metadata={"jobs_closed":"<n>"}` (where `<n>` matches the rowcount of the inline `CloseCompanyJobs` UPDATE — e.g. `"2"` for a company with one draft + one published job; `"0"` for a company with no non-closed jobs).
- A `PATCH /me/company` with a stale / missing / malformed `If-Unmodified-Since` returns `409 Conflict` (PATCH: with the latest editor view; DELETE: with empty body — preserving the existing asymmetry) and **adds zero** `audit_events` rows.
- A `PATCH /me/company` with a body that fails `CompanyNameTooShort` / `InvalidCompanySize` / `FoundedYearOutOfRange` / `CompanyDescriptionTooLong` returns `400 Bad Request` and **adds zero** `audit_events` rows.
- A `PATCH /me/company` / `DELETE /me/company` against a soft-deleted company returns `404 company not found` and **adds zero** `audit_events` rows.
- A `PATCH /me/company` / `DELETE /me/company` request with `CompanyContext.UserID == uuid.Nil` (middleware bypassed / mis-wired) returns `500 internal server error` and **adds zero** `audit_events` rows (fail-closed `ErrMissingActorIdentity`).
- An audit `InsertAuditEvent` failure inside the co-write `pgx.Tx` aborts the domain write too — neither the company row nor the audit row is visible after the failure (`500 internal server error` to the client; `defer tx.Rollback` restores the pre-call state).
- `cd backend && go test ./...` green; `cd backend && go vet ./...` clean; `cd backend && go build ./...` clean; `cd backend && go test -tags=integration ./internal/features/companies/...` green; `cd backend && go tool sqlc generate` idempotent (no new query to generate).
- The AST guard `TestEventVocabularyIsClosed` continues to pass with the expanded 6-value closed set.
- The closed-key vocabulary test in `eventIntent_test.go` continues to pass — `{jobs_closed}` only — proving no PII can leak via the metadata builders.

## 13. Open items for the design phase

1. **`closedCount` plumbing seam** — the use case needs the `CloseCompanyJobs` rowcount to populate `metadata.jobs_closed`. Options: (a) adapter returns `(int, error)` from `SoftDeleteCompany` (port signature change); (b) adapter builds the event itself using a closure over `closedCount` (violates D7 single-source-of-truth); (c) the inline close is split into a separate method `CloseCompanyJobs(ctx, companyID) (int, error)` and the use case composes the two. Design picks one; §4.5 mandates that the use case is the event builder.
2. **`UserID` parameter ordering on use-case signatures** — `UpdateCompany(ctx, companyID, userID, in, ifUnmodifiedSince)` (mirror of `applications.TransitionApplication`) vs. trailing. Design decides; the proposal recommends `userID` immediately after `companyID` to mirror the applications precedent and keep the "identity pair" together.
3. **Test-stub atomic repair** — the 5 stub repos gain the `event` param (mirror of applications D16). Design enumerates them and locks the atomic-commit shape.
4. **Integration-test `companyB` audit_events cleanup** — the existing cleanup uses `entity_id = ANY($1)` over `{writeCoA, writeCoT, writeCoB}`. With production events for `writeCoA` now appearing, the cleanup widens to `entity_type IN ('companies', 'company')` to clean both the seed row and the production row. Design confirms the predicate.
5. **Order of constructor-arg threading** — `NewCompanyRepository(pool, audit)` vs. `NewCompanyRepository(audit, pool)`. The pool is conventionally first (mirroring `applicationRepository.go::NewApplicationRepository(pool, audit)`); design confirms.
6. **Spec archive staging** — both specs (`audit_events/spec.md`, `companies/spec.md`) MUST land in the same archive cycle as the code, or the spec set is self-contradictory for one cycle. Design confirms the archive staging plan.
7. **Future-only event constants** — should `EventCompanyCreated` (for `POST /companies` → `CreateCompanyWithOwner`) be added in this slice to round out the company catalog, or deferred to a follow-up? Recommendation: deferred (out of scope per §7 — the create path does not currently emit; adding a constant for a non-existent emitter violates the closed-vocabulary invariant). Design confirms.

## 14. Cross-references

- `openspec/changes/companies-audit/exploration.md` — the canonical factual base for this change.
- `openspec/specs/audit_events/spec.md` — the bounded context being extended. Modified per §4.8 + §6.8.
- `openspec/specs/companies/spec.md` — the emitting owner-only write paths. Modified per §4.8 + §6.8.
- `openspec/changes/archive/2026-08-25-audit_events/proposal.md` — the slice that introduced the `audit_events` bounded context. The new constants + closed-set expansion land in the same lineage.
- `openspec/changes/archive/2026-08-26-companies-write/proposal.md` — the prior slice that explicitly deferred company audit emission. This proposal closes the deferral.
- `backend/internal/features/audit_events/domain/entities/auditEvent.go` — `AuditEvent` struct + actor type VO + closed event vocabulary.
- `backend/internal/features/audit_events/domain/entities/auditEvent_test.go` — `TestEventVocabularyIsClosed` AST guard to update.
- `backend/internal/features/audit_events/domain/repositories/auditEventRepository.go` — append-only port; unchanged.
- `backend/internal/features/audit_events/infrastructure/postgres/auditEventRepository.go` — stateless sqlc adapter; unchanged.
- `backend/internal/features/applications/infrastructure/postgres/applicationRepository.go` — the co-write precedent. `Create` (lines ~117) and `Transition` (lines ~241) mirror exactly.
- `backend/internal/features/applications/application/usecases/eventIntent.go` — the builder precedent; the new `companies/eventIntent.go` mirrors its structure.
- `backend/internal/features/applications/application/usecases/eventIntent_test.go` — the closed-vocabulary test precedent.
- `backend/internal/features/applications/application/usecases/transitionApplication.go` — the fail-closed `uuid.Nil` guard precedent (`ErrMissingActorIdentity` + classifier mapping to 500).
- `backend/internal/features/applications/infrastructure/http/applicationHandler.go` — line 253 (`TransitionApplication(r.Context(), cc.CompanyID, cc.UserID, jobID, appID, in)`) is the handler precedent for passing `cc.UserID`.
- `backend/internal/features/companies/infrastructure/postgres/companyRepository.go` — the pool-owning adapter being extended.
- `backend/internal/features/companies/application/usecases/updateCompany.go` / `deleteCompany.go` — the orchestrators being extended.
- `backend/internal/features/companies/application/usecases/companyService.go` — the sentinel home for `ErrMissingActorIdentity`.
- `backend/internal/features/companies/infrastructure/http/handler.go` — the handlers gaining the `cc.UserID` pass-through + the `ErrMissingActorIdentity` classifier branch.
- `backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go` — the integration test that flips its audit-count assertion and widens its cleanup predicate.
- `backend/cmd/api/main.go` line 99 (`companyRepo := postgres.NewCompanyRepository(pool)`) — the constructor seam being extended; line 139 (`auditRepo := auditpostgres.NewAuditEventRepository()`) — the existing singleton being passed in.
- `backend/internal/features/identity/domain/security/companyContext.go` — the `CompanyContext.UserID` field (already populated by `RequireCompanyRole`; currently ignored by the companies PATCH/DELETE handlers — the seam this change exploits).
- `openspec/config.yaml` — config-driven rollback rule (`proposal: Include a rollback plan for risky changes`); `audit_events.spec.md::Requirement: Audit Events Schema Migration §1.3 exception` — the rationale for `event_type` not being CHECK-constrained.

---

Status: ready for `sdd-spec`. The spec phase must produce matching `delta` files for `openspec/specs/audit_events/spec.md` and `openspec/specs/companies/spec.md` per §4.8, or the spec set is self-contradictory for the change's archive cycle.
