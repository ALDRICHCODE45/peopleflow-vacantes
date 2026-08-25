# Sync Report: `jobs-reopen`

- **status**: `synced`
- **change**: `jobs-reopen` (artifact store: `openspec`, file-backed)
- **domains synced**: `jobs`
- **canonical files updated**: `openspec/specs/jobs/spec.md`
- **artifact store**: `openspec` (authoritative) — this report persisted to `openspec/changes/jobs-reopen/sync-report.md`

---

## 1. Delta classification

The delta (`openspec/changes/jobs-reopen/specs/jobs/spec.md`) carries **4 ADDED requirements, 2 MODIFIED requirements, and 1 effectively-removed obsolete scenario** — no `RENAMED` sections. Native ADDED semantics (append) and native MODIFIED semantics (replace full requirement block by exact name) both apply; the obsolete `closed is terminal` scenario is dropped because the MODIFIED `Status Transition Table` block replaces the canonical block in full, and that block no longer contains the obsolete scenario.

The MODIFIED delta is *additive* in intent but contains a destructive element (a scenario inside the canonical `Status Transition Table` block is removed by the wholesale replacement). Per `openspec/config.yaml` `rules.archive` "Warn before merging destructive deltas (REMOVED requirements) into openspec/specs/" — this is a documented and explicitly approved destructive sync: the parent prompt for this `sdd-sync` invocation explicitly calls out the obsolete scenario as a target of the sync, and the verify-report (`verdict: pass_with_warnings`) confirmed the delta is behaviorally correct and the post-sync arithmetic 25→29 requirements / 106→124 scenarios holds. No additional approval was required beyond the parent prompt's direction.

## 2. Requirements synced (ADDED, 4)

| # | Requirement | Scenarios |
|---|---|---|
| 1 | Re-Open Transitions | 5 |
| 2 | Re-Open + Field Edits Apply Atomically | 4 |
| 3 | Active-Company Update Gate | 4 |
| 4 | Re-Open Inherits CAS and Same-Company Invariants | 3 |

