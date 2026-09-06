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

## RU2 task 1.5C — Membership transport evidence (test-only; no production change). This continues the task-level RED captured during committed 1.5B core adoption. Exact decoded assertions cover GET missing subject, PATCH invalid UUID/role, remaining reachable transport failures, failure-safe slog/non-leak evidence, and no-call checks for missing-context and unexpected branches; wire triangulation proves equal `invalid_request`/`not_found` codes with unequal safe messages. Verification passed: `go test ./internal/features/companies/infrastructure/http/... -run '^(TestGetMyCompany_(NoSubjectReturns401|MemberButCompanyNotFound|UnexpectedCompanyError)|TestListMembers_UnexpectedServiceError|TestAddMember_(MissingCompanyContextIsServerError|InvalidUserIDReturns400|UserNotFound|UserLookupUnexpectedError|CreateUnexpectedError)|TestUpdateMemberRole_(MissingCompanyContextIsServerError|InvalidMemberIDReturns400|InvalidRoleReturns400|MalformedJSONBody|UnexpectedServiceError)|TestRemoveMember_(MissingCompanyContextIsServerError|InvalidMemberIDReturns400|MemberNotFound|UnexpectedRemoveError)|TestTriangulation_(InvalidRequestMessagesDiffer|NotFoundMessagesDiffer))$' -count=1`, all Companies HTTP tests, `go test ./... -count=1`, and `git diff --check`. Exact HEAD numstat: test `387/4`, progress `6/1`; 393 additions + 5 deletions = 398 lines. Remaining cleanup deletes the actual `httpjson.WriteError` after Applications. Checked state stays 20/96; all four task 1.5 boxes remain unchecked

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

---

## RU4 task 2.1 — Atomic active-industry gate

**RED:** inactive industry creation incorrectly succeeded and persisted company/member rows; unknown industry returned only the former FK-domain error.
**GREEN:** `CreateCompany` now locks a materialized active-industry CTE and inserts from it; zero rows map through the shared create mapper to `ErrIndustryUnavailable`, then to exact catalog `industry_unavailable`/409 without `data`.
**TRIANGULATE:** deterministic deactivate-first and create-first tests use dedicated backend PIDs and require positive `pg_blocking_pids` plus `wait_event_type = 'Lock'` evidence. No sleeps or timing-only assertions; inactive/unknown paths assert exact sentinel text and zero company/member rows.
**REFACTOR / verification:** focused integration, race detector, Companies HTTP/unit, `go test ./... -count=1`, serial Companies/DB integration, `go vet ./...`, gofmt, sqlc idempotence, and `git diff --check` all PASS against disposable `peopleflow_ws2a`.
**Measured candidate:** implementation/tests 314 changed lines before this note; complete candidate is 333 changed lines.
**Task state: 28/96** — task 2.1 is closed; next task is 2.2 (direct adapters and named constraints).

---

## WS2B task 2.2 — Direct adapter Create/GetByID + named CHECK evidence (final corrective pass)

**Corrective scope:** This final corrective pass adds the five social/cover profile fields (LinkedInURL, InstagramURL, FacebookURL, TwitterURL, CoverImageURL) and RFC/IndustryID readback assertions that were omitted from the prior GREEN. No other test, production code, or section is changed.

**Strict TDD — RED (evidence-absence):** Prior GREEN omitted five profile URL fields and two readback assertions. This pass adds non-nil values for LinkedInURL, InstagramURL, FacebookURL, TwitterURL, CoverImageURL to the `CompanyProfile` struct and adds exact value assertions for all five plus `read.Rfc.Value()` and `read.IndustryID` after `repo.GetByID`. No second RED was fabricated.

**Strict TDD — GREEN:**

- `TestCompanyRepository_Create_Live`: direct `repo.Create`, then `repo.GetByID`, verifies persistence plus every profile field (Name, Status, Website, LogoURL, LinkedInURL, InstagramURL, FacebookURL, TwitterURL, CoverImageURL, Description, Size, FoundedYear, City, Country, Rfc, IndustryID — 16 assertions). UUID-derived RFC avoids math/rand; RFC uppercased via `strings.ToUpper` to match DB normalization. Fresh bounded cleanup context. Re-query proves cleanup.
- `TestCompaniesConstraints_Named`: table-driven with two subtests (invalid_size_gigantic, invalid_year_1500). Read-only pg_constraint query confirms exact live names (`companies_size_check`, `companies_founded_year_check`). Direct SQL INSERT triggers each constraint with distinct UUID/RFC values. Asserts `errors.As(*pgconn.PgError)`, SQLSTATE 23514, and exact ConstraintName. Asserts zero company rows afterward.

**Strict TDD — TRIANGULATE:**

- Valid read-back of all 16 profile + identity fields (9 original + 5 social/cover + Rfc + IndustryID)
- Both constraint violations with distinct invalid values
- Cleanup verified by re-query

**Strict TDD — REFACTOR:**

- Production code: zero diff
- Focused selector: `go test -tags=integration -p 1 -count=1 ./internal/features/companies/infrastructure/postgres -run 'TestCompanyRepository_Create_Live|TestCompaniesConstraints_Named'` — PASS (2 tests)
- Serial integration twice on same DB — PASS both runs (no residue)
- Full unit: `go test ./... -count=1` — PASS (38 packages)
- `gofmt -l` — clean after `gofmt -w`
- `git diff --check` — clean

**Line count (this corrective delta only):**

- `companyRepository_write_integration_test.go`: 284 additions, 20 deletions (304 changed lines)
- `openspec/changes/backend-go-closure/apply-progress.md`: 40 additions (this record)
- `openspec/changes/backend-go-closure/tasks.md`: 4 additions, 4 deletions (checkboxes only)
- **Total delta:** 328 additions, 24 deletions = 352 changed lines — within 400-line budget.

**Files changed:**

- `backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go`: 284 additions, 20 deletions total; added direct adapter/profile/constraint evidence, repeatable cleanup, and corrected stale audit prose
- `openspec/changes/backend-go-closure/apply-progress.md`: corrected field enumeration + line arithmetic
- `openspec/changes/backend-go-closure/tasks.md`: task 2.2 checkboxes checked

**Preserved unchanged:** task 2.3 placeholder skip; task 2.4 behavior; `companyRepository.go` (zero diff); all other tests and sections.

**Task state: 32/96** — task 2.2 is closed; task 2.3 placeholder and task 2.4 behavior preserved unchanged.

---

## RU6 task 2.3 — WS2C deterministic close-failure injection seam (closes D17 item 30 coverage gap)

> **Scope:** replace `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` with a deterministic, instance-local, immutable-after-construction close-seam injection test that proves `SoftDeleteCompany` rolls back the tombstone, the inline close, and the audit append on a forced inline-close failure. The placeholder test (and its obsolete DDL essay) is deleted; the seam is a single unexported field on `CompanyRepository` wired to a production-default `db.New(tx).CloseCompanyJobs` delegate. Public constructor signature and call sites unchanged. No schema edits, no sleeps, no shared-schema DDL, no package globals.

### Strict TDD — RED (compile-safe scaffold; behavioral failure only)

Added seam scaffold to `companyRepository.go`: unexported type `closeCompanyJobsFn func(ctx context.Context, tx pgx.Tx, companyID uuid.UUID) (int64, error)` (seam receives the live `pgx.Tx` so the close runs in the SAME transaction); unexported production-default `defaultCloseCompanyJobs(ctx, tx, companyID)` delegating to `db.New(tx).CloseCompanyJobs`; unexported field `closeFn closeCompanyJobsFn` on `CompanyRepository`; public `NewCompanyRepository` unchanged in signature, now wires `closeFn: defaultCloseCompanyJobs` (call sites unchanged).

`SoftDeleteCompany` still IGNORES the seam in RED: the close call is still `db.New(tx).CloseCompanyJobs(ctx, companyID)` directly, so the production code bypasses the injected failure. Added `TestSoftDeleteCompany_RollbackOnCloseFailure` plus the test-only constructor `newTestCompanyRepositoryWithCloseFn` (which sets `repo.closeFn` after the public constructor returns). The test arms the seam with a sentinel `errCloseForced` and pins all five rollback invariants (injected error returned unchanged; company `deleted_at`/`updated_at` unchanged; draft + published job `status`/`updated_at` unchanged; total `audit_events` count unchanged; no `CompanyDeleted` row for the company). Uses existing committed fixtures (`fixtureSeed` + `seedCompanyAJobs`), no owner seed (audit unreachable after close failure; the `fixtureSeed` baseline row keeps the pre/post count deterministic). Imports added: `github.com/jackc/pgx/v5`.

Focused selector against the un-wired RED scaffold:

```text
=== RUN   TestSoftDeleteCompany_RollbackOnCloseFailure
    companyRepository_write_integration_test.go:1024: SoftDeleteCompany: want errCloseForced (injected), got: <nil>
--- FAIL: TestSoftDeleteCompany_RollbackOnCloseFailure (0.02s)
FAIL
```

Exact behavioral failure: the injected `errCloseForced` is NOT returned (got `<nil>`), proving the seam is not wired AND the tombstone + audit row + job close all commit silently. No compile failures; the seam scaffold compiles and the test runs against the existing production code.

### Strict TDD — GREEN

Changed one line in `companyRepository.go`'s `SoftDeleteCompany`: replaced `db.New(tx).CloseCompanyJobs(ctx, companyID)` with `r.closeFn(ctx, tx, companyID)`. Documented the seam's contract in the call-site comment block: the seam is immutable after construction (set only in `NewCompanyRepository` and the test-only `newTestCompanyRepositoryWithCloseFn`); no global state, no shared mutable map, concurrency-safe by construction. Focused selector PASSES:

```text
=== RUN   TestSoftDeleteCompany_TombstonesAndClosesJobs
--- PASS: TestSoftDeleteCompany_TombstonesAndClosesJobs (0.03s)
=== RUN   TestSoftDeleteCompany_RollbackOnCloseFailure
--- PASS: TestSoftDeleteCompany_RollbackOnCloseFailure (0.02s)
PASS
```

### Strict TDD — TRIANGULATE

Both tests run in the same focused selector with the seam wired:

- `TestSoftDeleteCompany_TombstonesAndClosesJobs` uses `newTestCompanyRepository(pool)` (public constructor + `defaultCloseCompanyJobs` — the disarmed production default). PASS proves the happy path is semantically identical: the inline close rowcount becomes the `jobs_closed` metadata value via `CompanyDeletedMetadata(int(closedCount))`, the audit append runs in the SAME tx, all five invariants (a–e) hold, and exactly one `CompanyDeleted` row is appended with `entity_type='company'` and the seeded `actor_id=<writeOwnerUserID>`. This is the explicit "disarmed production default proves semantics unchanged" triangulation stated in the WS2C evidence goal.
- `TestSoftDeleteCompany_RollbackOnCloseFailure` uses the armed seam (`newTestCompanyRepositoryWithCloseFn`) returning `errCloseForced`. PASS proves every rollback invariant: `errors.Is(err, errCloseForced)`, company `deleted_at`/`updated_at` unchanged, draft + published job `status`/`updated_at` unchanged, total `audit_events` count unchanged, zero `CompanyDeleted` rows for the company.

### Strict TDD — REFACTOR (zero-skip evidence, full suite, hygiene)

```bash
cd backend && set -a && . /tmp/peopleflow-ws2c.env && set +a && \
  go test -tags=integration -p 1 -count=1 -v ./internal/features/companies/infrastructure/postgres
# 48 PASS, 0 SKIP, 0 FAIL
cd backend && go test ./... -count=1                                            # PASS, all packages green
cd backend && go vet ./... && go vet -tags=integration ./...                    # PASS
cd backend && gofmt -l <changed files>                                          # clean
git diff HEAD --check                                                           # PASS (no whitespace errors)
cd backend && set -a && . /tmp/peopleflow-ws2c.env && set +a && \
  go test -tags=integration -p 1 -count=1 ./internal/features/companies/...   # PASS (serial rerun, no residue)
```

Full serial Companies integration (`./internal/features/companies/...`): PASS, zero skips, zero failures; the legacy placeholder skip is gone. `DATABASE_URL` lives only in `/tmp/peopleflow-ws2c.env` (mode 0600); the snippets above source it with `set -a; set +a`.

### Rollback facts (the truth pinned by the new test)

When the seam returns `errCloseForced` between the soft-delete UPDATE and the audit append, `defer tx.Rollback(ctx)` restores EVERY prior write inside the same `pgx.Tx`:

- `companies` row: `deleted_at` stays NULL (the soft-delete SET `deleted_at = now()` is undone), `updated_at` stays at the pre-call value (the `clock_timestamp()` bump is undone).
- `jobs` row: draft stays `status='draft'` with its pre-call `updated_at`; published stays `status='published'` with its pre-call `updated_at`. The inline close never committed.
- `audit_events`: count unchanged; no `CompanyDeleted` row for the company. The audit append never ran (it sits AFTER the close in the operation order and the close failure short-circuits to the deferred Rollback before the append is reached).
- The error returned to the caller is the injected sentinel itself (the seam returns `errCloseForced` unchanged; `mapSoftDeleteCompanyError` is bypassed because the error is not a pg error).

### Scope and exact HEAD numstat (post-format)

```text
backend/internal/features/companies/infrastructure/postgres/companyRepository.go                       53      8
backend/internal/features/companies/infrastructure/postgres/companyRepository_write_integration_test.go 205     44
openspec/changes/backend-go-closure/tasks.md                                                            4      4
openspec/changes/backend-go-closure/apply-progress.md                                                  80      0
```

Arithmetic: 53 + 205 + 4 + 80 = 342 additions, 8 + 44 + 4 + 0 = 56 deletions. Total: 398. Under the 400-line budget. No other file changed; no schema migration, no shared-schema DDL, no `git status` residue (only the four files named above).

**Task state: 36/96** — task 2.3 is closed; task 2.4 (WS2D PATCH/DELETE CAS + races + zero-audit) is the next unit.

---

## WS2D-A partial slice — DELETE CAS loss + malformed CAS transport + DELETE zero-audit (task 2.4 stays unchecked, deferred to WS2D-B)

> **Scope:** DELETE side only. Pre-WS2D-A bug: a lost-CAS adapter result on DELETE returned `ErrCompanyNotFound` (handler → 404) — wrong when the row is just stale, not gone. Post-WS2D-A the use case re-reads on the 0-row adapter path: row present → `ErrConcurrencyConflict` (409); row gone → `ErrCompanyNotFound` (404). Mirrors PATCH step 6 without the editor view (DELETE 409 has no `data`). Deferred to WS2D-B: multi-field persistence plus bidirectional live PATCH/DELETE races.

### Strict TDD — RED

