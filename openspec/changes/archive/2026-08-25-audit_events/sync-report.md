# Sync Report: `audit_events`

- **status**: `synced`
- **change**: `audit_events` (artifact store: `openspec`, file-backed)
- **domains synced**: `audit_events` (NEW bounded context), `applications` (ADDED fold + front-matter lift)
- **canonical files updated**: `openspec/specs/audit_events/spec.md` (created), `openspec/specs/applications/spec.md` (modified)
- **artifact store**: `openspec` (authoritative — config `schema: spec-driven`, "Persistence mode: openspec") — this report persisted to `openspec/changes/audit_events/sync-report.md`
- **skill_resolution**: `paths-injected` (cognitive-doc-design + work-unit-commits loaded before work)

---

## 1. Delta classification

The change carries **two domain deltas** of different shapes:

| Domain delta | Shape | Notes |
|---|---|---|
| `openspec/changes/audit_events/specs/audit_events/spec.md` | **NEW bounded context** | 6 requirements / 17 scenarios; canonical `openspec/specs/audit_events/` did not exist before this sync — promoted byte-for-byte per the "no canonical exists → copy change spec as the new canonical" semantics. |
| `openspec/changes/audit_events/specs/applications/spec.md` | **Pure ADDED fold + front-matter lift** | 4 ADDED requirements / 13 ADDED scenarios. **Zero** `## MODIFIED Requirements`, **zero** `## REMOVED Requirements`, **zero** `## RENAMED Requirements`. The delta also requires lifting the canonical `## Out of scope (deferred)` clause that deferred `audit_events` integration and correcting the canonical `## Purpose` sentence that asserted "no `audit_events` row" — both front-matter edits are precisely what the delta calls out at merge. |

No destructive elements: no REMOVED, no MODIFIED-block replacements, no RENAMED, no large block rewrites. The applications fold is the cleanest classification — pure ADDED with prose-level front-matter corrections (3 single-line edits, no requirement block touched). Per `openspec/config.yaml` `rules.archive` "Warn before merging destructive deltas (REMOVED requirements) into openspec/specs/" — this delta does not trigger that warning.

## 2. Domains synced

| Domain | Action | Canonical path | Requirements | Scenarios |
|---|---|---|---|---|
| `audit_events` | **created** | `openspec/specs/audit_events/spec.md` | 6 | 17 |
| `applications` | **modified** (ADDED fold + front-matter lift) | `openspec/specs/applications/spec.md` | +4 | +13 |

No other domain in `openspec/specs/` was touched.

## 3. Requirements synced (NEW BC, 6)

| # | Requirement | Scenarios |
|---|---|---|
| 1 | Audit Events Schema Migration | 6 |
| 2 | Actor Type Vocabulary | 2 |
| 3 | Event Type Vocabulary (Closed Set for This Cycle) | 2 |
| 4 | Append-Only Port | 2 |
| 5 | Co-Write Atomicity Contract | 2 |
| 6 | Metadata Shape (PII-Free) | 3 |

