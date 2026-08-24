# Verify Report: `jobs-write-side`

- **evidence_revision**: `dade41d580b9afc871c8bedfe512a58751f6f0584f652a532c990d7851126817` (sha256 of HEAD commit sha1-string `686428bfaa181b8561e64fcd2c8d17b6dbb8fcd1`)
- **verdict**: `pass_with_warnings`
- **requirements covered**: 9/9
- **scenarios**: 39/39
- **artifact store**: `openspec` (authoritative) — report persisted to `openspec/changes/jobs-write-side/verify-report.md`

---

## 1. Verdict summary

The `PATCH /jobs/{id}` write side is fully implemented and matches the delta spec across all 9 requirements and 39 scenarios. The full unit suite is green, `go build`, `go vet`, and `gofmt -l` are clean, and the jobs packages pass under `-race`. No CRITICAL issues and no unchecked implementation tasks remain.

Warnings are limited to: (a) strict-TDD RED→GREEN pairing is **attested** in `apply-progress.md` but not independently demonstrable from the git DAG (each work unit squashes test + production code into one commit); (b) the build-tagged integration suite could not be re-executed in this environment because `DATABASE_URL` is unset (it skips honestly; `apply-progress.md` reports 16/16 pass against real Postgres).

---

## 2. Spec coverage (9 requirements / 39 scenarios)

| # | Requirement | Scenarios | Status | Evidence |
|---|---|---|---|---|
| 1 | PATCH /jobs/{id} Endpoint and Gate | 5 | ✅ Covered | `main.go` `r.With(requireAuth, requireRecruiter).Patch("/jobs/{id}", …)`; handler `updateJob` reads `CompanyContext` fail-closed 500; `TestJobsWriteRoute_MountedBehindGates`, `TestUpdateJob_MissingCompanyContextReturns500`, `TestUpdateJob_BodyCompanyIDIgnored`, `TestUpdateJob_OwnerPassesRecruiterGate`, `TestUpdateJob_UnauthenticatedReturns401`; `RequireCompanyRole` non-member 403 covered by `identity/.../requireCompanyRole_test.go`. `MemberRole` ordinal (Recruiter=1 < Owner=2) satisfies owner≥recruiter. |
| 2 | Field Editability Matrix | 5 | ✅ Covered | `UpdateJobDto` partial semantics; `valueobjects.Optional[T]` tri-state; `buildUpdateJobParams` + D3 SQL `COALESCE`/`CASE WHEN set_<f>`; `TestUpdateJobDto_DropsImmutableFields`, `TestUpdateJob_NullVsAbsentOnLocation`, `TestEditJob_PatchCapturesNullVsAbsentLocation`, `TestUpdate_PartialPatchLeavesAbsentFieldsIntact`, `TestUpdate_NullLocationClears`, `TestUpdate_NullSalaryClears`. |
| 3 | Status Transition Table | 8 | ✅ Covered | `isTransitionAllowed` full 3×3 table; closed-terminal early branch; `UpdateJob` SQL `published_at = CASE WHEN status='published' THEN COALESCE(published_at, now()) …`; `TestIsTransitionAllowed_FullTable`, `TestEditJob_*` transition/terminal tests, `TestUpdate_DraftToPublishedSetsPublishedAt`, `TestUpdate_PublishedToClosedPreservesPublishedAt`, `TestUpdate_PublishedToPublishedPreservesPublishedAt`, `TestEditJob_StatusOnlyPatchReturns200`. |
| 4 | CAS Optimistic Concurrency | 5 | ✅ Covered | `EditJob` step 2 CAS compare vs `GetForUpdate` `UpdatedAt`; SQL `WHERE updated_at = cas_token`; `parseIfUnmodifiedSince` RFC 3339 → zero-time on missing/malformed; `TestEditJob_CAS*`, `TestUpdateJob_MissingCASReturns409`, `TestUpdateJob_CASMismatchReturns409`, `TestEditJob_UpdateZeroRowsReReadsConflict`, `TestUpdate_CASMismatchReturnsErrJobNotFound`. |
| 5 | Domain Validation Rules | 5 | ✅ Covered | `EditJob` title/description trim-empty, salary `min <= max`, VO `Parse*`; `TestEditJob_EmptyTitleRejected`, `TestEditJob_EmptyDescriptionRejected`, `TestEditJob_SalaryRangeRejected`, `TestEditJob_UnknownVOsRejected` (work_mode/employment_type/seniority/salary_currency/status). |
| 6 | Same-Company Invariant + IDOR | 3 | ✅ Covered | `GetJobForUpdate` SQL `WHERE company_id=$2 AND deleted_at IS NULL` (no visibility narrowing); `mapGetError` `pgx.ErrNoRows → ErrJobNotFound`; `TestGetForUpdate_CrossCompanyReturnsErrJobNotFound`, `TestGetForUpdate_SoftDeletedReturnsErrJobNotFound`, `TestGetForUpdate_NonExistentReturnsErrJobNotFound`, `TestUpdate_CrossCompanyUpdateAffectsZeroRows`, handler `TestUpdateJob_CrossCompanyReturns404`. |
| 7 | Editor Response DTO | 3 | ✅ Covered | `JobEditorViewDto` (separate from `SearchJobsItem`, adds `status`+`updated_at`+`company`); `toEditorView` single projection shared by 200/409; `SearchJobsItem` untouched; `TestUpdateJob_SuccessReturns200EditorView`, `TestUpdateJob_CASMismatchReturns409` (body decodes as editor view), read-side tests unchanged. |
| 8 | Write Route Security Boundary | 2 | ✅ Covered | Public `Routes()` mount has only GETs; gated PATCH on root router; `TestJobsMount_PublicReadRoutes`, `TestUpdateJob_PATCHNotServedByPublicMount`, `TestUpdateJob_UnauthenticatedReturns401`. |
| 9 | Error Taxonomy | 3 | ✅ Covered | `classifyError` flat `errors.Is` dispatch + `updateJob` 409-with-view special-case; `TestUpdateJob_InvalidJobIDReturns400`, `TestUpdateJob_MalformedBodyReturns400`, `TestUpdateJob_CrossCompanyReturns404`, `TestUpdateJob_CASMismatchReturns409`, `TestMapUpdateError_*`. |

