# Candidate Dashboard Visual Refresh

## Objective

Redesign `/candidato/dashboard` to match the user-approved candidate dashboard proposal: a centered, compact, shadcn-first overview with clear hierarchy, semantic status accents, contextual icons, recent-application rows, profile progress, and a stronger CV summary.

## Problem

The current dashboard is factually correct but visually flat. Its hand-built translucent bordered sections give every surface equal weight, KPI cards lack contextual anchors, recent applications are generic rows, profile completeness has no progress visualization, and dashboard status dots still use legacy grayscale/violet chart tokens instead of the canonical semantic status palette.

## Why

The user approved the richer Candidate Applications language and explicitly authorized applying the same visual-presence standard to the Candidate Dashboard. The supplied proposal shows a denser and more legible scanning hierarchy without requiring new business capabilities.

## References

- Target proposal: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-41-18_5360x2520.png`
- Current dashboard: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-13-41-27_5360x2520.png`
- Visual-language rules: `docs/frontend-ui-design-rules.md`
- Original dashboard task: `odd/tasks/candidate-dashboard-prototype.md`

## Design Read

A calm, compact candidate SaaS dashboard for understanding search progress in seconds: neutral large surfaces, PeopleFlow violet as the primary accent, blue/amber/green/red only for semantic application states, purposeful icons, and no decorative noise.

## Scope

- Preserve the existing candidate shell, root `max-w-screen-2xl`, single padding owner, route boundary, frozen fixtures, and props-only server-component data flow.
- Keep the dashboard content on the same full candidate workspace measure as Perfil, Postulaciones, CVs, and Cuenta; the inner stack must not introduce a narrower `max-w-*` constraint or additional horizontal padding.
- Replace hand-built dashboard surfaces with installed shadcn `Card`, `Badge`, `Item`, `Progress`, `Empty`, and `buttonVariants` composition.
- Keep the exact four derived metrics: 4 applications, 2 in process, profile completeness from 13 fields, and 2 CVs for the frozen fixture.
- Keep the three most-recent applications in deterministic `updatedAt` order, with exactly two live vacancy links and one honest historical no-link row.
- Replace legacy dashboard status colors with canonical semantic tones: `submitted` → `status-info`, `in_review` → `status-review`, `hired` → `status-success`, `rejected` → `status-danger`.
- Add the proposal's stacked status bar plus text legend and the profile's native Progress visualization.
- Preserve honest empty/incomplete states, Spanish copy, real links, accessibility, responsive behavior, and read-only/no-persistence semantics.

## Constraints

- Do not edit candidate shell/sidebar/header/theme, route data, fixtures, models, shared primitives, global CSS, employer surfaces, backend, package manifests, or lockfiles.
- No invented metric, notification count, recruiter contact, upload/download action, generated-CV claim, mutation, storage, fetch, auth/session claim, or new dashboard capability.
- Cards and Item rows use real semantic hierarchy; headings remain real headings and status meaning never relies on color alone.
- Live navigation remains a real Next `Link`; historical vacancies remain non-links.
- Independently actionable targets remain at least 40px with visible focus.
- No raw colors, candidate-only theme overrides, fixed heights, or raw pixel-width utilities.
- Responsive acceptance is required at 375px and 1440px, with no document overflow.
- Do not contact or restart protected services `127.0.0.1:3001` or `127.0.0.1:4010`.
- No commit, push, PR, merge, deployment, or remote publication without explicit user authorization.

## Delivery

- Strategy: bounded delegated writer followed by independent verification and parent visual inspection.
- Native RDD review: unavailable because the package-local Gentle AI v3.4.0 binary is missing; do not claim native review.
- Effective TDD mode: ordinary behavior-first contracts; no active strict-TDD configuration has been established for this slice.
- Target implementation surfaces: dashboard overview component and its focused tests; preserve page/e2e hooks so route tests need no source edits.

## Tasks

- [x] CDVR-01 — Update dashboard contracts for the approved shadcn hierarchy and semantic status language.
  - Status: completed.
  - Route: delegated writer because implementation spans multiple non-trivial files.
  - Check: 53/53 focused tests protect Card/Item/Badge/Progress/Empty composition, full-width candidate workspace alignment, canonical status tones, stable facts/order/links, server-component purity, existing hooks, and the stable metric-value E2E hook.
- [x] CDVR-02 — Implement the candidate dashboard visual refresh without changing data or capabilities.
  - Status: completed.
  - Route: bounded delegated implementation with parent structural and visual readback.
  - Check: final desktop/mobile/dark evidence shows the KPI, recent applications, status distribution, profile Progress, and CV summary hierarchy with preserved frozen truths.
- [x] CDVR-03 — Verify focused unit, type/lint/diff, Chromium accessibility/responsiveness/side effects, and fresh visual evidence.
  - Status: completed after two failed attempts and one fresh passing rerun; failed attempts remain distinct evidence.
  - Route: independent `gentle-ai-verify`.
  - Check: unit/type/lint/diff and 7/7 Chromium passed; 375px and 1440px are overflow-clean; Axe serious/critical is zero; no mutation/storage/browser error occurred; parent accepted the captures.
- [x] CDVR-04 — Correct first-pass browser failures without broadening dashboard capabilities.
  - Status: completed.
  - Route: bounded delegated correction over the dashboard component, focused test, and candidate E2E selector.
  - Check: dashboard aligns with sibling candidate roots; titles/CTA/filename remain readable; `Principal` passes dark contrast; recent rows are compact; stable KPI selector passes.
