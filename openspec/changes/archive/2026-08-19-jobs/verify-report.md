```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:5d7b8dc437449ef83a822b8ff6e92bf6f57259c998a5d41003abd0fa14864413
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 29/29
test_command: go test ./... -count=1
test_exit_code: 0
test_output_hash: sha256:31e89a0db3367d48ab5f94e3f8b2d053472dd9b9e698fc17274bd7ca65cb8e63
build_command: go build ./... && go vet ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: `jobs` (vacantes) — public-read slice
**Version**: N/A (delta spec, no version field)
**Mode**: Strict TDD
**Evidence revision**: `6ca6e22` (HEAD, branch `feature/jobs`) — remediation `6ca6e22` (REQ-04 status-default test) is included; prior remediations `9711470` (enum filters + read-path tests) and the WU commits are also in this revision.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 30 |
| Tasks checked `[x]` | 11 |
| Tasks unchecked `[ ]` | 19 |
| Phases fully checked | 1, 2, 3, 9, 10 |
| Phases unchecked (stale) | 4, 5, 6, 7, 8 |

Note: the 19 unchecked tasks correspond to work that is **actually committed** (git WU3/WU4/WU5 commits + all source/test files present). The `tasks.md` checkbox state is stale, not the code — see WARNING-2.

### Build & Tests Execution

**Build**: ✅ Passed (`go build ./...` → exit 0)
**Vet**: ✅ Passed (`go vet ./...` → exit 0)
**gofmt**: ✅ Clean (`gofmt -l .` → empty)

**Unit tests**: ✅ All pass (`go test ./... -count=1` → exit 0; 26 packages `ok`, jobs packages green)

```text
ok  github.com/.../internal/features/jobs/application/cursor
ok  github.com/.../internal/features/jobs/application/usecases
ok  github.com/.../internal/features/jobs/domain/entities
ok  github.com/.../internal/features/jobs/domain/repositories
ok  github.com/.../internal/features/jobs/domain/valueobjects
ok  github.com/.../internal/features/jobs/infrastructure/http
ok  github.com/.../internal/features/jobs/infrastructure/postgres
```

**Integration tests** (`go test -tags=integration -p 1 -count=1 ./...` against live Postgres `peopleflow-vacancies` @ :5432): ✅ exit 0, 27/27 packages `ok`. The `jobs` postgres package ran **26/26 test functions green** (0.265s, none skipped) — 13 read-path + 10 migration + 3 seed, including the new `TestJobsMigrationStatusDefaultsToDraft` (see CRITICAL-3 confirmation below). Serial run (`-p 1`) passes deterministically; see WARNING-1.

**Coverage**: not measured (no `-coverprofile` run) → ➖ Not available.

### Spec Compliance Matrix

Legend: ✅ COMPLIANT (covering runtime test passed) · ⚠️ PARTIAL (plumbing tested, SQL behavior untested) · ❌ DIVERGENT (behavior violates spec) · 🕳️ UNTESTED (no covering test).

| Req | Scenario | Test | Result |
|-----|----------|------|--------|
| 1 Public Read Endpoints | GET /jobs is public | `handler_test.go > TestRoutesArePublic` | ✅ COMPLIANT |
| 1 | GET /jobs/{id} returns published job | `jobRepository_integration_test.go > TestGetByID_ReturnsVisibleJob` | ✅ COMPLIANT |
| 1 | GET /jobs/{id} hides non-visible | `TestGetByID_HidesNonVisibleJobs` (draft/closed/soft-deleted/non-active/unknown) | ✅ COMPLIANT |
| 2 Read-Side Visibility | visible job is listed | `TestSearch_ReturnsOnlyVisibleJobs` (exact ID list) | ✅ COMPLIANT |
| 2 | draft/closed/soft-deleted/non-active hidden | `TestSearch_ReturnsOnlyVisibleJobs` (asserts all 4 hidden IDs absent) | ✅ COMPLIANT |
| 3 Schema Migration | up creates named objects | `migration_00007_test.go > TestJobsMigrationUpCreatesNamedObjects` | ✅ COMPLIANT |
| 3 | down drops table + indexes | `TestJobsMigrationDownDropsTable` | ✅ COMPLIANT |
| 3 | required fields reject NULL | `TestJobsMigrationRejectsNullRequiredField` | ✅ COMPLIANT |
| 3 | optional NULL + salary_currency defaults MXN | `TestJobsMigrationSalaryCurrencyDefaultsToMXN` | ✅ COMPLIANT |
| 4 Status Domain | default insert produces draft | `migration_00007_test.go > TestJobsMigrationStatusDefaultsToDraft` | ✅ COMPLIANT |
| 4 | only published rows exposed | `TestSearch_ReturnsOnlyVisibleJobs` (draft/closed suppressed) | ✅ COMPLIANT |
| 5 Full-Text Search | title hit returned | `TestSearch_TitleHitOutranksDescriptionHit` | ✅ COMPLIANT |
| 5 | description hit returned | `TestSearch_TitleHitOutranksDescriptionHit` | ✅ COMPLIANT |
| 5 | malformed q does not 500 | `TestSearch_MalformedQueryDoesNotError` (DB-level, 4 malformed inputs) | ✅ COMPLIANT |
| 5 | title outranks description | `TestSearch_TitleHitOutranksDescriptionHit` (asserts rank strictly greater) | ✅ COMPLIANT |
| 5 | missing q returns all | `TestSearch_AbsentQueryReturnsAllVisible` | ✅ COMPLIANT |
| 6 Listing Filters | single filter narrows | `TestSearch_FiltersNarrowResults` (seniority/work_mode/employment_type/currency/location) | ✅ COMPLIANT |
| 6 | combined filters AND | `TestSearch_FiltersNarrowResults` (combined + empty-intersection cases) | ✅ COMPLIANT |
| 6 | unknown query param ignored | `handler_test.go > TestListJobs_UnknownParamIgnored` | ✅ COMPLIANT |
| 6 | invalid filter value ignored | `usecases > TestSearchJobs_InvalidEnumFilterIsDropped` + `TestSearch_DroppedEnumFilterReturnsUnfilteredListing` | ✅ COMPLIANT |
| 6 | currency filter exact match | `TestSearch_FiltersNarrowResults` (USD → exact 2 rows, no FX) | ✅ COMPLIANT |
| 7 Keyset Pagination | first page returns cursor | `TestKeysetPagination_CursorPastTheEndReturnsEmpty` (page-1 cursor) + `usecases > TestSearchJobs_LimitPlusOneHitsNextCursor` | ✅ COMPLIANT |
| 7 | cursor advances page (no overlap) | `TestKeysetPagination_BrowseModeVisitsEveryRowExactlyOnce` | ✅ COMPLIANT |
| 7 | search-mode stable across rank ties | `TestKeysetPagination_SearchModeVisitsEveryRowExactlyOnce` | ✅ COMPLIANT |
| 7 | cursor past end returns empty | `TestKeysetPagination_CursorPastTheEndReturnsEmpty` | ✅ COMPLIANT |
| 8 Enum Invariants | work_mode rejects invalid | `TestJobsMigrationRejectsOutOfEnumWorkMode` | ✅ COMPLIANT |
| 8 | seniority rejects invalid | `TestJobsMigrationRejectsOutOfEnumSeniority` | ✅ COMPLIANT |
| 8 | employment_type rejects invalid | `TestJobsMigrationRejectsOutOfEnumEmploymentType` | ✅ COMPLIANT |
| 8 | salary_currency rejects invalid | `TestJobsMigrationRejectsOutOfEnumSalaryCurrency` | ✅ COMPLIANT |

**Compliance summary**: 29 COMPLIANT · 0 PARTIAL · 0 DIVERGENT · 0 UNTESTED (29 total).

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Public Read Endpoints | ✅ Implemented | `/jobs` mounted outside `/me` RequireAuth (`main.go`); `Routes()` has no auth middleware; `classifyError` maps `ErrJobNotFound`→404 |
| Read-Side Visibility Rule | ✅ Implemented | Enforced in SQL (`jobs.sql` SearchJobs + GetJobByID `WHERE j.status='published' AND j.deleted_at IS NULL AND c.status='active'`) — integration-verified on both Search and GetByID |
| Jobs Schema Migration | ✅ Implemented | `00007_jobs.sql` matches spec exactly (4 CHECKs, STORED `search_vector`, GIN + B-tree + partial indexes, `goose down` drops) |
| Status Domain | ✅ Implemented | `status TEXT NOT NULL DEFAULT 'draft'`; `published` integrity guard `CHECK (status<>'published' OR published_at IS NOT NULL)`; read filters to `published`. Scenario "default draft" is now runtime-tested via `TestJobsMigrationStatusDefaultsToDraft` (insert without `status` → read back `draft`) — CRITICAL-3 resolved |
| Full-Text Search | ✅ Implemented | `websearch_to_tsquery('spanish', ...)` (safe parser) + `ts_rank` in SELECT and ORDER BY; empty `q` degenerates via `COALESCE(...,'')` — all five scenarios integration-verified |
| Listing Filters | ✅ Implemented | AND-combined SQL predicates; unknown params ignored; invalid enum values dropped to nil via `optEnum` (REQ-06 fixed) |
| Keyset Pagination | ✅ Implemented | 3-tuple cursor `(rank, published_at, id)`; `LIMIT @limit+1`; cursor anchored on last visible row (`searchJobs.go:75`) — browse + search-mode + tie + past-end all integration-verified |
| Enum Invariants | ✅ Implemented | 4 CHECK constraints reject out-of-enum (23514) — integration-verified |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1 Hexagonal layout (`infra→app→domain`) | ✅ Yes | `var _ repositories.JobRepository = (*JobRepository)(nil)`; domain never imports `internal/db` |
| 2 Single `:many` query, explicit columns, JOIN companies | ✅ Yes | `search_vector` excluded from SELECT (no `interface{}`) |
| 3 Keyset 3-tuple `(rank, published_at, id)`, page 20, LIMIT n+1 | ✅ Yes | Corrected design applied; search-mode rank-tie walk runtime-proven |
| 4 Envelope `{items, next_cursor}`, bare detail | ✅ Yes | `SearchJobsResult{Items, NextCursor}`; detail reuses `SearchJobsItem` |
| 5 Embedded `company{id,name}` | ✅ Yes | `CompanyDto` in both list + detail; hydration asserted in `TestSearch_HydratesCompanyAndColumns` |
| 6 In-SQL `websearch_to_tsquery` + `ts_rank` | ✅ Yes | Safe parser; malformed-input tolerance proven at DB level |
| 7 Dev seed self-contained + idempotent | ✅ Yes | 3 companies + 6 jobs, `ON CONFLICT DO NOTHING`, fixed UUIDs |
| 8 Tolerant errors (malformed cursor → first page) | ✅ Yes | `cursor.Decode` returns nil on any malformed input |
| Testing strategy: integration for visibility/keyset/ts_rank | ✅ Followed | Design's promised integration tests written and green (`jobRepository_integration_test.go`, 13 test functions) |

### Spot-Check: Apply-Time Corrections

| Correction | Status | Evidence |
|-----------|--------|----------|
| (a) `SearchJobs` SELECT includes `ts_rank(...) AS search_rank` + 3-tuple keyset predicate | ✅ Landed | `jobs.sql` 3-tuple `(ts_rank(...), j.published_at, j.id) < (...)` — exercised by `TestKeysetPagination_SearchModeVisitsEveryRowExactlyOnce` |
| (b) `searchJobs.go` anchors cursor on `rows[pageLimit-1]` | ✅ Landed | `searchJobs.go:75` (`anchor := rows[pageLimit-1]`) — last **visible** row, not the +1 sentinel |
| (c) DTOs have snake_case JSON tags | ✅ Landed | `searchJobsDto.go`: `work_mode`, `employment_type`, `seniority`, `salary_min`, `salary_max`, `salary_currency`, `published_at`, `next_cursor` |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported (apply-progress artifact) | ❌ | No `apply-progress` artifact persisted under `openspec/changes/jobs/` |
| All tasks have test files | ✅ | RED-first test files exist for every layer (VO, entity, port, cursor, use cases, handler, adapter, migrations) |
| RED confirmed (tests exist) | ✅ | 15 test files under `features/jobs/**` present |
| GREEN confirmed (tests pass) | ✅ | All jobs unit + integration tests pass |
| Triangulation adequate | ✅ | Read-path SQL triangulated: unit (use-case drop/canonicalize) + integration (SQL semantics) for filters, keyset, FTS, visibility, status-default |
| Safety net for modified files | ✅ | `go build`/`go vet`/`gofmt` clean; no regression in untouched packages |

**TDD Compliance**: 5/6 checks passed (no apply-progress artifact — pre-existing, non-blocking).

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 90+ assertions | 12 (`*_test.go` without build tag) | stdlib `go test` |
| Integration | 26 test functions | 3 (`migration_00007_test.go`, `migration_00008_test.go`, `jobRepository_integration_test.go`, `//go:build integration`) | pgx against live Postgres |
| E2E | 0 | 0 | — |
| **Total** | — | 15 test files | |

### CRITICALs Resolved

**CRITICAL-1 — invalid enum filter is now ignored → RESOLVED (remediation `9711470`).** `SearchJobs` runs every closed-set filter through its value-object `Parse*` via the generic `optEnum` helper; an out-of-domain value returns nil so the SQL predicate degenerates to TRUE. Covering tests green: `TestSearchJobs_InvalidEnumFilterIsDropped`, `TestSearchJobs_InvalidEnumFilterDoesNotDropSiblings`, `TestSearchJobs_ValidEnumFilterIsCanonicalized`, `TestSearchJobs_FreeTextFiltersAreNotEnumValidated`, `TestSearch_DroppedEnumFilterReturnsUnfilteredListing`.

**CRITICAL-2 — read-path runtime coverage → RESOLVED (remediation `9711470`).** `jobRepository_integration_test.go` adds 13 test functions exercising Search/GetByID against live Postgres (visibility, keyset no-skip/dup, FTS weighting, filters, hydration), all green.

**CRITICAL-3 — REQ-04 "default insert produces a draft" → RESOLVED (remediation `6ca6e22`).** `TestJobsMigrationStatusDefaultsToDraft` in `migration_00007_test.go` inserts a row **without** an explicit `status` and reads it back as `'draft'`, mirroring the sibling `TestJobsMigrationSalaryCurrencyDefaultsToMXN`. Confirmed running green against live Postgres (0.01s, not skipped): `--- PASS: TestJobsMigrationStatusDefaultsToDraft`. This closes the last `UNTESTED` scenario.

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `migration_00007_test.go` | 502-510 | `TestJobsMigrationStatusDefaultsToDraft` inserts without `status` and asserts read-back equals `'draft'` (value assertion, not existence) | Strong | — |
| `jobRepository_integration_test.go` | 287-300 | `TestSearch_ReturnsOnlyVisibleJobs` asserts exact ID list + explicitly names any leaked hidden row | Strong | — |
| `jobRepository_integration_test.go` | 384-404 | `TestSearch_TitleHitOutranksDescriptionHit` asserts rank strictly greater (not just order) | Strong | — |
| `jobRepository_integration_test.go` | 683-710 | `assertKeysetWalk` separates duplicates / missing / order divergences | Strong | — |

**Assertion quality**: 0 CRITICAL, 0 WARNING. The new status-default test asserts the concrete read-back value (`'draft'`), not merely that the insert succeeded, so it is a real behavioral assertion, not a smoke test.

### Issues Found

**CRITICAL**:

None. All three prior CRITICALs are resolved with runtime evidence; every spec scenario (29/29) now has a covering test that passed at runtime.

**WARNING**:

1. **Integration suite is flaky (pre-existing, jobs-unrelated).** Full `go test -tags=integration ./...` (parallel) still races: `identity/.../00005_integration_test.go` `DROP`s `users`/`candidate_profiles`/`candidate_languages` (down-migration test) concurrently with `candidates` package reads. `feature/jobs` does **not** touch candidates/identity code; jobs integration tests pass in every mode. Serial run (`-p 1`) passes 27/27, exit 0. Unchanged from prior report.

2. **`tasks.md` is stale.** Phases 4–8 (19 unchecked task lines) remain unchecked although their work is committed. Native status reports `tasks: 11/30 complete` with `applyProgress: missing`. The task-tracking artifact does not reflect the delivered code. Unchanged from prior report.

**SUGGESTION**:

1. **Integration test isolation.** Run `go test -tags=integration -p 1 ./...` (or use per-package schemas/transactions) so down-migration tests don't race read-path tests on the shared DB. Unchanged from prior report.

> Prior SUGGESTION-1 ("spec drift on keyset tuple") is **RESOLVED**: `specs/jobs/spec.md` REQ-07 documents the 3-tuple `(ts_rank, published_at, id)` and its browse-mode degeneration to `(published_at, id)`.
> Prior SUGGESTION-2 ("close the status-default gap") is **RESOLVED** by `6ca6e22` (`TestJobsMigrationStatusDefaultsToDraft`).

### Verdict

**PASS WITH WARNINGS** — all 8 requirements and all 29 scenarios are now covered by runtime tests that passed against live Postgres. CRITICAL-3 (REQ-04 "default insert produces a draft") is resolved by `TestJobsMigrationStatusDefaultsToDraft` (insert without `status` → read back `'draft'`, green, not skipped). Every command passes: `go build` exit 0, `go vet` exit 0, `gofmt` clean, unit tests exit 0 (26 packages `ok`), integration tests exit 0 (27 packages `ok`, serial `-p 1`). The only remaining items are two pre-existing, non-blocking WARNINGs (jobs-unrelated integration flake; stale `tasks.md` checkboxes), so the verdict advances from `fail` to `pass_with_warnings` but not to a clean `pass`.
