# Candidate CVs Visual Refresh

## Objective

Redesign `/candidato/cvs` as a full-width, shadcn-first document workspace with stronger hierarchy, contextual iconography, truthful disabled actions, and responsive CV cards aligned with the approved Candidate Dashboard and Postulaciones visual language.

## Why

The current CV surface is factually correct but uses uniform hand-built `bg-card/40` bordered boxes, plain text roles, no contextual iconography, and raw disabled buttons. It does not meet the established visual-presence standard.

## Visual Authority

No screenshot is designated as a literal CV target. Use these code-level authorities instead:

- `docs/frontend-ui-design-rules.md`
- final Candidate Dashboard composition and full-width measure
- final Candidate Postulaciones Card/Item hierarchy
- installed shadcn Card, Badge, Button, Empty, Item, and Separator primitives

## Scope

- Preserve `/candidato/cvs`, its CandidateHeader H1, frozen fixture wiring, deterministic ordering, exact file facts, and props-only server-component boundary.
- Preserve the two frozen CVs, primary-first ordering, exact labels, dates, language, sizes, PDF format, and summary derivation.
- Preserve exactly six native disabled actions, zero enabled actions, zero links, zero forms, zero mutation/storage/network behavior, and existing `data-pf-*` hooks.
- Replace hand-built CV surfaces with installed shadcn Cards, real Card anatomy, semantic Badges, Button composition, contextual lucide icons, and an honest Empty state for the existing unreachable branch.
- Keep the full candidate root `mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6` as the single padding owner; add no narrower inner `max-w-*`.
- Use a one-column mobile / two-column large-screen card grid and natural factual wrapping.

## Constraints

- Do not edit candidate shell/sidebar/header/theme, route data, fixtures, models, shared primitives, global CSS, employer surfaces, backend, package manifests, or lockfiles.
- Do not invent upload, download, replace, preview, delete, persistence, network, success, or generated-CV behavior.
- Disabled actions remain real native disabled Buttons with their existing accessible explanation and at least 40px target geometry.
- No raw colors, manual dark palette, translucent `bg-card/40`, fixed heights, or raw pixel-width utilities.
- Do not add new visible demo/mock/prototype/local-only disclaimer copy. Existing disclaimer cleanup across previously built screens is a separate future iteration; preserve current route copy unless the user explicitly authorizes the global cleanup.
- No commit, push, PR, merge, deploy, or remote operation without explicit authorization.

## Tasks

- [x] CCVR-01 — Replace the legacy source contract with shadcn-first CV composition contracts.
  - Status: done.
  - Route: bounded delegated writer.
  - Check: focused tests preserve all facts/actions/hooks/server purity while requiring Card anatomy, Badges, Buttons, icons, full-width measure, responsive grid, and token-only paint.
- [x] CCVR-02 — Implement the Candidate CVs visual refresh without changing capabilities.
  - Status: done.
  - Route: the same bounded writer may edit only the CV workspace and focused test.
  - Check: two truthful Cards show primary/secondary roles, identity, document metadata, and disabled actions with clear hierarchy in light/dark/mobile.
- [x] CCVR-03 — Verify unit/route/type/lint/diff plus Chromium accessibility, responsive geometry, side effects, and fresh visual evidence.
  - Status: done after a distinct failed first attempt and fresh accepted rerun.
  - Route: independent verifier after parent structural readback.
  - Check: focused contracts and candidate Chromium pass; 375px/1440px overflow is zero; Axe serious/critical is zero; exact two cards/six disabled actions/zero links/forms remain; parent accepts screenshots.
- [x] CCVR-04 — Correct disabled-action legibility and unequal Card stretching.
  - Status: done.
  - Route: small direct correction isolated by browser evidence.
  - Check: all six native disabled Buttons remain unavailable but render with explicit readable disabled tokens; upload is restrained outline; Cards size to their content instead of leaving an internal blank tail.

## Acceptance Criteria

- Root geometry matches the other candidate workspaces exactly with no inner width restriction.
- Intro, summary, upload affordance, and two CV Cards form a clear descending hierarchy.
- Each CV Card uses contextual document identity, a real heading, filename, semantic role Badge, five preserved facts, and a separated disabled-action footer.
- Primary and secondary CVs remain distinguishable without relying on color alone.
- Filenames wrap naturally without clipping; facts stay readable at 375px.
- All disabled actions remain truthful, labelled, and non-mutating.
- Empty/no-primary branches remain honest and accessible.
- Final tests and visual evidence pass or failures are reported without reclassification.

## Progress

- User authorized CVs and Settings as the next candidate work.
- Read-only exploration confirmed CVs is independent and can be completed before the Settings route migration.
- A bounded delegated writer changed only `cv-workspace.tsx` and its focused test.
- The implementation now uses native Card/Badge/Button/Empty composition, real h3 document identities, contextual fact/action icons, responsive five-fact grids, and separated disabled-action footers.
- Parent structural readback confirmed the exact two-CV ordering, facts, six disabled actions, zero links/forms/inputs, immutable props, server-only boundary, full-width root, token-only paint, and no capability change.
- Native assessment remained unavailable because the package-local Gentle AI v3.4.0 binary is missing; the fail-closed plan requires independent verification.

## Verification Evidence

- Writer readback: only the two allowed CV files changed; no test, browser, service, package, or install command was run.
- Current two-file diff versus HEAD: component `+126/-53`; focused test `+128/-14`.
- Parent `git diff --check` is clean.
- First independent verification passed 29/29 focused Vitest, TypeScript, ESLint, 7/7 candidate Chromium, 51/51 runtime assertions, zero overflow, exact action/fact contracts, side-effect checks, and Axe serious/critical zero.
- First visual acceptance remained blocked: native disabled opacity made upload/outline actions too faint for the presentation bar, and the desktop grid stretched the shorter primary Card to the secondary Card height, leaving an artificial internal blank tail.
- Failed evidence remains at `/tmp/peopleflow-candidate-cvs-visual-refresh/` and is not reclassified as passing.
- CCVR-04 now renders every disabled action as a restrained outline Button with explicit full-opacity muted tokens, while preserving native `disabled` semantics and exact labels.
- The document grid now aligns items to start and Cards size naturally to their own content, eliminating the shorter primary Card's internal blank tail.
- Focused contracts protect readable disabled classes, outline upload treatment, non-stretching grid behavior, and unchanged action inventory; parent LSP and diff checks are clean.
- Fresh accepted evidence at `/tmp/peopleflow-candidate-cvs-visual-refresh-approved/`: 29/29 focused Vitest, TypeScript exit 0, ESLint exit 0, candidate Chromium 7/7, and inspector 47/47.
- All six actions remain natively disabled with 40px height, opacity 1, and measured composited text contrast of 5.00–5.20:1 in light and 7.34–7.86:1 in dark.
- Desktop Cards now size naturally at 374.53px and 422.53px; mobile Cards at 538.22px and 586.22px. Root geometry remains 24px desktop/16px mobile padding with zero overflow.
- Axe serious/critical: 0 in light desktop, light mobile, and dark desktop. Requests were same-origin GET/HEAD only, with zero storage/cookie writes, console errors, or page errors.
- Parent inspected all accepted PNGs and approved hierarchy, wrapping, action legibility, role distinction, density, and natural Card heights.
- At that point no work-unit commit had been created because commits were not yet authorized; delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Start the independently tracked Candidate Settings workspace at `odd/tasks/candidate-settings-workspace.md`.
