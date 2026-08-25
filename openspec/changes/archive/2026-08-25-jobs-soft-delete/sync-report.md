# Sync Report: `jobs-soft-delete`

- **status**: `synced`
- **change**: `jobs-soft-delete` (artifact store: `openspec`, file-backed)
- **domains synced**: `jobs`
- **canonical files updated**: `openspec/specs/jobs/spec.md`
- **artifact store**: `openspec` (authoritative) — this report persisted to `openspec/changes/jobs-soft-delete/sync-report.md`

---

## 1. Delta classification

The delta (`openspec/changes/jobs-soft-delete/specs/jobs/spec.md`) is a **pure ADDED fold**: 3 ADDED requirements and 31 ADDED scenarios. There are **no** `## MODIFIED Requirements`, **no** `## REMOVED Requirements`, and **no** `## RENAMED Requirements` sections in the delta. This is the cleanest possible classification — no destructive edits to existing canonical content, no MODIFIED-block wholesale replacements, no obsolete-scenario removal.

Per the native helper semantics (`lib/openspec-deltas.ts`): pure ADDED → append new requirement blocks under the existing `## ADDED Requirements` section of the canonical spec, byte-exact. No approval gate beyond the parent prompt's direction is required (no REMOVED, no large MODIFIED, no RENAMED — none of the destructive-sync guardrails from `lib/openspec-guardrails.ts` apply).

## 2. Requirements synced (ADDED, 3)

| # | Requirement | Scenarios |
|---|---|---|
| 1 | DELETE /jobs/{id} Endpoint, Gate, and Route Boundary | 9 |
| 2 | Soft-Delete Concurrency Controls | 11 |
| 3 | Soft-Delete Eligibility, Audit, and Read-Side Invariants | 11 |

