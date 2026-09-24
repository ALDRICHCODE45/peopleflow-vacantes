# Candidate CV Action Menu Refinement

## Objective

Replace the multi-button footer trays in `/candidato/cvs` with one contextual DropdownMenu in each CV Card header, while preserving every frozen CV fact and keeping all underlying document actions truthfully unavailable.

## Product Decision

- A card with one direct action may expose it in place.
- Two or more peer actions belong in a contextual DropdownMenu attached to the entity header.
- The CV menu trigger is enabled because it only discloses available choices; every underlying CV action remains disabled and non-mutating.
- The single page-level upload action remains directly exposed and disabled.
- This explicit correction supersedes the earlier CV contract that counted every affordance as a native disabled Button; action capability remains unchanged.

## Visual Authority

- Current CV screenshot: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-24-09-15-30_5360x2520.png`
- Candidate Dashboard single-action reference: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-24-09-17-11_5360x2520.png`
- Existing Candidate Applications list menu and installed CardAction/DropdownMenu primitives.

## Scope

- Remove CardFooter from both CV Cards.
- Add a 40px ellipsis DropdownMenu trigger in CardAction/CardHeader for each CV.
- Primary CV menu: Reemplazar and Descargar, both disabled.
- Secondary CV menu: Reemplazar, Descargar, and Usar como principal, all disabled.
- Preserve exact labels, icons, facts, primary-first order, filenames, summary, upload action, shared unavailable explanation, and existing stable action hooks where practical.
- Update focused CV contracts, route integration contracts, candidate E2E, and the durable frontend design guide.

## Constraints

