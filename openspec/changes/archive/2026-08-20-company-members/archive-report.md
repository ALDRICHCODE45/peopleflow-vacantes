# Archive Report — `company-members`

**Status**: DELIVERED
**Archived**: 2026-08-20
**Source**: `openspec/changes/company-members/`
**Target**: `openspec/changes/archive/2026-08-20-company-members/`
**Final commit**: `c9f97f6` (verify-report refresh; the D6 remediation commit `56b3416` is the evidence HEAD captured in `verify-report.md`)
**Cycle**: complete — explore → propose → spec → design → tasks → apply (WU1–WU4) → verify → D6 remediation (WU5) → re-verify → archive

---

## Final State (per Final-State Authority hierarchy)

Highest-ranked sources for these facts: explicit final-state facts in the orchestrator launch prompt (outrank any intermediate snapshot), native review authority (none discovered — `reviewGate` structurally absent), the persisted tasks artifact (31/31 complete), and the persisted `verify-report.md` (verdict `pass`, upgraded from `pass_with_warnings` after D6 remediation). All four agree on the delivered shape.

| Surface | Status | Evidence |
|---|---|---|
| `tasks.md` completion | 31/31 `[x]`, 0 unchecked | `openspec/changes/archive/2026-08-20-company-members/tasks.md` |
| `verify-report.md` verdict | **PASS** (upgraded from `pass_with_warnings` after D6 remediation at `56b3416`) | `openspec/changes/archive/2026-08-20-company-members/verify-report.md` frontmatter `verdict: pass` |
| Critical issues | 0 | `verify-report.md` §Issues Found |
| Warnings | 0 | `verify-report.md` §Issues Found (the prior WARNING #1 about D6 partial deviation was resolved by commit `56b3416`; verify-report "Remediation Confirmation" section independently greps the fix) |
| Suggestions | 4 (non-blocking) | `verify-report.md` §Issues Found SUGGESTIONS 1–4 |
| Blockers | 0 | `verify-report.md` frontmatter `blockers: 0` |
| Requirements covered | 9/9 | `verify-report.md` §Spec Compliance Matrix |
| Scenarios covered | 25/25 (all COMPLIANT · 0 PARTIAL · 0 DIVERGENT · 0 UNTESTED) | `verify-report.md` §Spec Compliance Matrix |
| Build / vet / gofmt | `go build ./...` exit 0 · `go vet ./...` exit 0 · `gofmt -l .` empty | `verify-report.md` §Build & Tests Execution (independently re-run by verifier) |
| Unit tests | exit 0 — 35 packages (26 `ok` + 9 no-test-files), 0 failures | `verify-report.md` §Build & Tests Execution |
| Integration tests | exit 0 — all packages `ok` (`-p 1` serial; 4 migration tests + 4 adapter same/cross-company tests) | `verify-report.md` §Build & Tests Execution |
| `reviewGate` | structurally absent (kill switch off; no review ever discovered for this candidate) | orchestrator launch prompt; no `review/` artifacts in the change |
| Active change folder | `openspec/changes/company-members/` removed | post-archive `ls openspec/changes/` |
| Final commit | `c9f97f6` (verify-report refresh — last **report** commit, code HEAD at `56b3416`) | `git log --oneline -1` at archive time |

### Evidence revision vs. final commit

The `verify-report.md` frontmatter records `evidence_revision` at `56b3416` (the D6 remediation commit). The final commit `c9f97f6` touches **only** `openspec/changes/company-members/verify-report.md` (`1 file changed`, verified via `git show --stat`) — no code landed after the verification evidence was captured. The two refs are consistent, not contradictory. The implementation tree at `56b3416` is the verified tree.

### Contradictions

None unrankable. The launch prompt's final-state facts ("31/31 tasks complete", "verdict PASS, 0 CRITICAL, 0 WARNING, 4 non-blocking SUGGESTIONS", "D6 remediated — gated use cases take `companyID uuid.UUID`, gated handlers read injected `CompanyContext`, `GetMyMembership` still resolves `sub`"), the persisted `verify-report` (with its independently grep-confirmed Remediation Confirmation section), the persisted `tasks.md`, and independent repository evidence (commit history) agree on every point.

The one stale claim in the lower-ranked intermediate snapshot (`apply-progress` deviations for the WU3/WU4 phases) was **true when written** and has since been resolved during the WU5 D6 remediation; it is reported below as resolved, not echoed as a current defect.

---

## Delivered Scope

`company_membership` capability — one-company-per-user membership with `owner|recruiter` roles, server-side `RequireCompanyRole` middleware resolving `sub → users.id → company_members` per request (the JWT carries no role). Extends the `companies` slice; middleware lives in `identity/infrastructure/http/` next to `RequireAuth`.

| Layer | Delivered |
|---|---|
| Migration | `backend/db/migrations/00009_create_company_members.sql` — table `(id UUID PK, user_id UUID FK→users, company_id UUID FK→companies, role TEXT, created_at/updated_at TIMESTAMPTZ)` + named CHECK `company_members_role_check` (closed set `owner\|recruiter`) + `UNIQUE(user_id)` + `company_id` B-tree index + reversible `down`. Plus a maintenance update to `00005_integration_test.go` mirroring the new `company_members → users` FK in goose's reverse-down DROP order (no schema change, FK-driven). Plus `Makefile` `-p 1` flag for `test-integration` (parallel-package race: 00005 test drops `company_members` mid-flight while 00009 reads it). |
| sqlc | `backend/db/queries/company_members.sql` — 5 queries: `CreateCompanyMember`, `GetMembershipByUserID`, `ListByCompanyID`, `UpdateMemberRole` (`WHERE id=$1 AND company_id=$2` — D7 same-company guard), `RemoveCompanyMember` (same guard). The two mutation queries use `:execrows` (returns `int64`) so the adapter can map 0 rows → `ErrMemberNotFound`. Regenerated `backend/internal/db/{company_members.sql.go,models.go,querier.go}`. |
| Domain | `MemberRole` ordinal VO (`Unknown=0, Recruiter=1, Owner=2`) + `ParseMemberRole` + `String` + `ErrInvalidMemberRole`. `CompanyMember` entity + `NewCompanyMember` factory (UUID v7, UTC timestamps, role validation) + 5 sentinels (`ErrUnknownSubject`, `ErrNotAMember`, `ErrMemberExists`, `ErrMemberNotFound`, `ErrUserNotFound`). `CompanyMemberRepository` port with the 5 methods matching sqlc + the D7 same-company guard contract. |
| Application | `CompanyMemberService` with `resolveMember` (the IDOR-resistant boundary; mirrors `CandidateService.resolveUserID`) + 5 use cases (`GetMyMembership`, `ListMembers`, `AddMember`, `UpdateRole`, `RemoveMember`). **After WU5 (D6 remediation):** the 4 gated use cases (`ListMembers`/`AddMember`/`UpdateRole`/`RemoveMember`) take `companyID uuid.UUID` directly — the service no longer touches `userRepo.GetByCognitoSub` on the gated path. Only the ungated `GetMyMembership` resolves `sub`. `memberDtos.go` with `AddMemberDto` (carries a documented-ignored `CompanyID` field for the spec scenario) + `UpdateMemberRoleDto`. |
| Infrastructure — postgres | `CompanyMemberRepository` (pgx adapter, 5 methods + `mapCreateError` member-specific: 23505→`ErrMemberExists`, 23503→`ErrUserNotFound`, pass-through otherwise; `buildCreateMemberParams`, `memberToEntity`, `pgTimestamptzToTime`). Compile-time guard `var _ repositories.CompanyMemberRepository = (*CompanyMemberRepository)(nil)` nails the port surface. |
| Infrastructure — HTTP | `MemberHandler` with `Routes()` (WU3) mounting `GET /me/company`, `GET /me/company/members`, `POST /me/company/members`, `PATCH /me/company/members/{id}`, `DELETE /me/company/members/{id}` + `classifyMemberError` (flat `errors.Is` chain mapping the 5 sentinels + unknown). Plus `MemberHandlers()` accessor exposing each handler as a public `http.HandlerFunc` (WU4) so the composition root can apply per-method `r.With(requireOwner\|requireRecruiter)`. After WU5: gated handlers read `requireCompanyContext` (the injected `CompanyContext` from the middleware) and pass `cc.CompanyID` to the service; `getMyMembership` keeps `requireSub` + `sub`. |
| Identity — authz | `CompanyContext{CompanyID, Role}` value type + `ContextWithCompanyContext` / `CompanyContextFromContext` ctx helpers in `identity/domain/security/`. `RequireCompanyRole(users identityrepositories.UserRepository, members companiesrepositories.CompanyMemberRepository, minRole valueobjects.MemberRole) func(http.Handler) http.Handler` in `identity/infrastructure/http/`. Port-only imports (design D5): `companies/domain/{entities,repositories,valueobjects}` + `identity/domain/{entities,repositories,security}` only — no `companies/infrastructure/...` import. Resolves `sub → users.id → company_members` exactly once per request; injects `CompanyContext` on success. Error mapping: missing Claims → 401, unknown sub → 401, `ErrNotAMember` → 403, `role < minRole` → 403, non-domain DB failure → 500 (logged). |
| Wiring | `backend/cmd/api/main.go` — `identityUserRepo` declared up-front, `postgres.NewCompanyMemberRepository(queries)` + `usecases.NewCompanyMemberService(memberRepo, identityUserRepo, companyRepo)` + `companieshttp.NewMemberHandler(memberService)` wired. `/me/company` subtree mounted inside the existing `r.Route("/me", ...)` RequireAuth subtree using `memberHandler.MemberHandlers()` + per-route gates: `GET /company` ungated; `GET /company/members` gated `recruiter`; `POST/PATCH/DELETE /company/members[/{id}]` gated `owner`. |

The middleware is the **only** resolver on the gated path. "Resolves once" is enforced by the type signature (the gated use cases take `companyID uuid.UUID`, not `cognitoSub string`), not just documented.

### Error → HTTP mapping (delivered)

| Sentinel | Status | Source |
|---|---|---|
| `ErrUnknownSubject` | 401 | middleware (sub not found) + `classifyMemberError` (defensive) |
| `ErrNotAMember` | 404 (`GetMyMembership`) / 403 (middleware) | no membership row |
| `ErrMemberExists` | 409 | pg SQLSTATE 23505 `company_members_user_unique` |
| `ErrMemberNotFound` | 404 | cross-company/0-rows update-remove |
| `ErrUserNotFound` | 404 | pg SQLSTATE 23503 `user_id` FK (AddMember target) |
| `ErrInvalidMemberRole` | 400 | VO parse |
| insufficient role | 403 | middleware `role < minRole` |

### Test layer distribution (final)

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit | ~58 | 10 | `go test` (stdlib) |
| Integration | 8 | 2 | `go test -tags=integration` (via `make test-integration`) |
| E2E | 0 | 0 | not available |
| **Total** | **~66** | **12** | |

Integration tests: 4 migration-`00009` tests (`db/migrations/migrations_test.go`) + 4 adapter same/cross-company tests (`companyMemberRepository_integration_test.go`).

---

## Corrections Applied During Apply (WU1–WU4)

Five defects were caught and fixed while implementing, before verification.

| # | Defect | Fix | Evidence |
|---|---|---|---|
| 1 | **Pre-existing `00005` integration test regressed** after adding the new `company_members → users` FK — `cannot drop table users because other objects depend on it`. | Added `DROP TABLE IF EXISTS company_members` to the reverse-down sequence + a re-create step; mirrors the existing pattern for `candidate_profiles` / `candidate_languages`. ~7-line additive maintenance. | `00005_integration_test.go`; apply-progress WU1 Deviations #1 |
| 2 | **Parallel-package test interference.** The full `go test -tags=integration ./...` ran the 00005 test's DROP/CREATE of `company_members` concurrently with the 00009 test's precondition check. | Added `-p 1` to the `test-integration` target in the `Makefile`. The canonical fix for shared-DB integration suites. | `backend/Makefile`; apply-progress WU1 Deviations #2 |
| 3 | **`mapCreateError` name collision** in the postgres package — both adapters (companies + company_members) need a SQLSTATE → sentinel mapper, but same SQLSTATE codes mean different domain errors on different tables. | Renamed company adapter's `mapCreateError` → `mapCompanyCreateError` (call site + 2 tests updated). New member adapter keeps the original name. Same applied to the `companyResponse` / `toCompanyResponse` collision in the http package. | `companyRepository.go`, `companyRepository_test.go`, `memberHandler.go`; apply-progress WU3 Deviations #1 |
| 4 | **`sqlc :exec` doesn't return rows-affected** — needed `RowsAffected()` to surface 0 rows as `ErrMemberNotFound` (design D7). | Switched `UpdateMemberRole` and `RemoveCompanyMember` to `:execrows`. Regenerated. `memberQuerier` interface updated in lockstep. No hand-editing of generated code. | `db/queries/company_members.sql`; apply-progress WU3 Deviations #2 |
| 5 | **Initial cross-company integration test was wrong** — first version passed `callerCompanyID` with a member row that also lived on `callerCompanyID` (same-company path, would have passed on the wrong reason). | Fixed the fixture to seed TWO member rows — one on the caller company (role=owner), one on a foreign company (role=recruiter). Cross-company tests now target the foreign row. | `companyMemberRepository_integration_test.go`; apply-progress WU3 Deviations #3 |

---

## Remediations Applied During Verify (WU5 — D6 remediation)

Verify opened one WARNING: design D6 states "middleware resolves once, gated handlers use injected `CompanyContext.CompanyID`", but the injected `CompanyContext` was never read by production handlers — the gated handlers re-resolved `sub → users.id → company_members` via the service (redundant 2-query DB round-trip per gated request).

| # | WARNING | Remediation | Commit |
|---|---|---|---|
| 1 | **D6 partial deviation.** Injected `CompanyContext` was dead code; gated handlers re-resolved the membership on every request. | The 4 gated service use cases (`ListMembers`/`AddMember`/`UpdateRole`/`RemoveMember`) now take `companyID uuid.UUID`; their `resolveMember` calls are gone. The 4 gated handlers read `requireCompanyContext` and pass `cc.CompanyID` to the service. `GetMyMembership` (ungated) keeps `sub`-based resolution. `TestListMembers_NoReResolveWithCompanyContext` asserts `uRepo.getCalls == 0 && mRepo.getByUserCalls == 0` (the D6 conformance proof at the handler layer). | `56b3416` |

Post-remediation: 0 CRITICAL, 0 WARNING, 4 non-blocking SUGGESTIONS. Verdict upgraded to **PASS**.

### Independently-verified remediation evidence (per `verify-report.md` "Remediation Confirmation")

- `CompanyContextFromContext` now has **1 production call site** (`memberHandler.go:422`), plus the definition + doc at `companyContext.go:53/66`. Pre-WU5: 0 production call sites. ✅
- The 4 gated service methods (`ListMembers` L142, `AddMember` L169, `UpdateRole` L193, `RemoveMember` L206) take `companyID uuid.UUID`; their `resolveMember` calls are gone. `cognitoSub string` remains only on `resolveMember` (L85, private) and the ungated `GetMyMembership` (L118). ✅
- The 4 gated handlers (`listMembers` L220, `addMember` L244, `updateMemberRole` L284, `removeMember` L321) read `requireCompanyContext` and pass `cc.CompanyID` to the service. `getMyMembership` (L194) still uses `requireSub` + `sub`. ✅
- Service tests assert `userRepo.GetByCognitoSub must NOT be called by gated use cases (D6 — resolves once)` at 6 call sites. Handler test `TestListMembers_NoReResolveWithCompanyContext` asserts `uRepo.getCalls == 0 && mRepo.getByUserCalls == 0`. ✅

**D6 is now fully honored.** "Resolves once" is enforced by the type signature, not just documented.

---

## Deferrals (carried forward — NOT delivered)

These are explicitly out of scope and remain open for future changes. A future reader consults the archive; the list below records what the next change will need to pick up.

1. **`POST /jobs`, `PUT /jobs/{id}`, publish/close transitions** — the deferred write side from the `jobs` change. **Prerequisite: this change's `RequireCompanyRole` middleware** is now in place; the next change can mount it on `/jobs` write routes.
2. **`UpdateCompany` / `DeleteCompany`** — same prerequisite. The `companies` slice currently has no per-company authorization.
3. **Role-in-JWT / Cognito custom claims** — **explicitly rejected** in `proposal.md` (stale-token anti-pattern). DB-resolved per request; never from JWT. Documented as out of scope; will not be picked up.
4. **Multi-company-per-user (Model B)** — **explicitly rejected** in `proposal.md`. One-company-per-user by design.
5. **`AddMember` `target.user_type == recruiter` invariant** — design Open Question #1. Spec is silent; deferred per `design.md` §Open Questions to avoid scope creep. Noted here so the next change can decide.
6. **`ListMembers` response: include `user.full_name`/`email` via JOIN** — design Open Question #2. Spec requires roles only; deferred per `design.md` §Open Questions.
7. **Write-side "active company" enforcement** — the `companies.status='active'` rule will need an equivalent guard on write (jobs write side already noted this; this change is the prerequisite).

A defensive guard was left in place: `UNIQUE(user_id)` ensures one-company-per-user at the DB layer (no application logic needed); the named CHECK `company_members_role_check` rejects out-of-enum roles before they reach the domain.

---

## Specs Synced

| Domain | Main spec before | Action | Main spec after |
|---|---|---|---|
| `company-membership` | did not exist | **Created** (mechanical `cp` → temp → `diff -r` → `mv` — see Mechanical Evidence) | `openspec/specs/company-membership/spec.md` |

The delta contained **9 requirements / 25 scenarios, all under `## Requirements`** (the delta spec did not use `## ADDED Requirements` headings — the canonical form was already used). **No REMOVED, MODIFIED, or RENAMED requirements.** Per `rules.archive` ("warn before merging destructive deltas"), **no destructive-delta warning was required**: nothing was deleted or rewritten in `openspec/specs/`, and no pre-existing main spec was touched.

Because `openspec/specs/company-membership/spec.md` did not exist, the delta spec **is** the full capability spec and was copied byte-for-byte. The content was already in canonical form (no delta markers to strip). The `## Requirements` heading is preserved verbatim, matching the `candidates` spec convention (which also uses `## Requirements` without the `ADDED` prefix).

Requirements now in the source of truth:
- **REQ-1**: `company_members` Schema Migration (4 scenarios)
- **REQ-2**: Membership Resolution from Authenticated Subject (1 scenario — the IDOR-resistant "body company_id is ignored" invariant)
- **REQ-3**: `GetMyMembership` (3 scenarios)
- **REQ-4**: `ListMembers` (2 scenarios)
- **REQ-5**: `AddMember` (Owner-Only) (3 scenarios)
- **REQ-6**: `UpdateRole` (Owner-Only, Same-Company) (3 scenarios)
- **REQ-7**: `RemoveMember` (Owner-Only, Same-Company) (3 scenarios)
- **REQ-8**: `RequireCompanyRole` Middleware (4 scenarios)
- **REQ-9**: HTTP Surface Under `/me/company` (2 scenarios)

---

## Source of Truth Updated

- `openspec/specs/company-membership/spec.md` — new `company_membership` capability spec (one-company-per-user, `owner|recruiter` roles, owner-managed lifecycle, server-side `RequireCompanyRole` resolved from `sub`).

This file is the source of truth for future verification and for the next change that amends it. `openspec/specs/{candidates,identity,jobs}/spec.md` were **not touched** by this archive.

---

## Mechanical Evidence (MANDATORY readback)

Archival is a mechanical filesystem operation. Every copy and move below was performed with a native shell command (`cp` / `mv` / `git mv`) — never Read→Write — and verified by a structural `diff -r`. Empty `diff -r` output is the only passing evidence.

### Step 1 — Create `openspec/specs/company-membership/spec.md` (mechanical `cp` → temp → `diff -r` → `mv`)

```
$ cp openspec/changes/company-members/specs/company-membership/spec.md <temp>
$ diff -r openspec/changes/company-members/specs/company-membership/spec.md <temp>
(no output)              # diff exit=0
$ mv <temp> openspec/specs/company-membership/spec.md
$ diff -r openspec/changes/company-members/specs/company-membership/spec.md openspec/specs/company-membership/spec.md
(no output)              # diff exit=0 — byte-identical

$ sha256sum <both>
fe91375b91b4f1e2957ece10aebd64cfdbecaf6008757c5735e7f5f589910822  openspec/changes/company-members/specs/company-membership/spec.md
fe91375b91b4f1e2957ece10aebd64cfdbecaf6008757c5735e7f5f589910822  openspec/specs/company-membership/spec.md
```

Verbatim `diff -r` output: **empty**. Matching sha256 on both sides independently confirms byte-identity.

### Step 2 — Move to archive (mechanical `git mv`, pre-move recursive snapshot)

```
$ rm -f openspec/changes/company-members/archive-report.md     # must NOT be in snapshot
$ cp -R openspec/changes/company-members /tmp/sdd-archive.OwtFfH/source     # pre-move snapshot
SNAP/apply-progress.md
SNAP/design.md
SNAP/exploration.md
SNAP/proposal.md
SNAP/specs/company-membership/spec.md
SNAP/tasks.md
SNAP/verify-report.md

$ git mv openspec/changes/company-members openspec/changes/archive/2026-08-20-company-members
=== moved via: git mv ===

$ test ! -e openspec/changes/company-members && echo SOURCE_GONE
SOURCE_GONE

$ diff -r /tmp/sdd-archive.OwtFfH/source openspec/changes/archive/2026-08-20-company-members
(no output)              # diff exit=0 — byte-identical
```

Verbatim `diff -r` output: **empty** — the archived tree is byte-identical to the pre-move recursive snapshot. The snapshot directory was removed by the shell `EXIT` trap. The `archive-report.md` (this file) was not present in the snapshot; it is additive and written post-move, so it is correctly excluded from the comparison per the Mechanical Copy Contract.

Git recorded the move as renames (`R`) for all seven tracked artifacts; `archive-report.md` (this file) is a new untracked write.

---

## Task Completion Gate

`openspec/changes/company-members/tasks.md` inspection:

- `grep -c '^- \[ \]'` → `0`
- `grep -c '^- \[x\]'` → `31`

No unchecked implementation tasks. Gate passes; no reconciliation needed (no stale checkboxes for completed work).

---

## Review Receipt Gate

`reviewGate` is **structurally absent** — the receipt-driven review kill switch is off for this candidate, and no review was ever discovered. Per the Native Review Receipt Gate contract, this is **not a defect**: archive proceeds under ordinary repository policy. No `review/{transaction,ledger,receipt,gate-context}` artifacts exist; none were read; none needed to be.

---

## Outstanding SUGGESTIONS (carried from `verify-report.md` — non-blocking, do not affect archive eligibility)

Recorded so a future reader does not mistake them for defects requiring rework on `company-members`.

1. **`RemoveMember` cross-company 404 lacks a direct handler-level test** — there is no `TestRemoveMember_CrossCompanyReturns404`. The scenario is fully covered end-to-end at the service + integration + classifier layers, but the `removeMember` handler's own 404 branch is not directly exercised. Follow-up: add a table-driven handler test for the cross-company path; trivial after WU5 because the existing `stubMemberRepositoryForHandler` already exposes `lastRemoveCompanyID` capture.
2. **`MemberHandlers()` accessor (0% coverage)** — the per-route wiring surface used by `main.go` is exposed but not directly exercised by tests; route tests hand-roll a chi router instead. The middleware gate is proven but actual handler dispatch through `MemberHandler.Routes()` is not. Follow-up: add a route-mount test that uses `MemberHandlers()` + `main.go`-equivalent `r.With(...)` wiring.
3. **`respondServerError` (the middleware's 500 branch) is untested** — no unit test drives a non-sentinel error from the user/member repos. The branch is reached only on infrastructure failures (DB down, etc.) which are hard to simulate without mocks. Follow-up: add a fake repo that returns a non-`*entities.Err*` error and assert 500.
4. **Route-level owner gating is tested only for `POST`** (`TestRoutes_RecruiterCannotCallAddMember`); `PATCH`/`DELETE` owner gating is verified by source inspection (`main.go` L204–205) + middleware unit tests, not by route tests. Follow-up: add `TestRoutes_RecruiterCannotUpdateMember` and `TestRoutes_RecruiterCannotRemoveMember` symmetric to the POST test (trivial — same pattern).

These are informational. None blocks archive; none requires re-verification.

---

## Phase Result

- Status: **success — DELIVERED**
- Specs synced: **1 created** (`company-membership`); 0 updated; 0 destructive deltas (no REMOVED/RENAMED → no warning required).
- Archive folder: `openspec/changes/archive/2026-08-20-company-members/` (7 artifacts + this report).
- Source folder gone from active `openspec/changes/`.
- All mechanical copy/move operations verified by empty `diff -r` readback; spec copy additionally confirmed by matching sha256.
- Task Completion Gate: passed (31/31 checked, 0 unchecked).
- Review Receipt Gate: not applicable (`reviewGate` structurally absent; no review discovered).
- 0 CRITICAL, 0 WARNING, 4 SUGGESTIONS. 9/9 requirements, 25/25 scenarios, verdict **PASS**.
- Existing archive entries (`2026-08-19-candidates`, `2026-08-19-jobs`) untouched, per `rules.archive`.

**SDD cycle complete** for `company-members`. The natural successor is the `jobs` write side (`POST /jobs`, `PUT /jobs/{id}`, publish/close) — `RequireCompanyRole` is now in place to gate it.