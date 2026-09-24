# Candidate Visual Language Refresh

## Objective

Turn the user-provided dashboard and applications references into a durable PeopleFlow product-language contract, then rebuild Candidate Applications so Cards and List are visually distinctive, task-appropriate presentations rather than spacing variants of the same row.

## Problem

The current candidate surfaces are structurally correct and accessible but visually flat: most content uses equal-weight bordered containers, weak hierarchy, sparse composition, and limited contextual iconography. Candidate Applications compounds this by rendering Cards and List with nearly the same horizontal information architecture, so switching modes provides little user value.

## Why

The user explicitly rejected correctness without visual presence. The supplied proposal demonstrates the intended quality bar: deliberate hierarchy, soft depth, contextual icons, compact semantic color, stronger grouping, and genuinely different presentation modes.

## References

- Current dashboard: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-41-27_5360x2520.png`
- Dashboard design-language proposal: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-41-18_5360x2520.png`
- Current applications: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-44-34_5360x2520.png`
- Proposed Cards: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-49-57_5360x2520.png`
- Proposed List: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-50-02_5360x2520.png`

## Scope

- Extend `docs/frontend-ui-design-rules.md` with strict reference-derived product composition rules.
- Redesign `/candidato/postulaciones` to match the proposed Cards and List compositions.
- Preserve the current dashboard implementation in this unit; its proposed screenshot is evidence for the durable design language, not authorization for a dashboard rewrite.
- Preserve frozen fixtures, newest-first sorting, search, status filters, exact statuses, public vacancy links, historical no-link messaging, local-only state, responsive behavior, accessibility, and read-only/no-persistence semantics.
- Reuse installed shadcn primitives and existing semantic theme tokens. Add no dependency and do not edit shared primitives.

## Constraints

- Spanish product UI; project-language documentation remains Spanish.
- No raw colors or manual dark-mode paint in product components.
- Candidate workspace remains centered and responsive with one padding owner.
- Cards mode must be a two-column desktop grid of rich vertical shadcn Cards.
- List mode must be a one-column sequence of compact horizontal rows; it must not reuse the card composition or merely alter gaps.
- Status meaning must use text plus the existing semantic Badge tones.
- Vacancy navigation remains a real Next `Link` styled with `buttonVariants`.
- No fake mutation, drag-and-drop, storage, network write, auth/session claim, or new business capability.
- Do not contact or restart protected services `127.0.0.1:3001` or `127.0.0.1:4010`.
- No commit, push, PR, merge, deploy, or remote operation without explicit user authorization.

## Delivery

- Strategy: `ask-on-risk`.
- Forecast: approximately 320–440 authored changed lines across documentation, component, unit contracts, and browser acceptance.
- Native RDD review: previously disabled for this candidate; do not start a transaction.
- Effective TDD mode: unresolved by repository configuration; use ordinary behavior-first checks without claiming strict RED/GREEN evidence.

## Tasks

- [x] CVL-01 — Codify the reference-derived “visual presence” and presentation-mode rules in the frontend design guide.
  - Route: delegated writer because the overall change crosses multiple non-trivial files.
  - Check: the guide names hierarchy, depth, iconography, density, semantic accents, composition diversity, and mode differentiation with concrete do/don't rules.
  - Evidence: `docs/frontend-ui-design-rules.md` section 10 (“Presencia visual y diversidad de presentación”, 10.1–10.9) plus two new checklist items in section 9.
- [x] CVL-02 — Update Candidate Applications contracts for the proposed Cards and List information architectures.
  - Route: delegated writer; tests and implementation are one bounded behavior unit.
  - Check: Cards assert a two-column desktop grid and full Card hierarchy; List asserts compact horizontal rows with distinct structure; invariant contracts remain.
  - Evidence: `frontend/src/features/candidate/applications-workspace.test.tsx` and `frontend/tests/e2e/candidate-workspace.spec.ts`.
- [x] CVL-03 — Implement the proposed Candidate Applications Cards/List UI with installed shadcn primitives.
  - Route: delegated writer due multi-file write trigger.
  - Check: search/filter/order/count/link/status/read-only behavior remains identical while the two views provide materially different scanning experiences.
  - Reopened after visual QA: Cards match the intended composition, but List still rendered as one joined rail instead of the proposal's separate rounded row surfaces; the real search input was 32px inside a 40px group; mobile card footers compressed dates/actions too tightly.
  - The bounded correction fixed the List surfaces and mobile footer. Independent runtime re-measurement found the real search `<input>` at 38px because `h-full` fills only the bordered group's inner height.
  - Closed by the final narrow correction: the product-local `InputGroup` now uses `h-11`, so the `h-full` control fills a 42px inner box (≥40px) with no raw pixel value and no shared primitive edit. Evidence: `frontend/src/features/candidate/applications-workspace.tsx` and `frontend/src/features/candidate/applications-workspace.test.tsx`, re-checked after the focused run below passed.
- [x] CVL-04 — Verify focused unit, type/lint/diff, browser accessibility/responsiveness/density, and visual parity evidence.
  - Route: independent `gentle-ai-verify` after native assessment was unavailable because the package-local binary is missing.
  - Evidence: 29/29 focused Vitest, 6/6 Chromium, clean diff check, active LSP error probe with zero diagnostics, and four parent-inspected runtime captures with the requested distinct compositions.

## Acceptance Criteria

- The design guide makes “correct but lifeless” output a review failure and defines observable criteria rather than vague taste language.
- The Applications page follows the proposal's clear hierarchy: page introduction, elevated filter surface, results/view toolbar, then content.
- Cards render as a two-column desktop grid with identity/icon header, status Badge, divided metadata, cover-letter block, and footer date/action.
- List renders as compact horizontal surfaces with identity, status/source, cover-letter/dates, and action columns.
- Cards and List retain the same underlying application IDs, order, facts, and vacancy truth but do not share a near-identical layout.
- Controls remain keyboard accessible, targets remain at least 40px where independently actionable, and all states have visible focus.
- Desktop/mobile remain overflow-clean and whole-document Axe clean at serious/critical levels.
- No mutation request, local/session storage write, dependency addition, or shared primitive edit occurs.

## Progress

- Exploration complete: all five screenshots were visually inspected by the parent session.
- Repository mapping complete through `gentle-ai-explore`; installed Card, Badge, Button/buttonVariants, InputGroup, ToggleGroup, Empty, Separator, and existing semantic status tokens are sufficient.
- Worktree incident closed: one read-only Git state command ran in the base checkout, mutated nothing, and the correct linked worktree was subsequently confirmed on `feature/candidate-dashboard-prototype`.
- At exploration time the candidate redesign work was still uncommitted; relevant files already contained prior approved implementation and had to be edited in place without reset/stash/checkout.
- CVL-01 through CVL-03 were implemented in place by one bounded writer. At that point no commit, push, or PR was created because the parent had not authorized commits and the writes sat uncommitted in the shared working tree; the verified slice was later committed (see Delivery Evidence).
- CVL-03 reopened after visual QA and corrected in bounded follow-ups (independent List row surfaces, mobile footer stacking, and a measured 42px search input). CVL-04 then closed with independent browser, accessibility, side-effect, density, and parent visual evidence.

### Implementation notes

- The workspace now leads with a real page introduction (`h2` “Postulaciones” plus the unchanged read-only disclosure), one elevated filter `Card` (search left, status pill rail right, scrollable on mobile), and a quiet results/view toolbar above the content.
- Cards mode is a true `grid-cols-1 lg:grid-cols-2` grid of rich vertical `Card`s: identity medallion + title/company, status `Badge` via `CardAction`, a `border-b` header divider, a two-column metadata row with functional icons, a wrapping cover-letter block, and a `border-t` footer with the update date and the vacancy link (`buttonVariants` + arrow). The footer stacks (`flex-col`) on narrow widths and returns to left/right alignment from `sm` (`sm:flex-row sm:justify-between`).
- The card footer carries the **updated** date and the vacancy action; the body metadata row carries **Fuente + Postulada**. The paraphrase put the applied date in the footer, but `frontend/src/app/(candidato)/candidato/postulaciones/page.test.tsx` is outside this unit’s edit surfaces and requires exactly two `<time>` elements per row with `createdAt` first and `updatedAt` second, so the applied date cannot live in the footer slot. Status also stays inside a `<dl>` (header slot, `sr-only` “Estado” term) because that same frozen test reads the first `dl dd` of each row as the status text.
- List mode is a one-column `<ul data-pf-applications-list>` with `gap-3` and no `divide-y`: each `<li>` is the presentation marker and wraps its own independent rounded `Card size="sm"` surface (`data-pf-application-row-surface`), whose `CardContent` holds the four desktop scan columns (identity, status/source, cover letter plus both dates, action). No shared facts grid with Cards mode, and the row surface deliberately has no `CardHeader`/`CardFooter`.
- The search control is the real `<input>`, not the group: the product-local `InputGroup` uses `h-11` and `InputGroupInput` keeps `h-full`, so the 1px group border leaves a 42px inner box and the measured control is ≥40px. No raw pixel value and no shared primitive edit; the contract asserts `h-11` on the group and `h-full` on the control.
- No dependency, shared primitive edit, fixture change, dashboard edit, network call, storage write, or router side effect was introduced.

## Verification Evidence

- `corepack pnpm exec vitest run src/features/candidate/applications-workspace.test.tsx src/app/\(candidato\)/candidato/postulaciones/page.test.tsx` → 2 files passed, **29 tests passed**.
- `corepack pnpm exec tsc --noEmit` → clean (exit 0).
- `corepack pnpm exec eslint src/features/candidate/applications-workspace.tsx src/features/candidate/applications-workspace.test.tsx tests/e2e/candidate-workspace.spec.ts` → clean (exit 0).
- `git diff --check -- <edited paths>` → clean (exit 0); note that the two untracked artifacts (`docs/frontend-ui-design-rules.md`, this task file) are not covered by `git diff --check`.
- Independent browser suite: 6/6 candidate workspace tests passed.
- Runtime captures: four screenshots, 0px overflow, one H1, four stable rows, Cards grid 2 columns desktop / 1 mobile, List median height lower than Cards at both viewports, zero serious/critical Axe findings, console/page errors, mutation requests, or storage writes.
- Visual QA rejected final parity: List uses one joined rail rather than separate rounded row surfaces; mobile card footers compress content; the search input itself measures 32px.
- Correction round (bounded, after the rejection): `corepack pnpm exec vitest run src/features/candidate/applications-workspace.test.tsx src/app/\(candidato\)/candidato/postulaciones/page.test.tsx` → 2 files passed, **29 tests passed**; `corepack pnpm exec tsc --noEmit` → clean (exit 0); `corepack pnpm exec eslint src/features/candidate/applications-workspace.tsx src/features/candidate/applications-workspace.test.tsx` → clean (exit 0); `git diff --check -- frontend/src/features/candidate/applications-workspace.tsx frontend/src/features/candidate/applications-workspace.test.tsx odd/tasks/candidate-visual-language-refresh.md` → clean (exit 0). Browser E2E and visual capture were not re-run by the writer: the three corrected gaps still need browser/visual re-verification in CVL-04.
- Final narrow correction (search hit area): `corepack pnpm exec vitest run src/features/candidate/applications-workspace.test.tsx src/app/\(candidato\)/candidato/postulaciones/page.test.tsx` → 2 files passed, **29 tests passed**; `corepack pnpm exec tsc --noEmit` → clean (exit 0); `corepack pnpm exec eslint src/features/candidate/applications-workspace.tsx src/features/candidate/applications-workspace.test.tsx` → clean (exit 0); `git diff --check ...` → clean (exit 0), and the untracked task file reports 0 whitespace errors under `git diff --check --no-index /dev/null`.
- Final independent acceptance: **29/29 focused Vitest** and **6/6 Chromium** passed; edited-path `git diff --check` passed; active LSP error probe returned zero diagnostics (two files confirmed clean, one clean-unconfirmed because its server is silent-on-clean).
- Final runtime manifest: four captures, actual search input **42px**, all filters/toggles/live links **40px**, 0px overflow, one H1, stable four-row order, no serious/critical Axe findings, errors, non-GET/HEAD requests, or storage. Cards are 2 columns desktop / 1 mobile; List has four independent Card-backed rows and remains denser (desktop medians 311.69/97.69px; mobile 411.53/233.25px).
- Parent visual inspection confirmed the requested composition: rich independent two-column Cards, independent compact horizontal List surfaces, and clean structurally distinct mobile fallbacks. Captures: `/tmp/peopleflow-candidate-visual-language-refresh/`.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Merge of this verified slice into the user-selected target worktree is pending. Push, PR creation, merge, deployment, and remote operations remain unauthorized and were not performed.
