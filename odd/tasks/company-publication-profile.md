# Company profile publication prerequisite

## Objective and constraints
Frontend-only: confirmed nonblank company name + existing About required to publish; optional rich fields; drafts independent. Preserve both vacancy value sets and wizard step across employer navigation. No backend/storage/fixtures/portfolio/dependencies or visible demo/unavailable disclaimers. Follow docs/frontend-ui-design-rules.md, existing primitives, Mexican Spanish. User has a meeting soon: no optional polish or broad checks. User owns visual/a11y/smoke checks. Commit and merge local main, NEVER push.

## Delivery
Branch feat/company-publication-profile; base82ff2e7; approved feature-branch-chain, three sequential local commit slices, no PRs. Forecast700–950 authored diff lines (400/slice advisory). Single delegated writer per task because multi-file changes. RDD off; assess each diff and follow verification plan. Parent owns tracking/commits/delivery.

## Tasks
- [x] CPP-1: Shared session and readiness. Commit eb8d709. Delegated. RED then13 focused tests GREEN;4 layout tests, tsc, scoped lint green Node22.23.2. Independent13-test rerun/static review PASS. Assessment unavailable due untracked files; independent verification completed. Source approximately414 diff lines.
- [x] CPP-2: Shared company editor and confirmation. Commit a70b148. Delegated plus parent mechanical route-test provider wrapper.14 editor tests, tsc/lint green; independent editor+route25/25 PASS. Assessment medium with small-writer bias required independent verifier. RED was a post-implementation removal experiment, NOT actual test-first. Worker cleanup reported unconfirmed/quarantined; parent process inspection found no matching worker. No relaunch. Commit183 diff lines including prior tracking update.
- [x] CPP-3: Publication gate and independent draft action, retained values/step. Commit5baf792; integrated main956175f. Observed RED then49 related tests plus14 sections tests GREEN; tsc/scoped lint pass. Independent5/5 publication tests and static review PASS. Assessment unavailable (untracked path); independent verification completed. Source plus tracking602 diff lines retained as coherent behavior; total delivery1187 lines incl tracking, above forecast. No optional scope added.

## Acceptance
Trim name/About; seeded fallback name not confirmed; name edits revoke confirmation. Missing profile blocks publishing not drafts. Completing profile must not discard vacancy description, complementary values or wizard step. Local outcome only in creation surface, no public URL/backend claim. Test-first applies to new deterministic behavior; document actual RED/GREEN. No build/browser/a11y/full suites. Rollback by work-unit commit; CPP-2/3 depend on CPP-1. External runtime harness N/A; user owns visual acceptance.

## Preservation and evidence
Main initially59a7247; only unstaged openspec/changes/backend-go-closure/{apply-progress,design,tasks}.md. Preserve respective SHA256:74a526152b3b4e3d1a04cf12605459bf03e75e5d378db6303fbcef94758ed48e;5e45c2f2ad86ba7dec277aafa30a64f505a67656dacc1124c4fba8736e4986b1;f5d8942dd734c762699b64a2bdb320191f8b5d5a2b9d166b6744d01d8b4e0da7.

## Next step
Complete. User pushes local main and performs visual/a11y/smoke acceptance. Main merge956175f succeeded; all three backend document hashes unchanged. No build/browser/full-suite run; actual Next router round-trip not exercised (consumer remount verified). State is in-memory; hard reload resets profile/draft, publication status resets on form unmount. Guardar borrador remains validation-only without fabricated save acknowledgement. No push.
