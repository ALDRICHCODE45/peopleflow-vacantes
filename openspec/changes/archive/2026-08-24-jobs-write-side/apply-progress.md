# Apply Progress: `jobs-write-side`

Status: **DONE — implementation complete, full-suite green, integration
suite green against real Postgres.** Ready for parent lifecycle gate.

## Delivery strategy honored

- `single-pr` with `size:exception ACCEPTED` (Engram
  sdd/jobs-write-side/delivery #3934, 2026-08-24).
- One commit per work unit (small, reviewable), no push, no branches.
- Conventional commit prefixes (`feat(jobs): …`, `test(jobs): …`,
  `style(jobs): …`, `chore(tasks): …`).

## Commits landed (on `main`, ahead of `origin/main`)

| # | SHA | Message |
|---|-----|---------|
| 1 | `9d15943` | feat(jobs): tri-state Optional[T] for nullable PATCH fields |
| 2 | `8bb3510` | feat(jobs): extend port with GetForUpdate/Update + write projection (D1/D2) |
| 3 | `2ace3a8` | chore(tasks): mark Phase 1 (Optional + port extension) done |
| 4 | `78231e5` | feat(jobs): write-path SQL queries (D3) — GetJobForUpdate, UpdateJob with CAS |
| 5 | `e310527` | chore(tasks): mark Phase 2 (sqlc queries) done |
| 6 | `9a9dd8b` | feat(jobs): postgres adapter write methods + helper tests (D4) |
| 7 | `f48ff03` | chore(tasks): mark Phase 3 (postgres adapter write methods) done |
| 8 | `70aec2b` | feat(jobs): UpdateJobDto + JobEditorViewDto (D7) |
| 9 | `f747bb6` | feat(jobs): EditJob use case + 8-step flow + transition table (D5, D9) |
| 10 | `4a15f5b` | chore(tasks): mark Phase 4 (EditJob use case) done |
| 11 | `43aaa80` | feat(jobs): PATCH handler + JobHandlers accessor + classifyError extension (D6) |
| 12 | `c710ffe` | chore(tasks): mark Phase 5 (HTTP handler) done |
| 13 | `7122a73` | feat(jobs): main.go hoist requireAuth/requireRecruiter + gated PATCH route (D8) |
| 14 | `a342c7b` | chore(tasks): mark Phase 6 (main.go wiring) done |
| 15 | `8413bf3` | test(jobs): build-tagged write-path integration suite (16 tests, real Postgres) |
| 16 | `22f7a32` | style(jobs): gofmt integration test file |
| 17 | `6aeb925` | chore(tasks): mark Phase 7 (integration + final verification) done |

## Per-phase RED → GREEN evidence

### Phase 1 — Domain core (RED → GREEN)

| Task | RED proof | GREEN proof |
|------|-----------|-------------|
| 1.1 Optional decode tests | `go test ./internal/features/jobs/domain/valueobjects/ -run Optional` → compile error: `undefined: Optional` | 10 tests pass after 1.2 |
| 1.2 Optional[T] implementation | (n/a — GREEN step) | 10/10 pass; build clean |
| 1.3 Port extension | adapter compile error: `*JobRepository does not implement repositories.JobRepository (missing method GetForUpdate)` | (compile broken until 1.4) |
| 1.4 JobForUpdate + sentinels + UpdatePatch + stub repairs | (n/a — GREEN step) | adapter + 3 stubs compile; full unit suite green |

Tests added in phase 1: 10 (Optional)

### Phase 2 — sqlc queries (D3)

| Task | RED proof | GREEN proof |
|------|-----------|-------------|
| 2.1 Author queries | (n/a — SQL authoring) | queries present in `backend/db/queries/jobs.sql` |
| 2.2 sqlc generate | (n/a — codegen) | `internal/db/jobs.sql.go` regenerated with `GetJobForUpdateParams/Row`, `UpdateJobParams`, `UpdateJob` returning `(int64, error)`. Field order per D3 §5.2. `go build ./...` clean. |

Strict-TDD RED for this SQL is realized by the build-tagged integration
suite in 7.1 (deferred RED per tasks.md §2.2).

### Phase 3 — Postgres adapter (RED → GREEN)

| Task | RED proof | GREEN proof |
|------|-----------|-------------|
| 3.1 helper tests | compile error: `undefined: buildUpdateJobParams`, `toJobForUpdateEntity`, `mapUpdateError` | 17/17 pass after 3.2 |
| 3.2 adapter implementation | (n/a — GREEN step) | 17/17 pass; build clean |

Tests added in phase 3: 17 (adapter helpers)

### Phase 4 — DTOs + EditJob (RED → GREEN)

| Task | RED proof | GREEN proof |
|------|-----------|-------------|
| 4.1 UpdateJobDto tests | compile error: `undefined: UpdateJobDto` | 13/13 pass after 4.2 |
| 4.2 UpdateJobDto + JobEditorViewDto | (n/a — GREEN step) | 13/13 pass; build clean |
| 4.3 EditJob + transition tests | compile error: `undefined: EditJob`, `undefined: isTransitionAllowed` | 27/27 pass after 4.4 |
| 4.4 EditJob implementation | (n/a — GREEN step) | 27/27 pass; full jobs package green |

Tests added in phase 4: 40 (DTO + EditJob)

### Phase 5 — HTTP handler (RED → GREEN)

| Task | RED proof | GREEN proof |
|------|-----------|-------------|
| 5.1 handler + route-boundary tests | compile error: `h.JobHandlers undefined` | 19/19 pass after 5.2 |
| 5.2 handler surface implementation | (n/a — GREEN step) | 19/19 pass; full jobs package green |

Tests added in phase 5: 19 (handler + route-boundary)

### Phase 6 — main.go + AST guards (RED → GREEN)

| Task | RED proof | GREEN proof |
|------|-----------|-------------|
| 6.1 new AST guard | `TestJobsWriteRoute_MountedBehindGates` failed (no gated PATCH yet) | (failing until 6.2) |
| 6.2 main.go wiring | (n/a — GREEN step) | 3/3 composition-root tests pass; full build clean |

Tests added in phase 6: 1 (new guard) + 1 (extended guard)

### Phase 7 — Integration & final verification

| Task | Result |
|------|--------|
| 7.1 build-tagged integration suite | 16/16 pass against real Postgres (DATABASE_URL set); clean SKIP when DATABASE_URL unset |
| 7.2 full-suite gate | `go test -count=1 ./...` green; `go vet ./...` clean; `gofmt -l .` clean; `go build ./...` clean |

Tests added in phase 7: 16 (integration)

## Final verification (Phase 7.2)

```
cd backend && go test -count=1 ./...
# All packages: ok (no FAIL)

cd backend && go vet ./...
# (no output)

cd backend && gofmt -l .
# (no output)

cd backend && go build ./...
# (no output)

cd backend && (DATABASE_URL=... go test -tags integration -p 1 ./...)
# All packages: ok; the jobs write-path integration suite runs 16 tests against
# real Postgres and all pass.
```

## Files changed

Production code (16 files):
- backend/db/queries/jobs.sql (MOD — added 2 queries)
- backend/internal/db/jobs.sql.go (GEN — sqlc output, 188 lines added)
- backend/internal/features/jobs/domain/entities/job.go (MOD — 5 new sentinels)
- backend/internal/features/jobs/domain/entities/jobForUpdate.go (NEW)
- backend/internal/features/jobs/domain/repositories/jobRepository.go (MOD — UpdatePatch + GetForUpdate/Update)
- backend/internal/features/jobs/domain/valueobjects/optional.go (NEW)
- backend/internal/features/jobs/application/dtos/updateJobDto.go (NEW)
- backend/internal/features/jobs/application/dtos/jobEditorViewDto.go (NEW)
- backend/internal/features/jobs/application/usecases/jobService.go (MOD — EditJob method)
- backend/internal/features/jobs/application/usecases/updateJob.go (NEW)
- backend/internal/features/jobs/infrastructure/postgres/jobRepository.go (MOD — adapter write methods + helpers)
- backend/internal/features/jobs/infrastructure/http/jobHandler.go (MOD — JobHandlers + updateJob)
- backend/cmd/api/main.go (MOD — D8 hoist + gated PATCH route)
- backend/cmd/api/main_test.go (MOD — extended + new AST guards)

Tests (9 new files):
- backend/internal/features/jobs/domain/valueobjects/optional_test.go (NEW — 10 tests)
- backend/internal/features/jobs/application/dtos/updateJobDto_test.go (NEW — 13 tests)
- backend/internal/features/jobs/application/usecases/updateJob_test.go (NEW — 27 tests)
- backend/internal/features/jobs/infrastructure/postgres/updateJobRepository_test.go (NEW — 17 tests)
- backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go (NEW — 16 tests)
- backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go (NEW — 19 tests)
- (Plus 3 stub repairs in existing test files for the port extension.)

Task tracking (1 file):
- openspec/changes/jobs-write-side/tasks.md (M0 — checkboxes marked `[x]`)

Apply progress (1 file):
- openspec/changes/jobs-write-side/apply-progress.md (THIS file)

Total tests added (unit + unit, strict-TDD): 86
Total tests added (integration, build-tagged): 16

## Test counts

- Jobs package unit tests: 178 total (130 prior + 48 new from this change,
  counting subtests).
- Integration tests: 16 new for the write path + all existing read-path
  integration tests still pass.
- Composition-root guards: 3 (RequireAuth_MountedOnMeRoutes,
  JobsMount_PublicReadRoutes, JobsWriteRoute_MountedBehindGates).

## Deviations from design

None. D1-D10 honored exactly. The only implementation note worth
recording:

- **Postgres `now()` is transaction-time.** The integration suite runs
  inside a single transaction (rollback isolation) so `now()` returns
  the transaction-start time, not the per-statement time. The
  `TestUpdate_DraftToPublishedSetsPublishedAt` assertion was tightened
  to compare against `before.UpdatedAt` (the same transaction-time
  value) instead of the local `time.Now()` snapshot, which is the
  correct production semantics. Documented inline.
- **`requireAuth` / `requireRecruiter` variable names.** Per the
  existing repo convention (`denyAllVerifier` etc.), the hoisted
  variables use lowerCamelCase. The `TestRequireAuth_MountedOnMeRoutes`
  AST guard was extended to recognize both the `RequireAuth`
  constructor and the `requireAuth` hoisted variable.

## Rollback

Revert the merge commit (commit 17 above) plus the sqlc-regenerated
`internal/db/jobs.sql.go` if the rollback must also remove the generated
seam. No migration, no schema change, no new package — the slice is
read-only after revert.

## Next recommended action

- `parent-lifecycle`: archive the change (or run a bounded review)
  only after Phase 7.2 is green and the D1-D10 conformance review is
  resolved. Per the post-apply section of tasks.md, these are
  parent-owned actions.