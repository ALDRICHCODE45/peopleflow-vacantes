# Archive Report: `jobs-reopen`

- **status**: `archived`
- **change**: `jobs-reopen` (artifact store: `openspec`, file-backed)
- **archived to**: `openspec/changes/archive/2026-08-25-jobs-reopen/`
- **artifact store**: `openspec` (authoritative) — this report persisted to `openspec/changes/archive/2026-08-25-jobs-reopen/archive-report.md`

---

## 1. Verdict

The `jobs-reopen` change is archived. **Archive status: PASS.**

- `verify-report.md`: present, `verdict: pass_with_warnings`, `blockers: 0`, `critical_findings: 0`, `requirements: 6/6`, `scenarios: 29/29`. The YAML envelope is a valid `gentle-ai.verify-result/v1` block (`schema`, `evidence_revision`, `verdict`, `blockers`, `critical_findings`, `requirements`, `scenarios`, `test_command`, `test_exit_code: 0`, `test_output_hash`, `build_command`, `build_exit_code: 0`, `build_output_hash`). Two non-blocking warnings carried forward into this report (see §9).
- `sync-report.md`: present, status `synced`. Canonical `openspec/specs/jobs/spec.md` is **29 requirements / 124 scenarios** (25 + 4 ADDED = 29; 106 + 16 ADDED + 3 MODIFIED-added − 1 obsolete removed = 124), matching the synced delta exactly. The obsolete `closed is terminal` scenario is gone from the canonical `Status Transition Table` requirement, the two `closed → {draft, published}` re-open scenarios are present, and the preamble's `Out of scope (deferred)` no longer lists re-opening a closed job.
- `tasks.md`: 17 `- [x]` implementation task lines, 0 `- [ ]` lines. The one DECIDED-SKIP (`5.1 REFACTOR` — comment-only doc refresh on `entities.ErrInvalidStatusTransition`) is explicitly marked compliant with the locked D8 inventory (`entities/job.go` is UNCHANGED per D8; per the locked-scope rule the apply agent honors that and leaves the file alone). Verified as a compliant skip by `apply-progress.md` "Deviations from `tasks.md`" and by `verify-report.md` observation #6. **No `sdd-apply` re-run is required and no mechanical checkbox repair was performed by this archive phase.**
- Delta shape: **4 ADDED + 2 MODIFIED + 0 RENAMED + 1 effectively-removed obsolete scenario** (removed by the wholesale MODIFIED replacement of the canonical `Status Transition Table` requirement block). The destructive element (one obsolete scenario inside a MODIFIED block) was explicitly approved by the parent prompt for the `sdd-sync` invocation that pre-deceded this archive; the verify report verified the post-sync arithmetic 25→29 / 106→124 holds. No additional destructive-merge approval was needed for archive beyond what `sync-report.md` already records.

## 2. Commit trace (A / B / C)

Implementation landed as four commits on `main` ahead of `origin/main` (`git log --oneline origin/main..HEAD`):

| Commit | Hash | Type | Work unit |
|---|---|---|---|
| A | `3f4594b` | `feat(jobs)` | re-open closed jobs via explicit status transition (D4/D5) — `updateJob.go` + `updateJob_test.go` |
| B | `cacb0dd` | `feat(jobs)` | gate PATCH updates on company activity via atomic `UpdateJob` guard (D1/D2/D7) — `jobs.sql` + sqlc regen (`jobs.sql.go`, `querier.go`) + `jobRepository.go` + `updateJobRepository_test.go` |
| C | `2a0fb22` | `test(jobs)` | integration coverage for re-open and the active-company update gate — `jobRepository_write_integration_test.go` (build-tagged `//go:build integration`) |
| (doc) | `0d88427` | `docs(sdd)` | apply-phase REFACTOR and verification checkboxes in `jobs-reopen/tasks.md` (5.1 reconciled; 4.x final-suite mark) |

This matches the work-unit commit map in `apply-progress.md` exactly. Tasks 2.1 → 2.2 → 2.3 land atomically inside Commit B (the package is compile-broken between the `jobs.sql` regen and the adapter `Update` rewrite; design §6 item 8). Tasks 1.1–1.6 land together in Commit A. Commit C is build-tagged integration coverage (RED and GREEN coincide, exactly as `jobs-create` Phase 7). Commit `0d88427` is docs-only (tasks checkbox reconciliation).