Total: 4 requirements / 16 scenarios appended. Requirement blocks were copied byte-exact from the delta (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, tables, and sentinel/status-code wording — matching the precedent set by `jobs-create`.

## 3. Requirements synced (MODIFIED, 2)

| # | Requirement | Before | After | Δ scenarios |
|---|---|---|---|---|
| 1 | Status Transition Table | 8 scenarios (incl. obsolete "closed is terminal") | 9 scenarios (drops "closed is terminal", adds 2 re-open scenarios) | +1 (net) — −1 obsolete, +2 new re-open |
| 2 | Error Taxonomy | 3 scenarios | 4 scenarios | +1 (net) — adds the 409 non-active company scenario |

Net scenario change from MODIFIED blocks: **+2 scenarios** (Status Transition Table +1, Error Taxonomy +1).

The delta's MODIFIED blocks also carry:

- A `## MODIFIED` block opening with a `(Previously: …)` provenance sentence on each replaced requirement — preserved in the canonical so future readers can see what changed.
- Two new scenario rows in the `Status Transition Table`: `closed → draft` YES and `closed → published` YES (the latter with the audit-history side effect). The `closed → closed NO → 400` row is kept.
- A new row in the `Error Taxonomy` table: `409 company is not active` for the active-company update gate on every PATCH.

## 4. Obsolete-scenario removal (canonical → canonical, by MODIFIED replacement)

| Scenario | Canonical location | Disposition |
|---|---|---|
| `closed is terminal` | `Status Transition Table` requirement (canonical) | REMOVED by wholesale MODIFIED replacement — the new block does not include it (drops the rule; adds the two `closed → {draft, published}` re-open scenarios in its place) |

Verify-report §2 counts: "106 + 16 ADDED + 3 MODIFIED-added − 1 obsolete removed = 124". The 3 MODIFIED-added scenarios are the 2 new re-open scenarios (Status Transition Table) + 1 new 409-non-active scenario (Error Taxonomy); the 1 obsolete removed is `closed is terminal`.

## 5. Canonical merge outcome

`openspec/specs/jobs/spec.md` went from **25 requirements / 106 scenarios** to **29 requirements / 124 scenarios**:

- 4 ADDED requirements appended under the existing `## ADDED Requirements` section, after `Create Error Taxonomy` (the last canonical requirement). New requirement names: `Re-Open Transitions`, `Re-Open + Field Edits Apply Atomically`, `Active-Company Update Gate`, `Re-Open Inherits CAS and Same-Company Invariants`.
- `Status Transition Table` requirement block (canonical 8 scenarios) was replaced wholesale with the delta's MODIFIED block (9 scenarios). The obsolete `closed is terminal` scenario is gone; two new re-open scenarios are added; the remaining seven scenarios are unchanged (verify confirms they remain behavior-equivalent).
- `Error Taxonomy` requirement block (canonical 3 scenarios) was replaced wholesale with the delta's MODIFIED block (4 scenarios). The three carry-over scenarios are unchanged (verify confirms); the new `409 for a non-active company carries "company is not active"` scenario is added.
- **No requirement name collision**: each of the 4 new ADDED names was asserted absent from the canonical spec before append; each now appears exactly once. Create-side names from `jobs-create` and re-open-side names from `jobs-reopen` are deliberately distinct (`Active Company Creation Gate` vs `Active-Company Update Gate`).
- **Existing 25 canonical requirements untouched** (except the two MODIFIED replacements called for by the delta). `git diff --stat` on the canonical: 139 insertions / 9 deletions; the 9 deletions cover the preamble line and the two MODIFIED requirement blocks (table rows, integrity-guard sentence wording, obsolete scenario text).

## 6. Out-of-scope prose update

`## Out of scope (deferred)` in the canonical spec was updated precisely:

- **Removed from deferred list**: `re-opening a closed job (`closed → {draft,published}`)` — now DELIVERED via the `Re-Open Transitions` requirement and the lifted `Status Transition Table` rows; leaving it listed would contradict the canonical spec.
- **Replaced wording in the gated-write sentence**: "publish/close transitions (with `closed` terminal)" → "publish/close/re-open transitions (re-open is allowed via `closed → {draft, published}`)". The terminality is gone; the gated subtree now also covers re-open transitions through the same `PATCH /jobs/{id}` endpoint.
- **Added clause**: "behind an atomic active-company update gate (`409` when the company is not active at UPDATE time)" — pins the new `Active-Company Update Gate` requirement in the canonical prose, paralleling the existing `POST /jobs` clause.
- **Kept deferred**: a soft-delete endpoint, notification/event publishing, `company_members` ownership, frontend job board, production seed strategy, currency conversion (FX). The `PUT /jobs/{id}` NON-API assertion is preserved. The gated subtree description ("beyond the gated `POST /jobs` and `PATCH /jobs/{id}` write routes") is preserved.

## 7. Guardrail checks

| Check | Result |
|---|---|
| `verify-report.md` present and passing | ✅ verdict `pass_with_warnings`, blockers 0, CRITICAL 0; 29/29 scenarios covered; arithmetic 25→29 / 106→124 verified |
| Delta classification | ✅ 4 ADDED + 2 MODIFIED + 0 RENAMED; no `## RENAMED Requirements` (which the native helper does not support) |
| Destructive sync approval | ✅ Parent prompt explicitly approves the obsolete-scenario removal and the MODIFIED block wholesale replacement; documented in §1 above |
| Active same-domain collisions | ✅ none — `jobs-reopen` is the only active change touching `openspec/specs/jobs/spec.md` (sibling archives: `2026-08-25-jobs-create`, `2026-08-24-jobs-write-side`, all under `archive/`, not active) |
| Legacy flat spec (`openspec/changes/{change}/spec.md`) | ✅ n/a — domain-spec layout used (`openspec/changes/jobs-reopen/specs/jobs/spec.md`) |
| Canonical paths inside workspace | ✅ `openspec/specs/jobs/spec.md` under repo root; no `allowedEditRoots` restriction (repo-local action mode per `actionContext.mode`) |
| `rules.sync` from `openspec/config.yaml` | ✅ no `sync` rule block present in config; `rules.archive` destructive-delta warning was honored (parent-prompt approval recorded) |
| Byte-exact merge | ✅ delta ADDED blocks copied verbatim; delta MODIFIED blocks copied verbatim including `(Previously: …)` provenance sentences and `(NEW — replaces …)` scenario annotations |

## 8. Validation performed

- Pre-sync baseline assertions:
  - Canonical requirements = 25, scenarios = 106 (verified via `grep -c '^### Requirement:'` / `grep -c '^#### Scenario:'`).
  - Obsolete `closed is terminal` scenario present in canonical (verified before edits).
  - Old `closed → draft` NO and `closed → published` NO rows present in canonical Status Transition Table (verified before edits).
  - `re-opening a closed job` line present in canonical `Out of scope (deferred)` (verified before edits).
- Post-sync assertions (after edits):
  - Canonical requirements = **29** ✓, scenarios = **124** ✓ (matches verify-report declared totals and the parent prompt's exact-arithmetic requirement).
  - Obsolete `closed is terminal` scenario = **0** ✓.
  - Old `closed → draft NO` row = **0** ✓, old `closed → published NO` row = **0** ✓.
  - New `closed → draft YES (NEW — re-open)` row = **1** ✓, new `closed → published YES (NEW — re-open)` row = **1** ✓.
  - `409 company is not active` row in Error Taxonomy table = **1** ✓.
  - `re-opening a closed job` in Out of scope = **0** ✓.
  - `closed terminal` wording in preamble = **0** ✓.
  - Requirement-name uniqueness: all 29 canonical requirement names are distinct (verified via `sort | uniq -d`, zero collisions).
- `git diff --stat` on canonical: 139 insertions / 9 deletions; no read-side requirement line was modified.
- No code touched; no commit created; change folder left in place (not archived). The working tree contains uncommitted changes against the prior committed state of `openspec/specs/jobs/spec.md` (the prior canonical is at `3f4594b` or earlier — confirm with `git log --oneline openspec/specs/jobs/spec.md` at archive time).

## 9. Warnings carried forward from verify-report

These are documented in `verify-report.md` §9 (deviations). They are not sync blockers, but the sync contract records them so the archive phase and downstream reviewers have full context.

1. **D8 file-count drift (WARNING)** — verify-report §9.1: design §2 and tasks.md undercount authored files ("4 authored files + 2 generated") versus the actual 6 authored + 2 generated. No forbidden-file leak; bookkeeping-only drift. Not a sync blocker.
2. **Strict-TDD evidence format (WARNING)** — verify-report §9.2: apply-progress.md reports evidence as prose "RED before GREEN" blocks rather than the literal "TDD Cycle Evidence" table the strict-TDD module expects. Substance is present and verified; format only. Not a sync blocker.

## 10. Structured status & actionContext findings

| Field | Value |
|---|---|
| artifactStore | openspec (authoritative — config `schema: spec-driven`, "Persistence mode: openspec") |
| changeName | jobs-reopen |
| changeRoot | openspec/changes/jobs-reopen |
| applyState | all_done (per verify-report, all implementation tasks `[x]`) |
| actionContext.mode | repo-local (no `workspace-planning` mode, no `allowedEditRoots` restriction) |
| delta shape | 4 ADDED + 2 MODIFIED + 0 RENAMED + 1 obsolete scenario removed (by MODIFIED replacement) |
| Post-sync canonical totals | 29 requirements / 124 scenarios |
| Destructive sync approvals | recorded — parent prompt explicitly approves the obsolete-scenario removal; verify-report verifies arithmetic |
| `rules.sync` from config.yaml | no `sync` rule block present; `rules.archive` destructive-delta warning was honored |

## 11. Next recommended phase

`sdd-archive` — sync is clean (canonical merged to 29 / 124, no collisions, no blockers, destructive sync explicitly approved and recorded). Archive readiness is the parent-owned lifecycle decision; verify-report §10 confirms zero exact blockers and the two warnings are documentation/process, not behavior. The archive phase should:

- Create `openspec/changes/archive/2026-08-25-jobs-reopen/` (date + change-name per `rules.archive` precedent from `2026-08-25-jobs-create`).
- Move the entire `openspec/changes/jobs-reopen/` folder into the dated archive subfolder (proposal, design, specs/, tasks.md, apply-progress.md, verify-report.md, sync-report.md).
- Leave `openspec/specs/jobs/spec.md` as the authoritative post-sync canonical.
- Not amend the working-tree diff beyond the move itself; commit the move + the canonical edit together as the archive commit.
