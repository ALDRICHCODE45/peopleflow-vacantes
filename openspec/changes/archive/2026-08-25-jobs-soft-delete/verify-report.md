```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:79bb50b3350e4aad606205fe05cade5473ea15da28e5dec514def836fc920214
verdict: pass
blockers: 0
critical_findings: 0
requirements: 3/3
scenarios: 31/31
test_command: cd backend && go test ./... -count=1
test_exit_code: 0
test_output_hash: sha256:cbeb6156e9b0c37011dc59f80cdc951681b777255220c2923c2cee60df76e6d1
build_command: cd backend && go build ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verify Report: `jobs-soft-delete`

Verdict: **pass**

The `jobs-soft-delete` delta is behaviorally correct. All 3 ADDED requirements and all
31 delta scenarios (S1–S31) are covered by a test (new or pre-existing regression). D1–D9
are honored in code. The full unit suite is green; `go vet`, `go vet -tags=integration`,
`go build`, and `gofmt` are all clean. No scope leak into forbidden files (DTOs, read
side, migrations, entities, `classifyError`, `parseIfUnmodifiedSince`, `JobForUpdate` all
untouched). Strict TDD evidence is present in table form and independently verified. The
single-pr size-exception (2,663 changed lines > 1,600 budget) is explicitly authorized by
the maintainer in the apply ledger. No defect requiring code changes was found.

---

## 1. Measured totals (spec/canonical integrity)

| Artifact | Requirements | Scenarios |
|---|---|---|
| Canonical `openspec/specs/jobs/spec.md` (baseline) | **29** | **124** |
| Delta `openspec/changes/jobs-soft-delete/specs/jobs/spec.md` | **3** (all ADDED) | **31** (S1–S31) |
| Declared post-sync total | **32** | **155** |

Post-sync arithmetic verified:

- Requirements: 29 + 3 ADDED = **32** ✓
- Scenarios: 124 + 31 ADDED = **155** ✓

The delta declares exactly 3 ADDED requirements (pure ADDED, no MODIFIED/REMOVED):
`DELETE /jobs/{id} Endpoint, Gate, and Route Boundary`, `Soft-Delete Concurrency Controls`,
and `Soft-Delete Eligibility, Audit, and Read-Side Invariants`. Canonical is not yet synced
(`sdd-sync`'s job, not verify's); the delta is internally consistent and the totals are
arithmetically correct.

---

## 2. Scenario coverage matrix (S1–S31 → test)

Layer legend: U = unit (usecase), H = handler, I = SQL integration (`//go:build integration`),
A = adapter unit, AST = composition-root guard, R = pre-existing regression (unchanged).