## 3. Verification summary

| Field | Value |
|---|---|
| `schema` | `gentle-ai.verify-result/v1` |
| `evidence_revision` | `sha256:5fb0467e7fe7332ad0dfbd253febdeccb7143aaf757862b1f4ff963541668fcd` |
| `verdict` | `pass_with_warnings` |
| `blockers` | `0` |
| `critical_findings` | `0` |
| `requirements` | `6/6` (the four ADDED + two MODIFIED delta requirements) |
| `scenarios` | `29/29` |
| `test_command` | `cd backend && go test ./... -count=1` → exit `0` |
| `test_output_hash` | `sha256:c7d1a317d426596637821420090bc572e8d98bbb020d7b007bedc88c4b8886db` |
| `build_command` | `cd backend && go build ./...` → exit `0` |
| `build_output_hash` | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty output) |

26/26 unit tests green (`go test ./...`); `go vet ./...` clean; `gofmt -l` on every touched file empty; `go build ./...` clean; `go tool sqlc generate` idempotent (D7 verified — second run produces no diff). Integration suite (`make test-integration`, build-tagged `//go:build integration`) compiles clean (`go vet -tags=integration ./internal/features/jobs/infrastructure/postgres/`) but is **deferred to the maintainer's live-DB run with `DATABASE_URL` set** — this is the design-accepted environmental constraint, NOT a regression. Live execution of the 8 integration tests will close the only environmental warning on the next `make test-integration` run.

## 4. Canonical sync totals (post-sync)

| Artifact | Requirements | Scenarios |
|---|---|---|
| Canonical `openspec/specs/jobs/spec.md` (baseline, post `jobs-create` archive 2026-08-25) | 25 | 106 |
| Delta `openspec/changes/jobs-reopen/specs/jobs/spec.md` | 6 (4 ADDED + 2 MODIFIED) | 29 (16 ADDED + 13 MODIFIED, of which 3 are net-new after MODIFIED replacement and 1 obsolete is removed) |
| Canonical post-sync | **29** | **124** |

Arithmetic verified:

- Requirements: 25 + 4 ADDED = **29** ✓
- Scenarios: 106 + 16 ADDED + 3 MODIFIED-added − 1 obsolete removed = **124** ✓

Canonical-sync sanity checks (post-sync, verified by `sync-report.md` §8):

- Obsolete `closed is terminal` scenario (the one removed) absent from the live `Status Transition Table` requirement block.
- New `closed → draft re-open is allowed (NEW — replaces the obsolete "closed is terminal" scenario)` scenario present (1×).
- New `closed → published re-open is allowed (NEW — replaces the obsolete "closed is terminal" scenario)` scenario present (1×).
- New `409 company is not active` row in `Error Taxonomy` present (1×).
- `re-opening a closed job` line in `Out of scope (deferred)` absent (0×).
- `closed terminal` wording in canonical preamble absent (0×).
- All 29 canonical requirement names are distinct (zero collisions via `sort | uniq -d`).

## 5. ADDED / MODIFIED / REMOVED requirement names

### ADDED (4 — appended to canonical `jobs`)

1. **Re-Open Transitions** (5 scenarios: S1–S5)
2. **Re-Open + Field Edits Apply Atomically** (4 scenarios: S6–S9)
3. **Active-Company Update Gate** (4 scenarios: S10–S13)
4. **Re-Open Inherits CAS and Same-Company Invariants** (3 scenarios: S14–S16)

Total: 4 requirements / 16 scenarios appended. Names are deliberately distinct from `jobs-create` (`Active-Company Update Gate` vs `Active Company Creation Gate`).

### MODIFIED (2 — wholesale block replacement on canonical `jobs`)

| # | Requirement | Before | After | Δ scenarios |
|---|---|---|---|---|
| 1 | **Status Transition Table** | 8 scenarios (incl. obsolete `closed is terminal`) | 9 scenarios (drops the obsolete scenario; adds 2 new re-open scenarios) | +1 net — −1 obsolete, +2 new |
| 2 | **Error Taxonomy** | 3 scenarios | 4 scenarios | +1 net — adds `409 company is not active` |

