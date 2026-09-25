# Animated Theme Transition

## Objective

Enhance the existing PeopleFlow theme toggle with the Magic UI circular View Transitions reveal while preserving the current theme persistence, system-mode behavior, hydration contract, accessibility, and fallback behavior.

## Source

- Official reference: `https://magicui.design/docs/components/animated-theme-toggler.md`
- Adapt the effect to the existing `ThemeToggle`; do not install `next-themes`, Magic UI, or another dependency.

## Decisions

- Use the official default circular reveal, expanding from the center of the activated theme button.
- Keep `pf-theme`, `data-theme`, the Tailwind `dark` class, and the existing system-first then binary light/dark behavior unchanged.
- Keep all three icons in hydration-stable markup; existing CSS remains responsible for resolved-theme icon visibility.
- Scope View Transition pseudo-element CSS behind a transient PeopleFlow-owned root data attribute so unrelated current or future navigation transitions are unaffected.
- Treat the effect as progressive enhancement: unsupported browsers and `prefers-reduced-motion: reduce` apply the theme immediately.
- Keyboard activation also originates from the button center.
- Keep the candidate settings theme select immediate; only the shared theme-toggle button receives the reveal.
- Preserve the 40px target and Spanish accessible name.

## Constraints

- No new dependency or package installation.
- No changes to theme labels, persistence keys, routes, fixtures, or protected services.
- Prevent overlapping transitions and clean transient root styles, attributes, and animations after completion, rejection, or unmount.
- Keep runtime errors and promise rejections contained.
- Do not push, create a pull request, deploy, or release.

## Tasks

- [x] **THEME-01 — Implement the animated toggle contract:** Added focused tests, the scoped circular View Transition behavior, reduced-motion and unsupported-browser fallbacks, and transient CSS without changing existing theme semantics.
- [x] **THEME-02 — Verify and close:** Completed focused and full regression tests, read-only TypeScript, ESLint, production build, LSP diagnostics, and real-browser acceptance for animation, persistence, keyboard behavior, reduced motion, cleanup, and runtime safety.

## Evidence

- THEME-01 test-first RED: 11 new reveal/CSS tests failed against the pre-change implementation while the 11 existing/fallback contracts passed.
- THEME-01 initial GREEN: 22/22 focused tests passed; an independent verifier then identified that reduced-motion/API fallback branches could bypass the cross-toggle ownership guard during an active reveal.
- The overlap correction was also test-first: two new tests failed with 22 existing passes, then passed after moving the ownership guard ahead of every theme-applying fallback.
- Final independent THEME-01 verification passed 7/7 related files and 141/141 tests, read-only TypeScript, focused ESLint, and `git diff --check` under Node 22.23.2 and offline Corepack pnpm 10.34.5.
- Pi Lens reported zero diagnostics across the changed TypeScript/test/CSS paths; one path remained technically inconclusive because its server is silent on clean re-checks. Project TypeScript compilation is the authoritative clean result.
- `d31f509 feat(ui): animate theme transitions` contains the implementation, tests, scoped CSS, and THEME-01 evidence.
- Final non-browser regression passed 103/103 files and 1,405/1,405 tests with no worker timeout, plus read-only TypeScript and full ESLint under Node 22.23.2 and offline Corepack pnpm 10.34.5. Existing non-failing jsdom canvas/WebGL, Recharts zero-size, and root-layout hydration diagnostics remained unchanged.
- Real-browser regression passed 2/2 existing theme-related Chromium tests. A six-case acceptance matrix covered marketing, candidate, employer, and login surfaces at desktop/mobile with pointer, keyboard, and reduced-motion activation.
- Five animated cases observed exactly one real View Transition, a 400ms button-centered percentage circle, `::view-transition-new(root)`, correct persistence and dark-class updates, and complete transient-scope cleanup. The reduced-motion case observed zero View Transition calls.
- Across the six browser cases: 140 requests, zero requests to ports 3001/4010/4011, zero serious/critical Axe findings, zero page/console errors, and zero horizontal overflow. Evidence is stored in `/tmp/peopleflow-theme-transition/manifest.json` with five mid-transition and six final screenshots.
- The production build passed in 33 seconds, generated 15 static pages, and reported 18 routes (4 static, 14 dynamic). Only existing webpack large-string cache warnings remained.
- The user-requested dev server was restored on `http://127.0.0.1:3000` after the build; its owned PID/PGID is recorded in `/tmp/peopleflow-dev-3000.pid` and its log is `/tmp/peopleflow-dev-3000-after-theme.log`.

## Acceptance Criteria

- A pointer or keyboard activation on any shared `ThemeToggle` produces a circular reveal from that button when the View Transitions API is available and motion is allowed.
- The concrete theme, `pf-theme` storage value, `data-theme`, and `dark` class update exactly as before.
- The transient View Transition scope is absent after completion, rejection, fallback, reduced-motion activation, and component unmount.
- Rapid activation cannot create overlapping theme transitions.
- Existing non-animated settings selection, OS-following system mode, reload persistence, accessible name, focusability, and 40px geometry remain intact.
- Unsupported and reduced-motion environments receive an immediate, error-free theme change.
