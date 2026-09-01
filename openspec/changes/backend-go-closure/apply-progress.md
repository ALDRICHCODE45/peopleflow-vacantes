# Apply Progress: backend-go-closure

## RU1 — COMPLETE

### Task 1.1 — spec wording

- Clarified that the 200 body and 409 envelope `data` share the redacted company DTO; outer `error`/`code` remain required.
- Structural check preserved 4 requirements and 18 scenarios; canonical spec unchanged.

### Task 1.2 — catalog core

**RED 1:** compile-safe scaffold failed focused assertions for catalog version, definitions, ordering, and envelope behavior.

**RED 2:** `TestWriteCatalogError_InvalidDefinition` failed behaviorally: ad-hoc 418/code, forbidden/500 mismatch, and custom internal detail reached the wire.

**GREEN / TRIANGULATE:**

- typed 11-code V1 catalog with closed-switch value resolution and fresh ordered slices;
- exact 400/401/403/404/409/413/500 mappings, including distinct company liveness codes;
- unknown or code/status-mismatched definitions normalize to generic `internal_error`/500;
- typed no-data/safe-conflict-data writers and safe-message override;
- mutation isolation, data omission/inclusion, and internal-detail regressions.

**Verification:**

- focused invalid-definition test: PASS;
- `go test ./internal/shared/httpjson -count=1`: PASS;
- `go test ./... -count=1`: PASS;
- `git diff --check`: PASS.

**Measured lines:** `errors.go` 112 + `errors_test.go` 180 + this evidence 33 = 325; small task/spec corrections keep RU1 below the 400-line review budget.

Task 1.6 — taxonomy closure — COMPLETE

## RU1B — COMPLETE (corrective pass)

### Task 1.6 — error taxonomy closure: V1 14-code catalog (corrections applied)

This RU1B quality rerun corrects four mandatory semantic/documentation inconsistencies found by the parent gate.

**Mandatory corrections applied:**

1. **Catalog ordering corrected:** `ListCodes` and the canonical-order test now use the spec/design canonical order: `invalid_request` through `service_unavailable`, then `internal_error` last. The previous implementation placed `internal_error` at index 9 (before the three RU1B additions), which violated the canonical ordering invariant.
2. **Readiness success contract corrected:** spec.md `Stable Error-Code Catalog (continued)` paragraph now states: ready DB → `200` with a small static success body (NOT an error envelope); non-ready DB → `503` with stable envelope carrying `code: service_unavailable`. `/healthz` remains static `200` DB-independent. The incorrect statement "200 with the same envelope shape" is removed.
3. **Design §4.1 arithmetic corrected:** "11 backend-runtime minimum plus three additions" replaced with "original 10 backend-runtime minimum + one additive `industry_unavailable` + three newly audited codes = 14". The old phrasing was ambiguous about whether `industry_unavailable` counted as one of the "three additions" or was separate.
4. **Design §4.2 stale writer statement fixed:** "only for the company PATCH case" replaced with "company/job PATCH/DELETE safe DTO semantics"; lowercase typo "it is not a second envelope" capitalized to "It is not a second envelope".

**Strict TDD — RED:** renamed `TestListCodes_Order` → `TestListCodes_CanonicalOrder` with the canonical expected order. Ran against the pre-fix implementation:

```
ListCodes[9]="payload_too_large", want "already_exists"
ListCodes[10]="internal_error", want "payload_too_large"
ListCodes[11]="already_exists", want "method_not_allowed"
ListCodes[12]="method_not_allowed", want "service_unavailable"
ListCodes[13]="service_unavailable", want "internal_error"
```

Behavioral failure captured: `internal_error` was at index 10, not index 13 (last).

**Strict TDD — GREEN:** fixed `errors.go` `ListCodes` to canonical order; applied gofmt; `Resolve` switch reordered to match; constants reordered to match canonical order; `TestResolve_KnownCodes` rows remain in any order (per subtest naming). All tests green.

**Strict TDD — TRIANGULATE:** `WriteCatalogErrorData` exclusivity confirmed (data only for `conflict`); fail-closed unknown-code; `SafeMessage` preserves new code/status unchanged.