Total: 3 requirements / 31 scenarios appended. Requirement blocks were copied byte-exact from the delta (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, the inline SQL CTE verbatim, and the cross-reference wording to canonical requirements — matching the precedent set by `jobs-reopen` and `jobs-create`.

## 3. Canonical merge outcome

`openspec/specs/jobs/spec.md` went from **29 requirements / 124 scenarios** to **32 requirements / 155 scenarios**:

- **3 ADDED requirements appended** under the existing `## ADDED Requirements` section, after `Re-Open Inherits CAS and Same-Company Invariants` (the last canonical requirement, line 924 of the pre-sync canonical). New requirement names: `DELETE /jobs/{id} Endpoint, Gate, and Route Boundary`, `Soft-Delete Concurrency Controls`, `Soft-Delete Eligibility, Audit, and Read-Side Invariants`.
- **No requirement name collision**: each of the 3 new ADDED names was asserted absent from the canonical spec before append; each now appears exactly once. `sort | uniq -d` over all 32 requirement names returns zero collisions.
- **Existing 29 canonical requirements untouched**: `git diff --stat` on the canonical shows 210 insertions / 1 deletion; the single deletion is the entire original `## Out of scope (deferred)` paragraph, replaced 1-for-1 by the updated paragraph (still one line, still under the same heading). No existing requirement block was modified.
- **All 124 existing canonical scenarios preserved verbatim**: verified by reading the 124 `^#### Scenario:` lines from `git show HEAD:openspec/specs/jobs/spec.md` and confirming each appears unchanged in the post-sync file (no `^[-+]` diff lines inside any canonical scenario block; the diff hunks are exclusively (a) the single Out-of-scope paragraph replacement and (b) the 3 appended requirement blocks).

## 4. Out-of-scope prose update

`## Out of scope (deferred)` in the canonical spec was updated precisely:

- **Removed from deferred list**: `a soft-delete endpoint` — now DELIVERED via the three new ADDED requirements; leaving it listed would contradict the canonical spec. Mirrors the `jobs-reopen` precedent that removed `re-opening a closed job` from the deferred list once `Re-Open Transitions` shipped.
- **Updated the gated-subtree clause**: `a recruiter subtree beyond the gated `POST /jobs` and `PATCH /jobs/{id}` write routes` → `a recruiter subtree beyond the gated `POST /jobs`, `PATCH /jobs/{id}`, and `DELETE /jobs/{id}` write routes` — `DELETE /jobs/{id}` is now part of the delivered gated write surface.
- **Updated the gated-write sentence**: split the single comma-joined clause into three parallel sentences (one per endpoint) and added a `DELETE /jobs/{id}` clause that explicitly states the tombstone semantics (`setting `deleted_at = now()` … the row survives in the table for audit`), the gated middleware, the atomic active-company soft-delete gate (`409` when the company is not active at UPDATE time), the CAS concurrency control, and the read-side invariant that the existing `deleted_at IS NULL` predicate already filters tombstoned rows from `GET /jobs` and `GET /jobs/{id}` — so a future reader cannot mistake soft-delete as a separate read-side change.
- **Kept deferred**: notification/event publishing, `company_members` ownership, frontend job board, production seed strategy, currency conversion (FX). The `PUT /jobs/{id}` NON-API assertion is preserved. The dev-seed disclaimer (`00008_jobs_seed.sql` is a developer convenience only — NOT a runtime requirement) is preserved.

## 5. Guardrail checks

| Check | Result |
|---|---|
| `verify-report.md` present and passing | ✅ verdict `pass`, blockers 0, CRITICAL 0; 3/3 requirements, 31/31 scenarios covered; post-sync arithmetic 29→32 / 124→155 verified |
| Delta classification | ✅ 3 ADDED + 0 MODIFIED + 0 REMOVED + 0 RENAMED; no `## RENAMED Requirements` (which the native helper does not support) |
| Destructive sync approval | ✅ n/a — no REMOVED, no MODIFIED, no large block replacements; pure ADDED fold requires no approval gate |
| Active same-domain collisions | ✅ none — `jobs-soft-delete` is the only active change touching `openspec/specs/jobs/spec.md` (sibling archives: `2026-08-25-jobs-reopen`, `2026-08-25-jobs-create`, `2026-08-24-jobs-write-side`, all under `archive/`, not active) |
| Legacy flat spec (`openspec/changes/{change}/spec.md`) | ✅ n/a — domain-spec layout used (`openspec/changes/jobs-soft-delete/specs/jobs/spec.md`) |
| Canonical paths inside workspace | ✅ `openspec/specs/jobs/spec.md` under repo root; no `allowedEditRoots` restriction (`actionContext.mode` is repo-local for sync) |
| `rules.sync` from `openspec/config.yaml` | ✅ no `sync` rule block present in config; `rules.archive` destructive-delta warning honored (n/a here, no destructive elements) |
| Byte-exact merge | ✅ delta ADDED blocks copied verbatim including inline SQL CTE, cross-reference wording, and `(NEW)`/`(cross-reference)` scenario annotations |

## 6. Validation performed

- **Pre-sync baseline assertions**:
  - Canonical requirements = **29** ✓, scenarios = **124** ✓ (verified via `grep -c '^### Requirement:'` / `grep -c '^#### Scenario:'` against `git show HEAD:openspec/specs/jobs/spec.md`).
  - `a soft-delete endpoint` phrase present in canonical `Out of scope (deferred)` (verified before edits).
  - Old gated-write sentence `PATCH /jobs/{id}`-only wording present in canonical (verified before edits).
  - Pre-existing canonical requirement names distinct: 29/29 names unique.
- **Post-sync assertions** (after edits):
  - Canonical requirements = **32** ✓, scenarios = **155** ✓ (matches verify-report declared totals and the parent prompt's exact-arithmetic requirement: 29 + 3 = 32; 124 + 31 = 155).
  - `a soft-delete endpoint` in `Out of scope (deferred)` = **0** ✓.
  - `DELETE /jobs/{id}` referenced in `Out of scope (deferred)` gated-subtree clause = **2** ✓ (one in the deferred-list clause — listing the now-delivered endpoints — and one in the new DELETE clause of the gated-write sentence).
  - Pre-existing canonical scenario count unchanged: 124 (verified by counting the 124 pre-existing `^#### Scenario:` lines in the diff context — all show no `^[-+]` modification marker; only the Out-of-scope paragraph and the 3 new requirement blocks carry diff markers).
  - Requirement-name uniqueness: all 32 canonical requirement names are distinct (`sort | uniq -d` returns zero collisions).
  - No `## RENAMED Requirements` section in the delta (verified before edits).
  - No `## MODIFIED Requirements` section in the delta (verified before edits).
  - No `## REMOVED Requirements` section in the delta (verified before edits).
- **Diff scope**: `git diff --stat openspec/specs/jobs/spec.md` reports 210 insertions / 1 deletion. The single deletion is the original Out-of-scope paragraph (one long line); the 210 insertions cover the updated Out-of-scope paragraph (1 line, replacing the deleted one) plus the 3 new requirement blocks (209 lines, including a single blank separator line between the last canonical scenario and the first new requirement heading) plus intra-paragraph line breaks.
- **No code touched; no commit created; change folder left in place** (not archived). The working tree contains uncommitted changes against the prior committed state of `openspec/specs/jobs/spec.md` (HEAD = `63ea03b`).

## 7. Warnings carried forward from verify-report

These are documented in `verify-report.md` §9 (deviations). They are not sync blockers, but the sync contract records them so the archive phase and downstream reviewers have full context.

1. **Public-mount DELETE returns chi 405, not the literal 404 in S9 (OBSERVATION)** — verify-report §9.1: delta scenario `DELETE is not reachable through the public mount` says `404 not found`, but chi returns `405 Method Not Allowed` when the path (`/jobs/{id}`) is registered for GET but not DELETE. `TestSoftDeleteJob_DeleteNotServedByPublicMount` accepts 404 OR 405 and asserts the handler never ran (repo not called). This mirrors the pre-existing `TestUpdateJob_PATCHNotServedByPublicMount` precedent (which documents the 405 nuance) — inherited spec wording, not a defect introduced by this delta.
2. **Live integration execution deferred (OBSERVATION)** — verify-report §9.2: the 13 integration tests are build-tagged and compile clean, but are not executed here (no `DATABASE_URL`); `make test-integration` is parent-owned. Consistent with the task's stated deferral.
3. **TDD evidence table naming (OBSERVATION)** — verify-report §9.3: apply-progress uses "Strict TDD evidence table" rather than the literal "TDD Cycle Evidence" title. Substance (RED + GREEN + status per task) is present and independently verified — not a blocker.
4. **Untracked planning artifacts (OBSERVATION)** — verify-report §9.4: `design.md` / `proposal.md` / `specs/` are not in git. Not a sync blocker, but the delta spec/design under validation are absent from history.

## 8. Structured status & actionContext findings

| Field | Value |
|---|---|
| artifactStore | openspec (authoritative — config `schema: spec-driven`, "Persistence mode: openspec") |
| changeName | jobs-soft-delete |
| changeRoot | openspec/changes/jobs-soft-delete |
| applyState | all_done (per verify-report, all implementation tasks `[x]`) |
| actionContext.mode | repo-local (no `workspace-planning` mode, no `allowedEditRoots` restriction) |
| delta shape | 3 ADDED + 0 MODIFIED + 0 REMOVED + 0 RENAMED |
| Pre-sync canonical totals | 29 requirements / 124 scenarios |
| Post-sync canonical totals | **32 requirements / 155 scenarios** |
| Destructive sync approvals | n/a — pure ADDED fold |
| `rules.sync` from config.yaml | no `sync` rule block present; `rules.archive` destructive-delta warning honored (n/a here) |

## 9. Next recommended phase

`sdd-archive` — sync is clean (canonical merged to 32 / 155, no collisions, no blockers, no destructive elements). Verify-report §10 confirms zero exact blockers and the four warnings are documentation/process observations, not behavior defects. The archive phase should:

- Create `openspec/changes/archive/2026-08-25-jobs-soft-delete/` (date + change-name per `rules.archive` precedent from `2026-08-25-jobs-reopen` and `2026-08-25-jobs-create`).
- Move the entire `openspec/changes/jobs-soft-delete/` folder into the dated archive subfolder (proposal, design, specs/, tasks.md, apply-progress.md, verify-report.md, sync-report.md).
- Leave `openspec/specs/jobs/spec.md` as the authoritative post-sync canonical (32 requirements / 155 scenarios).
- Not amend the working-tree diff beyond the move itself; commit the move + the canonical edit together as the archive commit.
- Verify HEAD remains `93fc17e` (or earlier) for `openspec/specs/jobs/spec.md` until the archive commit lands.