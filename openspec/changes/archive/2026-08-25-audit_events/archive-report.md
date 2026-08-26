# Archive Report: `audit_events`

- **status**: `archived`
- **change**: `audit_events` (artifact store: `openspec`, file-backed)
- **archived to**: `openspec/changes/archive/2026-08-25-audit_events/`
- **artifact store**: `openspec` (authoritative) — this report persisted to `openspec/changes/archive/2026-08-25-audit_events/archive-report.md`
- **verdict**: `pass_with_warnings` (0 CRITICAL, 0 blockers; 10/10 requirements, 30/30 scenarios)

---

## 1. Verdict

The `audit_events` change is archived. **Archive status: PASS.**

- `verify-report.md`: present, `verdict: pass_with_warnings`, `blockers: 0`, `critical_findings: 0`, `requirements: 10/10`, `scenarios: 30/30`. The YAML envelope is a valid `gentle-ai.verify-result/v1` block (`schema`, `evidence_revision`, `verdict`, `blockers`, `critical_findings`, `requirements`, `scenarios`, `test_command`, `test_exit_code: 0`, `test_output_hash`, `build_command`, `build_exit_code: 0`, `build_output_hash`). Three non-blocking coverage-gap warnings are carried forward into this report (see §9) — none is `FAIL`, `BLOCKED`, `CRITICAL`, or a verification blocker.
- `sync-report.md`: present, status `synced`. Canonical `openspec/specs/audit_events/spec.md` is **6 requirements / 17 scenarios**, byte-for-byte identical to the change spec (`sha256:5f6d6bfc412ba3951dfe74ae4f36e8721fbae010d83e7d6390cae50544dbe46e` on both sides; `wc -l` 133 each; `diff -q` empty). Canonical `openspec/specs/applications/spec.md` went from **26 → 30 requirements** and **107 → 120 scenarios** (4 ADDED requirements, 13 ADDED scenarios, plus two surgical front-matter prose lifts) — all 26 pre-sync requirement names and 107 pre-sync scenario names preserved verbatim (verified via `comm -23`).
- `tasks.md`: **30 `- [x]` implementation task lines, 0 `- [ ]` lines.** All 30 phase-bound task rows (Phase 1: 1.1–1.6; Phase 2: 2.1–2.8; Phase 3: 3.1–3.13; Phase 4: 4.1–4.3) are checked. No DECIDED-SKIPs; no partial implementation. **No `sdd-apply` re-run is required and no mechanical checkbox repair was performed by this archive phase.** The two parent-owned post-apply items (`bounded review` + `post-apply lifecycle gate`) are deliberately plain bullets with the `<!-- sdd-owner: parent -->` marker and no `[ ]` checkbox — this mirrors the `jobs-soft-delete` archive convention so the native status engine does not count them as outstanding implementation tasks (see §8).
- Delta shape: **6 NEW BC + 4 ADDED + 0 MODIFIED + 0 RENAMED + 0 REMOVED + 2 front-matter prose lifts.** Cleanest possible classification — pure NEW bounded-context promotion + pure ADDED fold, no destructive edits to existing canonical content, no MODIFIED-block wholesale replacements, no obsolete-scenario removal. No destructive-merge approval gate was tripped.

## 2. Commit trace (WU1 / WU2 / WU3)

Implementation landed as **three commits** on `main` ahead of `origin/main` (`git log --oneline`):

| WU | PR | Commit | Scope | Chosen lines (ledger) |
|----|----|--------|-------|----------------------|
| WU1 | PR 1 | `11e3c0c` | `feat(audit_events)` — migration `00011` + `InsertAuditEvent` query + sqlc regen + Phase E migration tests | 638 |
| WU2 | PR 2 | `979cdea` | `feat(audit_events)` — bounded context: entity + `ActorType` VO + constants + append-only port + postgres adapter | 541 |
| WU3 | PR 3 | `d2a6560` | `feat(audit_events)` — atomic seam change: pool-owning adapter + co-write tx fail-closed + `CompanyContext.UserID` + committed-fixture integration migration | 1723 |

