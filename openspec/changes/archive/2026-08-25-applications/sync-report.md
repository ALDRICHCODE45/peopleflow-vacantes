# Sync Report: `applications` → `openspec/specs/applications/`

**Verdict:** **synced** — the verified `applications` spec was promoted into the canonical `openspec/specs/` tree as a brand-new bounded context. The change folder remains active and is ready for the next phase (`sdd-archive`).

---

## Outcome at a glance

| Item | Value |
|---|---|
| Store | `openspec` (file artifacts only — Engram mirroring is not in this mode) |
| Change | `applications` |
| Change root | `openspec/changes/applications/` |
| Sync kind | **New domain** — no prior canonical `applications` spec existed; full-spec copy, not a delta fold |
| Domain spec source | `openspec/changes/applications/specs/applications/spec.md` (805 lines, 26 requirements, 107 scenarios) |
| Canonical file created | `openspec/specs/applications/spec.md` |
| Byte-for-byte identical | ✅ `sha256:fd2977d69005d893199d017b2867e1164e084f5bedce4941d57048cf73b260a9` on both sides |
| Verify verdict | `pass_with_warnings` (0 CRITICAL, 0 blockers; 26/26 requirements, 107/107 scenarios) |
| Destructive approvals needed | None — no `REMOVED`, no `RENAMED`, no destructive MODIFIED |
| Same-domain collisions | None — `applications` is brand-new in canonical; no other active change touches it |
| Next recommended phase | `sdd-archive` |

---

## Domains synced

| Domain | Action | Canonical path | Requirements | Scenarios |
|---|---|---|---|---|
| `applications` | created | `openspec/specs/applications/spec.md` | 26 | 107 |

No domain was modified or removed. No other domain in `openspec/specs/` was touched.

---

## Canonical files updated

- **Created:** `openspec/specs/applications/spec.md` (805 lines, 26 requirements, 107 scenarios; identical bytes to the change spec — sha256 match).

No other canonical files changed.

---

## Delta operations performed

| Operation | Count | Names |
|---|---|---|
| ADDED requirements | 26 | All requirements — the spec is brand-new in canonical |
| MODIFIED requirements | 0 | — |
| REMOVED requirements | 0 | — |
| RENAMED requirements | 0 | — |

Because there was no prior `openspec/specs/applications/spec.md`, the native helper semantics resolve to "no canonical exists → copy change spec as the new canonical." This is a full-spec promotion, not a delta fold.

---

## Active same-domain collisions

None. A grep over `openspec/changes/` confirms `applications` is the only active change; the `archive/` directory was not inspected (it is immutable per `openspec/config.yaml` rules.archive). No two active changes race for `specs/applications/spec.md`.

---

## Destructive sync approvals

Not applicable. No `REMOVED` requirements, no large `MODIFIED` blocks, and the spec carries no `## RENAMED Requirements` section (the unsupported path is not in play).

---

## Verification

| Check | Result |
|---|---|
| `sha256sum` of source vs canonical | ✅ identical (`fd2977d69005d893199d017b2867e1164e084f5bedce4941d57048cf73b260a9`) |
| `wc -l` source vs canonical | ✅ identical (805) |
| `grep -c "^### Requirement:"` source vs canonical | ✅ identical (26) |
| `grep -c "^#### Scenario:"` source vs canonical | ✅ identical (107) |
| `diff -q` source vs canonical | ✅ no differences reported |
| Source spec layout (`# Applications Specification` + `## Requirements`) | ✅ matches the existing canonical convention used by `candidates`, `jobs`, `company-membership`, `identity` |
| `openspec/config.yaml` `rules.specs` | ✅ Given/When/Then on every scenario; RFC 2119 keywords used; single domain per requirement; this is a full-spec (not a delta), so the `ADDED / MODIFIED / REMOVED / RENAMED` rule is not applicable to the *promotion*, but the change spec carries no delta sections either |
| `openspec/config.yaml` `rules.archive` | ✅ No destructive deltas present — no archive warning is required at sync time |

---

## Structured status and actionContext findings

- **Store:** `openspec` (file artifacts only). Engram persistence is not active in this mode; the `Mem_sdd/applications/sync-report` save was attempted via the mem_save tool below and is best-effort.
- **Next recommended phase (pre-sync):** `verify` → **Next recommended phase (post-sync):** `sdd-archive`.
- **Action context:** `actionContext.mode` is not `workspace-planning`; the repo is the authoritative workspace; canonical spec paths live under the workspace root, so no `allowedEditRoots` ambiguity. The new file was written under the canonical spec root `openspec/specs/applications/` — exactly where it belongs.
- **Sync phase guard:** No MODIFIED/REMOVED against an absent target, no `## RENAMED` block, no destructive deltas requiring approval — all sync guards pass.
- **Attempt token:** The sync phase is not the attempt-binding owner; verify owns the bound attempt (`sha256:a36d4eb50e1425bbf8e84f0eeeff8c6292be885f64a3ba53470693d329388058`). Sync does not consume attempt budget.

---

## Warnings carried from `verify-report.md`