- No upload/download/replace/primary mutation, network, storage, success, persistence, or preview capability.
- Menu items remain disabled and linked to the shared visible unavailable explanation; triggers are disclosure controls, not document actions.
- Keep `cv-workspace.tsx` server-renderable; composing the installed client DropdownMenu is allowed, but do not add `"use client"` to the workspace.
- Use installed `CardAction`, `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `Button`, and lucide icons.
- No shared primitive, fixture, model, route data, package, lockfile, global CSS, shell, employer, or backend edits.
- No commit, push, PR, merge, deploy, or remote operation without explicit authorization.

## Tasks

- [x] CVAM-01 — Codify and contract the one-direct-versus-many-menu rule.
  - Status: done.
  - Route: bounded delegated writer over the CV contracts and design guide.
  - Check: the rule allows metadata plus one CTA in CardFooter but forbids a footer used only as a multi-button tray.
- [x] CVAM-02 — Move CV actions into header DropdownMenus.
  - Status: done.
  - Route: same bounded writer over the CV workspace and focused tests.
  - Check: two 40px accessible triggers; two/three disabled items; zero CardFooters; exact action inventory/copy/icons; upload remains the only direct disabled action.
- [x] CVAM-03 — Reconcile route and candidate browser contracts.
  - Status: done.
  - Route: bounded E2E reconciliation after parent structural readback.
  - Check: keyboard menus open/close; disabled items never navigate or mutate; truthfulness/storage/network contracts remain clean.
- [x] CVAM-04 — Verify unit/route/type/lint/Chromium/Axe/responsive visuals.
  - Status: done.
  - Route: independent verifier after implementation.
  - Check: desktop/mobile/dark captures show compact equal-purpose Cards without footer trays; zero overflow; Axe serious/critical zero; parent accepts screenshots.

## Acceptance Criteria

- Each CV Card header has one ellipsis trigger named `Acciones de <CV label>` with at least a 40px hit area and visible focus.
- The primary menu exposes exactly two disabled menuitems; the secondary exposes exactly three.
- No CV Card renders CardFooter, direct replace/download/make-primary Button, enabled action item, link, form, input, or handler.
- Opening a menu is functional; choosing document actions is impossible and makes no side effect.
- The shared unavailable note remains visible and programmatically describes both menu triggers and disabled items.
- Mobile menus stay within the viewport; filenames, roles, facts, and Cards retain the approved hierarchy.
- The design rule is scoped: one direct CTA may remain exposed; two or more peer actions use a menu; CardFooter remains valid for metadata plus one primary CTA.

## Progress

- User identified the footer button tray as inconsistent with the Dashboard's direct single-action pattern and explicitly requested contextual header menus.
- Read-only exploration confirmed installed CardAction/DropdownMenu support and the canonical 40px ellipsis trigger pattern.
- A bounded delegated writer changed only the CV workspace, focused test, CV route test, and frontend design guide.
- Both CV Cards now use direct CardAction header menus with 40px ellipsis disclosure triggers; the primary menu defines two disabled items and the secondary defines three.
- CardFooter is removed entirely, upload remains the sole direct disabled document action, and all frozen facts/order/summary/empty-state behavior remains unchanged.
- The design guide now scopes the durable rule: metadata plus one CTA may use CardFooter; two or more peer actions use DropdownMenu; a footer may not be only a multi-button tray.
- Parent structural readback confirmed the allowed file boundary, installed primitive composition, exact labels/hooks/icons, server-component boundary, and clean diff check.
- Native assessment remains unavailable because the package-local Gentle AI v3.4.0 binary is missing; independent verification is required.

## Verification Evidence

- Writer ran no test/type/lint/browser commands.
- Parent structural readback and `git diff --check` are clean.
- Independent core verifier: focused Vitest 2 files / 29 tests PASS; TypeScript exit 0; scoped ESLint exit 0.
- The candidate E2E now contracts the closed inventory, Enter/Space menu opening, exact two/three disabled item sets, Escape focus return, ≥40px targets, stable URL, and unchanged clean traffic/storage audit.
- Independent E2E verifier: TypeScript exit 0; candidate E2E ESLint exit 0; exact combined CV/Settings Chromium test 1/1 PASS.
- The targeted verification run updated only expected ignored Playwright metadata and the already-running preview log; tracked status and protected listener PIDs stayed unchanged.
- Fresh scripted CV acceptance passed four representative closed/open light/mobile/dark cases with zero overflow, zero serious/critical Axe findings, clean request/storage/console/page audits, and in-viewport menus; evidence is under `/tmp/peopleflow-candidate-cv-action-menu-refinement-final/`.
- The first full candidate suite attempt was 8/9 because Chromium itself crashed during the final all-route matrix after five of ten matrix cases; that failed attempt remains distinct.
- The matrix then passed 1/1 in isolation across all ten route/viewport cases, justifying one fresh full-suite retry without a product edit; the crash root cause remains unknown.
- The fresh full candidate suite passed 9/9 in 24.3s, including the final ten-case responsive/Axe/storage/network matrix.
- Parent visual review accepted all four fresh screenshots: natural Card heights, no footer tray or empty lower band, menus anchored and in viewport, readable light/dark presentation, and acceptable contextual overlay on mobile.
- LSP checked four changed TypeScript paths: three clean; the E2E file reported only existing informational spell-check findings for Spanish route/copy terms, with no error or warning diagnostics.
- Focused Vitest: 2 files / 29 tests PASS.
- TypeScript: exit 0.
- Scoped implementation/route ESLint: exit 0.
- Scoped candidate E2E ESLint: exit 0.
- Targeted combined CV/Settings Chromium: 1/1 PASS.
- First full candidate Chromium attempt: 8/9 because Chromium crashed during the final matrix; preserved as failed evidence.
- Isolated matrix diagnostic: 1/1 PASS with all ten route/viewport cases asserted.
- Fresh full candidate Chromium retry: 9/9 PASS in 24.3s; final matrix 10.1s.
- Four-case visual inspector: PASS; zero overflow; 20–25 Axe rules per case; zero serious/critical findings; no request/storage/console/page errors; 40px triggers; 49.9–71.3px menu items.
- Evidence: `/tmp/peopleflow-candidate-cv-action-menu-refinement-final/manifest.json` and four sibling screenshots.
- `git diff --check`: clean. Protected preview and fixture listener PIDs remained unchanged.
- Native Gentle assessment/review remains unavailable because the package-local v3.4.0 binary is missing.

## Delivery Evidence

- Implementation commit: `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Merge of this verified slice into the user-selected target worktree is pending. Push, PR creation, deployment, and remote operations remain unauthorized.
