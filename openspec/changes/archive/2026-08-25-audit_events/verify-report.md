```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:922f720b06f4d013212b5f940486f41dd73b8cc94991fde712680528e77f9ed4
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 30/30
test_command: cd backend && go test -count=1 ./...
test_exit_code: 0
test_output_hash: sha256:06c40d08e8903f82b9f86a761220ef69a9a0d1703e8e8e85fdb26df3698f282a
build_command: cd backend && go build ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report: `audit_events`

Verdict: **pass_with_warnings**

The change is applied (HEAD `d2a6560`), all three WUs committed, and every verification
command is green against a migrated DB (00011 applied, clean down/up round-trip confirmed).
All **10 requirements / 30 scenarios** have at least one real unit or integration test at the
correct layer; no scenario is wholly uncovered and no test is incorrect. Three non-blocking
coverage-gap warnings remain (see §4), none of which blocks archive/sync: (W1) the positive DB
acceptance of `actor_type='system'` is not directly asserted; (W2) terminal-transition
(`in_review → rejected` / `in_review → hired`) audit-row metadata is only implied by the
co-write commit, not explicitly asserted; (W3) `occurred_at` within-request-window is not
asserted. Strict TDD evidence is present and RED-first ordering holds.

---

## 1. Measured totals (my own counts)

| Artifact | Requirements | Scenarios |
|---|---|---|
| `specs/audit_events/spec.md` (NEW BC) | **6** | **17** |
| `specs/applications/spec.md` (delta) | **4 ADDED** | **13** |
| **Total** | **10** | **30** |

Authoritative: **10 requirements / 30 scenarios.** `tasks.md` implementation tasks 1.1–3.13
are all `[x]`; zero unchecked implementation-task markers (`^\s*- \[ \]` → none among Phases
1–3). Phase 4 WU4 verification tasks 4.1 and 4.3 are marked `[x]` by this run; 4.2 (scratch-branch
rollback drill) and the Parent post-apply items remain `[ ]` (see §7 — not implementation tasks).

---

## 2. Commands run (this verification) + results

All from `backend/`. Integration sourced `backend/.env` (`DATABASE_URL` present); DB container
`peopleflow-vacancies` healthy; `goose status` shows 00001–00011 applied.

| Command | Result |
|---|---|
| `go test ./...` | ✅ exit 0 — 35 packages `ok`, 0 FAIL |
| `go test -count=1 ./...` | ✅ exit 0 — 35 packages `ok`, 0 FAIL (hash below) |
| `go build ./...` | ✅ exit 0 (empty) |
| `go vet ./...` | ✅ exit 0 (empty) |
| `go test -tags=integration -p 1 ./... -count=1` | ✅ exit 0 — all packages `ok`, 0 FAIL (audit_events postgres + applications postgres both executed, not skipped) |
| `go test -tags=integration -p 1 -count=1 -v ./internal/features/audit_events/...` | ✅ all 7 migration tests + ActorType/Vocabulary/Port/Query/BuildParams PASS |
| `go test -tags=integration -p 1 -count=1 -v ./internal/features/applications/infrastructure/postgres/` | ✅ all co-write tests PASS (`TestCreate_CoWrites…`, `TestCreate_AuditFailureRollsBack…`, `TestCreate_NonWriteOutcomeNoEvent`, `TestTransition_CoWrites…`, `TestTransition_LostRaceNoEvent`, `TestTransition_AuditFailureRollsBackStatus`, terminal/race/cross-company transitions) |
| `go tool goose down` → `go tool goose up` | ✅ 00011 reverts cleanly (drops table + index) and re-applies; `goose status` = version 11 |
| `go tool sqlc generate` | ✅ exit 0, empty `git diff` on `internal/db` / `db/queries` (idempotent) |
| `gofmt -l internal/features/audit_events internal/features/applications internal/features/identity/domain/security internal/features/identity/infrastructure/http cmd/api internal/db` | ✅ empty (exit 0) |
| residue check (`SELECT count(*)` on `audit_events`, `applications`) | ✅ 0 / 0 rows after the suite |

Hashes (captured):

- `test_output_hash` = `sha256:06c40d08e8903f82b9f86a761220ef69a9a0d1703e8e8e85fdb26df3698f282a` (exit 0)
- `build_output_hash` = `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty, exit 0)
- `evidence_revision` = `sha256:922f720b06f4d013212b5f940486f41dd73b8cc94991fde712680528e77f9ed4`
  (sha256 over the concatenated `specs/audit_events/spec.md` + `specs/applications/spec.md` +
  `tasks.md` + `apply-progress.md`)

---

