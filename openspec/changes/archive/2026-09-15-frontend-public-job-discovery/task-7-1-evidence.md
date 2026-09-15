# Task 7.1 evidence — recovered frontend candidate boundaries

- Change: `frontend-public-job-discovery`
- Branch / clean baseline: `recovery/frontend-public-job-discovery-tdd` at `26bd8d4`
- Audit range: `458850d12d1ab0a876965e863dc75b95b95fab01..26bd8d4`
- Commits audited: **29** (verified via `git rev-list --count 458850d1..26bd8d4`)
- Aggregate range `git diff --shortstat 458850d1..26bd8d4`: **29 files changed, 2095 insertions(+), 163 deletions(-)**
- Frontend-only subset `git diff --shortstat 458850d1..26bd8d4 -- frontend/`: 24 files / 1820 insertions / 154 deletions
- Tree / index: clean (`git status --porcelain` and `git diff --check` both empty)
- Late-evidence objects observed: `task-6-3-evidence.md` (committed at `3cfff3c`, 32 lines) and `task-6-4-evidence.md` (committed at `26bd8d4`, 33 lines) — both are the recovered-task-7.1 boundary-evidence pattern being retroactively authored and closed in this unit
- Reproduction selector for the audit itself: `git log --reverse --no-patch --format='%h %s' 458850d12d1ab0a876965e863dc75b95b95fab01..26bd8d4` and `git show --numstat <hash>` for any commit below

## Audit table — 29 commits (oldest → newest)

Hash below is the short hash; full hash is `git rev-parse <short>`. Additions/deletions are the per-commit `git show --numstat` totals. `+` = insertions, `−` = deletions.