**Verification:**

- `TestListCodes_CanonicalOrder`: PASS (all 14 entries in canonical order);
- `TestResolve_KnownCodes` (14 subcases): PASS;
- `TestWriteCatalogError_InvalidDefinition`: PASS;
- `TestWriteCatalogErrorData`: PASS;
- `TestSafeMessage`: PASS;
- `go test ./internal/shared/httpjson/... -count=1`: PASS;
- `go test ./... -count=1`: PASS;
- `git diff --check`: PASS (no whitespace errors).

**Files changed in this corrective pass:**

- `backend/internal/shared/httpjson/errors.go`: canonical-order `ListCodes` + constant reordering + `Resolve` reorder;
- `backend/internal/shared/httpjson/errors_test.go`: renamed test + canonical-order expected slice;
- `openspec/changes/backend-go-closure/specs/backend-runtime/spec.md`: readiness 200 body correction;
- `openspec/changes/backend-go-closure/design.md`: §4.1 arithmetic fix + §4.2 writer statement + typo fix;
- `openspec/changes/backend-go-closure/apply-progress.md`: this record.

**Measured authored lines (RU1B corrective pass delta only, not cumulative):**

- `errors.go`: ~+6 lines net (constant reordering, `Resolve` reorder);
- `errors_test.go`: ~+8 lines net (renamed test + new expected slice);
- `spec.md`: ~+10 lines (readiness paragraph correction);
- `design.md`: ~+8 lines (§4.1 arithmetic + §4.2 fixes);
- `apply-progress.md`: this entry.

RU1B unit (corrective pass): ~32 authored lines. No inflated whole-change line claims.

**Checked state: 12/96** — tasks 1.1, 1.2, 1.6 remain checked; tasks 1.3–1.5 and all later phases remain unchecked. This pass corrects only the taxonomy-closure unit's documentation and order; no handler adoption, no new feature code, no test file touched outside `errors_test.go`.

**Inline spec-owner correction (user-authorized):** removed the duplicate `Stable Error-Code Catalog (continued)` requirement; moved `ErrorCatalogVersion = 1`/the exact 14-code set into the catalog requirement and the `readyz` 200/503 semantics into the Health requirement. Simplified the design's 10+1+3 catalog arithmetic.

**RU2 incident recovery (user-authorized):** the timed-out RU2 run left no companies implementation but staged planning/RU1B files and falsely marked three task 1.3 stages. The index was cleared without deleting working-tree changes, all task 1.3 rows were reset, and false RU2 completion evidence was removed. Accepted state returns to 12/96; next route is authoritative status before any new RU2 attempt.

## RU2 — COMPLETE

### Task 1.3 — companies HTTP catalog adoption (remediation)

**Strict TDD — RED 1 (missing company context):** extended `TestUpdateCompanyHandler_MissingContextReturns500` and `TestDeleteCompanyHandler_MissingContextReturns500` to assert catalog `code: internal_error` and a generic message with no injected detail. Ran against the legacy `requireCompanyContext` (which calls `httpjson.WriteError`, producing `{"error":"internal server error"}` with no `code` field):

```
TestDeleteCompanyHandler_MissingContextReturns500:
  deleteCompanyHandler_test.go:169: code: want "internal_error", got ""
TestUpdateCompanyHandler_MissingContextReturns500:
  updateCompanyHandler_test.go:206: code: want "internal_error", got ""
```

Behavioral failure: legacy `WriteError` produces no `code` field.

**Strict TDD — GREEN 1:** changed `requireCompanyContext` in `memberHandler.go` from `httpjson.WriteError(500, "internal server error")` to `httpjson.WriteCatalogError(w, httpjson.Resolve(httpjson.CodeInternalError))`. Both extended tests pass.

**Strict TDD — TRIANGULATION 1 (malformed CAS):** renamed and extended `TestUpdateCompanyHandler_MissingCASReturns409` → `TestUpdateCompanyHandler_CASReturns409` as table-driven with two cases (`""`, `"not-a-timestamp"`). Each asserts `code: conflict`, readable `error`, and non-nil redacted `data`. Pass.

