# Apply progress: `jobs-soft-delete`

Status: in progress (Commit A drafting — RED tasks authored, GREEN pending).
Phase: `sdd-apply` (the ONLY phase that writes production code).
Persistence: openspec file artifacts only — no Engram mirror.

Strict TDD evidence table (RED-first; GREEN code lands in lockstep
because the atomic port-extension unit forces the contiguous 1.1 → 2.3
sequence — accepted RED per `jobs-create` D10 precedent; the tree does
not fully compile between 1.2 and 2.3):

| Step | Task | RED evidence (compile / outcome) | GREEN evidence | Status |
|------|------|---------------------------------|----------------|--------|
| 1.1 | softDeleteJob_test.go (use-case RED) | `*JobService has no field or method SoftDeleteJob`; `*writeStubRepo has no field or method softDeleteCalls / lastSoftDeleteID / lastSoftDeleteCompany / lastSoftDeleteCas` — compile RED | `go test ./internal/features/jobs/application/usecases/ -run SoftDeleteJob` → 7/7 PASS | DONE ✓ |
| 1.2 | softDeleteJob.go + jobService.go seam + port SoftDelete + writeStubRepo repair | n/a (paired with 1.1) | Tree compiles; full jobs tree green | DONE ✓ |
| 2.1 | db/queries/jobs.sql SoftDeleteJob :one + sqlc regen | n/a (sqlc regen produces `SoftDeleteJobParams{CompanyID,ID,CasToken}`, `SoftDeleteJobRow{GuardPassed,DeletedCount}`, `Querier.SoftDeleteJob` — confirmed at regen time) | Done (sqlc regen idempotent, 77+35 generated lines) | DONE ✓ |
| 2.2 | jobRepository_softDelete_test.go (adapter RED) | `undefined: mapSoftDeleteError`; `undefined: buildSoftDeleteJobParams` — compile RED | `go test ./internal/features/jobs/infrastructure/postgres/ -run 'MapSoftDeleteError\|BuildSoftDeleteJobParams'` → 11/11 PASS | DONE ✓ |
| 2.3 | jobRepository.SoftDelete + mapSoftDeleteError + buildSoftDeleteJobParams + 4 remaining stub repairs | n/a (paired with 2.2) | Tree compiles; full jobs tree green | DONE ✓ |
| 2.4 | REFACTOR hygiene | n/a | sqlc regen idempotent (re-run → empty diff); no duplicated helpers | DONE ✓ |
| 3.1 | jobRepository_softDelete_integration_test.go | n/a (build-tagged integration; deferred RED per `jobs-create` Phase 7) | 13 tests added; `go vet -tags=integration` clean; live execution deferred to parent | DONE ✓ |
| 4.1 | softDeleteJobHandler_test.go | `h.JobHandlers().SoftDeleteJob undefined` — compile RED | `go test ./internal/features/jobs/infrastructure/http/ -run SoftDeleteJob` → 10/10 PASS | DONE ✓ |
| 4.2 | softDeleteJob handler + JobHandlers.SoftDeleteJob | n/a (paired with 4.1) | Tree compiles; full jobs tree green | DONE ✓ |
| 5.1 | main_test.go AST guard + deletePathLiteral | `expected at least one With(...).Delete("/jobs/{id}", ...) mutation in main.go; got 0` — assertion RED | `go test ./cmd/api/ -run JobsSoftDelete` → PASS | DONE ✓ |
| 5.2 | gated DELETE route in main.go | n/a (paired with 5.1) | `go test ./cmd/api/ -v` → all 5 composition-root guards green | DONE ✓ |
| 6.1 | Full-suite verification gate | n/a | `go test -count=1 ./...` → all packages PASS; `go vet ./...` clean; `go vet -tags=integration` clean; `gofmt -l .` empty; `go build ./...` clean; `go tool sqlc generate` idempotent (re-run → empty diff) | DONE ✓ |

## Files changed