## 3. Requirement → scenario → test coverage matrix (30/30)

Legend: **U** = unit, **H** = handler/http, **I** = integration (live Postgres), **A** = adapter unit.

### NEW BC — `specs/audit_events/spec.md` (6 reqs / 17 scenarios)

#### R1 — Audit Events Schema Migration

- **S1 up creates named objects** → `TestMigration00011_UpCreatesNamedObjects` (I: table + named CHECK `audit_events_actor_type_check` + index `audit_events_entity_idx`). ✅
- **S2 down drops table and index** → `TestMigration00011_DownDropsTableAndIndex` (I: DROP + assert table/index gone, inline re-create). ✅
- **S3 required fields reject NULL** → `TestAuditEvents_RequiredFieldsRejectNull` (I, 4 subtests: `actor_type`/`event_type`/`entity_type`/`entity_id` NULL → SQLSTATE 23502). ✅
- **S4 metadata defaults to `{}`** → `TestAuditEvents_MetadataDefaultsEmptyObject` (I: insert omitting metadata → `IS NOT NULL` + `'{}'`). ✅
- **S5 event_type not CHECK-constrained** → `TestAuditEvents_EventTypeNotCheckConstrained` (I: inserts a novel string and asserts persistence). ✅
- **S6 structurally append-only** → `TestAuditEvents_StructurallyAppendOnly` (I: no `updated_at`, no `deleted_at`, no FK on `actor_id`, no FK referencing the table). ✅

#### R2 — Actor Type Vocabulary

- **S7 user/system are the only accepted values** → `TestActorTypeVocabulary` (U: `String()` + exactly-two-constant AST closure) + `TestAuditEvents_ActorTypeCheckRejectsOutOfVocabulary` (I: reject side). ⚠️ **W1** — positive DB acceptance of `'system'` is not directly asserted (only `'user'` is DB-pinned; `'system'` is pinned at VO + nil-actor adapter mapping). See §4.
- **S8 out-of-vocabulary actor_type rejected** → `TestAuditEvents_ActorTypeCheckRejectsOutOfVocabulary` (I: `'robot'` → SQLSTATE 23514). ✅

#### R3 — Event Type Vocabulary (closed set this cycle)