**Strict TDD — TRIANGULATION 2 (internal non-leak):** extended `assertCatalogEnvelope` in `handler_test.go`: when `wantCode == CodeInternalError`, asserts `env.Error == "an internal error occurred"` (canonical generic). This proves injected details absent in the `surprise`/`kaboom` 500 cases. Pass.

**Task 1.3 RED wording correction (user-approved):** removed `updated_at` from the forbidden-field list in task 1.3 RED. Canonical PATCH requires `updated_at` as the next CAS token; it is not forbidden. `rfc`/`status`/`deleted_at`/`created_at` remain forbidden. Other task semantics and checkboxes unchanged.

**DB bootstrap:** official Goose migrations 00001–00011 applied via `goose_db_version`; Compose publishes `0.0.0.0:5432`.

**Verification:** focused companies HTTP tests PASS; `go test ./... -count=1` PASS; fresh-DB serial integration with `backend/.env` PASS with zero failures and zero environment skips; the single named `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` skip remains owned by task 2.3; `git diff --check` PASS.

**Deferred fixture-residue debt:** immediate integration reruns expose pre-existing fixed-ID/canceled-context cleanup residue in `TestGetMyMembership_HidesTombstonedCompany`; the maintainer explicitly assigned shared fixture repair to task 2.2. RU2 evidence therefore uses one clean disposable-DB run after official Goose migration.

**Direct parity closeout:** `TestUpdateCompanyHandler_CASConflictReturns409WithView` executes both PATCH paths, decodes the 200 body and 409 `data` as `CompanyEditorViewDto`, and asserts equality with `reflect.DeepEqual`. The exact selector, focused HTTP package, full unit suite, and `git diff --check` all PASS; the corrective test delta is 38 authored changed lines.

**Review slices:** `fcb24d7` (`feat(companies): adopt stable error catalog`) is 260 authored changed lines; `757dfff` (`test(companies): prove conflict envelope parity`) is 207. The combined 467-line candidate was auto-chained so every review unit remains within the 400-line budget. Rollback boundary: revert both commits plus the direct-parity corrective commit to remove RU2 behavior and evidence without touching RU1/RU1B or the unrelated landing preview.

**Checked state: 16/96** — tasks 1.1, 1.2, 1.6 (RU1/RU1B) complete; task 1.3 (RU2 companies) complete; task 1.4 unchecked (Jobs deferred).

---

## RU2/RU3 — Task 1.4 Slice A: Candidates + Industries catalog adoption (Jobs deferred) — CORRECTIVE PASS

> **Scope:** Candidates HTTP + Industries HTTP only. Jobs HTTP catalog adoption is handled in a separate slice. Task 1.4 checkboxes remain unchecked until Jobs is completed.

### Gatekeeper corrective rerun (ONE allowed)

Parent gate REJECTED the previous result for three concrete reasons:

1. `industriesReader.ListActiveIndustries(context.Context) (any,error)` plus reflection is unsafe: field drift silently emits zero values.
2. `backend/cmd/api/main.go` adapter changes are unnecessary composition-root scope drift.
3. The 166-line industries test implements happy/public/field-shape requirements owned by later task 3.2; task 1.4 requires only the NEW handler test proving the DB-failure catalog envelope.

**Mandatory corrections applied:**

1. **main.go RESTORED to HEAD:** `industriesAdapter` type and all `&industriesAdapter{...}` calls removed. No main.go diff remains.
2. **Narrow compile-time interface:** replaced `industriesReader` with method `ListActiveIndustries(ctx context.Context) ([]db.Industry, error)`. `*db.Queries` satisfies this interface directly without an adapter. No `any`, no reflection, no silent field access helpers.
3. **Non-leakage proof:** `handler_test.go` now asserts canonical message `"an internal error occurred"` is present and injected DB detail `"db: connection refused"` is absent. Task 3.2 happy/public/field-shape tests removed.

**Strict TDD — RED:** catalog code assertions failed against legacy `WriteError`.

**Strict TDD — GREEN:** Candidates catalog adoption unchanged (already correct). Industries corrected to: narrow `industriesReader` interface with typed `[]db.Industry` return, direct field mapping (no reflection), and `WriteCatalogError(w, Resolve(CodeInternalError))` for DB failure.