Net scenario change from MODIFIED blocks: **+2 scenarios**. Both `(Previously: …)` provenance sentences are preserved on the replaced canonical blocks so future readers can see what changed.

### REMOVED (0)

No `## REMOVED Requirements` block in the delta. One scenario is **removed-by-replacement** (the obsolete `closed is terminal` scenario inside the `Status Transition Table` requirement, dropped by the wholesale MODIFIED replacement above). The destructive element was explicitly approved by the parent prompt for `sdd-sync` and is recorded in `sync-report.md` §1.

### RENAMED (0)

No `## RENAMED Requirements` block in the delta (the native helper does not support it).

## 6. Active same-domain collisions

**None.** `jobs-reopen` is the only active change under `openspec/changes/` (the active path was empty after the move; only `archive/` remains under `openspec/changes/`). A scan for `### Requirement:` headings across all archive specs found only the post-sync canonical `openspec/specs/jobs/spec.md`. No other active change touches `openspec/specs/jobs/spec.md`. Sibling archives touching the same `jobs` capability are: `2026-08-25-jobs-create` (predecessor create-side delivery, archived the day prior), `2026-08-24-jobs-write-side` (predecessor PATCH-side delivery, archived 2 days prior), `2026-08-19-jobs` (the original canonical baseline). All are under `archive/` and immutable.

## 7. Artifacts read

| Artifact | Path | Disposition |
|---|---|---|
| Proposal | `openspec/changes/jobs-reopen/proposal.md` | read; informs rollback = revert Commit A (closed terminality) or Commits A+B (also reverts the gate) |
| Spec (delta) | `openspec/changes/jobs-reopen/specs/jobs/spec.md` | read; source for the 4 ADDED + 2 MODIFIED requirements |
| Design | `openspec/changes/jobs-reopen/design.md` | read; D1–D8 pinned, no re-open |
| Tasks | `openspec/changes/jobs-reopen/tasks.md` | re-read at the Final Task Completion Gate; 17/17 `[x]`, 0 unchecked; 5.1 marked DECIDED-SKIP with rationale |
| Apply-progress | `openspec/changes/jobs-reopen/apply-progress.md` | read; size-exception record present (single-pr with maintainer-accepted `size:exception` for the 400-line review budget risk) |
| Verify-report | `openspec/changes/jobs-reopen/verify-report.md` | read; `pass_with_warnings`, 0 blockers, 0 critical, valid YAML envelope, two non-blocking warnings |
| Sync-report | `openspec/changes/jobs-reopen/sync-report.md` | read; 4 ADDED + 2 MODIFIED + 0 RENAMED + 1 obsolete-scenario removed, no collisions, byte-exact merge, parent-prompt destructive-sync approval recorded |
| Config | `openspec/config.yaml` | read; `rules.archive` honored (see §10) |

No legacy flat `openspec/changes/jobs-reopen/spec.md` artifact — the domain-spec layout under `specs/jobs/spec.md` was used, which is the file-backed canonical shape expected by the sync contract.

## 8. Final task completion gate

Re-read of `openspec/changes/jobs-reopen/tasks.md` immediately before the archive move:

- **Total `- [x]` implementation tasks**: **17**
- **Total `- [ ]` implementation tasks`: **0**
- **Plain-bullet post-apply notes owned by parent`: **2** (bounded review + lifecycle gate; both `<!-- sdd-owner: parent -->`)
- **Stale-checkbox reconciliation**: not applicable — no unchecked implementation boxes remain. The single DECIDED-SKIP (`5.1 REFACTOR` — comment-only doc refresh on `entities.ErrInvalidStatusTransition`) is explicitly compliant with the locked D8 inventory — `entities/job.go` is UNCHANGED in D8's file list, so per the locked-scope rule the apply agent honors that and leaves the file alone. This is **not** a stale-checkbox reconciliation performed by the archive phase; it is the apply phase honoring a pre-locked scope decision documented in `tasks.md` itself, in `apply-progress.md` "Deviations from `tasks.md`", and confirmed as compliant by `verify-report.md` observation #6.