| # | Scenario | Test(s) | Layer |
|---|---|---|---|
| S1 | recruiter soft-deletes own vacancy | `TestSoftDeleteJob_SuccessCallsSoftDeleteWithCAS` + `TestSoftDelete_DraftRowDeletes` | U + I |
| S2 | owner passes recruiter gate | existing `RequireCompanyRole` ordinal tests + `TestJobsSoftDeleteRoute_MountedBehindGates` (route uses `requireRecruiter`) | R + AST |
| S3 | no Authorization → 401 | `TestSoftDeleteJob_MissingAuthReturns401` | H |
| S4 | non-member → 403 | existing `RequireCompanyRole` tests (middleware short-circuit) | R |
| S5 | role too low → 403 | existing `RequireCompanyRole` tests | R |
| S6 | invalid job id → 400 | `TestSoftDeleteJob_InvalidUUIDReturns400` | H |
| S7 | 204 No Content empty body | `TestSoftDeleteJob_SuccessReturns204EmptyBody` + `TestSoftDeleteJob_SuccessCallsSoftDeleteWithCAS` | H + U |
| S8 | missing CompanyContext fails closed 500 | `TestSoftDeleteJob_MissingCompanyContextReturns500` | H |
| S9 | DELETE not reachable via public mount | `TestSoftDeleteJob_DeleteNotServedByPublicMount` + `TestJobsMount_PublicReadRoutes` | H + R |
| S10 | matching `updated_at` allows delete | `TestSoftDeleteJob_SuccessCallsSoftDeleteWithCAS` + `TestSoftDelete_DraftRowDeletes` | U + I |
| S11 | stale CAS → 409 + latest editor view | `TestSoftDeleteJob_CASMismatchReturnsConflictWithView` + `TestSoftDeleteJob_StaleCASReturns409WithView` | U + H |
| S12 | missing `If-Unmodified-Since` → 409 | `TestSoftDeleteJob_ZeroTokenReturnsConflict` + `TestSoftDeleteJob_MissingCASReturns409WithView` | U + H |
| S13 | malformed `If-Unmodified-Since` → 409 | `TestSoftDeleteJob_MalformedCASReturns409WithView` | H |
| S14 | CAS conflict independent of company visibility | `TestSoftDeleteJob_CASMismatchReturnsConflictWithView` (CAS before cross-company filter) | U |
| S15 | two concurrent writers, exactly one wins | `TestSoftDeleteJob_CASMismatchReturnsConflictWithView` + `TestSoftDelete_CASMismatchReturnsErrJobNotFound` | U + I |
| S16 | advances `updated_at` exactly once | `TestSoftDelete_SetsDeletedAtAndAdvancesUpdatedAt` | I |
| S17 | suspended company → 409 company is not active | `TestSoftDelete_SuspendedCompanyReturnsErrCompanyNotActive` + `TestSoftDeleteJob_CompanyNotActiveReturns409` | I + H |
| S18 | pending_verification company → 409 | `TestSoftDelete_PendingVerificationCompanyReturnsErrCompanyNotActive` | I |
| S19 | active company passes gate | `TestSoftDelete_ActiveCompanyPassesGuard` | I |
| S20 | active check atomic with UPDATE | `TestSoftDelete_GuardIsAtomicWithUpdate` | I |
| S21 | draft row soft-deletable | `TestSoftDelete_DraftRowDeletes` | I |
| S22 | published row soft-deletable | `TestSoftDelete_PublishedRowDeletes` | I |
| S23 | closed row soft-deletable | `TestSoftDelete_ClosedRowDeletes` | I |
| S24 | `deleted_at` audit; no other column touched | `TestSoftDelete_PreservesImmutables` | I |
| S25 | search_vector + partial index consistent | `TestSoftDelete_SearchVectorUnchangedAndExcludedFromListing` | I |
| S26 | second DELETE on soft-deleted → 404 | `TestSoftDelete_SecondDeleteReturnsErrJobNotFound` + `TestSoftDeleteJob_GetForUpdateNotFoundPropagates` | I + U |
| S27 | cross-company DELETE → 404 | `TestSoftDelete_CrossCompanyReturnsErrJobNotFound` + `TestGetForUpdate_CrossCompanyReturnsErrJobNotFound` | I + R |
| S28 | non-existent id DELETE → 404 | `TestSoftDeleteJob_GetForUpdateNotFoundPropagates` + `TestGetForUpdate_NonExistentReturnsErrJobNotFound` | U + R |
| S29 | PATCH re-open on soft-deleted → 404 (cross-ref) | `TestGetForUpdate_SoftDeletedReturnsErrJobNotFound` (existing) | R |
| S30 | soft-deleted hidden from GET /jobs/{id} (cross-ref) | `TestSoftDelete_DraftRowDeletes` (re-read `GetByID` → 404) + existing `GetByID` visibility test | I + R |
| S31 | soft-deleted excluded from GET /jobs (cross-ref) | `TestSoftDelete_SearchVectorUnchangedAndExcludedFromListing` + existing `Search` visibility test | I + R |

**Coverage: 31/31 scenarios mapped.** No delta scenario is untested.

---

## 3. Requirement coverage

