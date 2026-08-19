```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:479cd7f01aac051f484e53c1647b1b0e2cee667207eee0c3730e4bc4051347a2
verdict: fail
blockers: 2
critical_findings: 2
requirements: 2/8
scenarios: 10/28
test_command: go test ./... -count=1
test_exit_code: 0
test_output_hash: sha256:dbe5552d06eee36be3b5771749ea14ae5b9d224b0057f59664360d5eb99bff41
build_command: go build ./... && go vet ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: `jobs` (vacantes) — public-read slice
**Version**: N/A (delta spec, no version field)
**Mode**: Strict TDD
**Evidence revision**: `75e2003` (HEAD, branch `feature/jobs`, clean working tree)

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

**Unit tests**: ✅ All pass (`go test ./... -count=1` → exit 0; 27 packages `ok`, jobs packages green)

```text
ok  github.com/.../internal/features/jobs/application/cursor    (unit)
ok  github.com/.../internal/features/jobs/application/usecases
ok  github.com/.../internal/features/jobs/domain/entities
ok  github.com/.../internal/features/jobs/domain/repositories
ok  github.com/.../internal/features/jobs/domain/valueobjects
ok  github.com/.../internal/features/jobs/infrastructure/http
ok  github.com/.../internal/features/jobs/infrastructure/postgres
```

**Integration tests** (`go test -tags=integration ./...` against live Postgres `peopleflow-vacancies` @ :5432):

- Jobs integration tests (migration 00007 schema, 00008 seed) **pass** in every mode (isolated + serial + parallel).
- Full parallel run is **flaky** (exit 1 on first run, exit 0 on re-run) due to a **pre-existing, jobs-unrelated** cross-package race: `identity/.../00005_integration_test.go` `DROP`s `users`/`candidate_profiles`/`candidate_languages` while the `candidates` package reads them. Serial run (`-p 1`) passes deterministically: 27/27 packages `ok`, exit 0. See WARNING-1.

**Coverage**: not measured (no `-coverprofile` run) → ➖ Not available.

### Spec Compliance Matrix

Legend: ✅ COMPLIANT (covering runtime test passed) · ⚠️ PARTIAL (plumbing tested, SQL behavior untested) · ❌ DIVERGENT (behavior violates spec) · 🕳️ UNTESTED (no covering test).

| Req | Scenario | Test | Result |
|-----|----------|------|--------|
| 1 Public Read Endpoints | GET /jobs is public | `handler_test.go > TestRoutesArePublic` | ✅ COMPLIANT |
| 1 | GET /jobs/{id} returns published job | `handler_test.go > TestGetJob_ReturnsJob` (stub) | ⚠️ PARTIAL |
| 1 | GET /jobs/{id} hides non-visible | `handler_test.go > TestGetJob_NotFound` (stub 404) | ⚠️ PARTIAL |
| 2 Read-Side Visibility | visible job is listed | (SQL `WHERE status='published' AND deleted_at IS NULL AND c.status='active'`) | 🕳️ UNTESTED |
| 2 | draft/closed/soft-deleted/non-active hidden | (same SQL) | 🕳️ UNTESTED |
| 3 Schema Migration | up creates named objects | `migration_00007_test.go > TestJobsMigrationUpCreatesNamedObjects` | ✅ COMPLIANT |
| 3 | down drops table + indexes | `TestJobsMigrationDownDropsTable` | ✅ COMPLIANT |
| 3 | required fields reject NULL | `TestJobsMigrationRejectsNullRequiredField` | ✅ COMPLIANT |
| 3 | optional NULL + salary_currency defaults MXN | `TestJobsMigrationSalaryCurrencyDefaultsToMXN` | ✅ COMPLIANT |
| 4 Status Domain | default insert produces draft | (DDL `status DEFAULT 'draft'`) | 🕳️ UNTESTED |
| 4 | only published rows exposed | (SQL `WHERE status='published'`) | 🕳️ UNTESTED |
| 5 Full-Text Search | title hit returned | (SQL `websearch_to_tsquery`) | 🕳️ UNTESTED |
| 5 | description hit returned | (SQL) | 🕳️ UNTESTED |
| 5 | malformed q does not 500 | `handler_test.go > TestListJobs_MalformedQueryIgnored` (handler only) | ⚠️ PARTIAL |
| 5 | title outranks description | (SQL `ORDER BY ts_rank DESC`) | 🕳️ UNTESTED |
| 5 | missing q returns all | (SQL empty-tsquery sentinel) | 🕳️ UNTESTED |
| 6 Listing Filters | single filter narrows | (SQL) | 🕳️ UNTESTED |
| 6 | combined filters AND | (SQL) | 🕳️ UNTESTED |
| 6 | unknown query param ignored | `handler_test.go > TestListJobs_UnknownParamIgnored` | ✅ COMPLIANT |
| 6 | invalid filter value ignored | `TestListJobs_InvalidFilterValueIgnored` (asserts 200 only) | ❌ DIVERGENT |
| 6 | currency filter exact match | (SQL `salary_currency = @currency`) | 🕳️ UNTESTED |
| 7 Keyset Pagination | first page returns cursor | `handler_test.go > TestListJobs_NextCursorOnLastPage` + `usecases > TestSearchJobs_LimitPlusOneHitsNextCursor` (stub) | ⚠️ PARTIAL |
| 7 | cursor advances page (no overlap) | (SQL 3-tuple keyset predicate) | 🕳️ UNTESTED |
| 7 | cursor past end returns empty | `usecases > TestSearchJobs_FewerThanLimitPlusOneHasNoCursor` (stub) | ⚠️ PARTIAL |
| 8 Enum Invariants | work_mode rejects invalid | `TestJobsMigrationRejectsOutOfEnumWorkMode` | ✅ COMPLIANT |
| 8 | seniority rejects invalid | `TestJobsMigrationRejectsOutOfEnumSeniority` | ✅ COMPLIANT |
| 8 | employment_type rejects invalid | `TestJobsMigrationRejectsOutOfEnumEmploymentType` | ✅ COMPLIANT |
| 8 | salary_currency rejects invalid | `TestJobsMigrationRejectsOutOfEnumSalaryCurrency` | ✅ COMPLIANT |

**Compliance summary**: 10 COMPLIANT · 5 PARTIAL · 1 DIVERGENT · 12 UNTESTED (28 total).

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| Public Read Endpoints | ✅ Implemented | `/jobs` mounted outside `/me` RequireAuth (`main.go:142`); `Routes()` has no auth middleware; `classifyError` maps `ErrJobNotFound`→404 |
| Read-Side Visibility Rule | ✅ Implemented | Enforced in SQL (`jobs.sql` SearchJobs + GetJobByID `WHERE j.status='published' AND j.deleted_at IS NULL AND c.status='active'`) |
| Jobs Schema Migration | ✅ Implemented | `00007_jobs.sql` matches spec exactly (4 CHECKs, STORED `search_vector`, GIN + B-tree + partial indexes, `goose down` drops) |
| Status Domain | ✅ Implemented | `status TEXT NOT NULL DEFAULT 'draft'`; `published` integrity guard `CHECK (status<>'published' OR published_at IS NOT NULL)`; read filters to `published` |
| Full-Text Search | ✅ Implemented | `websearch_to_tsquery('spanish', ...)` (safe parser) + `ts_rank` in SELECT and ORDER BY; empty `q` degenerates via `COALESCE(...,'')` |
| Listing Filters | ⚠️ Implemented w/ defect | AND-combined SQL predicates; unknown params ignored; **invalid enum values are NOT ignored** (see CRITICAL-1) |
| Keyset Pagination | ✅ Implemented | 3-tuple cursor `(rank, published_at, id)`; `LIMIT @limit+1`; cursor anchored on last visible row (`searchJobs.go:74`) |
| Enum Invariants | ✅ Implemented | 4 CHECK constraints reject out-of-enum (23514) — integration-verified |

### Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| 1 Hexagonal layout (`infra→app→domain`) | ✅ Yes | `var _ repositories.JobRepository = (*JobRepository)(nil)`; domain never imports `internal/db` |
| 2 Single `:many` query, explicit columns, JOIN companies | ✅ Yes | `search_vector` excluded from SELECT (no `interface{}`) |
| 3 Keyset 3-tuple `(rank, published_at, id)`, page 20, LIMIT n+1 | ✅ Yes | Corrected design applied (see Spot-Check) |
| 4 Envelope `{items, next_cursor}`, bare detail | ✅ Yes | `SearchJobsResult{Items, NextCursor}`; detail reuses `SearchJobsItem` |
| 5 Embedded `company{id,name}` | ✅ Yes | `CompanyDto` in both list + detail |
| 6 In-SQL `websearch_to_tsquery` + `ts_rank` | ✅ Yes | Safe parser |
| 7 Dev seed self-contained + idempotent | ✅ Yes | 3 companies + 6 jobs, `ON CONFLICT DO NOTHING`, fixed UUIDs |
| 8 Tolerant errors (malformed cursor → first page) | ✅ Yes | `cursor.Decode` returns nil on any malformed input |
| Testing strategy: integration for visibility/keyset/ts_rank | ❌ Not followed | Design planned these integration tests; **none were written** (see CRITICAL-2) |

### Spot-Check: Apply-Time Corrections

| Correction | Status | Evidence |
|-----------|--------|----------|
| (a) `SearchJobs` SELECT includes `ts_rank(...) AS search_rank` + 3-tuple keyset predicate | ✅ Landed | `jobs.sql:56-59` (`ts_rank(...) AS search_rank`); `jobs.sql:77-86` (`(ts_rank(...), j.published_at, j.id) < (COALESCE(cursor_rank,0), cursor_ts, cursor_id)`) |
| (b) `searchJobs.go` anchors cursor on `rows[pageLimit-1]` | ✅ Landed | `searchJobs.go:74` (`anchor := rows[pageLimit-1]`) — last **visible** row, not the +1 sentinel |
| (c) DTOs have snake_case JSON tags | ✅ Landed | `searchJobsDto.go`: `work_mode`, `employment_type`, `seniority`, `salary_min`, `salary_max`, `salary_currency`, `published_at`, `next_cursor` |

### TDD Compliance

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported (apply-progress artifact) | ❌ | No `apply-progress` artifact persisted under `openspec/changes/jobs/` |
| All tasks have test files | ✅ | RED-first test files exist for every layer (VO, entity, port, cursor, use cases, handler, adapter, migrations) |
| RED confirmed (tests exist) | ✅ | 17 test files under `features/jobs/**` present |
| GREEN confirmed (tests pass) | ✅ | All jobs unit + integration tests pass |
| Triangulation adequate | ⚠️ | Cursor codec + `toEntity` well-triangulated; read-path SQL scenarios have **zero** triangulation |
| Safety net for modified files | ✅ | `go build`/`go vet`/`gofmt` clean; no regression in untouched packages |

**TDD Compliance**: 4/6 checks passed (no apply-progress artifact; read-path SQL untriangulated).

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 60+ assertions | 12 (`*_test.go` without build tag) | stdlib `go test` |
| Integration | 9 schema/seed tests | 2 (`migration_00007_test.go`, `migration_00008_test.go`, `//go:build integration`) | pgx against live Postgres |
| E2E | 0 | 0 | — |
| **Total** | — | 17 test files | |

### Assertion Quality

| File | Line | Assertion | Issue | Severity |
|------|------|-----------|-------|----------|
| `handler_test.go` | 326-341 | `TestListJobs_InvalidFilterValueIgnored` asserts only `rec.Code == 200` | Smoke assertion: does NOT verify the filter is "treated as unfiltered" — misses CRITICAL-1 | WARNING |
| `handler_test.go` | 297-309 | `TestListJobs_MalformedQueryIgnored` asserts only 200 | Handler-level only; DB parser safety (`websearch_to_tsquery`) not exercised | WARNING |

**Assertion quality**: 0 CRITICAL, 2 WARNING. No tautologies/ghost loops found; remaining assertions verify real behavior.

### Issues Found

**CRITICAL**:

1. **Invalid filter value is not ignored — spec scenario diverges.** Spec REQ-06 scenario "invalid filter value is ignored" requires `?seniority=expert` to be "treated as unfiltered" (all visible jobs returned). The implementation forwards the raw value to SQL (`j.seniority = 'expert'`, `jobs.sql:67-68`), which — because no row can carry `seniority='expert'` (CHECK constraint) — returns an **empty** result set, not the unfiltered listing. No enum validation exists anywhere on the filter path (`jobHandler.go:listJobs` → `usecases.optString` → `strPtrToText`). The DTO comment (`searchJobsDto.go:27-29`) even claims "invalid values are ignored … the use case handles by skipping them", which is **false**. The only covering test (`TestListJobs_InvalidFilterValueIgnored`) asserts 200 and nothing else, so the defect is uncaught.

2. **Read-path SQL behavior has no runtime test coverage — 12 scenarios UNTESTED, 5 PARTIAL.** The design's Testing Strategy explicitly promised integration tests for "visibility rule; keyset stability; ts_rank title>description", but **none were written**. Every read-side behavioral scenario (visibility rule REQ-02, status-domain exposure REQ-04, full-text hit/ranking REQ-05, filter semantics REQ-06, keyset pagination REQ-07) is verified only by SQL source inspection, not by any test that executes `SearchJobs`/`GetJobByID` against Postgres. Under strict TDD, "a spec scenario is compliant only when a covering test passed at runtime" — 12 required scenarios have no covering test.

**WARNING**:

1. **Integration suite is flaky (pre-existing, jobs-unrelated).** Full `go test -tags=integration ./...` (parallel) raced: first run exit 1 (`candidates` → `relation "users" does not exist`), re-run exit 0. Root cause: `identity/.../00005_integration_test.go` `DROP`s `users`/`candidate_profiles`/`candidate_languages` (down-migration test) concurrently with `candidates` package reads. `feature/jobs` does **not** touch candidates/identity code; jobs integration tests pass in every mode. Serial run (`-p 1`) passes 27/27, exit 0.

2. **`tasks.md` is stale.** Phases 4–8 (19 unchecked task lines) remain unchecked although their work is committed (WU3 domain, WU4 application, WU5 infrastructure all landed; check-off commits only covered WU1/WU2/WU5[partial]/WU6). The native status (`gentle-ai sdd-status jobs`) reports `tasks: 11/30 complete` with `applyProgress: missing` and `verify: blocked`. The task-tracking artifact does not reflect the delivered code.

**SUGGESTION**:

1. **Spec drift on keyset tuple.** Spec REQ-07 still describes keyset on `(published_at, id)`; the implementation (correctly, per design correction) uses the unified 3-tuple `(rank, published_at, id)`. Browse mode degenerates to the 2-tuple, so there is no functional defect, but `specs/jobs/spec.md` should be updated to document the search-mode 3-tuple.
2. **Integration test isolation.** Run `go test -tags=integration -p 1 ./...` (or use per-package schemas/transactions) so down-migration tests don't race read-path tests on the shared DB.

### Verdict

**FAIL** — the implementation is correct by source inspection and every existing test passes, but (a) spec scenario "invalid filter value is ignored" is violated (returns empty instead of unfiltered), and (b) the core read-path SQL behavior (visibility, FTS ranking, filters, keyset pagination — 12 scenarios) has no covering runtime test despite the design's explicit testing-strategy promise. Not archive-ready.
