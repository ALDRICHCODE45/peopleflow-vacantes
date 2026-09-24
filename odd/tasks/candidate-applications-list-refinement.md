# Candidate Applications List Refinement

## Objective

Rebuild Candidate Applications List mode around the official shadcn `Item` composition and an accessible `DropdownMenu`, so each row has stable visual zones, clearer hierarchy, and compact truthful actions while the approved Cards mode remains unchanged.

## Problem

The current List mode compresses identity, status/source, cover-letter dates, and a wide trailing vacancy action into one four-column Card grid. The result feels crowded and visually unordered compared with the approved reference, even though the underlying facts and behavior are correct.

## Why

The user explicitly approved Cards mode but rejected the current List composition. They asked for stronger fidelity to the ordered reference, shadcn-first composition, investigation of `Item`, and a dropdown action menu instead of the trailing `Ver vacante` or `Vacante histórica sin enlace` treatment.

## References

- Approved visual direction: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-50-02_5360x2520.png`
- Current implementation: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-14-44-35_5360x2520.png`
- Parent task: `odd/tasks/candidate-visual-language-refresh.md`
- Official Item docs: `https://ui.shadcn.com/docs/components/base/item`
- Official Dropdown Menu docs: `https://ui.shadcn.com/docs/components/base/dropdown-menu`

## Scope

- Add the official shadcn `Item` primitive for the project's existing `base-rhea` preset.
- Recompose List mode with `ItemGroup`, `Item`, `ItemMedia`, `ItemContent`, and `ItemActions`.
- Replace the List-only trailing vacancy treatment with an accessible `DropdownMenu`.
- Keep Cards mode visually and behaviorally unchanged.
- Preserve frozen fixtures, search, status filters, newest-first order, status vocabulary, both dates, cover-letter truth, vacancy-link truth, local-only state, and read-only semantics.
- Update focused unit and browser contracts for the new list hierarchy and keyboard-accessible actions.

## Constraints

- Spanish product UI and English technical artifacts.
- Use the official project-preset shadcn implementation; do not hand-roll a competing primitive.
- `DropdownMenu` is already installed; no new npm package is needed.
- The menu exposes no mutation: live vacancies offer only `Ver vacante`; historical vacancies show `Vacante histórica sin enlace` as unavailable.
- Keep real Next `Link` semantics for live vacancy navigation.
- Keep independently actionable targets at least 40px with visible focus.
- Do not edit shared primitives other than adding the explicitly authorized official `item.tsx`.
- Do not contact or restart protected services `127.0.0.1:3001` or `127.0.0.1:4010`.
- No commit, push, PR, merge, deployment, or remote publication without explicit user authorization.

## Delivery

- Strategy: bounded delegated writer followed by independent verification.
- Native RDD review: unavailable because the package-local Gentle AI v3.4.0 binary is missing; do not claim native review.
- Effective TDD mode: ordinary behavior-first checks; no repository strict-TDD configuration has been established.
- User decision: authorized adding the official shadcn `Item` primitive; the action-menu change applies to List only.

## Tasks

- [x] AILR-01 — Add and inspect the official shadcn `Item` primitive for the active preset.
  - Status: complete.
  - Route: delegated writer because the authorized implementation crosses multiple non-trivial files.
  - Check: `frontend/src/components/ui/item.tsx` matches the official `base-rhea` registry shape and introduces no new package dependency or unrelated primitive changes.
  - Evidence: the generated source was read back against the inspected registry implementation; only the expected project-local `Separator` import alias differs, and `package.json`, the lockfile, and existing primitives were not edited.
- [x] AILR-02 — Recompose List mode and its contracts around Item plus DropdownMenu without changing Cards mode.
  - Status: complete after one bounded mobile-readability correction.
  - Route: the same bounded writer owns implementation and focused behavior contracts.
  - Check: List rows have stable identity, status/source, cover-letter/date, and action zones; live menu items remain real links; historical rows expose an honest unavailable item; keyboard, hit-area, and read-only contracts remain explicit.
  - Correction: the action trigger leaves the sub-`sm` flex track and cover-letter values wrap beneath their label on narrow screens while compact truncation returns from `sm`.
  - Evidence: final Chromium capture shows all four 375px cover-letter values fully readable, dates clear of the trigger, 40×40px actions, stable facts/order, and 0px horizontal overflow.
- [x] AILR-03 — Verify focused unit, type/lint/diff, Chromium accessibility/keyboard/responsiveness, and fresh visual evidence.
  - Status: complete.
  - Route: independent `gentle-ai-verify` because command-running verification must not be self-certified by the writer.
  - Check: focused suites pass, Cards remain unchanged, List is overflow-clean and visually ordered at desktop/mobile, menus work by keyboard, Axe has no serious/critical findings, and no mutation/storage side effect occurs.

