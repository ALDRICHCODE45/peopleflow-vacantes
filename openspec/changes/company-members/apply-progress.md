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
---

## Work Unit 3 — Postgres adapter + HTTP handler

WU3 boundary: `companies/infrastructure/postgres/companyMemberRepository.go`
+ `companies/infrastructure/http/memberHandler.go` (and tests for each).
The WU1 sqlc layer (already merged) is consumed unchanged. The WU2
domain layer (already merged) is composed unchanged — the adapter and
handler implement the ports/use cases without touching them. Note that
**3.7 / 3.8 (CompanyContext) shipped in the prior partial apply at
commit `459cbb5`**, ahead of the planned WU4 boundary; the test file is
in the codebase and the production file is committed, so this WU only
needs to land the adapter + handler (the rest of WU4 is
`RequireCompanyRole` middleware + `main.go` wiring, which remain in
scope for the next apply session).

### Files changed (WU3)

| File | Action | Notes |
|------|--------|-------|
| `backend/db/queries/company_members.sql` | modify (sqlc regen) | `-- name: UpdateMemberRole :execrows` and `-- name: RemoveCompanyMember :execrows` — sqlc `:exec` doesn't expose rows-affected, so we switched to `:execrows` (returns `(int64, error)`) so the adapter can map 0 rows → `ErrMemberNotFound` (design D7 same-company guard). Required to satisfy task 3.2's runtime proof. |
| `backend/internal/db/company_members.sql.go` | regenerate | sqlc-generated method bodies + params (NOT hand-edited). |
| `backend/internal/db/querier.go` | regenerate | `Querier` interface methods updated to the new return shape (`int64` for UpdateMemberRole / RemoveCompanyMember). |
| `backend/internal/features/companies/infrastructure/postgres/companyRepository.go` | modify | Renamed existing `mapCreateError` → `mapCompanyCreateError` to free the package-level name for the member-specific mapper (same SQLSTATE codes mean different domain sentinels on different tables; collapsing them would be wrong). Updated the single call site in `CompanyRepository.Create`. |
| `backend/internal/features/companies/infrastructure/postgres/companyRepository_test.go` | modify | Renamed the corresponding `TestMapCreateError` → `TestMapCompanyCreateError`, `TestMapCreateError_NonPgErrorIsNotCoerced` → `TestMapCompanyCreateError_NonPgErrorIsNotCoerced`, plus the 8 call sites inside the table-driven test. |
| `backend/internal/features/companies/infrastructure/postgres/companyMemberRepository.go` | create | The pgx adapter implementing `repositories.CompanyMemberRepository` (5 methods). Includes `mapCreateError` (member-specific, 23505→ErrMemberExists, 23503→ErrUserNotFound, pass-through otherwise), `buildCreateMemberParams`, `memberToEntity`, `pgTimestamptzToTime`. Compile-time assertion `var _ repositories.CompanyMemberRepository = (*CompanyMemberRepository)(nil)` nails the port surface. Helper names suffixed to avoid collision with the company repo's `buildCreateParams` / `toEntity` / `pgTimestamptzToTimePtr` (same package, different helpers). |
| `backend/internal/features/companies/infrastructure/postgres/companyMemberRepository_mapCreateError_test.go` | already present | The RED test for task 3.1 — was untracked before WU3, now exercised alongside the rest of the package. |
| `backend/internal/features/companies/infrastructure/postgres/companyMemberRepository_integration_test.go` | create | Integration tests for tasks 3.2 + 3.3 runtime proof: `TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound`, `TestUpdateRole_SameCompanyUpdatesRow`, `TestRemove_CrossCompanyAffectsZeroRowsReturnsNotFound`, `TestRemove_SameCompanyDeletesRow`. Uses a `pgxpool.Begin`-based fixture (always rolled back), seeds industry + 2 companies + 2 users + 2 member rows (one on each company) so the cross-company tests target a foreign row with the caller's company_id (the only way the SQL guard actually rejects). |
| `backend/internal/features/companies/infrastructure/http/memberHandler.go` | create | `MemberHandler` with `Routes()` mounting `GET /`, `GET /members`, `POST /members`, `PATCH /members/{id}`, `DELETE /members/{id}` under `/me/company`. Composes against `CompanyMemberService` (NOT raw sqlc). Includes `classifyMemberError` (flat `errors.Is` dispatcher per the existing `classifyCreateCompanyError` pattern) and `requireSub` (mirrors the candidate handler's pattern). The list endpoint remaps `ErrNotAMember` to 403 (spec scenario "non-member is rejected"). |
| `backend/internal/features/companies/infrastructure/http/memberHandler_classify_test.go` | create | Table-driven unit test for `classifyMemberError`: 9 subtests (5 sentinels + unknown + 2 wrapped-error paths). |
| `backend/internal/features/companies/infrastructure/http/memberHandler_test.go` | create | HTTP handler tests via `httptest` + `chi.NewRouter`. 14 tests covering every spec scenario in tasks 3.5 — `GET /me/company` (200/404/401), `GET /me/company/members` (200/403 + empty-`[]` invariant), `POST` (201/409/400/invalid-JSON), `PATCH` (200/404), `DELETE` (204/invalid-UUID). Tests inject the JWT subject via `identitysecurity.ContextWithClaims` to bypass `RequireAuth` (WU4 will exercise the real middleware chain). |

### TDD Cycle Evidence (WU3)

| Task | Test file | Layer | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|-----|-------|-------------|----------|
| 3.1 | `postgres/companyMemberRepository_mapCreateError_test.go::TestMapCreateError_*` (9 subtests, all unit) | Unit | ✅ FAIL — test file calls `mapCreateError(nil)` etc.; the only package-level `mapCreateError` was the company-repo one (mapping 23505→`ErrDuplicateCompany`, 23503→`ErrIndustryNotFound`). RED observed: `expected ErrMemberExists for 23505, got: a company with the same RFC already exists` and the four companion FAILs. | ✅ PASS — renamed `mapCreateError` → `mapCompanyCreateError` in `companyRepository.go` (call site + tests updated), then added a new `mapCreateError` in `companyMemberRepository.go` mapping 23505→`ErrMemberExists`, 23503→`ErrUserNotFound`. All 9 subtests green. | ✅ 9 distinct inputs exercise the nil guard, the two SQLSTATE codes (UNIQUE + FK), the wrapped-error chains (proves `errors.As` works through `%w`), the unrelated SQLSTATE pass-through, the non-pg error pass-through (twice — once identity, once message-preservation) | ➖ None needed |
| 3.2 | `postgres/companyMemberRepository_integration_test.go::TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound` (and the 3 companion tests) | Integration (`-tags=integration`) | ✅ FAIL (build-time) — the production adapter `companyMemberRepository.go` did not exist; the test file references `NewCompanyMemberRepository`, `repo.UpdateRole`, `repo.Remove`, `repo.ListByCompanyID`, `repo.GetMembershipByUserID`. The integration suite skipped the tests with `DATABASE_URL not set` until the env was sourced, at which point the package failed to build. | ✅ PASS — adapter implemented; sqlc `:exec` upgraded to `:execrows` so the adapter can read `RowsAffected()` and surface 0 rows as `ErrMemberNotFound`. 4/4 tests green against the live DB. | ✅ 2 cross-company tests (Update + Remove) prove the SQL guard rejects; 2 same-company tests (Update + Remove) prove the guard doesn't over-reject. Each scenario asserts BOTH the sentinel AND that the row count didn't drift — a leak past the guard would surface as a count mismatch, not just an error code mismatch. | ➖ None needed |
| 3.3 | (the GREEN half of 3.2) | Production code | n/a | ✅ `companyMemberRepository.go` written (261 lines). Includes the 5 port methods, `mapCreateError` (member-specific), `buildCreateMemberParams`, `memberToEntity`, `pgTimestamptzToTime`. Compile-time guard nails the port surface. The `UpdateRole` / `Remove` bodies check the rows-affected count from `:execrows`; cross-company targets surface `ErrMemberNotFound` per design D7. | n/a | n/a |
| 3.4 | `http/memberHandler_classify_test.go::TestClassifyMemberError_MappingTable` (9 subtests) | Unit | ✅ FAIL (build-time) — `undefined: classifyMemberError`. The handler test file references the function in 1 line; the test file references it in 9 subtests. | ✅ PASS — `classifyMemberError` defined in `memberHandler.go` as a flat `errors.Is` chain with 6 sentinel branches + 1 default. All 9 subtests green. | ✅ 6 sentinel mappings + 1 unknown-error fallthrough + 2 wrapped-error chains. Each subtest asserts both the status code AND the message string — a sloppy implementation that returned the right status with the wrong message would still FAIL. | ➖ None needed |
| 3.5 | `http/memberHandler_test.go` (14 tests) | Unit | ✅ FAIL (build-time) — `undefined: NewMemberHandler`, `undefined: memberResponse`, `undefined: listMembersResponse`. The handler did not exist; the test file referenced the symbols at 4 call sites. | ✅ PASS — `MemberHandler` + `Routes()` + 5 handler methods defined in `memberHandler.go`. 14/14 handler tests green; 13 + 2 (req. bodies) cover every spec scenario in the task description. | ✅ Every endpoint has at least 3 scenarios: happy path + missing-membership path + invalid-input path. POST also gets the duplicate-user (409) and invalid-JSON (400) paths; DELETE also gets the invalid-UUID (400) path. The list endpoint gets the empty-`[]` invariant test (a JSON-level defense against the "non-nil empty slice" contract). | ➖ None needed |
| 3.6 | (the GREEN half of 3.4 + 3.5) | Production code | n/a | ✅ `memberHandler.go` written (412 lines). Routes use `chi.NewRouter()` (NOT a custom mux); the handler composes against the service (NOT raw sqlc); the wire shapes are independent struct types (`memberResponse`, `companySummaryResponse`, `myMembershipResponse`, `listMembersResponse`) to avoid coupling to the existing company handler's shapes. `requireSub` reads `identitysecurity.ClaimsFromContext`; the JWT subject is the only identifier the handler trusts. | n/a | n/a |

### Test summary (WU3)

- **Total tests written**: 27 top-level
  - Unit: 23 (`mapCreateError` × 9 + `classifyMemberError` × 9 + handler behavior × 13, with 8 of those being subtests of one parent; after deduplication by `t.Run` block, 23 distinct top-level funcs)
  - Integration: 4 (`UpdateRole_CrossCompany`, `UpdateRole_SameCompany`, `Remove_CrossCompany`, `Remove_SameCompany`)
- **Total tests passing**: 27/27 (verified `go test ./... -count=1` for unit + `make test-integration` for integration)
- **Layers used**: Unit (23), Integration (4)
- **Approval tests (refactoring)**: None — WU3 is new code, no refactoring tasks
- **Pure functions created**: 6 (`mapCreateError`, `mapCompanyCreateError` [rename], `buildCreateMemberParams`, `memberToEntity`, `pgTimestamptzToTime`, `classifyMemberError`, `requireSub`, `toMemberResponse`, `toMyMembershipResponse`, `toCompanySummaryResponse`, `toListMembersResponse`)

### TDD assertion quality audit (WU3)

Every assertion in the WU3 tests calls production code and asserts a
specific expected value. Spot checks:

| Test | Assertion | Real behavior? |
|------|-----------|----------------|
| `TestGetMyCompany_OwnerReturns200` | `resp.Role != "owner"` would FAIL if the handler hardcoded `"recruiter"` or fell back to the zero value | ✅ Yes — `m.Role.String()` reads from the entity |
| `TestListMembers_EmptyListIsEmptyJSONArray` | `body != "{\"members\":[]}"` would FAIL if the handler returned a nil slice (encodes as `null`) | ✅ Yes — `toListMembersResponse` always returns `make([]memberResponse, 0, len(in))` |
| `TestAddMember_DuplicateReturns409` | `rec.Code != 409` would FAIL if `mapCreateError` was mis-wired or `classifyMemberError` had a wrong branch | ✅ Yes — exercise the full `repo → service → handler → classifier → 409` chain |
| `TestUpdateRole_CrossCompanyReturns404` | `rec.Code != 404` would FAIL if the handler propagated `ErrMemberNotFound` to 500 or if `classifyMemberError` lacked that branch | ✅ Yes — same chain |
| `TestRemoveMember_OwnerReturns204` | `rec.Body.Len() != 0` would FAIL if the handler sent any response body on the 204 path (against HTTP semantics) | ✅ Yes |
| `TestMapCreateError_Wrapped23505StillResolves` | `!errors.Is(got, entities.ErrMemberExists)` would FAIL if the adapter used `==` instead of `errors.As` to unwrap the pgErr chain | ✅ Yes — guards the wrapping contract |
| `TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound` | `countMemberRows(ctx, t, repo, foreignCompanyID) != 1` would FAIL if a leaked UPDATE on the foreign row touched it | ✅ Yes — proves the SQL guard rejected the write, not just that the error was returned |

### Runtime harness (mandatory for WU3)

| Step | Command | Result |
|------|---------|--------|
| Pre-WU3 baseline (post-WU2) | `go test ./... -count=1` | exit 0; all packages `ok` |
| sqlc regen | `go tool sqlc generate` | exit 0; `company_members.sql.go` + `querier.go` regenerated; new methods return `(int64, error)` |
| Post-WU3 unit tests | `go test ./... -count=1` | exit 0; all 26 packages `ok` |
| Post-WU3 integration tests | `make test-integration` | exit 0; all packages `ok` (4 new `companyMemberRepository_integration_test.go` cases green) |
| Static checks | `go vet ./...` | exit 0; zero findings |
| Static checks | `gofmt -l .` (after `gofmt -w .`) | exit 0; zero findings |
| Build | `go build ./...` | exit 0; clean |
| Targeted re-run | `go test -v ./internal/features/companies/infrastructure/postgres/ -count=1` | 26 PASS (9 mapCreateError + 11 company toEntity/buildParams + 6 mapCompanyCreateError) |
| Targeted re-run | `go test -v ./internal/features/companies/infrastructure/http/ -count=1` | 27 PASS (12 company-handler + 9 classifyMemberError subtests + 14 handler behavior; after dedup, 27 distinct funcs) |
| Targeted re-run | `go test -v -tags=integration ./internal/features/companies/infrastructure/postgres/ -count=1` | 4 PASS (cross-company + same-company for Update + Remove) |

### Rollback boundary (WU3)

The WU3 PR can be reverted without disturbing WU1 (already merged),
WU2 (already merged), or unstarted work (3.9/3.10/4.x — Phase 4):

```
git revert --no-edit WU3
```

→ drops `companyMemberRepository.go` + `_integration_test.go` +
`memberHandler.go` + `memberHandler_test.go` +
`memberHandler_classify_test.go`. Reverts the sqlc `:exec` → `:execrows`
change (no schema impact, but the regen diff goes away). Reverts the
`mapCreateError` → `mapCompanyCreateError` rename in `companyRepository.go`
and its test. The WU1 migration + sqlc base queries + WU2 domain layer +
WU2 service + WU3 (3.7/3.8) `CompanyContext` remain intact — they have
no compile-time callers in this reverted state. Phase 4 never starts,
so nothing else is affected.

### Deviations / issues found (WU3)

1. **`mapCreateError` name collision.** Both adapters
   (`companyRepository.go` and `companyMemberRepository.go`) live in the
   same `postgres` package and both need a SQLSTATE → sentinel mapper.
   Same SQLSTATE codes (23505, 23503) mean different domain errors on
   different tables, so collapsing them into one mapper would be wrong.

   **Resolution:** renamed the company adapter's `mapCreateError` →
   `mapCompanyCreateError` (call site + 2 tests updated). The new
   member adapter keeps the original `mapCreateError` name — its
   existing RED test (already untracked) drives that name choice. Same
   applies to the `companyResponse` / `toCompanyResponse` collision in
   the `http` package; resolved by renaming the member-handler
   counterparts to `companySummaryResponse` / `toCompanySummaryResponse`.

2. **`sqlc :exec` doesn't return rows-affected.** The original WU1
   queries annotated `UpdateMemberRole` and `RemoveCompanyMember` as
   `:exec`, which sqlc compiles to a method returning only `error` —
   the `CommandTag` is discarded. To check `RowsAffected()` and surface
   0 rows as `ErrMemberNotFound` (design D7), I switched both queries
   to `:execrows`. The regenerated methods now return `(int64, error)`.

   **Resolution:** one-character change per query in
   `db/queries/company_members.sql`, followed by `go tool sqlc
   generate`. The `memberQuerier` interface in the adapter was updated
   in lockstep. No hand-editing of generated code. The query text and
   parameter shape are otherwise identical — no behavioral diff for
   non-zero rows-affected paths.

3. **Initial cross-company integration test was wrong.** First
   version of `TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound`
   passed `callerCompanyID` with a member row that ALSO lived on
   `callerCompanyID` — the same-company path, not the cross-company
   path. The test would have passed on the wrong reason (the SQL
   guard doesn't reject same-company updates).

   **Resolution:** fixed the fixture to seed TWO member rows — one on
   the caller company (role=owner) and one on a foreign company
   (role=recruiter). The cross-company tests now target the foreign
   row with the caller's `company_id`; the SQL predicate
   `WHERE id=$1 AND company_id=$2` evaluates to 0 rows → real cross-
   company rejection.

4. **Member-package test reuses the company adapter's fake
   naming.** The handler tests' `stubMemberRepositoryForHandler` /
   `stubUserRepositoryForHandler` / `stubMemberCompanyRepositoryForHandler`
   types mirror the service-test stubs but with the `ForHandler` suffix
   to avoid collision. The existing service-test stubs cannot be
   reused because they live in the `usecases` package, not `http`.

   **Resolution:** a one-time naming-suffix, not a structural change.
   The compile-time guard `var _ repositories.CompanyMemberRepository =
   (*stubMemberRepositoryForHandler)(nil)` (implicit through method
   satisfaction) still nails the port surface.

5. **List-endpoint `ErrNotAMember → 403` mapping is a route-specific
   override.** The flat `classifyMemberError` dispatcher returns 404
   for `ErrNotAMember` (the GetMyMembership view); the list endpoint
   checks `errors.Is(err, entities.ErrNotAMember)` after the dispatch
   and remaps to 403 (the spec scenario "non-member is rejected").

   **Resolution:** the remap lives inside `listMembers`, not in the
   classifier, so the table-driven test for `classifyMemberError` can
   assert the default 404 mapping without per-route coupling. The
   production wiring (WU4) will layer `RequireCompanyRole(recruiter)`
   on this route, which produces 403 for non-members BEFORE the handler
   runs — the in-handler remap is a defensive fall-through, not the
   primary boundary.

6. **Out-of-WU3 work landed early.** Tasks 3.7 / 3.8 (CompanyContext
   type + helpers) shipped in the prior partial apply at commit
   `459cbb5`. They are NOT touched by this WU3 — the file is committed
   and the tests are green, so nothing needs to change. The remaining
   WU3 boundary (3.9 / 3.10 — RequireCompanyRole middleware + main.go
   wiring) is intentionally NOT touched; it belongs to WU4.

### Remaining tasks (WU4 — OUT OF SCOPE for WU3)

- [ ] 3.9: `RequireCompanyRole` middleware tests
- [ ] 3.10: `RequireCompanyRole` middleware production code
- [ ] 4.1–4.6: route mount, final wiring, regression verification

### Status (after WU3)

- **WU1 tasks completed**: 6 / 6 (1.1, 1.2, 1.3, 1.4, 1.5, 1.6)
- **WU2 tasks completed**: 9 / 9 (2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9)
- **WU3 tasks completed**: 6 / 6 (3.1, 3.2, 3.3, 3.4, 3.5, 3.6) — plus 3.7/3.8 already landed from prior partial apply
- **Phase 1 status**: ✅ complete (WU1 merged at `28c866e`)
- **Phase 2 status**: ✅ complete (WU2 merged at `9ccc9cd` + `3a93ec9`)
- **Phase 3 status**: ✅ complete (WU3 ready for review; 3.7/3.8 already in tree at `459cbb5`)
- **Workload / PR boundary**: WU3 adds 5 new files (~1,760 lines: 261 adapter + 145 unit test + 239 integration test + 412 handler + 107 classifier test + 597 handler test) plus 3 small modifications (sqlc `:exec` → `:execrows` in 2 queries, `mapCreateError` → `mapCompanyCreateError` rename in 1 file, 1 test file rename to follow the helper). Well over the 400-line authored-risk budget per `work-unit-commits` — natural split: (a) `feat(companies): company_member_repository pgx adapter (3.1/3.2/3.3)` and (b) `feat(companies): /me/company HTTP handler + error classifier (3.4/3.5/3.6)`.
- **Tests green**: 27/27 WU3 tests + full pre-existing unit suite (26 packages) + full pre-existing integration suite (`make test-integration` exit 0)
- **No `git add` / `commit` / `push`**: orchestrator owns git per task contract

---

## Work Unit 4 — RequireCompanyRole middleware + main.go wiring

WU4 boundary: `identity/infrastructure/http/requireCompanyRole.go` +
its tests, `cmd/api/main.go` wiring, and a minimal additive accessor on
`MemberHandler` to support per-route role gates. Tasks 3.7/3.8
(`CompanyContext` type + helpers) shipped in WU3 / commit `459cbb5`
ahead of the planned boundary; this WU only consumes that seam.

### Files changed (WU4)

| File | Action | Notes |
 |
|------|--------|-------|
| `backend/internal/features/identity/infrastructure/http/requireCompanyRole.go` | create | The middleware. Signature per design Interfaces: `func RequireCompanyRole(users identityrepositories.UserRepository, members companiesrepositories.CompanyMemberRepository, minRole valueobjects.MemberRole) func(http.Handler) http.Handler`. Port-only imports (design D5): `companies/domain/repositories` + `companies/domain/entities` + `companies/domain/valueobjects` + `identity/domain/repositories` + `identity/domain/security` — NEVER an infrastructure adapter. Resolves `sub → users.id → company_members` exactly once per request. Error mapping: unknown sub → 401, `ErrNotAMember` → 403, `role < minRole` → 403, other → 500 (logged). Injects `CompanyContext{company_id, role}` on success and calls next. Defense-in-depth: rejects 401 if no `Claims.Subject` in the context (mismounted/mis-wired case). |
| `backend/internal/features/identity/infrastructure/http/requireCompanyRole_test.go` | create | 7 unit tests covering the 4 spec scenarios (owner passes recruiter gate, recruiter under owner is 403 + handler not invoked, non-member is 403, unknown sub is 401) plus 3 triangulation companions (owner under owner gate = pass, recruiter under recruiter gate = pass, missing Claims = 401). Uses `stubUserRepo` + `stubMemberRepo` (minimal fakes with compile-time guards `var _ identityrepositories.UserRepository = (*stubUserRepo)(nil)` + `var _ repositories.CompanyMemberRepository = (*stubMemberRepo)(nil)`). Asserts both `users.getCalls` and `members.resolveCalls` counts to prove the resolver short-circuits at the right layer. |
| `backend/internal/features/identity/infrastructure/http/requireCompanyRoleRoutes_test.go` | create | 4 route-mount tests (tasks 4.1/4.2 + 2 triangulation companions) wiring a real chi router with `RequireAuth(denyAllVerifier)` + `RequireCompanyRole(...)` + the WU3 MemberHandler. `denyAllVerifier` is locally defined (the one in cmd/api/main.go is private to package main). Asserts both the HTTP status AND that the handler is/isn't invoked, with `handlerInvoked bool` flag. The owner-caller triangulation proves the chain doesn't over-gate. |
| `backend/internal/features/companies/infrastructure/http/memberHandler.go` | modify (additive) | Added `type MemberHandlers struct { GetMyMembership, ListMembers, AddMember, UpdateMemberRole, RemoveMember http.HandlerFunc }` and `func (h *MemberHandler) MemberHandlers() MemberHandlers` — exposes each endpoint as an `http.HandlerFunc` so the composition root can apply per-method `r.With(requireOwner|requireRecruiter)` middleware. The existing `Routes()` method is untouched (it's the surface the WU3 handler unit tests use). This is the minimum additive change needed to satisfy the spec's per-route gate requirement; the task explicitly acknowledges "do NOT rewrite it unless the spec/tasks require a change" — and the per-route gates do require it. |
| `backend/cmd/api/main.go` | modify (additive) | Added `identityUserRepo` (moved up before the companies wiring), wired `postgres.NewCompanyMemberRepository(queries)` + `usecases.NewCompanyMemberService(memberRepo, identityUserRepo, companyRepo)` + `companieshttp.NewMemberHandler(memberService)`. Mounted `/me/company` inside the existing `r.Route("/me", ...)` RequireAuth subtree using `memberHandler.MemberHandlers()` + per-route gates: `GET /company` ungated; `GET /company/members` gated recruiter; `POST/PATCH/DELETE /company/members[/...]` gated owner. Added `valueobjects` import. |

### TDD Cycle Evidence (WU4)

| Task | Test file | Layer | RED | GREEN | TRIANGULATE | REF |
|
|------|-----------|-------|-----|-------|-------------|------|
| 3.9 | `requireCompanyRole_test.go::TestRequireCompanyRole_OwnerPassesRecruiterGate` + `..._RecruiterUnderOwnerIsForbidden` + `..._NonMemberIsForbidden` + `..._UnknownSubIsUnauthorized` | Unit | ✅ FAIL (build-time) — `undefined: RequireCompanyRole` at 7 call sites | ✅ PASS — all 4 spec scenarios green; each test asserts BOTH the status AND that the handler isn't invoked (recruiter-under-owner + non-member + unknown-sub) | ✅ 4 scenarios exercise 4 distinct branches in `RequireCompanyRole`: missing-Claims, ErrUserNotFound, ErrNotAMember, role < minRole, plus 2 role-comparison boundary cases (owner ≥ owner, recruiter ≥ recruiter) | ➖ None needed |
| 3.10 | (the GREEN half of 3.9) | Production code | n/a | ✅ `requireCompanyRole.go` written (116 lines). Port-only imports confirmed: no `companies/infrastructure/...` import. Compile-time guard via the typed `identityrepositories.UserRepository` + `companiesrepositories.CompanyMemberRepository` parameters. Per the design, role comparison uses `member.Role < minRole` against the ordinal `MemberRole`. | n/a | n/a |
| 4.1 | `requireCompanyRoleRoutes_test.go::TestRoutes_MissingAuthHeaderIsUnauthorized` (subtests `/me/company` + `/me/company/members`) | Unit | ✅ FAIL (build-time) — `undefined: denyAllVerifier`, `cannot use chi.Router as http.HandlerFunc`, etc. | ✅ PASS — both subtests green; denyAllVerifier rejects every request with 401, handler NOT invoked (a `t.Error` callback would fire if it were) | ✅ 2 paths exercise the same contract (`/me/company` ungated view + `/me/company/members` gated view); each proves RequireAuth blocks pre-handler | ➖ None needed |
| 4.2 | `requireCompanyRoleRoutes_test.go::TestRoutes_RecruiterCannotCallAddMember` | Unit | (same RED as 4.1) | ✅ PASS — recruiter under owner gate returns 403, handler NOT invoked, `members.resolveCalls == 1` (middleware resolved once before deciding) | ✅ Companion `TestRoutes_OwnerCanCallAddMember` proves the chain doesn't over-gate — owner under owner reaches the handler. Combined: the chain's 401/403 boundary is symmetric. | ➖ None needed |
| 4.3 | (the GREEN half of 4.1/4.2) | Production code | n/a | ✅ `cmd/api/main.go` wired: imports `valueobjects`, wires `memberRepo`/`memberService`/`memberHandler`, mounts 5 routes with `r.With(requireOwner|requireRecruiter)` + `r.Get(...)` (no gate for the ungated path). `go build ./...` clean. | n/a | n/a |
| 4.4 | Full unit suite (`go test ./... -count=1`) + full integration suite (`make test-integration`) | Both | ✅ ALL GREEN | ✅ ALL GREEN — see Runtime harness below | n/a | n/a |
| 4.5 | `go vet ./...` + `gofmt -l .` | Static | ✅ Both empty (zero findings after `gofmt -w` on 3 new files) | ✅ Both empty | n/a | n/a |
| 4.6 | `classifyMemberError` (handler) vs `respondForbidden`/`respondServerError` (middleware) — see Deviations #1 | n/a | n/a | n/a | n/a | ➖ **No clean seam** — see Deviations #1 |

### Test summary (WU4)

- **Total tests written**: 11 top-level (7 middleware + 4 route-mount, with 2 of the route-mount using `t.Run` subtests for a total of 6 distinct executable cases)
- **Total tests passing**: 11/11 (verified `go test ./internal/features/identity/infrastructure/http/... -count=1 -v -run 'TestRequireCompanyRole|TestRoutes'`)
- **Layers used**: Unit (11), Integration (0 — task 3.2's integration coverage from WU3 already exercises the membership path; the new middleware is pure HTTP authz with no DB)
- **Approval tests (refactoring)**: None — task 4.6 was skipped after analysis (no clean seam; see Deviations #1)
- **Pure functions created**: 0 (the middleware is a closure-based factory; the response helpers `respondForbidden`/`respondServerError` are tiny utilities that mirror the existing `respondUnauthorized`)

### TDD assertion quality audit (WU4)

Every assertion in the WU4 tests calls production code and asserts a
specific expected value. Spot checks:

| Test | Assertion | Real behavior? |
|------|-----------|----------------|
| `TestRequireCompanyRole_OwnerPassesRecruiterGate` | `users.getCalls != 1` would FAIL if the middleware skipped the user lookup | ✅ Yes — proves the resolver runs the full chain |
| `TestRequireCompanyRole_UnknownSubIsUnauthorized` | `members.resolveCalls != 0` would FAIL if the middleware leaked a membership lookup with an unknown sub | ✅ Yes — guards the IDOR-resistant boundary |
| `TestRequireCompanyRole_MissingClaimsIsUnauthorized` | `users.getCalls != 0` would FAIL if the middleware ran the resolver chain with an empty subject | ✅ Yes — defense-in-depth: never run with no Claims |
| `TestRoutes_RecruiterCannotCallAddMember` | `handlerInvoked == true` would FAIL if a future refactor let the request through the role gate | ✅ Yes — the gate is the ONLY barrier |
| `TestRoutes_OwnerCanCallAddMember` | `rec.Code == 403 \|\| 401` would FAIL if the chain over-gated | ✅ Yes — guards the role >= boundary through the real router |

### Runtime harness (WU4)

| Step | Command | Result |
|------|---------|--------|
| Pre-WU4 baseline (post-WU3) | `go test ./... -count=1` | exit 0; all packages `ok` |
| Post-WU4 unit tests | `go test ./... -count=1` | exit 0; 27 packages `ok` |
| Post-WU4 unit tests (verbose, new code) | `go test -v -count=1 ./internal/features/identity/infrastructure/http/ -run 'TestRequireCompanyRole\|TestRoutes'` | 13 PASS (7 middleware + 4 route-mount top-levels, with subtest split for `MissingAuth`) |
| Post-WU4 integration tests | `make test-integration` | exit 0; all packages `ok` (4 new `companyMemberRepository_integration_test.go` cases from WU3 still green; no new integration tests in WU4) |
| Static checks | `go vet ./...` | exit 0; zero findings |
| Static checks | `gofmt -l .` | exit 0; zero findings (after one `gofmt -w` pass on 3 new files) |
| Build | `go build ./...` | exit 0; clean |
| Targeted re-run | `go test -v -count=1 ./internal/features/identity/infrastructure/http/` | 27 PASS (6 RequireAuth + 7 RequireCompanyRole + 2 CompanyContext round-trip + 4 Routes + 8 other middlewares from the existing test files) |
| Targeted re-run | `go test -v -count=1 ./internal/features/companies/infrastructure/http/` | 27 PASS (handler tests from WU3 still green; the new `MemberHandlers()` accessor is type-only and doesn't affect the existing test surface) |

### Rollback boundary (WU4)

The WU4 changes can be reverted without disturbing WU1/WU2/WU3
(already merged):

```
git revert --no-edit WU4
```

→ drops `requireCompanyRole.go` + `requireCompanyRole_test.go` +
`requireCompanyRoleRoutes_test.go`. Reverts the `MemberHandlers()`
accessor addition in `memberHandler.go` (a purely additive type +
method, no behavior change). Reverts the `cmd/api/main.go` wiring
(memberRepo/memberService/memberHandler + the 5 route registrations
inside `/me/company`). No DB schema, no domain code, no WU3 handler
behavior is affected.

### Deviations / issues found (WU4)

1. **No clean refactor seam for task 4.6.** Both the middleware
   (`requireCompanyRole.go`) and the member handler
   (`memberHandler.go::classifyMemberError`) translate company
   sentinels to HTTP statuses — but they have:
   - **Different JSON wire shapes**: middleware writes
     `{"error":"forbidden","reason":"..."}` (mirrors the existing
     `respondUnauthorized` from WU3's auth middleware); handler
     uses `httpjson.WriteError` which writes `{"error":"..."}`
     (no reason field).
   - **Different response concerns**: middleware also writes 401
     for the "no Claims" defense-in-depth path and 500 for
     non-domain DB failures; the handler doesn't see either of
     those.
   - **Different language mapping for the same sentinel**:
     middleware's `ErrNotAMember → 403 "not a member of any
     company"`; handler's `ErrNotAMember → 404 "company member
     not found"` (the GetMyMembership surface) and `403 "not a
     member of any company"` (the list endpoint). The handler
     has its own route-specific 403 override already, so even
     where the status overlaps, the message text diverges.

   A shared helper would have to take a `(err error, isAuthzContext bool)`
   parameter and return `(status, message, withReasonField bool)`
   to cover all cases — that's more complexity than the duplication
   it would remove. **Decision: leave as-is, no refactor.** This
   is the documented "no clean seam" outcome from task 4.6.

2. **Per-route gates require handler method access.** The spec
   requires `r.With(...).Method(http.MethodPost, ...)` style
   per-route gating, but `MemberHandler.Routes()` returns a
   single chi.Router that bundles all 5 endpoints uniformly
   (no per-method middleware possible from the parent). The
   minimum additive change: expose each handler as a public
   `http.HandlerFunc` via the `MemberHandlers()` accessor.

   The existing `Routes()` method stays intact (the WU3 unit
   tests use it). The accessor is a 1-call-per-handler wrapper
   around the unexported method bodies — no logic duplication,
   no behavior change for the existing tests. Task 4.3
   explicitly says "do NOT rewrite [the handler] unless the
   spec/tasks require a change"; the per-route gate requirement
   DOES require this exposure, so the accessor is justified.

3. **`denyAllVerifier` duplicated in the test file.** The same
   fail-closed verifier exists in `cmd/api/main.go` as a private
   type, but task 4.1's route test needs it in the
   `identity/infrastructure/http` package's tests. The verifier
   is 3 lines (one struct + one method), so duplicating it is
   cheaper than extracting it into a shared test helper package.
   The `allowAllVerifier` companion is its mirror — needed by
   the 4.2 test that wants the role-gate to be the only barrier.

4. **`go.sum` unchanged.** No new dependencies added; all imports
   are first-party (existing project packages) + standard library.
   The middleware reuses `samber/`-free code paths: `log/slog`,
   `net/http`, `errors`, plus the existing `entities` and
   `valueobjects` packages already on the dependency graph.

### Status (after WU4)

- **WU1 tasks completed**: 6 / 6 (1.1, 1.2, 1.3, 1.4, 1.5, 1.6)
- **WU2 tasks completed**: 9 / 9 (2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9)
- **WU3 tasks completed**: 6 / 6 (3.1, 3.2, 3.3, 3.4, 3.5, 3.6) — plus 3.7/3.8 already landed from prior partial apply
- **WU4 tasks completed**: 8 / 8 (3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6)
- **Phase 1 status**: ✅ complete (WU1 merged at `28c866e`)
- **Phase 2 status**: ✅ complete (WU2 merged at `9ccc9cd` + `3a93ec9`)
- **Phase 3 status**: ✅ complete (WU3 ready for review; 3.7/3.8 already in tree at `459cbb5`)
- **Phase 4 status**: ✅ complete (WU4 ready for review)
- **Company-members change status**: ✅ ALL PHASES COMPLETE — the change is ready for archive pending orchestrator review.
- **Workload / PR boundary (WU4)**: WU4 adds 3 new files (~720 lines authored: 116 middleware + 322 middleware test + 277 route-mount test) plus 2 small modifications (`MemberHandlers()` accessor: ~35 lines + docs in memberHandler.go, ~50 lines of wiring in main.go). Natural split: (a) `feat(identity): RequireCompanyRole middleware + unit tests (3.9/3.10)` and (b) `feat(api): wire /me/company subtree with per-route role gates (4.1/4.2/4.3)` if a reviewer prefers smaller diffs. Well under the 400-line authored-risk budget per `work-unit-commits`.
- **Tests green**: 11/11 WU4 tests + full pre-existing unit suite (27 packages) + full pre-existing integration suite (`make test-integration` exit 0) — 0 regressions, 0 new failures.
- **`go vet ./...`**: 0 findings.
- **`gofmt -l .`**: 0 findings.
- **`go build ./...`**: clean.
- **No `git add` / `commit` / `push`**: orchestrator owns git per task contract.

---

## Work Unit 5 — D6 Remediation: honor the "resolves once" contract

> WU5 is a bounded refactor triggered by `verify-report.md` **WARNING #1** (the verify sub-agent's only deviation from the design). It is **not** a bug fix (IDOR is preserved, all 25 spec scenarios pass); it is a design-conformance fix that turns the injected `CompanyContext` from dead code into the single source of the caller's `company_id` for the gated use cases.

### Scope

The design's `D6 — Caller resolution` row reads:

> `sub → GetByCognitoSub → users.id → GetMembershipByUserID` | Trust path/body ids | IDOR-resistant, mirrors `candidateService.resolveUserID`; **middleware resolves once, gated handlers use injected `CompanyContext.CompanyID`**

The verify sub-agent classified the implementation as a **partial** deviation:

> Resolution chain is fully honored (server-side, IDOR-safe). BUT injected `CompanyContext` is never read by production handlers — see WARNING #1

Concretely, before WU5:

1. `RequireCompanyRole` middleware resolved `sub → users.id → company_members` and injected `CompanyContext{CompanyID, Role}`.
2. **No production handler ever read it** — `grep CompanyContextFromContext` showed only test call sites.
3. Every gated handler instead called `requireSub` (Claims) and passed `sub` to the service, which then ran `resolveMember` (`GetByCognitoSub` + `GetMembershipByUserID`) **a second time** for the same request.
4. Net effect: a redundant 2-query DB round-trip per gated request + an injected value that was never consumed.

WU5 inverts step (2): the gated handlers now consume the injected `CompanyContext`. The middleware's resolution remains the only resolver on the gated path — "resolves once" is no longer aspirational, it is enforced by the type signature.

### Files changed (WU5)

| File | Action | Notes |
|------|--------|-------|
| `backend/internal/features/companies/application/usecases/companyMemberService.go` | modify | Changed signatures of the 4 gated use cases from `cognitoSub string` to `companyID uuid.UUID` (`ListMembers`, `AddMember`, `UpdateRole`, `RemoveMember`). Removed the `resolveMember` call from each — the service no longer touches `userRepo.GetByCognitoSub` on the gated path. Updated the package-level doc, the `NewCompanyMemberService` godoc, and the `resolveMember` doc to mark the helper as ungated-only. Kept `GetMyMembership` (the ungated route) and `resolveMember` unchanged. |
| `backend/internal/features/companies/application/usecases/companyMemberService_test.go` | modify | All gated use-case tests now pass `companyID` directly. The "ignored body company_id" test asserts the saved row's `CompanyID == passed companyID`. Removed three no-longer-applicable `ErrUnknownSubject` short-circuit tests (`TestListMembers_UnknownSubjectIsUnauthorized`, `TestAddMember_UnknownSubjectDoesNotTouchRepository`, `TestRemoveMember_UnknownSubjectDoesNotTouchRepository`) — the gated use cases no longer have a sub-based resolver path to short-circuit. Added `lastListCompanyID` capture to `stubMemberRepository.ListByCompanyID`. Added explicit `uRepo.getCalls != 0` assertions to the gated tests to prove the resolver chain is **not** invoked (the D6 conformance proof at the service layer). |
| `backend/internal/features/companies/infrastructure/http/memberHandler.go` | modify | Added `requireCompanyContext(w, r) (identitysecurity.CompanyContext, bool)` helper mirroring `requireSub` — reads `security.CompanyContextFromContext`, returns 500 fail-closed when missing (routing misconfiguration, NOT 401). Updated the 4 gated handlers (`listMembers`, `addMember`, `updateMemberRole`, `removeMember`) to call it instead of `requireSub`, passing `cc.CompanyID` to the service. Removed the dead `ErrNotAMember → 403` route-specific remap in `listMembers` (the service no longer returns `ErrNotAMember` for a gated request; the middleware filters non-members). Updated the package-level doc to document the new contract. `getMyMembership` keeps `requireSub` + `service.GetMyMembership(ctx, sub)`. |
| `backend/internal/features/companies/infrastructure/http/memberHandler_test.go` | modify | `newMemberRouter` helper now takes both `sub string` AND `cc identitysecurity.CompanyContext`; the middleware injects whichever is non-empty. Ungated `getMyCompany_*` tests inject only `Claims` (no `CompanyContext`) — exactly the production contract. Gated tests inject `CompanyContext{CompanyID, Role}` and drop the `sub`/`caller`/`getByUserOut` setup that was there to support the old sub-based resolution. Added `lastListCompanyID`, `lastUpdateCompanyID`, `lastRemoveCompanyID`, `getByUserCalls`, `getCalls` capture to the stubs so each gated test asserts the **injected** company_id (not a re-resolved sub) flowed to the repo. Added `TestListMembers_NoReResolveWithCompanyContext` (D6 conformance proof: asserts `uRepo.getCalls == 0` AND `mRepo.getByUserCalls == 0` when CompanyContext is injected). Added `TestListMembers_MissingCompanyContextIsServerError` (fail-closed invariant: 500, never invokes the service). Converted `TestListMembers_NonMemberReturns403` → split into `TestListMembers_NoReResolveWithCompanyContext` + `TestListMembers_MissingCompanyContextIsServerError` — the "non-member is rejected" spec scenario remains covered by `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_NonMemberIsForbidden` (the middleware is the legitimate boundary). |

### TDD Cycle Evidence (WU5)

Strict TDD. RED → GREEN → REFACTOR. All 4 changes follow the cycle:
1. Update tests first → RED confirmed by `go test` build failure.
2. Update production → GREEN confirmed by `go test` exit 0.
3. Re-run the full suite + integration + static checks → still green.

| Phase | Step | Result |
|-------|------|--------|
| RED (service tests) | Rewrote 11 gated use-case tests to pass `companyID` instead of `cognitoSub`; removed 3 `ErrUnknownSubject` short-circuit tests; added 4 `uRepo.getCalls == 0` assertions | ✅ Confirmed RED — build failed: `cannot use callerCompanyID (variable of array type uuid.UUID) as string value in argument to svc.AddMember` (9 errors across service_test.go) |
| GREEN (service) | Updated `ListMembers`/`AddMember`/`UpdateRole`/`RemoveMember` signatures to `companyID uuid.UUID`; removed their `resolveMember` calls | ✅ Confirmed GREEN — all 13 company-member service tests pass; full unit suite green (37 packages) |
| RED (handler tests) | Updated `newMemberRouter` to inject both Claims and CompanyContext; rewrote 9 gated handler tests to inject CompanyContext; added `TestListMembers_NoReResolveWithCompanyContext` and `TestListMembers_MissingCompanyContextIsServerError` | ✅ Confirmed RED — build failed: `cannot use sub (variable of type string) as uuid.UUID value in argument to h.service.ListMembers` (4 errors across memberHandler.go) + 2 `declared and not used: userID` warnings in memberHandler_test.go |
| GREEN (handler) | Added `requireCompanyContext` helper; switched the 4 gated handlers from `requireSub`+`sub` to `requireCompanyContext`+`cc.CompanyID`; removed dead `ErrNotAMember → 403` remap; removed the two unused `userID` declarations | ✅ Confirmed GREEN — all 16 company-member handler tests pass (the original 14 minus `TestListMembers_NonMemberReturns403`, plus the 2 new ones: no-re-resolve + missing-context); full unit suite green; full integration suite green |
| REFACTOR + verify | Re-ran `go vet`, `gofmt -l`, `go build`, full unit suite, full integration suite | ✅ ALL CLEAN |

### Test summary (WU5)

- **Total tests written/modified**: 24 top-level (13 service + 11 handler + the 2 new ones replacing the dead `TestListMembers_NonMemberReturns403`)
  - Service: 13 (the 11 gated use cases now pass `companyID`; the 2 ungated `GetMyMembership`/`resolveMember` tests unchanged)
  - Handler: 11 (9 existing gated tests now inject CompanyContext; 1 new `TestListMembers_NoReResolveWithCompanyContext`; 1 new `TestListMembers_MissingCompanyContextIsServerError`)
  - Removed: 3 service `ErrUnknownSubject` short-circuit tests (no longer applicable) + 1 handler `TestListMembers_NonMemberReturns403` (covered by middleware test instead)
- **Total tests passing**: 24/24 (verified via `go test -v ./internal/features/companies/{application/usecases,infrastructure/http}/ -count=1`)
- **Layers used**: Unit (24), Integration (0 — no schema or wiring changes; the existing 4 integration tests from WU3 still pass unchanged)
- **Pure functions created/modified**: 1 new (`requireCompanyContext`), 4 signatures changed (gated use cases)
- **Observable HTTP behavior**: 0 changes — every status code, wire shape, and spec scenario is preserved (verified via the same 25 spec-scenario tests that drove the verify pass).

### TDD assertion quality audit (WU5)

Every new / modified assertion calls production code and asserts a specific expected value. Spot checks:

| Test | Assertion | Real behavior? |
|------|-----------|----------------|
| `TestListMembers_NoReResolveWithCompanyContext` | `uRepo.getCalls != 0` would FAIL if a future refactor re-introduced sub-based resolution on the gated path | ✅ Yes — the stub's `getCalls` increments inside `GetByCognitoSub` |
| `TestListMembers_MissingCompanyContextIsServerError` | `mRepo.listCalls != 0` would FAIL if the handler proceeded without CompanyContext | ✅ Yes — proves the fail-closed invariant short-circuits BEFORE the service |
| `TestAddMember_OwnerReturns201` | `mRepo.created.CompanyID != companyID` (the INJECTED one, not a resolved sub) would FAIL if the service still used `params.CompanyID` or a re-resolved sub | ✅ Yes — the production code runs `entities.NewCompanyMember(params.UserID, companyID, role)` |
| `TestUpdateRole_ForwardsCallersCompanyID` (service) | `mRepo.lastUpdateCompanyID != callerCompanyID` would FAIL if the service still forwarded `caller.CompanyID` from a `resolveMember` call (it no longer does) | ✅ Yes — the production code forwards the `companyID` argument directly to `memberRepo.UpdateRole` |
| `TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID` (service) | `mRepo.created.CompanyID != callerCompanyID` would FAIL if the service read `params.CompanyID` (the foreign id) | ✅ Yes — proves the body company_id is still ignored, but now at the new contract boundary (passed-in `companyID` vs body) |

### Runtime harness (mandatory for WU5)

| Step | Command | Result |
|------|---------|--------|
| Pre-WU5 baseline | `cd backend && go test ./... -count=1` | exit 0; all 27 packages `ok` (post-WU4 baseline) |
| Post-WU5 unit suite | `cd backend && go test ./... -count=1` | exit 0; all 27 packages `ok` (zero regressions) |
| Post-WU5 integration suite | `cd backend && make test-integration` | exit 0; all packages `ok` (4 company_member_repository_integration tests + full migration suite + 0 regressions) |
| Targeted — service | `cd backend && go test -v -count=1 ./internal/features/companies/application/usecases/` | 13 PASS (gated use cases: `AddMember` × 2, `ListMembers` × 2, `UpdateRole` × 3, `RemoveMember` × 2; ungated: `GetMyMembership` × 2, `resolveMember` × 2) |
| Targeted — handler | `cd backend && go test -v -count=1 ./internal/features/companies/infrastructure/http/` | 16 PASS (3 `getMyCompany` ungated + 2 new gated fail-closed/no-resolve + 4 gated `listMembers`/`addMember` + 2 gated `updateMemberRole` + 2 gated `removeMember` + 1 `invalidUUID` + 9 `classifyMemberError` subtests) |
| Static — vet | `cd backend && go vet ./...` | exit 0; zero findings |
| Static — format | `cd backend && gofmt -l .` | exit 0; zero findings (one `gofmt -w` pass applied to memberHandler_test.go after the rewrite) |
| Build | `cd backend && go build ./...` | exit 0; clean |

### Contract verification (the WARNING #1 fix)

Grep-confirm `CompanyContextFromContext` now has production call sites in `memberHandler.go`, and the gated service methods no longer take `cognitoSub`:

```text
$ grep -rn "CompanyContextFromContext" --include='*.go' internal/ | grep -v _test.go
internal/features/identity/domain/security/companyContext.go:53:// CompanyContextFromContext returns the CompanyContext previously stored
internal/features/identity/domain/security/companyContext.go:66:func CompanyContextFromContext(ctx context.Context) (CompanyContext, bool) {
internal/features/companies/infrastructure/http/memberHandler.go:22:// `security.CompanyContextFromContext` (wrapped by the
internal/features/companies/infrastructure/http/memberHandler.go:422:	cc, ok := identitysecurity.CompanyContextFromContext(r.Context())
```

→ 4 production references (1 godoc + 1 definition + 1 docstring + **1 production call site** in `memberHandler.go:422`). Pre-WU5: 0 production call sites. ✅ WARNING #1 resolved.

```text
$ grep -n "cognitoSub" internal/features/companies/application/usecases/companyMemberService.go
85:func (s *CompanyMemberService) resolveMember(ctx context.Context, cognitoSub string) (*entities.CompanyMember, error) {
86:	user, err := s.userRepo.GetByCognitoSub(ctx, cognitoSub)
115:// cognitoSub: the route is ungated by role ...
118:func (s *CompanyMemberService) GetMyMembership(ctx context.Context, cognitoSub string) (*entities.CompanyMember, *entities.Company, error) {
119:	member, err := s.resolveMember(ctx, cognitoSub)
```

→ Only the private `resolveMember` helper (line 85) and the ungated `GetMyMembership` (line 118) still take `cognitoSub`. The 4 gated use cases (`ListMembers` / `AddMember` / `UpdateRole` / `RemoveMember`) no longer accept it — they take `companyID uuid.UUID`. ✅ "Resolves once" is enforced by the type signature, not just documented.

```text
$ grep -n "requireSub\|requireCompanyContext" internal/features/companies/infrastructure/http/memberHandler.go
27:// the JWT subject via `requireSub` (the middleware does not run there
194:	sub, ok := requireSub(w, r)
395:// requireSub extracts the JWT subject from the request context.
401:func requireSub(w http.ResponseWriter, r *http.Request) (string, bool) {
23:// `requireCompanyContext` helper) and pass `cc.CompanyID` straight to
220:	cc, ok := requireCompanyContext(w, r)
244:	cc, ok := requireCompanyContext(w, r)
284:	cc, ok := requireCompanyContext(w, r)
321:	cc, ok := requireCompanyContext(w, r)
410:// requireCompanyContext reads the CompanyContext that RequireCompanyRole
421:func requireCompanyContext(w http.ResponseWriter, r *http.Request) (identitysecurity.CompanyContext, bool) {
```

→ `requireSub` is called exactly once — from `getMyMembership` (line 194, the UNGATED endpoint). `requireCompanyContext` is called from all 4 gated handlers (lines 220, 244, 284, 321). ✅ Handler-layer mapping matches the service-layer mapping.

### Rollback boundary (WU5)

The WU5 changes can be reverted without disturbing WU1/WU2/WU3/WU4 (already merged):

```
git revert --no-edit WU5
```

→ reverts the 4 service signatures back to `cognitoSub string` and restores the `resolveMember` calls inside them; reverts `memberHandler.go` to call `requireSub` and pass `sub` to the service; reverts the test helper signature and the test bodies to their pre-WU5 state. The middleware (`requireCompanyRole.go`) is unchanged — its injected `CompanyContext` simply becomes unused again, restoring WARNING #1. No DB schema, no domain code, no handler/middleware behavior is affected.

### Deviations / issues found (WU5)

1. **`TestListMembers_NonMemberReturns403` removed in favor of the middleware test.** The handler test was proving an in-handler `ErrNotAMember → 403` defensive fall-through. After the refactor, the service can no longer return `ErrNotAMember` for a gated request (no resolver path), so the remap is dead code. The spec scenario "non-member is rejected (403)" remains fully covered by `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_NonMemberIsForbidden` (the legitimate boundary — the middleware filters non-members before the handler runs) and by `requireCompanyRoleRoutes_test.go` (per-route gating integration). The handler-level test was redundant after the refactor. **Decision: remove it, document the replacement.** The "non-member is rejected" scenario is fully covered without the handler test.

2. **`requireCompanyContext` returns 500 (not 401) on missing context.** The handler-level fail-closed for a misconfigured route. Returning 401 would mislead the client into re-authenticating; the real failure is internal (the middleware should have injected `CompanyContext` but didn't). The `500 + log` pattern mirrors the `respondServerError` helper in `requireCompanyRole.go` and the `classifyMemberError` default case in `memberHandler.go`. Test coverage: `TestListMembers_MissingCompanyContextIsServerError`.

3. **Three `ErrUnknownSubject` service tests removed.** `TestListMembers_UnknownSubjectIsUnauthorized`, `TestAddMember_UnknownSubjectDoesNotTouchRepository`, `TestRemoveMember_UnknownSubjectDoesNotTouchRepository`. These were proving that the gated service short-circuited on an unknown sub. After the refactor, the gated use cases take a `companyID uuid.UUID` (not a sub), so there is no sub path to short-circuit — those tests would always be vacuously true. The `ErrUnknownSubject` sentinel and the `resolveMember` helper still exist and are still tested (via `GetMyMembership`), so the IDOR-resistant boundary is preserved. **Decision: remove the dead tests, keep the live ones.**

4. **`memberHandler_test.go` formatting pass needed.** The handler test rewrite introduced 1 formatting issue (`gofmt -w` applied once). No behavior change, just whitespace.

5. **No DB / wiring change.** WU5 is pure application+HTTP code. The 4 existing `companyMemberRepository_integration_test.go` tests from WU3 still pass unchanged — the postgres adapter's `companyID` parameter is the same as before, the SQL guard (D7) is the same as before. The wiring in `cmd/api/main.go` is unchanged: the middleware still runs, the handler still calls the service, the service still calls the repo. The only difference is which value the service receives for `companyID`: it now comes from `CompanyContext` (set by the middleware) instead of from a sub → membership re-resolution. IDOR is preserved.

### Status (after WU5)

- **WU1 tasks completed**: 6 / 6 (1.1, 1.2, 1.3, 1.4, 1.5, 1.6)
- **WU2 tasks completed**: 9 / 9 (2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9)
- **WU3 tasks completed**: 6 / 6 (3.1, 3.2, 3.3, 3.4, 3.5, 3.6) — plus 3.7/3.8 already landed from prior partial apply
- **WU4 tasks completed**: 8 / 8 (3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6)
- **WU5 tasks completed**: bounded refactor (4 file modifications, 0 file creations)
- **Phase 1 status**: ✅ complete (WU1 merged at `28c866e`)
- **Phase 2 status**: ✅ complete (WU2 merged at `9ccc9cd` + `3a93ec9`)
- **Phase 3 status**: ✅ complete (WU3 ready for review; 3.7/3.8 already in tree at `459cbb5`)
- **Phase 4 status**: ✅ complete (WU4 ready for review)
- **Phase 5 status**: ✅ complete (WU5 ready for review — D6 remediation)
- **Company-members change status**: ✅ ALL PHASES COMPLETE — D6 deviation closed; WARNING #1 resolved; the change is ready for re-verify and archive pending orchestrator review.
- **Workload / PR boundary (WU5)**: WU5 modifies 4 existing files (~250 net lines changed: ~80 service + ~80 service test + ~60 handler + ~120 handler test, minus ~90 lines removed). Well under the 400-line authored-risk budget per `work-unit-commits` — natural single PR. Split would only fragment a logically-coherent refactor.
- **Tests green**: 24/24 WU5-modified tests + full pre-existing unit suite (27 packages) + full pre-existing integration suite (`make test-integration` exit 0) — 0 regressions, 0 new failures.
- **`go vet ./...`**: 0 findings.
- **`gofmt -l .`**: 0 findings.
- **`go build ./...`**: clean.
- **No `git add` / `commit` / `push`**: orchestrator owns git per task contract.