**Verification (this pass):**

- `go test ./internal/features/industries/infrastructure/http/... -count=1 -v`: PASS (`TestListIndustries_InternalErrorReturnsCatalogEnvelope`)
- `go test ./internal/features/candidates/infrastructure/http/... -count=1`: PASS (14 tests)
- `go test ./... -count=1`: PASS
- `git diff --check`: PASS

**Line count (this corrective pass only):**

| File | Additions | Deletions |
| ------ | ----------: | ----------: |
| `candidates/handler.go` | 26 | 26 |
| `candidates/handler_test.go` | 36 | 9 |
| `industries/handler.go` | 17 | 9 |
| `industries/handler_test.go` (new) | 76 | — |
| `apply-progress.md` | 52 | 1 |
| **Total** | **207** | **45** |

Tracked changed lines: 131 additions + 45 deletions = 176. Untracked new file: 76 lines. Total: 252 ≤ 400 budget.

**Confirmed invariants:**

- Jobs files: NOT touched; task 1.4 checkboxes: all 4 remain unchecked
- main.go: zero diff (RESTORED to HEAD)
- No `any` return type; no reflection; no field-drift risk
- Industries handler test: 76 lines (DB-failure + non-leakage proof only)

---

## RU2 Partial — Task 1.4B: Jobs NON-CAS catalog adoption (partial — CAS deferred to 1.4C)

> **Scope:** Jobs HTTP handlers non-CAS paths only. PATCH and DELETE bare-409 CAS writers (DTO without envelope) preserved unchanged; task 1.4 checkboxes remain unchecked until CAS slice completes.

### What changed

`backend/internal/features/jobs/infrastructure/http/jobHandler.go`:

- `classifyError` now returns `httpjson.Definition` instead of `(int, string)`;
- all 4 direct `httpjson.WriteError(w, status, msg)` calls replaced with catalog writers;
- `requireCompanyContext` updated to `WriteCatalogError(w, Resolve(CodeInternalError))`;
- `classifyAndWriteError` updated to use catalog writer.

Catalog code assignments (non-CAS only):

| Error | Code |
| ------- | ------ |
| Invalid UUID / malformed JSON / title/description/salary/VO validation | `invalid_request` |
| Invalid status transition | `invalid_status_transition` |
| Job not found | `not_found` |
| ErrCompanyNotActive | `company_not_active` |
| ErrCompanyGone | `company_not_active` (same code, domain message preserved) |
| Unexpected/missing context | `internal_error` |

### Strict TDD — RED (13 behavioral failures)

Each test's assertion: `code: want "<catalog_code>", got ""` against legacy `WriteError` (no `code` field). Failed tests: `TestCreateJob_MissingCompanyContextReturns500`, `TestCreateJob_MalformedBodyReturns400`, `TestCreateJob_EmptyTitleReturns400`, `TestCreateJob_UnknownVOReturns400` (4 subcases), `TestListJobs_InternalErrorReturns500`, `TestGetJob_InvalidID`, `TestGetJob_InternalErrorReturns500`, `TestSoftDeleteJob_MissingCompanyContextReturns500`, `TestSoftDeleteJob_InvalidUUIDReturns400`, `TestSoftDeleteJob_NotFoundReturns404`, `TestSoftDeleteJob_CompanyNotActiveReturns409`, `TestUpdateJob_MissingCompanyContextReturns500`, `TestUpdateJob_InvalidJobIDReturns400`, `TestUpdateJob_ClosedTerminalReturns400`, `TestUpdateJob_IllegalTransitionReturns400`.

### Strict TDD — GREEN

Converted handler to typed catalog. Domain-specific messages preserved where existing tests assert exact string content (`"job not found"`, `"title must not be empty"`, `"company is gone"`, etc.). CAS bare-409 writers (`WriteJSON` → `view`) unchanged.

### Strict TDD — TRIANGULATE

Shared envelope helpers: `assertCatalogEnvelope` (`handler_test.go`), `jobAssertCatalogEnvelope` (`updateJobHandler_test.go`), `createJobAssertCatalogEnvelope` (`createJobHandler_test.go`), `softDeleteJobAssertCatalogEnvelope` (`softDeleteJobHandler_test.go`).