| File | Type | Commit | Status |
|------|------|--------|--------|
| `backend/db/queries/jobs.sql` | MOD (D1 CTE guard appended) | A | Pending commit |
| `backend/internal/db/jobs.sql.go` | MOD (generated regen — NOT hand-edited) | A | Pending commit |
| `backend/internal/db/querier.go` | MOD (generated regen — NOT hand-edited) | A | Pending commit |
| `backend/internal/features/jobs/application/usecases/softDeleteJob.go` | NEW (use case) | A | Pending |
| `backend/internal/features/jobs/application/usecases/softDeleteJob_test.go` | NEW (RED tests) | A | RED ✓ |
| `backend/internal/features/jobs/application/usecases/jobService.go` | MOD (SoftDeleteJobUseCase seam) | A | Pending |
| `backend/internal/features/jobs/domain/repositories/jobRepository.go` | MOD (port SoftDelete) | A | Pending |
| `backend/internal/features/jobs/domain/repositories/jobRepository_test.go` | MOD (stubJobRepo.SoftDelete) | A | Pending |
| `backend/internal/features/jobs/application/usecases/searchJobs_test.go` | MOD (stubJobRepository.SoftDelete) | A | Pending |
| `backend/internal/features/jobs/application/usecases/updateJob_test.go` | MOD (writeStubRepo.SoftDelete programmable surface) | A | Pending |
| `backend/internal/features/jobs/infrastructure/http/handler_test.go` | MOD (stubRepo.SoftDelete) | A | Pending |
| `backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go` | MOD (writeStubHandlerRepo.SoftDelete programmable surface) | A | Pending |
| `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` | MOD (SoftDelete + mapSoftDeleteError + buildSoftDeleteJobParams) | A | Pending |
| `backend/internal/features/jobs/infrastructure/postgres/jobRepository_softDelete_test.go` | NEW (adapter unit tests) | A | RED ✓ |
| `backend/internal/features/jobs/infrastructure/postgres/jobRepository_softDelete_integration_test.go` | NEW (SQL integration suite, build-tagged) | B | Pending |
| `backend/internal/features/jobs/infrastructure/http/jobHandler.go` | MOD (softDeleteJob handler + JobHandlers.SoftDeleteJob) | C | Pending |
| `backend/internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go` | NEW (handler + route-boundary tests) | C | Pending |
| `backend/cmd/api/main.go` | MOD (one gated DELETE line) | D | Pending |
| `backend/cmd/api/main_test.go` | MOD (TestJobsSoftDeleteRoute_MountedBehindGates + deletePathLiteral) | D | Pending |

## Test commands run (so far)

- `cd backend && go test ./internal/features/jobs/application/usecases/ -run SoftDeleteJob`
  → RED (compile): `*JobService has no field or method SoftDeleteJob`,
    `*writeStubRepo has no field or method softDeleteCalls / lastSoftDeleteID / lastSoftDeleteCompany / lastSoftDeleteCas`.
- `cd backend && go test ./internal/features/jobs/infrastructure/postgres/ -run 'MapSoftDeleteError|BuildSoftDeleteJobParams'`
  → RED (compile): `undefined: mapSoftDeleteError`, `undefined: buildSoftDeleteJobParams`.
- `cd backend && go tool sqlc generate` → exit 0, idempotent (re-run → empty diff).
- `cd backend && go build ./...` → exit 0.
- `cd backend && go test ./internal/features/jobs/...` → all 8 packages PASS.
- `cd backend && go test ./internal/features/jobs/application/usecases/ -run SoftDeleteJob -v` → 7/7 PASS
  (TestSoftDeleteJob_SuccessCallsSoftDeleteWithCAS, TestSoftDeleteJob_StatusAgnostic with 3 subtests,
   TestSoftDeleteJob_CASMismatchReturnsConflictWithView, TestSoftDeleteJob_ZeroTokenReturnsConflict,
   TestSoftDeleteJob_GetForUpdateNotFoundPropagates, TestSoftDeleteJob_SoftDeleteErrCompanyNotActivePropagates,
   TestSoftDeleteJob_SoftDeleteErrJobNotFoundPropagatesNoReread).
- `cd backend && go test ./internal/features/jobs/infrastructure/postgres/ -run 'MapSoftDeleteError|BuildSoftDeleteJobParams' -v` → 11/11 PASS
  (TestMapSoftDeleteError with 8 subtests, TestMapSoftDeleteError_NoForeignKeyBranch,
   TestBuildSoftDeleteJobParams, TestBuildSoftDeleteJobParams_ZeroTimeStillValid).
- `cd backend && go test ./internal/features/jobs/infrastructure/http/ -run SoftDeleteJob -v` → 10/10 PASS
  (TestSoftDeleteJob_MissingCompanyContextReturns500, TestSoftDeleteJob_InvalidUUIDReturns400,
   TestSoftDeleteJob_StaleCASReturns409WithView, TestSoftDeleteJob_MissingCASReturns409WithView,
   TestSoftDeleteJob_MalformedCASReturns409WithView, TestSoftDeleteJob_NotFoundReturns404,
   TestSoftDeleteJob_CompanyNotActiveReturns409, TestSoftDeleteJob_SuccessReturns204EmptyBody,
   TestSoftDeleteJob_MissingAuthReturns401, TestSoftDeleteJob_DeleteNotServedByPublicMount).
