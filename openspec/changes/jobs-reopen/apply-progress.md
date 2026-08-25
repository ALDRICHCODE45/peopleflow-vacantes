# Apply Progress: `jobs-reopen`

Status: apply (Phase 7). Strict TDD (`strict_tdd: true`).
Test runner: `cd backend && go test ./...`. Reference slice: `jobs-create` (archived).
Native store: openspec (file artifacts under `openspec/changes/jobs-reopen/`).

Delivery: single-pr with `size:exception` (user accepted the 400-line review
budget risk; forecast High; tasks already split into autonomous work-unit
commits so either delivery path proceeds). D1–D8 are pinned and MUST NOT be
re-opened; D8 inventory held: 4 authored files + 2 generated files. No
`cmd/api/main.go`, DTO, handler, port, domain sentinel, or migration changes.

## Work-unit commit map

| Commit | Tasks | Files (MOD = authored, GEN = sqlc-regenerated) |
|---|---|---|
| A | 1.1 RED (narrow + flip matrix), 1.2 RED, 1.3 RED, 1.4 RED, 1.5 RED, 1.6 GREEN | MOD: `backend/internal/features/jobs/application/usecases/updateJob.go`, `backend/internal/features/jobs/application/usecases/updateJob_test.go` |
| B | 2.1 RED (mapUpdateError), 2.2 RED (compile — `jobs.sql` + sqlc regen), 2.3 GREEN (Update + mapUpdateError ErrNoRows branch) — ATOMIC | MOD: `backend/db/queries/jobs.sql`, `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go`, `backend/internal/features/jobs/infrastructure/postgres/updateJobRepository_test.go`; GEN: `backend/internal/db/jobs.sql.go`, `backend/internal/db/querier.go` |
| C | 3.1, 3.2, 3.3, 3.4 — SQL-level integration tests (build-tagged `//go:build integration`) | MOD: `backend/internal/features/jobs/infrastructure/postgres/jobRepository_write_integration_test.go` |

Optional commit D (5.1 — comment-only sentinel doc refresh on
`entities.ErrInvalidStatusTransition`) is documented in tasks but skipped:
D8 inventory marks `domain/entities/job.go` as UNCHANGED, so per the
locked scope the apply agent honors that and leaves the file alone.

---

## Commit A — `feat(jobs): allow re-opening closed jobs via explicit status transition`

**Files changed:**
- `backend/internal/features/jobs/application/usecases/updateJob.go` (D4 case + D5 bypass + doc refresh)
- `backend/internal/features/jobs/application/usecases/updateJob_test.go` (extended FullTable + 7 new tests + 2 renamed/narrowed tests)

**TDD evidence (focused runs):**

RED before GREEN:
```
=== RUN   TestIsTransitionAllowed_FullTable
    updateJob_test.go:221: isTransitionAllowed(closed, draft): want true, got false
    updateJob_test.go:221: isTransitionAllowed(closed, published): want true, got false
--- FAIL: TestIsTransitionAllowed_FullTable (0.00s)
=== RUN   TestEditJob_ClosedToDraftReopens
    updateJob_test.go:885: EditJob: want nil on closed->draft re-open, got invalid status transition
--- FAIL: TestEditJob_ClosedToDraftReopens (0.00s)
=== RUN   TestEditJob_ClosedToPublishedReopens
    updateJob_test.go:927: EditJob: want nil on closed->published re-open, got invalid status transition
--- FAIL: TestEditJob_ClosedToPublishedReopens (0.00s)
=== RUN   TestEditJob_ClosedToDraftWithTitleApplies
    updateJob_test.go:1003: EditJob: want nil on atomic closed->draft+title, got invalid status transition
--- FAIL: TestEditJob_ClosedToDraftWithTitleApplies (0.00s)
=== RUN   TestEditJob_ClosedToPublishedWithDescriptionApplies
    updateJob_test.go:1040: EditJob: want nil on atomic closed->published+description, got invalid status transition
--- FAIL: TestEditJob_ClosedToPublishedWithDescriptionApplies (0.00s)
=== RUN   TestEditJob_UpdateErrCompanyNotActivePropagates
    updateJob_test.go:1111: err: want ErrCompanyNotActive, got invalid status transition
--- FAIL: TestEditJob_UpdateErrCompanyNotActivePropagates (0.00s)
FAIL
FAIL    github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases       0.004s
```