- **ADDED — DELETE /jobs/{id} Endpoint, Gate, and Route Boundary**: gated `r.With(requireAuth, requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)` on the root router (`main.go:209`), never the public `r.Mount("/jobs", ...)` (`main.go:179`). Handler derives `company_id` exclusively from `security.CompanyContext`; no body decode; fail-closed 500 on missing context. S1–S9.
- **ADDED — Soft-Delete Concurrency Controls**: D1 atomic CTE guard + CAS compare at the use-case layer (`!ifUnmodifiedSince.Equal(current.UpdatedAt)` → `(toEditorView(current), ErrConcurrencyConflict)`). Stale/missing/malformed → 409 + editor view; suspended/pending → 409 `{"error":"company is not active"}` via unchanged `classifyError`. S10–S20.
- **ADDED — Soft-Delete Eligibility, Audit, and Read-Side Invariants**: status-agnostic (draft/published/closed) via no status branch in `SoftDeleteJob`; minimal SET list (`deleted_at`, `updated_at` only); second-DELETE / cross-company / non-existent → 404 indistinguishable; re-open on soft-deleted stays 404; read side zero change. S21–S31.

---

## 4. D1–D9 compliance

| Decision | Status | Evidence |
|---|---|---|
| D1 `SoftDeleteJob :one` CTE + `{guard_passed, deleted_count}` | ✅ | `db/queries/jobs.sql:257-312` — `WITH active AS (…) , upd AS (UPDATE jobs SET deleted_at = now(), updated_at = now() WHERE … AND EXISTS (SELECT 1 FROM active) RETURNING id) SELECT EXISTS (SELECT 1 FROM active) AS guard_passed, (SELECT count(*) FROM upd) AS deleted_count;` — mirrors `UpdateJob` exactly, minimal SET list. |
| D2 outcome matrix + no re-read | ✅ | Adapter `SoftDelete`: `!row.GuardPassed → ErrCompanyNotActive`; `row.DeletedCount == 0 → ErrJobNotFound`; `nil` on success. Use case (`softDeleteJob.go`) has no re-read after `repo.SoftDelete` (step 4 `return nil, nil`). Tests pin `getForUpdateCalls == 1` on both gate-miss and residual-race paths. |
| D3 `mapSoftDeleteError` `pgx.ErrNoRows` BEFORE `errors.As`, no 23503 | ✅ | `mapSoftDeleteError` checks `errors.Is(err, pgx.ErrNoRows)` before the `*pgconn.PgError` `errors.As`; `23514 → ErrInvalidStatusTransition`; no `23503` branch. `TestMapSoftDeleteError` + `TestMapSoftDeleteError_NoForeignKeyBranch` pin both invariants. |
| D4 use-case tuple `(*dtos.JobEditorViewDto, error)` | ✅ | `func (s *JobService) SoftDeleteJob(ctx, companyID, jobID, ifUnmodifiedSince) (*dtos.JobEditorViewDto, error)`; `var _ SoftDeleteJobUseCase = (*JobService)(nil)` in `jobService.go:76`. |
| D5 use-case flow GetForUpdate → CAS → SoftDelete, no re-read | ✅ | `softDeleteJob.go` 4-step flow matches D5 verbatim; reuses package-private `toEditorView` from `updateJob.go`. |
| D6 atomic five-stub repair + `var _` assertion | ✅ | 5 stub types repaired (`stubJobRepo`, `stubJobRepository`, `stubRepo` default-`nil`; `writeStubRepo`, `writeStubHandlerRepo` programmable) + `postgres.JobRepository` real impl, all in Commit A. `var _ repositories.JobRepository` assertions at 6 sites + `TestJobRepository_StubSatisfiesPort` in-test assignment. |
| D7 sqlc regen touches both generated files | ✅ | `internal/db/jobs.sql.go` (+77) and `internal/db/querier.go` (+35); `SoftDeleteJobParams{CompanyID,ID,CasToken}`, `SoftDeleteJobRow{GuardPassed,DeletedCount}`, `Querier.SoftDeleteJob`. `UpdateJobParams`/`UpdateJobRow` unchanged. |
| D8 handler + gated route + `classifyError` unchanged | ✅ | `softDeleteJob` handler mirrors `updateJob` (no body decode, no re-read); `JobHandlers.SoftDeleteJob`; `r.With(requireAuth, requireRecruiter).Delete(...)` on gated subtree. `classifyError` (357-387) and `parseIfUnmodifiedSince` bodies byte-identical to pre-change. |
| D9 file inventory (5 stub types, not 5 files) | ✅ | 17 authored files (7 production + 4 new test + 6 MOD test) + 2 generated + 2 SDD artifacts = 21 files total. Matches `git diff --stat 63ea03b..HEAD` exactly. |

