# Candidate Settings Workspace

## Objective

Replace Candidate Cuenta with a real `/candidato/configuracion` workspace inspired by the supplied Settings reference: compact section navigation, grouped preference rows, purposeful switches/selects, and clear Notifications, Appearance, and Security sections without copying the reference literally.

## Product Decisions

- Canonical route: `/candidato/configuracion`.
- UI label and CandidateHeader H1: `Configuración`.
- Remove the old `/candidato/cuenta` route; do not keep a duplicate alias or redirect in this prototype.
- Notification switches are interactive in memory for the current browser session only and reset on reload.
- Notification switches never write storage, call a backend, show a save/success state, or claim persistence.
- Theme is a real setting and may use the existing `pf-theme` preference infrastructure.
- Two-factor authentication remains visible but natively disabled; no enrollment, activation, or security-state claim is allowed.
- Do not add visible demo/mock/prototype/local-only disclaimer copy.

## Visual Reference

- `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-23-17-19-30_5360x2520.png`

The reference authorizes the layout idea—compact settings rail, spacious grouped rows, descriptive copy, switches, and selects—not its branding, exact copy, density, or navigation chrome.

## Scope

- Replace Cuenta in the candidate sidebar, account menu, layout route matrix, route page, feature workspace, tests, and candidate e2e map.
- Preserve the shared CandidateShell, full candidate `max-w-screen-2xl` root geometry, single padding owner, and responsive/dark-theme behavior.
- Build one client Settings workspace with no fetch, timers, randomness, cookies, sessionStorage, or notification-preference localStorage.
- Add an official shadcn/Base UI Switch primitive only if it can be added without dependency or lockfile changes; do not hand-roll switch semantics.
- Compose a compact in-page navigation rail for `Notificaciones`, `Apariencia`, and `Seguridad`, collapsing naturally on mobile.
- Use grouped Item/Field rows on restrained Card surfaces, not one Card per setting.
- Notification section: interactive session-only switches for new matching vacancies, application updates, recruiter messages, and weekly summary.
- Appearance section: real Theme Select with System/Light/Dark using existing theme utilities.
- Security section: disabled two-factor authentication switch plus truthful unavailable password action; no fake authentication state.
- Keep only minimal account context if needed; do not recreate Perfil or the former identity fact sheet.

## Constraints

- No visible prototype disclaimer, save-success message, persistence claim, fake auth/session state, notification delivery claim, backend call, unsupported route, or dead navigation.
- No identity hero, duplicated profile facts, or UUID exposure.
- Do not add language, density, privacy, billing, or other controls without real product behavior.
- Switches and selects must have programmatic labels, visible focus, keyboard support, and at least 40px independent hit areas.
- Token-only color, no raw colors/manual dark palette/translucent `bg-card/40`/fixed heights/raw pixel widths.
- Preserve existing theme behavior and ensure Settings-driven theme changes do not create unrelated storage keys.
- Do not edit CV files, employer files, backend, package manifests, lockfiles, or protected services.
- No commit, push, PR, merge, deploy, or remote operation without explicit authorization.

## Tasks

- [x] CSW-01 — Migrate Candidate navigation and route contracts from Cuenta to Configuración.
  - Status: done.
  - Route: second bounded delegated writer over route/sidebar/layout/nav-user contract surfaces.
  - Check: exactly five candidate destinations remain; `/candidato/configuracion` is canonical and active for nested paths; `/candidato/cuenta` is removed from product code/tests.
- [x] CSW-02 — Add the reusable official Switch primitive and deterministic Settings state contract.
  - Status: done; browser-level interaction remains part of CSW-05.
  - Route: first bounded delegated writer; shared primitive addition requires Base UI preset fidelity and no dependency/lock change.
  - Check: Switch exposes native accessible semantics; notification state is client-memory only; theme uses only existing preference helpers.
- [x] CSW-03 — Implement the reference-inspired Settings composition.
  - Status: done; visual acceptance remains part of CSW-05.
  - Route: first bounded delegated writer over the unused Settings feature and its focused contract.
  - Check: compact rail plus grouped Notifications/Appearance/Security rows; no profile copy; full-width responsive layout; 2FA disabled and truthful.