- [x] CDVR-05 — Give the profile Progress an explicit accessible name and settle the mobile recent-header flow.
  - Status: completed.
  - Route: small direct correction because both changes were local, mechanical, and isolated by independent evidence.
  - Check: Progress exposes `aria-label="Perfil completo"`; the unit contract protects it; the exact Axe route matrix passes; CardDescription remains below its mobile heading.

## Acceptance Criteria

- Dashboard root keeps the established candidate `max-w-screen-2xl` measure and one padding owner; its inner stack uses the full available width with no narrower `max-w-*` or duplicate horizontal padding, matching the other candidate screens exactly.
- Intro, KPI row, recent applications/status distribution, and profile/CV row form a clear descending hierarchy.
- Four KPI Cards use contextual icons, exact derived values, descriptive labels, native Card anatomy, and no invented trends.
- Recent applications render as three semantic Item-backed rows in deterministic order with status Badge, updated date, and truthful live/historical action treatment.
- Status distribution renders a proportional semantic segmented bar plus four text labels and counts.
- Profile Card renders native Progress with honest percentage/field counts and existing missing-field guidance.
- CV Card renders the existing primary document and facts without download/upload claims.
- Empty application/CV states remain honest and composed with installed primitives.
- Existing `data-pf-*` hooks, three canonical workspace destinations, server-component purity, immutable props, and no-side-effect guarantees remain intact.
- Final unit/type/lint/diff/browser/accessibility/visual checks pass or are reported honestly.

## Progress

- User authorized the dashboard redesign after approving the final Candidate Applications List.
- Parent visually inspected target/current screenshots and confirmed the target hierarchy: compact KPI Cards, recent applications, segmented status distribution, profile Progress, and primary-CV summary.
- Read-only repository exploration mapped all derived facts, data flow, tests, primitives, and frozen edit boundaries.
- The user identified the first implementation's `max-w-5xl` inner measure as a dashboard-only alignment defect; the final inner stack uses the same full candidate workspace measure as Perfil, Postulaciones, CVs, and Cuenta.
- Delegated implementation and correction preserved frozen derivations, exact recent ordering, canonical links, historical no-link state, pure server-component behavior, and no new capability.
- Native assessment remained unavailable because the package-local Gentle AI v3.4.0 binary is missing; the fail-closed plan was satisfied with independent verification.
- Final parent structural and visual readback accepted the component, focused contracts, candidate E2E hook, full-width geometry, compact list treatment, mobile flow, and dark/light presentation.

## Verification Evidence

- Failed attempt 1 remains at `/tmp/peopleflow-candidate-dashboard-visual-refresh/`: command checks passed, but Chromium stopped on the stale KPI selector and visual/Axe review found title/CTA/filename clipping plus dark `Principal` contrast.
- Failed attempt 2 remains at `/tmp/peopleflow-candidate-dashboard-visual-refresh-final/`: visual geometry and standalone Axe passed after CDVR-04, but the exact Chromium route matrix found the unnamed Progress.
- Final independent Vitest: 53/53 across the overview, route, and candidate shell contracts.
- Final TypeScript `--noEmit --incremental false`: exit 0.
- Final focused ESLint for component, test, and candidate workspace E2E: exit 0 with no warnings.
- Final candidate Chromium suite: 7/7, including desktop/mobile Axe route matrix.
- Final visual/runtime manifest: `/tmp/peopleflow-candidate-dashboard-visual-refresh-approved/manifest.json`.
- Final captures: `light-desktop.png`, `light-mobile.png`, `dark-desktop.png`, plus full-page variants in the same directory.
- Final runtime facts: one h2, four h3, eight Cards, KPI 4/2/100%/2, three recent Items, one CV Item, four status segments, Progress=100 named `Perfil completo`, exact recent order/statuses/dates, two live vacancy anchors, and one historical non-anchor.
- Final geometry: root content and inner width are 1096px with 24px root padding at 1440px; 343px with 16px root padding at 375px; inner `max-width` is `none`; sibling Cuenta edges match; horizontal overflow is 0px.
- Final dashboard-owned link targets: five of five are 40px high. The known 32px shared-sidebar links remain pre-existing and outside this slice.
- Final Axe serious/critical: zero in light desktop, light mobile, and dark desktop. `Principal` contrast measured 6.65:1 light and 8.36:1 dark.
- Final side effects: GET/HEAD only; no cookies, storage writes, protected/foreign traffic, console errors, or page errors.
- Parent visual inspection accepted the final light desktop, full mobile, and dark desktop captures: no dashboard-only side inset, truncation, awkward header flow, nested-card rows, or factual clipping remains.
- Parent LSP probes returned zero error/warning diagnostics; the servers remain silent-on-clean, so clean confirmation is technically inconclusive rather than positively published.
- Verification rewrote only allowed/ignored test-result bookkeeping; no manual cleanup was performed.
- At that point no commit had been created because repository policy still required separate explicit user authorization; delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commits: `bf1cef9` — `feat(ui): add candidate workspace primitives` (the native `Progress` visualization used by the profile-completeness Card) and `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`, with the `Progress` primitive supplied by `bf1cef9`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Merge of this verified slice into the user-selected target worktree is pending. Push, publication, review, and deployment remain separate unauthorized decisions.