---

## 5. Test evidence (commands run + output)

All run from `backend/`. Output hashes computed from the actual captured output.

| Command | Result |
|---|---|
| `go test -count=1 ./...` | ✅ exit 0 — all 27 packages `ok` (jobs packages green, no FAIL) |
| `go vet ./...` | ✅ exit 0 (no output) |
| `go vet -tags=integration ./internal/features/jobs/infrastructure/postgres/` | ✅ exit 0 (13-test integration file compiles under tag) |
| `go build ./...` | ✅ exit 0 (empty output) |
| `gofmt -l` on the 16 touched `.go` files (incl. generated) | ✅ empty (clean) |

Measured hashes:

- `test_output_hash` = `sha256:cbeb6156e9b0c37011dc59f80cdc951681b777255220c2923c2cee60df76e6d1` (exit 0)
- `build_output_hash` = `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty output, exit 0)

GREEN is confirmed. Live DB execution of the 13 integration tests is deferred to the parent
(`make test-integration`) — no `DATABASE_URL` in the verify environment; the suite is
correctly `//go:build integration`-tagged and compiles clean under `go vet -tags=integration`.

---

## 6. Strict TDD compliance

- **RED-first mechanism verified.** The REDs are compile breaks / assertion failures
  documented in `apply-progress.md`'s Strict TDD evidence table and consistent with the
  committed code: 1.1 `*JobService has no field or method SoftDeleteJob` / `*writeStubRepo
  has no field or method softDeleteCalls…`; 2.2 `undefined: mapSoftDeleteError` /
  `undefined: buildSoftDeleteJobParams`; 4.1 `h.JobHandlers().SoftDeleteJob undefined`;
  5.1 `expected at least one With(...).Delete("/jobs/{id}", ...) mutation; got 0`.
- **Atomic port-extension RED.** The port extension + 5-stub repair + adapter + SQL land in
  one commit (Commit A `cc9eb11`), matching the accepted `jobs-create` D10 pattern (the
  compile break is the RED; the tree is intentionally compile-broken between tasks 1.2 and
  2.3). Tasks.md and apply-progress.md explicitly document this.
- **Test files cross-referenced.** All reported test files exist and their `func Test…`
  symbols are present: 7 use-case tests, 4 adapter unit tests (+ subtests), 13 integration
  tests, 10 handler tests, 1 AST guard. Counts match the apply-progress evidence table.
- **Evidence format.** apply-progress.md carries a real "Strict TDD evidence table" (Step |
  Task | RED evidence | GREEN evidence | Status) — an improvement over `jobs-reopen`'s
  prose-only evidence. It does not use the literal "TDD Cycle Evidence" column set
  (RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR), but the RED/GREEN substance is present and
  independently verified; not a CRITICAL.

### Assertion quality

✅ No tautologies, no ghost loops, no type-only/smoke-only assertions, no
implementation-detail CSS assertions. Representative quality:

- Use-case success test asserts `softDeleteCalls == 1`, `lastSoftDeleteID`,
  `lastSoftDeleteCompany`, and `lastSoftDeleteCas.Equal(updatedAt)` — the exact CAS
  forwarding contract.
- CAS-conflict tests assert `view != nil`, `view.UpdatedAt`, `view.Status`, AND
  `softDeleteCalls == 0` (SoftDelete NOT called).
- The D2 no-re-read invariant is pinned by `getForUpdateCalls == 1` on BOTH the gate-miss
  and residual-race error paths.
- Handler 409 tests decode the body as `dtos.JobEditorViewDto` and assert `Status` +
  `UpdatedAt` (not just status code); 204 test asserts `Body.Len() == 0`.