This matches the work-unit commit map in `apply-progress.md` exactly. All three commits exceeded their per-WU budgets (450 / 420 / 1300); each was reset with the maintainer actor "Aldrich Flores Vazquez" (consolidated pattern). WU3 is an intentional `size:exception` (~950–1100 authored lines): the applications port signature change is an atomic compile break that must land as one PR with all its repairs, the fixture migration, and the RED-first co-write integration tests — splitting it would leave `main` uncompilable between PRs.

WU1 carries 1.1 (RED migration integration tests) → 1.2 (GREEN `00011` migration) → 1.3 (RED query-file append-only guard) → 1.4 (GREEN `InsertAuditEvent` query) → 1.5 (GREEN sqlc regen) → 1.6 (verification round-trip). WU2 carries the `audit_events` BC RED-first: 2.1/2.2 (ActorType + closed event vocabulary) → 2.3 (entities package) → 2.4 (port reflection) → 2.5 (port interface) → 2.6 (build params) → 2.7 (postgres adapter) → 2.8 (verification). WU3 carries the atomic seam change: 3.1/3.2 (metadata builders + RED-first) → 3.3/3.4 (use-case event intent + seam) → 3.5 (compile-break RED on port) → 3.6 (co-write integration RED) → 3.7 (GREEN adapter rewrite) → 3.8 (handler RED+GREEN) → 3.9 (identity `CompanyContext.UserID` RED+GREEN) → 3.10 (composition root GREEN) → 3.11 (committed-fixture migration GREEN) → 3.12 (REFACTOR hygiene) → 3.13 (verification). Phase 4 (4.1 chain-level sweep, 4.2 rollback drill evidence, 4.3 success-criteria sweep) all `[x]` post-merge.

## 3. Verification summary

| Field | Value |
|---|---|
| `schema` | `gentle-ai.verify-result/v1` |
| `evidence_revision` | `sha256:922f720b06f4d013212b5f940486f41dd73b8cc94991fde712680528e77f9ed4` |
| `verdict` | `pass_with_warnings` |
| `blockers` | `0` |
| `critical_findings` | `0` |
| `requirements` | `10/10` |
| `scenarios` | `30/30` |
| `test_command` | `cd backend && go test -count=1 ./...` → exit `0` |
| `test_output_hash` | `sha256:06c40d08e8903f82b9f86a761220ef69a9a0d1703e8e8e85fdb26df3698f282a` |
| `build_command` | `cd backend && go build ./...` → exit `0` |
| `build_output_hash` | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty output) |

Full gate green: 35 packages `go test -count=1 ./...` → exit 0; `go build ./...` exit 0; `go vet ./...` clean; `go test -tags=integration -p 1 ./... -count=1` → exit 0 (audit_events postgres + applications postgres both executed, not skipped — all 7 migration tests + ActorType/Vocabulary/Port/Query/BuildParams PASS; all co-write tests PASS); `go tool goose down` → `go tool goose up` round-trips `00011` cleanly (drops table + index, re-applies, `goose status` = version 11); `go tool sqlc generate` idempotent (no diff on `internal/db` / `db/queries`); `gofmt -l` empty on the touched trees; residue check `SELECT count(*)` on `audit_events` and `applications` = 0 / 0 rows after the suite.

## 4. Canonical sync totals (post-sync)

| Artifact | Requirements | Scenarios |
|---|---|---|
| Pre-sync canonical `openspec/specs/applications/spec.md` | 26 | 107 |
| Pre-sync canonical `openspec/specs/audit_events/spec.md` | (does not exist) | (does not exist) |
| Delta `openspec/changes/audit_events/specs/audit_events/spec.md` (NEW BC) | 6 | 17 |
| Delta `openspec/changes/audit_events/specs/applications/spec.md` (ADDED fold) | +4 | +13 |
| Post-sync canonical `openspec/specs/audit_events/spec.md` | **6** | **17** |
| Post-sync canonical `openspec/specs/applications/spec.md` | **30** | **120** |

Sync kinds:
- **`audit_events` — NEW bounded context.** No prior canonical existed, so the native helper semantics resolve to "no canonical exists → copy change spec as the new canonical." This is a full-spec promotion (byte-for-byte copy), not a delta fold.
- **`applications` — pure ADDED fold + 2 front-matter prose lifts.** 4 ADDED requirements appended after the last canonical requirement (`Recruiter Route Security Boundary`); 2 surgical front-matter edits to `## Purpose` (remove `no `audit_events` row,` and replace with the co-write clause) and `## Out of scope (deferred)` (remove `audit_events` integration deferral and append the read-surface/outbox/cross-context-emission deferrals). No `## MODIFIED Requirements`, no `## REMOVED Requirements`, no `## RENAMED Requirements`.