- [x] CSW-04 — Update feature, route, shell, layout, nav-user, and candidate e2e contracts.
  - Status: done.
  - Route: one bounded writer/reconciliation pass after implementation.
  - Check: session-only alerts toggle without storage/network; theme changes through `pf-theme`; route navigation, dark mode, side-effect boundaries, and old-route absence are covered.
- [x] CSW-05 — Verify unit/route/type/lint/diff plus full candidate Chromium, Axe, responsive geometry, side effects, and fresh visual evidence.
  - Status: done after a distinct infrastructure-failed attempt and fresh accepted rerun.
  - Route: independent verifier after parent structural readback.
  - Check: all commands pass; 375px/1440px overflow is zero; switches/labels/focus/hit areas pass; no unsupported persistence/security claims; parent accepts light/dark/mobile captures.

## Acceptance Criteria

- Candidate navigation shows `Configuración` and resolves only `/candidato/configuracion` for this destination.
- Settings root matches sibling candidate workspace content edges with no narrower inner max-width.
- The page uses one H1 from CandidateHeader and real H2 section headings with accessible in-page navigation.
- Notification switches are keyboard-operable and update only component memory; reload resets them; no storage/network/success copy is emitted.
- Theme Select correctly applies System/Light/Dark through existing infrastructure and uses only `pf-theme` storage.
- Two-factor authentication and password controls are visibly disabled and never imply active protection or a successful change.
- No demo/mock/local disclaimer, identity-profile duplication, fake data-save claim, UUID, dead link, or unsupported destination appears.
- Light/dark/mobile presentation follows the established PeopleFlow visual language and the reference's composition principles.
- Final tests and visual evidence pass or failures are reported without reclassification.

## Progress

- User rejected a Cuenta/profile copy and explicitly selected `/candidato/configuracion`.
- User selected session-only notification interaction and required no new visible prototype disclaimers.
- Read-only exploration mapped the Cuenta route/navigation/test references and confirmed theme is the only persisted setting supported today.
- `@base-ui/react@1.7.0` already provides the official Switch API; the project can add the Base UI shadcn-style primitive without dependency or lockfile changes.
- The route page must remain server-only; session-only notification state belongs in a client Settings leaf, while only the existing theme helper may write `pf-theme`.
- Implementation order was safely adjusted: first add the unused Switch/Settings feature and focused tests; then migrate route/navigation/contracts/E2E together once the feature exists.
- The account trigger descriptor will become `Espacio personal`, and the account menu destination will become `Configuración`, so product-facing Cuenta language does not linger or turn Settings into a Perfil copy.
- The first delegated slice added only the unused Base UI Switch primitive, client Settings workspace, and focused contract test; the old Cuenta route remains untouched until migration.
- Settings now has a compact real-anchor rail, three H2 section Cards, four memory-only notification switches, one real theme Select through existing helpers, and truthfully disabled security controls without profile duplication or visible disclaimer copy.
- Parent structural readback confirmed the three-file boundary, client-only feature boundary, full-width single-padding root, installed primitive composition, exact state defaults, and no direct storage/network/timer/router capability.
- Native assessment remains unavailable because the package-local Gentle AI v3.4.0 binary is missing; its fail-closed plan requires independent verification before route migration.

## Verification Evidence

