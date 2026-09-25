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

- [ ] **THEME-01 — Implement the animated toggle contract:** Add focused tests, the scoped circular View Transition behavior, reduced-motion and unsupported-browser fallbacks, and transient CSS without changing existing theme semantics.
- [ ] **THEME-02 — Verify and close:** Run focused and regression tests, read-only TypeScript, ESLint, production build, LSP diagnostics, and isolated browser acceptance for animation, persistence, keyboard behavior, reduced motion, cleanup, and runtime safety; record exact evidence.

## Acceptance Criteria

- A pointer or keyboard activation on any shared `ThemeToggle` produces a circular reveal from that button when the View Transitions API is available and motion is allowed.
- The concrete theme, `pf-theme` storage value, `data-theme`, and `dark` class update exactly as before.
- The transient View Transition scope is absent after completion, rejection, fallback, reduced-motion activation, and component unmount.
- Rapid activation cannot create overlapping theme transitions.
- Existing non-animated settings selection, OS-following system mode, reload persistence, accessible name, focusability, and 40px geometry remain intact.
- Unsupported and reduced-motion environments receive an immediate, error-free theme change.
