# Apply Progress: company-members (WU1)

## Work Unit 1 — Migration `00009` + sqlc queries + regen

WU1 boundary: `db/migrations/00009*`, `db/queries/company_members.sql`,
regenerated `internal/db/*.sql.go`. The 00005 integration test received a
one-line maintenance update (mirror the new FK dependency in the
reverse-down DROP sequence) as a direct, documented consequence of WU1 —
no domain/application/handler code touched.

### Files changed

| File | Action | Notes |
|------|--------|-------|
| `backend/db/migrations/00009_create_company_members.sql` | create | table + `company_members_role_check` + `UNIQUE(user_id)` + `company_id` index, up+down |
| `backend/db/migrations/migrations_test.go` | create | integration tests for the four spec scenarios (1.1 / 1.2 / 1.3) |
| `backend/db/queries/company_members.sql` | create | 5 sqlc queries: Create / GetMembershipByUserID / ListByCompanyID / UpdateRole / RemoveCompanyMember (the last two with the design D7 same-company guard) |
| `backend/internal/db/models.go` | regenerate | new `CompanyMember` struct (sqlc-generated, NOT hand-edited) |
| `backend/internal/db/company_members.sql.go` | regenerate | sqlc-generated method bodies + params (NOT hand-edited) |
| `backend/internal/db/querier.go` | regenerate | new `Querier` interface methods (sqlc-generated, NOT hand-edited) |
| `backend/Makefile` | modify | added `-p 1` to `test-integration` (parallel-package hazard: 00005 down test drops `company_members` mid-flight while a parallel 00009 test is reading it) |
| `backend/internal/features/identity/infrastructure/postgres/00005_integration_test.go` | modify (maintenance) | mirror the new `company_members → users` FK in the reverse-down DROP order, and re-create `company_members` after the test. Matches the existing pattern for `candidate_profiles` / `candidate_languages` introduced by 00006. |

### TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `db/migrations/migrations_test.go::TestMigration00009UpCreatesNamedObjects` | Integration (`-tags=integration`) | N/A (new test file) | ✅ FAIL — `expected table company_members to exist after 00009 up` (no 00009 file → goose "no migrations to run. current version: 8") | ✅ PASS — table + named CHECK + UNIQUE on `user_id` all probed and asserted | ✅ Single spec scenario; precondition + 3 distinct assertions (table, CHECK, UNIQUE) all exercise different information_schema / pg_indexes paths | ➖ None needed |
| 1.2 | `db/migrations/migrations_test.go::TestMigration00009DownDropsTable` | Integration | N/A (new) | ✅ FAIL — precondition `expected company_members to exist after 00009 up` failed (vacuous-pass guard added after first RED run exposed the bug) | ✅ PASS — table exists after up, gone after `goose DownTo(8)`, re-applied via t.Cleanup | ✅ Single spec scenario; precondition + post-down assertion both probe `information_schema.tables` (different states of the same predicate) | ➖ None needed |
| 1.3 | `db/migrations/migrations_test.go::TestMigration00009RejectsInvalidRole` + `::TestMigration00009RejectsDuplicateUserID` | Integration | N/A (new) | ✅ FAIL — `expected SQLSTATE 23514, got 42P01` (relation missing) for the role test; `first insert should succeed: 42P01` for the duplicate test | ✅ PASS — both tests assert specific SQLSTATE codes (23514 check_violation, 23505 unique_violation) on real DB | ✅ 2 cases (invalid role / duplicate user_id) — different constraints exercised, different fixture shapes (one company vs. two companies), different SQLSTATE assertions | ➖ None needed |
| 1.4 | n/a (GREEN for migration SQL) | n/a | n/a | n/a | ✅ `00009_create_company_members.sql` written; `go tool goose up` → version 9; `go tool goose down` → version 8 (round-trip clean) | n/a | n/a |
| 1.5 | n/a (GREEN for sqlc queries) | n/a | n/a | n/a | ✅ `db/queries/company_members.sql` written with 5 queries; `go tool sqlc generate` produced `company_members.sql.go`, `models.go`, `querier.go`; `go build ./...` clean | n/a | n/a |
| 1.6 | (sqlc regen verification) | n/a | n/a | n/a | ✅ Generated `company_members.sql.go` compiles; all 5 method bodies present (`CreateCompanyMember`, `GetMembershipByUserID`, `ListByCompanyID`, `UpdateMemberRole`, `RemoveCompanyMember`); `Querier` interface includes them; `CompanyMember` struct in `models.go` | n/a | n/a |

### Test summary