### Strict TDD — REFACTOR

`go test ./... -count=1`: PASS.

### Line count (relative to e5c3c57)

| File | Additions | Deletions | Net |
| ------ | ----------: | ----------: | ----: |
| `jobHandler.go` | 29 | 51 | -22 |
| `handler_test.go` | 19 | 0 | +19 |
| `updateJobHandler_test.go` | 17 | 0 | +17 |
| `createJobHandler_test.go` | 20 | 3 | +17 |
| `softDeleteJobHandler_test.go` | 17 | 0 | +17 |
| **Total** | **102** | **54** | **+48** |

156 total changed lines (102 additions + 54 deletions) ≤ 400 budget.

### Confirmed invariants

- PATCH `ErrConcurrencyConflict` → `WriteJSON(w, StatusConflict, view)` — bare DTO, no envelope: unchanged
- DELETE `ErrConcurrencyConflict` → `WriteJSON(w, StatusConflict, view)` — bare DTO, no envelope: unchanged
- CAS tests (`TestUpdateJob_CASMismatchReturns409`, `TestSoftDeleteJob_StaleCASReturns409WithView`, etc.): unchanged and still pass
- Task 1.4 checkboxes: all 4 remain unchecked
- Candidates, Industries, task 1.5+, task 1.3: unchanged
- main.go, auth fake writers, route/method/body-limit: unchanged

---

## RU2 — Task 1.4C / Corrective: Jobs CAS envelopes + task 1.4 closeout

**Strict TDD — RED (5 behavioral failures):** updated 5 existing CAS tests to require catalog envelope `{error, code, data}` with `code: conflict`, readable `error`, and non-nil `data` decoded as `JobEditorViewDto`. Ran against bare-409 writer (`WriteJSON(StatusConflict, view)`):

```
softDeleteJobHandler_test.go:166: code: want "conflict", got ""
softDeleteJobHandler_test.go:169: error: want non-empty, got ""
softDeleteJobHandler_test.go:172: data: want non-nil, got nil
(updateJob_CASMismatchReturns409, updateJob_MissingCASReturns409,
 softDeleteJob_MissingCASReturns409WithView, softDeleteJob_MalformedCASReturns409WithView
 — same 3 assertion failures)
```

Behavioral failure: bare DTO body (`{"id":"...","status":"draft",...}`) has no `code`, `error`, or `data` fields.

**Strict TDD — GREEN:** replaced both CAS bare-409 writers with `WriteCatalogErrorData(w, Resolve(CodeConflict), view)` in `jobHandler.go` updateJob (line ~206) and softDeleteJob (line ~302). `WriteCatalogErrorData` writes `{error: "resource conflict", code: "conflict", data: <JobEditorViewDto>}` — same DTO, catalog wrapper only.

**Strict TDD — TRIANGULATE:** all 5 CAS tests decode `env.Data` as `dtos.JobEditorViewDto` and assert representative fields (status, updatedAt, company.ID) — PATCH MissingCAS → `"draft"`; DELETE MissingCAS → `"published"`; StaleCAS → `"draft"` + rowTS; MalformedCAS → rowTS. Companies PATCH parity pattern used for DTO decode (`json.Marshal` → `json.Unmarshal` on `any`-typed `Data`).

**Strict TDD — REFACTOR:** both CAS comment blocks corrected to describe catalog `{error, code, data}` envelope semantics and updated to use canonical catalog message `"resource conflict"` in the comment text (inline comments: updateJob CAS at ~line 222, softDeleteJob CAS at ~line 310).

**Verification:**

- `go test ./internal/features/candidates/infrastructure/http/... -count=1`: PASS (16 tests — 15 prior + `TestUpsertProfile_MalformedJSONReturns400`)
- `go test ./internal/features/jobs/infrastructure/http/... -count=1`: PASS
- `go test ./internal/features/industries/infrastructure/http/... -count=1`: PASS
- `go test ./... -count=1`: PASS (full Go suite)
- `git diff --check`: PASS