All 39 scenarios map to a unit test, handler test, or build-tagged integration test (integration tests present but skipped in this run — see §6).

---

## 3. Task completion status

`openspec/changes/jobs-write-side/tasks.md`: **all implementation tasks are checked `[x]`.**

```
$ grep -nE "^\s*- \[ \]" openspec/changes/jobs-write-side/tasks.md
(none)
```

No unchecked `- [ ]` implementation task markers remain. Phases 1–7 (tasks 1.1–7.2) are all landed. Post-apply items are parent-owned (lifecycle gate), not implementation work.

---

## 4. Structured status & actionContext findings

- `artifactStore`: `openspec` (authoritative — no Engram mirroring per `openspec/config.yaml`).
- `changeName`: `jobs-write-side`.
- Required inputs read directly: delta spec, design, tasks, apply-progress, canonical read spec, config.
- `applyState`: `all_done` (every implementation task checked; no malformed ownership markers).
- `actionContext.mode`: `repo-local` (verify phase is READ-ONLY). No `workspace-planning` mode, so the `allowedEditRoots` requirement is not applicable to this phase.
- `nextRecommended`: **archive-ready** pending parent review resolution (see §10). No blockers.

---

## 5. Test / validation commands (exact, as run)

```
cd backend && go test ./... -count=1            → 27 packages ok, 0 FAIL
cd backend && go build ./...                    → exit 0 (no output)
cd backend && go vet ./...                      → exit 0 (no output)
cd backend && gofmt -l .                        → exit 0 (no output; empty)
cd backend && go test ./... -cover              → jobs total 84.1% statements (see §7)
cd backend && go test -race -count=1 ./internal/features/jobs/...   → all 8 jobs packages ok
cd backend && go test -tags=integration ./internal/features/jobs/infrastructure/postgres/ -count=1
    → unit tests run; integration tests SKIP (DATABASE_URL not set) — see §6
```

---

## 6. Integration suite status (honest skip)

`DATABASE_URL` is **unset** in this environment, so the build-tagged integration suite was not re-executed. Verification of the skip:

- File `backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go` carries `//go:build integration` and skips (never fails) when `DATABASE_URL` is unset (mirrors the read-path integration suite).
- Observed `--- SKIP:` lines for `TestJobsMigrationPublishedIntegrityGuard` and `TestJobsSeedInsertsThreeActiveCompaniesAndSixPublishedJobs` when run under `-tags=integration`; the write-path integration tests did not run.

`apply-progress.md` (Phase 7.1) reports 16/16 write-path integration tests pass against real Postgres, and documents one intentional assertion tightening (Postgres `now()` is transaction-time under rollback isolation). That live-DB green result is **attested, not independently re-verified here**. The SQL side effects (atomic `published_at`, CAS `WHERE updated_at = cas_token`, partial `SET`, same-company guard) were independently verified by code inspection of `db/queries/jobs.sql` + generated `internal/db/jobs.sql.go` + migration `00007_jobs.sql` (`jobs_published_integrity_check` present).