## Acceptance Criteria

- List mode uses the official shadcn Item anatomy rather than a Card-shaped row.
- Each desktop row scans in stable zones with stronger whitespace and hierarchy; mobile reflows naturally without horizontal overflow.
- List rows remain independent rounded surfaces and preserve the exact application IDs, order, facts, statuses, and dates.
- Cards mode preserves its approved Card composition and direct vacancy footer treatment.
- Every List row has one ellipsis action trigger with a specific accessible name and a minimum 40px hit area.
- Live rows expose `Ver vacante` as a real link inside the menu; historical rows expose `Vacante histórica sin enlace` as disabled/unavailable.
- No withdrawal, status change, drag, persistence, network write, or fabricated capability appears.
- Focused Vitest, TypeScript, ESLint, diff checks, Chromium, accessibility, side-effect, responsive, and visual checks pass or are reported honestly.

## Progress

- User feedback and both screenshots were reviewed.
- Current component, focused contracts, installed DropdownMenu, project shadcn configuration, official Item registry source, Item docs, Dropdown Menu docs, and Base UI menu semantics were inspected read-only.
- `Item` was confirmed absent from the installed inventory and appropriate for this content-plus-actions row.
- The user explicitly selected and authorized adding the official Item primitive.
- The bounded writer changed only the four authorized implementation/test surfaces: official `item.tsx`, the applications workspace, its focused unit contracts, and the candidate browser suite.
- Parent structural readback confirmed Cards still use the existing `ApplicationVacancy`, while List uses Item anatomy and a list-only, row-labelled DropdownMenu.
- Native risk assessment remained unavailable because the package-local binary is missing, so the candidate followed the returned high-risk fallback: structural writer self-check plus a separate independent verifier.
- The first visual pass rejected mobile truncation; one two-file correction moved the trigger out of the narrow flex track and changed cover-letter values to wrap below their labels below `sm`.
- The final independent and parent visual inspections accepted desktop and mobile hierarchy, readability, menu placement, and unchanged Cards behavior.

## Verification Evidence

- Writer structural evidence: official registry/source comparison passed with only the expected local import alias; no package or lockfile change; Base UI menu semantics and lucide exports were inspected; test/type/lint/browser commands were intentionally deferred to the independent verifier.
- Parent readback: `ItemGroup` is presentational around the semantic `<ul>` to avoid duplicating `role="list"`; every `<li>` owns one outlined Item and one row-labelled 40px menu trigger.
- First independent run: 31/31 focused Vitest, TypeScript, ESLint, tracked/untracked whitespace checks, and 7/7 Chromium passed; menus, focus return, link/disabled truth, order, both dates, no mutation/storage, zero serious/critical Axe findings, and 0px overflow all passed.
- First visual run: desktop hierarchy passed, but 375px List rows visibly truncated cover-letter values to fragments such as “Sin c…” and “Me e…”. AILR-02 remains open; ignored `tsconfig.tsbuildinfo` and `test-results/.last-run.json` were also rewritten by verification commands and are reported as test artifacts, not source changes.
- First-run evidence: `/tmp/peopleflow-candidate-applications-list-refinement/manifest.json` and four associated PNGs.
- Final independent run: **32/32 focused Vitest**, TypeScript exit 0, ESLint exit 0, tracked/untracked whitespace checks clean, and **7/7 Chromium** passed.
- Final runtime evidence: Cards default remains four Card surfaces with two live footer links and two historical notes; List has four Item rows, four 40×40px labelled triggers, truthful live/disabled menu items, keyboard Escape focus return, stable facts/order/both dates, 0px overflow, zero serious/critical Axe findings, and no navigation/mutation/storage/browser error.
- Final visual evidence: `/tmp/peopleflow-candidate-applications-list-refinement-final/manifest.json`, `desktop-list-closed.png`, `desktop-live-menu-open.png`, `mobile-list-closed.png`, and `mobile-historical-menu-open.png`.
- Parent visual readback accepted the final four captures: desktop zones are ordered and compact; 375px values wrap fully beneath their labels; dates remain readable; menus are not clipped.
- Verification rewrote only known ignored test artifacts `frontend/tsconfig.tsbuildinfo` and `frontend/test-results/.last-run.json`; no candidate source/task hash changed during the final read-only run.
- At that point no commit, push, PR, merge, deployment, or native review had been performed; delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commits: `bf1cef9` — `feat(ui): add candidate workspace primitives` (the official `Item` foundation added for List mode) and `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`, with the `Item` primitive supplied by `bf1cef9`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Merge of this verified slice into the user-selected target worktree is pending. Push, PR creation, deployment, and remote operations remain unauthorized.