**WriteCatalogErrorData writers:** `updateJob` CAS branch (`jobHandler.go` line ~206) and `softDeleteJob` CAS branch (`jobHandler.go` line ~302).

**Task 1.4 closeout evidence (all complete):**

| Component | Evidence |
| --------- | -------- |
| Candidates HTTP catalog — named paths | 16 tests pass (14 prior + `TestUpsertProfile_MalformedJSONReturns400` + `TestUpsertProfile_UnexpectedErrorReturnsInternalError`); `unauthenticated`/`invalid_request`/`not_found`/`internal_error` asserted |
| Candidates HTTP catalog — malformed body | `TestUpsertProfile_MalformedJSONReturns400`: authenticated subject + `{bad` body → HTTP 400 + `code: invalid_request` + readable safe error |
| Industries HTTP catalog | `TestListIndustries_InternalErrorReturnsCatalogEnvelope`: `internal_error` + no DB detail |
| Jobs non-CAS catalog (1.4B) | All `WriteError` → catalog; 13 behavioral failures resolved |
| Jobs company-state pair | `ErrCompanyNotActive` and `ErrCompanyGone` both → `code: company_not_active`; messages differ |
| Jobs CAS conflict envelopes (1.4C) | All 5 CAS tests: `{error, code, data}` envelope + decoded DTO fields. Both CAS inline comments updated: `generic {error:"resource conflict", code:"conflict"}` (updateJob ~line 222, softDeleteJob ~line 310). |

**Ownership correction (user-authorized):** Applications catalog outcomes (`already_exists` for duplicate application), auth/role 403 `forbidden`, and 413 `payload_too_large` evidence remain owned by tasks 1.5 and 6.2 respectively. Task 1.4 owns only Candidates/Industries/Jobs HTTP catalog outcomes as listed above.

**Exact final candidate:** 279 additions + 56 deletions = 335 changed lines against `HEAD` (`8322a8e`), including tasks and apply evidence; this is within the 400-line budget. **Checked state: 20/96** — tasks 1.1, 1.2, 1.6 (RU1/RU1B), 1.3 (RU2 companies), and 1.4 (RED, GREEN, TRIANGULATE, REFACTOR) complete. Tasks 1.5+ remain unchecked and unchanged by this pass.

---

## RU2 task 1.5A — Identity catalog adoption (Identity-only slice)

> **Scope:** `RequireAuth` and `RequireCompanyRole` middleware catalog adoption. Membership and Applications work deferred to later task 1.5 slices. Task 1.5 checkboxes remain unchecked.

### Strict TDD — RED

Focused behavioral tests failed against legacy envelopes because `code` was absent and authentication failures exposed an ad-hoc `reason` shape. The Identity-only GREEN assertions below replace that legacy contract.

### Strict TDD — GREEN / TRIANGULATION

- `middleware.go`: `respondUnauthorized` → catalog `unauthenticated`; `WWW-Authenticate` retained; no `reason` field; verifier detail absent.
- `requireCompanyRole.go`: `respondForbiddenSafe(w, msg)` → `forbidden` with safe domain message; `respondCompanyInactive(w)` → `company_inactive` (tombstoned and missing indistinguishable); `respondServerError(w)` → `internal_error`, detail logged, generic body.
- **Non-leak evidence:** `TestRequireAuth_InvalidToken` asserts no "token"/"verify"/"signature" in body; `TestRequireCompanyRole_InternalErrors` table (3 subtests) proves injected detail absent from wire and present in captured slog output.
- **Forbidden safe-message distinction:** `TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden` asserts exact `"insufficient role"` message; `TestRequireCompanyRole_NonMemberIsForbidden` asserts exact `"not a member of any company"` message; explicit distinctness check proves messages differ; `json.Unmarshal` errors are not discarded.

### Test table (new additions in this corrective pass)