`TestSoftDeleteCompany_LostCASConflictWhenRowStillPresent` + `TestSoftDeleteCompany_LostCASReturnsNotFoundWhenRowGone` against pre-WS2D-A code:

```
deleteCompany_test.go:411: lost-CAS + row present: want ErrConcurrencyConflict (409), got: company not found
deleteCompany_test.go:450: GetCompanyForUpdate: want exactly 2 calls (step 1 + lost-CAS re-read), got 1
```

Pre-WS2D-A the use case propagated `ErrCompanyNotFound` unchanged; post-WS2D-A it must re-read after the 0-row UPDATE and classify as 409 (row present) or 404 (row gone). Handler transport: `TestDeleteCompanyHandler_MalformedCASReturns409` (RFC 1123 + non-RFC3339) and `TestDeleteCompanyHandler_NotFoundReturns404NoRepoCall` pin the canonical envelope `{error, code}` with `code: conflict` (no `data`) and assert zero `repo.SoftDeleteCompany` calls on the 404 path.

### Strict TDD — GREEN + TRIANGULATE + REFACTOR

`deleteCompany.go` re-reads on the `ErrCompanyNotFound` adapter path: row present → `ErrConcurrencyConflict` (409); row gone → `ErrCompanyNotFound` (404); re-read non-domain error → propagates (500). The re-read runs after the adapter's `tx.Rollback` (the `if deleted == 0` branch returns BEFORE the audit append). Two `GetCompanyForUpdate` calls on the lost-CAS path; one on the stale-CAS-at-step-2 path (unchanged). The two unit tests cover orthogonal post-race states; `TestDeleteCompanyHandler_MalformedCASReturns409` table-drives two RFC 3339 violations; `TestSoftDeleteCompany_LostCASAdapterPathAppendsZeroAudit` proves the zero-audit invariant for the only DELETE outcome class where the transaction opens AND rolls back.

```bash
cd backend && go test ./internal/features/companies/... -count=1
cd backend && set -a && . /tmp/peopleflow-ws2da.env && set +a && \
  go test -tags=integration -p 1 -count=1 -run 'TestSoftDeleteCompany' \
  ./internal/features/companies/infrastructure/postgres/...
cd backend && go test ./... -count=1
gofmt -l <changed files>                                  # clean
git diff --check HEAD                                     # PASS
```

All commands PASS. Safe env-loading command only — no DSN, credentials, or `DATABASE_URL` assignment.

### Zero-audit evidence summary (task 2.4 failed outcomes, baseline + new)

| Outcome class | Pre-repository? | Evidence type | Test |
| --- | --- | --- | --- |
| 500 (missing actor) | yes (step 0) | unit no-call | `TestSoftDeleteCompany_MissingUserIDFailsClosed` |
| 500 (missing context) | yes (middleware) | unit no-call | `TestDeleteCompanyHandler_MissingContextReturns500` |
| 409 (stale/missing/malformed CAS, step 2) | yes (step 2) | unit no-call | `_CASMismatch…` + `_ZeroToken…` + `MalformedCAS…` |
| 404 (initial absent, DELETE step 1) | yes (step 1) | unit no-call | `TestSoftDeleteCompany_NotFound` + `_NotFoundReturns404NoRepoCall` |
| 409 / 404 (lost CAS, NEW) | **no** (tx opens, rolls back) | **live audit-count** | `TestSoftDeleteCompany_LostCASAdapterPathAppendsZeroAudit` |
| 400 PATCH invalid JSON (baseline; not new RED) | yes (handler) | unit no-call (`updateCalls == 0`) | `TestUpdateCompanyHandler_InvalidJSONReturns400` |
| 403 owner gate (baseline; not new RED) | yes (middleware) | unit no-call (handler not invoked) | `TestRequireCompanyRole_RecruiterUnderOwnerIsForbidden` + related forbidden |

DELETE has no request body; the 400 class belongs to PATCH. PATCH CAS conflict baseline (`TestUpdateCompanyHandler_CASMismatchReturns409WithView` and friends) is unchanged — WS2D-B owns live bidirectional races plus all-fields persistence (PATCH lost-CAS re-read already exists).

### Files changed + Rollback + Task state

| File | A | D |
| --- | ---: | ---: |
| `backend/.../deleteCompany.go` | 25 | 7 |
| `backend/.../deleteCompany_test.go` | 124 | 7 |
| `backend/.../deleteCompanyHandler_test.go` | 78 | 0 |
| `backend/.../companyRepository_write_integration_test.go` | 93 | 0 |
| `openspec/changes/.../apply-progress.md` | 61 | 0 |

**Live numstat (correction):** 381 additions + 14 deletions = **395 exact changed lines**, including the missing `TestSoftDeleteCompany_LostCASRereadErrorPropagates` branch proof and corrected per-file arithmetic; 5 lines remain under the cap. Verification `sha256:05b64078…0e7b` rejected stale evidence; `sha256:7e4643dc…3c04` passed every candidate gate but rejected its own temporary-file protocol. The audited reset preserved this candidate for one protocol-clean final gate; this record does not claim that gate passed.

Rollback: revert `deleteCompany.go` (re-read logic + corrected step-4 comment) plus the three new unit tests + new integration test; handler tests are additive. No handler or PATCH file touched.

**Task state: 36/96** — task 2.4 remains UNCHECKED; WS2D-B closes multi-field persistence plus bidirectional live PATCH/DELETE races.

---

## WS2D-B1 carve — all-fields live persistence + DELETE no-reread (task 2.4 stays UNCHECKED pending WS2D-B2)

> **Scope:** B1 = compact all-fields `UpdateCompany` live persistence + audit delta +1 AND DELETE-side no-reread semantics (`ErrCompanyNotFound` adapter path → `ErrConcurrencyConflict`, never a second `GetCompanyForUpdate`). B2 = PATCH/DELETE controlled-order live races + zero-audit assertions. Surgical carve of the previous 410-line partial; the 286-line race file collapsed to the all-fields test plus its seeder helpers.

### Strict TDD — RED (captured by the updated unit expectation)

`TestSoftDeleteCompany_LostCASConflictEvenWhenRowGone` against the pre-B1 (re-read-on-zero-row) implementation:

```
lost-CAS + row gone: want ErrConcurrencyConflict (post-WS2D-B 409), got: company not found
```

The pre-B1 branch re-read after a 0-row adapter `SoftDeleteCompany` and returned `ErrCompanyNotFound` if the row was missing — wrong once the use case has observed the row in step 1, because the post-`tx.Rollback` row state is unknowable. The target branch classifies every 0-row adapter result as `ErrConcurrencyConflict` without a second read.

### Strict TDD — GREEN + TRIANGULATE

- `deleteCompany.go` step 4 is now `if errors.Is(err, entities.ErrCompanyNotFound) { return entities.ErrConcurrencyConflict }` — no second `GetCompanyForUpdate`, no separate re-read classifier. Initial lookup absent (step 1 `ErrCompanyNotFound`) still propagates unchanged → handler 404.
- `deleteCompany_test.go` carries the four required scenarios — initial absence → 404 (`_NotFound`), observed row-gone adapter loss → 409 (`_LostCASConflictEvenWhenRowGone`), observed row-present adapter loss → 409 (`_LostCASConflictWhenRowStillPresent`), pre-write stale CAS → no `SoftDeleteCompany` call (`_CASMismatchReturnsConflictNoView`). No `TestSoftDeleteCompany_LostCASRereadErrorPropagates` exists: the reread-error branch is unreachable because the reread is removed.
- `companyRepository_ws2db_integration_test.go` retains exactly `TestUpdateCompany_AllFields_PersistsEveryMutableField` plus the three pointer-typed helpers (`seedRaceCompany`, `auditCount`, `cleanupRaceCompany`) and the `ws2dbIndustryID` constant. All race infrastructure (`raceAudit`, `newBlockingAudit`, `newPassthroughAudit`, `racePair`, `TestCompanies_Race`) and the race-related imports (`errors`, `sync`, `sync/atomic`, `dtos`, `usecases`, `auditrepositories`, `pgx`, `entities`) are removed — B2 re-lands them.

**Runtime B1 seed correction (`42P08` → typed RFC param):** the verifier run caught the seed SQL failing with `SQLSTATE 42P08 inconsistent types deduced for parameter $1` because `$1` was bound both as UUID (for `id`) and as text inside `substring($1::text, 1, 10)`. The minimal, in-scope fix is to compute the RFC string in Go (4-char `WSDB` prefix + first 8 hex digits of the UUID = 12 chars, uppercased via `strings.ToUpper`) and pass it as a separately typed `$3`. RFC stays valid (12 chars) and unique (UUID-derived). DELETE semantics, the four DELETE unit tests, the all-fields test body, the cleanup helpers, and the `ws2dbIndustryID` constant are untouched. `strings` is the only added import. Inline doc comment in `seedRaceCompany` documents the `42P08` rationale so the regression is not re-introduced. No task-checkbox edits, no race infrastructure re-land, no broadened coverage.

### Verification (focused → full)

```bash
cd backend && set -a && . /tmp/peopleflow-ws2db.env && set +a && \
  go test -tags=integration -p 1 -count=1 -v -run TestUpdateCompany_AllFields_PersistsEveryMutableField \
  ./internal/features/companies/infrastructure/postgres/...
# PASS — the all-fields live test passes (not skip) under the
#        /tmp/peopleflow-ws2db.env DATABASE_URL. Repeatable: PASS on rerun.

cd backend && set -a && . /tmp/peopleflow-ws2db.env && set +a && \
  go test -tags=integration -p 1 -count=1 -v -run TestSoftDeleteCompany_ \
  ./internal/features/companies/...
# 12/12 PASS — 8 use-case units (MissingUserIDFailsClosed,
#   CASMismatchReturnsConflictNoView, ZeroTokenReturnsConflict, NotFound,
#   SuccessNoReread, RepoErrPropagates,
#   LostCASConflictWhenRowStillPresent,
#   LostCASConflictEvenWhenRowGone) + 4 integration tests
#   (TombstonesAndClosesJobs, RollbackOnCloseFailure,
#   StaleCASReturnsErrCompanyNotFound,
#   LostCASAdapterPathAppendsZeroAudit).

cd backend && go test ./... -count=1
# PASS (full Go unit suite; integration tests gated by build tag).

cd backend && gofmt -l internal/features/companies/infrastructure/postgres/companyRepository_ws2db_integration_test.go \
internal/features/companies/application/usecases/deleteCompany.go \
internal/features/companies/application/usecases/deleteCompany_test.go && \
  go vet ./... && go vet -tags=integration ./...
# clean.

cd backend && git diff --check HEAD
# PASS (no whitespace errors).
```

### Files changed

| File | Status | LoC |
| --- | --- | ---: |
| `backend/.../deleteCompany.go` | modified | 126 |
| `backend/.../deleteCompany_test.go` | modified | 395 |
| `backend/.../companyRepository_ws2db_integration_test.go` | added (post-fix) | 182 |
| `openspec/changes/.../apply-progress.md` | modified | +~70 |

Surgical carve + 4 required unit tests + 1 live integration test (now runnable under `/tmp/peopleflow-ws2db.env`) + the `seedRaceCompany` parameter-typing fix + this progress entry: well under the 400-line review budget; the previously estimated ~410 partial collapsed by 286 → 170 lines in the integration file, then +7 for the typed-RFC fix, then +5 for the LIFO cleanup-ordering fix (182).

### B1 cleanup-ordering fix (self-reported defect)

The initial B1 evidence was runnable but `defer pool.Close()` in `TestUpdateCompany_AllFields_PersistsEveryMutableField` ran **before** `t.Cleanup(cleanupRaceCompany)`, so the row cleanup ran against an already-closed pool and the seeded company + audit row persisted (`cleanup audit: closed pool` / `cleanup company: closed pool` logged on every run). Fix: replace `defer pool.Close()` with `t.Cleanup(pool.Close)` registered **before** the row cleanup so LIFO ordering removes the rows on an open pool first, then closes the pool. Verification: pre-existing `WS2DB %` residue cleared, focused test run twice consecutively on the same disposable DB — both PASS, zero `closed pool` logs, zero `companies` / `audit_events` residue for the `WS2DB %` prefix; gofmt, `go vet` (with/without `-tags=integration`), `git diff --check`, and `go test ./... -count=1` all clean. Net test-file delta: +5 lines (182 total).

### Live numstat (measured, post-fix)

```bash
git diff --numstat HEAD -- \
  backend/internal/features/companies/application/usecases/deleteCompany.go \
  backend/internal/features/companies/application/usecases/deleteCompany_test.go \
  openspec/changes/backend-go-closure/apply-progress.md
# 14 + 32 + 93  = 139 insertions, 21 + 55 + 0 = 76 deletions
# plus the 182-line new integration test file (untracked).
# arithmetic: 139 + 76 + 182 = 397 <= 400-line budget.
```

Race evidence: **not claimed**; races belong to B2 (`TaskCompanies_Race` and the per-op `racePair` controlled-order subtests are deferred). Task completion: **not claimed** for 2.4. Skips: **not claimed** as zero; the focused live test is skipped only when `DATABASE_URL` is unset (existing `skipIfNoDatabase` policy), and under `/tmp/peopleflow-ws2db.env` it PASSES — the seed `42P08` was the only blocker and is resolved by the typed-RFC parameter.

Rollback: revert `deleteCompany.go` to the pre-B1 step-4 re-read path, restore the race type/helpers/test in `companyRepository_ws2db_integration_test.go`, and drop the B1 entry from this file. No handler or PATCH file touched.

**Task state: 36/96** — task 2.4 remains UNCHECKED pending WS2D-B2 (live PATCH/DELETE controlled-order races + zero-audit assertions).

## WS2D-B2a — PATCH post-observation conflict semantics (partial 2.4)

**Scope:** classify the adapter's zero-row result after the step-1 company read as `ErrConcurrencyConflict`; preserve initial absence as `ErrCompanyNotFound` and propagate unrelated adapter errors unchanged. Live race orchestration and task 2.4 closure remain B2b.

### TDD evidence

- RED from the pre-B2 branch: DELETE-wins/PATCH-loses returned `ErrCompanyNotFound` after the post-loss reread; the required observed-loss contract is `ErrConcurrencyConflict` with the pre-race editor view.
- GREEN: `UpdateCompany` no longer re-reads after an adapter `ErrCompanyNotFound`; because step 1 already observed the row, this path is a CAS loss. `TestUpdateCompany_UpdateLostRaceAfterDeleteTombstoneReturnsConflict` pins the 409-domain result and pre-race view.
- TRIANGULATE: `TestUpdateCompany_NotFound` preserves initial-absence 404-domain behavior; `TestUpdateCompany_UnrelatedAdapterErrorPropagates` proves non-CAS errors are returned unchanged with no view.