- **S9 exactly two constants exist** → `TestEventVocabularyIsClosed` (U: pins the two constants + AST walk of `backend/internal/features/**` proving no emit literal outside the entities package). ✅
- **S10 DB accepts a novel event_type** → `TestAuditEvents_EventTypeNotCheckConstrained` (I). ✅ (test uses `'FutureUnknownEvent'` vs spec's `'ApplicationWithdrawn'` — functionally equivalent; trivial naming drift.)

#### R4 — Append-Only Port

- **S11 port exposes append only** → `TestAuditEventRepository_PortExposesAppendOnly` (U, reflection: exactly one `Append(ctx, pgx.Tx, AuditEvent) error`, no Update/Delete/Read/List/Backfill). ✅
- **S12 query file contains only the INSERT** → `TestAuditEvents_QueryFileIsAppendOnly` (U: one sqlc annotation `InsertAuditEvent :exec`, zero SELECT/UPDATE/DELETE). ✅

#### R5 — Co-Write Atomicity Contract

- **S13 append runs inside caller's transaction** → `TestAuditEventRepository_PortExposesAppendOnly` (pins `pgx.Tx` param) + stateless adapter (`struct{}`, no pool, no Begin/Commit) + `TestCreate_CoWritesApplicationAndAuditEvent` (I, single tx commit). ✅
- **S14 append failure rolls back caller's write** → `TestCreate_AuditFailureRollsBackApplication` + `TestTransition_AuditFailureRollsBackStatus` (I: DROP `audit_events` → co-write errors → no application row / status unchanged, no event). ✅

#### R6 — Metadata Shape (PII-Free)

- **S15 Submitted metadata `{job_id, source}`** → `TestBuildSubmittedMetadata_WithSource` (U) + `TestApplyJob_PassesSubmittedEvent` (U) + `TestCreate_CoWritesApplicationAndAuditEvent` Part B (I). ✅
- **S16 Transitioned metadata `{job_id, from_status, to_status}`** → `TestBuildTransitionedMetadata_ExactKeys` (U) + `TestTransitionApplication_PassesTransitionedEvent` (U) + `TestTransition_CoWritesTransitionedEvent` (I). ✅
- **S17 cover_letter/candidate PII never enter metadata** → `TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID` (U: key set ⊆ `{job_id, source, from_status, to_status}`). ✅

### DELTA — `specs/applications/spec.md` (4 ADDED reqs / 13 scenarios)

#### R7 — ApplicationSubmitted Audit Emission

- **S18 successful apply appends exactly one event** → `TestApplyJob_PassesSubmittedEvent` (U) + `TestCreate_CoWritesApplicationAndAuditEvent` (I: exactly one row, event_type/entity_type/entity_id/actor_type/actor_id). ⚠️ **W3** — `occurred_at` within-request-window not asserted. See §4.
- **S19 metadata job_id + source when supplied** → `TestCreate_CoWritesApplicationAndAuditEvent` Part B (I) + `TestApplyJob_PassesSubmittedEvent` (U). ✅
- **S20 metadata job_id only when source NULL** → `TestCreate_CoWritesApplicationAndAuditEvent` Part A (I) + `TestBuildSubmittedMetadata_NilSource` (U). ✅
- **S21 cover_letter never enters metadata** → `TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID` (U). ✅

#### R8 — ApplicationTransitioned Audit Emission

- **S22 successful transition appends exactly one event** → `TestTransitionApplication_PassesTransitionedEvent` (U) + `TestTransition_CoWritesTransitionedEvent` (I). ✅
- **S23 every legal transition appends one (incl. terminal)** → `TestTransitionApplication_LegalMatrix` (U, all three edges) + `TestTransition_CoWritesTransitionedEvent` (I, `submitted → in_review` only) + `TestTransition_InReviewToRejected` / `TestTransition_InReviewToHired` (I, terminal edges commit). ⚠️ **W2** — terminal-transition audit rows/metadata are only implied (co-write commit), not explicitly asserted. See §4.
- **S24 lost-race 404 appends no event** → `TestTransition_LostRaceNoEvent` (I) + `TestTransition_LostRaceNotFound` (I). ✅

#### R9 — Transition Actor Identity (CompanyContext.UserID)

- **S25 recruiter's users.id recorded** → `TestRequireCompanyRole_InjectsUserID` (U) + `TestTransitionApplication_PassesTransitionedEvent` (U) + `TestTransition_CoWritesTransitionedEvent` (I, actor_id = recruiterID). ✅
- **S26 body actor_id ignored** → `TestTransitionApplication_BodyActorIDIgnored` (H: body `actor_id` never reaches event/wire). ✅
- **S27 missing CompanyContext.UserID fails closed** → `TestTransitionApplication_MissingUserIDFailsClosed` (U) + `TestTransitionApplication_MissingUserIDReturns500` (H). ✅

#### R10 — Fail-Closed Application + Audit Co-Write

- **S28 audit INSERT failure rolls back write** → `TestCreate_AuditFailureRollsBackApplication` + `TestTransition_AuditFailureRollsBackStatus` (I). ✅
- **S29 committed write implies exactly one event** → `TestCreate_CoWritesApplicationAndAuditEvent` + `TestTransition_CoWritesTransitionedEvent` (I, both assert exactly 1 row). ✅
- **S30 non-write outcomes append no event** → `TestCreate_NonWriteOutcomeNoEvent` (I: 404 gate-miss + 409 duplicate) + `TestTransition_LostRaceNoEvent` (I) + `TestTransition_CrossCompany404` (I, asserts 0 rows) + `TestCreate_InvalidSourceCheckViolation` / `TestCreate_InvalidCandidateReference` (I, 400 CHECK/FK, 0 rows) + use-case no-event paths (`TestApplyJob_CoverLetterEmpty/TooLong/UnknownSource` and `TestTransitionApplication_MissingStatus/UnknownStatus/IllegalMatrix` assert `Create`/`Transition` never called) + handler/middleware 401/403 (pre-use-case, no write). ✅

---

## 4. Defects / warnings (non-blocking) with exact fixes

No CRITICAL and no incorrect test. Three warnings:

1. **W1 — `actor_type='system'` positive DB acceptance is not directly pinned.** `TestAuditEvents_ActorTypeCheckRejectsOutOfVocabulary` proves the reject side (`'robot'` → 23514) and the co-write/metadata/event-type tests prove `'user'` is accepted, but no integration test inserts `actor_type='system'` (with `actor_id IS NULL`) and asserts success. The VO (`ActorTypeSystem.String()=="system"`) and the nil-actor → `pgtype.UUID{}` mapping are unit-pinned, but the DB boundary positive case for `'system'` is not.
   **Fix:** add a case to `migration_00011_test.go` (or the co-write suite) that inserts `actor_type='system', actor_id=NULL` and asserts acceptance; optionally assert the `IN ('user','system')` CHECK is exactly the closed set.

2. **W2 — terminal-transition audit rows/metadata are only implied, not asserted.** Spec S23 requires "each application has exactly one `ApplicationTransitioned` row and each row's `from_status` … `to_status`" for **all three** legal edges, explicitly including terminal ones. `TestTransition_CoWritesTransitionedEvent` asserts exactly-one-row + full metadata only for `submitted → in_review`. `TestTransition_InReviewToRejected` / `_InReviewToHired` pass an event through the same co-write method (so a nil error implies the append committed), but they never call `countAuditRowsForEntity` nor read the metadata. `TestTransitionApplication_LegalMatrix` (U) also does not capture/assert `lastTransitionEvent` per edge.
   **Fix:** extend `TestTransition_InReviewToRejected` and `_InReviewToHired` (or add one table-driven test over the three legal edges) to assert `countAuditRowsForEntity == 1` and metadata `{job_id, from_status, to_status}` with `from_status='in_review'` and `to_status='rejected'|'hired'`.

3. **W3 — `occurred_at` within-request-window not asserted (trivial).** Spec S18 mentions "`occurred_at` within the request window"; `TestCreate_CoWritesApplicationAndAuditEvent` asserts event_type/entity/actor/metadata but not `occurred_at`. The column is `TIMESTAMPTZ NOT NULL DEFAULT now()` (pinned by the migration DDL and `TestAuditEvents_MetadataDefaultsEmptyObject` indirectly exercises the default path), so this is low-risk.
   **Fix (optional):** add a `SELECT occurred_at` and assert it is non-zero / within `[start, end]` of the request window.

---

## 5. Strict TDD compliance

`strict_tdd: true` in `openspec/config.yaml`; `apply-progress.md` carries the RED-first evidence
(tabular for WU1/WU2/WU3, per-step RED/GREEN markers). Test files cross-referenced against the
codebase and all exist. Assertion quality in the new/changed tests:

- `TestCreate_AuditFailureRollsBackApplication` / `TestTransition_AuditFailureRollsBackStatus`
  sabotage the schema (`DROP TABLE audit_events`) and assert the write rolls back — non-vacuous
  (they prove the fail-closed path, not just that an error returns).
- `TestCreate_CoWritesApplicationAndAuditEvent` reads the actual `audit_events` row back via
  `pool` and asserts the exact metadata map (not a type-only/`len` assertion).
- `TestBuildSubmittedMetadata_NeverCoverLetterOrCandidateID` asserts the closed key-set invariant
  structurally (subset of the 4-key vocabulary).
- No tautologies, no ghost loops, no smoke-only tests observed in the audit/co-write surface.

---

## 6. Review workload / PR boundary

- Forecast (`tasks.md`): Chained PRs recommended = Yes; Chain strategy = `stacked-to-main`;
  PR 3 explicitly recorded as `size:exception` (~950–1100 authored lines, atomic seam change).
  All three WUs landed as separate commits (`11e3c0c`, `979cdea`, `d2a6560`), each documented in
  `apply-progress.md` with chosen-line ledger entries.
- Scope boundary held: the diff touches `db/migrations/00011_*`, `db/queries/audit_events.sql`,
  sqlc regen, the new `audit_events` BC, the applications adapter/port/usecases/handler/identity
  (`CompanyContext.UserID`), and `cmd/api/main.go`. No jobs/companies/identity write-path emission
  was added (pinned by `TestEventVocabularyIsClosed` AST guard). No scope creep beyond the assigned
  slice.

---

## 7. Structured status / actionContext findings

- Store `openspec`; change `audit_events`; `changeRoot: openspec/changes/audit_events`; next action
  was `verify` (performed).
- `actionContext.mode` is not `workspace-planning`; the repo is the authoritative workspace; no
  `allowedEditRoots` ambiguity for a verify phase.
- `openspec/config.yaml` `strict_tdd: true`; integration runner sources `backend/.env`.
- Remaining unchecked tasks after this run are **not implementation tasks**:
  - `4.2` Rollback drill (scratch branch) — remaining, not performed in this verify (non-blocking;
    design §10 documents the clean revert path and `goose down` clean-drop is already proven by
    `TestMigration00011_DownDropsTableAndIndex` + this run's `goose down`/`up`).
  - Parent post-apply items (bounded review, post-apply lifecycle gate) — parent-owned.
  Archive/sync is not blocked by an implementation-task completeness defect, but the lifecycle gate
  and 4.2 drill are still owed by their respective owners.

---

## 8. Exact blockers

None. All 10 requirements / 30 scenarios have real test coverage at the correct layer; unit, build,
vet, and integration suites are green; 00011 is applied with a clean down/up round-trip; the three
warnings in §4 are non-blocking coverage-gap observations with concrete fixes.
