# Tasks: `companies-audit` — emit `CompanyUpdated` / `CompanyDeleted` from companies write paths

Status: tasks (SDD phase). Grounded by `openspec/changes/companies-audit/proposal.md`, the two deltas under `openspec/changes/companies-audit/specs/{audit_events,companies}/spec.md`, and `openspec/changes/companies-audit/design.md`. Design decisions **D1–D11 are pinned and MUST NOT be re-opened**; every task references the decision IDs it implements so apply can trace them. The change is a **seam change, not a migration** — no goose migration, no new sqlc query (`audit_events` schema + `InsertAuditEvent :exec` already exist; the closed vocabulary is a code-level invariant). Preflight pinned `delivery_strategy: single-pr`; the budget forecast below surfaces the per-file authored estimate honestly so the orchestrator can decide whether the exception is acceptable.

**Locked decisions NOT to re-open** (design §1/§2):

- **D1** — `jobs_closed` metadata is finalized in the **adapter** via `auditentities.CompanyDeletedMetadata(int(closedCount))`; the use case builds the event **structure** with `Metadata: nil`; the port `SoftDeleteCompany` return stays `error`. Option (a) "return `(int, error)` from the port" is **circular** and **rejected** — the count only exists *after* the inline close inside the same call.
- **D2** — `userID uuid.UUID` sits **immediately after `companyID`** in `UpdateCompany` / `SoftDeleteCompany` (identity-pair grouping; mirror of `applications.TransitionApplication`).
- **D3** — Port signature: `event auditentities.AuditEvent` value param (NOT pointer), **last position** on `UpdateCompany` and `SoftDeleteCompany` (mirror of `applications.Create` / `applications.Transition`).
- **D4** — `NewCompanyRepository(pool, audit)` — pool first, audit second. Constructor + port-signature seams are **one atomic compile-break repair** spanning **8 constructor sites** (1 in `cmd/api/main.go` + 7 in the integration suite) and **12 stub types** across 8 test files. `main.go` MUST hoist the `auditRepo` declaration above `companyRepo` (audit is stateless; the applications wiring block continues to reference the same variable).
- **D5** — `eventIntent.go` in `companies/application/usecases/` holds the two **structure** builders (`newCompanyUpdatedEvent`, `newCompanyDeletedEvent`). The DELETE metadata builder is `auditentities.CompanyDeletedMetadata(int) map[string]string` in the audit_events domain (so the adapter can call it without an infra→application import). **No `append_audit` helper exists** — the adapter calls `r.audit.Append(ctx, tx, event)` inline.
- **D6** — `ErrMissingActorIdentity = errors.New("missing actor identity")` sentinel in `companies/application/usecases/companyService.go`; guard is the **FIRST step** of both use cases (before `GetCompanyForUpdate`, before the CAS compare); classifier maps it to `500 internal server error` (no existence leak).
- **D7** — `AuditEvent` shape is the existing `audit_events/domain/entities/auditEvent.go::AuditEvent`; eventID is `uuid.NewV7()` in the use case; actor = `&userID`; PATCH metadata = `map[string]string{}` (non-nil → `{}`); DELETE metadata = `nil` at build time, finalized by adapter.
- **D8** — Testability: unit (`eventIntent_test.go`, use-case mock port, handler tests asserting stub-captured event) + integration (real co-write; flip "row count unchanged" → "+1 CompanyDeleted" + add parallel PATCH +1 test). 12 stub types enumerated in design §8 / inventory in §3.
- **D9** — Adapter operation order: `pool.Begin` → `defer tx.Rollback` → `db.New(tx).UpdateCompany/SoftDeleteCompany` → if `updated==0` / `deleted==0` → `ErrCompanyNotFound` (NO append) → for DELETE, inline `CloseCompanyJobs` → `event.Metadata = auditentities.CompanyDeletedMetadata(int(closedCount))` → `r.audit.Append(ctx, tx, event)` (wrapped `fmt.Errorf("co-write audit: %w", err)` on failure) → `tx.Commit`. The deferred `tx.Rollback` covers audit failures → fail-closed co-write.
- **D10** — Both spec deltas (`openspec/specs/audit_events/spec.md` + `openspec/specs/companies/spec.md`) MUST land in the same archive cycle as the code (Phase 4); otherwise the spec set is self-contradictory for one cycle.
- **D11** — Future-only constants stay future-only: only `EventCompanyUpdated` + `EventCompanyDeleted` are added; `EventCompanyCreated`, `CompanyRestored`, `CompanySoftDeleted` deferred (proposal §7). Adding a constant for a non-existent emitter would violate the closed-vocabulary invariant.

**Work-unit (commit) structure** — four work units, each with a single commit, start/finish/verify/rollback boundaries, and the RED→GREEN discipline within (WU2 is the **atomic seam** — the port + constructor + 12-stub repairs + adapter body + use cases + handler + main.go wiring all land in one commit because `go build ./...` fails closed between any sub-step):

| WU | Commit name | Scope | Verification gate |
|----|-------------|-------|-------------------|
| WU1 | `feat(audit_events): extend closed vocabulary with CompanyUpdated / CompanyDeleted + CompanyDeletedMetadata` | `auditEvent.go` (MOD: 2 event constants + `EntityCompany` + `CompanyDeletedMetadata`) + `auditEvent_test.go` (MOD: `want` map + new `TestCompanyDeletedMetadata_*` cases) | `go test ./internal/features/audit_events/...` green; AST guard passes |
| WU2 | `feat(companies-audit): co-write CompanyUpdated / CompanyDeleted inside the companies pgx.Tx (atomic seam)` | port extension + `eventIntent.go` NEW + use case modifications + adapter `audit` field + `UpdateCompany`/`SoftDeleteCompany` Append calls + handler classifier + `cmd/api/main.go` hoist + 12-stub atomic repair | `go build ./...` green; `go test ./...` green; integration test flipped |
| WU3 | `feat(companies-audit): SQL-level co-write integration coverage + cleanup widening + owner-user seed` | `companyRepository_write_integration_test.go` (MOD: constructor arg + invariant flip + PATCH +1 test + cleanup predicate widen + deterministic owner-user seed) | `make test-integration` green; production code unchanged |
| WU4 | `chore(archive): reconcile audit_events + companies specs (single-PR cycle, D10)` | `openspec/specs/audit_events/spec.md` (MOD: paste delta) + `openspec/specs/companies/spec.md` (MOD: paste delta + remove the deferred bullet) + `openspec/changes/companies-audit/` → `openspec/changes/archive/YYYY-MM-DD-companies-audit/` | `openspec/changes/companies-audit/specs/` and the two canonical specs reconciled; no production code touched |

Apply notes (non-negotiable):

- **Strict TDD (`strict_tdd: true`)** — RED tasks precede their GREEN counterpart. A RED task is satisfied when the focused test fails for the intended reason (compile break on missing method/type/sentinel is an accepted RED — `audit_events` WU3 and `companies-write` WU5 precedents).
- **Checkboxes `[x]` only after the corresponding commit lands** (this draft uses `- [ ]` throughout; apply phase marks them).
- **No migration** — `audit_events` exists since migration `00011`; `event_type` deliberately has no DB CHECK (per `openspec/specs/audit_events/spec.md §1.3 exception`); the new event literals are a code-only change. **DO NOT author a `db/migrations/000XX_*.sql` task.**
- **No new sqlc query** — `InsertAuditEvent :exec` already exists in `backend/db/queries/audit_events.sql` and is regenerated in `internal/db/audit_events.sql.go`. **`go tool sqlc generate` MUST be idempotent** after the seam change (no new query, no schema delta).
- **WU2 atomic stub repair** — the port signature change (D3) and the constructor change (D4) are compile-break seams; `go build ./...` fails closed until all 8 constructor sites and all 12 stub types are migrated. The 12 stub types (across 8 test files) and the constructor seam must land in **one commit** alongside the production bodies (the `jobs-write` D9 / `companies-write` WU3 pattern).
- **Test helper for integration** — the 7 integration call sites share one stateless audit adapter. Use a package-local helper `func newTestCompanyRepository(pool *pgxpool.Pool) *CompanyRepository { return NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository()) }` (or inline `auditpostgres.NewAuditEventRepository()` at each site) — the design pins the **helper** form to avoid 7 duplicated imports of the audit postgres package.
- **OpenSpec archive staging (D10)** — both `openspec/specs/audit_events/spec.md` and `openspec/specs/companies/spec.md` MUST be reconciled (the deltas already authored under `openspec/changes/companies-audit/specs/`) and the change folder moved to `openspec/changes/archive/YYYY-MM-DD-companies-audit/` in the same single-PR cycle. Partial spec landing leaves the spec set self-contradictory for one cycle.
- **Test command discipline** after every GREEN: `cd backend && go test ./...` (integration suite is skipped when `DATABASE_URL` is unset under plain `go test`); `cd backend && go vet ./...`; `cd backend && go tool sqlc generate` idempotent re-run.

