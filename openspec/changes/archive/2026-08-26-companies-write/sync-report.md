# Sync Report: `companies-write` → `openspec/specs/companies/`

**Verdict:** **synced** — the verified `companies-write` spec was promoted byte-for-byte into the canonical `openspec/specs/` tree as a brand-new bounded context. The change folder remains active (`openspec/changes/companies-write/`) and is ready for the next phase (`sdd-archive`).

---

## Outcome at a glance

| Item | Value |
|---|---|
| Store | `openspec` (file artifacts only) |
| Change | `companies-write` |
| Change root | `openspec/changes/companies-write/` |
| Sync kind | **New domain** — no prior canonical `companies` spec existed; full-spec copy, not a delta fold |
| Domain spec source | `openspec/changes/companies-write/specs/companies/spec.md` (324 lines, 9 requirements, 45 scenarios) |
| Canonical file created | `openspec/specs/companies/spec.md` |
| Byte-for-byte identical | ✅ Both 36153 bytes; sha256 `584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`; `diff -q` → no differences |
| Verify verdict | `pass_with_warnings` (C1 resolved 2026-08-26; 0 blockers, 0 CRITICAL; 9/9 requirements, 45/45 scenarios) |
| Destructive approvals needed | None — no `REMOVED`, no `RENAMED`, no destructive MODIFIED; the change carries only one delta file (a single domain), with no `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` / `## RENAMED Requirements` sections at all (it's the full spec body, not an OPSX delta) |
| Same-domain collisions | None — `companies` is brand-new in canonical; no other active change touches `openspec/specs/companies/` |
| Next recommended phase | `sdd-archive` |

---

## Domains synced

| Domain | Action | Canonical path | Requirements | Scenarios |
|---|---|---|---|---|
| `companies` | created | `openspec/specs/companies/spec.md` | 9 | 45 |

No domain was modified or removed. No other domain in `openspec/specs/` was touched. `git status --short openspec/specs/` reports exactly one untracked directory: `?? openspec/specs/companies/`.

---

## Canonical files updated

- **Created:** `openspec/specs/companies/spec.md` (324 lines, 9 requirements, 45 scenarios; identical bytes to the change spec — sha256 `584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`).

No other canonical files changed.

### Byte-for-byte verification

| Source | Canonical | Size | sha256 |
|---|---|---|---|
| `openspec/changes/companies-write/specs/companies/spec.md` | `openspec/specs/companies/spec.md` | 36153 bytes | `584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f` |

Verification commands run:

| Check | Result |
|---|---|
| `sha256sum` of source vs canonical | ✅ identical (`584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`) |
| `wc -c` source vs canonical | ✅ identical (36153 bytes) |
| `diff -q` source vs canonical | ✅ no differences reported |
| `wc -l` source vs canonical | ✅ identical (324 lines) |
| `grep -c "^### Requirement:"` source vs canonical | ✅ identical (9) |
| `grep -c "^#### Scenario:"` source vs canonical | ✅ identical (45) |

---

## Delta operations performed

| Operation | Count | Names |
|---|---|---|
| ADDED requirements | 9 | All requirements — the spec is brand-new in canonical |
| MODIFIED requirements | 0 | — |
| REMOVED requirements | 0 | — |
| RENAMED requirements | 0 | — |

Because there was no prior `openspec/specs/companies/spec.md`, the native helper semantics resolve to "no canonical exists → copy change spec as the new canonical." This is a full-spec promotion, not a delta fold. The change spec does not carry `## ADDED / ## MODIFIED / ## REMOVED / ## RENAMED Requirements` sections — it is the full requirement body (9 requirements / 45 scenarios) and was copied as a single byte-equivalent artifact.

### Requirements promoted

| # | Requirement | Scenarios |
|---|---|---|
| 1 | PATCH /me/company Endpoint, Owner-Only Gate, and Field Mutability | 14 |
| 2 | PATCH /me/company CAS Optimistic Concurrency Control | 5 |
| 3 | PATCH /me/company Response Shape | 3 |
| 4 | DELETE /me/company Endpoint, Owner-Only Gate, and Idempotency | 5 |
| 5 | DELETE /me/company CAS Optimistic Concurrency Control | 5 |
| 6 | Soft-Delete Atomic Transactional Close of Jobs | 5 |
| 7 | Soft-Deleted Company Read Visibility | 3 |
| 8 | Authorization Dispatch Order for /me/company Writes | 3 |
| 9 | No Audit Events for Companies (Deferred) | 2 |

Total: **9 requirements / 45 scenarios** for the new `companies` bounded context. Requirement blocks were copied byte-exact from the change spec (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, inline RFC 2119 keywords, the canonical `401 → 403 → handler` dispatch chain, and the `audit_events` deferred non-goal language.

---

## Source spec provenance (the FINAL verified version)

The promoted spec is the **post-correction** R7-S3 version that was committed to resolve verify-report C1 (CRITICAL spec/implementation contradiction). Verification:

- **Before correction** — R7-S3 asserted that `GET /me/company` returns the soft-deleted company record to the owner (`200`), claiming the read path "does not filter by `companies.deleted_at`". The implementation contradicts this: the read path resolves through `GetCompanyByID` whose `WHERE deleted_at IS NULL` predicate hides the tombstoned row. No test asserted the spec's required behavior. CRITICAL blocker for sync.
- **After correction (2026-08-26)** — R7-S3 renamed to "GET /me/company hides a soft-deleted company from the owner" and now requires `404 company not found`. The `company_members` row survives as audit history.
- **Regression test** committed as `f97f7dc` (`test(companies): regression — membership read hides tombstoned company (spec R7-S3)`) — `TestGetMyMembership_HidesTombstonedCompany` in `companyRepository_write_integration_test.go` uses the REAL postgres membership + company adapters with a stub identity repo, seeds a user + owner membership on the tombstoned fixture company `writeCoT`, and asserts `GetMyMembership` returns `ErrCompanyNotFound` (→ 404) while the `company_members` row survives as `role='owner'`.

Sanity check on the canonical (must show the post-correction 404 behavior):

```text
#### Scenario: GET /me/company hides a soft-deleted company from the owner

- GIVEN a soft-deleted company `A` (`deleted_at IS NOT NULL`) and the owner whose `company_members.role='owner'` for `A`
- WHEN the owner sends `GET /me/company`
- THEN the response is `404 company not found` (the membership read resolves the company through `GetCompanyByID`, whose `WHERE deleted_at IS NULL` predicate filters the tombstoned row; the `company_members` row itself survives in the DB as audit history)
```

✅ The canonical carries the post-correction version (404 behavior pinned), not the original contradictory version.

---

## Active same-domain collisions

None. Pre-sync baseline checks:

- `openspec/specs/companies/` did NOT exist before this sync (verified via `ls openspec/specs/` and the parent prompt's domain enumeration: applications, audit_events, candidates, company-membership, identity, jobs — no `companies`).
- `companies-write` is the only active change under `openspec/changes/` that targets `openspec/specs/companies/spec.md`; the `archive/` directory was not inspected (immutable per `openspec/config.yaml` rules.archive).
- No two active changes race for `specs/companies/spec.md`.

Post-sync: `git status --short openspec/specs/` reports `?? openspec/specs/companies/` (single untracked directory) — exactly the expected footprint, no overwrites, no scope creep.

---

## Destructive sync approvals

Not applicable. The change carries no `## REMOVED Requirements` section, no `## MODIFIED Requirements` block, and no `## RENAMED Requirements` section (the unsupported path is not in play). The promotion is a brand-new bounded-context byte copy — there is no canonical target to destroy.

---

## Verification

| Check | Result |
|---|---|
| `sha256sum` of source vs canonical | ✅ identical (`584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`) |
| `wc -c` source vs canonical | ✅ identical (36153 bytes) |
| `wc -l` source vs canonical | ✅ identical (324 lines) |
| `diff -q` source vs canonical | ✅ no differences reported |
| `grep -c "^### Requirement:"` source vs canonical | ✅ identical (9) |
| `grep -c "^#### Scenario:"` source vs canonical | ✅ identical (45) |
| Source spec layout (`# Companies Specification` + `## Purpose` + `## Out of scope (deferred)` + `## Requirements`) | ✅ matches the existing canonical convention used by `applications`, `audit_events`, `candidates`, `jobs`, `company-membership`, `identity` |
| R7-S3 carries the post-correction 404 behavior (not the original 200 contradiction) | ✅ `GET /me/company hides a soft-deleted company from the owner` → `404 company not found` |
| `openspec/config.yaml` `rules.specs` | ✅ Given/When/Then on every scenario; RFC 2119 keywords (`MUST`/`MUST NOT`/`MAY`) used; single domain per requirement; this is a full-spec (not an OPSX delta), so the `ADDED / MODIFIED / REMOVED / RENAMED` rule does not apply to the *promotion*, and the change spec carries no delta sections either |
| `openspec/config.yaml` `rules.archive` | ✅ No destructive deltas present — no archive warning is required at sync time |
| `verify-report.md` present and passing | ✅ verdict `pass_with_warnings`, blockers 0, CRITICAL 0 (C1 R7-S3 resolved 2026-08-26); 9/9 requirements, 45/45 scenarios; 44/45 scenarios covered by tests (the 45th is the now-correct R7-S3, pinned by regression test commit `f97f7dc`) |

---

## Structured status and actionContext findings

- **Store:** `openspec` (file artifacts only). Engram persistence is not active in this mode; the optional `mem_save` for a learning note was performed as best-effort.
- **Next recommended phase (pre-sync):** `sdd-archive` (per parent prompt and verify-report §9).
- **Next recommended phase (post-sync):** `sdd-archive`.
- **Action context:** `actionContext.mode` is not `workspace-planning`; the repo is the authoritative workspace; canonical spec paths live under the workspace root, so no `allowedEditRoots` ambiguity. The new file was written under the canonical spec root `openspec/specs/companies/` — exactly where it belongs.
- **Sync phase guard:** No MODIFIED/REMOVED against an absent target, no `## RENAMED` block, no destructive deltas requiring approval — all sync guards pass.
- **Apply state (per parent prompt):** `all_done` — six work units committed on `main` (`a5d88f7` → `e1a0145`), 48/48 implementation checkboxes `[x]`.
- **Verify state (per parent prompt):** `all_done` — verdict `pass_with_warnings`, C1 R7-S3 resolved.
- **skill_resolution:** `paths-injected` — no SDD skill paths were injected for this delegated sync run, but the convention from `archive/2026-08-25-applications/sync-report.md` and `archive/2026-08-25-audit_events/sync-report.md` was applied as the model.

---

## Warnings carried from `verify-report.md`

These do not block sync — they are the same non-blocking warnings verify left on the ledger. They should be visible to anyone reading the canonical spec in the future.

| # | Warning | Where it lives | Impact on sync |
|---|---|---|---|
| W1 | `TestSoftDeleteCompany_RollbackOnCloseFailure_Placeholder` is `t.Skip` (R6‑S37 failure-on-close-rollback has no live-DB test). `defer tx.Rollback` + the 4-statement commit boundary in `TestSoftDeleteCompany_TombstonesAndClosesJobs` cover happy-path atomicity; the rollback branch is unproven. Documented in `apply-progress.md` deviation #4. | Implementation tests; does not affect the spec file. | None on canonical spec content. |
| W2 | Integration-only / deferred coverage: R9‑S44 (PATCH no-audit) is asserted only on the DELETE side; R7‑S39 (GET /jobs excludes) is deferred to the read-side hardening follow-up and not directly asserted via `SearchJobs`. | Implementation tests; does not affect the spec file. | None on canonical spec content. |
| W3 | PATCH 409-body redaction parity: `TestUpdateCompanyHandler_CASConflictReturns409WithView` asserts the 409 body is not the generic `{"error":"conflict"}` envelope, but does not assert the 409 body omits `rfc`/`industry_id`/`status`/`deleted_at`/`created_at` or that it is byte-shape-identical to the 200 body (spec R3 S21/S22). Both paths share `toCompanyEditorView`/`CompanyEditorViewDto`, so it holds today but is not pinned. | Implementation tests; does not affect the spec file. | None on canonical spec content. |
| W4 | PATCH missing/malformed-CAS not explicitly unit-tested. The zero-token CAS path is pinned for DELETE (`TestSoftDeleteCompany_ZeroTokenReturnsConflict`, `TestDeleteCompanyHandler_MissingCASReturns409`) but there is no dedicated PATCH missing/malformed-header test (spec R2 S17/S18, R5 S31 for malformed). Mechanism is shared via `parseIfUnmodifiedSince`. | Implementation tests; does not affect the spec file. | None on canonical spec content. |
| W5 | Multi-field PATCH in one call not directly tested (spec R1 S2); covered structurally by single-field + tri-state tests. | Implementation tests; does not affect the spec file. | None on canonical spec content. |
| W6 | Concurrent-writer scenarios untested (R2 S19, R5 S32). CAS atomicity is proven by the `updated_at = cas_token` WHERE clause + stale-CAS integration tests, but no true two-goroutine race test. | Implementation tests; does not affect the spec file. | None on canonical spec content. |

**Bottom line:** none of the warnings alter what the spec says or requires. The canonical promotion is a pure byte copy. Any post-archive tightening (DB rollback-on-close test for R6‑S37, `actor_type='system'`-style PATCH no-audit pin, PATCH 409-body redaction assertion, dedicated PATCH missing/malformed-CAS test, multi-field PATCH assertion, concurrent-writer race test) belongs in a follow-up change, not in this sync.

---

## What the next phase (`sdd-archive`) should do

1. Re-read this sync report and the verify-report to confirm the canonical `openspec/specs/companies/spec.md` is the byte-equivalent promoted copy (sha256 `584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`, 36153 bytes, 9 req / 45 scen).
2. Verify `git status --short openspec/specs/` shows exactly one new untracked directory (`?? openspec/specs/companies/`) — no overwrites, no scope creep.
3. Move the change folder to `openspec/changes/archive/YYYY-MM-DD-companies-write/` per `rules.archive` precedent from `2026-08-25-applications` and `2026-08-25-audit_events` (date + change-name). The audit trail is preserved (proposal.md, design.md, specs/, tasks.md, apply-progress.md, verify-report.md, sync-report.md).
4. Leave `openspec/specs/companies/spec.md` as the authoritative post-sync canonical.
5. Leave working-tree edits unstaged per the delegated task — no commit, no push.

---

## Status envelope

| Field | Value |
|---|---|
| `status` | `synced` |
| `executive_summary` | Brand-new domain `companies` was promoted byte-for-byte from `openspec/changes/companies-write/specs/companies/spec.md` to `openspec/specs/companies/spec.md` (324 lines, 9 requirements, 45 scenarios; 36153 bytes; sha256 `584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`; `diff -q` confirms zero differences). The promoted spec is the FINAL verified version with R7-S3 already amended to the actual `404 company not found` behavior (the C1 spec/implementation contradiction was resolved 2026-08-26 with regression test commit `f97f7dc`). Verify was `pass_with_warnings` (0 blockers, 0 CRITICAL, 9/9 requirements, 45/45 scenarios); the six non-blocking warnings (W1–W6) carried forward do not alter spec content. No destructive deltas, no collisions, no approval gates tripped. |
| `artifacts` | `openspec/specs/companies/spec.md` (created, 36153 bytes, sha256 `584897ac4738d0e48cab68acd4326e25cf2c0c07523ed8d883ce075440d19b3f`), `openspec/changes/companies-write/sync-report.md` (this file) |
| `next_recommended` | `sdd-archive` |
| `risks` | Low — no destructive deltas, no canonical collision, no commit/push in scope. The only residual risks are the six carried warnings (W1–W6), which a future tightening change should address (rollback-on-close live-DB test, PATCH no-audit pin, PATCH 409-body redaction parity assertion, PATCH missing/malformed-CAS tests, multi-field PATCH assertion, concurrent-writer race test). |
| `skill_resolution` | `paths-injected` (SDD skill paths for this delegated sync were not injected; the convention from `archive/2026-08-25-applications/sync-report.md` and `archive/2026-08-25-audit_events/sync-report.md` was applied as the model for the report structure) |

---

## Key Learnings

1. The `companies-write` sync is a pure NEW bounded context promotion — there was no prior canonical `openspec/specs/companies/` (the parent enumeration listed applications, audit_events, candidates, company-membership, identity, jobs only), so the native helper resolves to a full-spec byte copy rather than a delta fold.
2. The `read` + `write` tool pair cannot produce byte-identical files when the source contains trailing whitespace per line, because the read tool strips trailing whitespace during rendering; a `cp` is required for true sha256 equality on whitespace-sensitive content.
3. The R7-S3 amendment (spec corrected to require `404` instead of `200` for `GET /me/company` against a tombstoned company) is what makes this sync safe — the original spec asserted a factually false premise that would have seeded a wrong behavior contract into the canonical spec, and verify-report C1 was the explicit blocker before 2026-08-26.
4. The `companies-write` change carries no `## ADDED / ## MODIFIED / ## REMOVED / ## RENAMED Requirements` sections — it ships as a full requirement body, which is the natural shape for a NEW bounded context and matches the audit_events BC promotion (also NEW BC, also full-spec).
5. The sync report mirrors the archived `applications` and `audit_events` convention precisely — same outcome-at-a-glance table, same byte-for-byte verification block (sha256 + wc -c + diff -q + grep -c), same warnings-carried-forward section, same status envelope — so the `sdd-archive` phase can apply identical acceptance criteria to all three bounded-context promotions.
