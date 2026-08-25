# Archive Report: `jobs-soft-delete`

- **status**: `archived`
- **change**: `jobs-soft-delete` (artifact store: `openspec`, file-backed)
- **archived to**: `openspec/changes/archive/2026-08-25-jobs-soft-delete/`
- **artifact store**: `openspec` (authoritative) — this report persisted to `openspec/changes/archive/2026-08-25-jobs-soft-delete/archive-report.md`

---

## 1. Verdict

The `jobs-soft-delete` change is archived. **Archive status: PASS.**

- `verify-report.md`: present, `verdict: pass`, `blockers: 0`, `critical_findings: 0`, `requirements: 3/3`, `scenarios: 31/31`. The YAML envelope is a valid `gentle-ai.verify-result/v1` block (`schema`, `evidence_revision`, `verdict`, `blockers`, `critical_findings`, `requirements`, `scenarios`, `test_command`, `test_exit_code: 0`, `test_output_hash`, `build_command`, `build_exit_code: 0`, `build_output_hash`). Three non-blocking observations carried forward into this report (see §9) — none are `FAIL`, `BLOCKED`, `CRITICAL`, or verification blockers.
- `sync-report.md`: present, status `synced`. Canonical `openspec/specs/jobs/spec.md` is **32 requirements / 155 scenarios** (29 + 3 ADDED = 32; 124 + 31 ADDED = 155), matching the verify-reported declared totals exactly. The canonical `Out of scope (deferred)` list no longer mentions `a soft-delete endpoint` (now DELIVERED) and the gated-subtree clause now references `DELETE /jobs/{id}` alongside the existing `POST`/`PATCH`.
- `tasks.md`: **17 `- [x]` implementation task lines, 0 `- [ ]` lines.** All ten phase-bound tasks plus 6 REFACTOR / verification / sealed-scope sub-tasks are checked. No DECIDED-SKIPs; no partial implementation. **No `sdd-apply` re-run is required and no mechanical checkbox repair was performed by this archive phase.**
- Delta shape: **3 ADDED + 0 MODIFIED + 0 RENAMED + 0 REMOVED.** Pure ADDED fold — the cleanest possible classification, no destructive edits to existing canonical content, no MODIFIED-block wholesale replacements, no obsolete-scenario removal. No additional destructive-merge approval was needed for archive beyond what `sync-report.md` already records.

## 2. Commit trace (A / B / C / D + docs)

Implementation landed as seven commits on `main` ahead of `origin/main` (`git log --oneline origin/main..HEAD` filters to the jobs-soft-delete slice):

| Commit | Hash | Type | Work unit |
|---|---|---|---|
| A | `cc9eb11` | `feat(jobs)` | soft-delete port contract, guard SQL, adapter, and use case — `softDeleteJob.go` + `softDeleteJob_test.go` + `jobs.sql` (D1 CTE guard) + sqlc regen (`jobs.sql.go`, `querier.go`) + `jobRepository.go` + `mapSoftDeleteError` / `buildSoftDeleteJobParams` + 5 stub repairs (D6 atomic port-extension unit) + `jobRepository_softDelete_test.go` (D2/D3 adapter unit tests) |
| B | `775066e` | `test(jobs)` | integration coverage for soft-delete guard and outcomes — `jobRepository_softDelete_integration_test.go` (build-tagged `//go:build integration`, 13 tests) |
| C | `1fb5fdb` | `feat(jobs)` | add `DELETE /jobs/{id}` soft-delete handler — `softDeleteJobHandler_test.go` + `jobHandler.go` (`softDeleteJob` + `JobHandlers.SoftDeleteJob`) |
| D | `e39e35c` | `feat(jobs)` | mount gated `DELETE /jobs/{id}` at the composition root — `main_test.go` (`TestJobsSoftDeleteRoute_MountedBehindGates` + `deletePathLiteral`) + `main.go` (one gated-DELETE route line) |
| (docs) | `37ac7db` | `docs(sdd)` | mark 6.1 verification complete in `jobs-soft-delete/tasks.md` (full-suite gate sealed) |
| (style) | `24099e2` | `style(jobs)` | gofmt integration test column alignment (`go fmt ./...` post-merge) |
| (docs) | `93fc17e` | `docs(sdd)` | mark 4.3 handler REFACTOR complete in `jobs-soft-delete/tasks.md` (handler hygiene sealed) |