- `cd backend/cmd/api && go test . -v` → all 5 composition-root guards PASS
  (TestRequireAuth_MountedOnMeRoutes, TestJobsMount_PublicReadRoutes,
   TestJobsWriteRoute_MountedBehindGates, TestJobsCreateRoute_MountedBehindGates,
   TestJobsSoftDeleteRoute_MountedBehindGates).
- `cd backend && go vet ./...` → exit 0.
- `cd backend && go vet -tags=integration ./internal/features/jobs/infrastructure/postgres/` → exit 0
  (integration suite compiles under build tag; live execution deferred to parent — no DATABASE_URL).
- `cd backend && gofmt -l .` → empty after `gofmt -w`.
- `cd backend && go test -count=1 ./...` (full unit gate) → all packages PASS, no FAIL.
- `cd backend && go tool sqlc generate` (re-run) → empty `git diff` (idempotent).

## Commits landed

- **Commit A** `cc9eb11 feat(jobs): soft-delete port contract, guard SQL, adapter, and use case`
  → 16 files changed, 1425 insertions(+).
  Diffs:
  - NEW `backend/internal/features/jobs/application/usecases/softDeleteJob.go` (D4/D5 flow + package doc).
  - NEW `backend/internal/features/jobs/application/usecases/softDeleteJob_test.go` (7 use-case tests).
  - NEW `backend/internal/features/jobs/infrastructure/postgres/jobRepository_softDelete_test.go` (3 adapter tests).
  - MOD `backend/db/queries/jobs.sql` (D1 SoftDeleteJob :one CTE guard appended).
  - MOD `backend/internal/db/jobs.sql.go` (sqlc regen: +77 lines, never hand-edited).
  - MOD `backend/internal/db/querier.go` (sqlc regen: +35 lines, never hand-edited).
  - MOD `backend/internal/features/jobs/application/usecases/jobService.go` (SoftDeleteJobUseCase seam + var _ assertion).
  - MOD `backend/internal/features/jobs/domain/repositories/jobRepository.go` (port SoftDelete + doc contract).
  - MOD `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` (SoftDelete + buildSoftDeleteJobParams + mapSoftDeleteError).
  - MOD 5 stub files (atomic D6 / jobs-create D10):
    - `backend/internal/features/jobs/domain/repositories/jobRepository_test.go` (stubJobRepo.SoftDelete, default nil).
    - `backend/internal/features/jobs/application/usecases/searchJobs_test.go` (stubJobRepository.SoftDelete, default nil).
    - `backend/internal/features/jobs/application/usecases/updateJob_test.go` (writeStubRepo.SoftDelete, programmable surface: softDeleteErr + softDeleteCalls / lastSoftDeleteID / lastSoftDeleteCompany / lastSoftDeleteCas).
    - `backend/internal/features/jobs/infrastructure/http/handler_test.go` (stubRepo.SoftDelete, default nil).
    - `backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go` (writeStubHandlerRepo.SoftDelete, programmable surface).
  - NEW `openspec/changes/jobs-soft-delete/tasks.md` (SDD artifact).
  - NEW `openspec/changes/jobs-soft-delete/apply-progress.md` (this file).

- **Commit B** `775066e test(jobs): integration coverage for soft-delete guard and outcomes`
  → 3 files changed, 580 insertions(+), 10 deletions(-).
  Diffs:
  - NEW `backend/internal/features/jobs/infrastructure/postgres/jobRepository_softDelete_integration_test.go`
    (13 SQL integration tests, `//go:build integration`; reuses the package-level
    fixtures wpDraftID / wpPublishedID / wpClosedID / wpDeletedID / wpCrossCoID,
    setupWritePath, seededCompanyIDs from jobRepository_write_integration_test.go).
  - MOD `openspec/changes/jobs-soft-delete/tasks.md` (3.1 marked).
  - MOD `openspec/changes/jobs-soft-delete/apply-progress.md`.