Gate PASSED. Archive-time sync fallback is a no-op (sync already complete per `sync-report.md`).

## 9. Carry-forward warnings (from `verify-report.md` §9)

These are documented as warnings in `verify-report.md` §9.1 and §9.2 and re-recorded here so the archived folder and downstream reviewers have full context. **Neither blocks archive.**

1. **D8 file-count drift (WARNING — bookkeeping only).** Design §2 ("4 authored files + 2 generated") and tasks.md / apply-progress ("4 authored files + 2 generated files") undercount. Design §3 D8 itself enumerates **5** authored files and omits `updateJobRepository_test.go`; tasks 2.1 and Commit B modify that file. Actual authored files = **6** (`updateJob.go`, `updateJob_test.go`, `jobs.sql`, `jobRepository.go`, `updateJobRepository_test.go`, `jobRepository_write_integration_test.go`) + **2 generated** (`jobs.sql.go`, `querier.go`). **No forbidden-file leak**: handler / DTO / port / entities / main / migrations are untouched. Bookkeeping drift only.

2. **Strict-TDD evidence format (WARNING — substance present, format deviates).** `apply-progress.md` reports TDD evidence as prose "RED before GREEN" output blocks rather than the literal "TDD Cycle Evidence" table (RED / GREEN / TRIANGULATE / SAFETY NET / REFACTOR columns) the global `strict-tdd-verify` module expects. Substance is present and cross-referenced against the committed code (RED failure messages match committed test code exactly; RED compile break verified; test files cross-referenced by name and count). Substance is independently verified by `verify-report.md` §6 (Assertion quality, RED-first mechanism, RED compile break, test file cross-references). Format only.

