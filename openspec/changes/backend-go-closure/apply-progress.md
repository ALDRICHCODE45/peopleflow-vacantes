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
|------|----------:|----------:|
| `candidates/handler.go` | 26 | 26 |
| `candidates/handler_test.go` | 36 | 9 |
| `industries/handler.go` | 17 | 9 |
| `industries/handler_test.go` (new) | 76 | — |
| `apply-progress.md` | 52 | 1 |
| **Total** | **131** | **45** |

Tracked changed lines: 131 additions + 45 deletions = 176. Untracked new file: 76 lines. Total: 252 ≤ 400 budget.

**Confirmed invariants:**

- Jobs files: NOT touched; task 1.4 checkboxes: all 4 remain unchecked
- main.go: zero diff (RESTORED to HEAD)
- No `any` return type; no reflection; no field-drift risk
- Industries handler test: 76 lines (DB-failure + non-leakage proof only)