# Task 7.1 candidate-boundary evidence

> **Merge note (2026-09-24, merge resolution).** Two independent documentary audits for Task 7.1 are retained below in chronological order: the target tracker audit of its 64 landed task commits, then the source archive recovery line audit of its 29-commit replay. Neither audit replaced the other and no recorded figure, hash, or verdict was altered; this merge ran no command. Both audits quote the `openspec/changes/frontend-public-job-discovery/...` selectors that were current when they were written; that path now lives at `openspec/changes/archive/2026-09-15-frontend-public-job-discovery/` per the merge.

## Attempt 1 — target tracker `feat/frontend-foundation` (2026-09-11, 64 landed task commits)

## Scope and replay command

This is a documentary candidate only: no frontend source, tests, runtime process, or task checkbox changed. It audits all 64 landed task commits after planning baseline `aff13fcbf0927e4ba45ac8e546d19abdb8f0f7ee`, through `846329e483048f3c74389ea47a4b67f1c5935a62`; Task 7.1 remains unchecked until its parent commits this evidence.

For every matrix selector below, run the exact removable-file manifest and stat commands without hiding intermediate paths:

```sh
git diff-tree --no-commit-id --name-status -r SHA
git show --format='' --numstat SHA
git show SHA:openspec/changes/frontend-public-job-discovery/apply-progress.md
```

`AP@SHA` is the named closure's historical apply-progress evidence; `E63/E64` is the evidence artifact created at that commit. The records cite focused/runtime results but cannot prove historical cached-stat inspection where no retained record says it occurred. RED rows remain dependent on later GREEN work and are not claimed independently deployable.

## Landed work-unit matrix

