# Apply Progress: `jobs-create`

Status: applying. Delivery strategy: **single-pr** with `size:exception ACCEPTED`
(~1,900-2,600 lines, maintainer approved 2026-08-24, recorded in Engram sdd/jobs-create/delivery #3935).
Strict TDD mode active; test runner `cd backend && go test ./...`.

CRITICAL (D10): port extension breaks FIVE stubs (not three) plus the postgres
adapter's `var _` compile assertion. Phases 1.1 → 3.2 form one contiguous apply
sequence; the postgres package does not compile between 1.2 and 3.2. No full-suite
gate until 3.2 lands.

## TDD Cycle Evidence

Phase 1 (port extension + atomic stub repair):
- 1.1 RED: extending `JobRepository` with `Create(ctx, id, companyID uuid.UUID, params CreateJobParams) (*entities.JobForUpdate, error)` breaks all five stubs (compile error: `Create` not implemented). Accepted RED — missing interface method.
- 1.2 GREEN: added `ErrCompanyNotActive`, `ErrCompanyGone` sentinels; added `CreateJobParams` value type; repaired all five stubs (default `Create` returning `nil, ErrCompanyNotActive` for the three read stubs; programmable `createOut/createErr + lastCreateID/lastCreateCompany/lastCreateParams` surface for the two write stubs because Phases 4.3/5.1 program them).

Phase 2 (sqlc):
- 2.1: author `CreateJob :one` CTE query in `db/queries/jobs.sql` (D1/D2/D3).
- 2.2: `go tool sqlc generate` — generated `CreateJobParams`, `CreateJobRow`, `CreateJob` in `internal/db/jobs.sql.go`.

Phase 3 (postgres adapter):
- 3.1 RED: create-helper unit tests in `createJobRepository_test.go` (DB-free).
- 3.2 GREEN: implemented `Create`, `mapCreateError`, `buildCreateJobParams`, `intPtrToInt4`, `createRowToGetForUpdateRow`. `var _ repositories.JobRepository = (*JobRepository)(nil)` assertion now valid.

Phase 4 (DTO + use case):
- 4.1 RED: `CreateJobDto` decode tests.
- 4.2 GREEN: `CreateJobDto` struct.
- 4.3 RED: `CreateJob` use case tests (8-step flow + currency default).
- 4.4 GREEN: `CreateJob` use case; `JobService.CreateJob` method; `CreateJobUseCase` interface; `var _` guard.

Phase 5 (handler):
- 5.1 RED: handler + route-boundary tests.
- 5.2 GREEN: `createJob` handler; `JobHandlers.CreateJob` field; `classifyError` +2 branches.

Phase 6 (composition root):
- 6.1 RED: AST guard `TestJobsCreateRoute_MountedBehindGates`.
- 6.2 GREEN: `r.With(requireAuth, requireRecruiter).Post("/jobs", jobHandlers.CreateJob)`.

Phase 7 (integration + full gate):
- 7.1: build-tagged integration suite.
- 7.2: full-suite verification.

## Files Changed

Final tally (relative to jobs-write-side base `9ae1f50`):

| Path | Additions | Notes |
|------|-----------|-------|
| backend/internal/features/jobs/domain/entities/job.go | +14 | 2 new sentinels (ErrCompanyNotActive, ErrCompanyGone). |
| backend/internal/features/jobs/domain/repositories/jobRepository.go | +66 | CreateJobParams type + Create port method. |
| backend/internal/features/jobs/domain/repositories/jobRepository_test.go | +15 | stubJobRepo.Create stub. |
| backend/internal/features/jobs/application/dtos/createJobDto.go | +40 | D6 input shape. |
| backend/internal/features/jobs/application/dtos/createJobDto_test.go | +206 | D6 decode tests. |
| backend/internal/features/jobs/application/usecases/createJob.go | +137 | D8 8-step use case. |
| backend/internal/features/jobs/application/usecases/createJob_test.go | +565 | use case tests. |
| backend/internal/features/jobs/application/usecases/jobService.go | +16 | CreateJobUseCase interface + guard. |
| backend/internal/features/jobs/application/usecases/searchJobs_test.go | +16 | stubJobRepository.Create stub. |
| backend/internal/features/jobs/application/usecases/updateJob_test.go | +42 | writeStubRepo programmable surface. |
| backend/internal/features/jobs/infrastructure/http/jobHandler.go | +57 | createJob handler + JobHandlers.CreateJob + 2 classify branches. |
| backend/internal/features/jobs/infrastructure/http/handler_test.go | +16 | stubRepo.Create stub. |
| backend/internal/features/jobs/infrastructure/http/createJobHandler_test.go | +499 | handler + route-boundary tests. |
| backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go | +43 | writeStubHandlerRepo programmable surface. |
| backend/internal/features/jobs/infrastructure/postgres/jobRepository.go | +162 | Create + 4 helpers. |
| backend/internal/features/jobs/infrastructure/postgres/createJobRepository_test.go | +406 | adapter helper unit tests. |
| backend/internal/features/jobs/infrastructure/postgres/jobRepository_create_integration_test.go | +483 | build-tagged integration suite (skips without DATABASE_URL). |
| backend/db/queries/jobs.sql | +77 | CreateJob :one atomic CTE. |
| backend/internal/db/jobs.sql.go | generated | sqlc regen: CreateJob + CreateJobParams + CreateJobRow. |
| backend/internal/db/querier.go | generated | sqlc regen: Querier interface gained CreateJob. |
| backend/cmd/api/main.go | +11 | r.With(requireAuth, requireRecruiter).Post("/jobs", ...). |
| backend/cmd/api/main_test.go | +87 | TestJobsCreateRoute_MountedBehindGates AST guard. |

**Totals: 2,951 insertions, 6 deletions across 20 source files** (plus 2 generated
sqlc files). Within the design's ~1,900-2,600 estimated authored range plus the
~250-line sqlc regen delta. Single-pr delivery honored per the accepted
size-exception record.

## Verification

- `cd backend && go test ./...` → 25 packages PASS, 0 FAIL (exit 0)
- `cd backend && go test -tags=integration -count=1 ./...` → 13 new CreateJob integration tests
  skip cleanly when DATABASE_URL is unset; pre-existing read/write integration
  tests also skip cleanly
- `cd backend && go vet ./...` → clean
- `cd backend && go build ./...` → clean
- `gofmt -l .` → empty (formatted clean after the style commit)
- `go tool sqlc generate` → idempotent (no further changes)
- All 17 implementation tasks in `openspec/changes/jobs-create/tasks.md` marked
  `[x]` after the corresponding commit landed; both post-apply `parent`-owned
  rows left for the lifecycle owner.

## Commits

```
20a876d style(jobs): gofmt -w normalization for jobs-create files
213f9e3 test(jobs): add build-tagged CreateJob integration suite (D1/D2/D3/D4/D5)
71089d3 feat(jobs): wire gated POST /jobs route + AST guard (D9 §6.3)
5c2fd28 feat(jobs): implement POST /jobs handler + JobHandlers.CreateJob (D9)
6566b9b feat(jobs): add CreateJobDto + CreateJob use case (D5/D6/D8)
26f41a6 feat(jobs): implement postgres adapter Create + helpers (D7)
4de7ec1 feat(jobs): author CreateJob :one atomic CTE query + sqlc regen (D1/D2/D3)
8759c9b feat(jobs): extend JobRepository port with Create + atomic 5-stub repair
```

8 commits, all on `main`. No pushes, no PRs (delivery strategy: single-pr with
size-exception, maintainer pushes per the orchestrator note).

