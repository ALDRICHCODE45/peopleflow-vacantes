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
| 3.1 | jobRepository_softDelete_integration_test.go | n/a (build-tagged integration; deferred RED per `jobs-create` Phase 7) | Pending (Commit B) | Pending |
| 4.1 | softDeleteJobHandler_test.go | Pending | Pending | Pending |
| 4.2 | softDeleteJob handler + JobHandlers.SoftDeleteJob | Pending | Pending | Pending |
| 5.1 | main_test.go AST guard + deletePathLiteral | Pending | Pending | Pending |
| 5.2 | gated DELETE route in main.go | Pending | Pending | Pending |
| 6.1 | Full-suite verification gate | n/a | Pending | Pending |

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
- `cd backend && go vet ./...` → exit 0.
- `cd backend && gofmt -l internal/features/jobs/ db/queries/` → empty after `gofmt -w`.
- `cd backend && go test ./...` (full gate, pre-Commit-B) → all packages PASS.

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

## Deviations from tasks.md

None so far.

## Remaining tasks (verbatim unchecked lines from `tasks.md`)

- [ ] 3.1 RED/GREEN — Add the 13-test integration suite.
- [ ] 4.1 RED — Author `softDeleteJobHandler_test.go`.
- [ ] 4.2 GREEN — Implement `softDeleteJob` + `JobHandlers.SoftDeleteJob`.
- [ ] 5.1 RED — Add `TestJobsSoftDeleteRoute_MountedBehindGates` (and the `deletePathLiteral` helper).
- [ ] 5.2 GREEN — Add `r.With(requireAuth, requireRecruiter).Delete("/jobs/{id}", jobHandlers.SoftDeleteJob)`.
- [ ] 6.1 — Run the complete verification set.

## Workload / PR boundary

- Pre-flight accepted size-exception for `single-pr` delivery (the `jobs-reopen` precedent; do NOT auto-chain).
- Commit A holds the atomic port-extension unit; tree is intentionally compile-broken between 1.2 and 2.3 (accepted RED); the full-suite gate is deferred to 6.1.

## Structured status

- actionContext: workspace-planning (apply is the only phase that writes production code; allowedEditRoots implicit — the repo at `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes` is the authoritative workspace).
- nextRecommended: apply (this phase).