The focused use-case suite passed during apply. B2a intentionally makes no live-race, HTTP-live, audit-cardinality, full-suite, or task-completion claim. The deterministic two-order live race draft is preserved externally for B2b and task 2.4 remains unchecked.

Rollback: restore the post-loss reread and its sequence stub/tests. B2b must then be redesigned because DELETE-wins/PATCH-loses would again classify as 404.

## WS2D-B2b — deterministic live PATCH/DELETE races; task 2.4 closed

`TestUpdateDeleteRace_ControlledOrder` uses two one-connection repository pools and a winner-only audit decorator. The decorator performs the real audit append inside the write transaction, signals readiness, and holds the transaction open. The loser then reaches the same row lock; `pg_blocking_pids` proves the designated winner blocks it before release. There are no sleeps.

### Race evidence

| Ordering | Winner | Loser | Final state | Audit delta |
| --- | --- | --- | --- | --- |
| PATCH wins / DELETE loses | PATCH succeeds | repository zero-row → DELETE use case 409 | live; winner website; token advanced | exactly +1 `CompanyUpdated`; zero `CompanyDeleted` |
| DELETE wins / PATCH loses | DELETE succeeds | repository zero-row → PATCH use case 409 | tombstoned | exactly +1 `CompanyDeleted`, `jobs_closed=0`; zero `CompanyUpdated` |

Both operations share the original CAS token. The loser is observed waiting on the winner's backend PID before the hold is released. Result channels are joined under bounded contexts; a deferred idempotent release precedes the wait on every post-loser exit path. Each subtest seeds and removes its own company/audit rows.

Apply evidence: the focused live race passed twice consecutively with both orderings, no skips and zero `WS2DB %` residue. The Companies integration suite, full unit suite, both vet modes, read-only format check, and diff check are the final verification gate for this exact candidate.

Task 2.4's earlier units supply malformed/missing CAS transport, invalid-body/no-call behavior, initial absence, stale CAS, failed-outcome zero-audit, atomic all-fields persistence, and adapter rollback evidence. B2b supplies the remaining controlled-order live race proof. Transport unit tests map success to 200/204 and `ErrConcurrencyConflict` to 409; this repository-live test does not claim to be HTTP E2E.

Rollback: remove the race decorator/helpers/test and uncheck task 2.4. B2a remains independently valid but task 2.4 becomes partial.

**Task state: 40/96** — task 2.4 complete; next ordered task is 3.1.

---

## WS3A task 3.1 — Candidate full-replacement contract, `field_of_study`, CV-key reserve (candidate A; B split out)