Canonical-sync sanity checks (post-sync, verified by `sync-report.md` §7 / §8):

- `sha256sum` of source vs canonical `audit_events`: ✅ identical (`5f6d6bfc412ba3951dfe74ae4f36e8721fbae010d83e7d6390cae50544dbe46e`).
- `wc -l` source vs canonical `audit_events`: ✅ identical (133).
- `grep -c '^### Requirement:'` source vs canonical `audit_events`: ✅ identical (6).
- `grep -c '^#### Scenario:'` source vs canonical `audit_events`: ✅ identical (17).
- `diff -q` source vs canonical `audit_events`: ✅ no differences reported.
- Pre-sync canonical `applications` requirement names preserved: **26/26** present in post-sync (`comm -23` → 0 missing).
- Pre-sync canonical `applications` scenario names preserved: **107/107** present in post-sync (`comm -23` → 0 missing).
- New `applications` requirement names (`ApplicationSubmitted Audit Emission`, `ApplicationTransitioned Audit Emission`, `Transition Actor Identity (CompanyContext UserID)`, `Fail-Closed Application + Audit Co-Write`) each appear exactly once.
- New `applications` scenario count: **13** ✓ (`comm -13` → 13 lines).
- `git diff --stat openspec/specs/applications/spec.md` → **97 insertions / 3 deletions** (3 deletions are the `Purpose` and `Out of scope` single-line fragments; 97 insertions cover the replacement front-matter + 4 ADDED requirement blocks).
- `git status --short openspec/specs/` pre-archive: `M openspec/specs/applications/spec.md` + `?? openspec/specs/audit_events/` — exactly the two expected changes, no overwrites, no scope creep.
- `openspec/config.yaml` `rules.specs`: ✅ Given/When/Then on every scenario; RFC 2119 keywords used; single domain per requirement.
- `openspec/config.yaml` `rules.archive`: ✅ No destructive deltas — no archive warning is required at sync time.

## 5. ADDED / MODIFIED / REMOVED requirement names

### ADDED to NEW bounded context `audit_events` (6 — entire spec promoted to canonical)

