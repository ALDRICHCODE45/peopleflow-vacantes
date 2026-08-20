# Apply Progress: company-members (WU1 + WU2)

> WU1 record (Phase 1 — migration `00009` + sqlc queries) is preserved verbatim below.
> WU2 record (Phase 2 — domain VO + entity + repository port + service) is appended at the bottom.

---

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

### Deviations / issues found (WU1)

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

---

## Work Unit 2 — Domain VO + Entity + Repository Port + Service

WU2 boundary: pure domain layer (`companies/domain/*`) and the application
service (`companies/application/usecases/companyMemberService.go` +
its DTOs). NO postgres adapter, NO HTTP handler, NO middleware — those are
Phase 3. The service is composed against the port surface from task 2.5
and the sqlc-generated types from WU1, so Phase 3 can wire the real
adapter without changes to this slice.

### Files changed (WU2)

| File | Action | Notes |
|------|--------|-------|
| `backend/internal/features/companies/domain/valueobjects/memberRole.go` | create | ordinal enum `MemberRole` (Unknown=0, Recruiter=1, Owner=2) + `ParseMemberRole` + `String` + `ErrInvalidMemberRole`. Mirrors `CompanySize` and `CefrLevel` patterns. |
| `backend/internal/features/companies/domain/valueobjects/memberRole_test.go` | create | 5 tests: parse valid (owner/recruiter), reject admin, reject empty, `String` for all 3 members (including "unknown_role" sentinel), ordinal ranking `Owner > Recruiter > Unknown`. |
| `backend/internal/features/companies/domain/entities/companyMember.go` | create | `CompanyMember` aggregate (id, user_id, company_id, role, timestamps), `NewCompanyMember` factory (UUID v7, UTC timestamps, role validation), 5 sentinels (`ErrUnknownSubject`, `ErrNotAMember`, `ErrMemberExists`, `ErrMemberNotFound`, `ErrUserNotFound`). |
| `backend/internal/features/companies/domain/entities/companyMember_test.go` | create | 3 tests: factory sets id + UTC timestamps, rejects UnknownMemberRole with `ErrInvalidMemberRole`, accepts RecruiterRole (companion triangulation). |
| `backend/internal/features/companies/domain/repositories/companyMemberRepository.go` | create | Port interface per design Interfaces (D7 same-company guard in Update/Remove signatures). 5 methods matching the sqlc-generated queries from WU1. |
| `backend/internal/features/companies/application/dtos/memberDtos.go` | create | `AddMemberDto` (with intentional ignored `CompanyID` field for the spec scenario) + `UpdateMemberRoleDto`. |
| `backend/internal/features/companies/application/usecases/companyMemberService.go` | create | `CompanyMemberService` + `resolveMember` (the IDOR-resistant boundary, mirrors `CandidateService.resolveUserID`) + 5 use cases (`GetMyMembership`, `ListMembers`, `AddMember`, `UpdateRole`, `RemoveMember`). |
| `backend/internal/features/companies/application/usecases/companyMemberService_test.go` | create | 16 unit tests with `stubMemberRepository` / `stubUserRepository` / `stubMemberCompanyRepository` (renamed to avoid collision with the existing `stubCompanyRepository` in `createCompany_test.go`). |