Pre-existing tests that already passed and stayed green after the change
(proves D4/D5 don't relax anything else):
```
PASS: TestIsTransitionAllowed_UnknownStatusDefaultsFor           (default branch kept — D4)
PASS: TestEditJob_ClosedFieldOnlyRejects                        (S8 — was TestEditJob_ClosedTerminalAnyBodyRejects, narrowed)
PASS: TestEditJob_ClosedToClosedRejects                         (S4 — was TestEditJob_ClosedTerminalStatusAnyRejected, rewritten)
PASS: TestEditJob_DraftToClosedRejected                         (S22 — regression net)
PASS: TestEditJob_PublishedToDraftRejected                      (S21 — regression net)
PASS: TestEditJob_ClosedStatusAbsentLeavesClosed                (S9 — new)
PASS: TestEditJob_ClosedReopenStaleCASReturnsConflict           (S14 — new; CAS step precedes transition step)
PASS: TestEditJob_UnknownVOsRejected (5 sub-cases)              (regression net)
PASS: TestEditJob_StatusOnlyPatchReturns200                     (S23 — regression net)
PASS: TestEditJob_PatchCapturesNullVsAbsentLocation (3 sub)     (regression net)
```

GREEN after D4 + D5:
```
ok      github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases       0.004s
```

Full suite after Commit A:
```
ok      github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases       0.004s
ok      github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres      (cached)
ok      github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http           0.005s
... (every package green) ...
```

`go vet ./...` clean. `gofmt -l` on touched files: empty.

**Rollback boundary:** revert Commit A. `updateJob.go` restores the
unconditional `if current.JobStatus == Closed { return ErrInvalidStatusTransition }`
plus the original two-case transition table; `updateJob_test.go` restores
the original `TestIsTransitionAllowed_FullTable` and the two obsolete
closed-terminal tests.

**Decisions honored:** D4 (explicit `case valueobjects.Closed`, `default: return false` kept),
D5 (`reopens := newStatus != nil && (*newStatus == Draft || *newStatus == Published)`).
No D8 inventory drift (only `updateJob.go` + its test file).

---

## Commit B — `feat(jobs): gate PATCH updates on company activity via atomic UpdateJob guard`

**Files changed:**
- `backend/db/queries/jobs.sql` (D1 `:one` + CTE guard + scalar SELECT)
- `backend/internal/features/jobs/infrastructure/postgres/jobRepository.go` (D2 Update + ErrNoRows branch in mapUpdateError)
- `backend/internal/features/jobs/infrastructure/postgres/updateJobRepository_test.go` (2 new mapUpdateError cases)
- `backend/internal/db/jobs.sql.go` (regen — `UpdateJobRow { GuardPassed bool; UpdatedCount int64 }`)
- `backend/internal/db/querier.go` (regen — `UpdateJob` signature `(UpdateJobRow, error)`)

**TDD evidence (focused runs):**

RED for 2.1 — before 2.3 GREEN:
```
=== RUN   TestMapUpdateError_ErrNoRowsMapsToErrCompanyNotActive
    updateJobRepository_test.go:418: want ErrCompanyNotActive, got no rows in result set
--- FAIL: TestMapUpdateError_ErrNoRowsMapsToErrCompanyNotActive (0.00s)
=== RUN   TestMapUpdateError_WrappedErrNoRowsStillMaps
    updateJobRepository_test.go:429: want ErrCompanyNotActive, got driver: no rows in result set
--- FAIL: TestMapUpdateError_WrappedErrNoRowsStillMaps (0.00s)
```

RED (compile) for 2.2 — after jobs.sql + sqlc regen, BEFORE 2.3:
```
internal/features/jobs/infrastructure/postgres/jobRepository.go:147:13: invalid operation: rows == 0 (mismatched types db.UpdateJobRow and untyped int)
```
The accepted RED compile break (design §6 item 8); the adapter `Update` no longer compiles against the new `(UpdateJobRow, error)` signature. `UpdateJobParams` is unchanged; only `UpdateJob`'s return type changed.

GREEN after 2.3 — Update inspects `GuardPassed` + `UpdatedCount`; mapUpdateError adds the ErrNoRows defense branch:
```
ok      github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres       0.003s
```

Pre-existing mapUpdateError tests that stay green (proves 2.3 doesn't regress the existing behavior):
```
PASS: TestMapUpdateError_NilReturnsNil
PASS: TestMapUpdateError_CheckViolationMapsToErrInvalidStatusTransition
PASS: TestMapUpdateError_WrappedPgErrorStillMaps
PASS: TestMapUpdateError_UnknownPgCodePassesThrough
PASS: TestMapUpdateError_NonPgErrorPassesThrough
```

Full suite after Commit B: every package green (no test files in `industries/infrastructure/http` and `shared/httpjson` are expected — pre-existing).
`go vet ./...` clean. `gofmt -l` on touched Go files: empty. `go tool sqlc generate` second run → no diff (idempotent — design D7).

**Rollback boundary:** revert Commit B. `jobs.sql` restores the pre-guard `:execrows` UPDATE; the two generated files revert to the pre-guard `int64` return; `jobRepository.go`'s `Update` reverts to `rows == 0 → ErrJobNotFound`; `mapUpdateError` loses the ErrNoRows defense branch.

**Decisions honored:** D1 (`:one` scalar SELECT `{guard_passed, updated_count}` — the central, non-negotiable decision; not a naive `AND EXISTS` on the existing `:execrows`), D2 (adapter inspects `GuardPassed=false → ErrCompanyNotActive`; mapUpdateError gains `pgx.ErrNoRows → ErrCompanyNotActive` BEFORE the errors.As, mirroring mapCreateError), D3 (CAS / same-company / soft-delete predicates unchanged; `updated_count=0` with `guard_passed=true` → ErrJobNotFound), D7 (regen touches BOTH generated files; UpdateJobParams unchanged). D8 inventory held: 3 authored files + 2 generated files.

---

## Commit C — pending (Phase 7 work-unit: integration coverage for re-open + active-company gate)