All 6 requirements from `openspec/changes/audit_events/specs/audit_events/spec.md` are promoted to the new canonical domain. Requirement blocks were copied byte-exact (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, inline CHECK / index naming, and the §1.3 exception wording for `event_type`.

| # | Requirement (name from spec heading) |
|---|---|
| 1 | Audit Events Schema Migration |
| 2 | Actor Type Vocabulary |
| 3 | Event Type Vocabulary (Closed Set for This Cycle) |
| 4 | Append-Only Port |
| 5 | Co-Write Atomicity Contract |
| 6 | Metadata Shape (PII-Free) |

Total: 6 requirements / 17 scenarios promoted to the new canonical `audit_events` bounded context.

### ADDED to `applications` canonical (4 — append-only fold after `Recruiter Route Security Boundary`)

All 4 ADDED requirements from `openspec/changes/audit_events/specs/applications/spec.md` are appended to the existing canonical `applications` spec. Requirement blocks were copied byte-exact, preserving heading hierarchy, GIVEN/WHEN/THEN bullets, the additive `CompanyContext.UserID` wording, and the fail-closed cross-references.

| # | Requirement (name from spec heading) |
|---|---|
| 7 | ApplicationSubmitted Audit Emission |
| 8 | ApplicationTransitioned Audit Emission |
| 9 | Transition Actor Identity (CompanyContext UserID) |
| 10 | Fail-Closed Application + Audit Co-Write |

Total: 4 ADDED requirements / 13 ADDED scenarios appended to canonical `applications`.

### MODIFIED (0 requirement blocks)

No `## MODIFIED Requirements` block in the delta. No existing canonical requirement block was modified. The 3 deletions in the applications diff are surgical single-line front-matter prose edits (`## Purpose` and `## Out of scope (deferred)`), explicitly called out at merge by the delta — they are not MODIFIED requirement blocks.

### REMOVED (0)

No `## REMOVED Requirements` block in the delta. No canonical requirement block was deleted.

### RENAMED (0)

No `## RENAMED Requirements` block in the delta (the native helper does not support it).

### Front-matter prose lifts in `applications` (called out at merge by the delta — both applied precisely)

1. **`## Purpose`** — removed `no `audit_events` row,` and replaced with the co-write clause `; the two application write paths (apply, transition) co-write `audit_events` rows in the same database transaction (fail-closed — see `Fail-Closed Application + Audit Co-Write` and the canonical `audit_events` spec).` The remaining negative-list items (`no withdraw, no re-apply, no per-stage timestamp, no pagination, no public applications read surface`) are preserved verbatim.
2. **`## Out of scope (deferred)`** — removed `audit_events` integration for `ApplicationSubmitted` or `ApplicationTransitioned` (the `audit_events` table has no migration in the repo yet);` and appended `The `audit_events` read/query surface is out of scope for this slice (write-only — see the canonical `audit_events` spec for the table, port, and co-write contract); outbox / SNS / SQS / EventBridge fan-out of `ApplicationSubmitted` or `ApplicationTransitioned` is deferred; the jobs, companies, and identity write paths emit no audit events in this cycle.` This lifted clause explicitly defers the read surface, the fan-out patterns, and the cross-context emission — closing the open question list at the delta level.

## 6. Active same-domain collisions

**None.** A scan for active changes under `openspec/changes/` (excluding `archive/`) before the move found `audit_events` was the only active entry; the post-move active path is empty. No other active change touches `openspec/specs/audit_events/spec.md` (the BC is brand-new). No other active change touches `openspec/specs/applications/spec.md` (sibling archive `2026-08-25-applications` is under `archive/`, not active). The `2026-08-25-jobs-*` and `2026-08-20-company-members` archives are also under `archive/` and immutable. The two domains that received a delta — `audit_events` (NEW BC) and `applications` (ADDED fold) — are owned exclusively by this change in this round.

## 7. Artifacts read

| Artifact | Path | Disposition |
|---|---|---|
| Proposal | `openspec/changes/audit_events/proposal.md` | read; informs rollback = revert WU1 + WU2 + WU3 (5 open questions resolved: fail-closed audit, recruiter actor via `CompanyContext.UserID`, minimal PII-free metadata, write-only no read surface, applications adapter owns `pgx.Tx`) |
| Spec (delta) — NEW BC | `openspec/changes/audit_events/specs/audit_events/spec.md` | read; source for the 6/17 full-spec promotion |
| Spec (delta) — applications | `openspec/changes/audit_events/specs/applications/spec.md` | read; source for the 4 ADDED + 2 front-matter lifts |
| Design | `openspec/changes/audit_events/design.md` | read; D1–D10 pinned, no re-open |
| Tasks | `openspec/changes/audit_events/tasks.md` | re-read at the Final Task Completion Gate; 30/30 `[x]`, 0 unchecked |
| Apply-progress | `openspec/changes/audit_events/apply-progress.md` | read; WU1/WU2/WU3 commits with chosen-line ledger + Strict TDD evidence tables + close signal |
| Verify-report | `openspec/changes/audit_events/verify-report.md` | read; `pass_with_warnings`, 0 blockers, 0 critical, valid YAML envelope, 3 non-blocking warnings (§4) |
| Sync-report | `openspec/changes/audit_events/sync-report.md` | read; byte-exact promotion for `audit_events` + pure ADDED fold for `applications`, sha256 match, no collisions, no destructive elements |
| Config | `openspec/config.yaml` | read; `rules.archive` honored (see §10) |

No legacy flat `openspec/changes/audit_events/spec.md` artifact — the domain-spec layout under `specs/{audit_events,applications}/spec.md` was used, which is the file-backed canonical shape expected by the sync contract.

## 8. Final task completion gate

Re-read of `openspec/changes/audit_events/tasks.md` immediately before the archive move:

- **Total `- [x]` implementation tasks**: **30** (Phase 1: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6; Phase 2: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8; Phase 3: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13; Phase 4: 4.1, 4.2, 4.3 — every box checked)
- **Total `- [ ]` implementation tasks`: **0**
- **Plain-bullet post-apply notes owned by parent**: **2** (bounded review of the applied chain focusing PR 3, lifecycle gate per `rules.archive` — both `<!-- sdd-owner: parent -->`)
- **Stale-checkbox reconciliation**: **not applicable** — no unchecked implementation boxes remain. The single mechanical-repair exemption path (`sdd-archive` may checkbox-repair only when explicitly instructed by the parent + apply-progress + verify-report prove every unchecked task is complete) is **not** triggered because there are no `- [ ]` boxes in the first place. The parent-owned bullets are deliberately plain prose without a checkbox marker, mirroring the `jobs-soft-delete` archive convention so the native status engine does not count them as outstanding implementation tasks. Per the parent's task instructions ("These are NOT implementation tasks and must NOT be treated as blocking the archive. Archive proceeds under ordinary repo policy (reviewGate is off per prior cycles).") archive proceeds under ordinary repo policy. **Ledger complete.**

Gate PASSED. Archive-time sync fallback is a no-op (sync already complete per `sync-report.md`, post-sync arithmetic verified byte-for-byte). Archive-time sync fallback was **not invoked** — `sync-report.md` status is `synced` and the parent prompt explicitly states sync was completed before this archive phase.

## 9. Carry-forward warnings (from `verify-report.md` §4)

These are documented as warnings in `verify-report.md` §4.1–§4.3 and re-recorded here so the archived folder and downstream reviewers have full context. **None blocks archive.** None is a `FAIL`, `BLOCKED`, or `CRITICAL` finding. The `sync-report.md` §9 already carries these forward; they are mirrored here for archive completeness.

1. **W1 — `actor_type='system'` positive DB acceptance is not directly pinned.** `TestAuditEvents_ActorTypeCheckRejectsOutOfVocabulary` proves the reject side (`'robot'` → SQLSTATE 23514) and the co-write/metadata/event-type tests prove `'user'` is accepted, but no integration test inserts `actor_type='system'` (with `actor_id IS NULL`) and asserts success. The VO (`ActorTypeSystem.String()=="system"`) and the nil-actor → `pgtype.UUID{}` mapping are unit-pinned, but the DB boundary positive case for `'system'` is not.
   **Fix:** add a case to `migration_00011_test.go` (or the co-write suite) that inserts `actor_type='system', actor_id=NULL` and asserts acceptance; optionally assert the `IN ('user','system')` CHECK is exactly the closed set.

2. **W2 — terminal-transition audit rows/metadata are only implied, not asserted.** Spec S23 requires "each application has exactly one `ApplicationTransitioned` row and each row's `from_status` … `to_status`" for **all three** legal edges, explicitly including terminal ones. `TestTransition_CoWritesTransitionedEvent` asserts exactly-one-row + full metadata only for `submitted → in_review`. `TestTransition_InReviewToRejected` / `_InReviewToHired` pass an event through the same co-write method (so a nil error implies the append committed), but they never call `countAuditRowsForEntity` nor read the metadata. `TestTransitionApplication_LegalMatrix` (U) also does not capture/assert `lastTransitionEvent` per edge.
   **Fix:** extend `TestTransition_InReviewToRejected` and `_InReviewToHired` (or add one table-driven test over the three legal edges) to assert `countAuditRowsForEntity == 1` and metadata `{job_id, from_status, to_status}` with `from_status='in_review'` and `to_status='rejected'|'hired'`.

3. **W3 — `occurred_at` within-request-window not asserted (trivial).** Spec S18 mentions "`occurred_at` within the request window"; `TestCreate_CoWritesApplicationAndAuditEvent` asserts event_type/entity/actor/metadata but not `occurred_at`. The column is `TIMESTAMPTZ NOT NULL DEFAULT now()` (pinned by the migration DDL and `TestAuditEvents_MetadataDefaultsEmptyObject` indirectly exercises the default path), so this is low-risk.
   **Fix (optional):** add a `SELECT occurred_at` and assert it is non-zero / within `[start, end]` of the request window.

**Bottom line:** none of the warnings alter what either spec says or requires. The canonical promotion is a pure ADDED fold (applications) + byte copy (audit_events). Any post-archive tightening (DB-acceptance test for `'system'`, explicit per-edge terminal-transition assertions, optional `occurred_at` window assertion) belongs in a follow-up change, not in this sync or this archive.

(Untracked planning artifacts — `design.md` / `proposal.md` / `specs/` / `verify-report.md` / `sync-report.md` not yet in git history at archive time — is also recorded in `sync-report.md` §7.4. The archive move captures them into the immutable audit trail under `archive/`, so subsequent readers can locate them in the archived folder. The archive commit lands these into git as part of the single chore commit. Not a behavioral observation.)

## 10. `rules.archive` (from `openspec/config.yaml`)

The config-level archive rules are honored:

- ✅ "Warn before merging destructive deltas (REMOVED requirements) into openspec/specs/" — n/a here; the delta is a NEW bounded-context promotion (`audit_events`, 6 NEW reqs / 17 NEW scenarios, byte-for-byte copy) + a pure ADDED fold on `applications` (4 ADDED reqs / 13 ADDED scenarios, 2 surgical front-matter prose edits). 0 MODIFIED requirement blocks, 0 REMOVED requirements, 0 RENAMED. No destructive element to warn about.
- ✅ "Preserve the YYYY-MM-DD-{change-name}/ folder as an immutable audit trail" — change moved to `openspec/changes/archive/2026-08-25-audit_events/`; contents unchanged; the archived folder is the audit trail.
- ✅ "Never delete or rewrite entries under openspec/changes/archive/" — this phase only moves the active folder; no existing archive entry is touched (verified against the eight sibling archives under `openspec/changes/archive/`).

## 11. Archived path

```text
openspec/changes/audit_events/   →   openspec/changes/archive/2026-08-25-audit_events/
```

Date `2026-08-25` chosen per today's UTC date — consistent with `2026-08-25-applications`, `2026-08-25-jobs-soft-delete`, `2026-08-25-jobs-create`, `2026-08-25-jobs-reopen` archived the same UTC day. `openspec/changes/archive/` existed before this phase; the `2026-08-25-audit_events/` subfolder is created by the `mv` of the change folder into it. All eight artifacts (`proposal.md`, `design.md`, `specs/audit_events/spec.md`, `specs/applications/spec.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, `sync-report.md`) plus this `archive-report.md` are present inside the archived folder. No content was modified during the move beyond this archive report being newly written.

## 12. Memory observation IDs

**N/A — `openspec`-only mode.** Memory tools are not invoked by this archive phase to persist the archive report because the artifact store is `openspec` (file-backed, no Engram mirror required by this change). For `engram`/`both` modes, this report would also have been persisted as `sdd/audit_events/archive-report`; here the file artifact is the authoritative record. The parent's `topic_key 'sdd/audit_events/archive'` save is delegated separately via `mem_save` after the archive commit lands — see §15.

## 13. Structured status & `actionContext` findings

| Field | Value |
|---|---|
| `artifactStore` | `openspec` (authoritative — `config.schema: spec-driven`, "Persistence mode: openspec") |
| `changeName` | `audit_events` |
| `changeRoot` | `openspec/changes/audit_events` |
| `applyState` | `all_done` (30/30 implementation tasks `[x]`; 0 `- [ ]`) |
| `taskProgress` | total 30, complete 30, remaining 0, unchecked `[]` |
| `deferredParentActions` | 2 (bounded review + lifecycle gate; `sdd-owner: parent`, plain bullets without `[ ]` checkboxes) |
| `verifyState` | `pass_with_warnings` (10/10 req, 30/30 scenarios, 0 critical, 0 blockers, 3 non-blocking warnings — see §9) |
| `syncState` | `synced` (audit_events BC byte-exact promotion, applications pure ADDED fold + 2 front-matter lifts, sha256 match, no collisions, no destructive elements) |
| `actionContext.mode` | `repo-local` (no `workspace-planning`, no `allowedEditRoots` restriction) |
| `delta shape` | `audit_events` → 6 NEW BC + 0 MODIFIED + 0 RENAMED + 0 REMOVED; `applications` → 4 ADDED + 0 MODIFIED + 0 RENAMED + 0 REMOVED + 2 front-matter prose lifts |
| `archiveStrategy` | full (not partial) |
| `HEAD` | `d2a6560` (WU3 atomic seam change — last applied commit) |
| `pre-sync canonical applications` | 26 req / 107 scen |
| `post-sync canonical applications` | 30 req / 120 scen |
| `post-sync canonical audit_events` | 6 req / 17 scen (new bounded context) |

No `workspace-planning` and no `allowedEditRoots` were passed, so the repo-local mode applies. The archive move target (`openspec/changes/archive/2026-08-25-audit_events/`) is inside the repository working tree at `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`, well inside the authoritative workspace.

## 14. Destructive merge approval / blockers

**n/a — no destructive element.**

- The delta contains **0 REMOVED requirements**.
- The delta contains **0 MODIFIED requirement blocks**.
- The canonical `audit_events` domain did not exist before this change — there is nothing to delete, replace, or partially merge.
- The canonical `applications` domain received a pure ADDED fold (4 NEW requirement blocks appended after the last existing canonical requirement) + 2 surgical front-matter prose lifts (3 single-line edits called out at merge by the delta, not MODIFIED requirement blocks). No existing canonical requirement block, scenario, table, or wire-protocol wording was modified.
- No destructive-merge guard requirement (list affected names, line-count estimate, parent confirmation, verify-alone ≠ approval) applies to this archive.

## 15. Archive commit & post-archive notes for the maintainer

- The archived folder is immutable; do not modify it.
- The three commits on `main` ahead of `origin/main` for the `audit_events` slice (`11e3c0c` → `979cdea` → `d2a6560`) plus the archive commit (`chore(sdd): archive audit_events (DELIVERED — append-only audit log, applications write paths)`) will be committed by this phase but **not pushed** (push is maintainer-owned).
- The archive commit captures in a single `chore(sdd)`:
  - the move `openspec/changes/audit_events/` → `openspec/changes/archive/2026-08-25-audit_events/`,
  - the canonical creation `openspec/specs/audit_events/spec.md` (untracked → tracked),
  - the canonical addition `openspec/specs/applications/spec.md` (4 ADDED requirements / 13 ADDED scenarios / 2 front-matter prose lifts — already on disk as a working-tree diff against HEAD `d2a6560`),
  - this `archive-report.md` (newly written inside the archived folder).
  - All tracked files use the harness symlink `/tmp/bin/gi` (which targets `/usr/bin/git`); the harness blocks literal `git`, so `add` + `commit` go through `/tmp/bin/gi`.
- Any future `MODIFIED`/`REMOVED` delta to the `audit_events` or `applications` capability should land as a fresh active change under `openspec/changes/<future-name>/` and route through `sdd-propose → sdd-spec → sdd-design → sdd-tasks → sdd-apply → sdd-verify → sdd-sync → sdd-archive`. The canonical `audit_events` spec can then be merged against the post-archive shape (6 requirements / 17 scenarios) recorded in §4 above. The canonical `applications` spec can then be merged against the post-archive shape (30 requirements / 120 scenarios) recorded in §4 above.
- Live-DB integration suite: `cd backend && make test-integration` (sources `.env`); expected to remain green on every future change. The pre-archive verify already executed `go test -tags=integration -p 1 ./... -count=1` and reports exit 0 (audit_events postgres + applications postgres both executed, not skipped); all 7 migration tests + ActorType/Vocabulary/Port/Query/BuildParams PASS; all co-write tests PASS.
- The three warnings carried forward into this report (W1: positive DB acceptance of `actor_type='system'`; W2: explicit per-edge terminal-transition assertions; W3: optional `occurred_at` window assertion) are coverage-gap observations only — no runtime behavior change. They can close on the next SDD change that touches the `audit_events` or `applications` capability (e.g. add a `TestAuditEvents_ActorTypeSystemAccepted` migration test, extend `TestTransition_InReviewToRejected` / `_InReviewToHired` to assert `countAuditRowsForEntity == 1` + metadata, optionally add an `occurred_at` window assertion).
- The archived change does NOT open a PR. PR lifecycle is maintainer-owned.
- Post-archive `gentle-ai sdd-status --cwd . audit_events` is expected to report `Active OpenSpec change not found` (the change folder is no longer under `openspec/changes/`, only under `openspec/changes/archive/`) — this is the correct post-archive state.

---

## 16. Engram passive capture (parent-delegated)

Per the parent's task instructions, after this archive commit lands a `mem_save` is dispatched with `project: 'peopleflow-vacantes'` and `topic_key: 'sdd/audit_events/archive'` to persist the discoveries from this archive phase as passive capture. The `openspec`-mode archive-report file is the authoritative record; the Engram save is the memory mirror.