**Budget split (hard 400-line cap):** the completed task measured 524 changed lines, so it is delivered as the pre-authorized split. Candidate A (wire contract/CV reserve + static/API tests): 366 code/test lines + 16 progress lines = 382 ≤ 400. Candidate B (live replacement matrix + task closure): `TestUpsertProfile_FullReplacementPersists` + `TestUpsertProfile_PreservesReservedCvS3Key` additions in `candidateRepository_test.go`, `TestCandidateProfilesCvS3KeyReservedNullable` in `00006_integration_test.go`, and the task/progress closeout. B is stacked on A (its live assertions require A's SQL change) and remains below the 400-line cap.

**RED (compile-safe, all against pre-edit tree):** `go test ./internal/features/candidates/infrastructure/http -count=1` failed exactly on: `TestProfileWireContract_StaticScan` (0 exact `field_of_study` tags; defective `field_of study` present; `cv_s3_key`/`CVS3Key` present in handler.go); `TestUpsertProfile_CvS3KeyNotClientWritable` (PUT response echoed `cv_s3_key`; stub received the client value; GET exposed a seeded reserved value); `TestFieldOfStudy_RoundTrip` (value silently dropped PUT→GET); `TestUpsertProfile_FullReplacementContract/malformed_birth_date_rejects_without_write` (500 instead of the pinned 400 — no-write itself held). Integration RED on disposable `peopleflow_ws3a`: `TestUpsertProfile_PreservesReservedCvS3Key` failed — the pre-fix upsert overwrote a directly-seeded `cv_s3_key` to NULL (proves the write-path defect at the DB boundary). Characterization subtests already passing pre-GREEN: omitted/explicit-null → NULL + `{}` skills + `MXN`, server-managed fields ignored, live full-replacement contrast read, cv_s3_key column nullable.

**GREEN:** request tag fixed to `field_of_study`; `cv_s3_key` removed from BOTH the request and response structs and from the handler→DTO mapping in `handler.go`; `CVS3Key` removed from `UpsertMyProfileDto`, the use-case copy block, and `buildUpsertParams`; `candidates.sql` upsert drops `cv_s3_key` from INSERT and DO UPDATE SET (reserved value survives every upsert), with `internal/db/candidates.sql.go` + `querier.go` regenerated via sqlc; SELECT/RETURNING `cv_s3_key` and `toEntity`'s internal `CVS3Key` read mapping retained. New `usecases.ErrInvalidBirthDate` wraps the parse error and `classifyCandidateError` maps it to 400 (fixes the RED 500).

**TRIANGULATE:** `TestFieldOfStudy_RoundTrip` PUT→GET unchanged; static scan proves both wire names and no boundary `cv_s3_key`/`CVS3Key`; empty/default contrasts (omitted vs present `city`/`field_of_study`/`salary_currency`) in the live test; malformed `birth_date` now 400 with zero repository calls.

**REFACTOR:** stale "leave unchanged on update" comments replaced with full-replacement wording in handler/DTO/usecase/repository/SQL. Verification: `go vet ./...`, `go test ./... -count=1`, `go test -tags=integration -p 1 -count=1 ./internal/features/candidates/... ./internal/db/...` (disposable `peopleflow_ws3a`, zero skips in candidates packages), gofmt clean, `git diff --check` — all PASS.

**Task state: 44/96** — task 3.1 is checked after the parent split A/B into two bounded candidates.

---

## WS3B task 3.2 — Industries contract + single canonical route (corrective pass)

**RED (verifier FAIL = corrective RED):** integration smoke recreated `r.Get("/industries", ...)` itself instead of exercising production wiring. **GREEN:** new production-owned registrar `industrieshttp.RegisterRoutes(r, q)` (handler.go); `main.go` calls it exactly once; live smoke `canonicalIndustriesRouter` calls the same registrar. Guard rewritten: EXACTLY one `industrieshttp.RegisterRoutes` call and ZERO literal `/industries` chi registrations in main.go; RED captured (`got 0`), mutation checks FAIL correctly on a duplicate registrar call (`got 2`) and a reintroduced literal `r.Get` (`got [Get]`).

**TRIANGULATE (live `/tmp/peopleflow-ws3b.env`):** unchanged contract evidence — inactive excluded, tied `sort_order=5` id-ordering (`ws3b_b < ws3b_a < ws3b_c`), exact four-key elements, 200+`application/json`, Authorization ignored, closed-pool 500 `internal_error` envelope — all served through the shared registrar. **REFACTOR/verification:** focused industries+cmd/api, full unit (38 pkgs), live integration (5 PASS, no skips), both `go vet` modes, gofmt, `git diff --check` — all PASS.

**Candidate:** 393 changed lines (192 additions + 6 deletions tracked + 195 untracked), ≤ 400. **Task state: 48/96** — task 3.2 closed; next ordered task is 4.1.

## WS4A-A task 4.1 (core) — Embedded migrations + `cmd/migrate` core, non-live (corrective closure)

**RED (historical scaffold RED, binding) + user-authorized R3 replay (correction evidence, no chronology change to the historical RED):** historical — compile-safe scaffolds first — nil/empty `MigrationsFS` and a parse-only `run` exiting 3 `not_implemented`; `go test ./cmd/migrate ./db/migrations -count=1` failed on 5 genuine signals (embed `nil/empty FS contains no migrations`; missing-config/unreachable-DB/cancelled-context hit `not-implemented` instead of running; usage text missing). Authorized correction replay: with exactly `db.Conn(lockCtx)` mutated to `db.Conn(ctx)` (advisory-lock exec left on `lockCtx`), `go test ./cmd/migrate -run '^TestRunLockAcquisitionIsBounded$' -count=1 -v` failed genuinely — `lock-stage deadline probes (conn, exec) = (false, true)` — proving the dedicated-connection acquisition context carried no deadline; restoring `db.Conn(lockCtx)` returned the same focused test to PASS.
**GREEN (final implementation):** `go:embed *.sql` → `MigrationsFS fs.FS`; `run(ctx,args,stdout,stderr)` seam: parse→config→`sql.Open`→10s-bounded ping→dedicated `*sql.Conn` with `SELECT pg_advisory_lock($1)` on key `0x50465F4D494752` (hex literal in source; decimal `22595373269337938` pinned by `TestAdvisoryLockKeyMatchesDocumentedHex`) acquired on a single 15s-bounded, parent-preserving `lockCtx` (`WithTimeout` over the signal context) covering both `db.Conn` and the blocking lock exec — `TestRunLockAcquisitionIsBounded` proves both contexts carry a deadline →one context-aware goose op→`SELECT pg_advisory_unlock($1)` on an independent 5s-bounded context (`WithTimeout` over `WithoutCancel`); static classified failures (stage ∈ parse/config/open/ping/lock/migration/unlock) are emitted once as one JSON record with static literal messages only — raw driver errors, args, and the DSN are never written — and a migration+unlock double failure produces exactly one record, the unlock stage dominating (`TestRunMigrationUnlockAggregatesToExactlyOneRecord`, whole-buffer single-document decode).
**Verification (corrected, factual):** the `backend/migrate` ELF story, stated accurately — an earlier corrective worker briefly ran `go build ./cmd/migrate/`, recreating the generated ELF `backend/migrate`, then deleted that ELF itself; the final tree ships no `backend/migrate` artifact (the later independent verifier's `go build ./...` did not recreate it). `go test ./cmd/migrate ./db/migrations -count=1` = 2 pkgs ok (this closure: compile-repaired table literals, gofmt-clean, focused lock-timeout probes `TestRunLockAcquisitionIsBounded`/`TestNewUnlockContextIndependentAndBounded`/`TestAdvisoryLockKeyMatchesDocumentedHex` all PASS); `go vet ./cmd/migrate ./db/migrations` OK; `gofmt -l` on the four files empty; `git diff --check HEAD` clean. No live DB or real DSN used; stub-driver tests cover migration-failure and unlock-failure paths.
**Not in this unit (deferred to WS4A-B per split):** live round-trip harness (`main_integration_test.go`, `-tags=integration -p 1`), Makefile labelling, go.mod tidiness. Task 4.1 remains unchecked.
**Candidate:** 391 source/test lines in the four untracked files (`cmd/migrate/main.go` 136, `main_test.go` 190, `db/migrations/embed.go` 18, `embed_test.go` 47) + 8 progress lines = 399 ≤ 400. Rollback boundary: delete `backend/cmd/migrate/` and `backend/db/migrations/embed.go`+`embed_test.go`; existing Make/goose path untouched. Task state remains 48/96.

## WS4A-B task 4.1 — live built-binary migration closeout

**TRIANGULATE:** Built binary PASS: safe unreachable failure; disposable DB first/idempotent up, status, 11 downs to version 0, re-up catalog equality; lock serialization; SIGINT exit 3 exact static lock record.
**Verification:** `go test -tags=integration -p 1 -count=1 ./cmd/migrate ./db/migrations`, `go test ./... -count=1`, `go vet ./...`, `go build ./...`, and `git diff --check` PASS; zero skips.
**Candidate:** 391 additions + 9 deletions = 400 changed lines. **Task state: 52/96** — task 4.1 closed.

## WS4B task 4.2 — CORRECTIVE RED REPLAY (evidence-only; explicitly NOT historical chronology)

> This entry records a parent-authorized, evidence-only corrective replay. It does NOT rewrite or claim the historical task-4.2 RED chronology: no valid RED ever existed in the real tree for 4.2, because the original recorded RED failed on missing symbols instead of behavior. The real workspace backend files were never modified by this replay.

**Why the original RED was invalid:** the first task-4.2 RED failed with missing-symbol/compiler errors, which the task conventions ("RED that fails only because a package/symbol does not compile is invalid and must not be recorded as RED") and the task-4.2 RED row itself forbid. The GREEN/TRIANGULATE/REFACTOR rows had also been checked before any WS4B commit landed, violating `openspec/config.yaml` ("Mark tasks with [x] only after the corresponding commit lands"); all four task-4.2 rows were therefore returned to unchecked at replay time.

**Corrective replay protocol (isolated temporary copy only):** `backend/` was copied to a fresh `mktemp -d` directory excluding `.env`, `.env.*`, `*.pem`, `*.key`, `*.crt`, and binaries (`backend/migrate`, `*.exe`, `*.test`, `*.out`); a find sweep over the copy proved none of those were present. In the copy ONLY, the two production implementations were replaced by compile-safe scaffolds preserving every symbol the already-written tests need: adapter `Handle` always returned one static "not implemented" error and did not reject wrong trigger sources; `cmd/postconfirmation` `loadConfig`/`run` refused every configuration with one static "not implemented" error, creating no dependency and starting nothing.

**Behavioral RED failures observed under the compile-safe temp scaffolds (sanitized; both packages compiled — zero build failures):**

- Adapter package (4/4 top-level tests failed): the attribute-forwarding test failed because `Handle` returned the static not-implemented error and invoked the handler zero times; both official-trigger-source subtests failed identically; all five wrong-source subtests failed expecting `ErrUnsupportedTriggerSource` but got the not-implemented error (proving the scaffold does not reject wrong sources); the handler-error-propagation test failed because the static scaffold error replaced the handler's own error.
- Executable package (2/2 top-level tests failed): all five valid-config `loadConfig` subtests failed with "loadConfig returned error: ... not implemented"; the invalid-config subtests passed incidentally against the always-error stub; the `run` subtests failed with zero pool opens, zero pings, zero pool closes, and "run returned error" for both the valid production and the valid local-explicit-false configurations — the stub refuses even the valid local case, exactly the failure class the RED row predicts. Every observed failure message was a static literal: no email, name, attribute, DSN, credential, or raw DB/driver text was captured or persisted.

**Real-tree state after the replay:**

- Byte-identity proven: the aggregate sha256 over all `backend/` files is identical before and after the replay — `269e9e64a7437be257399af0883a279c390b1929594afc33eec7c3eec5941b31`.
- Focused GREEN commands rerun in the real workspace: `cd backend && go test ./internal/features/identity/infrastructure/lambdapostconfirmation/... -count=1` PASS; `cd backend && go test ./cmd/postconfirmation/... -count=1` PASS (both suites are fake-backed unit tests — no AWS runtime or service calls, no DB contact).
- Live integration and full gates for the WS4B candidates were already independently passed (adapter live idempotency under `-tags=integration -p 1`, full `go test ./...`, `go build ./...`) and remain valid; this replay changed no source.
- Cleanup proven: the temp directory was removed and `test ! -e` confirmed it gone; no `ws4b-red-replay.*` directory remains under /tmp.

**Budgets and replay-time task state:** WS4B-A candidate 319 changed lines (`go.mod`/`go.sum` + adapter/tests); WS4B-B candidate 400 changed lines (`cmd/postconfirmation` main/tests). At replay time the task state remained **52/96**, with all four task-4.2 rows unchecked until their commits landed.

**Post-commit closure:** WS4B-A landed as `0242088`; WS4B-B landed as `a6c51a5`. All four task-4.2 rows are now checked. **Task state: 56/96**; next ordered unit is task 5.1 (WS5A).

## WS5A closure — commit `53ebe81`

WS5A explicit verifier configuration factory is closed under approved review lineage `review-519d5bc2f0f7390d`. The commit covers the two auth files `backend/internal/features/identity/infrastructure/auth/config.go` and `backend/internal/features/identity/infrastructure/auth/config_test.go`, plus the WS5A task-state update.

**Verification:** focused auth tests (`cd backend && go test ./internal/features/identity/infrastructure/auth -count=1`) PASS; full suite (`cd backend && go test ./... -count=1`) PASS; `cd backend && go vet ./...` PASS; `gofmt -d` on changed Go files is clean. Runtime harness: N/A (no executable boundary in WS5A).

**Rollback boundary:** revert the two auth files named above and the WS5A task-state update only; WS5B and WS5C remain untouched.

**Post-split task state:** 60/100 checklist boxes complete. The approved WS5B split is represented by sequential WS5B-1/RU13A and WS5B-2/RU13B units, each forecast at no more than 400 authored changed lines and delivered stacked-to-main; verify/sync/archive remain blocked until implementation completes.

## WS5B-1 / RU13A — bounded JWKS cache and single-flight core

**RED / GREEN:** an isolated compile-safe stub replay failed behaviorally on fetch bounds/parsing, cache/TTL, and refresh mechanics; the real implementation adds bounded HTTPS fetch, deep immutable snapshots, verifier-owned lifecycle, and one shared refresh while `Verify` remains deliberately unimplemented.
**TRIANGULATE:** injected-clock, key-mutation, server-failure, concurrent-waiter, cancellation, deadline, and `Close` cases prove TTL, whole-set replacement, single-flight, independent waiters, and bounded shutdown without sleeps as correctness conditions.
**REFACTOR / verification:** focused auth, full `go test ./... -count=1`, vet, gofmt, and diff checks PASS; runtime harness N/A (library core only). Rollback removes the two JWKS files and this evidence without touching WS5B-2/WS5C. Exact candidate including four task-state rows: 400 changed lines; task state 64/100.

## WS5B-2 / RU13B bounded candidate — TDD Cycle Evidence

| Task | RED provenance | GREEN / TRIANGULATE / REFACTOR |
|---|---|---|
| 5.2b | Prior worker proved the committed Verify stub RED; continuation RED caught missing `exp` and cached verification after `Close`. | Focused auth tests pass; RS256/claims/rotation, deterministic starter cancellation, owned deadline, injected TTL, and bounded idempotent Close are covered. |

- Candidate: 391 additions + 9 deletions = 400 changed lines; RU13B boxes remain unchecked pending parent gate/commit.
Post-commit closure: implementation commit `fdcea15` (`feat(identity): verify JWKS tokens and rotation`) landed as the exact 400-line RU13B candidate after independent verification PASS; the four task 5.2b boxes are now checked and task state is 68/100.

## WS5C closure — commit `c5643f1`

WS5C fail-closed verifier composition is closed by implementation commit `c5643f1` (`feat(identity): wire fail-closed verifier composition`): 397 changed lines across `backend/cmd/api/main.go` (15+62), `backend/cmd/api/main_test.go` (114), and `backend/internal/features/identity/infrastructure/http/middleware_test.go` (204+2). Strict-TDD RED provenance: behavioral RED against the prior "warn and install deny-all" composition — API refuses to start without a valid explicit mode, and route scans proved the "/me/*" subtree wrapped with all verifier errors mapped to catalog `unauthenticated` 401 (the no-fallback 401 assertion was proven non-vacuous: with the endpoint restored healthy before `Close`, an ineffective Close counter-mutation yields 200). GREEN/TRIANGULATE: composition wires through the WS5A factory with the deny-all fallback removed; production cannot start permissively under misconfiguration and local PEM mode still fails closed at runtime; corrected lifecycle defers `Close()` for the closable factory verifier on every post-construction return. REFACTOR/verification: independent verifier `gentle-ai-verify` task `subtask_gentle-ai-verify_1788411341324_192d38ea` PASS; gates passed — focused API/identity tests, identity HTTP + cmd/api race tests, full `go test ./... -count=1`, `go build ./...`, `go vet ./...`, read-only gofmt, diff hygiene, exact scope/budget, semantic checks. Final diff fingerprint before commit: `c5360183c53d49247b87b7c665f4193d058b1c90e4620a15a73061177d14694e`. Receipt-driven review disabled/unmanaged; no review lineage or receipt claimed.

**Budget:** 397 changed lines (within the 400-line budget). **Rollback boundary:** revert the three files above and this reconciliation's task-state/evidence updates only; WS5A and WS5B remain untouched. **Task state: 72/100** — all four task-5.3 (WS5C) boxes checked; verify/sync/archive remain blocked until implementation completes. Next unchecked unit: task 5.4.

## WS6B-1a TDD Cycle Evidence — runtime/config + runtime/health + runtime/server (split A of task 6.1; main.go untouched)

| Task | Evidence |
| --- | --- |
| 6.1a | Maintainer-approved audited reset of generation 74 for evidence reconciliation, scoped only to recovered WS6B-1a; historical RED chronology is unavailable due to the interrupted attempt (scaffold-RED transcript lost) and is explicitly NOT claimed; under the maintainer-approved exception (scoped only to recovered WS6B-1a), mutation probes substitute for chronology by proving non-vacuity, NOT by pretending to be historical RED. Probe A: discarding the post-Shutdown serve result caused TestRun_CancelRacingServeErrorClassifiesError to FAIL with nil instead of the racing serve error. Probe B: returning on cancellation without Shutdown/Close caused all four lifecycle cancellation tests to FAIL. Probe C: double readiness ping caused TestReadyz to FAIL with 2 pings instead of exactly 1. All probes were applied, run, and reverted byte-identically. GREEN/TRIANGULATE/REFACTOR and independent attempt-91 evidence: all focused/repeated/race/full tests, build, vet, gofmt, diff hygiene, semantic checks, exact scope, and 400-line arithmetic passed; verifier made 0 changes and fingerprint remained sha256:4b86dc7f24c24adbea84da506c810ba5a1352b5448d7683cc2b99db059e8aa26. Lineage: correction evidence sha256:f056aabaa499443db547462ff244ba01626b49314fcde851fbc6faf0a488e03f repaired original semantic failure sha256:23de587ead05d450bc346d36317940f214751d1924cfba92efd43a117be62b2a; evidence reconciliation now repairs sha256:4b86dc7f24c24adbea84da506c810ba5a1352b5448d7683cc2b99db059e8aa26. Arithmetic: config.go 41 + config_test.go 57 + health.go 39 + health_test.go 74 + server.go 59 + server_test.go 126 = 396; progress +4 = 400. Task 6.1 remains fully unchecked pending WS6B-1b; no task completion or archive claim. |

## WS6B-1b-a TDD Cycle Evidence — composition-root rewiring + guard retargeting (split B-a of task 6.1)

- **RED (genuine successor cycle; main.go first restored to baseline `d63bf3e`, candidate preserved externally):** focused guard selector failed behaviorally/statically — `healthz=0 readyz=0` (baseline /healthz is an inline DB-pinging FuncLit, /readyz absent), `server.New=0 server.Run=0 DefaultServerConfig=0`, and route-topology drift whose ONLY diff was missing `Get /readyz` (other 22 registrations identical); full `go test ./cmd/api -count=1` on baseline: exactly 3 failures, 16 passes, 0 skips. No RED was fabricated.
- **GREEN:** candidate `main.go` reintroduced byte-identically (`cmp`-proven); all three focused tests PASS (runtime health mounting, runtime lifecycle wiring, all 23 registrations exact).
- **Mutation probes (non-vacuity; main.go restored byte-identically after each, `cmp`-proven):** duplicate `/healthz` FAIL; `/readyz`→`health.Healthz` FAIL; `Patch("/jobs/{idx}")` topology FAIL; PATCH `/company` gate →`requireRecruiter` FAIL; PATCH `/company` line deleted FAIL (old-guard false positive eliminated).
- **Verification PASS:** `go test ./cmd/api -count=1`; `go test ./... -count=1`; `go vet ./...`; `gofmt -l` changed Go files clean; `git diff --check` clean.
- **Exact arithmetic vs `d63bf3e`:** main.go 26+/41−, main_test.go 258+/53−, apply-progress.md 12+/0−; total 390 ≤ 400.
- **Rollback boundary:** revert `backend/cmd/api/main.go`, `backend/cmd/api/main_test.go`, and this entry only. Router-constructor extraction and the physical route move are deferred to WS6B-1b-b (route registrations preserved byte-for-byte; topology guard proves it). Task 6.1 remains fully unchecked — no task boxes touched.
- This entry repairs rejected evidence `sha256:cfe92d5e…47b5`, whose sole defect was omitting the 30 progress lines from reported arithmetic; reduction-only correction, no behavior, assertion, route-topology, or RED-chronology change.

## WS6B-1b-b TDD Cycle Evidence — router-owner extraction to router.go (split B-b of task 6.1)

- **RED replay** (fresh, not historical; temp copy with HEAD main.go `1692695d…`, router.go absent, current guard tests): compile-safe (`go vet ./cmd/api` OK) — TestRouterOwner_HealthAndReadinessMounted FAIL "cannot parse router owner router.go", TestMainComposition_DelegatesRouterConstruction FAIL `newRouter=0 chiRegistrations=39`, TestRouteTopology_ExactRegistrations FAIL; missing router owner/delegation, not compilation. Real tree byte-unchanged by the replay. **Guard-defect RED (correction rerun, pre-edit):** direct-With mutations `r.With(d.requireAuth).Get("/companies/{id}",…)`, `r.With(d.requireAuth).Mount("/jobs",…)` both incorrectly PASSED TestRouteTopology_ExactRegistrations and `industrieshttp.RegisterRoutes(r.With(d.requireAuth),…)` incorrectly PASSED TestIndustriesRoute_SingleCanonicalRegistration — reproducing the rejected-evidence defect sha256:cea6c69f6faf3ad49493717d1e0d59696f3db85cae5a0586cea396a6b4db36f4; after the test-only fix the same three mutations FAIL (P7–P9 above).
- **GREEN + nine non-vacuity probes** (temp copies, each mutation fails ≥1 guard; candidate restored byte-identically after every probe, cmp-proven): GREEN — focused owner/delegation/topology/industries/jobs-public selectors PASS (9/9), all 23 chi registrations exact. P1 public /jobs read moved behind auth (Route+Use wrap) → TestJobsMount_PublicReadRoutes + TestRouteTopology; P2 owner-gated PATCH /company removed (member PATCH kept) → TestCompanyWriteRoutes_MountedBehindGates + TestRouteTopology; P3 `Patch("/jobs/{id}")`→`"/jobs/{idx}"` → TestJobsWriteRoute_MountedBehindGates + TestRouteTopology; P4 duplicate /healthz → TestRouterOwner_HealthAndReadinessMounted + TestRouteTopology; P5 /readyz wired to health.Healthz → TestRouterOwner_HealthAndReadinessMounted; P6 `r.Use(requireAuth)` added to main.go → TestMainComposition_DelegatesRouterConstruction. **Topology-guard correction (test-only, closes the direct-With defect):** TestRouteTopology_ExactRegistrations now rejects any Get/Mount registration whose selector receiver is a call expression (e.g. `r.With(requireAuth).Get` / `.Mount`) — the SOLE exemption is `Get("/company/members",…)` on an actual `With` receiver with exactly one middleware argument referencing `requireRecruiter` (the recruiter-gated members read inside the authed /me r.Use subtree); every other With-wrapped Get or Mount receiver fails regardless of middleware, and the guard is BIDIRECTIONAL (strict correction, remediating rejected evidence sha256:7efb51e0b2588bf8922fa21cbf68cde6168b78bc14bef8a6b855eb433f506e40): `Get("/company/members",…)` MUST be the exact protected triple method=Get, path=/company/members, middleware=requireRecruiter — a bare or otherwise-ungated registration of it FAILs — and TestIndustriesRoute_SingleCanonicalRegistration still requires the sole RegisterRoutes first argument to be the bare router identifier. Correction probes: P7 `r.With(d.requireAuth).Get("/companies/{id}",…)` FAIL; P8 `r.With(d.requireAuth).Mount("/jobs",…)` FAIL; P9 `industrieshttp.RegisterRoutes(r.With(d.requireAuth),…)` FAIL; P10 `r.With(d.requireRecruiter).Get("/companies/{id}",…)` FAIL and P11 `r.With(d.requireRecruiter).Mount("/jobs",…)` FAIL — P10/P11 incorrectly PASSED under the earlier requireRecruiter-substring exemption (reproduced pre-edit in temp copy, defect sha256:cea6c69f6faf3ad49493717d1e0d59696f3db85cae5a0586cea396a6b4db36f4); P12 demotion `r.Get("/company/members",…)` FAILs with the exact-triple message (temp-copy RED pre-edit: incorrectly PASSED under the one-directional guard), P13 `r.With(d.requireAuth).Get("/companies/{id}",…)`, P14 `r.With(d.requireRecruiter).Get("/healthz",…)` (public route), and P15 `r.With(d.requireAuth).Mount("/jobs",…)` re-verified FAIL post-edit; legit `r.With(d.requireRecruiter).Get("/company/members",…)` remains PASS; P16/P17 (temp-copy probes, no repository writes) — combined `With(requireRecruiter, requireAuth)` and a type-correct non-With call receiver referencing recruiter both incorrectly PASSED pre-edit and FAIL post-edit.
- **Gates (real tree):** `cd backend && go test ./cmd/api -count=1` PASS; `go test ./... -count=1` 45/45 packages PASS (no FAIL); `go build ./...`, `go vet ./...` PASS; `gofmt -l` clean on all three candidate files (6 gofmt-dirty files are pre-existing, 0-diff vs HEAD, out of scope); `git diff --check` clean; no staging/commit; probe temp copies removed.
- **Arithmetic vs HEAD `9a70f2e`:** main.go 8+/174−, main_test.go 73+/40−, router.go 97 new = **399 changed lines** ≤ 400 (7+/0− progress lines included in the 302 tracked lines). Hashes: main `73f2a609…`, test `ea5f5670…` (bidirectional-triple correction is a 3-line pure insertion after the direct-With rejection branch; P12–P15 probes added without new progress lines), router `551358fc…`. Rollback boundary: revert the three files plus this entry only; WS6B-1a/WS6B-2/WS5C untouched. **Task 6.1 remains unchecked pending commit reconciliation** — no task box touched.

## Post-commit reconciliation — task 6.1 (WS6B-1) closed

Implementation landed as three work-unit commits: `d63bf3e` (`feat(backend): add runtime lifecycle foundation`), `9a70f2e` (`feat(backend): wire runtime health and lifecycle`), `4f242c3` (`feat(backend): extract API router`). Independent verification evidence: WS6B-1a `sha256:4b343d7ac337b9597fb7174a32adc55df28702c066dfc08245a96b5a17c2f123`, WS6B-1b-b `sha256:d955080f07187a68b7d9f132cb0f911a961c30ce670e7d7af48352e956d75855`. Checkbox delta: exactly the four task-6.1 rows (RED/GREEN/TRIANGULATE/REFACTOR) changed from unchecked to checked; no other checkbox or text touched. **Task state: 76/100.** WS6B-2 (task 6.2) is not started; next ordered unit is 6.2.

## WS6B-2a TDD Cycle Evidence — RED scaffold + task-6.2 RED matrix (RED-only; ordinal 107)

- **Scaffold:** `backend/internal/shared/httpjson/decode.go` (18 lines) — compile-safe `DecodeJSON(w, r, dst, limit int64) *Definition` stub returning a pointer to a local `Resolve(CodeInvalidRequest)` value; never decodes, never touches the body, never writes a response. `decode_test.go` (262 lines) carries the complete task-6.2 RED matrix: N/N+1 fixed-length + chunked at exactly N=1,048,576; exactly-one-value table (empty, malformed, second value, trailing non-whitespace rejected; trailing whitespace accepted); helper-never-writes pin; wrapped `*http.MaxBytesError` (first-read; and post-value EOF-read where the body is a SHORT valid JSON well below N followed by the wrapped error on the next read — the first decode must succeed, so no `http.MaxBytesReader` limit can synthesize its own `*http.MaxBytesError` and pass vacuously; the only route to `payload_too_large` is `errors.As` over the wrapped underlying error) → 413 via genuine `%w`-wrap errors.As proof; spy short-circuit handler using `WriteCatalogError`; real `httptest.NewServer` chunked test (opaque reader → `ContentLength == -1`, `Transfer-Encoding: chunked`, no Content-Length, bounded 10s client, server+body closed).
- **Command chronology (actual output):** gofmt applied to both Go files only. Compile-only `go test ./internal/shared/httpjson -run '^$' -count=1` → PASS (`ok ... 0.003s [no tests to run]`). Focused RED `go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` → FAIL (exit 1), behavioral not compile: 9 failing leaf cases (eight named subtests plus the real-server top-level test) across five failing top-level test functions. Representative authentic RED reason: `TestDecodeJSON_BodyLimit_NAndNPlusOne/fixed_length_exact_n_valid_json_is_accepted: exact-N valid JSON rejected as invalid_request/400, want nil`; others: `fixed_length_n_plus_one_is_413: DecodeJSON = invalid_request/400, want payload_too_large/413`, `single_value_with_trailing_whitespace_is_accepted` rejected, both wrapped-MaxBytes subtests → 400 not 413, `valid_body_invokes_use_case_exactly_once: use-case calls = 0, want 1`, real-server chunked N+1 `status = 400 ... want 413`. Chunked framing assertions (ContentLength −1 / Transfer-Encoding chunked / no Content-Length header) held before the status mismatch, proving real chunked transfer. RED stubs also incidentally satisfy the reject-rows and never-writes pins (expected against a reject-all stub).
- **Arithmetic (measured):** decode.go 18 + decode_test.go 265 (both untracked, 0→line; test count includes the 3-line parent-gate non-vacuity comment on the EOF-read row) + this progress entry 8 additions/0 deletions (7 original + the ordinal-108 correction bullet) = 291 changed lines ≤ 400.
- **Rollback boundary:** delete the two untracked files `decode.go`/`decode_test.go` and revert/remove this WS6B-2a progress entry only. Task 6.2 checkboxes remain fully unchecked; GREEN/middleware/handler migration not started; no staging/commit; no verify-report.
- **Parent-gate correction (test-only, ordinal 108):** the EOF-read row previously staged exactly N bytes before the wrapped error, letting a future `http.MaxBytesReader(..., N)` synthesize its own `*http.MaxBytesError` and pass vacuously. Corrected to stage a short valid JSON (`{"k":"v"}`, 9 bytes ≪ N) whose first decode must succeed, then the wrapped error on the next read; the first-read row is unchanged. Verified non-vacuous and RED-replayed after the correction (same 9 behavioral failing leaf cases — eight named subtests plus the real-server top-level test — stub rejects valid JSON as `invalid_request`).

## WS6B-2a post-commit reconciliation — RED contract landed (ordinals 110–111)

- Implementation commit `92e16d31e3e9c7439280ef474d87cd63f3c7272a` (`test(httpjson): define DecodeJSON RED contract`): exactly three files, 291 insertions/0 deletions — `decode.go` 18, `decode_test.go` 265, this progress file 8.
- Compile PASS: `cd backend && go test ./internal/shared/httpjson -run '^$' -count=1`. Authentic behavioral RED: `cd backend && go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` exits 1 (not compile) with exactly 9 failing leaf cases across five failing top-level tests — the committed stub rejects valid JSON as `invalid_request`.
- Real-server evidence: the ONLY mismatch is 400-vs-413 status; `ContentLength == -1`, `Transfer-Encoding == [chunked]`, and the no-Content-Length-header assertions all held (genuine chunked framing).
- Prior native generation 87 complete: status revision `sha256:3171c5e1186af3b0072339b2276ef309046a1ed8ac86b18eebd4849ae1ae19c2`, evidence revision `sha256:82c387f0ee7cf8f39970ef9a148f9197af3eeb011c6ece6e75888776afa40b32`, prior next ordinal 110. Current generation 88 used ordinal 110 for the write plus initial verifier (candidate checks passed; access-plan gate failed) and ordinal 111 for the exact-scoped corrective verifier PASS.
- Checkbox delta: exactly one — task 6.2 RED `[ ]`→`[x]` (line 235, `<!-- sdd-owner: implementation -->` marker byte-preserved); GREEN/TRIANGULATE/REFACTOR remain unchecked. Task state 77/100.
- Rollback boundary: revert the task 6.2 RED checkbox and delete only this appended entry — the committed Go RED contract and all prior evidence untouched.

## WS6B-2b GREEN TDD Cycle Evidence — DecodeJSON implementation (generation 89, ordinal 112)

- **RED replay (pre-edit, exact commands):** `go test ./internal/shared/httpjson -run '^$' -count=1` PASS (0.003s, compile only); `go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` FAIL exit 1 — behavioral, exactly 9 failing leaf cases across five failing top-level tests (NAndNPlusOne×4, RequiresExactlyOneValue×1 trailing-whitespace-accepted, ClassifiesWrappedMaxBytesError×2, HandlerShortCircuitsUseCase×1, RealServerChunkedBodyLimit×1); real-server failure was ONLY 400-vs-413 status, chunked framing assertions (ContentLength −1, Transfer-Encoding [chunked], no Content-Length header) held.
- **GREEN (decode.go only):** body wrapped with `http.MaxBytesReader(w, r.Body, limit)`; `json.Decoder` decodes exactly one value into `dst`, then a second decode into `any` must return `io.EOF` (trailing whitespace accepted); `decodeFailure` classifies wrapped `*http.MaxBytesError` via `errors.As` → `payload_too_large`/413, all other failures (empty, malformed, second value, trailing non-whitespace) → `invalid_request`/400; never writes a response. No Content-Length precheck middleware added.
- **Verification PASS:** focused `go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` (matrix GREEN incl. real-server chunked N+1 → 413 with zero use-case calls); package `go test ./internal/shared/httpjson -count=1` ok; full `go test ./... -count=1` all packages ok (zero FAIL); `go vet ./...` OK; `gofmt -l` on decode.go empty; `git diff --check` clean; no staging/commit.
- **Scope & arithmetic:** exact two-file candidate — `decode.go` 32+/11−, `apply-progress.md` 9+/0− = 52 changed lines ≤ 80 hard cap. `decode_test.go`, `tasks.md` byte-unchanged; no verify-report; task 6.2 GREEN checkbox untouched pending commit.
- **Native evidence now:** generation 89, active ordinal 112, refreshed eligible-untracked inventory `sha256:0fc9c89f9fb57a5340cb06a0d61707dbf4d16b8d18d78a55fd8c28d114b47735` — no intended untracked files present.
- **Rollback boundary:** revert `backend/internal/shared/httpjson/decode.go` to HEAD `65c8452` stub and remove this entry only; RED contract, tests, and prior evidence untouched. No final native settlement claimed.

## WS6B-2b post-commit reconciliation — GREEN landed (generation 89 → 90, ordinal 113)

- Commit `cf2f5a926d01879b8b02c6984d61c1899f9b66a0` (`feat(httpjson): enforce bounded JSON decoding`): exact two-file scope — `decode.go` 32+/11−, prior apply-progress entry 9+/0−; totals 41 additions + 11 deletions = 52 changed lines.
- Prior native generation 89: revision `sha256:0f2b37c87d0e11d95935d76905c8d02fcc0aa50ac1dfb30f1a6049b3b3ba48e0`, evidence revision `sha256:73b98edacb663b82756454bc23da31e3c62e91547e7412262dcb8ac6e2ac7562`.
- Post-commit verification PASS: focused `go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1`; package `go test ./internal/shared/httpjson -count=1`; full `go test ./... -count=1` all packages ok; `go vet ./...` clean; `gofmt -l` on both protected Go files empty; scoped `git diff --check` clean.
- Checkbox delta: exactly one — task 6.2 GREEN `[ ]`→`[x]` (`<!-- sdd-owner: implementation -->` marker byte-preserved); RED+GREEN now checked, TRIANGULATE+REFACTOR unchecked; task state 78/100 with 100 owner markers.
- Artifact-only runtime change: N/A — no runtime/code/test mutation; both protected Go files byte-unchanged (SHA-256 reconfirmed before and after editing).
- Rollback boundary: revert the task 6.2 GREEN checkbox and remove only this appended reconciliation entry; the committed GREEN implementation remains untouched.

## WS6B-2c TRIANGULATE Wave A — companies + membership decoder migration (generation 92, ordinals 116–117; 116 performed the full replay/evidence rewrite repairing failed evidence sha256:8471eeacb72a1ea08af2b537af4e5db8a4d3b57f5fcbe8c8d05f494a1a240867, 117 corrects five evidence transcription defects remediating failed evidence sha256:47105df3b3357dd57d1a89993a94a316ceff35b9363a07d2600fdc3a2c629de9; preserves the passing 198-line candidate)

- **Scope + no-downstream proof:** exactly four direct-decoder sites migrated to the shared `httpjson.DecodeJSON` — `createCompany` + `updateCompany` (`handler.go`), `addMember` + `updateMemberRole` (`memberHandler.go`); package-local `const maxJSONBodyBytes = 1_048_576` (`handler.go`); `invalid_request` keeps the safe message via `httpjson.SafeMessage(*def, "invalid JSON body")`, canonical `payload_too_large` message NOT overridden; `encoding/json` import removed from both production files. Waves B–D (candidates/applications, jobs, industries/identity) deferred; `tasks.md` not modified at all this unit. Every post-decode prerequisite call is counted and asserted zero — `stubUserRepo.getCalls` (createCompany), `stubUpdateServiceRepo.getForUpdateCalls` (updateCompany), `stubUserRepositoryForHandler.byIDCalls` folded into `assertNoMemberWrites` (addMember), `assertNoMemberWrites` (updateMemberRole) — counter assertions run BEFORE `assertWaveADecodeEnvelope` in all 8 boundary subtests.
- **Reset context (no chronology invented):** the independent verifier PASSed all code/test semantics, all 8 non-vacuous downstream-call proofs, every GREEN command, exact six-file scope, protected hashes, task state, and 198-line arithmetic of this preserved candidate; its sole blockers were missing exact evidence commands (RED backup-dir creation before `cp`, restore without exact `cmp`, missing cleanup command, bare-shorthand numstat, absent scope/task/hash/staging/untracked commands). Every command below was executed and observed verbatim (generation 92: full replay + evidence rewrite at ordinal 116, five-command re-observation at ordinal 117); nothing is shorthand.
- **RED replay (exact self-contained command sequence executed verbatim; backend production paths + /tmp only):** `cd /home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes && WA_BAK="$(mktemp -d /tmp/ws6b2c-red-bak.XXXXXX)" && echo "backup-dir=$WA_BAK" && cp backend/internal/features/companies/infrastructure/http/handler.go backend/internal/features/companies/infrastructure/http/memberHandler.go "$WA_BAK/" && git stash push -m "ws6b2c-red-replay-g92" -- backend/internal/features/companies/infrastructure/http/handler.go backend/internal/features/companies/infrastructure/http/memberHandler.go && (cd backend && go test ./internal/features/companies/infrastructure/http -run '_DecodeBoundary$' -count=1 -v); echo "RED-EXIT=$?"; git stash pop && cmp "$WA_BAK/handler.go" backend/internal/features/companies/infrastructure/http/handler.go && echo "cmp handler.go: byte-identical" && cmp "$WA_BAK/memberHandler.go" backend/internal/features/companies/infrastructure/http/memberHandler.go && echo "cmp memberHandler.go: byte-identical" && rm -rf "$WA_BAK" && test ! -e "$WA_BAK" && echo "backup dir removed" && git stash list && echo "stash-entries=$(git stash list | wc -l)"`
- **RED observed:** `backup-dir=/tmp/ws6b2c-red-bak.v5sqHq`; `Saved working directory and index state On main: ws6b2c-red-replay-g92`; `RED-EXIT=1` — 8/8 leaf subtests behavioral FAIL, zero compile failures: `TestCreateCompany_DecodeBoundary` trailing_second_JSON_value + oversized_ignored_padding → `user lookup MUST NOT run on decode failure, got 1 GetByCognitoSub calls` + `CreateWithOwner MUST NOT run on decode failure (company=… owner=…)` + want 400 got 201 / want 413 got 201; `TestUpdateCompanyHandler_DecodeBoundary` ×2 → `repo.GetCompanyForUpdate MUST NOT run on decode failure, got 1 calls` + want 400 got 404 `{"error":"company not found","code":"not_found"}` / want 413 got 404; `TestMemberHandlers_DecodeBoundary` addMember ×2 → `unexpected calls: create=1 update=0 remove=0 user_get=0 user_by_id=1`, updateMemberRole ×2 → `unexpected calls: create=0 update=1 remove=0 user_get=0 user_by_id=0`. Restore: `Dropped refs/stash@{0} (cb78d9b8a53a115109f82c25e9214a39718c63c8)`; `cmp handler.go: byte-identical`; `cmp memberHandler.go: byte-identical`; `backup dir removed`; `stash-entries=0`.
- **GREEN (production + shared; exact commands, all observed):** `cd backend && go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` → ok (shared DecodeJSON matrix PASS); `cd backend && go test ./internal/features/companies/infrastructure/http -run '_DecodeBoundary$' -count=1 -v` → ok, 8/8 leaf PASS; `cd backend && go test ./internal/features/companies/infrastructure/http -run '^(TestCreateCompany_InvalidJSON|TestUpdateCompanyHandler_InvalidJSONReturns400|TestAddMember_InvalidJSONReturns400|TestUpdateMemberRole_MalformedJSONBody|TestCreateCompany_DecodeBoundary|TestUpdateCompanyHandler_DecodeBoundary|TestMemberHandlers_DecodeBoundary)$' -count=1 -v` → ok, 7/7 top-level tests PASS incl. all 8 DecodeBoundary leaf subtests; `cd backend && go test ./internal/features/companies/infrastructure/http -count=1` → ok; `cd backend && go test ./internal/features/companies/... -count=1` → 5/5 ok; `cd backend && go test ./... -count=1` → 45 packages ok / 0 FAIL; `cd backend && go vet ./...` → clean; `cd backend && gofmt -l internal/features/companies/infrastructure/http/handler.go internal/features/companies/infrastructure/http/memberHandler.go internal/features/companies/infrastructure/http/handler_test.go internal/features/companies/infrastructure/http/updateCompanyHandler_test.go internal/features/companies/infrastructure/http/memberHandler_test.go` → empty; `cd backend && grep -n 'json.NewDecoder\|json.Decoder' internal/features/companies/infrastructure/http/handler.go internal/features/companies/infrastructure/http/memberHandler.go` → no matches, expected exit 1; `git diff --check -- backend openspec` → clean.
- **Exact scope/task/hash/hygiene commands (all observed):** `git diff --numstat -- backend/internal/features/companies/infrastructure/http/handler.go backend/internal/features/companies/infrastructure/http/handler_test.go backend/internal/features/companies/infrastructure/http/memberHandler.go backend/internal/features/companies/infrastructure/http/memberHandler_test.go backend/internal/features/companies/infrastructure/http/updateCompanyHandler_test.go openspec/changes/backend-go-closure/apply-progress.md` → 14/5, 61/0, 16/11, 40/3, 35/2, 11/0; `git status --porcelain -- backend openspec` → exactly those six `M` files (allowlist match, nothing else); `git diff --cached --name-only -- backend openspec` → empty; `git ls-files --others --exclude-standard -- backend openspec` → empty; `grep -c '^\s*- \[x\]' openspec/changes/backend-go-closure/tasks.md` → 78; `grep -c '^\s*- \[ \]' openspec/changes/backend-go-closure/tasks.md` → 22; `grep -c '^\s*- \[' openspec/changes/backend-go-closure/tasks.md` → 100; task 6.2 state: RED `[x]`, GREEN `[x]`, TRIANGULATE `[ ]`, REFACTOR `[ ]` (tasks.md byte-unchanged); `sha256sum backend/internal/shared/httpjson/decode.go backend/internal/shared/httpjson/decode_test.go` → `5036ec5fc3cb706fd567550c4f2da8f1bc5151ad4518a21c47d6275480087d02` / `2614ef036bdbabb9717b4dac786ca3de16977d0bb5af7afe64019ecb18d72abf`; `test ! -e openspec/changes/backend-go-closure/verify-report.md` → absent.
- **Arithmetic (six-file numstat above):** additions 14+61+16+40+35+11 = 177; deletions 5+0+11+3+2+0 = 21; 177+21 = 198 ≤ 220. This correction replaced only the 11-line Wave-A suffix (same 11 added lines, rewritten content; every byte before the Wave-A heading and all code/test deltas byte-unchanged), so the ordinal-117 candidate differs from the failed evidence state `sha256:47105df3b3357dd57d1a89993a94a316ceff35b9363a07d2600fdc3a2c629de9` by these five transcription fixes only, with identical 177+/21− arithmetic.
- **Rollback boundary:** revert the five exact backend paths `git checkout HEAD -- backend/internal/features/companies/infrastructure/http/handler.go backend/internal/features/companies/infrastructure/http/memberHandler.go backend/internal/features/companies/infrastructure/http/handler_test.go backend/internal/features/companies/infrastructure/http/updateCompanyHandler_test.go backend/internal/features/companies/infrastructure/http/memberHandler_test.go` plus removal of only the current Wave-A suffix. Protected hashes (above) unchanged; no staging, no commit, no `verify-report.md`; task state remains 78/100 with 100 owner markers; no replay stash remains.

## WS6B-2c TRIANGULATE Wave B — candidates + applications decoder migration (generation 92 successor; appender-executed)

- **Scope:** exactly four direct-decoder sites migrated to the shared `httpjson.DecodeJSON` — `(*CandidateHandler).upsertMyProfile` + `(*CandidateHandler).replaceMyLanguages` (`backend/internal/features/candidates/infrastructure/http/handler.go`), `(*ApplicationHandler).applyToJob` + `(*ApplicationHandler).transitionApplication` (`backend/internal/features/applications/infrastructure/http/applicationHandler.go`); package-local `const maxJSONBodyBytes int64 = 1_048_576` added to each feature HTTP package. Candidates write failures through `writeDecodeFailure`: `invalid_request` keeps the exact safe message via `httpjson.SafeMessage(*def, "invalid JSON body")`, every other code (notably `payload_too_large`) written canonically. Applications write failures canonically (`WriteCatalogError(w, *def)`) for both codes. `encoding/json` removed from both production files. No shared-decoder behavior change; response/test/integration JSON usage and unknown-field tolerance preserved (`TestUpsertProfile_FullReplacementContract/server-managed_fields_are_ignored` and `TestApplyToJob_ServerManagedFieldsIgnored` still PASS under the new decoder). Waves C–D (jobs; industries/identity) deferred.
- **Baseline (pre-edit, all PASS):** `cd backend && go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` ok; `cd backend && go test ./internal/features/candidates/infrastructure/http ./internal/features/applications/infrastructure/http -count=1` ok; `go test ./internal/features/candidates/infrastructure/http -run '^TestUpsertProfile_MalformedJSONReturns400$' -count=1 -v` PASS; `go test ./internal/features/applications/infrastructure/http -run '^(TestApplyToJob_InvalidJSON400|TestTransitionApplication_InvalidJSON400|TestTransport_Preconditions_NoServiceAndExactEnvelope)$' -count=1 -v` PASS (13/13 precondition leaf subtests).
- **RED (exact command):** `cd backend && go test ./internal/features/candidates/infrastructure/http ./internal/features/applications/infrastructure/http -run '_DecodeBoundary$' -count=1 -v` → exit 1, behavioral, zero compile failures, 8/8 leaf subtests FAIL across the two new tests `TestCandidateHandlers_DecodeBoundary` (upsert/trailing, upsert/oversized, replace/trailing, replace/oversized) and `TestApplicationHandlers_DecodeBoundary` (apply/trailing, apply/oversized, transition/trailing, transition/oversized). Authentic failure reasons (downstream proof that the legacy direct decoders admitted trailing/oversized input): upsert ×2 `user GetByCognitoSub MUST NOT run on decode failure, got 1 calls`; replace ×2 `... got 2 calls` (replace resolves identity twice and performs the post-write read — ReplaceLanguagesByUserID + ListLanguagesByUserID also counted and asserted zero); apply ×2 `user GetByCognitoSub MUST NOT run on decode failure, got 1 calls` (repository Create also counted/asserted); transition ×2 `repository GetByID MUST NOT run on decode failure, got 1 calls` (Transition also counted/asserted). Per the non-vacuity contract, every downstream counter (user GetByCognitoSub, candidate UpsertProfile/ReplaceLanguagesByUserID/ListLanguagesByUserID; application repo Create/GetByID/Transition) is asserted zero with Fatalf BEFORE the Fatalf-carrying envelope helper in every subtest. Viable first values so the legacy decoders reach downstream: upsert `{}`, replace `{"languages":[]}`, apply `{}` with a resolvable user, transition `{"status":"in_review"}` against a submitted application.
- **GREEN:** the four sites above; no other production change. Candidate new-test counters added to `stubCandidateRepo` (upsertCalls/replaceCalls/listCalls) and `stubUserRepo` (getCalls); application `handlerStubUserRepo` gained the previously missing `getByCognitoSubCalls` counter.
- **Verification (exact commands, all observed):** `cd backend && go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` ok; `cd backend && go test ./internal/features/candidates/infrastructure/http ./internal/features/applications/infrastructure/http -run '_DecodeBoundary$' -count=1 -v` → 8/8 leaf PASS; combined selector `cd backend && go test ./internal/features/candidates/infrastructure/http -run '^(TestUpsertProfile_MalformedJSONReturns400|TestCandidateHandlers_DecodeBoundary)$' -count=1 -v` PASS and `cd backend && go test ./internal/features/applications/infrastructure/http -run '^(TestApplyToJob_InvalidJSON400|TestTransitionApplication_InvalidJSON400|TestApplicationHandlers_DecodeBoundary)$' -count=1 -v` PASS; applications transport precondition test `cd backend && go test ./internal/features/applications/infrastructure/http -run '^TestTransport_Preconditions_NoServiceAndExactEnvelope$' -count=1` ok (file untouched/read-only); `cd backend && go test ./internal/features/candidates/infrastructure/http ./internal/features/applications/infrastructure/http -count=1` ok; `cd backend && go test ./internal/features/candidates/... ./internal/features/applications/... -count=1` ok; `cd backend && go test ./... -count=1` → 53 package lines, 0 FAIL; `cd backend && go vet ./...` clean; `cd backend && gofmt -l internal/features/candidates/infrastructure/http/handler.go internal/features/candidates/infrastructure/http/handler_test.go internal/features/applications/infrastructure/http/applicationHandler.go internal/features/applications/infrastructure/http/applicationHandler_test.go` → empty (exit 0); `cd backend && grep -n 'json.NewDecoder\|json.Decoder' internal/features/candidates/infrastructure/http/handler.go internal/features/applications/infrastructure/http/applicationHandler.go` → no matches, expected exit 1; `git diff --check -- backend openspec` clean.
- **Exact scope + arithmetic (git diff --numstat, five allowed paths):** applicationHandler.go 8+/5−; applicationHandler_test.go 101+/0−; candidates handler.go 20+/5−; candidates handler_test.go 110+/0−; apply-progress.md (this suffix, 12+/0−; a harness markdownlint autofix briefly touched one space inside a prior Wave-A bullet and was byte-restored, keeping the suffix strictly append-only; final value re-measurable via the same numstat). Totals: 251 additions + 10 deletions = 261 changed lines ≤ 400.
- **Preserved contract evidence:** candidates malformed/legacy selector `TestUpsertProfile_MalformedJSONReturns400` PASS (exact safe message "invalid JSON body" preserved); applications `TestApplyToJob_InvalidJSON400` + `TestTransitionApplication_InvalidJSON400` PASS (canonical "invalid request"); 413 message is canonical "payload too large" with `payload_too_large` never overridden on either feature. Unknown-field tolerance pinned by the still-passing server-managed-fields tests on both features. `TestTransport_Preconditions_NoServiceAndExactEnvelope` (nil-service malformed-json subtests) PASS.
- **Hygiene (all observed):** task state unchanged 78/100 with 100 owner markers; task 6.2 RED+GREEN `[x]`, TRIANGULATE+REFACTOR `[ ]` (tasks.md byte-untouched — aggregate boxes intentionally NOT checked by Wave B); `git diff --cached --name-only -- backend openspec` empty; `git ls-files --others --exclude-standard -- backend openspec` empty; `git stash list` empty; `openspec/changes/backend-go-closure/verify-report.md` absent; protected shared hashes unchanged: decode.go `sha256:5036ec5fc3cb706fd567550c4f2da8f1bc5151ad4518a21c47d6275480087d02`, decode_test.go `sha256:2614ef036bdbabb9717b4dac786ca3de16977d0bb5af7afe64019ecb18d72abf`.
- **Rollback boundary:** revert ONLY the four backend files `backend/internal/features/candidates/infrastructure/http/handler.go`, `.../handler_test.go`, `backend/internal/features/applications/infrastructure/http/applicationHandler.go`, `.../applicationHandler_test.go` via `git checkout HEAD --` on those four paths, and remove only this appended Wave-B suffix. Shared decoder, tasks.md, and all prior evidence untouched. No staging, no commit, no verify-report; independent verification NOT claimed (parent owns verify).

## WS6B-2E Wave C — jobs create/update DecodeJSON (ws6b-2e-triangulate-wave-c-jobs-decodejson)

Strict TDD active (`cd backend && go test ./...`). Scope: exactly two production decoder sites in `backend/internal/features/jobs/infrastructure/http/jobHandler.go` — `(*JobHandler).updateJob` and `(*JobHandler).createJob` — migrated to shared `httpjson.DecodeJSON` with package-local `maxJSONBodyBytes int64 = 1_048_576`; Wave D untouched; shared httpjson read-only.

### RED (tests first; no production edit before this)

`cd backend && go test ./internal/features/jobs/infrastructure/http -run '^(TestCreateJob_DecodeBoundary|TestUpdateJob_DecodeBoundary)$' -count=1 -v` → FAIL, 4/4 leaves RED, all counters recorded before the Fatalf-capable envelope checks (counters asserted with Errorf):

- TestCreateJob_DecodeBoundary/trailing_second_json_value: `createCalls=1`, legacy status 201 (want 400).
- TestCreateJob_DecodeBoundary/oversized_ignored_whitespace: `createCalls=1`, legacy status 201 (want 413).
- TestUpdateJob_DecodeBoundary/trailing_second_json_value: `getForUpdateCalls=2`, `updateCalls=1`, legacy status 200 (want 400).
- TestUpdateJob_DecodeBoundary/oversized_ignored_whitespace: `getForUpdateCalls=2`, `updateCalls=1`, legacy status 200 (want 413).

Truthful deviation note: the first RED run panicked in `toEditorView` because the un-programmed create stub returned `(nil, nil)`; fixed by programming `createOut` (mirroring `TestCreateJob_SuccessReturns201EditorView`) so the legacy path completes end-to-end — the recorded RED above is the non-vacuous run after that test-only fix, still with zero production edits.

### GREEN (production edit after RED)

`(*JobHandler).updateJob` and `(*JobHandler).createJob` now call `httpjson.DecodeJSON(w, r, &in, maxJSONBodyBytes)`; failures route through a new jobs-local `writeDecodeFailure` (mirrors candidates): `invalid_request` keeps the exact message `invalid JSON body`; every other code (notably `payload_too_large`, canonical message `payload too large`) is written untouched. `encoding/json` import removed from `jobHandler.go`. Unknown-field tolerance preserved (no `DisallowUnknownFields`).

`cd backend && go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` → ok.
`cd backend && go test ./internal/features/jobs/infrastructure/http -run '^(TestCreateJob_DecodeBoundary|TestUpdateJob_DecodeBoundary)$' -count=1 -v` → PASS, 4/4 leaves GREEN, every downstream counter zero on both boundary failures.

### Legacy selectors preserved (malformed JSON + unknown-field tolerance)

`cd backend && go test ./internal/features/jobs/infrastructure/http -run '^(TestCreateJob_MalformedBodyReturns400|TestCreateJob_BodyCompanyIDIgnored|TestCreateJob_StatusFieldIgnored|TestCreateJob_UnknownVOReturns400|TestUpdateJob_MalformedBodyReturns400|TestUpdateJob_BodyCompanyIDIgnored|TestUpdateJob_UnknownVOReturns400)$' -count=1` → ok (create malformed `invalid JSON body`; body `company_id`/`status` ignored; unknown VO 400s; update malformed 400).

### Aggregate verification

- `cd backend && go test ./internal/features/jobs/infrastructure/http -count=1` → ok.
- `cd backend && go test ./internal/features/jobs/... -count=1` → ok (9 packages, no FAIL).
- `cd backend && go test ./... -count=1` → 45 packages ok, zero FAIL lines.
- `cd backend && go vet ./...` → clean, exit 0.
- `cd backend && gofmt -l internal/features/jobs/infrastructure/http/jobHandler.go internal/features/jobs/infrastructure/http/createJobHandler_test.go internal/features/jobs/infrastructure/http/updateJobHandler_test.go` → no output after one `gofmt -w` correction of createJobHandler_test.go; truthful note: that file was ALREADY unformatted at HEAD (pre-existing mis-indentation in `createJobAssertCatalogEnvelope` and one `TestCreateJob_UnknownVOReturns400` block, verified via `git stash` round-trip); the Wave C test code itself was gofmt-clean.
- `cd backend && grep -n 'json.NewDecoder\|json.Decoder' internal/features/jobs/infrastructure/http/jobHandler.go` → no matches, exit 1.
- `git diff --check -- backend openspec` → clean, exit 0.
- `git status --porcelain -- backend openspec` → exactly three `M` lines (jobHandler.go, createJobHandler_test.go, updateJobHandler_test.go) before this suffix; `git diff --cached --name-only -- backend openspec` → empty; `git ls-files --others --exclude-standard -- backend openspec` → empty.

### Budget arithmetic

Pre-suffix `git diff --numstat -- backend/internal/features/jobs/infrastructure/http/jobHandler.go backend/internal/features/jobs/infrastructure/http/createJobHandler_test.go backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go openspec/changes/backend-go-closure/apply-progress.md`: 101+/10- createJobHandler_test.go (includes the pre-existing gofmt correction), 20+/5- jobHandler.go, 91+/0- updateJobHandler_test.go → 212+/15- = 227. Evidence suffix (this section) adds 54 lines/0 deletions; final four-path numstat: 101+/10- createJobHandler_test.go, 20+/5- jobHandler.go, 91+/0- updateJobHandler_test.go, 54+/0- apply-progress.md. Totals: 266 additions + 15 deletions = 281 ≤ 400.

### Guards, tasks, protected files

- Append-only prefix guard: pre-append `openspec/changes/backend-go-closure/apply-progress.md` = 114697 bytes, SHA-256 `c7521a70486d178d0398e84c63507da66cefc571d294bc5c9312918d34080f03` (= HEAD blob); post-append first-114697-byte rehash identical (PASS, fail-closed verified).
- Protected shared decoder files unchanged: `backend/internal/shared/httpjson/decode.go` = `5036ec5fc3cb706fd567550c4f2da8f1bc5151ad4518a21c47d6275480087d02`; `backend/internal/shared/httpjson/decode_test.go` = `2614ef036bdbabb9717b4dac786ca3de16977d0bb5af7afe64019ecb18d72abf`.
- Tasks (read-only check, no tasks.md edit): 78 checked / 22 unchecked / 100 total; 100 `sdd-owner: implementation` markers; task 6.2 RED + GREEN checked, TRIANGULATE + REFACTOR UNCHECKED (Wave C intentionally leaves them for Wave D).
- `test ! -e openspec/changes/backend-go-closure/verify-report.md` → PASS (verify-report absent).
- No stash retained (the single `git stash` round-trip for the gofmt provenance check was popped immediately; `git stash list` empty). No staging, no commit, no push. No receipt-driven review run.
- Aggregate task 6.2 TRIANGULATE/REFACTOR remain intentionally unchecked; Wave C contributes only this unit's group-(c) jobs evidence.

### Exact rollback

Restore only these three backend paths from HEAD: `git checkout HEAD -- backend/internal/features/jobs/infrastructure/http/jobHandler.go backend/internal/features/jobs/infrastructure/http/createJobHandler_test.go backend/internal/features/jobs/infrastructure/http/updateJobHandler_test.go`, then delete only the new Wave C suffix (this `## WS6B-2E Wave C` section) from `openspec/changes/backend-go-closure/apply-progress.md`, restoring exactly 114697 bytes / SHA-256 `c7521a70486d178d0398e84c63507da66cefc571d294bc5c9312918d34080f03`. Explicitly preserve: shared decoder files, tasks.md, all prior progress bytes, Wave D, verify-report absence, and no staging/commit/push.

## WS6B-2F Wave D — industries + identity (group (d)): truthful NO-OP migration

Conclusion: Wave D (task 6.2 group (d), industries + identity handlers) is a truthful no-op production/test migration. Both features contain ZERO incoming JSON request decoders, so there is no `json.Decoder`/`json.NewDecoder`/`r.Body` usage to migrate to `httpjson.DecodeJSON` and nothing to change. Exact TDD evidence sentence: `RED: N/A — empty applicable production boundary set; source census is the evidence`. No production file, test file, fixture, counter, behavioral RED, or zero-match RED selector was invented, added, or modified.

### Census and architectural distinctions

- Decoder census: `grep -RInE --include='*.go' --exclude='*_test.go' 'json\.NewDecoder|json\.Decoder|httpjson\.DecodeJSON|r\.Body|Request\.Body' backend/internal/features/industries backend/internal/features/identity` → exit 1, stdout empty (zero matches; any match would have blocked).
- Mutating-route census: `grep -RInE --include='*.go' --exclude='*_test.go' '\.(Post|Put|Patch)\(' backend/internal/features/industries backend/internal/features/identity` → exit 1, stdout empty (zero mutating routes; the only route is bodyless `GET /industries`).
- Industries `backend/internal/features/industries/infrastructure/http/handler.go::ListIndustries`: bodyless `GET /industries`; reads context, invokes `ListActiveIndustries`, writes the catalog envelope response; no input DTO/body decoder exists. Test response decoders in `handler_test.go` decode outbound responses and are not production request decoders.
- Identity HTTP middleware reads Authorization headers, claims/context, and repositories; no request JSON is parsed. Lambda post-confirmation receives typed `events.CognitoEventUserPoolsPostConfirmation`; AWS deserializes the trigger payload before the adapter runs.
- JWKS `fetch` decodes an OUTBOUND HTTP response under its own 256 KiB limit; replacing it with `httpjson.DecodeJSON` would be wrong (wrong direction, wrong limit owner). `encoding/json` remains required for clone `json.Marshal` logic (outbound serialization). The RSA verifier parses the Authorization-header JWT string, not `r.Body`.

### Commands and results — pre-append baseline (historical, first attempt)

- Pre-append baseline (historical; the full-file size/hash checks below were run BEFORE the Wave D append and apply only to the un-appended file): `git rev-parse --abbrev-ref HEAD` → `main`; `git rev-parse HEAD` → `4702d54f60803ad9fbede3a4c5641db2f7226d86`; `git status --porcelain=v1 -- backend openspec` → exit 0, stdout empty; `test "$(wc -c < openspec/changes/backend-go-closure/apply-progress.md)" -eq 121816` → exit 0; `test "$(sha256sum openspec/changes/backend-go-closure/apply-progress.md | awk '{print $1}')" = "3084fff92a58d0b5fce1b0a2b05aee3af91fbbdfcb755bececbfea9f0806639d"` → exit 0.

### Commands and results — re-executed on the current post-append candidate (second and final attempt)

- Post-append current state: `git status --porcelain=v1 -- backend openspec` → exit 0, output exactly `M openspec/changes/backend-go-closure/apply-progress.md`; the required post-append integrity command is the first-121816-byte prefix test `test "$(head -c 121816 openspec/changes/backend-go-closure/apply-progress.md | sha256sum | awk '{print $1}')" = "3084fff92a58d0b5fce1b0a2b05aee3af91fbbdfcb755bececbfea9f0806639d"` → exit 0 (the pre-append full-file size/hash checks above are historical and are not valid against the appended file).
- Decoder census re-run: `grep -RInE --include='*.go' --exclude='*_test.go' 'json\.NewDecoder|json\.Decoder|httpjson\.DecodeJSON|r\.Body|Request\.Body' backend/internal/features/industries backend/internal/features/identity` → exit 1, stdout empty.
- Mutating-route census re-run: `grep -RInE --include='*.go' --exclude='*_test.go' '\.(Post|Put|Patch)\(' backend/internal/features/industries backend/internal/features/identity` → exit 1, stdout empty.
- `cd backend && go test ./internal/shared/httpjson -run '^TestDecodeJSON_' -count=1` → exit 0; `ok  github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson  0.537s`.
- `cd backend && go test ./internal/features/industries/infrastructure/http -run '^(TestListIndustries_InternalErrorReturnsCatalogEnvelope|TestListIndustries_WireShapeExactlyFourFields|TestListIndustries_AuthorizationHeaderIgnored)$' -count=1 -v` → exit 0; `--- PASS: TestListIndustries_InternalErrorReturnsCatalogEnvelope (0.00s)`, `--- PASS: TestListIndustries_WireShapeExactlyFourFields (0.00s)`, `--- PASS: TestListIndustries_AuthorizationHeaderIgnored (0.00s)`; `ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/industries/infrastructure/http  0.008s` (3/3 PASS).
- `cd backend && go test ./internal/features/identity/infrastructure/auth -run '^(TestJWKSVerifier_Verify_FailClosed|TestJWKSFetch_BoundsAndValidation|TestRsaVerifier_MalformedToken)$' -count=1 -v` → exit 0; `--- PASS: TestJWKSVerifier_Verify_FailClosed (0.27s)` (15 fail-closed subtests), `--- PASS: TestJWKSFetch_BoundsAndValidation (0.07s)` (8 bounds subtests), `--- PASS: TestRsaVerifier_MalformedToken (0.00s)`; `ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth  0.558s` (3/3 PASS).
- `cd backend && go test ./internal/features/identity/infrastructure/http -run '^TestRequireAuth_InvalidToken$' -count=1 -v` → exit 0; `--- PASS: TestRequireAuth_InvalidToken (0.00s)`; `ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http  0.145s`.
- `cd backend && go test ./internal/features/identity/infrastructure/lambdapostconfirmation -run '^(TestAdapter_ForwardsFreshCopyOfUserAttributes|TestAdapter_AcceptsBothOfficialTriggerSources|TestAdapter_RejectsOtherTriggerSourcesBeforeHandler|TestAdapter_PropagatesHandlerErrorUnchanged)$' -count=1 -v` → exit 0; `--- PASS: TestAdapter_ForwardsFreshCopyOfUserAttributes (0.00s)`, `--- PASS: TestAdapter_AcceptsBothOfficialTriggerSources (0.00s)` (2 official trigger-source subtests: `PostConfirmation_ConfirmSignUp`, `PostConfirmation_ConfirmForgotPassword`), `--- PASS: TestAdapter_RejectsOtherTriggerSourcesBeforeHandler (0.00s)` (5 rejected trigger sources), `--- PASS: TestAdapter_PropagatesHandlerErrorUnchanged (0.00s)`; `ok  github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/lambdapostconfirmation  0.013s` (4/4 PASS).
- `cd backend && go test ./internal/features/industries/... ./internal/features/identity/... -count=1` → exit 0; 11 packages `ok` (`industries/infrastructure/http` plus 10 identity packages), zero `FAIL`.
- `cd backend && go test ./... -count=1` → exit 0; 45 `ok` package lines, zero `FAIL` lines.
- `cd backend && go vet ./...` → exit 0, stdout empty; `cd backend && find internal/features/industries internal/features/identity internal/shared/httpjson -type f -name '*.go' -print0 | xargs -0 gofmt -l` → exit 0, stdout empty (read-only, no `-w`).

### Guards, tasks, hashes, correction metadata, scope, rollback

- Prefix guard: the first 121816 bytes are byte-identical to the pre-append baseline, SHA-256 `3084fff92a58d0b5fce1b0a2b05aee3af91fbbdfcb755bececbfea9f0806639d` (prefix test exit 0, fail-closed); significant `` ` M` `` spans in prior entries are preserved byte-for-byte. During the first attempt a harness markdownlint autofix briefly stripped two such `` ` M` `` spans inside prior entries; both were byte-restored before this corrected append.
- Protected/current hashes unchanged: `sha256sum backend/internal/shared/httpjson/decode.go backend/internal/shared/httpjson/decode_test.go backend/internal/features/identity/infrastructure/http/requireCompanyRole.go backend/internal/features/identity/infrastructure/http/requireCompanyRole_test.go` → `decode.go` = `5036ec5fc3cb706fd567550c4f2da8f1bc5151ad4518a21c47d6275480087d02`; `decode_test.go` = `2614ef036bdbabb9717b4dac786ca3de16977d0bb5af7afe64019ecb18d72abf`; `requireCompanyRole.go` = `e8bd5be254495c67f333a781cd2c3b049587059320dd6fc94e4652d47e9acb8a`; `requireCompanyRole_test.go` = `e29ebaf61317ed2e3760091032f3c42a8524852afe8464c5b24a113f15352083`.
- Tasks (read-only check, no tasks.md edit): 78 checked / 22 unchecked / 100 total and 100 `sdd-owner: implementation` terminal markers; task-6.2 rows 235–238: row 235 RED `[x]`, row 236 GREEN `[x]`, row 237 TRIANGULATE `[ ]`, row 238 REFACTOR `[ ]` — Wave D contributes group-(d) evidence only, aggregate rows stay unchecked for Task 6.2 final reconciliation.
- Scope guards: `git diff --check -- openspec/changes/backend-go-closure/apply-progress.md` → exit 0, stdout empty; `git diff --cached --name-only -- backend openspec` → exit 0, stdout empty (nothing staged); `git ls-files --others --exclude-standard -- backend openspec` → exit 0, stdout empty (no untracked files); `git stash list` → exit 0, stdout empty; `test ! -e openspec/changes/backend-go-closure/verify-report.md` → exit 0 (verify-report absent, not created); no staging, no commit, no push, no receipt-driven review started.
- Native objective metadata (no token recorded/requested): generation 97, attempt ordinal 124 (second and final native attempt for this work unit), work unit `ws6b-2f-triangulate-wave-d-industries-identity-decoder-census`, state `proceed`, max attempts 2, max changed lines 400; this corrected suffix remediates the failed first candidate `sha256:93a3e4ca9315d68aaf4c54eb105c979d7c6f4ac53f3c8c17e715f092eace59fa`, which was rejected solely for omitting exact post-append command/result entries and abbreviating command evidence; parent alone settles after independent PASS with distinct verification evidence. Receipt-review disposition: not started; pending only after independent verifier PASS plus parent native settlement under the enabled entry contract.
- Post-append scope: `git diff --numstat -- openspec/changes/backend-go-closure/apply-progress.md` → `39 0 openspec/changes/backend-go-closure/apply-progress.md` (39 additions / 0 deletions; forecast 20–40 additions met, hard budget 400); `git diff --name-only -- backend openspec` → `openspec/changes/backend-go-closure/apply-progress.md` only; no backend file changed (fail-closed). Rollback: delete only this `## WS6B-2F Wave D` suffix, restoring exactly 121816 bytes / SHA-256 `3084fff92a58d0b5fce1b0a2b05aee3af91fbbdfcb755bececbfea9f0806639d`; no backend rollback applies (no backend file touched).

---

## WS6B-2G — Prerequisite jobs-test gofmt correction (formatting-only)

### Baseline

- Branch `main`, HEAD `ce01f600f4a93b7f6b36f3ca8ada94ea0282b4d7`.
- Before any write: backend/openspec staged (`git diff --cached --name-only`), unstaged (`git status --porcelain -- backend openspec`), and untracked (`git ls-files --others --exclude-standard -- backend openspec`) state all empty; `git stash list` empty.
- Protected prefix proof: the first 132285 bytes of this file were verified byte-for-byte as SHA-256 `6b31ab2e82ac923709156bb377d714de1d6990c57a7fd8e96e69ef8a51469d26` immediately before and again immediately after this append; this WS6B-2G suffix is the only delta to this file.
- Strict TDD mode is active (test runner `cd backend && go test ./...`). This unit is a formatting-only prerequisite: behavioral RED and GREEN are **N/A** — no test, assertion, fixture, or production behavior was invented, added, or changed. Only formatting was corrected.

### Pre-change evidence

- `backend/internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go` SHA-256 `77513127df472b752b1997027675a9a034b6dc8006bf2937d1d2ee01a09b06a0`; `backend/internal/features/jobs/infrastructure/http/handler_test.go` SHA-256 `0bd5ad1cce1b956ccc12b4af938d9abbc3250e80938ddb9a52a18aa8364e3d05`.
- Full-backend census `cd backend && find . -type f -name '*.go' -print0 | xargs -0 gofmt -l` output exactly two lines, in order:
  - `./internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go`
  - `./internal/features/jobs/infrastructure/http/handler_test.go`
- Pre-change `gofmt -d` on exactly those two files showed: (1) `softDeleteJobHandler_test.go` — indentation-only re-format of the five body lines of `softDeleteJobAssertCatalogEnvelope` (they sat at column 0; gofmt moves them under the function body at one-tab depth, diff 8+/8-); (2) `handler_test.go` — a single blank line inserted between the aligned `timePtr`/`strPtr`/`intPtr` declaration group and the `var _ = strPtr` / `var _ = intPtr` package sentinel vars (gofmt-required blank line between declaration groups, diff 1+/0-). No other deltas.

### Change applied

- `gofmt -w` executed on exactly the two authorized test files. No other Go file (or any other file besides this suffix) was touched.

### Post-change evidence

- File-scoped `gofmt -l` on the two files: no output. Full-backend census after formatting (`cd backend && find . -type f -name '*.go' -print0 | xargs -0 gofmt -l`): empty — no unformatted Go file remains anywhere under `backend`.
- Post-gofmt SHA-256: `softDeleteJobHandler_test.go` → `ed576857c515d9cd61409ba99be3f066fd4b37e3fdd241a610cfa2fced95b160`; `handler_test.go` → `3e5c66c97e85b4e99aa03f24ac97e7da4150bab34e653ac357db7ace21ad9eec`. Both match the pre-authorized expected hashes exactly.
- Exact numstat (`git diff --numstat`): `8\t8` for `softDeleteJobHandler_test.go` (8+/8-) and `1\t0` for `handler_test.go` (1+/0-) — total 17 changed lines, exactly as forecast.
- Whitespace-only proof: `git diff --check` on the two files reports nothing; `git diff --ignore-blank-lines -w --stat` restricted to the two files is empty — the entire working-tree diff on these files is pure whitespace (body re-indentation plus one blank line).
- Tests (all pass): `cd backend && go test ./internal/features/jobs/infrastructure/http -count=1` → `ok github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http 0.013s`; `cd backend && go test ./internal/features/jobs/... -count=1` → all 8 jobs packages `ok`; `cd backend && go test ./... -count=1` → every package `ok` (or `[no test files]`); `cd backend && go vet ./...` → clean, no findings.
- Post-change state: `git status --porcelain -- backend openspec` shows exactly three unstaged entries: `` ` M backend/internal/features/jobs/infrastructure/http/handler_test.go` ``, `` ` M backend/internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go` ``, and `` ` M openspec/changes/backend-go-closure/apply-progress.md` `` (this file itself, carrying the WS6B-2G suffix; exact 3-file working-tree numstat over `backend openspec`: `1\t0` for `handler_test.go`, `8\t8` for `softDeleteJobHandler_test.go`, and `38\t0` for `apply-progress.md` — the Go files only, as forecast, plus this 38+/0- suffix) — and nothing else; staged empty; untracked empty; `git stash list` empty. `openspec/changes/backend-go-closure/verify-report.md` remains absent.
- `tasks.md` untouched: 78 checked / 22 unchecked / 100 total; Task 6.2 RED `[x]`, GREEN `[x]`, TRIANGULATE `[ ]`, REFACTOR `[ ]` (unchanged).
- Runtime harness command/scenario: N/A — formatting-only prerequisite with no runtime boundary beyond the Go test suite above, which compiles and runs the touched test files.

### Rollback

- Restore only the two Go test files from HEAD: `git checkout HEAD -- backend/internal/features/jobs/infrastructure/http/softDeleteJobHandler_test.go backend/internal/features/jobs/infrastructure/http/handler_test.go`, and delete only this WS6B-2G suffix from this file. That returns the workspace to clean HEAD `ce01f600f4a93b7f6b36f3ca8ada94ea0282b4d7` with this file back at exactly 132285 bytes / SHA-256 `6b31ab2e82ac923709156bb377d714de1d6990c57a7fd8e96e69ef8a51469d26`. No unrelated work is affected.

## Task 6.2 (WS6B-2) post-commit reconciliation — artifact-only closure unit (corrected suffix, corrective rerun). The prior appended reconciliation suffix was revised in place because an independent verifier proved its aggregate full-test census wrong (it claimed `47 ok, 6 [no test files]`); the corrected census below is freshly re-proven. Evidence revision of the failed candidate: `sha256:6c2596ac4854cddd0e698c404c88e1a019eec1c6f13452f5948156a80c0a7a01`. Independent baseline recheck at HEAD `cfc34356362a2134cdca425156ef7fd440cb301d` (tree `e9bc8f659427897d19941b633bc85fe6933dfe22`): branch `main`; only unstaged `tasks.md` + `apply-progress.md` (diff numstat 2/2 + 10/0 = 14 lines); staged 0, untracked 0, `git stash list` empty; `verify-report.md` absent. Protected artifacts recomputed and matched exactly: `tasks.md` 58,766 B / SHA-256 `78edc23c9ac772a5c67a1d52796a127b5de4356a975064930b3538fd1ec0899e`, exactly 80 checked / 20 unchecked / 100 total boxes with 100 `sdd-owner: implementation` markers, only Task 6.2 TRIANGULATE+REFACTOR changed from HEAD; `apply-progress.md` first 137,595 bytes SHA-256 `983ff195daed67e0f38bc7ec2c7b4cd40c25900d1a967b8045a34cfc8330e32b`, byte-for-byte equal to the committed HEAD blob; jobs `infrastructure/http/handler_test.go` `3e5c66c97e85b4e99aa03f24ac97e7da4150bab34e653ac357db7ace21ad9eec`; jobs `infrastructure/http/softDeleteJobHandler_test.go` `ed576857c515d9cd61409ba99be3f066fd4b37e3fdd241a610cfa2fced95b160`. Strict-TDD behavioral RED/GREEN is N/A for this artifact-only unit: the committed Wave A–D evidence above plus the fresh verification below is the TDD evidence; no implementation was invented or modified

- **Commit chain (gate 1, exact command actually run):** `for c in 92e16d31e3e9c7439280ef474d87cd63f3c7272a 65c8452788e933562050345e8b214f4abeef9e69 cf2f5a926d01879b8b02c6984d61c1899f9b66a0 509fc8f88fd186c5414608f0131d27774c49ce68 16fd253b4753ac8ca66c2a5edf01f1776f86aa59 bd740cc1646286947de4eac798a22fb5ac6b689e e48be659334f9caeba455eb836370676d7d29950 4702d54f60803ad9fbede3a4c5641db2f7226d86 ce01f600f4a93b7f6b36f3ca8ada94ea0282b4d7 cfc34356362a2134cdca425156ef7fd440cb301d; do git merge-base --is-ancestor $c HEAD || { echo "ANCESTRY_FAIL $c"; exit 1; }; done && echo ANCESTRY_OK_ALL_TEN` → printed `ANCESTRY_OK_ALL_TEN`, exit 0. Ordered semantics: `92e16d31…` httpjson RED contract test → `65c84527…` docs RED reconcile → `cf2f5a92…` shared DecodeJSON feat → `509fc8f8…` docs GREEN reconcile → `16fd253b…` companies → `bd740cc1…` candidates+applications → `e48be659…` jobs → `4702d54f…` identity gofmt → `ce01f600…` Wave D census docs → `cfc34356…` jobs gofmt (HEAD).
- **Focused gates (gate 2, exact commands actually run):** `cd backend && go test ./internal/shared/httpjson -count=1` → `ok github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson 0.535s`, exit 0. Capability groups, exact loop actually run: `cd backend && for f in companies candidates applications jobs industries identity; do go test ./internal/features/$f/infrastructure/http/... -count=1 || { echo "FAIL $f"; exit 1; }; done` → all six ok, exit 0: `companies/infrastructure/http 0.022s`, `candidates/infrastructure/http 0.012s`, `applications/infrastructure/http 0.013s`, `jobs/infrastructure/http 0.014s`, `industries/infrastructure/http 0.003s`, `identity/infrastructure/http 0.097s`.
- **Full/vet/gofmt (gates 3–5, exact commands actually run):** `cd backend && go test ./... -count=1` → exit 0. Mechanical count over the captured full output (`grep -cE '^(ok|FAIL|\?|---)'` → 53 package-status lines; `grep -c '^ok'` → 45; `grep -c 'no test files'` → 8; `grep -c '^FAIL'` → 0): exactly **53 package lines, 45 `ok`, 8 `[no test files]`, 0 FAIL**. `cd backend && go vet ./...` → exit 0, silent; backend gofmt census non-vacuous over `find . -name '*.go' | wc -l` → 251 `.go` files: `gofmt -l .` → empty output, exit 0.
- **Decoder censuses (gates 6–7, exact commands actually run):** `grep -R -n -E --include='*.go' --exclude='*_test.go' 'json\.NewDecoder|json\.Decoder' backend/internal/features` → exit 1, zero output (no production direct decoders). `grep -R -n --include='*.go' --exclude='*_test.go' 'httpjson\.DecodeJSON' backend/internal/features` → exactly 10 production call sites, verified 2 per file: companies `handler.go` ×2 + `memberHandler.go` ×2, candidates `handler.go` ×2, applications `applicationHandler.go` ×2, jobs `jobHandler.go` ×2.
- **Authorized write (task delta 78 → 80):** `tasks.md` — only Task 6.2 TRIANGULATE (line 237) and REFACTOR (line 238), line-targeted `sed '237s/^- \[ \] TRIANGULATE/- [x] TRIANGULATE/; 238s/^- \[ \] REFACTOR/- [x] REFACTOR/'`; zero other bytes changed; this corrective rerun did NOT touch `tasks.md` (byte-identical to the pre-correction candidate hash above). `apply-progress.md` — this append-only suffix, revised in place after the verifier finding; protected 137,595-byte prefix preserved byte-for-byte (`head -c 137595 apply-progress.md | sha256sum` → `983ff195daed67e0f38bc7ec2c7b4cd40c25900d1a967b8045a34cfc8330e32b`). Final counts: 80 checked / 20 unchecked / 100 total / 100 owner markers.
- **Scope + 80-line budget + cleanup:** edits confined to the two allowed surfaces under `openspec/changes/backend-go-closure/`; no Go/code/test edits, no new files, no `verify-report.md`, no staging/commit/push/stash/reset/checkout, no frontend or other-worktree access. All gates ran read-only — no backups or background test processes left behind (the /tmp census scratch files are created, read, and deleted in the same corrective command sequence). Total diff ≤ 80 changed lines (2 tasks.md replacements + this 10-line suffix).
- **Rollback boundary/proof:** rollback is bounded to restoring exactly these two paths to HEAD `cfc34356` (e.g. `git restore --source=cfc34356362a2134cdca425156ef7fd440cb301d -- openspec/changes/backend-go-closure/tasks.md openspec/changes/backend-go-closure/apply-progress.md`); NOT executed — the corrected candidate stands. Post-write proof: `git diff --numstat` covers only these two paths (tasks.md 2/2, apply-progress.md 10/0), prefix rehash matches, `git status --porcelain` shows only the two modified files with zero untracked entries, `git diff --check` clean, stash still empty, `verify-report.md` still absent.