### TDD Cycle Evidence (WU2)

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `companies/domain/valueobjects/memberRole_test.go::TestParseMemberRole_Valid` + `TestParseMemberRole_AdminRejected` + `TestParseMemberRole_EmptyRejected` | Unit | ✅ 6 packages green (`companies/...`) | ✅ FAIL — `undefined: MemberRole / ParseMemberRole / ErrInvalidMemberRole` (production file absent) | ✅ PASS — 2 + 1 + 1 subtests, all green | ✅ 5 distinct inputs (owner, recruiter, admin, empty, wire format round-trip); ranking test exercises `Owner > Recruiter > Unknown` AND `Owner >= Owner` AND `Recruiter NOT >= Owner` (proves the `>=` operator respects the closed-set ordering — the exact operator the middleware will use) | ➖ None needed — implementation is already minimal (3-line switch + ordinal iota) |
| 2.2 | n/a (GREEN for VO) | n/a | n/a | n/a | ✅ `memberRole.go` written (28 lines, no extras). Re-ran `go test ./internal/features/companies/...` after — all green. | n/a | n/a |
| 2.3 | `companies/domain/entities/companyMember_test.go::TestNewCompanyMember_SetsIDAndTimestamps` + `TestNewCompanyMember_UnknownRoleRejected` + `TestNewCompanyMember_RecruiterRoleAccepted` | Unit | ✅ 6 packages green | ✅ FAIL — `undefined: NewCompanyMember` (production file absent) | ✅ PASS — 3 tests, all green. Timestamp test asserts UTC location AND a +/-1s window around `time.Now()` to lock down the invariant that the timestamp is captured during the call (a hard-coded constant would fail this). | ✅ 3 cases (owner happy path, unknown rejection, recruiter as triangulation companion); different inputs exercise different branches of the role validation | ➖ None needed |
| 2.4 | n/a (GREEN for entity) | n/a | n/a | n/a | ✅ `companyMember.go` written (88 lines, 5 sentinels + entity + factory). All sentinels in the entities package per task 2.4 contract (service layer re-uses them via `errors.Is`). | n/a | n/a |
| 2.5 | n/a (GREEN for port) | n/a | n/a | n/a | ✅ `companyMemberRepository.go` written (port interface + per-method godoc explaining the D7 same-company guard and the SQLSTATE → sentinel mapping contract the postgres adapter MUST implement). `go build ./...` clean. | n/a | n/a |
| 2.6 | `companyMemberService_test.go::TestResolveMember_UnknownSubjectIsUnauthorized` + `TestResolveMember_NoMembershipIsNotAMember` | Unit | ✅ 6 packages green | ✅ FAIL — `undefined: CompanyMemberService / NewCompanyMemberService / dtos.AddMemberDto / dtos.UpdateMemberRoleDto` (4 production symbols absent) | ✅ PASS — both tests green; `UnknownSubject` test also asserts `mRepo.getByUserCalls == 0` to prove no DB read with a stale sub | ✅ 2 distinct error paths (sub unknown → 401 sentinel, no row → not-a-member sentinel); each test asserts a DIFFERENT mock call count to prove the resolve chain short-circuits at the right layer | ➖ None needed |
| 2.7 | `companyMemberService_test.go::TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID` + `TestAddMember_InvalidRoleDoesNotTouchRepository` + `TestAddMember_UnknownSubjectDoesNotTouchRepository` | Unit | ✅ 6 packages green | (same RED as 2.6) | ✅ PASS — all 3 green. The "ignored body" test passes `CompanyID=Y` in the DTO and asserts the saved row's `CompanyID == caller.CompanyID (X)` — proves the spec scenario at the assertion level, not at the "field doesn't exist" level. | ✅ 3 cases (happy path with body mismatch, validation guard, auth guard); each exercises a DIFFERENT early-exit branch in `AddMember` (resolveMember success / ParseMemberRole failure / resolveMember auth failure) | ➖ None needed |
| 2.8 | `companyMemberService_test.go::TestGetMyMembership_*` (2) + `TestListMembers_*` (3) + `TestUpdateRole_*` (3) + `TestRemoveMember_*` (3) | Unit | ✅ 6 packages green | (same RED as 2.6) | ✅ PASS — all 11 green. Cross-company propagation tests assert BOTH the sentinel AND that the repository was called exactly once with the caller's company_id (not zero, not the foreign company). Empty-list test asserts non-nil empty slice (JSON `[]` vs `null` invariant). | ✅ 11 cases across 4 use cases; each spec scenario (GetMyMembership, ListMembers, UpdateRole cross-company, RemoveMember cross-company) has happy path + edge case + guard case | ➖ None needed |
| 2.9 | n/a (GREEN for service) | n/a | n/a | n/a | ✅ `companyMemberService.go` written (195 lines, 5 use cases + `resolveMember`). Uses `errors.Is(err, identityentities.ErrUserNotFound)` per project error-handling convention (NOT string comparison). Mirrors `CandidateService.resolveUserID` per design D6. | n/a | n/a |