Both warnings are also recorded in `sync-report.md` §9 ("Warnings carried forward from verify-report"). Neither blocks archive; both close on future maintenance hygiene passes (next SDD change that touches the `jobs` capability should reconcile D8's file inventory; future TDD work can opt into the table format if a downstream agent requires it).

## 10. `rules.archive` (from `openspec/config.yaml`)

The config-level archive rules are honored:

- ✅ "Warn before merging destructive deltas (REMOVED requirements) into openspec/specs/" — `sync-report.md` §1 records the parent prompt's explicit approval for the one removed-by-replacement obsolete scenario inside the MODIFIED `Status Transition Table` block. The destructive-delta warning was honored at sync time; archive carries that decision forward.
- ✅ "Preserve the YYYY-MM-DD-{change-name}/ folder as an immutable audit trail" — change moved to `openspec/changes/archive/2026-08-25-jobs-reopen/`; contents unchanged; the archived folder is the audit trail.
- ✅ "Never delete or rewrite entries under openspec/changes/archive/" — this phase only moves the active folder; no existing archive entry is touched.

## 11. Archived path

```text
openspec/changes/jobs-reopen/   →   openspec/changes/archive/2026-08-25-jobs-reopen/
```

Date `2026-08-25` chosen per the orchestrator handoff (UTC today). `openspec/changes/archive/` existed before this phase; the `2026-08-25-jobs-reopen/` subfolder was created by the `mv` of the change folder into it. All seven artifacts (`proposal.md`, `design.md`, `specs/jobs/spec.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, `sync-report.md`) are present inside the archived folder, plus this `archive-report.md`. No content was modified during the move.

## 12. Memory observation IDs

**N/A — `openspec`-only mode.** Memory tools were not invoked because the artifact store is `openspec` (file-backed, no Engram mirror required by this change). For `engram`/`both` modes, this report would also have been persisted as `sdd/jobs-reopen/archive-report`; here the file artifact is the authoritative record.

## 13. Structured status & `actionContext` findings

| Field | Value |
|---|---|
| `artifactStore` | `openspec` (authoritative — `config.schema: spec-driven`, "Persistence mode: openspec") |
| `changeName` | `jobs-reopen` |
| `applyState` | `all_done` (17/17 implementation tasks `[x]`; 0 `- [ ]`) |
| `taskProgress` | total 17, complete 17, remaining 0, unchecked `[]` |
| `deferredParentActions` | 2 (bounded review + lifecycle gate; `sdd-owner: parent`) |
| `verifyState` | `pass_with_warnings` (6/6 req, 29/29 scenarios, 0 critical, 0 blockers, 2 non-blocking warnings) |
| `syncState` | `synced` (4 ADDED + 2 MODIFIED + 0 RENAMED + 1 obsolete-scenario removed; arithmetic 25→29 / 106→124 verified; no collisions; byte-exact merge; destructive-sync approval recorded) |
| `actionContext.mode` | `repo-local` (no `workspace-planning`, no `allowedEditRoots` restriction) |
| `delta shape` | 4 ADDED + 2 MODIFIED + 0 RENAMED + 1 obsolete scenario removed by MODIFIED replacement |
| `archiveStrategy` | full (not partial) |
| `ledgerState` | apply attempt settled `passed` with reset authorized by maintainer (footprint 1565 > 1200, `size:exception` accepted); verify attempt settled `complete`; ledger shows `complete` for the objective |

No `workspace-planning` and no `allowedEditRoots` were passed, so the repo-local mode applies. The archive move target (`openspec/changes/archive/2026-08-25-jobs-reopen/`) is inside the repository working tree at `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`, well inside the authoritative workspace.

## 14. Destructive merge approval / blockers

**Already resolved at sync time — no archive-time blocker.**

- The delta contains **0 REMOVED requirements** (no `## REMOVED Requirements` block).
- The delta contains **1 effectively-removed scenario** (the obsolete `closed is terminal` scenario inside the MODIFIED `Status Transition Table` requirement, dropped by the wholesale MODIFIED replacement).
- The MODIFIED `Status Transition Table` block is the **largest MODIFIED replacement** in the delta: ~9 scenarios replacing ~8, with one obsolete scenario dropped and two new re-open scenarios added. Net line impact is small (one scenario + two new scenarios − one obsolete), so the destructive-merge guard's "large MODIFIED block" threshold is not crossed.
- The destructive element was **explicitly approved by the parent prompt for the `sdd-sync` invocation** that pre-deceded this archive. `sync-report.md` §1 records the approval. The verify report verified the post-sync arithmetic 25→29 / 106→124 holds. No additional destructive-merge approval was needed for archive beyond what `sync-report.md` already records.

The destructive-merge guard requirements (list affected names, line-count estimate, parent confirmation, verify-alone ≠ approval) are satisfied:

| Guard requirement | Satisfied by |
|---|---|
| List affected requirement names | Status Transition Table (1 MODIFIED, no REMOVED) — listed above |
| Summarize approximate removed/replaced line count | 1 obsolete scenario removed; ~9 scenarios replace ~8 in the canonical block |
| Warn the parent/orchestrator | `sync-report.md` §1 records the warning + parent-prompt approval |
| Verify-alone is not approval | Parent-prompt explicit approval recorded separately in `sync-report.md` §1 |
| Continue only if approved | Parent prompt approved; archive proceeds |

## 15. Post-archive notes for the maintainer

- The archived folder is immutable; do not modify it.
- Any future `MODIFIED`/`REMOVED` delta to the `jobs` capability should land as a fresh active change under `openspec/changes/<future-name>/` and route through `sdd-propose → sdd-spec → sdd-design → sdd-tasks → sdd-apply → sdd-verify → sdd-sync → sdd-archive`. The canonical `jobs` spec can then be merged against the post-archive shape (29 requirements / 124 scenarios) recorded in §4 above.
- Live-DB integration suite: `cd backend && make test-integration` (sources `.env`); expected to close the only environmental verify-report warning (build-tagged integration suite currently skips on `DATABASE_URL` unset). This is the design-accepted environmental constraint and does not block archive.
- The 4 commits on `main` ahead of `origin/main` (`3f4594b → cacb0dd → 2a0fb22 → 0d88427`) and the archive commit will be committed by this phase but **not pushed** (push is maintainer-owned).
- The two warnings carried forward into this report (D8 file-count drift; strict-TDD evidence format) are bookkeeping / format drift only — no runtime behavior change. They can close on the next SDD change that touches the `jobs` capability (reconcile D8's file inventory; opt into the TDD Cycle Evidence table format if a downstream agent requires it).
- The archived change does NOT open a PR. PR lifecycle is maintainer-owned.
