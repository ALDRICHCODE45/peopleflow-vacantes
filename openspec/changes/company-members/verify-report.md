```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:b514506710660ab855b097bf9fdfcaaa73df71cedb071c95a3bc87561f584fbe
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 25/25
test_command: cd backend && go test ./...
test_exit_code: 0
test_output_hash: sha256:6bcb28db93fe45a9bed92ed3c477d50f23883b28afcfbd6c0b7d038f28fa3349
build_command: cd backend && go build ./...
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

# Verification Report

**Change**: company-members
**Version**: N/A (delta spec — first release of `company_membership` capability)
**Mode**: Strict TDD
**Verifier**: independent `sdd-verify` sub-agent (no production/test code modified, no git writes)
**Evidence HEAD**: `6ed1bf4ce3a9bc83d0250f8a3fec20c15b3fb042`

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 31 |
| Tasks complete | 31 |
| Tasks incomplete | 0 |
| Artifacts reviewed | proposal, spec (9 req / 25 scenarios), design (D1–D7), tasks, apply-progress (WU1–WU4) |

All 31 tasks are checked `[x]`. Full verification ran (not a focused/task-only slice).

## Build & Tests Execution (independently re-run)

**Build**: ✅ Passed (exit 0, empty output)
```text
$ cd backend && go build ./...
(no output)
```

**Vet**: ✅ Passed (exit 0, zero findings)
```text
$ cd backend && go vet ./...
(no output)
```

**Format**: ✅ Passed (exit 0, zero findings)
```text
$ cd backend && gofmt -l .
(no output)
```

**Unit tests**: ✅ Passed — 36 packages `ok`, 0 failures
```text
$ cd backend && go test ./... -count=1
ok  github.com/aldrichcode45/peopleflow-vacantes/cmd/api
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/http
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http
... (all 36 packages ok; full list captured at sha256:6bcb28db…)
```

**Integration tests**: ✅ Passed — all packages `ok` (migrations + membership adapter + full regression)
```text
$ cd backend && set -a && . ./.env && set +a && go test -tags=integration -p 1 ./... -count=1
ok  github.com/aldrichcode45/peopleflow-vacantes/db/migrations
ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres
... (all packages ok; exit 0)
```

**Coverage** (unit only, informational): companies/identity changed packages range 51%–91% per-package; key changed files detailed below. `MemberHandlers()` accessor 0% (covered by source inspection only). Integration-tagged adapter methods are excluded from unit coverage by design.

## Spec Compliance Matrix (traceability)

Statuses: ✅ COMPLIANT (covering test passed) · ❌ FAILING · ❌ UNTESTED · ⚠️ PARTIAL

### REQ-1 — company_members Schema Migration (4/4)
| Scenario | Test | Result |
|----------|------|--------|
| up creates named objects | `db/migrations/migrations_test.go::TestMigration00009UpCreatesNamedObjects` | ✅ COMPLIANT |
| down drops the table | `db/migrations/migrations_test.go::TestMigration00009DownDropsTable` | ✅ COMPLIANT |
| invalid role rejected by DB | `db/migrations/migrations_test.go::TestMigration00009RejectsInvalidRole` | ✅ COMPLIANT |
| second membership rejected | `db/migrations/migrations_test.go::TestMigration00009RejectsDuplicateUserID` | ✅ COMPLIANT |

### REQ-2 — Membership Resolution from Authenticated Subject (1/1)
| Scenario | Test | Result |
|----------|------|--------|
| body company_id is ignored | `usecases/companyMemberService_test.go::TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID` | ✅ COMPLIANT |

### REQ-3 — GetMyMembership (3/3)
| Scenario | Test | Result |
|----------|------|--------|
| owner gets their membership | `http/memberHandler_test.go::TestGetMyCompany_OwnerReturns200`; `usecases/companyMemberService_test.go::TestGetMyMembership_ReturnsMemberAndCompany` | ✅ COMPLIANT |
| non-member gets 404 | `http/memberHandler_test.go::TestGetMyCompany_NonMemberReturns404`; `usecases/companyMemberService_test.go::TestResolveMember_NoMembershipIsNotAMember` | ✅ COMPLIANT |
| unknown sub returns 401 | `http/memberHandler_test.go::TestGetMyCompany_UnknownSubReturns401`; `usecases/companyMemberService_test.go::TestResolveMember_UnknownSubjectIsUnauthorized` | ✅ COMPLIANT |

### REQ-4 — ListMembers (2/2)
| Scenario | Test | Result |
|----------|------|--------|
| members are listed | `http/memberHandler_test.go::TestListMembers_OwnerReturns200`; `usecases/companyMemberService_test.go::TestListMembers_ReturnsAllMembers` | ✅ COMPLIANT |
| non-member is rejected (403) | `http/memberHandler_test.go::TestListMembers_NonMemberReturns403`; `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_NonMemberIsForbidden` | ✅ COMPLIANT |

### REQ-5 — AddMember (Owner-Only) (3/3)
| Scenario | Test | Result |
|----------|------|--------|
| owner adds a recruiter | `http/memberHandler_test.go::TestAddMember_OwnerReturns201` | ✅ COMPLIANT |
| non-owner is rejected | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden`; `identity/http/requireCompanyRoleRoutes_test.go::TestRoutes_RecruiterCannotCallAddMember` | ✅ COMPLIANT |
| duplicate user is rejected (409) | `http/memberHandler_test.go::TestAddMember_DuplicateReturns409`; `postgres/companyMemberRepository_mapCreateError_test.go::TestMapCreateError_23505MapsToErrMemberExists` | ✅ COMPLIANT |