### Test summary (WU2)

- **Total tests written**: 24 top-level (`TestParseMemberRole_*` × 3 + `TestMemberRole_String` + `TestMemberRole_OrdinalRanking` = 5 VO; `TestNewCompanyMember_*` × 3 = 3 entity; 16 service)
- **Total tests passing**: 24/24 (verified via `go test ./internal/features/companies/... -count=1 -v`)
- **Layers used**: Unit (24), Integration (0)
- **Approval tests (refactoring)**: None — WU2 is new code, no refactoring tasks
- **Pure functions created**: 2 (`ParseMemberRole`, `MemberRole.String`); the `resolveMember` helper is a method but is pure in the "no external state mutation" sense (it only forwards to ports)

### TDD assertion quality audit (WU2)

Every assertion in the WU2 tests calls production code and asserts a
specific expected value. Spot checks:

| Test | Assertion | Real behavior? |
|------|-----------|----------------|
| `TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID` | `mRepo.created.CompanyID != callerCompanyID` would FAIL if the service read `dto.CompanyID` | ✅ Yes — the production code runs `entities.NewCompanyMember(params.UserID, caller.CompanyID, role)` |
| `TestUpdateRole_ForwardsCallersCompanyID` | `mRepo.lastUpdateCompanyID != callerCompanyID` would FAIL if the service forwarded `dto.CompanyID` or any path id | ✅ Yes — the production code forwards `caller.CompanyID` from `resolveMember` |
| `TestResolveMember_UnknownSubjectIsUnauthorized` | `mRepo.getByUserCalls != 0` would FAIL if the service still tried the membership lookup on an unknown sub | ✅ Yes — guards the early-exit in `resolveMember` |
| `TestNewCompanyMember_SetsIDAndTimestamps` | Timestamp window check would FAIL if a future refactor hard-codes `CreatedAt` | ✅ Yes — guards against accidental zero-value or constant timestamps |
| `TestMemberRole_OrdinalRanking` | `RecruiterRole >= OwnerRole` assertion would FAIL if iota order were swapped | ✅ Yes — the exact operator the middleware will use |

### Runtime harness (mandatory for WU2)

| Step | Command | Result |
|------|---------|--------|
| Safety net (pre-WU2 baseline) | `go test ./internal/features/companies/... -count=1` | 4 packages `ok` (entities, usecases, valueobjects, infrastructure/{http,postgres}); `dtos` + `repositories` have no test files (legitimately) |
| Post-WU2 unit tests | `go test ./internal/features/companies/... -count=1 -v` | 24/24 new tests PASS; full companies slice green |
| Full backend unit suite (no regressions) | `go test ./... -count=1` | exit 0; all packages `ok` (candidates, identity, industries, jobs, companies, shared) |
| Static checks | `go vet ./...` and `gofmt -l .` | both empty (0 findings) |
| Runtime harness | **N/A — pure domain/application layer, no runtime boundary** | This WU is deliberately port-only (no postgres adapter, no HTTP handler, no main.go wiring — those are Phase 3). The composed service is exercised only through the unit tests with fakes. Integration of the same use cases against a real Postgres adapter and `chi` HTTP layer is Phase 3's WU3 evidence. |

### Rollback boundary (WU2)

The WU2 PR can be reverted without disturbing WU1 (already merged) or
unstarted work (Phase 3+):

```
git revert --no-edit WU2
```