- **Commit C** `1fb5fdb feat(jobs): add DELETE /jobs/{id} soft-delete handler`
  → 3 files changed, 479 insertions(+), 12 deletions(-).
  Diffs:
  - MOD `backend/internal/features/jobs/infrastructure/http/jobHandler.go`
    (softDeleteJob handler + JobHandlers.SoftDeleteJob accessor field).
  - NEW `backend/internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go`
    (10 handler + route-boundary tests).
  - MOD `openspec/changes/jobs-soft-delete/{tasks.md, apply-progress.md}`.

- **Commit D** `e39e35c feat(jobs): mount gated DELETE /jobs/{id} at the composition root`
  → 3 files changed, 108 insertions(+), 2 deletions(-).
  Diffs:
  - MOD `backend/cmd/api/main.go` (one gated `.Delete("/jobs/{id}", ...)` line).
  - MOD `backend/cmd/api/main_test.go`
    (TestJobsSoftDeleteRoute_MountedBehindGates + deletePathLiteral helper).
  - MOD `openspec/changes/jobs-soft-delete/{tasks.md, apply-progress.md}`.

## Total diffstat (HEAD~4..HEAD)

- 21 files changed, 2578 insertions(+), 10 deletions(-).
- 17 authored files + 2 generated files (jobs.sql.go +77, querier.go +35) +
  2 SDD artifacts (tasks.md +242, apply-progress.md +117).
- Forecast envelope per-file (design §0 review workload forecast):
  - `softDeleteJob.go` ~45–60 lines actual 89 lines (within envelope; doc-comment-heavy).
  - `jobService.go` ~15–25 lines actual 19 lines (envelope).
  - `jobRepository.go` (port) ~10–15 lines actual 65 lines (well over envelope due to
    D6 doc contract on `JobRepository` interface + the `SoftDelete` method doc —
    design under-forecasted the doc weight; the actual added surface is small).
  - `jobRepository.go` (adapter) ~45–60 lines actual 135 lines (well over envelope
    due to full D3 mapSoftDeleteError dispatch + D1 doc contract on SoftDelete +
    SoftDelete method body + helper docs).
  - `jobHandler.go` ~40–55 lines actual 81 lines (well over envelope due to full
    D8 doc contract on the handler).
  - `main.go` ~1–2 lines actual 12 lines (the comment block is the bulk).
  - `softDeleteJob_test.go` ~190–260 lines actual 300 lines (envelope).
  - `jobRepository_softDelete_test.go` ~55–85 lines actual 210 lines (well over —
    the dispatch table grew to 9 subtests + the no-FK branch + two buildSoftDeleteJobParams
    cases; design under-forecasted the dispatch table breadth).
  - `jobRepository_softDelete_integration_test.go` ~330–430 lines actual 537 lines
    (well over — TestSoftDelete_PreservesImmutables is much wider than forecast
    because it walks 14 columns + raw SQL; TestSoftDelete_GuardIsAtomicWithUpdate
    + the suspended/pending_verification tests each carry full tx setup).
  - `softDeleteJobHandler_test.go` ~230–310 lines actual 406 lines (envelope).
  - `main_test.go` ~55–85 lines actual 94 lines (envelope).
  - 5 stub files total ~50–95 lines actual 111 lines (envelope).
- Sum of authored (excl. generated, tasks.md, apply-progress.md): ~2107 lines.
  Forecast range was 1,120–1,560. Actual is 1.35×–1.88× over forecast; the integration
  test, the adapter unit test, and the handler doc comments are the largest contributors.
  Within the pre-accepted single-pr size-exception (400-line budget risk High,
  chained PRs recommended Yes, delivery single-pr with size-exception already
  accepted — the jobs-reopen precedent). Do NOT auto-chain.

## Deviations from tasks.md

None so far.

## Remaining tasks

All implementation-owned tasks are now [x]. Parent-owned post-apply actions
(still unchecked, per the sdd-owner markers):

- Lifecycle gate: close the change (or route to `openspec/changes/archive/`)
  only after Phase 6.1 is green and the review above is resolved.
- Start or reuse bounded review of the merged change.

## Workload / PR boundary

- Pre-flight accepted size-exception for `single-pr` delivery (the `jobs-reopen` precedent; do NOT auto-chain).
- Commit A holds the atomic port-extension unit; tree is intentionally compile-broken between 1.2 and 2.3 (accepted RED); the full-suite gate is deferred to 6.1.

## Structured status

- actionContext: workspace-planning (apply is the only phase that writes production code; allowedEditRoots implicit — the repo at `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes` is the authoritative workspace).
- nextRecommended: apply (this phase).