### REQ-6 — UpdateRole (Owner-Only, Same-Company) (3/3)
| Scenario | Test | Result |
|----------|------|--------|
| owner promotes a recruiter | `http/memberHandler_test.go::TestUpdateMemberRole_PromotesRecruiterToOwner`; `postgres/companyMemberRepository_integration_test.go::TestUpdateRole_SameCompanyUpdatesRow` | ✅ COMPLIANT |
| non-owner is rejected | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden` | ✅ COMPLIANT |
| cross-company target is rejected (404) | `http/memberHandler_test.go::TestUpdateMemberRole_CrossCompanyReturns404`; `postgres/companyMemberRepository_integration_test.go::TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound`; `usecases/companyMemberService_test.go::TestUpdateRole_CrossCompanyTargetPropagatesNotFound` | ✅ COMPLIANT |

### REQ-7 — RemoveMember (Owner-Only, Same-Company) (3/3)
| Scenario | Test | Result |
|----------|------|--------|
| owner removes a member | `http/memberHandler_test.go::TestRemoveMember_OwnerReturns204`; `postgres/companyMemberRepository_integration_test.go::TestRemove_SameCompanyDeletesRow` | ✅ COMPLIANT |
| non-owner is rejected | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden` | ✅ COMPLIANT |
| cross-company target is rejected (404) | `postgres/companyMemberRepository_integration_test.go::TestRemove_CrossCompanyAffectsZeroRowsReturnsNotFound`; `usecases/companyMemberService_test.go::TestRemoveMember_CrossCompanyTargetPropagatesNotFound` | ✅ COMPLIANT |