| Commit / exact manifest selector | Purpose; coherence/dependency | Stat | Tests/docs/evidence pointer |
| --- | --- | --- | --- |
| `8e488a4f36dfaf48fbbf708a4c29a029cd440ee0` | 1.1 bootstrap ← plan | +7937/-0 | AP@eaa88e2 |
| `eaa88e251c0c296a7673b6e38e98ec2dc8c82759` | 1.1 closure ← bootstrap | +13/-7 | AP@eaa88e2 |
| `bfada71c7ce6972c0fa792409570dfaa9d548ae2` | 2.1 root RED ← 1.1 | +391/-0 | AP@483945b |
| `483945b2ffcee75ce0d113c2bde4b98a82543418` | 2.1 closure ← RED | +20/-9 | AP@483945b |
| `8467124f193b2f1a0c9ad0cd4fd5a24d4b4ef2a1` | 2.2 root GREEN ← RED | +188/-7 | AP@cd471ad |
| `cd471ada0341e897f6ddf441addfbe75e0d14aad` | 2.2 closure ← GREEN | +142/-6 | AP@cd471ad |
| `7e4a05016e4552e0440241321da56afe82558f5a` | 2.3 root/a11y triangulation ← 2.2 | +382/-1 | AP@b467753 |
| `b46775347f574172c3db7dbc641bf526ac971baf` | 2.3 closure ← triangulation | +36/-1 | AP@b467753 |
| `8ac49325bdc1ce4e069143256d91a11678918f3f` | 2.4 shell refactor ← 2.3 | +9/-5 | AP@ababed8 |
| `ababed8ca79c705f0d43f41010b912296a0e8b54` | 2.4 closure ← refactor | +73/-10 | AP@ababed8 |
| `e35a82beeff22f1da5615e6c4a6c47a70d635535` | 3.1 contracts RED ← 2.4 | +388/-0 | AP@e9b4bc1 |
| `e9b4bc12a4bc296656c06dcc5bf9308d9d91613a` | 3.1 closure ← RED | +20/-1 | AP@e9b4bc1 |
| `da20d3b2ffe400ac3276e86976903453e20d2079` | 3.2 architecture reconciliation ← 3.1 | +129/-25 | AP@1856821 |
| `f9bddf3df068916f95e15b9b84868756cb76681c` | 3.2 server env ← reconciliation | +142/-0 | AP@1856821 |
| `eea7c35b430c02d672b25da3a5caf53430e0bfc5` | 3.2 JSON transport ← env | +227/-0 | AP@1856821 |
| `6f71c5dd67fc758b4390b0f5edd071490ce44ba2` | 3.2 transport formatting ← transport | +35/-5 | AP@1856821 |
| `5676521e0f84ca0448b3a8bf7bf050adcc488543` | 3.2 formatters ← transport | +117/-0 | AP@1856821 |
| `23d4f90692440751ab6f571e0901c7d7ad31fb9d` | 3.2 schemas/lock ← formatters | +62/-1 | AP@1856821 |
| `3403b1b9ffdda2bdc08eb7aea3ad9ff46f095125` | 3.2 canonical URLs ← schemas | +161/-0 | AP@1856821 |
| `c3f24ac0e096857528ea2ac096db121dcb706149` | 3.2 URL formatting ← URLs | +38/-4 | AP@1856821 |
| `48eed223273063d2080f6750d6ec105db0e192b6` | 3.2 detail-ID guard ← URLs | +81/-0 | AP@1856821 |
| `843b2c4d14dc870485f107c2ba45ed622610d86c` | 3.2 ancillary test formatting ← guard | +98/-54 | AP@1856821 |
| `c196f37468b96e7429c73737d7decab1274c8648` | 3.2 inferred types ← schemas | +81/-0 | AP@1856821 |
| `8cd814cd68077311072d6ccc225242702b5b7b53` | 3.2 detail query options ← types | +62/-7 | AP@1856821 |
| `89249b90480d1ab2dd964dc9fb76db7d3784577d` | 3.2 list query options ← detail query | +306/-0 | AP@1856821 |
| `45d1d2ea68dd56072ccdfe45c922697fad56a5f6` | 3.2 detail transport guard ← queries | +44/-7 | AP@1856821 |
| `18568211533a2eb93ed6b4ef720f1c9ab0acd69a` | 3.2 closure ← subunits | +33/-1 | AP@1856821 |
| `479641be4bd7e422726b6f31e2d37085f72d5ed1` | 3.3 API/URL triangulation ← 3.2 | +276/-19 | AP@b212301 |
| `b2123013e1fb7a78adb4a2f1c35dd67fc4f3ead0` | 3.3 closure ← triangulation | +11/-1 | AP@b212301 |
| `f8a85bb2cec5d261e396a5104a5e3db423c1a351` | 3.4 domain refactor ← 3.3 | +211/-74 | AP@8ca366f |
| `8ca366ffacdf601ddfc3ea9f8af3826ec0470f2c` | 3.4 closure ← refactor | +12/-1 | AP@8ca366f |
| `cf148ed3fbd698b988dd7aec40974fc05e030116` | 4.1 list/fixture RED ← 3.4 | +355/-0 | AP@9f5c8bb |
| `9f5c8bbec93a91e50c0488ccea7f77f2005e4545` | 4.1 closure ← RED | +53/-1 | AP@9f5c8bb |
| `25e7f6ebe3bb18f721ebd0c31441ad0a7cbb123d` | 4.2 list GREEN ← RED | +1670/-1 | AP@01cdaf7 |
| `01cdaf7e571f5244f7bd7b0d3d3bc978c722d78a` | 4.2 closure ← GREEN | +8/-1 | AP@01cdaf7 |
| `28d268c95bf28cf266718f0bf7ba6bd8d6858a89` | 4.3 contrast/a11y ← 4.2 | +368/-1 | AP@458850d |
| `4f3793d3199f00b8f83be013b262ba3c687ef039` | 4.3 refresh/share proof ← contrast | +95/-0 | AP@458850d |
| `59ea0f074dc188f6b09fb767d4490d293e60a453` | 4.3 filters/cursor proof ← refresh | +108/-1 | AP@458850d |
| `2417d9f75f9b5c7ca0b1cb0d51f1a33bd91cc443` | 4.3 empty-reset proof ← cursor | +12/-5 | AP@458850d |
| `90b68cb3fb920026e14b82e389aa3362d1ad30dd` | 4.3 failure recovery proof ← reset | +104/-5 | AP@458850d |
| `b900d8a23725f04c3f9c403c42cd42eb75ad7247` | ancillary Git-ignore unit; not 4.3 behavior | +1/-0 | manifest only; rollback separately |
| `984b845c2576c09750f9431c1ac1e83b859098e6` | 4.3 long-content safety ← recovery | +124/-2 | AP@458850d |
| `d7db980955b19794e3b3fcd42ffaa5d59ed1c4ea` | 4.3 reduced motion ← wrapping | +222/-1 | AP@458850d |
| `458850d12d1ab0a876965e863dc75b95b95fab01` | 4.3 closure ← evidence slices | +1/-1 | AP@458850d |
| `5f40288e1246731a780a9108a19f9d65e2def994` | 4.4 visual foundation ← 4.3 | +169/-34 | AP@7d39c1c |
| `c8e9e0f0b7b8af0746b971e704873fe96ea347b0` | 4.4 navigation composition ← foundation | +311/-49 | AP@7d39c1c |
| `0624d452ddc986189ba7ec2628760f6ee6578f17` | 4.4 API cards ← navigation | +149/-41 | AP@7d39c1c |
| `084a37536303a8e919fc9a871fd545a4810f9d73` | 4.4 server-first refactor ← cards | +220/-64 | AP@7d39c1c |
| `7d39c1c139fc61e6342f577d57cea8207572b630` | 4.4 closure ← refactor | +67/-1 | AP@7d39c1c |
| `6767d0cb2f0b9961c07edc3d900da77b8878a6c4` | 5.1 detail RED ← 4.4 | +339/-8 | AP@f8468fb |
| `f8468fb41a13873b99e0814c8461f96013a697c9` | 5.1 closure ← RED | +9/-1 | AP@f8468fb |
| `4aaf17bb297b8cf2c1d72da27fb9c57909721b9e` | 5.2 detail GREEN ← RED | +355/-3 | AP@b3d835b |
| `b3d835bbba5522f1edb82ab7415f3acadb3d944a` | 5.2 closure ← GREEN | +10/-1 | AP@b3d835b |
| `0ec4c51a2a6be213522cac53647239d82dba4183` | 5.3 detail/a11y triangulation ← 5.2 | +139/-35 | AP@6ec0179 |
| `6ec0179fc1702a10d8bca2714c17645dfed7f840` | 5.3 closure ← triangulation | +11/-1 | AP@6ec0179 |
| `50c56e750994e943f74ea175fb9fda4354c9a241` | 5.4 no-source audit closure ← 5.3 | +12/-1 | AP@50c56e7 |
| `c4198aed4c791632e3e542df04bcac6f74ed4803` | standalone detail formatting ← 5.4; before 6.1 | +15/-12 | exact 3-path manifest; rollback separately |
| `8614e048cc3ce48e1a4b065db40aa23d1fb0a4c8` | 6.1 cross-route RED ← c419 | +196/-0 | AP@7e3958e |
| `7e3958eadebad4d05a41346d0d25fa38dcc954e5` | 6.1 closure ← RED | +20/-1 | AP@7e3958e |
| `9251079968cacc9ac56ad059c7286d8fb1a3b54f` | 6.2 harness GREEN ← 6.1 | +45/-24 | AP@e48dba9 |
| `e48dba98a73b60ed502adf60eb9d7e4df89c5618` | 6.2 closure ← GREEN | +57/-1 | AP@e48dba9 |
| `4aa85cfe580f99465bfe75b792ac243083999f98` | 6.3 gate evidence ← 6.2 | +48/-0 | E63; AP@de97e15 |
| `de97e15b59fbfb8b8086940e1af5684aa3f95078` | 6.3 closure ← evidence | +14/-1 | AP@de97e15 |
| `846329e483048f3c74389ea47a4b67f1c5935a62` | 6.4 bounded evidence closure ← 6.3 | +32/-1 | E64; AP@846329e |