- `TestMapSoftDeleteError_NoForeignKeyBranch` actively asserts 23503 is NOT mapped to
  `ErrCompanyGone` (negative-pinning the D3 contract).
- Integration `TestSoftDelete_PreservesImmutables` walks 14 columns and asserts only
  `deleted_at` + `updated_at` moved; `TestSoftDelete_GuardIsAtomicWithUpdate` sets up a real
  TOCTOU window (GetForUpdate succeeds → suspend in-transaction → SoftDelete still yields
  `ErrCompanyNotActive`).

---

## 7. Review workload / PR boundary

- Forecast: Chained PRs recommended = Yes; Chain strategy = **size-exception**;
  Delivery = single-pr (pinned by preflight). The size-exception is explicitly recorded.
- **Post-apply ledger reality confirmed** (`gentle-ai sdd-attempt status --cwd . --change
  jobs-soft-delete`): apply attempt (ordinal 1) settled `passed`, `changed_lines: 2663`,
  `changed_line_budget_exceeded: true`; `last_reset` by maintainer "Aldrich Flores Vazquez"
  with reason `footprint real 2663 > 1600 (2077 autorales + 586 generados); size-exception
  aceptada por maintainer…`. The reset is authorized — the size-exception gate is satisfied.
- Authored diff measured: 21 files, 2,653 insertions + 10 deletions (2,663 changed lines)
  = 17 authored + 2 generated + 2 SDD artifacts. Over the 1,120–1,560 forecast band
  (apply-progress documents 1.35×–1.88× over, driven by the integration suite + doc
  comments). No scope creep — the 21-file inventory matches D9 exactly.

---

## 8. Structured status / actionContext findings

- Store: `openspec`; change: `jobs-soft-delete`; `changeRoot: openspec/changes/jobs-soft-delete`.
- Planning artifacts (proposal, spec, design, tasks, apply-progress) all present on disk.
  Note: `design.md`, `proposal.md`, and `specs/` are **untracked** in git (only `tasks.md` +
  `apply-progress.md` are committed) — same situation as `jobs-reopen`; not a verify blocker.
- 7 commits on `main` ahead of `origin/main`:
  `cc9eb11` (Commit A) → `775066e` (Commit B) → `1fb5fdb` (Commit C) → `e39e35c`
  (Commit D) → `37ac7db` (docs 6.1) → `24099e2` (style gofmt) → `93fc17e` (docs 4.3).
  Commit map in apply-progress matches git exactly. HEAD = `93fc17e`.
- `actionContext.mode` is `workspace-planning` (apply phase); `allowedEditRoots` implicit —
  the repo is the authoritative workspace. No ownership/root ambiguity.

---

## 9. Deviations / warnings / observations

No CRITICAL findings and no blockers. Observations (non-blocking):

1. **Public-mount DELETE returns chi 405, not the literal 404 in S9.** The delta S9 (and the
   canonical "write route not reachable via public mount") says `404 not found`, but chi
   returns `405 Method Not Allowed` when the path (`/jobs/{id}`) is registered for GET but
   not DELETE. `TestSoftDeleteJob_DeleteNotServedByPublicMount` accepts 404 OR 405 and
   asserts the handler never ran (repo not called). This exactly mirrors the pre-existing
   `TestUpdateJob_PATCHNotServedByPublicMount` precedent (which documents the 405 nuance) —
   inherited spec wording, not a defect introduced by this delta.
2. **Live integration execution deferred.** The 13 integration tests are build-tagged and
   compile clean, but are not executed here (no `DATABASE_URL`); `make test-integration` is
   parent-owned. Consistent with the task's stated deferral.
3. **TDD evidence table naming.** apply-progress uses "Strict TDD evidence table" rather than
   the literal "TDD Cycle Evidence" title. Substance (RED + GREEN + status per task) is
   present and independently verified — not a blocker.
4. **Untracked planning artifacts.** `design.md` / `proposal.md` / `specs/` are not in git.
   Not a verify blocker, but the delta spec/design under validation are absent from history.

---

## 10. Exact blockers

None. The change is ready for `sdd-sync` (canonical spec sync) and archive. No code changes
required.