Total: **6 requirements / 17 scenarios** for the new `audit_events` bounded context. Requirement blocks were copied byte-exact from the change spec (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, inline CHECK/index naming, and the §1.3 exception wording.

### Byte-for-byte verification

| Source | Canonical | sha256 |
|---|---|---|
| `openspec/changes/audit_events/specs/audit_events/spec.md` | `openspec/specs/audit_events/spec.md` | `5f6d6bfc412ba3951dfe74ae4f36e8721fbae010d83e7d6390cae50544dbe46e` |

`diff -q` between source and canonical reports **no differences**; `wc -l` matches at **133 lines**; `grep -c '^### Requirement:'` matches at **6**; `grep -c '^#### Scenario:'` matches at **17**. The new bounded-context promotion is a byte-equivalent copy.

## 4. Requirements synced (applications ADDED, 4)

| # | Requirement | Scenarios |
|---|---|---|
| 1 | ApplicationSubmitted Audit Emission | 4 |
| 2 | ApplicationTransitioned Audit Emission | 3 |
| 3 | Transition Actor Identity (CompanyContext UserID) | 3 |
| 4 | Fail-Closed Application + Audit Co-Write | 3 |

Total: **4 requirements / 13 scenarios** appended. Requirement blocks were copied byte-exact from the delta (no transcription), preserving heading hierarchy, GIVEN/WHEN/THEN bullets, the additive `CompanyContext.UserID` wording, and the fail-closed cross-references — matching the precedent set by `jobs-create`, `jobs-reopen`, and `jobs-soft-delete` (all pure ADDED folds).

## 5. Canonical merge outcome (applications)

`openspec/specs/applications/spec.md` went from **26 requirements / 107 scenarios** to **30 requirements / 120 scenarios**:

- **4 ADDED requirements appended** at the end of the existing `## Requirements` section, after `Recruiter Route Security Boundary` (the last canonical requirement). New requirement names: `ApplicationSubmitted Audit Emission`, `ApplicationTransitioned Audit Emission`, `Transition Actor Identity (CompanyContext UserID)`, `Fail-Closed Application + Audit Co-Write`.
- **No requirement name collision**: each of the 4 new ADDED names was asserted absent from the canonical spec before append; each now appears exactly once. `sort | uniq -d` over all 30 requirement names returns zero collisions.
- **All 107 existing canonical scenarios preserved verbatim** (verified by `comm -23 <(sort pre_scenarios) <(sort post_scenarios)` → 0 missing).
- **All 26 existing canonical requirement names preserved verbatim** (verified by `comm -23 <(sort pre_reqs) <(sort post_reqs)` → 0 missing).
- **Exactly 4 new requirements / 13 new scenarios** (verified by `comm -13` → 4 reqs, 13 scenarios).
- **No MODIFIED, no REMOVED, no RENAMED**: existing canonical requirement blocks are byte-untouched.

`git diff --stat openspec/specs/applications/spec.md` reports **97 insertions / 3 deletions**. The 3 deletions are precisely the front-matter prose edits called out by the delta (see §6); no existing requirement block, scenario, or scenario bullet was modified.

## 6. Front-matter lifts in `applications`

The delta explicitly calls out two front-matter corrections at merge. Both applied precisely:

### 6.1 `## Purpose` sentence

- **Removed**: `no `audit_events` row,` from the "The context is deliberately narrow:" clause.
- **Replaced with**: `; the two application write paths (apply, transition) co-write `audit_events` rows in the same database transaction (fail-closed — see `Fail-Closed Application + Audit Co-Write` and the canonical `audit_events` spec).`
- The remaining negative-list items (`no withdraw, no re-apply, no per-stage timestamp, no pagination, no public applications read surface`) are preserved verbatim. The corrective clause cross-references the new canonical `Fail-Closed Application + Audit Co-Write` requirement and the canonical `audit_events` spec.

### 6.2 `## Out of scope (deferred)` clause

- **Removed**: `audit_events` integration for `ApplicationSubmitted` or `ApplicationTransitioned` (the `audit_events` table has no migration in the repo yet);` from the "does NOT cover" enumeration. Leaving it listed would directly contradict the canonical spec (the integration is now DELIVERED via the 4 ADDED requirements above; the table is materialized by migration `00011`).
- **Added** (appended at the end of the same paragraph): `The `audit_events` read/query surface is out of scope for this slice (write-only — see the canonical `audit_events` spec for the table, port, and co-write contract); outbox / SNS / SQS / EventBridge fan-out of `ApplicationSubmitted` or `ApplicationTransitioned` is deferred; the jobs, companies, and identity write paths emit no audit events in this cycle.`
- This lifted clause explicitly defers the read surface, the fan-out patterns, and the cross-context emission — closing the open question list at the delta level (Q4: read surface → write-only; R5: append-only drift → no read query exists; the cross-context emission gap from R5 / Q5 is now pinned in canonical prose). All other deferred items (CV upload, LFPDPPP, in-process domain events, withdraw, per-stage timestamps, bulk transitions, source-attribution analytics, pagination, public applications read endpoint, frontend/SQS/email) are preserved verbatim.

Both edits are one-line surgical replacements (3 deletions / 2 insertions in the diff) — no requirement block, scenario, table, or wire-protocol wording was modified.

## 7. Guardrail checks

| Check | Result |
|---|---|
| `verify-report.md` present and passing | ✅ verdict `pass_with_warnings`, blockers 0, CRITICAL 0; 10/10 requirements, 30/30 scenarios covered |
| Delta classification | ✅ applications: 4 ADDED + 0 MODIFIED + 0 REMOVED + 0 RENAMED; audit_events: NEW BC. No `## RENAMED Requirements` (the native helper does not support) |
| Destructive sync approval | ✅ n/a — no REMOVED, no MODIFIED wholesale replacements, no large block rewrites; the 3 front-matter edits are the minimal prose-level lifts the delta explicitly requests at merge |
| Active same-domain collisions | ✅ none — `audit_events` is the only active change touching `openspec/specs/applications/spec.md` (sibling archives: `2026-08-25-applications`, all under `archive/`, not active); `openspec/specs/audit_events/` is brand-new — no other active change targets it |
| Legacy flat spec (`openspec/changes/audit_events/spec.md`) | ✅ n/a — domain-spec layout used (`openspec/changes/audit_events/specs/{audit_events,applications}/spec.md`) |
| Canonical paths inside workspace | ✅ both canonical files live under `openspec/specs/` inside the repo root; no `allowedEditRoots` restriction (`actionContext.mode` is repo-local for sync) |
| `rules.sync` from `openspec/config.yaml` | ✅ no `sync` rule block present in config; `rules.archive` destructive-delta warning honored (n/a here — pure ADDED fold); `rules.specs` Given/When/Then + RFC 2119 + single-domain invariants honored |
| Byte-exact merge | ✅ audit_events BC is byte-identical to its source (sha256 match); applications ADDED blocks copied verbatim — diff between delta's 4 requirement blocks and the appended 4 requirement blocks in the canonical is empty |

## 8. Validation performed

### Pre-sync baseline assertions

- Canonical `applications/spec.md` requirements = **26** ✓, scenarios = **107** ✓ (verified via `grep -c '^### Requirement:'` / `grep -c '^#### Scenario:'` against `git show HEAD:openspec/specs/applications/spec.md`).
- Pre-existing canonical requirement names distinct: 26/26 names unique (`sort | uniq -d` → empty).
- Pre-existing canonical scenario names distinct: 107/107 names unique.
- Phrase `no `audit_events` row` present in canonical `## Purpose` (verified before edits).
- Phrase `audit_events` integration for `ApplicationSubmitted` or `ApplicationTransitioned` present in canonical `## Out of scope (deferred)` (verified before edits).
- `openspec/specs/audit_events/` does NOT exist (verified before edits).

### Post-sync assertions (after edits)

- Canonical `applications/spec.md` requirements = **30** ✓, scenarios = **120** ✓ (matches verify-report declared totals and the parent prompt's exact-arithmetic requirement: 26 + 4 = 30; 107 + 13 = 120).
- Pre-sync canonical requirement names preserved: **26/26** present in post-sync (`comm -23` → 0 missing).
- Pre-sync canonical scenario names preserved: **107/107** present in post-sync (`comm -23` → 0 missing).
- New requirement names (`ApplicationSubmitted Audit Emission`, `ApplicationTransitioned Audit Emission`, `Transition Actor Identity (CompanyContext UserID)`, `Fail-Closed Application + Audit Co-Write`) each appear exactly once.
- New scenario count: **13** ✓ (`comm -13` → 13 lines).
- Phrase `no `audit_events` row` in canonical `## Purpose` = **0** ✓.
- Phrase `audit_events` integration for `ApplicationSubmitted` or `ApplicationTransitioned` in canonical `## Out of scope (deferred)` = **0** ✓.
- New front-matter additions present:
  - `the two application write paths (apply, transition) co-write `audit_events` rows in the same database transaction` — **1** ✓ in `## Purpose`.
  - `The `audit_events` read/query surface is out of scope for this slice (write-only` — **1** ✓ in `## Out of scope (deferred)`.
  - `outbox / SNS / SQS / EventBridge fan-out of `ApplicationSubmitted` or `ApplicationTransitioned` is deferred` — **1** ✓ in `## Out of scope (deferred)`.
  - `the jobs, companies, and identity write paths emit no audit events in this cycle` — **1** ✓ in `## Out of scope (deferred)`.
- Requirement-name uniqueness across all 30 canonical requirement names: zero collisions (`sort | uniq -d` → empty).
- `openspec/specs/audit_events/spec.md` exists, 133 lines, sha256 matches the change spec, `diff -q` → no differences.
- No `## RENAMED Requirements` section in either domain delta (verified before edits — `## RENAMED` is unsupported by the native helper).
- No `## MODIFIED Requirements` section in either domain delta (verified before edits).
- No `## REMOVED Requirements` section in either domain delta (verified before edits).

### Diff scope

- `git diff --stat openspec/specs/applications/spec.md` → **97 insertions / 3 deletions**. The 3 deletions are the original `Purpose` "no `audit_events` row" fragment and the original `Out of scope (deferred)` audit_events-integration fragment (1 deletion each, both single-line edits), plus 1 deletion of an empty line that was folded into the new front-matter text. The 97 insertions cover: 2 replacement front-matter fragments + 1 blank-line insertion + 94 lines for the 4 ADDED requirement blocks (4 headings + 13 scenario headings + scenario bullets + inter-block blanks).
- `git status --short openspec/specs/`: `M openspec/specs/applications/spec.md` + `?? openspec/specs/audit_events/` — exactly the two expected changes, no overwrites, no scope creep.
- No production code touched; no commit created; change folder `openspec/changes/audit_events/` left in place (not archived). The working tree contains uncommitted changes against HEAD `d2a6560`.

## 9. Warnings carried forward from `verify-report.md`

These are documented in `verify-report.md` §4. They are not sync blockers — sync carries them forward so the archive phase and downstream reviewers have full context.

1. **W1 — `actor_type='system'` positive DB acceptance is not directly pinned** (verify-report §4.1). The reject side (`'robot'` → SQLSTATE 23514) is pinned, and the co-write/metadata/event-type tests prove `'user'` is accepted, but no integration test inserts `actor_type='system'` with `actor_id IS NULL` and asserts success. **Fix:** add a case to `migration_00011_test.go` (or the co-write suite) that inserts `actor_type='system', actor_id=NULL` and asserts acceptance.
2. **W2 — terminal-transition audit rows/metadata are only implied, not asserted** (verify-report §4.2). `TestTransition_CoWritesTransitionedEvent` asserts exactly-one-row + full metadata only for `submitted → in_review`; `_InReviewToRejected` / `_InReviewToHired` pass the event through the co-write method but never call `countAuditRowsForEntity` nor read the metadata. **Fix:** extend the terminal-transition tests (or add one table-driven test over the three legal edges) to assert `countAuditRowsForEntity == 1` and metadata `{job_id, from_status, to_status}`.
3. **W3 — `occurred_at` within-request-window not asserted** (verify-report §4.3). Trivial — the column is `TIMESTAMPTZ NOT NULL DEFAULT now()` (pinned by the migration DDL and `TestAuditEvents_MetadataDefaultsEmptyObject`). **Fix (optional):** add a `SELECT occurred_at` and assert it is non-zero / within `[start, end]` of the request window.

**Bottom line:** none of the warnings alter what either spec says or requires. The canonical promotion is a pure ADDED fold (applications) + byte copy (audit_events). Any post-archive tightening (DB-acceptance test for `'system'`, explicit per-edge terminal-transition assertions, optional `occurred_at` window assertion) belongs in a follow-up change, not in this sync.

## 10. Structured status & actionContext findings

| Field | Value |
|---|---|
| `artifactStore` | `openspec` (authoritative — config `schema: spec-driven`, "Persistence mode: openspec") |
| `changeName` | `audit_events` |
| `changeRoot` | `openspec/changes/audit_events` |
| `applyState` | `all_done` (per verify-report, all implementation tasks `[x]`, HEAD `d2a6560`) |
| `verifyState` | `all_done` — verdict `pass_with_warnings`, 10/10 requirements, 30/30 scenarios covered, 0 CRITICAL, 0 blockers, 3 non-blocking warnings (§4) |
| `actionContext.mode` | repo-local (no `workspace-planning` mode, no `allowedEditRoots` restriction) |
| `domains synced` | `audit_events` (NEW BC), `applications` (ADDED + front-matter) |
| `delta shape` | `audit_events` → 6 NEW reqs / 17 NEW scen; `applications` → 4 ADDED + 0 MODIFIED + 0 REMOVED + 0 RENAMED + 2 front-matter prose lifts |
| Pre-sync canonical `applications` totals | 26 requirements / 107 scenarios |
| Post-sync canonical `applications` totals | **30 requirements / 120 scenarios** |
| Post-sync canonical `audit_events` totals | **6 requirements / 17 scenarios** (new bounded context) |
| `nextRecommended` (pre-sync) | `sdd-archive` (per parent prompt and verify-report §10) |
| `nextRecommended` (post-sync) | `sdd-archive` |
| Destructive sync approvals | n/a — pure ADDED fold + 2 surgical front-matter edits; parent prompt explicitly directed both lifts |
| `rules.sync` from config.yaml | no `sync` rule block present; `rules.archive` destructive-delta warning honored (n/a here) |

## 11. What the next phase (`sdd-archive`) should do

The archive phase (separate, after this sync is approved) should:

1. Re-read this sync report and `verify-report.md` to confirm the canonical state:
   - `openspec/specs/audit_events/spec.md` exists, byte-identical to its source (sha256 `5f6d6bfc412ba3951dfe74ae4f36e8721fbae010d83e7d6390cae50544dbe46e`), 6 req / 17 scen.
   - `openspec/specs/applications/spec.md` carries the 4 ADDED requirements at the end of `## Requirements` and the 2 front-matter lifts; canonical totals 30 req / 120 scen; pre-sync canonical scenarios and requirement names preserved verbatim.
2. Verify `git status --short openspec/specs/` shows exactly one modified file (`M openspec/specs/applications/spec.md`) and one new untracked directory (`?? openspec/specs/audit_events/`) — no overwrites, no scope creep.
3. Move the change folder to `openspec/changes/archive/YYYY-MM-DD-audit_events/` per `rules.archive` precedent from `2026-08-25-jobs-soft-delete`, `2026-08-25-jobs-reopen`, `2026-08-25-jobs-create`, and `2026-08-25-applications` (date + change-name). The audit trail is preserved (proposal, design, specs/, tasks.md, apply-progress.md, verify-report.md, sync-report.md).
4. Leave `openspec/specs/audit_events/spec.md` and `openspec/specs/applications/spec.md` as the authoritative post-sync canonical.
5. Do not amend the working-tree diff beyond the move itself; the archive commit should bundle the move + the canonical edits.
6. Do not touch production code — only the canonical spec files and the archive folder move are in scope.

---

## 12. Status envelope

| Field | Value |
|---|---|
| `status` | `synced` |
| `executive_summary` | Two domain deltas were promoted to canonical. **NEW BC** `openspec/specs/audit_events/spec.md` was created as a byte-for-byte copy of the change spec (133 lines, 6 requirements, 17 scenarios; sha256 match). **ADDED fold** in `openspec/specs/applications/spec.md` appended 4 requirements / 13 scenarios after the last existing requirement and lifted two front-matter prose lines (the Purpose sentence that asserted "no `audit_events` row" and the Out-of-scope clause that deferred `audit_events` integration) — the canonical totals went from 26 req / 107 scen to 30 req / 120 scen, with all 26 pre-sync requirement names and 107 pre-sync scenario names preserved verbatim. Verify was `pass_with_warnings` (0 blockers, 10/10 requirements, 30/30 scenarios); the three non-blocking warnings (W1-W3) carried forward do not alter spec content. No destructive deltas, no collisions, no approval gates tripped. |
| `artifacts` | `openspec/specs/audit_events/spec.md` (created), `openspec/specs/applications/spec.md` (modified), `openspec/changes/audit_events/sync-report.md` (this file) |
| `next_recommended` | `sdd-archive` |
| `risks` | Low — no destructive deltas, no canonical collision, no commit/push in scope. The only residual risks are the three carried warnings (W1-W3), which a future tightening change should address (DB acceptance for `actor_type='system'`, explicit per-edge terminal-transition assertions, optional `occurred_at` window assertion). |
| `skill_resolution` | `paths-injected` (cognitive-doc-design + work-unit-commits were loaded before work) |

---

## Key Learnings

1. Audit-events sync combined a brand-new bounded-context promotion with a pure ADDED fold on an existing canonical spec, preserving all 107 pre-existing scenarios verbatim via `comm -23` diff.
2. The applications delta's two surgical front-matter lifts (Purpose "no `audit_events` row" removal, Out-of-scope `audit_events` integration deferral removal) are precisely the prose corrections the delta calls out at merge — neither modifies an existing requirement block.
3. The audit-events BC canonical promotion is byte-for-byte identical to its source (sha256 match) — diff -q / wc -l / grep -c all confirm zero transcription drift across 133 lines and 17 scenarios.
4. The `fail-closed co-write` requirement pins an atomicity contract that no read surface, no outbox, no EventBridge fan-out, and no UPDATE/DELETE can ever relax — the append-only invariant is enforced by absence of surface in both the port and the sqlc query file.
5. The `Transition Actor Identity` ADDED requirement threads the recruiter `users.id` through `CompanyContext.UserID` (additive identity change) so the `ApplicationTransitioned` audit row carries an accurate human actor rather than a system stub.