This matches the work-unit commit map in `apply-progress.md` exactly. Tasks 1.1 → 2.3 land atomically inside Commit A (the accepted `jobs-create` D10 / `jobs-reopen` precedent: the package is compile-broken between the `jobs.sql` regen and the adapter `SoftDelete` rewrite; design §7 intro). Tasks 4.1–4.2 land together in Commit C; 5.1–5.2 land together in Commit D. Commit B is build-tagged integration coverage (RED and GREEN coincide, exactly as `jobs-create` Phase 7 and `jobs-reopen` Phase 4). Commits `37ac7db` and `93fc17e` are docs-only (tasks checkbox reconciliation to reflect completed REFACTOR / 6.1 work); `24099e2` is gofmt-only (style alignment on the 13-test integration suite).

## 3. Verification summary

| Field | Value |
|---|---|
| `schema` | `gentle-ai.verify-result/v1` |
| `evidence_revision` | `sha256:79bb50b3350e4aad606205fe05cade5473ea15da28e5dec514def836fc920214` |
| `verdict` | `pass` |
| `blockers` | `0` |
| `critical_findings` | `0` |
| `requirements` | `3/3` (the three ADDED delta requirements) |
| `scenarios` | `31/31` (S1–S31 of the delta) |
| `test_command` | `cd backend && go test ./... -count=1` → exit `0` |
| `test_output_hash` | `sha256:cbeb6156e9b0c37011dc59f80cdc951681b777255220c2923c2cee60df76e6d1` |
| `build_command` | `cd backend && go build ./...` → exit `0` |
| `build_output_hash` | `sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty output) |

Full gate green: 27 packages `go test -count=1 ./...` → exit 0; `go vet ./...` clean; `go vet -tags=integration ./internal/features/jobs/infrastructure/postgres/` clean (the 13-test integration file compiles under build tag); `gofmt -l` on every touched `.go` file empty; `go build ./...` exit 0; `go tool sqlc generate` idempotent (re-run → empty `git diff`). Live DB execution of the 13 integration tests is **deferred to the maintainer's `make test-integration` run with `DATABASE_URL` set** — this is the design-accepted environmental constraint, NOT a regression, and is recorded as carry-forward observation §9.2.

## 4. Canonical sync totals (post-sync)

| Artifact | Requirements | Scenarios |
|---|---|---|
| Canonical `openspec/specs/jobs/spec.md` (baseline, post `jobs-reopen` archive 2026-08-25) | 29 | 124 |
| Delta `openspec/changes/jobs-soft-delete/specs/jobs/spec.md` | 3 (all ADDED) | 31 (all ADDED, S1–S31) |
| Canonical post-sync | **32** | **155** |

Arithmetic verified:

- Requirements: 29 + 3 ADDED = **32** ✓
- Scenarios: 124 + 31 ADDED = **155** ✓

Canonical-sync sanity checks (post-sync, verified by `sync-report.md` §6):

- `a soft-delete endpoint` phrase in canonical `Out of scope (deferred)` = **0** ✓ (removed, now DELIVERED).
- `DELETE /jobs/{id}` referenced in canonical `Out of scope (deferred)` gated-subtree clause = **2** ✓ (one in the deferred-list enumeration of now-delivered endpoints, one in the new DELETE clause of the gated-write sentence).
- All 32 canonical requirement names are distinct (zero collisions via `sort | uniq -d`).
- Pre-existing 124 canonical scenarios preserved verbatim (the diff hunks on `openspec/specs/jobs/spec.md` are exclusively (a) the single Out-of-scope paragraph replacement and (b) the 3 appended requirement blocks; no existing scenario carries a `^[-+]` modification marker).
- `git diff --stat openspec/specs/jobs/spec.md` reports **210 insertions / 1 deletion** — the single deletion is the original Out-of-scope paragraph (one long line); 210 insertions cover the updated Out-of-scope paragraph + the 3 new requirement blocks (209 lines including separator).

## 5. ADDED / MODIFIED / REMOVED requirement names

### ADDED (3 — appended to canonical `jobs`)

1. **DELETE /jobs/{id} Endpoint, Gate, and Route Boundary** (9 scenarios: S1–S9)
2. **Soft-Delete Concurrency Controls** (11 scenarios: S10–S20)
3. **Soft-Delete Eligibility, Audit, and Read-Side Invariants** (11 scenarios: S21–S31)

Total: 3 requirements / 31 scenarios appended. Requirement blocks were copied byte-exact from the delta (no transcription), preserving heading hierarchy (`### Requirement:` / `#### Scenario:`), GIVEN/WHEN/THEN bullets, the inline D1 SQL CTE verbatim, and the cross-reference wording to canonical requirements — matching the precedent set by `jobs-reopen` and `jobs-create`.