### REQ-8 — RequireCompanyRole Middleware (4/4)
| Scenario | Test | Result |
|----------|------|--------|
| minimal role passes | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_OwnerPassesRecruiterGate` | ✅ COMPLIANT |
| insufficient role is 403 | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden` | ✅ COMPLIANT |
| non-member is 403 | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_NonMemberIsForbidden` | ✅ COMPLIANT |
| unknown sub is 401 | `identity/http/requireCompanyRole_test.go::TestRequireCompanyRole_UnknownSubIsUnauthorized` | ✅ COMPLIANT |

### REQ-9 — HTTP Surface Under /me/company (2/2)
| Scenario | Test | Result |
|----------|------|--------|
| routes mounted behind auth | `identity/http/requireCompanyRoleRoutes_test.go::TestRoutes_MissingAuthHeaderIsUnauthorized` | ✅ COMPLIANT |
| mutations enforce owner | `identity/http/requireCompanyRoleRoutes_test.go::TestRoutes_RecruiterCannotCallAddMember` | ✅ COMPLIANT |

**Compliance summary**: 25/25 scenarios compliant (covering test passed at runtime). 0 UNTESTED, 0 FAILING, 0 PARTIAL.

## Correctness (Static Evidence)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Schema Migration `00009` | ✅ Implemented | Table + named `company_members_role_check` + `UNIQUE(user_id)` index + `company_id` index; `goose down` drops table |
| Membership Resolution (sub → users.id → members) | ✅ Implemented | `CompanyMemberService.resolveMember` is the only place the JWT sub is resolved; company_id always from caller's row |
| GetMyMembership | ✅ Implemented | `resolveMember` + company fetch via `CompanyRepository.GetByID`; `ErrNotAMember`→404, `ErrUnknownSubject`→401 |
| ListMembers | ✅ Implemented | `ListByCompanyID` on caller's company; `ErrNotAMember`→403 (route-specific remap) |
| AddMember (owner-only) | ✅ Implemented | Role parsed via VO; `CompanyID` body field ignored; `mapCreateError` 23505→409 / 23503→404 |
| UpdateRole (owner-only, same-company) | ✅ Implemented | `WHERE id=$1 AND company_id=$2`; 0 rows → `ErrMemberNotFound`→404 |
| RemoveMember (owner-only, same-company) | ✅ Implemented | Same SQL guard; hard delete |
| RequireCompanyRole middleware | ✅ Implemented | Resolves sub→users.id→member per request; `role < minRole`→403, unknown sub→401, missing Claims→401; injects `CompanyContext` |
| HTTP surface gates | ✅ Implemented | `GET /company` ungated; `GET /company/members`=recruiter; `POST/PATCH/DELETE /company/members[/{id}]`=owner |

## Coherence (Design Decisions D1–D7)

| Decision | Followed? | Evidence |
|----------|-----------|----------|
| D1 — membership inside `companies` | ✅ Yes | `backend/internal/features/companies/{domain,application,infrastructure}/*Member*.go`; middleware in `identity` only references companies ports |
| D2 — hard delete (no `deleted_at`) | ✅ Yes | `00009` has no `deleted_at`; `RemoveCompanyMember` is `DELETE FROM company_members` |
| D3 — `updated_at` included | ✅ Yes | Column present; `UpdateMemberRole` touches `updated_at=now()` |
| D4 — middleware in `identity/infrastructure/http`, route-scoped | ✅ Yes | `requireCompanyRole.go`; `r.With(requireOwner|requireRecruiter)` per route in `main.go` |
| D5 — port-only imports (no infrastructure) | ✅ Yes | `requireCompanyRole.go` imports `companies/domain/{entities,repositories,valueobjects}` + `identity/domain/{entities,repositories,security}` only; no `companies/infrastructure/...` import |
| D6 — sub → users.id → members; handler uses `CompanyContext.CompanyID` | ⚠️ Partial | Resolution chain is fully honored (server-side, IDOR-safe). BUT injected `CompanyContext` is never read by production handlers — see WARNING #1 |
| D7 — same-company SQL guard | ✅ Yes | `UpdateMemberRole`/`RemoveCompanyMember` use `WHERE id=$1 AND company_id=$2`; adapter maps 0 rows → `ErrMemberNotFound` |

## Threat / IDOR Boundary

| Boundary | Expected | Actual | Verified by |
|----------|----------|--------|-------------|
| unknown sub | 401 | 401 | middleware + `classifyMemberError` (ErrUnknownSubject) |
| non-member (mutations / list) | 403 | 403 | middleware `ErrNotAMember`→403 |
| non-member (GetMyMembership) | 404 | 404 | handler `ErrNotAMember`→404 |
| cross-company target (PATCH/DELETE) | 404 | 404 | SQL guard → `ErrMemberNotFound`→404 |
| insufficient role | 403 | 403 | middleware `role < minRole`→403 |
| no Authorization header | 401 | 401 | `RequireAuth` pre-handler |

No IDOR leak: path/body `company_id` never resolves the caller. `addMemberRequest` has no `company_id` field; `AddMemberDto.CompanyID` is documented-ignored and never populated by the handler.

---

### TDD Compliance (Strict TDD)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ✅ | TDD Cycle Evidence tables present in apply-progress for WU1–WU4 (all 31 tasks) |
| All tasks have tests | ✅ | 31/31 tasks map to unit or integration tests (sqlc/green-only tasks are codegen, correctly N/A) |
| RED confirmed (tests exist) | ✅ | All reported test files exist on disk and compile |
| GREEN confirmed (tests pass) | ✅ | Re-ran every reported test — all pass (see compliance matrix) |
| Triangulation adequate | ✅ | Multi-case triangulation documented and present (happy + edge + guard per use case) |
| Safety Net for modified files | ✅ | WU1 00005 maintenance + Makefile `-p 1` documented with full regression re-runs |

**TDD Compliance**: 6/6 checks passed.

**Note (RED reconstructability)**: RED states were never committed (all WU commits are GREEN); RED-first evidence is documented in apply-progress, not independently reconstructable from git. This matches the SDD convention (RED is transient). Not a defect.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 61 | 9 | `go test` (stdlib) |
| Integration | 8 | 2 | `go test -tags=integration` |
| E2E | 0 | 0 | not available |
| **Total** | **69** | **11** | |

### Changed File Coverage (unit-only; integration-tagged adapter methods excluded by build tag)

| File | Key symbols | Rating |
|------|-------------|--------|
| `valueobjects/memberRole.go` | `ParseMemberRole` 100%, `String` 100% | ✅ |
| `entities/companyMember.go` | `NewCompanyMember` 85.7% | ✅ |
| `usecases/companyMemberService.go` | all 5 use cases 77.8%–100% | ✅ |
| `http/memberHandler.go` | handlers 57.1%–85.7%; `MemberHandlers()` 0% | ⚠️ acceptable |
| `postgres/companyMemberRepository.go` | `mapCreateError` 100%; persistence methods 0% in unit (covered by integration tag) | ⚠️ see note |
| `identity/domain/security/companyContext.go` | both helpers 100% | ✅ |
| `identity/http/requireCompanyRole.go` | `RequireCompanyRole` 77.8%; `respondServerError` 0% | ✅ |

Note: adapter persistence methods (`Create`/`GetMembershipByUserID`/`ListByCompanyID`/`UpdateRole`/`Remove`) show 0% in the unit-coverage run because they are exercised exclusively by `//go:build integration` tests (`companyMemberRepository_integration_test.go`, 4 tests, all passing). Coverage threshold in config is 0 (bootstrap) — informational only.

### Assertion Quality

✅ All assertions verify real behavior. Spot-verified high-value assertions:
- `TestAddMember_UsesCallersCompanyIgnoresBodyCompanyID` asserts `mRepo.created.CompanyID == callerCompanyID` (would fail if service read body `CompanyID=Y`).
- `TestRequireCompanyRole_UnknownSubIsUnauthorized` asserts `members.resolveCalls == 0` (proves no membership probe with a stale sub).
- `TestUpdateRole_CrossCompanyAffectsZeroRowsReturnsNotFound` asserts row count unchanged (proves the SQL guard rejected the write, not just returned an error).
- No tautologies, ghost loops, or mock-only assertions found.

**Assertion quality**: ✅ All assertions verify real behavior (0 CRITICAL, 0 WARNING).

### Quality Metrics

**Linter**: ➖ Not available (no golangci-lint in config)
**Type Checker (`go vet`)**: ✅ No errors
**Formatter (`gofmt -l .`)**: ✅ No findings

---

## Issues Found

**CRITICAL**: None.

**WARNING**:

1. **D6 partial deviation — injected `CompanyContext` is dead code; gated handlers re-resolve the membership instead of using it.** Design D6 states "middleware resolves once, gated handlers use injected `CompanyContext.CompanyID`". The middleware (`requireCompanyRole.go`) correctly resolves `sub → users.id → company_members` and injects `CompanyContext{CompanyID, Role}`, but **no production handler reads it** — `CompanyContextFromContext` has zero production call sites (grep-confirmed: only tests). Instead, every `memberHandler.go` handler reads `sub` via `requireSub` and calls the service, which re-runs `resolveMember` (`GetByCognitoSub` + `GetMembershipByUserID` a second time). Consequences: (a) a redundant 2-query DB round-trip per gated request; (b) the injected context is unused code. The IDOR property is **not** weakened (company_id still always derives from the caller's resolved membership, never path/body) and **no spec scenario is broken** (all 25 pass). Classified WARNING per the design-deviation gate. Remediation (not performed here) would thread the injected `CompanyContext` into the handlers/service to honor the "resolves once" contract.

**SUGGESTION**:

1. `RemoveMember` cross-company 404 lacks a direct handler-level test (there is no `TestRemoveMember_CrossCompanyReturns404`). The scenario is still fully covered end-to-end at the service + integration + classifier layers, but the `removeMember` handler's own 404 branch is not directly exercised.
2. `MemberHandlers()` accessor (the per-route wiring surface used by `main.go`) has 0% coverage; the route tests hand-roll a chi router instead of exercising the real `main.go` wiring. Additionally, the route tests set `handlerInvoked` before `mh.Routes().ServeHTTP` with a full `/me/...` path the subrouter cannot match, so they prove the middleware gate but not actual handler dispatch through `MemberHandler.Routes()`.
3. `respondServerError` (the middleware's 500 branch) is untested — no unit test drives a non-sentinel error from the user/member repos.
4. Route-level owner gating is tested only for `POST` (`TestRoutes_RecruiterCannotCallAddMember`); `PATCH`/`DELETE` owner gating is verified by source inspection (`main.go` lines 204–205) + middleware unit tests, not by route tests.

---

## Verdict

**PASS WITH WARNINGS**

All 9 requirements and all 25 scenarios have passing covering tests at runtime (unit + integration independently re-run). Build, vet, and gofmt are clean. All seven design decisions are honored, with one partial (D6): the injected `CompanyContext` is unused in production and gated handlers re-resolve membership (a redundant DB round-trip), which is a non-breaking design deviation. Zero CRITICAL findings, zero blockers. The implementation satisfies the spec.
