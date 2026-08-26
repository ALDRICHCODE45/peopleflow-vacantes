# Exploration: `companies-audit` — emit `CompanyUpdated` / `CompanyDeleted` from companies write paths

Status: success
Artifact store: openspec
Execution mode: auto · delivery_strategy: single-pr

## Executive summary

The companies write paths (`PATCH /me/company` → `UpdateCompany`, `DELETE /me/company` → `SoftDeleteCompany`) are already pool-owning transactional adapters that open their own `pgx.Tx` and commit atomically. The `audit_events` `Append(ctx, tx)` helper is already reusable and tx-scoped, and applications demonstrates the exact co-write pattern to mirror. To add `CompanyUpdated` + `CompanyDeleted`, the change is a **seam change, not a migration**: add the audit adapter to the companies postgres adapter, thread an `AuditEvent` value param through the companies port + use case, build the event in the use case (actor = `CompanyContext.UserID`, already available but currently ignored by the handlers), and append inside the existing tx before commit. No new goose migration and no new sqlc query are required — the audit INSERT already exists and `event_type` is deliberately NOT DB-CHECK-constrained. Two spec docs and two test closures must be updated: the canonical `audit_events/spec.md` ("exactly two event types", "jobs/companies/identity emit nothing") and `companies/spec.md` ("No Audit Events for Companies (Deferred)"), plus the `auditEvent_test.go` closed-vocabulary AST guard and the `companyRepository_write_integration_test.go` "audit_events row count unchanged" assertion.

---

## Hallazgos (findings)

### 1. Write paths de companies (handler → use case → port → adapter)

- **HTTP handlers** — `backend/internal/features/companies/infrastructure/http/handler.go`
  - `updateCompany` (PATCH `/me/company`): reads `requireCompanyContext(w, r)` then calls `h.service.UpdateCompany(r.Context(), cc.CompanyID, in, ifUnmodifiedSince)`. It does **not** pass `cc.UserID` today.
  - `deleteCompany` (DELETE `/me/company`): reads `requireCompanyContext(w, r)` then calls `h.service.SoftDeleteCompany(r.Context(), cc.CompanyID, ifUnmodifiedSince)`. Also ignores `cc.UserID`.
  - `requireCompanyContext` lives in `backend/internal/features/companies/infrastructure/http/memberHandler.go` (same package) and returns `security.CompanyContext` (which already carries `UserID`).
- **Use cases** — `backend/internal/features/companies/application/usecases/`
  - `updateCompany.go`: `func (s *CompanyService) UpdateCompany(ctx, companyID uuid.UUID, in dtos.UpdateCompanyDto, ifUnmodifiedSince time.Time) (*dtos.CompanyEditorViewDto, error)`. 8 steps: read-for-update → CAS compare → VO parse → build patch → `repo.UpdateCompany` → re-read on 0-rows → re-read on success → project view.
  - `deleteCompany.go`: `func (s *CompanyService) SoftDeleteCompany(ctx, companyID uuid.UUID, ifUnmodifiedSince time.Time) error`. Read-for-delete → CAS compare → `repo.SoftDeleteCompany`.
- **Repository port** — `backend/internal/features/companies/domain/repositories/companyRepository.go`
  - `UpdateCompany(ctx, companyID uuid.UUID, patch UpdateCompanyPatch, casUpdatedAt time.Time) error`
  - `SoftDeleteCompany(ctx, companyID uuid.UUID, casUpdatedAt time.Time) error`
  - Neither method takes an audit event today.
- **Postgres adapter** — `backend/internal/features/companies/infrastructure/postgres/companyRepository.go`
  - `CompanyRepository{ pool *pgxpool.Pool }` (pool-owning, WU3/D15 of companies-write).
  - `UpdateCompany`: `tx, _ := r.pool.Begin(ctx)` → `db.New(tx).UpdateCompany(...)` → `if updated == 0 { return ErrCompanyNotFound }` → `tx.Commit(ctx)`.
  - `SoftDeleteCompany`: `tx, _ := r.pool.Begin(ctx)` → `db.New(tx).SoftDeleteCompany(...)` → `if deleted == 0 { return ErrCompanyNotFound }` → `db.New(tx).CloseCompanyJobs(...)` (inline close) → `tx.Commit(ctx)`.
  - **Soft-delete + inline close are in ONE `pgx.Tx`** (the soft-delete UPDATE and the `CloseCompanyJobs` UPDATE run inside the same transaction, `defer tx.Rollback(ctx)` covers error paths).

### 2. Helper `Append(ctx, tx)` de audit_events

- **Port** — `backend/internal/features/audit_events/domain/repositories/auditEventRepository.go`
  - `type AuditEventRepository interface { Append(ctx context.Context, tx pgx.Tx, event entities.AuditEvent) error }` (append-only, tx-scoped; port never begins/commits).