---

## 7. Coverage table

Config `coverage_threshold: 0` (bootstrap). Jobs-package aggregate from `go test -coverprofile` + `go tool cover -func`: **84.1% statements**.

| File / function | Statement % | Notes |
|---|---|---|
| `usecases/updateJob.go` — `EditJob` | 88.7% | 8-step flow; remaining lines are rare error-propagation branches |
| `usecases/updateJob.go` — `isTransitionAllowed` / `toEditorView` | 100% | |
| `usecases/updateJob.go` — `nilIfEmpty` / `trimmed` | 100% | dead/redundant helpers (see SUGGESTION-1) |
| `valueobjects/optional.go` — `UnmarshalJSON` | 100% | tri-state decode fully exercised |
| `valueobjects/optional.go` — `MarshalJSON` | 0% | unused by PATCH input path (see SUGGESTION-1) |
| `http/jobHandler.go` — `updateJob` | 100% | |
| `http/jobHandler.go` — `classifyError` | 46.2% | several 400 branches + 409 fallback not exercised (see WARNING-4) |
| `http/jobHandler.go` — `parseIfUnmodifiedSince` | 83.3% | |
| `postgres/jobRepository.go` — `buildUpdateJobParams` | 100% | |
| `postgres/jobRepository.go` — `toJobForUpdateEntity` | 81.2% | |
| `postgres/jobRepository.go` — `mapUpdateError` | 100% | |
| `postgres/jobRepository.go` — `GetForUpdate` / `Update` | 0% | DB-gated — covered only by (skipped) integration suite |
| `postgres/jobRepository.go` — VO→text wrappers | 66.7% | nil-branch untested per wrapper |
| `usecases/jobService.go` — `NewJobService` | 100% | |
| DTO / entity / repository port files | n/a (`[no statements]`) | struct + sentinel declarations only |

Package-level: `usecases` 93.4%, `valueobjects` 85.7%, `http` 89.4%, `postgres` 69.1%, `cursor` 96.3%.

---

## 8. Strict TDD compliance

Strict TDD is active (`openspec/config.yaml` `strict_tdd: true`). The project-local/global strict-TDD support guidance (`~/.pi/agent/gentle-ai/support/strict-tdd-verify.md`) was consulted.

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ⚠️ | `apply-progress.md` has a "Per-phase RED → GREEN evidence" section with `Task / RED proof / GREEN proof` columns — substantively present, but not the canonical "TDD Cycle Evidence" table (no TRIANGULATE / SAFETY NET / REFACTOR columns). |
| Test files exist for new production code | ✅ | `optional.go`, `updateJob.go`, `updateJobDto.go`, `jobEditorViewDto.go`, adapter helpers, handler write methods, integration SQL each have a matching `_test.go`. |
| RED confirmed (tests exist) | ⚠️ | RED is documented as compile-error ("undefined: X") per phase, which design §9 explicitly accepts. **However**, the git DAG squashes each work unit into a single commit (e.g. `9d15943` bundles `optional.go` + `optional_test.go`; `f747bb6` bundles `updateJob.go` + `updateJob_test.go`). There are no separate RED-only commits, so "RED preceded GREEN" is attested, not independently demonstrable from history. |
| GREEN confirmed (tests pass) | ✅ | Full suite green on re-execution (27 packages ok). |
| Triangulation | ✅ | Transition table 9/9 cells + terminal rule; CAS match/stale/zero-token; null vs absent vs value all distinctly asserted. |
| Safety net | ✅ | Pre-existing stub repairs (`handler_test.go`, `searchJobs_test.go`, `jobRepository_test.go`) kept the suite compiling; all prior tests still green. |
| Race | ✅ | `-race` green on all jobs packages. |

**TDD compliance**: substantively met; flagged as ⚠️ (WARNING) on RED-first verifiability and evidence-table format.

### Assertion quality

No tautologies, ghost loops, type-only-alone, smoke-only, or implementation-detail assertions found in the changed test files. Table-driven tests use named subtests. Assertions pin specific status codes, specific error sentinels, and specific captured patch field values.

Minor notes:
- `TestEditJob_UseCaseReceivesCompanyIDFromCaller` ends with `_ = bodyCompany` (a no-op "sanity" discard) — the meaningful assertions (`getForUpdateCompanyIDs[0] == callerCompany`, `lastUpdateCompany == callerCompany`) are present, but the discard itself asserts nothing. SUGGESTION.
- `TestUpdateJob_PATCHNotServedByPublicMount` asserts `404 || 405` (chi emits 405 Method Not Allowed for a known path with an unregistered method), which is a documented, honest accommodation of the spec's literal "404"; the critical invariant (`GetForUpdate` never called) is asserted. SUGGESTION.