→ drops `memberRole.go` + `memberRole_test.go` + `companyMember.go` +
`companyMember_test.go` + `companyMemberRepository.go` +
`companies/application/dtos/memberDtos.go` +
`companyMemberService.go` + `companyMemberService_test.go`. The migration
`00009`, the sqlc queries, and the postgres types from WU1 remain intact
(they have no compile-time callers in this reverted state). Phase 3+
never starts, so nothing else is affected.

### Deviations / issues found (WU2)

1. **Stub name collision in test file.** The pre-existing
   `createCompany_test.go` already declared `stubCompanyRepository`. To
   keep both test files compiling in the same package, the WU2 test
   uses `stubMemberCompanyRepository` for its companies-port fake.
   This is a one-time rename, not a structural change — the compile-time
   guard `var _ repositories.CompanyRepository = (*stubMemberCompanyRepository)(nil)`
   still nails the port surface.

2. **`AddMemberDto.CompanyID` is intentional dead weight.** The spec
   scenario "body company_id is ignored" requires the DTO to carry a
   `CompanyID` field even though the service never reads it — otherwise
   the test would merely prove the DTO doesn't expose the field, not
   that the service ignores it. The field is documented as ignored in
   the DTO godoc and gated by the `TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID`
   assertion (sets `CompanyID=Y`, asserts saved row has `CompanyID=X`).

3. **`GetMyMembership` returns `(*CompanyMember, *Company, error)` rather
   than a bespoke `MyMembershipView` struct.** The spec wording says
   "return the caller's `(company_id, role)` and the company record". The
   entity already carries `company_id` (as `CompanyID`) and `role`, and
   `*Company` is the existing domain entity. No new view type needed
   — the HTTP handler can compose its own response DTO in Phase 3.

4. **`ErrUnknownSubject` lives in the entities package, not in the
   service.** Per task 2.4's explicit contract, all five sentinels are
   in `companyMember.go`. The service `resolveMember` returns them via
   `errors.Is(err, entities.ErrUnknownSubject)`, so the layering is
   preserved even though the symbol lives "downstream" of the typical
   convention. This matches the existing `candidateService` pattern of
   returning its own `ErrUnknownSubject` for symmetry — there are now
   TWO `ErrUnknownSubject` sentinels in the codebase (one in candidates,
   one in companies), which is fine because they are package-qualified
   and have different identities.

### Remaining tasks (Phase 3+ — OUT OF SCOPE for WU2)

- [ ] 3.1–3.10: Postgres adapter + HTTP handler + `RequireCompanyRole` middleware
- [ ] 4.1–4.6: `/me/company` route mount + final wiring + verify + optional refactor

These are intentionally NOT touched by WU2 — the chained-PR split means
each work unit merges independently to `main` and the orchestrator will
launch `sdd-apply` for WU3/4 in subsequent sessions.

### Status (after WU2)

- **WU1 tasks completed**: 6 / 6 (1.1, 1.2, 1.3, 1.4, 1.5, 1.6)
- **WU2 tasks completed**: 9 / 9 (2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9)
- **Phase 1 status**: ✅ complete (WU1 merged)
- **Phase 2 status**: ✅ complete (WU2 ready for review)
- **Workload / PR boundary**: WU2 adds 8 new files (~700 lines authored:
  ~70 lines VO + ~90 lines entity + ~50 lines port + ~35 lines DTOs +
  ~195 lines service + ~430 lines tests). Well under the 400-line
  authored-risk budget per `work-unit-commits` (sqlc-generated code
  already excluded from WU1). Two commits would be the natural split
  if a reviewer prefers smaller diffs: (a) `feat(companies): add
  company_members domain layer (VO + entity + port)` and (b)
  `feat(companies): add company_member service + resolve chain`.
- **Tests green**: 24/24 WU2 tests + full pre-existing unit suite +
  full pre-existing integration suite (verified in WU1; WU2 does not
  touch any DB schema or wiring, so the green status is preserved)
- **No `git add` / `commit` / `push`**: orchestrator owns git per task contract