- **Stateless adapter** — `backend/internal/features/audit_events/infrastructure/postgres/auditEventRepository.go`
  - `func (r *AuditEventRepository) Append(ctx context.Context, tx pgx.Tx, event auditentities.AuditEvent) error` — marshals `event.Metadata` to JSON bytes then `db.New(tx).InsertAuditEvent(ctx, buildInsertAuditEventParams(event, meta))`.
  - `NewAuditEventRepository()` returns a stateless `&AuditEventRepository{}`.
- **Usage today (applications, fail-closed co-write)** — `backend/internal/features/applications/infrastructure/postgres/applicationRepository.go`
  - `ApplicationRepository{ pool *pgxpool.Pool; audit auditrepositories.AuditEventRepository }`; constructor `NewApplicationRepository(pool, audit)`.
  - `Create` (line ~117) and `Transition` (line ~241) call `r.audit.Append(ctx, tx, event)` strictly AFTER the domain write succeeds and strictly BEFORE `tx.Commit`; an append failure returns an error → `defer tx.Rollback` aborts the whole tx (no write, no event).
- **`AuditEvent` type + constants** — `backend/internal/features/audit_events/domain/entities/auditEvent.go`
  - `AuditEvent{ ID uuid.UUID; ActorType ActorType; ActorID *uuid.UUID; EventType string; EntityType string; EntityID uuid.UUID; Metadata map[string]string }`.

### 3. Catálogo de eventos (event_type / actor_type / entity_type / metadata)

- Constants today (`auditEvent.go`):
  - `ActorTypeUser = "user"`, `ActorTypeSystem = "system"` (actor_type, DB CHECK-constrained).
  - `EventApplicationSubmitted = "ApplicationSubmitted"`, `EventApplicationTransitioned = "ApplicationTransitioned"` (event_type, NO DB CHECK).
  - `EntityApplication = "application"` (entity_type).
  - **No `EntityCompany`, no `CompanyUpdated`/`CompanyDeleted`/`CompanySoftDeleted` constants exist anywhere** (grep over `backend/` returned no matches).
- Metadata is `map[string]string` marshaled to JSONB. Applications metadata shapes (single source of truth in `applications/application/usecases/eventIntent.go`):
  - `buildSubmittedMetadata` → `{ "job_id", "source" }` (source only when non-NULL).
  - `buildTransitionedMetadata` → `{ "job_id", "from_status", "to_status" }`.
  - The allowed-key set is pinned by `eventIntent_test.go::TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID` to `{job_id, source, from_status, to_status}` (PII-free).

### 4. ¿Cómo conecta el postgres adapter de companies su tx?

The companies postgres adapter **already owns the `pgx.Tx` locally** inside `UpdateCompany` and `SoftDeleteCompany` (via `r.pool.Begin(ctx)`). It does **NOT** currently hold the audit `AuditEventRepository`, so it cannot co-write audit today. The minimal refactor (mirror applications D5/D6 exactly) is:

1. Add field `audit auditrepositories.AuditEventRepository` to `CompanyRepository` and change the constructor to `NewCompanyRepository(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository)`.
2. Extend the port methods with an `event auditentities.AuditEvent` **value param**: `UpdateCompany(ctx, companyID, patch, casUpdatedAt, event)` and `SoftDeleteCompany(ctx, companyID, casUpdatedAt, event)`.
3. In the adapter, call `r.audit.Append(ctx, tx, event)` after the domain write succeeds (`updated != 0` / `deleted != 0` and, for soft-delete, after the inline close) and before `tx.Commit`.
4. Build the event in the use case (single source of truth), which requires the actor. `CompanyContext.UserID` already exists (`backend/internal/features/identity/domain/security/companyContext.go`) and is populated by `RequireCompanyRole`; the handlers must pass `cc.UserID` into the use cases, and the use cases should add a `uuid.Nil` fail-closed guard (mirror applications D8).

### 5. Migración

**No new migration is required.** Facts:

- The `audit_events` table already exists (`backend/db/migrations/00011_create_audit_events.sql`) with `event_type TEXT NOT NULL` and **no CHECK** on `event_type` (the §1.3 exception).
- The sqlc INSERT `InsertAuditEvent :exec` already exists (`backend/db/queries/audit_events.sql`, generated at `backend/internal/db/audit_events.sql.go` / `querier.go:153`), and `Append` covers it entirely.
- The companies write queries (`UpdateCompany :one`, `SoftDeleteCompany :one` in `companies.sql`; `CloseCompanyJobs :execrows` in `jobs.sql`) already exist and are already generated.
- Therefore adding `CompanyUpdated`/`CompanyDeleted` is **code-only** — no new goose migration, no new sqlc query, no `go tool sqlc generate` (the audit INSERT and company write queries are unchanged).

### 6. Esquema hexagonal

Confirmed — `companies`, `audit_events`, and `applications` all follow domain / application / infrastructure layering:

- `backend/internal/features/companies/{domain,application,infrastructure}`
- `backend/internal/features/audit_events/{domain,infrastructure}` (audit has no application layer; it's a pure append port + stateless adapter)
- `backend/internal/features/applications/application/{dtos,usecases}`, `domain/{entities,repositories,valueobjects}`, `infrastructure/{http,postgres}`
- Reference co-write pattern: `backend/internal/features/applications/infrastructure/postgres/applicationRepository.go` (pool-owning + audit field + `Append` before `Commit`).

---

## Facts (hard, verified)

1. `companies` postgres adapter is pool-owning and opens its own `pgx.Tx` in `UpdateCompany` and `SoftDeleteCompany`; soft-delete + inline job close run in ONE tx (`companyRepository.go`).
2. `audit_events` `Append(ctx, tx pgx.Tx, event AuditEvent) error` is tx-scoped and stateless; applications uses it exactly once per write, between the domain write and `tx.Commit` (`applicationRepository.go`).
3. Existing event constants: `ApplicationSubmitted`, `ApplicationTransitioned`, `EntityApplication="application"`; actor vocabulary `user`/`system`. No company event/entity constant exists.
4. `event_type` has no DB CHECK (migration `00011`), so new event types are a code change, not a migration.
5. No new migration / no new sqlc query is needed for company audit emission (`InsertAuditEvent` already exists and is generated).
6. `CompanyContext.UserID` already exists and is populated by `RequireCompanyRole`; the companies PATCH/DELETE handlers read `CompanyContext` but currently ignore `UserID`.
7. `TestEventVocabularyIsClosed` (`auditEvent_test.go`) AST-pins the exactly-two event constants + `EntityApplication` and greps `backend/internal/features/**` for the two literals; it MUST be updated when the company constants are added (otherwise RED).
8. `companyRepository_write_integration_test.go` seeds one `audit_events` row and asserts the `audit_events` row count is unchanged after soft-delete (lines ~491-493 and ~606-615); this assertion must flip to "one new `CompanyDeleted` row".
9. `NewCompanyRepository(pool)` is called in `cmd/api/main.go:99` and 8 times in `companyRepository_write_integration_test.go` (lines 268, 389, 498, 697, 738, 815, 907); adding an `audit` constructor arg breaks all 9 call sites (atomic seam repair, mirror applications).
10. `AuditEvent.Metadata` is `map[string]string` — company metadata values must be strings (or an empty map).

---

## Open questions (for the proposal to resolve)

1. **Exact metadata shape** for `CompanyUpdated` and `CompanyDeleted` — e.g. empty `{}`, or `{"company_id": ...}` (redundant with `entity_id`), or a changed-fields list. Given `map[string]string`, any value must be a string. Must pin exact keys + a PII-free test.
2. **`entity_type` string** — confirm singular `"company"` (matching `EntityApplication = "application"`), even though the existing integration fixture seed uses plural `'companies'`.
3. **Delete event catalog** — settle on exactly `CompanyUpdated` + `CompanyDeleted` (the task names these two); decide whether `CompanySoftDeleted`/`CompanyRestored` stay future-only.
4. **Non-success outcomes emit nothing** — pin that CAS conflict (409), VO 4xx, 404, and the `UpdateCompany` lost-race (0-rows) paths append no event (mirror applications' "no event on non-write").
5. **Does `CompanyDeleted` metadata record the inline-close row count?** Today `closedCount` is captured but discarded (`_ = closedCount`). Recording it requires `strconv.Itoa` into `map[string]string`; proposal should decide yes/no.
6. **Event builder location** — new `companies/application/usecases/eventIntent.go` mirroring applications, vs inline builders in the two use-case files.
7. **Fail-closed actor guard** — confirm `uuid.Nil` `UserID` → 500 fail-closed, no write, no event (mirror applications D8).

## Risks / gotchas

- **Spec contradiction to reconcile:** `openspec/specs/audit_events/spec.md` "Purpose" + "Event Type Vocabulary (Closed Set for This Cycle)" currently declare "exactly two event types" and "jobs/companies/identity emit nothing"; `openspec/specs/companies/spec.md` "No Audit Events for Companies (Deferred)" asserts `audit_events` row count unchanged. Both MUST be revised in the same proposal or the spec set is self-contradictory.
- **Closed-vocabulary unit test is AST-enforced:** `TestEventVocabularyIsClosed` pins the untyped string-constant surface to exactly the two events + `EntityApplication` and greps for the literals; adding company constants without updating it is a RED.
- **Append ordering must be strict:** append AFTER `updated == 1` / `deleted == 1` (+ inline close success) and BEFORE `tx.Commit`; any append failure must return before commit so the `defer tx.Rollback` aborts the write (fail-closed).
- **Constructor seam breaks 9 call sites** (main.go + 8 integration-test lines); must be repaired atomically.
- **Metadata type is `map[string]string`** — cannot store an int row count without string conversion; keep metadata minimal and PII-free.
- **Integration fixture cleanup uses `entity_type = 'companies'`** (plural, test-only); the proposal's domain `EntityCompany` will be `'company'` (singular) — ensure cleanup targets don't accidentally delete or miss real `company` events.

## next_recommended

sdd-proposal