| Test | Scenario | Key assertions |
| ---- | -------- | -------------- |
| `TestRequireCompanyRole_InternalErrors/user lookup unexpected error` | User repo returns non-sentinel error | 500 + `code: internal_error` + canonical msg; detail absent from wire; detail in captured slog |
| `TestRequireCompanyRole_InternalErrors/membership lookup unexpected error` | Member repo returns non-sentinel error | Same 5 assertions as above |
| `TestRequireCompanyRole_InternalErrors/liveness lookup unexpected error` | Liveness repo returns non-sentinel error | Same 5 assertions as above |
| `TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden` | Insufficient role | Exact `"insufficient role"` message; `json.Unmarshal` error handled |
| `TestRequireCompanyRole_NonMemberIsForbidden` | No membership row | Exact `"not a member of any company"`; messages differ from above; `json.Unmarshal` error handled |

### Commands run

```bash
go test ./internal/features/identity/infrastructure/http/... -count=1  # PASS
go test ./... -count=1                                               # PASS (full backend Go suite)
git diff --check                                                      # PASS (no whitespace errors)
```

### Exact final HEAD numstat

```
backend/internal/features/identity/infrastructure/http/middleware.go               11      6
backend/internal/features/identity/infrastructure/http/middleware_test.go           43     10
backend/internal/features/identity/infrastructure/http/requireCompanyRole.go         42     30
backend/internal/features/identity/infrastructure/http/requireCompanyRole_test.go   136    28
openspec/changes/backend-go-closure/apply-progress.md                         48      0
```

**Totals:** 280 additions + 74 deletions = 354 lines. Within 400-line budget. Membership/Applications deferred. No test-count claims made; assertions as stated above. No changes to non-Identity files.

---

## RU2 task 1.5B — Membership core/catalog classifier + writer adoption (partial — Applications deferred)

> **Scope:** Membership HTTP catalog classifier and handler adoption only. No exhaustive transport matrix. Task 1.5 checkboxes remain unchecked; Membership transport evidence is 1.5C and Applications follow afterward.

**Correction applied:** stable safe messages in `classifyMemberError` — `ErrTargetNotRecruiter` and `ErrInvalidMemberRole` no longer call `err.Error()` (wrapper prefix leak); all four not-found sentinels use specific messages (`company member not found` / `user not found` / `company not found`) instead of generic `"not found"`; `ErrMemberExists` stable domain message without wrapper prefix; both Companies and Identity `ErrUserNotFound` resolve to `"user not found"`/404. `classifyMemberError` returns `httpjson.Definition` (typed, not `(int,string)`); all handler call sites use `WriteCatalogError`; internal errors log detail, write canonical generic. Wrapped sentinel cases (7 subtests, including the distinct Identity user sentinel) prove `errors.Is` chain resolution without wrapper text.

**Deferred to RU2 task 1.5C — Membership transport evidence:** exhaustive handler transport matrix (missing-subject tests for all gated paths, remaining direct parse/context branches, unexpected service/log/non-leak proof, same-code/different-message wire triangulation). Do NOT add here.

**Tests run:**

```bash
go test ./internal/features/companies/infrastructure/http/... -count=1   # PASS
go test ./... -count=1                                                  # PASS
```

**Exact final live HEAD numstat:**

```
backend/internal/features/companies/infrastructure/http/memberHandler.go                53     49
backend/internal/features/companies/infrastructure/http/memberHandler_classify_test.go  125     68
backend/internal/features/companies/infrastructure/http/memberHandler_test.go            35     39
openspec/changes/backend-go-closure/apply-progress.md                                    29      2
```

    **Totals:** 242 additions + 158 deletions = 400 lines. At the 400-line budget ceiling. No non-membership files changed. Task 1.5 remains unchecked.

---