### MODIFIED (0)

No `## MODIFIED Requirements` block in the delta. No existing canonical requirement block was modified.

### REMOVED (0)

No `## REMOVED Requirements` block in the delta. No canonical requirement block was deleted. The Out-of-scope paragraph in the canonical preamble was rewritten (single-line replacement), not a requirement deletion; the paragraph remains under the same heading and the deletion-then-insert line count is exactly 1-for-1.

### RENAMED (0)

No `## RENAMED Requirements` block in the delta (the native helper does not support it).

## 6. Active same-domain collisions

**None.** A scan for active changes under `openspec/changes/` (excluding `archive/`) before the move found `jobs-soft-delete` was the only active entry; the post-move active path is empty. No other active change touches `openspec/specs/jobs/spec.md`. Sibling archives touching the same `jobs` capability are:

- `2026-08-25-jobs-reopen` — predecessor PATCH-side delivery (re-open transitions + active-company update gate), archived the same day.
- `2026-08-25-jobs-create` — predecessor create-side delivery, archived the same day.
- `2026-08-24-jobs-write-side` — predecessor write-path plumbing (atomic `UpdateJob` guard foundation), archived 2 days prior.
- `2026-08-19-jobs` — the original canonical baseline.

All four are under `archive/` and immutable. The four new ADDED requirements are deliberately distinct from `jobs-reopen`'s names and from `jobs-create`'s names (e.g. this change's `Soft-Delete Concurrency Controls` vs `jobs-reopen`'s `Re-Open Inherits CAS and Same-Company Invariants`; this change's `Soft-Delete Eligibility, Audit, and Read-Side Invariants` vs `jobs-create`'s `Active Company Creation Gate`).

## 7. Artifacts read

| Artifact | Path | Disposition |
|---|---|---|
| Proposal | `openspec/changes/jobs-soft-delete/proposal.md` | read; informs rollback = revert Commits A–D |
| Spec (delta) | `openspec/changes/jobs-soft-delete/specs/jobs/spec.md` | read; source for the 3 ADDED requirements |
| Design | `openspec/changes/jobs-soft-delete/design.md` | read; D1–D9 pinned, no re-open |
| Tasks | `openspec/changes/jobs-soft-delete/tasks.md` | re-read at the Final Task Completion Gate; 17/17 `[x]`, 0 unchecked |
| Apply-progress | `openspec/changes/jobs-soft-delete/apply-progress.md` | read; Strict TDD evidence table present; size-exception record present |
| Verify-report | `openspec/changes/jobs-soft-delete/verify-report.md` | read; `pass`, 0 blockers, 0 critical, valid YAML envelope, three non-blocking observations |
| Sync-report | `openspec/changes/jobs-soft-delete/sync-report.md` | read; 3 ADDED + 0 MODIFIED + 0 RENAMED + 0 REMOVED, no collisions, byte-exact merge, no destructive elements |
| Config | `openspec/config.yaml` | read; `rules.archive` honored (see §10) |

No legacy flat `openspec/changes/jobs-soft-delete/spec.md` artifact — the domain-spec layout under `specs/jobs/spec.md` was used, which is the file-backed canonical shape expected by the sync contract.

## 8. Final task completion gate

Re-read of `openspec/changes/jobs-soft-delete/tasks.md` immediately before the archive move:

- **Total `- [x]` implementation tasks**: **17** (1.1 RED, 1.2 GREEN, 2.1 RED, 2.2 RED, 2.3 GREEN, 2.4 REFACTOR, 3.1 RED/GREEN, 4.1 RED, 4.2 GREEN, 4.3 REFACTOR, 5.1 RED, 5.2 GREEN, 6.1 verification — 13 implementation tasks across phases 1–5, plus 6.1 full-suite gate, plus the four REFACTOR sub-tasks 2.4 / 4.3 / 5.2 / 6.1 — every box checked)
- **Total `- [ ]` implementation tasks`: **0**
- **Plain-bullet post-apply notes owned by parent`: **2** (bounded review of the merged change + lifecycle gate — both `<!-- sdd-owner: parent -->`)
- **Stale-checkbox reconciliation**: **not applicable** — no unchecked implementation boxes remain. The single mechanical-repair exemption path (`sdd-archive` may checkbox-repair only when explicitly instructed by the parent + apply-progress + verify-report prove every unchecked task is complete) is **not** triggered because there are no `- [ ]` boxes in the first place. The Apply attempt ledger documents apply settled `passed` with reset authorized by maintainer (footprint 2663 > 1600; size-exception accepted); verify settled `complete`; ledger shows `complete` for the objective.

Gate PASSED. Archive-time sync fallback is a no-op (sync already complete per `sync-report.md`, post-sync arithmetic 29→32 / 124→155 verified).

## 9. Carry-forward observations (from `verify-report.md` §9)

These are documented as observations in `verify-report.md` §9.1–§9.4 and re-recorded here so the archived folder and downstream reviewers have full context. **None blocks archive.** None is a `FAIL`, `BLOCKED`, or `CRITICAL` finding.

1. **Public-mount DELETE returns chi 405, not the literal 404 in S9 (OBSERVATION — inherited spec wording).** The delta scenario S9 ("DELETE is not reachable through the public mount") says `404 not found`, but chi returns `405 Method Not Allowed` when the path (`/jobs/{id}`) is registered for GET but not DELETE. `TestSoftDeleteJob_DeleteNotServedByPublicMount` accepts 404 OR 405 and asserts the handler never ran (repo not called). This exactly mirrors the pre-existing `TestUpdateJob_PATCHNotServedByPublicMount` precedent (which documents the 405 nuance) — inherited spec wording, not a defect introduced by this delta.
2. **Live integration execution deferred (OBSERVATION — environmental constraint).** The 13 integration tests are build-tagged `//go:build integration` and compile clean under `go vet -tags=integration`, but are not executed in the verify environment (no `DATABASE_URL`). `make test-integration` is parent-owned. Consistent with the task's stated deferral and the `jobs-create` / `jobs-reopen` precedent — a design-accepted environmental constraint, not a regression.
3. **TDD evidence table naming (OBSERVATION — substance present, format deviates).** `apply-progress.md` uses a "Strict TDD evidence table" (Step | Task | RED evidence | GREEN evidence | Status) rather than the literal "TDD Cycle Evidence" title (RED / GREEN / TRIANGULATE / SAFETY NET / REFACTOR columns) the global `strict-tdd-verify` module expects. RED + GREEN substance is present per task and independently verified by `verify-report.md` §6 (Assertion quality, RED-first mechanism, RED compile break, test file cross-references). Format only — this is an **improvement** over `jobs-reopen`'s prose-only evidence, not a regression.

(Untracked planning artifacts — `design.md` / `proposal.md` / `specs/` not yet in git history at archive time — is also recorded in `verify-report.md` §9.4 and `sync-report.md` §7.4. The archive move captures them into the immutable audit trail under `archive/`, so subsequent readers can locate them in the archived folder. Not a behavioral observation.)

## 10. `rules.archive` (from `openspec/config.yaml`)

The config-level archive rules are honored:

- ✅ "Warn before merging destructive deltas (REMOVED requirements) into openspec/specs/" — n/a here; the delta is pure ADDED with 0 REMOVED and 0 MODIFIED blocks. No destructive element to warn about.
- ✅ "Preserve the YYYY-MM-DD-{change-name}/ folder as an immutable audit trail" — change moved to `openspec/changes/archive/2026-08-25-jobs-soft-delete/`; contents unchanged; the archived folder is the audit trail.
- ✅ "Never delete or rewrite entries under openspec/changes/archive/" — this phase only moves the active folder; no existing archive entry is touched.

## 11. Archived path

```text
openspec/changes/jobs-soft-delete/   →   openspec/changes/archive/2026-08-25-jobs-soft-delete/
```

Date `2026-08-25` chosen per the orchestrator handoff (UTC today — consistent with `2026-08-25-jobs-reopen` and `2026-08-25-jobs-create` archived the same UTC day). `openspec/changes/archive/` existed before this phase; the `2026-08-25-jobs-soft-delete/` subfolder is created by the `mv` of the change folder into it. All eight artifacts (`proposal.md`, `design.md`, `specs/jobs/spec.md`, `tasks.md`, `apply-progress.md`, `verify-report.md`, `sync-report.md`, this `archive-report.md`) are present inside the archived folder. No content was modified during the move beyond this archive report being newly written.