| # | Hash | Subject | Class | +/− | Paths | Evidence pointer | Rollback boundary |
| - | ---- | ------- | ----- | --- | ----- | ---------------- | ----------------- |
| 1 | `b169af4` | test(frontend): define public listing visual foundation | RED | 78 / 9 | `frontend/src/app/(public)/vacantes/page.test.tsx`, `frontend/src/app/globals.css.test.ts`, `frontend/src/components/shells/PublicShell.test.tsx`, `frontend/tests/e2e/vacantes.spec.ts` | GREEN at #2; foundation RED for Tasks 4.x list surface | `git revert b169af4` removes only these four test files; revert before #2 |
| 2 | `93b1d28` | feat(frontend): establish public listing visual foundation | GREEN | 124 / 46 | `frontend/src/app/(public)/vacantes/page.tsx` (23/14), `frontend/src/app/globals.css` (45/5), `frontend/src/components/shells/PublicShell.tsx` (45/27), `openspec/changes/frontend-public-job-discovery/apply-progress.md` (11/0) | Implements the RED surface from #1; formatting drift left for #3 | `git revert 93b1d28` removes the GREEN source plus its 11-line apply-progress evidence; revert before #3 |
| 3 | `387df7c` | style(frontend): normalize recovered visual formatting | REFACTOR (formatting-only) | 50 / 50 | `frontend/src/app/(public)/vacantes/page.test.tsx` (20/20), `frontend/src/app/(public)/vacantes/page.tsx` (23/23), `frontend/tests/e2e/vacantes.spec.ts` (7/7) | **`git diff -w 387df7c^..387df7c` is empty → 100% whitespace-only.** Equal adds/dels across all three files confirm a pure formatter rewrite | `git revert 387df7c` restores pre-formatting bytes; revert before #4 |
| 4 | `7593549` | test(frontend): define public job navigation chip and search form contracts | RED | 128 / 3 | `frontend/src/app/(public)/vacantes/page.test.tsx` (123/1), `frontend/tests/e2e/vacantes.spec.ts` (5/2) | Defines navigation/search RED contract for Task 4.2 nav island | `git revert 7593549` removes only the navigation chip+search test additions; revert before #5 |
| 5 | `55612d3` | feat(frontend): compose search and filter navigation | GREEN | 238 / 42 | `frontend/src/features/jobs/components/JobsNavigationIsland.tsx` (179/42), `openspec/changes/frontend-public-job-discovery/apply-progress.md` (59/0) | Realizes nav island and filter controls from #4 | `git revert 55612d3` removes `JobsNavigationIsland.tsx` and the 59-line evidence section; revert before #6 |
| 6 | `5f2f6b9` | fix(openspec): compress navigation replay evidence to ≤40 lines | Documentary correction | 37 / 59 | `frontend/src/app/(public)/vacantes/page.test.tsx` (10/10), `frontend/src/features/jobs/components/JobsNavigationIsland.tsx` (6/6), `openspec/changes/frontend-public-job-discovery/apply-progress.md` (21/43) | Net −22 lines on `apply-progress.md`; the two frontend files are formatter rewrites (`git diff -w` confirms). Correction descendant of #5's evidence | `git revert 5f2f6b9` restores the compressed-out lines; revert before #7 |
| 7 | `25e1069` | docs(openspec): correct navigation replay accounting | Documentary correction | 2 / 2 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` | Adds correct accounting pointer after #6's compression | `git revert 25e1069` removes only the 2/2 accounting correction; revert before #8 |
| 8 | `91e43fa` | test(frontend): define API-backed vacancy card contracts | RED | 84 / 3 | `frontend/tests/e2e/vacantes-a11y.spec.ts` (3/3), `frontend/tests/e2e/vacantes.spec.ts` (81/0) | API-backed card contract tests; precedes #9 | `git revert 91e43fa` removes the card test additions; revert before #9 |
| 9 | `c1ef947` | feat(frontend): surface API-backed vacancy cards | GREEN | 101 / 38 | `frontend/src/features/jobs/components/JobsResults.tsx` (65/38), `openspec/changes/frontend-public-job-discovery/apply-progress.md` (36/0) | Implements `JobsResults` per the #8 contract | `git revert c1ef947` removes `JobsResults.tsx` + 36-line evidence; revert before #10 |
| 10 | `14ffb25` | docs(openspec): correct API card replay evidence | Documentary correction descendant | 11 / 7 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` | First of three accounting corrections to #9's evidence | `git revert 14ffb25` removes 11/7; revert before #11 |
| 11 | `f631b1d` | docs(openspec): finalize API card replay accounting | Documentary correction descendant | 6 / 5 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` | Second of three accounting corrections; converges the API-card evidence | `git revert f631b1d` removes 6/5; revert before #12 |
| 12 | `950714f` | docs(openspec): record stable API card replay total | Documentary correction descendant | 2 / 2 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` | Third of three accounting corrections; locks the stable total | `git revert 950714f` removes 2/2; revert before #13 |
| 13 | `7337840` | refactor(frontend): stabilize vacancy discovery experience | REFACTOR | 217 / 64 | `frontend/src/app/(public)/vacantes/page.tsx` (2/5), `frontend/src/app/globals.css` (1/1), `frontend/src/app/globals.css.test.ts` (3/2), `frontend/src/app/layout.test.tsx` (19/1), `frontend/src/app/layout.tsx` (20/1), `frontend/src/features/jobs/components/JobsNavigationIsland.tsx` (64/36), `frontend/src/features/jobs/components/JobsResults.tsx` (39/12), `frontend/tests/e2e/root.spec.ts` (9/3), `frontend/tests/e2e/vacantes-a11y.spec.ts` (60/3) | Stabilizes nav+results composition, tokens, and E2E coverage | `git revert 7337840` removes nine paths; revert before #14 |
| 14 | `ae8e5fb` | docs(openspec): close recovered frontend task 4.4 | Closure | 34 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (33/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes Task 4.4 checkbox; carries the 33-line closure evidence | `git revert ae8e5fb` reopens 4.4 and removes closure section; revert before #15 |
| 15 | `3f8fdd5` | test(vacantes): define detail page behavior | RED | 339 / 8 | `frontend/src/app/(public)/vacantes/[jobId]/page.test.tsx` (99/0), `frontend/src/features/jobs/components/JobDetailView.test.tsx` (75/0), `frontend/tests/e2e/vacante-detalle.spec.ts` (117/0), `frontend/tests/fixtures/jobs-server.mjs` (48/8) | Detail-page RED suite; precedes #17 GREEN | `git revert 3f8fdd5` removes 4 paths incl. fixture diff; revert before #17 |
| 16 | `9fee23b` | docs(openspec): close recovered frontend task 5.1 | Closure | 11 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (10/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 5.1; the 1/1 `tasks.md` change is the checkbox flip | `git revert 9fee23b` reopens 5.1; revert before #17 |
| 17 | `1627364` | feat(vacantes): add vacancy detail page | GREEN | 355 / 3 | `frontend/src/app/(public)/vacantes/[jobId]/error.tsx` (37/0), `frontend/src/app/(public)/vacantes/[jobId]/not-found.tsx` (25/0), `frontend/src/app/(public)/vacantes/[jobId]/page-data.ts` (52/0), `frontend/src/app/(public)/vacantes/[jobId]/page.tsx` (79/0), `frontend/src/app/(public)/vacantes/page.test.tsx` (2/1), `frontend/src/features/jobs/components/JobDetailView.tsx` (157/0), `frontend/src/features/jobs/components/JobsNavigationIsland.tsx` (3/2) | Largest implementation commit (358 changed lines); realizes detail route | `git revert 1627364` removes six new detail paths + minor nav edits; revert before #18 |
| 18 | `ee7a400` | docs(openspec): close recovered frontend task 5.2 | Closure | 12 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (11/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 5.2 | `git revert ee7a400` reopens 5.2; revert before #19 |
| 19 | `941c2b6` | test(vacantes): triangulate detail accessibility | TRIANGULATE | 139 / 35 | `frontend/src/features/jobs/components/JobDetailView.tsx` (24/33), `frontend/tests/e2e/vacante-detalle.spec.ts` (82/2), `frontend/tests/e2e/vacantes-a11y.spec.ts` (33/0) | Detail triangulation; mixed sign on `JobDetailView` is shared-path evidence (see Shared-path ordering risks below) | `git revert 941c2b6` removes the triangulation expansion; revert before #20 |
| 20 | `69e1aa0` | docs(openspec): close recovered frontend task 5.3 | Closure | 12 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (11/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 5.3 | `git revert 69e1aa0` reopens 5.3; revert before #21 |
| 21 | `52bb06b` | style(frontend): normalize vacancy detail formatting | Mechanical formatting | 15 / 12 | `frontend/src/features/jobs/components/JobDetailView.tsx` (1/3), `frontend/tests/e2e/vacante-detalle.spec.ts` (6/1), `frontend/tests/e2e/vacantes-a11y.spec.ts` (8/8) | Late formatter normalization over the detail surface; small net +3 lines | `git revert 52bb06b` restores the pre-formatting detail bytes; revert before #22 |
| 22 | `8bfb23a` | docs(openspec): close recovered frontend task 5.4 | Closure | 10 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (9/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 5.4 (final detail REFACTOR slice) | `git revert 8bfb23a` reopens 5.4; revert before #23 |
| 23 | `a0f3bd0` | test(frontend): define cross-route evidence matrix | RED | 196 / 0 | `frontend/tests/e2e/cross-cutting.spec.ts` (additions only, new file) | Cross-route RED matrix for Tasks 6.x | `git revert a0f3bd0` removes the new cross-route E2E file; revert before #24 |
| 24 | `53c20c1` | docs(openspec): close recovered frontend task 6.1 | Closure | 9 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (8/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 6.1 | `git revert 53c20c1` reopens 6.1; revert before #25 |
| 25 | `1e719c8` | test(frontend): complete public jobs browser harness | TRIANGULATE / browser harness | 45 / 24 | `frontend/playwright.config.ts` (3/2), `frontend/tests/e2e/cross-cutting.spec.ts` (7/20), `frontend/tests/e2e/root.spec.ts` (6/1), `frontend/tests/e2e/vacantes.spec.ts` (1/1), `frontend/tests/fixtures/jobs-server.mjs` (28/0) | Closes the cross-route E2E harness per Task 6.2 GREEN contract | `git revert 1e719c8` removes the harness edits; revert before #26 |
| 26 | `b7fee85` | docs(openspec): close recovered frontend task 6.2 | Closure | 8 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (7/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 6.2 | `git revert b7fee85` reopens 6.2; revert before #27 |
| 27 | `3cfff3c` | docs(openspec): record recovered frontend task 6.3 gates | Documentary evidence | 32 / 0 | `openspec/changes/frontend-public-job-discovery/task-6-3-evidence.md` (additions only, new file) | Late-evidence artifact for 6.3 (passive) | `git revert 3cfff3c` removes the 32-line evidence file; revert before #28 |
| 28 | `08b75bc` | docs(openspec): close recovered frontend task 6.3 | Closure | 9 / 2 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (7/0), `openspec/changes/frontend-public-job-discovery/task-6-3-evidence.md` (1/1), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 6.3; updates the evidence file | `git revert 08b75bc` reopens 6.3 and undoes evidence mutation; revert before #29 |
| 29 | `26bd8d4` | docs(openspec): close recovered frontend task 6.4 | Closure | 50 / 1 | `openspec/changes/frontend-public-job-discovery/apply-progress.md` (11/0), `openspec/changes/frontend-public-job-discovery/design.md` (5/0), `openspec/changes/frontend-public-job-discovery/task-6-4-evidence.md` (33/0), `openspec/changes/frontend-public-job-discovery/tasks.md` (1/1) | Closes 6.4 (final REFACTOR slice of the recovered change); introduces the 33-line evidence file the next audit uses as a reference | `git revert 26bd8d4` reopens 6.4; no dependent commits after this baseline |

## Formatting-only commit callout

- `387df7c` is **purely formatting**: every path is `+N/−N` (`page.test.tsx` 20/20, `page.tsx` 23/23, `vacantes.spec.ts` 7/7), and `git diff -w 387df7c^..387df7c` is empty (zero non-whitespace changes). Rollback is reversible without affecting behavior; no semantic regression risk.

## Documentary correction descendants

Three consecutive `apply-progress.md` corrections collapse #9's `JobsResults` evidence into a stable accounting total. Each is small and ordered; their rollback order is newest-first so the stable total stays coherent:

- `950714f` → `f631b1d` → `14ffb25` → `c1ef947` (in revert order).

`25e1069` plays the same role for #6's compressed evidence (revert before `#5`).

## Shared-path ordering risks

The following paths are touched by more than one commit in the range; rollback must respect newest-first ordering so intermediate commits do not strand hunks:

- `frontend/src/app/(public)/vacantes/page.test.tsx` — #1, #3, #6 (formatter), #17
- `frontend/src/app/(public)/vacantes/page.tsx` — #2, #3, #13
- `frontend/src/features/jobs/components/JobsNavigationIsland.tsx` — #5, #6 (formatter), #13, #17
- `frontend/src/features/jobs/components/JobsResults.tsx` — #9, #13
- `frontend/src/features/jobs/components/JobDetailView.tsx` — #17, #19, #21 (formatter)
- `frontend/tests/e2e/vacantes.spec.ts` — #1, #3, #4, #8, #25
- `frontend/tests/e2e/vacantes-a11y.spec.ts` — #8, #13, #19, #21 (formatter)
- `frontend/tests/e2e/cross-cutting.spec.ts` — #23, #25
- `frontend/tests/fixtures/jobs-server.mjs` — #15, #25
- `openspec/changes/frontend-public-job-discovery/apply-progress.md` — touched by most documentary commits (#2, #5, #6, #7, #9, #10, #11, #12, #14, #16, #18, #20, #22, #24, #26, #28, #29); the late-evidence objects at #27 (`task-6-3-evidence.md`) and #29 (`task-6-4-evidence.md`) are isolated to their own files
- `openspec/changes/frontend-public-job-discovery/tasks.md` — checkbox flips at #14, #16, #18, #20, #22, #24, #26, #28, #29 (always 1/1)

## Rollback boundary (revert newest-first across dependents)

Each commit's rollback boundary in the table is a single `git revert <hash>`. Because dependents write on top of ancestors, full rollback of any prefix MUST proceed **strictly newest-first** within that prefix. Concretely:

- To undo through #17: revert in order `#29, #28, …, #18` first, then `#17` itself; failing to revert dependents first leaves their commits without the modules they reference.
- To undo only the documentary chain (#10–#12, #7): revert `#12, #11, #10, #7` in that order.
- To undo the formatting-only normalization (#3): revert `#3` only; nothing depends on its whitespace shape.

If the entire recovered change is to be rolled back, the full revert order is the reverse of the table (`#29` → `#1`). The pure formatting commit `387df7c` and the documentary descendants can be reverted at any point without affecting non-OpenSpec semantics.

## Verification commands (structural only, no runtime)

| Check | Exact command | Outcome |
| ----- | ------------- | ------- |
| Commit count in range | `git rev-list --count 458850d12d1ab0a876965e863dc75b95b95fab01..26bd8d4` | `29` |
| Aggregate diff stat | `git diff --shortstat 458850d12d1ab0a876965e863dc75b95b95fab01..26bd8d4` | `29 files changed, 2095 insertions(+), 163 deletions(-)` |
| Frontend-only diff stat | `git diff --shortstat 458850d1..26bd8d4 -- frontend/` | `24 files changed, 1820 insertions(+), 154 deletions(-)` |
| Whitespace cleanliness | `git diff --check 458850d12d1ab0a876965e863dc75b95b95fab01..26bd8d4` | exit 0 (no whitespace/conflict-marker errors) |
| Formatting-only proof for `387df7c` | `git diff -w --shortstat 387df7c^..387df7c` | empty output (zero non-whitespace changes) |
| Worktree state | `git status --porcelain` | empty |
| Index state | `git diff --cached --stat` | empty |
| HEAD identity | `git rev-parse HEAD` | `26bd8d47b8a73b95589e283c6668e5daa158f1dd` |
| Branch identity | `git branch --show-current` | `recovery/frontend-public-job-discovery-tdd` |

This evidence commit adds only this file; a separate mechanical commit closes Task 7.1. Neither commit changes product bytes, pushes, or opens a PR.