**Assertion quality**: ✅ real behavior verified; no CRITICAL.

---

## 9. Review workload / PR boundary findings

- `tasks.md` forecast: chained PRs recommended, `Chain strategy: size-exception`, `Delivery strategy: single-pr`.
- `apply-progress.md` §"Delivery strategy honored" records `single-pr` with **`size:exception ACCEPTED`** (Engram `sdd/jobs-write-side/delivery #3934`, 2026-08-24). The size exception is explicitly recorded in the openspec artifact. ✅
- Implementation matches the assigned slice exactly; no scope creep beyond tasks 1.1–7.2 was observed (the only out-of-scope-adjacent items are two unused helpers inside `updateJob.go`, flagged as SUGGESTION-1 — not additional features).
- Commit-per-work-unit was followed (17 commits, conventional prefixes).

---

## 10. Issues found

### CRITICAL
None.

### WARNING

1. **Strict-TDD RED→GREEN not independently verifiable from git history.** Every work unit commits test + production code in one commit; there are no separate RED-only commits. `apply-progress.md` records RED proofs (compile errors), which design §9 explicitly accepts, but the RED state was never committed separately. The parent's "test files pre-date **or accompany** their production code" bar is met (tests accompany), so this is a process WARNING, not a completeness failure.

2. **Integration suite not re-run in this environment.** `DATABASE_URL` is unset; the 16 write-path integration tests skip (honestly). The DB-dependent behavior (atomic `published_at`, CAS `WHERE`, partial `SET`, same-company guard) is verified here only by code inspection + unit tests; the live-DB green result in `apply-progress.md` is attested, not re-verified.

3. **`classifyError` statement coverage 46.2%.** Several 400 branches (individual VO sentinels, the 409 "conflict" fallback) are not exercised. The 409 path is special-cased in `updateJob` before `classifyError`, so the `ErrConcurrencyConflict → 409 "conflict"` branch is a defensive fallback with no test. Informational only (threshold 0), but a coverage gap.

### SUGGESTION

1. **Dead/redundant code in `updateJob.go`.** `nilIfEmpty` and `trimmed` are only called from the initial `patch` literal, whose `Title`/`Description` are immediately overwritten by the subsequent `if in.Title != nil` / `if in.Description != nil` blocks. `nilIfEmpty`'s doc comment says "Currently unused" but it *is* called; `_ = patch` (step 6) is a no-op. `Optional.MarshalJSON` (0% coverage) is unused by the PATCH input path. Consider removing or repurposing.

2. **Closed-terminal check ordering.** `title`/`description` empty-validation runs before the `current.JobStatus == Closed` branch, so a closed row with `{"title":"   "}` returns 400 "title must not be empty" rather than "invalid status transition". HTTP status is still 400 and `Update` is never called (immutability preserved), so the core invariant holds; only message precedence deviates from design §4.3's "closed is terminal, rejects ANY body" intent.

3. **Spec vs chi 404/405 nuance.** `TestUpdateJob_PATCHNotServedByPublicMount` accepts `404 || 405` (chi returns 405 for a known path with an unregistered method). Reasonable and documented; the spec pins "404 not found". No action required unless strict message-level parity is desired.

4. **Route-boundary 401 test uses a test-local middleware.** `TestUpdateJob_UnauthenticatedReturns401` mounts a hand-rolled `identityRequireAuth`, not the production `identityhttp.RequireAuth`. Production middleware is covered by `identity/.../requireCompanyRole*_test.go`, and `TestJobsWriteRoute_MountedBehindGates` pins the production wiring via AST, so confidence is retained.

5. **Test-only `var _ = bytes.NewReader`** in `updateJobHandler_test.go` keeps an otherwise-unused `bytes` import alive. Minor lint smell.

---

## 11. Rollback note

No remediation is required for the warnings above. If the orchestrator chooses to act on any SUGGESTION, rollback remains trivial (revert the merge commit; no migration, no schema change, no new package; reverting `main.go` removes the PATCH route while reads keep working).

---

## 12. Next recommended action

`archive` (or bounded review of the flagged warnings first). No blockers: 9/9 requirements and 39/39 scenarios covered, full unit suite green, build/vet/gofmt/race clean, all implementation tasks checked, size-exception recorded. The three WARNINGs are process/coverage/attestation items, not completeness defects.