- Writer authored 501 lines across three new files and ran no tests/build/browser commands.
- Parent `git diff --check` is clean.
- First independent core verification: TypeScript and scoped ESLint passed; focused Vitest ran 11 tests with 10 passing and one failing because a source-text assertion matched `role="switch"` inside documentation rather than authored JSX.
- Structural verification also identified a real reusable-primitive boundary issue: caller props could override the required native Button render contract because `{...props}` followed `nativeButton` and `render`.
- Theme hydration is covered, but focused behavior must additionally exercise selecting Sistema/Claro/Oscuro and prove only the existing theme helper/storage path is used.
- This first core verification remains failed and is not reclassified as passing.
- The bounded correction now omits `nativeButton`/`render` from public Switch props and spreads caller props before the authoritative native-root configuration.
- The brittle comment match was removed without weakening DOM semantics checks, and focused behavior now selects Claro, Oscuro, and Sistema while asserting writes remain limited to `pf-theme` through the existing helper.
- Parent diff check is clean; LSP found no errors in one file and was silent/inconclusive on two TypeScript files.
- The second rerun kept TypeScript/ESLint green but timed out on the real portaled Select under jsdom. A test-only native-select adapter now exercises the workspace's controlled value/change boundary; Chromium remains responsible for the installed popup.
- The third rerun passed 12/12 focused tests, TypeScript, and ESLint, but remained fail-closed because the storage removal assertion allowed additional keys even though implementation inspection found none.
- The final bounded test correction now asserts the exact removal key list equals only `pf-theme`; no product source changed in that correction.
- Final core acceptance passed 12/12 focused Vitest, TypeScript, and scoped ESLint. It proved Base UI Switch authority/semantics, memory-only notification behavior, exact theme set/remove keys, three section anchors, disabled security controls, and source boundaries.
- The actual Base UI Select popup, route integration, browser geometry, dark/mobile presentation, and Axe remain explicitly pending for CSW-04/05.
- The coupled migration now deletes the old AccountWorkspace and `/candidato/cuenta` route/tests, adds the server-only `/candidato/configuracion` page/test, and updates sidebar, account menu, layout, shell, NavUser, and candidate E2E contracts.
- Candidate navigation remains five destinations; the new destination and H1 are `Configuración`, the account menu points to it, and the trigger descriptor is `Espacio personal`.
- E2E contracts now cover memory-only notification defaults/toggling/reload, installed Select theme changes with exact `pf-theme` audit entries, disabled security controls, three section anchors, old-route 404, and the full responsive/Axe matrix.
- Parent structural readback found and fixed one route-test-only TypeScript issue where a no-props component had been wrapped with `ComponentProps<...>` as an unknown spread. Product source was unchanged; parent diff check is clean.
- First full verification passed 73/73 focused Vitest and scoped ESLint, then failed closed because stale ignored `.next/types` still imported the deleted Cuenta page and preview 3100 was offline; browser/visual commands were withheld.
- Incident diagnosis proved the product route migration was correct, PID 287637 was stale, 4011 remained healthy, and a fresh Next dev startup would regenerate route types without manual `.next` deletion.
- Parent restarted only the authorized preview with the correct pnpm invocation. New PID 1209446 is ready; Configuración returns 200, Cuenta returns 404, and regenerated route types contain Configuración with no Cuenta entry.
- The infrastructure-failed verification remains distinct and is not reclassified as passing.
- Fresh accepted evidence at `/tmp/peopleflow-candidate-settings-workspace-approved/`: 73/73 focused Vitest, TypeScript exit 0, scoped ESLint exit 0, candidate Chromium 9/9, and inspector 51/51 on both the initial and refined focus-sampling run.
- Browser acceptance proved five destinations, Configuración exact/nested activation, Espacio personal account context, Cuenta 404 without redirect, notification click/keyboard/reload behavior, disabled security, and the real Base UI Select with exact `pf-theme` set/set/remove audit.
- Geometry: 24px desktop and 16px mobile root padding, 240px desktop rail, no narrower inner cap, zero overflow, and all measured Settings links/controls at least 40px.
- Axe serious/critical: 0 with 18/18/17 rules across desktop light, mobile light, and desktop system-dark. All visual requests were same-origin GET/HEAD with no storage/cookie writes, API/protected/foreign traffic, console errors, or page errors.
- Parent inspected the accepted desktop light, mobile light, and system-dark full-page PNGs and approved hierarchy, density, wrapping, Switch distinction, disabled-security treatment, and reference-inspired rail/main composition.
- At that point no work-unit commit had been created because commits were not yet authorized; delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commits: `bf1cef9` — `feat(ui): add candidate workspace primitives` (the official `Switch` foundation added for Settings) and `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`, with the `Switch` primitive supplied by `bf1cef9`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.

## Next Step

Merge of the completed Candidate CVs and Configuración work units into the user-selected target worktree is pending. Push, PR creation, and publication remain unauthorized.
