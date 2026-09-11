# Task 7.1 candidate-boundary evidence

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