---

## Review Workload Forecast

| Field | Value |
|-------|-------|
| **total_authored_lines_estimate** | **~880–1,280 additions+deletions** across ~19 authored files (production + tests + OpenSpec). No generated sqlc, no migration. Detailed per-file breakdown below. |
| **400-line budget risk** | **High** (~2.2–3.2× budget). The preflight pinned `single-pr`; this slice exceeds the 400-line single-PR budget by a wide margin. |
| **Chained PRs recommended** | **Yes** — per work-unit-commits skill "If the PR approaches 400 changed lines, promote commits or groups of commits into chained PRs." However, **WU2 is genuinely atomic** (port + constructor + 12 stubs + adapter + use cases + handler + wiring in one compile-break unit); the natural chain is WU1 → WU2 → WU3 → WU4, with WU2 being an intentional `size:exception` (~600–900 lines, similar to `audit_events` PR 3). WU1 and WU3 are safe additive merges and could auto-chain; WU2 requires explicit acceptance; WU4 is a 0-production-code archive PR. |
| **decision_needed_before_apply** | **Yes** — the orchestrator MUST surface to the user that the preflight `single-pr` strategy now exceeds the 400-line budget by ~2.2–3.2×. The user must decide either (a) accept the `size:exception` and keep `single-pr` (mirroring `companies-write` precedent where the size-exception was accepted), OR (b) pivot to a chained-PR delivery (WU1 → WU2 → WU3 → WU4 stacked-to-main, mirroring `audit_events` chain). **The tasks executor does NOT decide this exception** — it is escalated to the orchestrator and then to the user. |
| **estimated_pr_count** | If `size:exception` accepted: **1 PR** (with WU1–WU4 as commits inside the PR). If chained: **3–4 PRs** (WU1 standalone additive + WU2 atomic seam with `size:exception` + WU3 test flip + WU4 archive) — though WU3 and WU4 are nearly empty of production code and could fold into WU2's PR (test-only delta + archive). The natural cleanest split is **2 PRs** if the chain is forced: (PR-1: WU1 additive constants + AST guard; PR-2: WU2 + WU3 + WU4 as the atomic seam+archive), but PR-2 itself would still need its own `size:exception` (~750–1,100 lines). |
| **Chain strategy** | **pending** — depends on the user decision above. If accepted single-pr: `size-exception`. If chained: `stacked-to-main` (WU1 first because WU2 uses the new constants; WU2 next; WU3 last because it asserts the full co-write; WU4 archives at the end of the same single PR if single-pr is kept, or as the merge commit of the chain if chained). |
| **Delivery strategy (current preflight)** | `single-pr` (pinned by preflight) |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception | stacked-to-main (pending user decision)
400-line budget risk: High
```

**Per-file authored estimate (deltas — additions + deletions; excludes `internal/db/*` regen because no new sqlc query lands; this slice is generated-code-free for sqlc):**

| File | Op | Est. lines (authored) |
|------|----|------------------------|
| **Production (WU1)** | | |
| `internal/features/audit_events/domain/entities/auditEvent.go` | MOD | +25 (2 event constants + `EntityCompany` + `CompanyDeletedMetadata` + docs) |
| `internal/features/audit_events/domain/entities/auditEvent_test.go` | MOD | +30 (expand `want` map + `TestCompanyDeletedMetadata_AlwaysPresentKey` + closed-vocab addition) |
| **Production (WU2)** | | |
| `internal/features/companies/application/usecases/companyService.go` | MOD | +12 (`ErrMissingActorIdentity` sentinel + doc) |
| `internal/features/companies/application/usecases/updateCompany.go` | MOD | +20 (`userID` param + guard + `eventID, _ := uuid.NewV7()` + builder call + `event` arg to `repo.UpdateCompany`) |
| `internal/features/companies/application/usecases/deleteCompany.go` | MOD | +20 (same shape) |
| `internal/features/companies/application/usecases/eventIntent.go` | NEW | +40 (package doc + `newCompanyUpdatedEvent` + `newCompanyDeletedEvent`) |
| `internal/features/companies/domain/repositories/companyRepository.go` | MOD | +10 (import auditentities + 2 method signature extensions) |
| `internal/features/companies/infrastructure/postgres/companyRepository.go` | MOD | +90 (`audit` field + `NewCompanyRepository(pool, audit)` + `Append` in `UpdateCompany` + `Append` + `CompanyDeletedMetadata` finalization in `SoftDeleteCompany` + import) |
| `internal/features/companies/infrastructure/http/handler.go` | MOD | +30 (pass `cc.UserID` + classifier branches for `ErrMissingActorIdentity` → 500 + import) |
| `backend/cmd/api/main.go` | MOD | +8 (hoist `auditRepo` declaration + add `auditRepo` arg) |
| **Tests (WU2)** | | |
| `internal/features/companies/application/usecases/eventIntent_test.go` | NEW | +110 (4 tests: shape of each event, `CompanyDeletedMetadata` always-present, closed vocabulary for company events) |
| `internal/features/companies/application/usecases/updateCompany_test.go` | MOD | +55 (stub `event` capture field + `TestUpdateCompany_MissingUserIDFailsClosed` + update existing call sites) |
| `internal/features/companies/application/usecases/deleteCompany_test.go` | MOD | +55 (same shape) |
| `internal/features/companies/infrastructure/http/handler_test.go` | MOD | +10 (`stubRepo.UpdateCompany`/`SoftDeleteCompany` accept `event`) |
| `internal/features/companies/infrastructure/http/updateCompanyHandler_test.go` | MOD | +75 (`MissingUserIDReturns500` + `PassesCompanyUpdatedEvent` + stub `event` capture) |
| `internal/features/companies/infrastructure/http/deleteCompanyHandler_test.go` | MOD | +75 (same shape) |
| `internal/features/companies/infrastructure/http/memberHandler_test.go` | MOD | +10 (`stubMemberCompanyRepositoryForHandler.UpdateCompany`/`SoftDeleteCompany` accept `event`) |
| `internal/features/companies/application/usecases/companyMemberService_test.go` | MOD | +10 (`stubMemberCompanyRepository.UpdateCompany`/`SoftDeleteCompany` accept `event`) |
| `internal/features/companies/application/usecases/createCompany_test.go` | MOD | +10 (`stubCompanyRepository.UpdateCompany`/`SoftDeleteCompany` accept `event`) |
| **Tests (WU3)** | | |
| `internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go` | MOD | +200 (constructor arg flip on 7 sites via helper + invariant (e) flip on `TestSoftDeleteCompany_TombstonesAndClosesJobs` + new `TestUpdateCompany_ProducesCompanyUpdatedAuditRow` PATCH +1 test + cleanup predicate widen `entity_type IN ('companies', 'company')` + deterministic `writeOwnerUserID` seed + `actor_id=<seed userID>` assertion) |
| **OpenSpec (WU4)** | | |
| `openspec/specs/audit_events/spec.md` | MOD | +90 (paste delta from `openspec/changes/companies-audit/specs/audit_events/spec.md`: closed set 2→4, metadata shape adds 2 rows, closed-key vocab adds `jobs_closed`) |
| `openspec/specs/companies/spec.md` | MOD | +90 (paste delta from `openspec/changes/companies-audit/specs/companies/spec.md`: REMOVED "No Audit Events for Companies (Deferred)" + ADDED "Audit Events for Companies" + Purpose paragraph update + Out-of-scope bullet removal) |

**Sum: ~1,070 authored additions+deletions across ~22 files.** **~2.7× the 400-line budget** (range 880–1,280 across estimation uncertainty).

**Decision flag rationale:** The preflight pinned `delivery_strategy: single-pr`. Forecasted size exceeds the 400-line budget by ~2.2–3.2× — **above the High-risk threshold**, per work-unit-commits skill "If the PR approaches 400 changed lines, promote commits or groups of commits into chained PRs." However, the **WU2 seam is genuinely atomic** — the port signature change + constructor change + 12-stub repair must land in one commit because `go build ./...` fails closed between any sub-step (this is the `audit_events` WU3 / `companies-write` WU3 atomic seam precedent). This means **even a chained delivery has a single large PR** (WU2 + WU3 + WU4 together ≈ 750–1,100 lines) requiring its own `size:exception` — chaining does NOT eliminate the budget pressure, only WU1 (~55 lines, additive constants) is small enough to chain standalone. The user must decide; the apply agent does not auto-chain.

**Rollback scope:** Revert the merge commit (single-pr) or each WU commit (chained). No migration in either direction. The `audit_events` rows produced between merge and revert stay in the DB (append-only by design; recovery via hand-rolled `DELETE FROM audit_events WHERE event_type IN ('CompanyUpdated', 'CompanyDeleted')` is the existing audit invariant — same as the applications slice).

---

## Phase 1 — WU1 (Commit A): audit_events vocabulary extension + AST guard (additive)

Files: `backend/internal/features/audit_events/domain/entities/auditEvent.go` (MOD), `backend/internal/features/audit_events/domain/entities/auditEvent_test.go` (MOD). Commit **A**.
Verification gate: `cd backend && go test ./internal/features/audit_events/...` green; AST guard `TestEventVocabularyIsClosed` passes with the expanded 4-event closed set; **nothing else touched** (no consumers yet — WU2 wires the consumers).

### 1.1 RED — Expand the AST guard for the new closed set (D7/D11)

- [ ] 1.1 RED — Author `TestCompanyDeletedMetadata_AlwaysPresentKey` and expand the `want` map in `auditEvent_test.go` to include `EventCompanyUpdated`, `EventCompanyDeleted`, `EntityCompany`; confirm the AST guard test fails for the intended reason. <!-- sdd-owner: implementation -->

In `backend/internal/features/audit_events/domain/entities/auditEvent_test.go` (MOD):

- Update the existing `TestEventVocabularyIsClosed` `want` map from `{EventApplicationSubmitted, EventApplicationTransitioned, EntityApplication}` to `{EventApplicationSubmitted, EventApplicationTransitioned, EventCompanyUpdated, EventCompanyDeleted, EntityApplication, EntityCompany}` (6 values total). RED: the constants don't exist yet → AST guard fails the "exactly N values" assertion.
- Add `TestCompanyDeletedMetadata_AlwaysPresentKey` (NEW): assert `CompanyDeletedMetadata(0) == map[string]string{"jobs_closed": "0"}`; `CompanyDeletedMetadata(1) == {"jobs_closed": "1"}`; `CompanyDeletedMetadata(5) == {"jobs_closed": "5"}`; assert the returned map is non-nil and has exactly one key; assert `strconv.Itoa` semantics (the value is the stringified int, not the raw int and not `fmt.Sprintf`). RED: `CompanyDeletedMetadata` doesn't exist yet → compile error.

- Verify: `cd backend && go test ./internal/features/audit_events/...` → **RED** (compile: `EventCompanyUpdated`, `EventCompanyDeleted`, `EntityCompany`, `CompanyDeletedMetadata` undefined; the `want` map edit plus the new test both fail). Rollback: revert the test hunks.

### 1.2 GREEN — Add the 3 constants + the metadata builder (D7/D11)

- [ ] 1.2 GREEN — Add `EventCompanyUpdated`, `EventCompanyDeleted`, `EntityCompany`, and `CompanyDeletedMetadata` to `auditEvent.go`; expand the package doc to document the 4-event closed set. <!-- sdd-owner: implementation -->

In `backend/internal/features/audit_events/domain/entities/auditEvent.go` (MOD):

- Import `strconv` (add to the import block).
- Add to the `Event-type constants` block (sibling to `EventApplicationSubmitted` / `EventApplicationTransitioned`):
  ```go
  EventCompanyUpdated = "CompanyUpdated"
  EventCompanyDeleted = "CompanyDeleted"
  ```
- Add to the entity-type block (sibling to `EntityApplication`):
  ```go
  const EntityCompany = "company"
  ```
- Add `CompanyDeletedMetadata(closedCount int) map[string]string` — pure function, returns exactly `{"jobs_closed": strconv.Itoa(closedCount)}` (the `jobs_closed` key is ALWAYS present, even `"0"`). Doc comment pins "single source of truth for the CompanyDeleted metadata shape; key set is closed to `{jobs_closed}` per spec audit_events `Metadata Shape (PII-Free)` requirement; stable shape enables machine-parseable forensics".
- Update the package doc (the `// Package entities holds the audit_events domain model ...` comment) to reflect the 4-event vocabulary (D11).

- Verify: 1.1 tests pass; `cd backend && go test ./internal/features/audit_events/...` green; the emit-literal AST walk continues to pass because the new literals stay in this package. Commit **A** lands. Rollback: revert the single file pair.

### 1.3 REFACTOR (optional, tracked) — Confirm vocabulary hygiene

- [ ] 1.3 REFACTOR — Confirm the AST guard continues to enforce "no emit call site outside this package" and no future-only constants slipped in. <!-- sdd-owner: implementation -->

Confirm `TestEventVocabularyIsClosed` passes with the 6-value closed set (4 events + 2 entity types); confirm the emit-literal walk does NOT find `CompanyUpdated` / `CompanyDeleted` / `company` literals outside `audit_events/domain/entities`; confirm `gofmt -l backend/internal/features/audit_events/` is empty.

- Verify: `cd backend && go test ./internal/features/audit_events/...` still green; `cd backend && go vet ./internal/features/audit_events/...` clean.

---

## Phase 2 — WU2 (Commit B): atomic seam — port extension + use cases + adapter Append + handler pass-through + 12-stub repair + main.go hoist

Files: `backend/internal/features/companies/application/usecases/companyService.go` (MOD), `updateCompany.go` (MOD), `deleteCompany.go` (MOD), `eventIntent.go` (NEW), `eventIntent_test.go` (NEW), `internal/features/companies/domain/repositories/companyRepository.go` (MOD), `internal/features/companies/infrastructure/postgres/companyRepository.go` (MOD), `internal/features/companies/infrastructure/http/handler.go` (MOD), `backend/cmd/api/main.go` (MOD), plus the 8 atomic stub-repair files (D8 inventory). Commit **B** — **atomic**: the tree does not fully compile between any sub-step (the port signature change breaks every implementer + the `var _` assertion; the constructor change breaks every call site; both are required for `go build ./...` to turn green). This mirrors `companies-write` WU3 and `audit_events` WU3.

### 2.1 RED — Domain sentinel + use-case guard tests (D6)

- [ ] 2.1 RED — Author `TestErrMissingActorIdentity_IsDistinct` in `companyService_test.go` (NEW, or extend existing `companyService_test.go` if present); author `TestUpdateCompany_MissingUserIDFailsClosed` in `updateCompany_test.go` and `TestSoftDeleteCompany_MissingUserIDFailsClosed` in `deleteCompany_test.go`. Confirm all three fail for the intended reason. <!-- sdd-owner: implementation -->

**Sentinel test** (`companies/application/usecases/companyService_test.go`, NEW if absent): `TestErrMissingActorIdentity_IsDistinct` asserts the sentinel exists, is non-nil, has the expected message `"missing actor identity"`, and is distinct from `entities.ErrCompanyNotFound` and `entities.ErrConcurrencyConflict` (no sentinels are reused or aliased). RED: `usecases.ErrMissingActorIdentity` undefined.

**Use-case tests** (`updateCompany_test.go` MOD, `deleteCompany_test.go` MOD):
- `TestUpdateCompany_MissingUserIDFailsClosed` (mirrors `applications/transitionApplication_test.go::TestTransitionApplication_MissingUserIDFailsClosed`): call `service.UpdateCompany(ctx, companyID, uuid.Nil, in, ifUnmodifiedSince)` → return is `(nil, ErrMissingActorIdentity)`; `repo.UpdateCompany` is NEVER called (stub `updateCalled == false`).
- `TestSoftDeleteCompany_MissingUserIDFailsClosed`: call `service.SoftDeleteCompany(ctx, companyID, uuid.Nil, ifUnmodifiedSince)` → return is `ErrMissingActorIdentity`; `repo.SoftDeleteCompany` is NEVER called.
- Existing tests in both files MUST pass a real non-nil `userID` (since the new param is required) and stub `UpdateCompany` / `SoftDeleteCompany` signatures MUST gain the `event auditentities.AuditEvent` value param (D3 — the port signature change is part of the RED's compile break; the stub upgrade is what resolves it inside this commit).

- Verify: `cd backend && go test ./internal/features/companies/application/usecases/...` → **RED** (compile: `ErrMissingActorIdentity` undefined; `UpdateCompany` / `SoftDeleteCompany` signatures don't accept `userID` or `event`). Rollback: revert the three test hunks.

### 2.2 RED — `eventIntent_test.go` for the closed-vocabulary pin (D5/D7/D8)

- [ ] 2.2 RED — Author `eventIntent_test.go` with four tests pinning the event structure, the empty PATCH metadata, the nil-at-build DELETE metadata, the `CompanyDeletedMetadata` always-present key, and the closed vocabulary for company events. <!-- sdd-owner: implementation -->

`backend/internal/features/companies/application/usecases/eventIntent_test.go` (NEW):
- `TestNewCompanyUpdatedEvent_Shape` — given `(eventID, companyID, userID)` UUIDs, the returned event has `ID == eventID`, `ActorType == auditentities.ActorTypeUser`, `ActorID != nil && *ActorID == userID`, `EventType == auditentities.EventCompanyUpdated`, `EntityType == auditentities.EntityCompany`, `EntityID == companyID`, `Metadata` is non-nil AND empty (`len(Metadata) == 0` — pinning the "empty JSON object" invariant for the PATCH event).
- `TestNewCompanyDeletedEvent_StructureAtBuildTime` — given `(eventID, companyID, userID)`, the returned event has `ID == eventID`, `ActorType == ActorTypeUser`, `ActorID == &userID`, `EventType == auditentities.EventCompanyDeleted`, `EntityType == auditentities.EntityCompany`, `EntityID == companyID`, **`Metadata == nil`** (the adapter finalizes the metadata; at build time the use case has not observed `closedCount`).
- `TestCompanyDeletedMetadata_AlwaysPresentKey` — `auditentities.CompanyDeletedMetadata(0) == {"jobs_closed": "0"}`; `CompanyDeletedMetadata(1) == {"jobs_closed": "1"}`; `CompanyDeletedMetadata(2) == {"jobs_closed": "2"}`; assert non-nil and exactly one key (mirrors the audit_events domain test from 1.1 — both layers pin the same shape).
- `TestEventIntent_ClosedVocabulary_CompanyEvents` — assert the closed key set for `CompanyUpdated` events is `{}` (no keys) and for `CompanyDeleted` events is `{jobs_closed}` only — no `description`, no `name`, no `website`, no `cover_letter`, no candidate PII (mirror of `applications/eventIntent_test.go::TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID`). Iterates a forbidden-key table and asserts none are present.

- Verify: `cd backend && go test ./internal/features/companies/application/usecases/ -run 'TestNewCompanyUpdatedEvent|TestNewCompanyDeletedEvent|TestCompanyDeletedMetadata|TestEventIntent_ClosedVocabulary'` → **RED** (compile: `eventIntent.go` missing). Rollback: revert the test file.

### 2.3 GREEN — Sentinel + use-case guards + `eventIntent.go` (D2/D5/D6/D7)

- [ ] 2.3 GREEN — Add `ErrMissingActorIdentity` sentinel; create `eventIntent.go`; extend `UpdateCompany` and `SoftDeleteCompany` signatures with `userID`; add the FIRST-step guard; build + pass the event to the repo. <!-- sdd-owner: implementation -->

**Sentinel** (`companies/application/usecases/companyService.go`, MOD):
- Add `var ErrMissingActorIdentity = errors.New("missing actor identity")` with the doc comment from design D6.

**Event-intent builders** (`companies/application/usecases/eventIntent.go`, NEW — mirror of `applications/application/usecases/eventIntent.go`):
- Package doc explaining the closed-vocabulary invariant and the structural enforcement (the signatures cannot express PII).
- `newCompanyUpdatedEvent(eventID, companyID, userID uuid.UUID) auditentities.AuditEvent` — returns the event with `Metadata: map[string]string{}` (non-nil empty; PATCH event).
- `newCompanyDeletedEvent(eventID, companyID, userID uuid.UUID) auditentities.AuditEvent` — returns the event with `Metadata: nil` (finalized by the adapter). **NOTE**: D5's signature is `newCompanyDeletedEvent(eventID, companyID, userID)` (no `jobsClosed` arg) — the use case has not observed `closedCount` at build time, so the proposal §6.2's `newCompanyDeletedEvent(eventID, companyID, userID, jobsClosed int)` is **unreachable** and is replaced per D1.

**Use cases** (`updateCompany.go` MOD, `deleteCompany.go` MOD):
- Update signatures: `UpdateCompany(ctx, companyID, userID uuid.UUID, in dtos.UpdateCompanyDto, ifUnmodifiedSince time.Time)` and `SoftDeleteCompany(ctx, companyID, userID uuid.UUID, ifUnmodifiedSince time.Time) error` — `userID` immediately after `companyID` (D2).
- Add the FIRST-step guard at the very top of each use case body (before `GetCompanyForUpdate`, before the CAS compare, before anything else): `if userID == uuid.Nil { return nil/ErrMissingActorIdentity }`.
- After the CAS compare (success path) but BEFORE `repo.UpdateCompany` / `repo.SoftDeleteCompany`: `eventID, _ := uuid.NewV7()` + `event := newCompanyUpdatedEvent(eventID, companyID, userID)` (or `newCompanyDeletedEvent`); pass `event` as the **last arg** to `repo.UpdateCompany` / `repo.SoftDeleteCompany` (D3).
- Existing use-case semantics (the 8-step PATCH flow / 4-step DELETE flow) remain unchanged for the non-missing-userID path.

- Verify: 2.1 use-case tests pass (the missing-userID guard tests); `eventIntent_test.go` (2.2) passes; `cd backend && go test ./internal/features/companies/application/usecases/...` — but **only the application-usecase package is green at this sub-step**; the port signature change still breaks the rest of the tree (resolved in 2.4). Commit **B** does not land here — production code in 2.5–2.8 lands in the same atomic commit. The 2.3 GREEN is the "use case is internally consistent" check; the **atomic commit B verification** is the full-suite green at 2.8. Rollback boundary: revert 2.1 + 2.2 + 2.3 + 2.4 + 2.5 + 2.6 + 2.7 + 2.8 together.

### 2.4 RED (compile) — Port signature extension (D3)

- [ ] 2.4 RED — Extend `companyRepository.go` port with the `event` value param on `UpdateCompany` and `SoftDeleteCompany`; confirm `go build ./...` fails closed. <!-- sdd-owner: implementation -->

In `backend/internal/features/companies/domain/repositories/companyRepository.go` (MOD):
- Add import `auditentities "github.com/aldrich_coder45/peopleflow-vacantes/internal/features/audit_events/domain/entities"` (domain→domain, sibling import to what `applications/domain/repositories/applicationRepository.go` does).
- Update the `UpdateCompany` method signature: `UpdateCompany(ctx context.Context, companyID uuid.UUID, patch UpdateCompanyPatch, casUpdatedAt time.Time, event auditentities.AuditEvent) error` — `event` is **last position**, value-not-pointer (D3).
- Update the `SoftDeleteCompany` method signature identically: `SoftDeleteCompany(ctx context.Context, companyID uuid.UUID, casUpdatedAt time.Time, event auditentities.AuditEvent) error`.
- The `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)` assertion in the adapter will fail compile (the postgres adapter does not yet accept `event`). The 12 stub types across 8 test files will fail compile (they do not yet accept `event`).

- Verify: `cd backend && go build ./...` → **RED (compile)** — the strict-TDD RED for the atomic seam. This is the design's "compile-break RED" accepted by the `audit_events` / `companies-write` WU3 pattern. Rollback: revert the file; the tree compiles again (but the spec is wrong).

### 2.5 GREEN — Stub repair — 12 stub types across 8 test files (D8 atomic)

- [ ] 2.5 GREEN — Update all 12 stub types to accept the new `event` param on `UpdateCompany` and `SoftDeleteCompany`; default behavior preserves the existing tests (returns `nil` / `ErrCompanyNotFound`). <!-- sdd-owner: implementation -->

The 12 stub types, in 8 test files, all gain the `event auditentities.AuditEvent` value param on `UpdateCompany` / `SoftDeleteCompany` and (in the application/usecase stubs) capture it for the handler-level assertions:

| # | File | Stub type | Update |
|---|------|-----------|--------|
| a | `application/usecases/updateCompany_test.go` | `stubUpdateRepo` | add `event` param + `lastUpdateEvent` capture field |
| b | `application/usecases/updateCompany_test.go` | `sequentialUpdateRepo` (if present) | same |
| c | `application/usecases/updateCompany_test.go` | `sequentialSuccessRepo` (if present) | same |
| d | `application/usecases/deleteCompany_test.go` | `stubDeleteRepo` | add `event` param + `lastSoftDeleteEvent` capture field |
| e | `application/usecases/deleteCompany_test.go` | `countingGetRepo` (if present) | same |
| f | `application/usecases/companyMemberService_test.go` | `stubMemberCompanyRepository` | add `event` param |
| g | `application/usecases/createCompany_test.go` | `stubCompanyRepository` | add `event` param |
| h | `infrastructure/http/handler_test.go` | `stubRepo` | add `event` param |
| i | `infrastructure/http/updateCompanyHandler_test.go` | `stubUpdateServiceRepo` | add `event` param + `updateEvent` capture field |
| j | `infrastructure/http/updateCompanyHandler_test.go` | `sequentialUpdateRepo` (if present) | same |
| k | `infrastructure/http/deleteCompanyHandler_test.go` | `stubDeleteServiceRepo` | add `event` param + `softDeleteEvent` capture field |
| l | `infrastructure/http/memberHandler_test.go` | `stubMemberCompanyRepositoryForHandler` | add `event` param |

The handler-side stubs (`i`, `k`) gain capture fields that the new handler tests in 2.7 will assert against; the application/usecase stubs (`a`, `d`) gain capture fields that the use-case event-passing tests assert against.

Default behavior for all stubs: `UpdateCompany` returns `nil` and `SoftDeleteCompany` returns `nil` (matching the pre-WU2 default semantics so legacy tests stay green until the new assertions are added).

- Verify: `cd backend && go build ./...` still **RED** because the postgres adapter `*CompanyRepository` does not yet implement the new signatures — this is the next sub-step.

### 2.6 GREEN — Adapter: `audit` field + Append in `UpdateCompany` + Append in `SoftDeleteCompany` with metadata finalization (D4/D9)

- [ ] 2.6 GREEN — Extend the postgres adapter: `audit` field + constructor + Append calls + `CompanyDeletedMetadata` finalization; commit all 8 constructor-site updates (1 main + 7 integration sites). <!-- sdd-owner: implementation -->

**Adapter** (`backend/internal/features/companies/infrastructure/postgres/companyRepository.go`, MOD):
- Import `auditrepositories "github.com/aldrich_coder45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"` and `auditentities "github.com/aldrich_coder45/peopleflow-vacantes/internal/features/audit_events/domain/entities"`.
- Update the struct: `type CompanyRepository struct { pool *pgxpool.Pool; audit auditrepositories.AuditEventRepository }`.
- Update the constructor: `func NewCompanyRepository(pool *pgxpool.Pool, audit auditrepositories.AuditEventRepository) *CompanyRepository { return &CompanyRepository{pool: pool, audit: audit} }` (pool first, audit second — mirror of `NewApplicationRepository(pool, audit)`).
- Update `UpdateCompany` body per D9:
  ```
  pool.Begin → defer tx.Rollback
    → db.New(tx).UpdateCompany
    → mapUpdateCompanyError(err)
    → if updated == 0 → return ErrCompanyNotFound (NO append)
    → r.audit.Append(ctx, tx, event)  // NEW, after updated==1, before Commit
    → tx.Commit
  ```
  Wrap any `Append` error: `fmt.Errorf("co-write audit: %w", err)`. Return BEFORE `tx.Commit` so the deferred `tx.Rollback` aborts the domain write (fail-closed co-write).
- Update `SoftDeleteCompany` body per D9:
  ```
  pool.Begin → defer tx.Rollback
    → db.New(tx).SoftDeleteCompany
    → mapSoftDeleteCompanyError(err)
    → if deleted == 0 → return ErrCompanyNotFound (NO append)
    → closedCount, err := db.New(tx).CloseCompanyJobs      // (the existing inline close; the rowcount is no longer discarded)
    → mapSoftDeleteCompanyError(err)
    → event.Metadata = auditentities.CompanyDeletedMetadata(int(closedCount))  // NEW
    → r.audit.Append(ctx, tx, event)  // NEW, before Commit
    → tx.Commit
  ```
  This replaces the existing `_ = closedCount` (telemetry-only) with the actual finalization per D1. Same `Append` error wrap as `UpdateCompany`.
- The `var _ repositories.CompanyRepository = (*CompanyRepository)(nil)` assertion now compiles.

**8 constructor call-site updates** (atomic with the constructor change):
- `cmd/api/main.go:99` — `companyRepo := postgres.NewCompanyRepository(pool, auditRepo)` + **hoist `auditRepo := auditpostgres.NewAuditEventRepository()` from line 139 to above line 99** (the existing applications wiring block continues to reference the same variable). The 7 integration sites use a package-local helper (next sub-step).
- The 7 integration sites use a new package-local helper in `companyRepository_write_integration_test.go` (or a small `testhelpers_test.go` file):
  ```go
  func newTestCompanyRepository(pool *pgxpool.Pool) *CompanyRepository {
      return NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository())
  }
  ```
  Replace the existing `NewCompanyRepository(pool)` calls (lines 268, 389, 498, 697, 738, 815, 907) with `newTestCompanyRepository(pool)`. The import `auditpostgres "…/features/audit_events/infrastructure/postgres"` is added once at the top of the test file. The 5.7 SQL assertions that check `audit_events` row counts stay unchanged at this sub-step (WU3 flips them).

- Verify: `cd backend && go build ./...` → **GREEN** (compile restored end-to-end). The atomic seam is consistent. Rollback: revert commit B atomically.

### 2.7 RED + GREEN — Handler pass-through + classifier branch (D6)

- [ ] 2.7 RED + GREEN — Pass `cc.UserID` into both use cases; add the `ErrMissingActorIdentity → 500` branch to both classifiers; add the handler-level tests asserting the captured event shape. <!-- sdd-owner: implementation -->

**Handler** (`backend/internal/features/companies/infrastructure/http/handler.go`, MOD):
- In `updateCompany(w, r)`: where the handler currently calls `h.service.UpdateCompany(r.Context(), cc.CompanyID, in, ifUnmodifiedSince)`, change to `h.service.UpdateCompany(r.Context(), cc.CompanyID, cc.UserID, in, ifUnmodifiedSince)` (mirror of `applications/applicationHandler.go` line 253).
- In `deleteCompany(w, r)`: change `h.service.SoftDeleteCompany(r.Context(), cc.CompanyID, ifUnmodifiedSince)` → `h.service.SoftDeleteCompany(r.Context(), cc.CompanyID, cc.UserID, ifUnmodifiedSince)`.
- In `classifyUpdateCompanyError` and `classifyDeleteCompanyError`: add the branch `case errors.Is(err, usecases.ErrMissingActorIdentity): return http.StatusInternalServerError, "internal server error"` BEFORE the `default` branch (no existence leak — generic 500 message; mirror `applications/applicationHandler.go::classifyApplicationError` lines 324–327).
- The handler MUST NOT build the `AuditEvent` value — that is the use case's responsibility (the spec scenario "handler does not build the event; use case is the single source of truth").

**Handler-level tests** (`updateCompanyHandler_test.go` MOD, `deleteCompanyHandler_test.go` MOD):
- `TestUpdateCompanyHandler_MissingUserIDReturns500` — call the handler with `CompanyContext{UserID: uuid.Nil, CompanyID: <real>, Role: owner}` → `500 internal server error`; assert the stub `stubUpdateServiceRepo.updateEvent` was NEVER set (the handler must not even build the event for a missing-actor request — the use-case guard fires first).
- `TestUpdateCompanyHandler_PassesCompanyUpdatedEvent` — call the handler with a real `UserID`; stub returns `(view, nil)`; assert the captured `updateEvent` has `EventType == auditentities.EventCompanyUpdated`, `EntityType == auditentities.EntityCompany`, `EntityID == cc.CompanyID`, `ActorType == auditentities.ActorTypeUser`, `*ActorID == cc.UserID`, and **`Metadata` is non-nil and empty (`len(Metadata) == 0`)**.
- `TestDeleteCompanyHandler_MissingUserIDReturns500` — same shape for DELETE.
- `TestDeleteCompanyHandler_PassesCompanyDeletedEvent` — call the handler with a real `UserID`; stub returns `nil`; assert the captured `softDeleteEvent` has `EventType == auditentities.EventCompanyDeleted`, `EntityType == auditentities.EntityCompany`, `EntityID == cc.CompanyID`, `ActorType == auditentities.ActorTypeUser`, `*ActorID == cc.UserID`, and **`Metadata == nil`** (the adapter finalizes the metadata — the handler/use-case pair passes it through as-built).
- The 401/403 short-circuit tests (`TestUpdateCompanyHandler_MissingContextReturns500`, `TestUpdateCompanyHandler_InvalidJSONReturns400`, etc.) stay green unchanged.

- Verify: `cd backend && go test ./internal/features/companies/...` green for the application + infrastructure layers; existing integration tests (`companyRepository_write_integration_test.go`) still pass for non-audit assertions (the audit-count assertions are flipped in WU3). Rollback: revert the handler + handler-test hunks.

### 2.8 Verification — full atomic commit B gate

- [ ] 2.8 — Run the full verification set for the atomic seam. <!-- sdd-owner: implementation -->

- Verify (atomic commit gate):
  - `cd backend && go build ./...` clean.
  - `cd backend && go vet ./...` clean.
  - `cd backend && go test ./...` green (unit suite; integration suite skipped because `DATABASE_URL` unset under plain `go test`).
  - `cd backend && go tool sqlc generate` — **idempotent** (no diff). The change adds no new query, so this is a no-op confirmation.
  - `gofmt -l backend/` empty.
  - Spot-check the 8 stub types enumerated in 2.5 by name (grep `stub.*UpdateCompany\|stub.*SoftDeleteCompany` in the affected files); confirm every signature has the `event auditentities.AuditEvent` last-position value param.
  - Spot-check the 8 constructor sites (`grep -n 'NewCompanyRepository(' backend/`); confirm every site has both `pool` and `audit` arguments.
  - Spot-check the classifier branches (`grep -n 'ErrMissingActorIdentity' backend/internal/features/companies/infrastructure/http/handler.go`); confirm both classifiers have the branch.
  - Confirm the spec reconciliation in `openspec/changes/companies-audit/specs/` matches design §3 (closed-set expansion to 4, metadata shape adds 2 rows, closed-key vocab adds `jobs_closed`, REMOVED "No Audit Events for Companies" + ADDED "Audit Events for Companies").
- Commit **B** lands. Rollback: revert commit B atomically — port extension + use cases + adapter + handler + main.go + 12 stub repairs + 8 constructor sites + the test files in one revert. The tree returns to the pre-change `NewCompanyRepository(pool)` single-arg state.

---

## Phase 3 — WU3 (Commit C): integration test flip — invariant (e) + PATCH +1 test + cleanup widening + owner-user seed

Files: `backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go` (MOD). Commit **C**.
Verification gate: `cd backend && make test-integration` (sources `.env`; Postgres up + migrated) green; production code unchanged.

### 3.1 RED/GREEN — Flip invariant (e) + add PATCH +1 test (D8)

- [ ] 3.1 RED/GREEN — Flip the audit-count assertion in `TestSoftDeleteCompany_TombstonesAndClosesJobs` from "unchanged" to "+1 CompanyDeleted"; assert the new row carries the expected `event_type`, `entity_type`, `actor_type`, `actor_id`, and `metadata->>'jobs_closed'`; widen the `cleanupCompanies` predicate to `entity_type IN ('companies', 'company')`. <!-- sdd-owner: implementation -->

In `backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go` (MOD):

- **Cleanup widening** (line 222–228): `DELETE FROM audit_events WHERE entity_type = 'companies' AND entity_id = ANY($1::uuid[])` → `DELETE FROM audit_events WHERE entity_type IN ('companies', 'company') AND entity_id = ANY($1::uuid[])`. Defensive — the test now produces rows under both literals in different phases (the seed row is plural `'companies'`, the new production row is singular `'company'`).
- **Fixture seed update**: add a deterministic `writeOwnerUserID = uuid.MustParse("<a-real-users-id>")` (or use `uuid.NewV7()` seeded once per `TestMain`) and a `company_members` row linking that user to `writeCoA` with `role='owner'`. The seed INSERT for `audit_events` (line 140–142) stays as-is (plural `entity_type='companies'`, type `'seed'`); it's the historical baseline. The new production row asserted in 3.1 (b) uses the singular `'company'` literal.
- **Invariant (e) flip** (line 606–615 in the existing `TestSoftDeleteCompany_TombstonesAndClosesJobs`): change from `if postAuditCount != preAuditCount` ("unchanged") to `if postAuditCount != preAuditCount+1`. Add the new assertions:
  - `SELECT event_type, entity_type, actor_type, actor_id, metadata FROM audit_events WHERE entity_type='company' AND entity_id=$1 AND event_type='CompanyDeleted'` returns exactly one row.
  - `event_type == "CompanyDeleted"`, `entity_type == "company"`, `actor_type == "user"`, `actor_id == writeOwnerUserID`, `metadata->>'jobs_closed' == "2"` (the draft + published jobs the inline close closes; the test seeds 1 draft + 1 published + 1 closed + 1 soft-deleted per the existing fixture, so the rowcount is 2).
- **New PATCH +1 test** (`TestUpdateCompany_ProducesCompanyUpdatedAuditRow`, NEW): the inverse of the DELETE test. Patch one field (e.g. `website`) with a matching CAS; assert the company row is updated AND exactly one new `audit_events` row appears with `event_type='CompanyUpdated'`, `entity_type='company'`, `actor_id=<writeOwnerUserID>`, `metadata='{}'::jsonb` (the empty JSON object — postgres stores `pgtype` → `Metadata: map[string]string{}` → JSONB `{}`).
- **Rollback-on-audit-failure** — the existing `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` documents a deliberate coverage gap; the audit-append-failure path is covered by the same `defer tx.Rollback` idiom + the parent-owned review (no new live-DB test required, consistent with `audit_events` WU3 — fail-closed co-write is structural in the adapter).

- Verify: `cd backend && make test-integration` (sources `.env`; Postgres up + migrated to current head) green. Existing 4 invariants (a–d) of `TestSoftDeleteCompany_TombstonesAndClosesJobs` stay asserted; invariant (e) flips to the new +1 + shape assertion; the new `TestUpdateCompany_ProducesCompanyUpdatedAuditRow` test passes; `go test ./...` (unit) green; `go vet ./...` clean. Commit **C** lands. Rollback: revert the test file.

### 3.2 REFACTOR (optional, tracked) — Cleanup predicate + seed discipline

- [ ] 3.2 REFACTOR — Confirm the cleanup predicate is defensive against both literal variants and the owner-user seed is deterministic across re-runs. <!-- sdd-owner: implementation -->

Confirm `cleanupCompanies` widens to `entity_type IN ('companies', 'company')` and that the seed `writeOwnerUserID` is generated deterministically (e.g. via a `sync.Once`-guarded UUID v7 or an `ON CONFLICT DO NOTHING` insert pattern) so the test is idempotent across re-runs.

- Verify: `cd backend && make test-integration` still green; `gofmt -l backend/internal/features/companies/infrastructure/postgres/` empty.

---

## Phase 4 — WU4 (Commit D): OpenSpec archive reconciliation (D10)

Files: `openspec/specs/audit_events/spec.md` (MOD), `openspec/specs/companies/spec.md` (MOD), `openspec/changes/companies-audit/` → `openspec/changes/archive/YYYY-MM-DD-companies-audit/` (move). Commit **D**.
Verification gate: the two canonical specs and the change folder reconcile; no production code touched; `openspec/changes/archive/` is append-only (per `openspec/config.yaml::rules.archive`).

### 4.1 GREEN — Paste both spec deltas (D10)

- [ ] 4.1 GREEN — Paste the `audit_events` delta into `openspec/specs/audit_events/spec.md` (Purpose paragraph + closed-set expansion 2→4 + metadata shape adds 2 rows + closed-key vocabulary adds `jobs_closed`); paste the `companies` delta into `openspec/specs/companies/spec.md` (REMOVED "No Audit Events for Companies" + ADDED "Audit Events for Companies" + Purpose paragraph update + Out-of-scope bullet removal). <!-- sdd-owner: implementation -->

In `openspec/specs/audit_events/spec.md` (MOD):
- Update the Purpose paragraph: replace the "two event types are emitted in this cycle — `ApplicationSubmitted` and `ApplicationTransitioned` — both from the `applications` write paths; the jobs, companies, and identity write paths emit nothing" with the 4-event equivalent ("Four event types are emitted in this cycle: `ApplicationSubmitted` and `ApplicationTransitioned` from the `applications` write paths; `CompanyUpdated` and `CompanyDeleted` from the `companies` owner-only write paths. Jobs and identity write paths emit nothing.").
- Update `Requirement: Event Type Vocabulary (Closed Set for This Cycle)` — closed set expands from 2 to 4 constants; the corresponding scenarios update the count from 2 to 4 and add the two new literals.
- Update `Requirement: Metadata Shape (PII-Free)` — add the company rows to the per-event table (`CompanyUpdated` → `{}`; `CompanyDeleted` → `{"jobs_closed": "<n>"}`); expand the closed-key vocabulary to include `jobs_closed`.

In `openspec/specs/companies/spec.md` (MOD):
- REMOVE `Requirement: No Audit Events for Companies (Deferred)` (the deferral closes in this change).
- ADD `Requirement: Audit Events for Companies` (per `openspec/changes/companies-audit/specs/companies/spec.md` ADDED section).
- Update the Purpose paragraph to state the new emission fact ("A successful `PATCH /me/company` adds exactly one `CompanyUpdated` row to `audit_events`; a successful `DELETE /me/company` adds exactly one `CompanyDeleted` row.").
- REMOVE the bullet "`audit_events` integration for `CompanyUpdated` / `CompanyDeleted` / `CompanySoftDeleted` (deferred to a follow-up cycle — ...)" from the Out-of-scope section.

- Verify: the two canonical specs are no longer self-contradictory; `grep -rn "No Audit Events for Companies" openspec/specs/` returns zero (the REMOVED requirement is fully excised); `grep -rn "CompanyUpdated\|CompanyDeleted" openspec/specs/` returns hits in both specs (the ADDED requirement + the audit_events MODIFIED metadata row).

### 4.2 GREEN — Move the change folder to `archive/` (per `rules.archive`)

- [ ] 4.2 GREEN — Move `openspec/changes/companies-audit/` to `openspec/changes/archive/YYYY-MM-DD-companies-audit/`; confirm `openspec/changes/companies-audit/` no longer exists at the changes root. <!-- sdd-owner: implementation -->

- `mv openspec/changes/companies-audit/ openspec/changes/archive/YYYY-MM-DD-companies-audit/` (date stamp per `rules.archive` convention; use today's date at apply time).
- Verify: `ls openspec/changes/` shows the remaining `companies-audit/` is gone; `ls openspec/changes/archive/` shows the new `YYYY-MM-DD-companies-audit/` folder; the folder contents (`proposal.md`, `design.md`, `specs/`, `tasks.md`) are preserved verbatim.
- Commit **D** lands. Rollback: move the folder back. Per `rules.archive` "Preserve the YYYY-MM-DD-{change-name}/ folder as an immutable audit trail" — once archived, the folder is NEVER deleted or rewritten (the revert reverts the spec deltas in `openspec/specs/`, not the archive).

---

## Phase 5 — Full-suite gate (apply-owned verification)

### 5.1 — Full-suite verification for the whole change

- [ ] 5.1 — Run the complete verification set. <!-- sdd-owner: implementation -->

- Verify:
  - `cd backend && go test ./...` (unit — strict-TDD green; every RED test pre-dates its GREEN code).
  - `cd backend && go vet ./...` clean.
  - `gofmt -l backend/` empty.
  - `cd backend && go build ./...` clean.
  - `cd backend && go tool sqlc generate` idempotent (second run → empty `git diff`). The change adds no new query, so this is a no-op confirmation that the generated files are unchanged.
  - `cd backend && make test-integration` (Postgres up + migrated to current head; the migration files do NOT change for this slice — `00011_create_audit_events.sql` already exists; verify with `ls backend/db/migrations/`): the 5.1 PATCH +1 test + the invariant-(e)-flipped DELETE test pass.
  - Spec set reconciled: `openspec/specs/audit_events/spec.md` + `openspec/specs/companies/spec.md` no longer self-contradictory; `openspec/changes/archive/YYYY-MM-DD-companies-audit/` is the immutable audit trail.
  - Locked scope held: ~22 authored files (production + tests + OpenSpec); no other feature's wiring moved; `applications` adapter / handler / wiring untouched; `cmd/api/main.go` touched only at line 99 + the hoist at line 139.
  - Per-file authored estimate confirmed within forecast (880–1,280 lines; the actual `git diff --stat` post-merge should land in that range — anything materially higher means a stub site was missed or an extra file was touched, and should be diagnosed).

---

## Post-apply (parent-owned)

- [ ] Start or reuse bounded review of the merged change. Trace tasks to commits A–D; confirm `[x]` is marked only on landed commits; D1–D11 honored (D1 `jobs_closed` finalized by adapter via `auditentities.CompanyDeletedMetadata`; D2 `userID` immediately after `companyID`; D3 `event` value param last position; D4 `NewCompanyRepository(pool, audit)` + atomic 8-site + 12-stub repair in one commit; D5 builders in `eventIntent.go` + `CompanyDeletedMetadata` in the audit_events domain; D6 `ErrMissingActorIdentity` sentinel + FIRST-step guard + classifier → 500; D7 `AuditEvent` shape + eventID via `uuid.NewV7()` + PATCH metadata `{}` non-nil + DELETE metadata `nil` at build; D8 unit (eventIntent + use-case mock port) + integration (real co-write) + 12-stub atomic repair; D9 adapter Append strictly between `updated==1`/`deleted==1` (+inline close) and `tx.Commit`, fail-closed; D10 both spec deltas in the same archive cycle; D11 only `EventCompanyUpdated` + `EventCompanyDeleted` constants added); confirm the **size-exception record** if single-pr was accepted (mirroring the `companies-write` precedent) OR the **chain record** if the user pivoted to chained (mirroring `audit_events` PR-3 size-exception + the WU1/WU3/WU4 additive commits). <!-- sdd-owner: parent -->
- [ ] Lifecycle gate: archive decision per `openspec/config.yaml::rules.archive` (already executed by 4.2; confirm the change folder is immutable); do NOT rewrite `openspec/changes/archive/`. <!-- sdd-owner: parent -->

---

## Verification commands

- Unit: `cd backend && go test ./...`
- Integration: `cd backend && make test-integration` (sources `.env`; plain `go test` skips the integration build tag).
- Build/vet: `cd backend && go build ./... && go vet ./...`
- sqlc: `cd backend && make sqlc` (alias for `go tool sqlc generate`; idempotent — a second run yields empty `git diff` for this slice because no new query lands).
- Strict TDD gate: every checkbox's RED test must fail for the intended reason before the GREEN commit lands (compile-break REDs on missing types/methods/sentinels are accepted per the `audit_events` / `companies-write` WU3 precedents).

---

## Decision flow (orchestrator must execute before apply starts)

1. The preflight pinned `delivery_strategy: single-pr`. The forecast shows ~880–1,280 authored lines across the change (≈ 2.2–3.2× the 400-line budget).
2. Per work-unit-commits skill, this triggers "promote commits or groups of commits into chained PRs".
3. **However**, WU2 (the atomic seam) is intrinsically one commit — port signature change + constructor change + 12-stub repair + adapter Append bodies + use cases + handler + main.go hoist + integration fixture update. Splitting WU2 would leave `main` uncompilable between sub-PRs. So even a chained delivery still has a single ~750–1,100-line PR (WU2 + WU3 + WU4 together); only WU1 (~55 lines) is small enough to chain standalone.
4. The orchestrator MUST surface this to the user: either accept the `size:exception` for single-pr (precedent: `companies-write`), OR pivot to a chained delivery (precedent: `audit_events` 3-PR chain).
5. The apply agent does NOT decide this. The decision is `pending` until the user replies.

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception | stacked-to-main (pending user decision)
400-line budget risk: High
```

---

## Scenario → task matrix (spec audit_events MODIFIED + companies REMOVED/ADDED)

| Scenario | Task(s) |
|---|---|
| audit_events MOD `Event Type Vocabulary (Closed Set for This Cycle)` — exactly 4 constants | 1.1 (RED `want` map expand), 1.2 (GREEN constants) |
| audit_events MOD `Event Type Vocabulary` — closed set omits jobs and identity event types | 1.1 (RED AST guard), 1.2 (GREEN; emit-literal walk stays clean) |
| audit_events MOD `Event Type Vocabulary` — DB accepts novel `event_type` (no CHECK) | 1.2 (no schema change; verify with `00011_create_audit_events.sql` has no CHECK on `event_type`) |
| audit_events MOD `Metadata Shape (PII-Free)` — `ApplicationSubmitted` metadata shape | 1.1 + 2.2 (closed-vocab test pins existing shape) |
| audit_events MOD `Metadata Shape (PII-Free)` — `CompanyUpdated` metadata is `{}` | 2.2 (`TestNewCompanyUpdatedEvent_Shape` pins `Metadata` non-nil empty; `TestEventIntent_ClosedVocabulary_CompanyEvents` pins empty-key set) |
| audit_events MOD `Metadata Shape (PII-Free)` — `CompanyDeleted` metadata carries `jobs_closed` as string | 1.1 (`TestCompanyDeletedMetadata_AlwaysPresentKey`), 2.2 (same shape pinned at use-case layer), 3.1 (integration asserts `metadata->>'jobs_closed'='2'`) |
| audit_events MOD `Metadata Shape (PII-Free)` — `CompanyDeleted` always carries `jobs_closed`, even when zero | 1.1 (`CompanyDeletedMetadata(0) == {"jobs_closed": "0"}`), 2.2 (mirror), 3.1 (DELETE test with 0 non-closed jobs → `"0"`) |
| audit_events MOD `Metadata Shape (PII-Free)` — no `cover_letter` / candidate PII / company profile PII in any metadata | 2.2 (`TestEventIntent_ClosedVocabulary_CompanyEvents` forbids `description`/`name`/`website`/etc.); 1.1 + 2.2 mirror the applications test pattern |
| companies REMOVED `No Audit Events for Companies (Deferred)` | 4.1 (spec delta pasted; 2.3 + 2.6 + 2.7 implement the inverse contract) |
| companies ADDED `Audit Events for Companies` — PATCH success appends exactly one `CompanyUpdated` row | 2.3 (use case builds event), 2.6 (adapter appends inside tx), 2.7 (handler passes `cc.UserID`), 3.1 (`TestUpdateCompany_ProducesCompanyUpdatedAuditRow`) |
| companies ADDED `Audit Events for Companies` — DELETE success appends exactly one `CompanyDeleted` row with `jobs_closed` | 2.3 (use case builds event with `Metadata: nil`), 2.6 (adapter finalizes via `CompanyDeletedMetadata(int(closedCount))` + appends), 3.1 (invariant-(e) flip + `metadata->>'jobs_closed'='2'`) |
| companies ADDED `Audit Events for Companies` — DELETE with 0 non-closed jobs records `jobs_closed="0"` | 2.2 + 1.1 (`CompanyDeletedMetadata(0)`), 3.1 (add a DELETE test where the company has no draft/published jobs — assert `metadata->>'jobs_closed'='0'`) |
| companies ADDED `Audit Events for Companies` — `jobs_closed` is the stringified rowcount of `CloseCompanyJobs` | 2.6 (`strconv.Itoa(int(closedCount))` via `CompanyDeletedMetadata`), 3.1 (`metadata->>'jobs_closed'='2'` from the 2-row inline close) |
| companies ADDED `Audit Events for Companies` — 400 on VO/malformed-JSON appends 0 rows | 2.3 (use case guards BEFORE the repo call), 2.7 (handler returns 400 before the use case) |
| companies ADDED `Audit Events for Companies` — 404 appends 0 rows | 2.3 (`GetCompanyForUpdate` → `ErrCompanyNotFound` propagates), 2.7 (classifier → 404) |
| companies ADDED `Audit Events for Companies` — 409 CAS appends 0 rows | 2.3 (CAS compare BEFORE `repo.UpdateCompany`/`repo.SoftDeleteCompany`) |
| companies ADDED `Audit Events for Companies` — PATCH lost-race appends 0 rows | 2.6 (`updated == 0` returns `ErrCompanyNotFound` WITHOUT calling Append) |
| companies ADDED `Audit Events for Companies` — 401 / 403 short-circuits append 0 rows | 2.7 (handler is mounted behind `RequireAuth` + `RequireCompanyRole(owner)` per the existing `cmd/api/main.go` wiring; middleware short-circuits before the handler runs — no change needed) |
| companies ADDED `Audit Events for Companies` — `uuid.Nil` actor fails closed with 500 and appends 0 rows | 2.1 (`TestUpdateCompany_MissingUserIDFailsClosed` + `TestSoftDeleteCompany_MissingUserIDFailsClosed`), 2.3 (FIRST-step guard), 2.7 (classifier → 500) |
| companies ADDED `Audit Events for Companies` — audit INSERT failure rolls back the domain write | 2.6 (`defer tx.Rollback` + `fmt.Errorf("co-write audit: %w", err)` BEFORE `tx.Commit`); fail-closed co-write is structural — no live-DB test required, consistent with `audit_events` WU3 |
| companies ADDED `Audit Events for Companies` — handler does not build the event; use case is the single source of truth | 2.3 (`newCompanyUpdatedEvent` / `newCompanyDeletedEvent` in `eventIntent.go`; use case calls them), 2.7 (handler passes `cc.UserID` only; the spec scenario "handler does not build the event; use case is the single source of truth" is structurally enforced by the port signature — the handler has no way to build an event without violating the port) |
