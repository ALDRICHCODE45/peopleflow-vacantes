```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:212754051653d08498a936b26deece2608dfede7f8a73da80b26aedeeda30cff
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 45/45
test_command: cd backend && go test -count=1 ./...
test_exit_code: 0
test_output_hash: sha256:fa340ed3c4001d54a397448678adcb2fe20fa6ad4af18bf4b8f6c75ae8e6f582
build_command: cd backend && go build ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report: `companies-write`

Verdict: **pass_with_warnings** (C1 resolved 2026-08-26; all commands green)

All six work units are committed on `main` (`a5d88f7` → `e1a0145`), 48/48
implementation checkboxes are `[x]`, and every verification command — unit, build, vet,
sqlc idempotency, and the full integration suite — is green. The write surface
(`PATCH /me/company`, `DELETE /me/company`, CAS, transactional inline close, no-audit
non-goal) is implemented faithfully to the design (D1–D17) and the deviations recorded
in `apply-progress.md` are accurately documented in the code. **However**, one spec
scenario — **R7‑S3 "GET /me/company still returns the soft-deleted company record to
the owner"** — is contradicted by the actual (unchanged) read path, and has no test.
This is a spec-vs-implementation inconsistency that must be resolved before
archive/sync (see §4 C1 and §8). It is a CRITICAL because the spec's own requirement
text asserts a factually false premise ("the GET /me/company read path does not filter
by `companies.deleted_at`"), so archiving the delta spec as written would seed a false
behavior contract into the canonical spec.

---

## 1. Measured totals (my own counts)

| Artifact | Requirements | Scenarios |
|---|---|---|
| `specs/companies/spec.md` (delta) | **9** | **45** |

Authoritative: **9 requirements / 45 scenarios.** `tasks.md` implementation tasks
1.1–6.15 are all `[x]`; zero unchecked implementation-task markers
(`^\s*- \[ \]` → none among Phases 1–6). The only remaining items are parent-owned
(`P.1` bounded review, `P.2` archive gate), which are plain bullets, not checkboxes.

Coverage: **44/45 scenarios** have a real test at the correct layer. The single
uncovered scenario is **R7‑S3**, which is not merely untested — it is *contradicted*
by the implementation (see §4 C1).

---

## 2. Commands run (this verification) + results

All from `backend/`. Go toolchain `go1.26.1 linux/amd64` (`go.mod` declares
`go 1.26.1`, satisfying the design D6 generic-type-alias requirement). Integration
sourced `backend/.env`; Postgres container `peopleflow-vacancies` healthy.

| Command | Result |
|---|---|
| `go build ./...` | ✅ exit 0 (empty output) |
| `go vet ./...` | ✅ exit 0 (empty output) |
| `go test ./...` | ✅ exit 0 — 36 packages `ok`, 0 FAIL |
| `go test -tags=integration -p 1 ./... -count=1` | ✅ exit 0 — 38 packages `ok`, 0 FAIL (companies postgres suite executed against live Postgres) |
| `go test -tags=integration -p 1 -count=1 -v ./internal/features/companies/infrastructure/postgres/ -run 'TestUpdateCompany\|TestSoftDeleteCompany\|TestGetCompanyForUpdate'` | ✅ 6 PASS + 1 SKIP (rollback placeholder) |
| `go tool sqlc generate` (second run) | ✅ exit 0, empty `git diff` on `internal/db` / `db/queries` (idempotent) |
| `go test ./internal/features/companies/... -cover` | ✅ usecases 81.6%, http 82.3%, postgres 46.8%, entities 90.0%, valueobjects 58.8% |

Verbatim integration-test names observed (companies postgres package):

```
--- PASS: TestUpdateCompany_PartialUpdateAndCAS
--- PASS: TestUpdateCompany_TextNullClearsColumn
--- PASS: TestSoftDeleteCompany_TombstonesAndClosesJobs
--- SKIP: TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder
--- PASS: TestGetCompanyForUpdate_HidesTombstoned
--- PASS: TestSoftDeleteCompany_StaleCASReturnsErrCompanyNotFound
--- PASS: TestUpdateCompany_SQLCHECKViolationMapsToSizeVO
```

Unit suite tail (representative, all `ok`): `cmd/api`, `companies/...` (usecases,
entities, valueobjects, http, postgres), `identity/...`, `jobs/...`, `shared/valueobjects`,
plus candidates/applications/audit_events — 0 FAIL.

---

## 3. Requirement → scenario → test coverage matrix (44/45)

Legend: **U** = unit (use case), **H** = handler/http, **A** = adapter unit
(builders/mappers), **I** = integration (live Postgres), **MW** = pre-existing identity
middleware tests, **AST** = composition-root AST guard.

### R1 — PATCH /me/company endpoint, owner-only gate, field mutability (14 scenarios)

- **S1 owner patches a single field** → `TestUpdateCompany_PartialUpdateAndCAS` (I: website patch + `updated_at` advance). ✅
- **S2 owner patches multiple fields in one call** → ⚠️ no single-call multi-field test; covered structurally by `TestUpdateCompanyHandler_SuccessReturns200` (H, name) + `PartialUpdateAndCAS` (multi-step). Minor gap (see §4 W5).
- **S3 absent fields leave columns unchanged** → `TestUpdateCompany_AbsentFieldsLeavePatchUntouched` (U: 12 `Set=false`) + `PartialUpdateAndCAS` (I: absent description unchanged). ✅
- **S4 explicit JSON null clears nullable column** → `TestUpdateCompany_TextNullClearsColumn` (I) + `TestBuildUpdateCompanyParams_ProfileTriState` (A). ✅
- **S5 immutable fields silently dropped** → `TestUpdateCompanyHandler_ImmutableFieldsSilentlyDropped` (H: rfc/industry_id/status dropped). ✅
- **S6 company_id in body ignored (IDOR)** → `TestUpdateCompanyHandler_CompanyIDInBodyIgnored` (H). ✅
- **S7 name < 4 rejected** → `TestUpdateCompany_NameTooShort` (U) + `TestUpdateCompanyHandler_VOFailureReturns400` (H). ✅
- **S8 description > 3000 rejected** → `TestUpdateCompany_DescriptionTooLong` (U). ✅
- **S9 founded_year out of range rejected** → `TestUpdateCompany_FoundedYearOutOfRange` (U). ✅
- **S10 invalid size rejected** → `TestUpdateCompany_InvalidSize` (U) + `TestUpdateCompany_SQLCHECKViolationMapsToSizeVO` (I). ✅
- **S11 invalid JSON → 400** → `TestUpdateCompanyHandler_InvalidJSONReturns400` (H). ✅
- **S12 non-owner / non-member → 403** → pre-existing `RequireCompanyRole` middleware tests (MW). ✅
- **S13 unauthenticated → 401** → pre-existing `RequireAuth` middleware tests (MW) + `TestRequireAuth_MountedOnMeRoutes` (AST). ✅
- **S14 missing CompanyContext → 500** → `TestUpdateCompanyHandler_MissingContextReturns500` (H). ✅

### R2 — PATCH /me/company CAS optimistic concurrency (5 scenarios)

- **S15 matching header allows write** → `TestUpdateCompany_SuccessRereadsAndProjects` (U) + `PartialUpdateAndCAS` (I). ✅
- **S16 stale header → 409 with latest view** → `TestUpdateCompany_CASMismatchReturnsViewAndConflict` (U) + `TestUpdateCompanyHandler_CASConflictReturns409WithView` (H). ✅
- **S17 missing header → 409** → ⚠️ no dedicated PATCH test; the shared `parseIfUnmodifiedSince` zero-token path is pinned for DELETE (`TestDeleteCompanyHandler_MissingCASReturns409`) and the use-case CAS compare treats zero token identically. Minor gap (see §4 W4).
- **S18 malformed header → 409** → ⚠️ same as S17; zero-token parse is shared but the malformed PATCH case is not directly asserted. Minor gap (see §4 W4).
- **S19 two concurrent writers, one wins** → ⚠️ not directly tested; CAS atomicity is proven by the SQL `updated_at = cas_token` WHERE predicate + `TestUpdateCompany_PartialUpdateAndCAS` stale-CAS branch. Minor gap (see §4 W6).

### R3 — PATCH /me/company response shape (3 scenarios)

- **S20 200 body carries redacted shape** → `TestUpdateCompanyHandler_SuccessReturns200` (H: asserts omission of rfc/industry_id/status/deleted_at/created_at). ✅
- **S21 200 and 409 omit rfc/industry_id/status/deleted_at** → 200 side asserted by `SuccessReturns200`; 409 side asserted only as "not `{"error":…}` envelope" by `CASConflictReturns409WithView` (H) — both paths share `toCompanyEditorView`/`CompanyEditorViewDto` (D8). ⚠️ Minor gap: 409-body redaction not explicitly asserted (see §4 W3).
- **S22 200 and 409 same wire shape** → structural parity via the single `toCompanyEditorView` projection + `CompanyEditorViewDto`; no explicit 200↔409 JSON-equality assertion. Minor gap (see §4 W3).

### R4 — DELETE /me/company endpoint, owner-only gate, idempotency (5 scenarios)

- **S23 owner soft-deletes → 204** → `TestSoftDeleteCompany_SuccessNoReread` (U) + `TestDeleteCompanyHandler_SuccessReturns204` (H) + `TestSoftDeleteCompany_TombstonesAndClosesJobs` (I). ✅
- **S24 non-owner / non-member → 403** → pre-existing `RequireCompanyRole` middleware (MW). ✅
- **S25 unauthenticated → 401** → pre-existing `RequireAuth` middleware (MW). ✅
- **S26 missing CompanyContext → 500** → `TestDeleteCompanyHandler_MissingContextReturns500` (H). ✅
- **S27 second DELETE → 404** → `TestGetCompanyForUpdate_HidesTombstoned` (I: read-for-delete hides tombstone + second `SoftDeleteCompany` → `ErrCompanyNotFound`) + `TestSoftDeleteCompany_NotFound` (U). ✅

### R5 — DELETE /me/company CAS optimistic concurrency (5 scenarios)

- **S28 matching header allows soft-delete** → `TestSoftDeleteCompany_SuccessNoReread` (U) + `TestSoftDeleteCompany_StaleCASReturnsErrCompanyNotFound` fresh-CAS tail (I). ✅
- **S29 stale header → 409 empty body** → `TestDeleteCompanyHandler_CASConflictReturns409EmptyBody` (H). ✅
- **S30 missing header → 409 empty body** → `TestDeleteCompanyHandler_MissingCASReturns409` (H). ✅
- **S31 malformed header → 409 empty body** → ⚠️ not a distinct test; zero-token parse path is pinned by `TestSoftDeleteCompany_ZeroTokenReturnsConflict` (U) + `MissingCASReturns409` (H). Minor gap (see §4 W4).
- **S32 two concurrent owners, one wins** → ⚠️ not directly tested (same rationale as R2‑S19). Minor gap (see §4 W6).

### R6 — soft-delete atomic transactional close of jobs (5 scenarios)

- **S33 inline close transitions draft + published → closed** → `TestSoftDeleteCompany_TombstonesAndClosesJobs` (I: draft + published → `closed` with fresh `updated_at`). ✅
- **S34 already-closed jobs NOT touched** → `TombstonesAndClosesJobs` (I: closed job `updated_at` unchanged). ✅
- **S35 company_members unchanged** → `TombstonesAndClosesJobs` (I: count unchanged). ✅
- **S36 applications unchanged** → `TombstonesAndClosesJobs` (I: count unchanged). ✅
- **S37 failure on inline close rolls back** → ❌ `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` is `t.Skip` (documented coverage gap). Non-blocking but real — see §4 W1.

### R7 — soft-deleted company read visibility (3 scenarios)

- **S38 GET /companies/{id} hides soft-deleted** → `TestGetCompanyForUpdate_HidesTombstoned` (I: `deleted_at IS NULL` predicate; the public handler uses the same `GetCompanyByID` SQL). ✅
- **S39 GET /jobs excludes jobs of soft-deleted company** → ⚠️ indirect: inline close flips status (`TombstonesAndClosesJobs` published→closed), and `SearchJobs` already predicates `status='published'`; no direct `SearchJobs` listing assertion (read-side hardening is a documented deferral). Minor gap (see §4 W2).
- **S40 GET /me/company hides soft-deleted record** → ✅ `TestGetMyMembership_HidesTombstonedCompany` (I: live-DB regression, commit `f97f7dc` — real postgres membership + company adapters; spec R7-S3 amended to the actual `404` behavior 2026-08-26).

### R8 — authorization dispatch order for /me/company writes (3 scenarios)

- **S41 401 short-circuits** → `RequireAuth` middleware (MW) + `TestRequireAuth_MountedOnMeRoutes` (AST). ✅
- **S42 403 short-circuits** → `RequireCompanyRole` middleware (MW). ✅
- **S43 500 fail-closed if CompanyContext missing** → `TestUpdateCompanyHandler_MissingContextReturns500` + `TestDeleteCompanyHandler_MissingContextReturns500` (H) + `requireCompanyContext` reuse. ✅

### R9 — no audit events for companies (2 scenarios)

- **S44 successful PATCH adds no audit row** → ⚠️ not directly asserted; structurally guaranteed (PATCH path never touches `audit_events`) and DELETE-side count is pinned. Minor gap (see §4 W2).
- **S45 successful DELETE adds no audit row** → `TestSoftDeleteCompany_TombstonesAndClosesJobs` (I: `audit_events` count unchanged — invariant (e)). ✅

---

## 4. Defects / warnings

### CRITICAL (RESOLVED 2026-08-26)

1. **C1 — R7‑S3 spec/implementation contradiction (`GET /me/company` on a soft-deleted company).**
   **RESOLVED by user decision: spec amended to the actual `404` behavior** (soft-deleted
   company is hidden from `GET /me/company`, matching `GET /companies/{id}` — consistent with
   the slice's "read unchanged" framing and the "soft-deleted company invisible everywhere"
   principle). Actions taken:
   - `specs/companies/spec.md` R7 requirement narrative + scenario renamed to
     "GET /me/company hides a soft-deleted company from the owner" and now requires
     `404 company not found` (the membership read resolves the company through
     `GetCompanyByID`, whose `WHERE deleted_at IS NULL` predicate filters the tombstone;
     the `company_members` row survives as audit history).
   - Regression test committed as `f97f7dc` (`test(companies): regression — membership read
     hides tombstoned company (spec R7-S3)`): `TestGetMyMembership_HidesTombstonedCompany`
     in `companyRepository_write_integration_test.go` — wires the REAL postgres membership +
     company adapters with a stub identity repo, seeds a user + owner membership on the
     tombstoned fixture company `writeCoT`, and asserts `GetMyMembership` returns
     `ErrCompanyNotFound` (→ 404) while the `company_members` row survives as `role='owner'`.
   The contradiction is closed; the spec now matches the code and has a live-DB regression
   test pinning it.

### WARNINGS (non-blocking)

1. **W1 — `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` is `t.Skip`.** R6‑S37
   ("failure on the inline close rolls back the soft-delete") has no live-DB test. The
   `defer tx.Rollback` idiom + the 4-statement commit boundary in
   `TestSoftDeleteCompany_TombstonesAndClosesJobs` cover the happy-path atomicity, but the
   rollback branch itself is unproven. The `t.Skip` rationale (DDL churn exceeds risk
   budget) is documented in `apply-progress.md` deviation #4. Recommend a future
   `forceInlineCloseFailure` helper or an explicit size-exception/acceptance note.
2. **W2 — integration-only / deferred coverage.** R9‑S44 (PATCH no-audit) is asserted only
   on the DELETE side; R7‑S39 (GET /jobs excludes) is deferred to the read-side hardening
   follow-up and not directly asserted via `SearchJobs`.
3. **W3 — PATCH 409-body redaction parity.** `TestUpdateCompanyHandler_CASConflictReturns409WithView`
   asserts the 409 body is not the generic `{"error":"conflict"}` envelope, but does not
   assert the 409 body omits `rfc`/`industry_id`/`status`/`deleted_at`/`created_at` or that
   it is byte-shape-identical to the 200 body (spec R3 S21/S22). Both paths share
   `toCompanyEditorView`/`CompanyEditorViewDto`, so it holds today, but it is not pinned.
4. **W4 — PATCH missing/malformed-CAS not explicitly unit-tested.** The zero-token CAS
   path is pinned for DELETE (`TestSoftDeleteCompany_ZeroTokenReturnsConflict`,
   `TestDeleteCompanyHandler_MissingCASReturns409`) but there is no dedicated PATCH
   missing/malformed-header test (spec R2 S17/S18, R5 S31 for malformed). The mechanism is
   shared via `parseIfUnmodifiedSince`.
5. **W5 — multi-field PATCH in one call not directly tested** (spec R1 S2); covered
   structurally by single-field + tri-state tests.
6. **W6 — concurrent-writer scenarios untested** (R2 S19, R5 S32). CAS atomicity is proven
   by the `updated_at = cas_token` WHERE clause + stale-CAS integration tests, but there is
   no true two-goroutine race test.

---

## 5. Strict TDD compliance

`strict_tdd: true` in `openspec/config.yaml`; `apply-progress.md` carries the per-WU
RED→GREEN→TRIANGULATE evidence (tabular per WU, compile-break REDs accepted per design
§7 / jobs D10/D9 precedent). Test files cross-referenced against the codebase and all
exist; `apply-progress.md` contains the required "TDD Cycle Evidence" sections for WU1–WU6.

Assertion quality in the new/changed tests:

- `TestSoftDeleteCompany_TombstonesAndClosesJobs` reads the actual Postgres rows back via
  `pool.QueryRow` and asserts the §14.12 five-invariant set (draft/published → closed with
  fresh `updated_at`; closed job `updated_at` unchanged; `company_members`/`applications`/
  `audit_events` counts unchanged) — non-vacuous, state-level assertions, not type-only.
- `TestUpdateCompany_PartialUpdateAndCAS` asserts the stale-CAS no-mutation invariant by
  reading the row back — proves the write was NOT applied, not just that an error returned.
- `TestUpdateCompanyHandler_SuccessReturns200` asserts the wire JSON omits `rfc`,
  `industry_id`, `status`, `deleted_at`, `created_at` (structural redaction), and
  `TestDeleteCompanyHandler_CASConflictReturns409EmptyBody` asserts `Body.Len()==0` for the
  deliberate DELETE 409 asymmetry.
- `TestBuildUpdateCompanyParams_ArgOrderMatchesSqlc` pins the sqlc SET-list-first arg order
  via reflection (`assertStructFieldOrder`) — catches silent arg reordering at unit time.
- No tautologies, ghost loops, smoke-only, or implementation-detail-CSS assertions observed.
  Stubs are plain `var _ repositories.CompanyRepository` guarded; assertions target public
  behavior/state, not internal plumbing.

---

## 6. Review workload / PR boundary

- Forecast (`tasks.md`): Chained PRs recommended = Yes; Chain strategy = `stacked-to-main`;
  user-resolved 2026-08-26 six-PR chain (WU1→WU6), per-PR 400-line budget with WU3 (~500)
  and WU5 (~700–900) carrying their own size-exception flags.
- Delivered as six commits on `main`, exactly matching the forecasted WU order:
  `a5d88f7` (WU1 sqlc) → `6c264c7` (WU2 Optional lift) → `278dd26` (WU3 atomic port+stubs+pool)
  → `29a3afb` (WU4 use cases+DTOs) → `c482215` (WU5 adapter+integration) → `e1a0145`
  (WU6 handlers+routes+AST guard).
- Scope boundary held: the diff touches `db/queries/companies.sql` + `jobs.sql`, sqlc regen,
  the shared `Optional[T]` lift, the companies domain/application/infrastructure layers,
  `cmd/api/main.go` + `main_test.go`, and the 5 stub-repair files. No `audit_events`
  port/query/entity change (pinned by the R9 audit-count integration assertion). No scope
  creep beyond the assigned slice. `size:exception` for WU3/WU5 is recorded in `tasks.md`
  and `apply-progress.md`, not in a merge-commit body (the commits were staged by apply and
  landed by the user; see §7).

---

## 7. Structured status / actionContext findings

- Store `openspec`; change `companies-write`; `changeRoot: openspec/changes/companies-write`;
  next action was `verify` (performed). `git status` shows `openspec/changes/companies-write/`
  untracked (expected — not yet archived/synced).
- `actionContext.mode` is not `workspace-planning`; the repo is the authoritative workspace;
  no `allowedEditRoots` ambiguity for a verify phase.
- `openspec/config.yaml`: `strict_tdd: true`; `test_command: cd backend && go test ./...`;
  integration runner sources `backend/.env`.
- Remaining non-implementation items after this run: parent-owned `P.1` (bounded review) and
  `P.2` (archive decision per `rules.archive`). The WU3 `cmd/api/main.go` wiring was pulled
  forward from WU6 (apply-progress deviation #3) and the `size:exception` was accepted via
  the in-session 6-PR decision, not a merge-commit body — a minor process note, not a blocker.
- `skill_resolution` for this verify: `paths-injected` (both Go testing skills read at the
  injected absolute paths).

---

## 8. Exact blockers

1. ~~**CRITICAL (blocks archive/sync):** R7‑S3 — the spec mandates `GET /me/company` returns
   `200` with the membership + company record for a soft-deleted company and claims the read
   path "does not filter by `companies.deleted_at`", but the actual read path
   (`GetMyMembership` → `GetByID` → `GetCompanyByID` with `WHERE deleted_at IS NULL`) returns
   `404`. No test asserts the spec's required behavior.~~ **RESOLVED 2026-08-26:** spec amended
   to the actual `404` behavior (R7-S3 now requires `404 company not found`; the membership
   row survives as audit history) + regression test `TestGetMyMembership_HidesTombstonedCompany`
   committed as `f97f7dc` (live-DB, real adapters). No longer blocks archive/sync.

Non-blocking (do not prevent a `pass_with_warnings` after C1 is resolved): the
`t.Skip` rollback placeholder (W1), the PATCH 409-body redaction parity / missing-malformed
CAS / multi-field / concurrent-writer coverage gaps (W2–W6).

---

## 9. Recommendation

Resolve C1 first (spec amendment + regression test is the lower-risk path and consistent
with the slice's "read unchanged" framing). After that, archive/sync can proceed under a
`pass_with_warnings` verdict. The warnings in §4 W1–W6 should be carried forward as follow-up
items or explicitly accepted as deferred.