- **Total tests written**: 4 (`TestMigration00009UpCreatesNamedObjects`, `TestMigration00009DownDropsTable`, `TestMigration00009RejectsInvalidRole`, `TestMigration00009RejectsDuplicateUserID`)
- **Total tests passing**: 4/4 (verified via `go test -tags=integration ./db/migrations/... -count=1 -v`)
- **Layers used**: Integration (4), Unit (0)
- **Approval tests (refactoring)**: None — WU1 is new code, no refactoring tasks
- **Pure functions created**: 0 (helper functions are pure — `pgxPool`, `gooseUpTo`, `gooseDownTo`, `seedPrereqs`, `requireUsersAndCompaniesTables` — but they're test helpers, not production code)

### Runtime harness (mandatory)

| Step | Command | Result |
|------|---------|--------|
| Apply all migrations | `set -a && . ./.env && set +a && go tool goose up` | `OK 00009_create_company_members.sql (3.84ms)` → version 9 |
| Revert 00009 | `go tool goose down` | `OK 00009_create_company_members.sql (3.41ms)` → version 8 |
| Re-apply 00009 | `go tool goose up` | `OK 00009_create_company_members.sql (4.41ms)` → version 9 |
| Inspect schema (manual probe) | `psql -c "\\d company_members"` (via docker exec) | confirms PK, FKs to users/companies, CHECK `company_members_role_check`, UNIQUE index `company_members_user_id_unique`, B-tree `company_members_company_id_idx` |
| Full unit suite | `go test ./... -count=1` | exit 0; all packages `ok` |
| Full integration suite | `go test -tags=integration ./... -count=1` | exit 0; all packages `ok` |
| Static checks | `go vet ./...` and `gofmt -l .` | both empty |

### Rollback boundary

The WU1 PR can be reverted without disturbing any other work:

```
git revert --no-edit WU1
```

→ drops `db/migrations/00009_create_company_members.sql` (and the test file),
removes `db/queries/company_members.sql`, removes the regenerated
`internal/db/company_members.sql.go`, reverts `internal/db/models.go` and
`internal/db/querier.go` to their pre-WU1 state, reverts the
`Makefile` `-p 1` flag (re-enables default parallel-package execution
for `make test-integration`), and reverts the maintenance update to
`00005_integration_test.go`. No domain, application, or HTTP code is
affected.

### Deviations / issues found

1. **Pre-existing test `TestUsersMigrationDownDropsTable` regressed after
   adding the new FK** (`company_members.user_id → users.id`). Cause:
   the test mirrors goose's reverse-down order by manually listing the
   dependent tables to drop BEFORE `DROP TABLE users`, but it was written
   for 00006 only (`candidate_profiles` + `candidate_languages`).

   **Resolution (in scope as direct WU1 fallout):**
   - Added `DROP TABLE IF EXISTS company_members` to the reverse-down
     sequence (mirrors the existing pattern for `candidate_profiles`).
   - Added a `createCompanyMembersDDL` constant mirroring the new
     migration, and a re-create step in the same test so subsequent
     tests in the run still find `company_members` available.

   This is a ~7-line additive maintenance update, not Phase 2+ code, and
   is the minimal fix required to keep the integration suite green after
   WU1 lands. Without it, every subsequent run of
   `go test -tags=integration ./...` fails with
   `SQLSTATE 2BP01: cannot drop table users because other objects depend on it`.

2. **Parallel-package test interference.** After the 00005 test fix,
   the full `go test -tags=integration ./...` run still produced a race
   in `TestMigration00009DownDropsTable`: the 00005 test's DROP/CREATE
   cycle of `company_members` runs concurrently with the 00009 test's
   precondition check (Go runs each package's tests in its own binary,
   and by default runs package binaries in parallel). The race window is
   ~10–20ms.

   **Resolution (in scope as direct WU1 fallout):**
   - Added `-p 1` to the `test-integration` target in the `Makefile`.
     This forces serial package execution — the canonical fix for
     integration suites that share a single database.
   - This is a one-character Makefile change, not application code, and
     is the minimal fix to keep `make test-integration` deterministic
     after WU1 lands.

   Without this flag, `make test-integration` would pass on some
   machines and fail intermittently on others depending on timing — a
   CI-time footgun introduced by WU1's new schema dependency.

3. **No new domain/application/handler code touched.** Verified by
   `git diff --stat backend/internal/features/{companies,identity}/{application,domain,infrastructure/http}`.
   The only files modified outside WU1's primary boundary are the 00005
   integration test (FK mirror) and the Makefile (parallel-package flag)
   — both direct WU1 consequences.

### Remaining tasks (Phase 2+ — OUT OF SCOPE for WU1)

- [ ] 2.1–2.9: MemberRole VO + CompanyMember entity + port + service
- [ ] 3.1–3.10: Postgres adapter + HTTP handler + `RequireCompanyRole` middleware
- [ ] 4.1–4.6: `/me/company` route mount + final wiring + verify + optional refactor

These are intentionally NOT touched by WU1 — the chained-PR split means
each work unit merges independently to `main` and the orchestrator will
launch `sdd-apply` for WU2/3/4 in subsequent sessions.

### Status

- **WU1 tasks completed**: 6 / 6 (1.1, 1.2, 1.3, 1.4, 1.5, 1.6)
- **Phase 1 status**: ✅ complete
- **Workload / PR boundary**: ~50 lines of authored SQL + ~190 lines of
  authored test code + ~165 lines of sqlc-generated code (excluded from
  the 400-line risk count per `work-unit-commits`) + ~48 lines of
  one-line maintenance updates to 00005 test and Makefile. Well under
  the 400-line review budget.
- **Tests green**: 4/4 WU1 tests + full pre-existing suite (unit +
  integration with `-p 1`)
- **No `git add` / `commit` / `push`**: orchestrator owns git per task contract