## RU2 task 1.5C — Membership transport evidence (test-only; no production change). This continues the task-level RED captured during committed 1.5B core adoption. Exact decoded assertions cover GET missing subject, PATCH invalid UUID/role, remaining reachable transport failures, failure-safe slog/non-leak evidence, and no-call checks for missing-context and unexpected branches; wire triangulation proves equal `invalid_request`/`not_found` codes with unequal safe messages. Verification passed: `go test ./internal/features/companies/infrastructure/http/... -run '^(TestGetMyCompany_(NoSubjectReturns401|MemberButCompanyNotFound|UnexpectedCompanyError)|TestListMembers_UnexpectedServiceError|TestAddMember_(MissingCompanyContextIsServerError|InvalidUserIDReturns400|UserNotFound|UserLookupUnexpectedError|CreateUnexpectedError)|TestUpdateMemberRole_(MissingCompanyContextIsServerError|InvalidMemberIDReturns400|InvalidRoleReturns400|MalformedJSONBody|UnexpectedServiceError)|TestRemoveMember_(MissingCompanyContextIsServerError|InvalidMemberIDReturns400|MemberNotFound|UnexpectedRemoveError)|TestTriangulation_(InvalidRequestMessagesDiffer|NotFoundMessagesDiffer))$' -count=1`, all Companies HTTP tests, `go test ./... -count=1`, and `git diff --check`. Exact HEAD numstat: test `387/4`, progress `6/1`; 393 additions + 5 deletions = 398 lines. Remaining cleanup deletes the actual `httpjson.WriteError` after Applications. Checked state stays 20/96; all four task 1.5 boxes remain unchecked.

---

## RU2 task 1.5D — Applications core classifier (partial; 1.5E deferred)

Core adoption covers every classifier sentinel/default, representative wrapped errors, exact `not_found`/`invalid_request` triangulation, and transition-message safety: direct canonical, validated domain detail preserved, arbitrary prefixes collapsed. No standalone RED is claimed for this recovery slice.
Verification passed: direct classifier selector, all Applications HTTP tests, `go test ./... -count=1`, and `git diff --check`.
Exact HEAD numstat: handler `101/73`, test `204/10`, progress `7/0`; 312 additions + 83 deletions = 395 lines. Task 1.5 stays unchecked; 1.5E retains exhaustive transport and CompanyContext coverage plus unexpected-error logging, non-leak, and no-call evidence.

## RU2 task 1.5E — Applications HTTP transport evidence + `WriteError` cleanup (closeout)

**Scope / RED:** transport-only evidence for the classifier already adopted at the handler in 1.5D, plus the `WriteError` cleanup. No standalone behavioral RED is claimed or fabricated for this slice.
**Evidence:** preconditions on all five handlers (missing subject, invalid path UUIDs, missing company context, malformed JSON) run against `service: nil`, so any use-case call would panic. Every direct classifier sentinel is driven at the HTTP boundary with exact status/code/message and no `data` or extra envelope key: `ErrUnknownSubject`, `ErrApplicationNotFound`, `ErrJobNotApplicable`, `ErrAlreadyApplied`, `ErrStatusRequired`, `ErrCoverLetterEmpty`, `ErrCoverLetterTooLong`, `ErrInvalidSource`, `ErrInvalidApplicationReference`, both `ErrInvalidStatusTransition` shapes (bare and the validated `<from> -> <to>` detail), and `ErrMissingActorIdentity` reached through the use case with a real `CompanyContext` whose `CompanyID` is set and `UserID` is zero (not the earlier `requireCompanyContext` failure), asserting no write. The classifier's default internal branch is covered by every unexpected-service-error row: canonical 500, injected detail absent from the wire, injected detail present in captured slog with `method`/`path`/`error`, and stub-counter guards against unintended later calls.
**REFACTOR:** the actual unused `WriteError` function and its comment are deleted from `backend/internal/shared/httpjson/httpjson.go`; `grep -rn 'httpjson\.WriteError' backend/` and `grep -rn 'func WriteError' backend/` both return empty. The prior task-1.5 `WriteLegacyError` wording was a typo and was corrected in `tasks.md`. No other production behavior change — whitespace-subject handling and CompanyContext requirements are untouched.
**Verification passed:** focused transport selector; Applications HTTP; shared httpjson; Identity + Companies + Applications HTTP; `cd backend && go test ./... -count=1`; `git diff --check`; both `WriteError` searches. Exact live HEAD numstat — transport test `375/0`, `httpjson.go` `0/5`, `tasks.md` `4/4`, this file `9/1`; arithmetic 375+0+5+4+4+9+1 = 398 lines, within the 400-line budget.
**Task state: 24/96** — all four task 1.5 boxes are checked and task 1.5 is closed; next work resumes the remaining task order, including WS2D and WS3A — there is no 1.5F.