## 12. Memory observation IDs

**N/A — `openspec`-only mode.** Memory tools were not invoked because the artifact store is `openspec` (file-backed, no Engram mirror required by this change). For `engram`/`both` modes, this report would also have been persisted as `sdd/jobs-soft-delete/archive-report`; here the file artifact is the authoritative record.

## 13. Structured status & `actionContext` findings

| Field | Value |
|---|---|
| `artifactStore` | `openspec` (authoritative — `config.schema: spec-driven`, "Persistence mode: openspec") |
| `changeName` | `jobs-soft-delete` |
| `applyState` | `all_done` (17/17 implementation tasks `[x]`; 0 `- [ ]`) |
| `taskProgress` | total 17, complete 17, remaining 0, unchecked `[]` |
| `deferredParentActions` | 2 (bounded review + lifecycle gate; `sdd-owner: parent`) |
| `verifyState` | `pass` (3/3 req, 31/31 scenarios, 0 critical, 0 blockers, 3 non-blocking observations) |
| `syncState` | `synced` (3 ADDED + 0 MODIFIED + 0 RENAMED + 0 REMOVED; arithmetic 29→32 / 124→155 verified; no collisions; byte-exact merge; no destructive elements) |
| `actionContext.mode` | `repo-local` (no `workspace-planning`, no `allowedEditRoots` restriction) |
| `delta shape` | 3 ADDED + 0 MODIFIED + 0 RENAMED + 0 REMOVED |
| `archiveStrategy` | full (not partial) |
| `ledgerState` | apply attempt settled `passed` with reset authorized by maintainer (footprint 2663 > 1600, `size:exception` accepted — recorded in apply reset reason); verify attempt settled `complete`; ledger shows `complete` for the objective |

No `workspace-planning` and no `allowedEditRoots` were passed, so the repo-local mode applies. The archive move target (`openspec/changes/archive/2026-08-25-jobs-soft-delete/`) is inside the repository working tree at `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`, well inside the authoritative workspace.

## 14. Destructive merge approval / blockers

**n/a — no destructive element.**

- The delta contains **0 REMOVED requirements**.
- The delta contains **0 MODIFIED requirement blocks**.
- The canonical `Out of scope (deferred)` paragraph was rewritten (1-for-1 line replacement, no scenario or requirement deletion), but this is a prose update inside the canonical preamble — not a destructive-merge element under the destructive-merge guard's definition.
- No destructive-merge guard requirement (list affected names, line-count estimate, parent confirmation, verify-alone ≠ approval) applies to this archive.

## 15. Post-archive notes for the maintainer

- The archived folder is immutable; do not modify it.
- Any future `MODIFIED`/`REMOVED` delta to the `jobs` capability should land as a fresh active change under `openspec/changes/<future-name>/` and route through `sdd-propose → sdd-spec → sdd-design → sdd-tasks → sdd-apply → sdd-verify → sdd-sync → sdd-archive`. The canonical `jobs` spec can then be merged against the post-archive shape (32 requirements / 155 scenarios) recorded in §4 above.
- Live-DB integration suite: `cd backend && make test-integration` (sources `.env`); expected to close the only environmental verify-report observation §9.2 (build-tagged integration suite currently skips on `DATABASE_URL` unset). This is the design-accepted environmental constraint and does not block archive.
- The 7 commits on `main` ahead of `origin/main` for the `jobs-soft-delete` slice (`cc9eb11 → 775066e → 1fb5fdb → e39e35c → 37ac7db → 24099e2 → 93fc17e`) and the archive commit will be committed by this phase but **not pushed** (push is maintainer-owned).
- The three observations carried forward into this report (S9 chi 405 nuance; live integration suite deferred; TDD evidence table title) are documentation / process observations only — no runtime behavior change. They can close on the next SDD change that touches the `jobs` capability (e.g. reconcile S9 wording to explicitly say "404 or 405", opt into the TDD Cycle Evidence table format if a downstream agent requires it, run `make test-integration` once `DATABASE_URL` is provisioned).
- The archived change does NOT open a PR. PR lifecycle is maintainer-owned.