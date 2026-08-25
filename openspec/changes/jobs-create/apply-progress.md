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

(See commits for exact line counts per change.)