## Historical verification citations and limitations

- These are references to prior evidence, not fresh execution: task 6.2 records 99/99 unit, 68/68 E2E, and 16/16 accessibility; 6.3/6.4 repeat the relevant full-gate record. No suite, build, or browser process was started for this documentation unit.
- `task-6-3-evidence.md` and `task-6-4-evidence.md` are protected historical evidence. The latter records `next start` with process-local `NODE_ENV=development`; it is not production-environment parity.
- The user-approved Task 6.4 ClashDisplay/Fontshare exception remains scoped by `design.md`; production HTTPS policy remains intact and was not re-evaluated here.
- `c4198ae` is a verified formatting-only standalone unit: exactly `JobDetailView.tsx`, `vacante-detalle.spec.ts`, and `vacantes-a11y.spec.ts` (+15/-12), without invented Task 5.4 ownership. `b900d8a` is a separate one-path ancillary `.gitignore` unit.
- User-accepted historical exceptions: 1.1 bootstrap `8e488a4` is 7,937 total = 7,598 generated + 142 other + 197 docs (`globals.css` is 129 generated lines, not 128); 4.2 commit `25e7f6e` is one committed 865-authored exception (737 other + 128 docs), 806 generated, 1,671 total. This is accepted now, not the original generated exception or a history rewrite.

## Dependency-aware rollback

1. Start from the newest affected commit; inspect its row manifest, then apply `git revert --no-commit <SHA>` before moving to its predecessor.
2. To return to the pre-change base, repeat task order 6.4 → 6.3 → 6.2 → 6.1 → `c4198ae` → 5.4 → 5.3 → 5.2 → 5.1 → 4.4 → 4.3 (with ancillary `b900d8a` separately) → 4.2 → 4.1 → 3.4 → 3.3 → 3.2 → 3.1 → 2.4 → 2.3 → 2.2 → 2.1 → 1.1.
3. **Shared-file warning — Task 4.4:** do not use a whole-file restore from its base for shared list/root files. Restoring (for example) `frontend/src/app/globals.css`, `layout.tsx`, or list components wholesale discards later, unrelated refinement; revert the selected commits as patches after dependent work is removed.
4. Documentation-only rollback (not run): remove `openspec/changes/frontend-public-job-discovery/task-7-1-evidence.md`; restore `openspec/changes/frontend-public-job-discovery/apply-progress.md` and `openspec/changes/frontend-public-job-discovery/tasks.md` to `846329e483048f3c74389ea47a4b67f1c5935a62`; if future Task-7.1 closure commits exist, revert them newest-first.

## Closure boundary

PR5 is frozen at `c4198aed4c791632e3e542df04bcac6f74ed4803..846329e483048f3c74389ea47a4b67f1c5935a62`: `392 additions + 8 deletions = 400`. This candidate starts a separate closure review boundary at landed `846329e`; it neither resets nor exempts PR5. Its authored count is measured with the requested working-tree commands before parent commit; the parent retains two lines of the 200-line closure cap for the later checkbox and closing note.

## Attempt 2 — source archive `recovery/frontend-public-job-discovery-tdd` (2026-09-14, recovered candidate boundaries, 29-commit audit)

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