These do not block sync — they are the same non-blocking warnings verify left on the ledger. They should be visible to anyone reading the canonical spec in the future.

| # | Warning | Where it lives | Impact on sync |
|---|---|---|---|
| 1 | **AST guard naming drift** — design §7 names `TestApplicationApply_BehindRequireAuth` / `TestApplicationRoutes_AllRecruiterGated`; actual guards are `TestApplicationsApplyRoute_MountedBehindAuth` / `TestApplicationsRecruiterRoute_MountedBehindGates`. | Implementation tests; does not affect the spec file. | None on canonical spec content. |
| 2 | **AST guards weaker than specified** — apply guard asserts `requireAuth` present but does **not** assert `requireRecruiter` absent; recruiter guard does **not** inspect the `Route` callback `FuncLit` for `Get`/`Patch` declarations (design §7 items 51–52 require both). | Implementation tests; the spec only requires the routes be mounted behind the gates — runtime mount assertions exist at the routes layer (`RequireAuth_MountedOnMeRoutes`, `RequireCompanyRole` 401/403). | None on canonical spec content. The spec language ("MUST be mounted behind…") is honored at the routes layer; the AST-strength gap is a test-coverage nuance, not a spec violation. |
| 3 | **`apply-progress.md` Commit E prose overclaim** — the historical Commit E grouping reads "(Phase 5: tasks 5.1–5.2)" with a message about "migration + adapter", but the **adapter integration suite** actually landed in the remediation commit **`154e9cd`**, not in `71a0f1d` (Commit E's adapter-SQL line is the unit/adapter stub; the live-Postgres integration suite is the remediation commit). The 5.2 checkbox itself is now truthful (real file exists), but the historical commit-grouping prose was not retroactively corrected. | `openspec/changes/applications/apply-progress.md` only — does not affect the spec file. | None on canonical spec content. The spec describes behavior; commit attribution is `apply-progress.md`'s job. |
| 4 | **TDD evidence table incompleteness** — "TDD Cycle Evidence" table covers Commit A only; B–G + remediation are prose. | `apply-progress.md` only. | None on canonical spec content. |
| 5 | **Test scaffolding in production files** — `applyToJob.go` / `applicationService.go` carry test-only sentinel aliases/wrappers. | Production source. | None on canonical spec content. |
| 6 | **Mapper / comment drift** — `toApplicationFromFields` maps `source` via a switch (not `ParseApplicationSource`) while its comment says "reconstructed via Parse*"; `Querier` scalar vs design §5.7 `Row` sketch. | Production source + comment. | None on canonical spec content. |
| 7 | **`TestListByJob_WithRowsDescOrder` comment off by ordering** — comment says "The newest row belongs to userC1" but the assertion correctly checks `got[2]` (the oldest). | Integration test comment. | None on canonical spec content. |

**Bottom line:** none of the warnings alter what the spec says or requires. The canonical promotion is a pure byte copy. Any post-archive tightening (rename the AST guards, broaden their assertions, fix the Commit E prose, move test-only sentinels to `_test.go`) belongs in a follow-up change, not in this sync.

---

## Remediation context — where the integration suite actually lives

The verify-report credits the Phase 5.2 adapter SQL integration suite to remediation commit **`154e9cd`** (`test(applications): adapter SQL integration suite (remediation of 5.2)`, +1284 lines, single file `backend/internal/features/applications/infrastructure/postgres/applicationRepository_integration_test.go`, 29 `func Test…`). It is **not** part of the change's normal `tasks.md` Commit E (`71a0f1d`), which only delivered the unit/adapter stub. The sync carries that distinction forward so the archive phase doesn't conflate them.

---

## What the next phase (`sdd-archive`) should do

1. Re-read this sync report and the verify-report to confirm the canonical `openspec/specs/applications/spec.md` is the byte-equivalent promoted copy.
2. Verify `git status --short openspec/specs/applications/` shows exactly one new untracked file (`spec.md`) — no overwrites, no scope creep.
3. Move the change folder to `openspec/changes/archive/YYYY-MM-DD-applications/` per `rules.archive` (audit trail is preserved; canonical stays in `openspec/specs/applications/`).
4. Leave working-tree edits unstaged per the delegated task — no commit, no push.

---

## Status envelope

| Field | Value |
|---|---|
| `status` | `synced` |
| `executive_summary` | Brand-new domain `applications` was promoted byte-for-byte from `openspec/changes/applications/specs/applications/spec.md` to `openspec/specs/applications/spec.md` (805 lines, 26 requirements, 107 scenarios; sha256 match). Verify was `pass_with_warnings` with 0 blockers; the seven warnings carried forward do not alter spec content. No destructive deltas, no collisions, no approval gates tripped. |
| `artifacts` | `openspec/specs/applications/spec.md` (created), `openspec/changes/applications/sync-report.md` (this file) |
| `next_recommended` | `sdd-archive` |
| `risks` | Low — no destructive deltas, no canonical collision, no commit/push in scope. The only residual risk is the carried AST-guard strength warning (warning #2), which a future tightening change should address. |
| `skill_resolution` | `paths-injected` (cognitive-doc-design + work-unit-commits were loaded before work) |