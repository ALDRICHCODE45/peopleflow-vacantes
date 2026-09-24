# Candidate Profile Redesign

## Goal

Transform `/candidato/perfil` from a flat input grid into a polished PeopleFlow profile workspace inspired by the supplied references, while preserving the frozen candidate fixture, local-only editing, validation, focus, reset, accessibility, and no-save/no-send truthfulness.

## Scope

- Redesign only the candidate profile in this phase.
- Preserve the route, profile model, draft parser, fixture, and public/backend contracts.
- Use installed shadcn/Base UI primitives and semantic PeopleFlow tokens.
- Keep technical behavior local to one mounted client view.
- Do not add persistence, transport, authentication, drag/drop, dependencies, or raw color values.

## Design Direction

- Product-like profile header with identity, role, location, and completion context.
- Clear section navigation and rich grouped surfaces instead of a uniform input matrix.
- Contextual icons, helper copy, badges, and more expressive field composition.
- Closed vocabularies use appropriate selection controls; salary and experience controls avoid a bare-number-field feel.
- Subtle hover/focus/press feedback with reduced-motion compatibility.
- Responsive single-column mobile layout and balanced desktop composition.

## Acceptance Criteria

- All 19 editable fields and language rows remain available and controlled.
- Existing Spanish labels and validation messages remain discoverable by accessible name.
- Review, first-error focus, dirty state, valid review, and reset behavior remain deterministic.
- The received frozen profile is never mutated.
- No network, storage, router, timer, randomness, or fake success behavior is introduced.
- Controls keep visible focus and at least 40px interactive targets.
- Visual paint uses semantic tokens only and adds no inline styles.
- Candidate profile focused tests, route tests, TypeScript, ESLint, and browser review pass.

## Tasks

- [x] CPR-01 — Define RED visual/composition contracts for the redesigned profile fields and workspace.
- [x] CPR-02 — Implement the primitive-rich profile field system and preserve controlled validation behavior.
- [x] CPR-03 — Implement the profile identity/completion workspace composition and action/status polish.
- [x] CPR-04 — Run focused and integrated verification, then complete desktop/mobile browser review.
- [x] CPR-05 — Strengthen the candidate shell as a visible inset dashboard card with PeopleFlow accent depth.
- [x] CPR-06 — Recompose the profile hero and primary surface from shadcn Card/Avatar primitives with a local candidate image.
- [x] CPR-07A — Replace every native profile select with controlled shadcn Select primitives.
- [x] CPR-07B — Replace the remaining native progress and hand-rolled section surfaces with shadcn Progress/Card composition.
- [x] CPR-08 — Run integrated behavior, accessibility, responsive, palette, and browser verification.
- [x] CPR-09 — Define RED contracts for literal reference hierarchy, local Unsplash portrait, and tab-bounded content.
- [x] CPR-10 — Rebuild the profile header and top actions to match the reference structure with PeopleFlow tokens.
- [x] CPR-11 — Distribute all editable profile sections across shadcn Tabs and preserve cross-tab validation focus.
- [x] CPR-12 — Run integrated laptop/mobile visual and behavioral acceptance against the supplied reference.
- [x] CPR-13 — Define RED contracts for a quieter violet PeopleFlow profile, functional-only iconography, concise fields, and the shared date picker.
- [x] CPR-14 — Extend the shared shadcn date picker for past dates and wire candidate birth date without native date input.
- [x] CPR-15 — Remove visual noise from profile cards, labels, helper copy, and cyan-heavy surfaces while preserving validation and behavior.
- [x] CPR-16 — Run focused, integrated, accessibility, and direct browser acceptance for the corrected profile.
- [x] CPR-17 — Restore native shadcn Tabs styling and recompose section Cards with CardHeader/CardTitle spacing.
- [x] CPR-18 — Verify native tabs, card-title hierarchy, accessibility, and responsive visual acceptance.
- [x] CPR-19 — Raise the shared shadcn inactive-tab text token to an Axe-safe contrast without profile overrides.
- [x] CPR-20 — Switch the profile to the native shadcn TabsList `line` variant without custom trigger paint.
- [x] CPR-21 — Record the project-wide shadcn-first design rules and verify the line tabs responsively.

## User-Directed Reference Pass

The user rejected the first visual pass as insufficiently shadcn-native and insufficiently expressive of PeopleFlow. This correction phase treats the supplied HR profile screenshot as the structural reference while preserving PeopleFlow identity and all truthful local-only behavior.

Additional non-negotiable criteria:

- Every profile control and surface uses installed shadcn/Base UI primitives; custom composition is built from those primitives.
- No native `<select>` remains in the candidate profile.
- A local, deterministic candidate portrait is rendered through shadcn `AvatarImage` with `AvatarFallback`.
- The candidate shell's existing inset-card effect is more visible through additional top/right breathing room, border depth, and semantic PeopleFlow accent treatment.
- The profile uses one strong shadcn Card composition with a reference-inspired identity header and structured information areas rather than disconnected generic fieldsets.
- PeopleFlow primary/accent tokens are visibly present in navigation, identity, progress, active states, and supporting surfaces in both themes.

## Literal Reference Correction

The user rejected the long stacked form because it does not materially match the supplied HR profile reference. This pass treats the reference hierarchy as literal rather than inspirational:

- A large photographic avatar leads a horizontal identity header.
- Primary and secondary actions sit in the upper-right of the profile surface.
- A full-width shadcn Tabs rail separates the identity header from content.
- Only the active category panel is rendered, preventing a page-length form on laptops.
- Desktop panels use the reference's asymmetric two-column card distribution; mobile collapses to one column.
- The user-provided Unsplash portrait is stored locally with provenance and rendered through AvatarImage/Fallback.
- All 19 fields, language rows, review, reset, dirty state, validation, first-error focus, and local-only truthfulness remain intact.
- Invalid review automatically activates the tab containing the first issue before focusing its control.

## Evidence

### CPR-01

- Status: complete
- RED: focused field/workspace tests failed 6 composition assertions while 21 behavioral contracts stayed green.
- Verification: independent verifier observed 35/35 focused tests, TypeScript, ESLint, and `git diff --check` passing.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-02

- Status: complete
- Result: replaced the flat field matrix with five semantic sections, contextual Lucide icons/copy, shadcn field/input composition, salary and experience adornments, richer language rows, and responsive section rhythms.
- Scope: 337 authored diff lines across the component and two test files, within the 400-line work-unit limit.
- Verification: independent verifier found no local-only behavior or accessibility regression.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-03

- Status: complete
- Result: added a truthful identity summary, local-demo context, draft-derived native completion meter, responsive hierarchy, and a sticky shadcn action/status area while keeping one local form and one polite live region.
- Route boundary: passes the exact frozen candidate identity and profile references.
- Correction: incomplete-but-valid drafts now report their actual completion percentage instead of claiming that all data are complete; 100% drafts retain the exact complete copy.
- Verification: independent verifier observed 34/34 focused tests, TypeScript, scoped ESLint, and `git diff --check` passing after the correction.
- Scope: 321 authored diff lines after excluding the prior CPR-02 integration assertion, within the 400-line work-unit limit.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-04

- Status: complete
- Automated verification: 12 Vitest files / 162 tests and 5/5 Chromium acceptance tests passed; TypeScript, scoped ESLint, `git diff --check`, and LSP error/warning diagnostics passed.
- Browser verification: HTTP 200 at `/candidato/perfil`; desktop 1440×1000 and mobile 390×844 both had 0px horizontal overflow, no clipped labels/actions, no field overlap, and no console, page, or request errors.
- Interaction verification: keyboard reached both actions; clearing the optional professional title changed completion from 100% to 90% with zero network or storage writes.
- Visual correction: replaced browser-default green progress paint with PeopleFlow cyan and moved the action footer back into normal flow so it no longer overlays form sections.
- Screenshots: `/tmp/peopleflow-candidate-profile-redesign/desktop.png`, `/tmp/peopleflow-candidate-profile-redesign/mobile.png`.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-05

- Status: complete
- Result: candidate-only shell wrapper now carries a semantic primary tint, while the inset dashboard card has additional top/right/bottom breathing room, a stronger radius, a PeopleFlow-tinted ring, and visible shadow depth at `md+`.
- Verification: 23/23 shell tests, TypeScript, scoped ESLint, and `git diff --check` passed independently; mobile remains unaffected because all frame changes are `md:`-gated.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-06

- Status: complete
- Result: one full shadcn Card now owns the profile experience through CardHeader/Title/Description/Action/Content/Footer; the reference-inspired identity header uses AvatarImage/Fallback and visible primary token treatment.
- Asset: added the original local fictional portrait `/candidate/ximena-barrera.svg` plus provenance; the route passes its same-origin path without changing the identity/profile model.
- Verification: independent verifier observed 45/45 focused tests, TypeScript, scoped ESLint, `git diff --check`, valid SVG XML, and matching provenance.
- Scope: 334 authored diff lines, within the 400-line work-unit limit.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-07A

- Status: complete
- Result: replaced education, salary-period, and per-language CEFR native selects with controlled shadcn/Base UI Select composition while keeping `null` at the primitive boundary and `""` in the draft.
- Test correction: the cancelled worker left Base UI popup interactions that stalled jsdom; focused tests now follow the repository precedent by validating rendered triggers, pure boundary mapping, structural item routing, and workspace first-error focus without opening an anchored popup.
- Verification: independent verifier observed 48/48 focused tests, TypeScript, scoped ESLint, and `git diff --check` passing; static inspection confirmed zero native selects, every required shadcn Select slot, and the indexed language trigger focus target.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-07B

- Status: complete
- Result: installed the official shadcn/Base UI Progress component, replaced the native `<progress>`, and moved all five semantic fieldsets into small shadcn Card surfaces while preserving one primary profile Card and fieldset semantics.
- Behavior: completion remains controlled by the same 10 local signals and exposes accessible `progressbar` values; the Base UI indicator owns only its required geometry style.
- Verification: independent verifier observed 48/48 focused tests, TypeScript, scoped ESLint, and `git diff --check` passing.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-08

- Status: complete
- Automated verification: 17 Vitest files / 222 tests and 5/5 candidate Chromium acceptance tests passed; TypeScript, scoped ESLint, `git diff --check`, and changed-file LSP diagnostics reported no findings.
- Browser verification: desktop 1440×1000 and mobile 390×844 returned HTTP 200 with 0px horizontal overflow, one primary profile Card, five visible section Cards, shadcn Progress track/indicator, and no native select/progress elements.
- Interaction verification: education changed from Licenciatura to Maestría through the real shadcn Select, marked the draft dirty, and restored the seeded value; the footer stayed 20px below the last section.
- Truthfulness verification: 0 non-GET requests, 0 local/session storage keys before and after, and 0 console errors, page errors, or failed requests; protected ports 3001 and 4010 were not contacted.
- Screenshots: `/tmp/peopleflow-candidate-profile-redesign/final-desktop.png`, `/tmp/peopleflow-candidate-profile-redesign/final-mobile.png`.
- Native review: unavailable because the verified Gentle AI v3.4.0 package-local binary is missing; independent verification was used as the required high-risk fallback.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-09

- Status: complete
- RED: 28 focused failures / 26 passes covered missing five-tab navigation, single active panel, upper toolbar/header ordering, size-24 photographic Avatar, local JPG provenance, nine distributed section Cards, and cross-tab first-error focus.
- Scope: approximately 140 authored test lines across two files, within the 250-line CPR-09 budget.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-10

- Status: complete
- Result: replaced the small illustrated avatar with the user-selected local Unsplash JPEG, rebuilt a large horizontal identity hero, and moved review/reset/status into an upper in-flow toolbar before the profile Card.
- Asset: `/candidate/ximena-barrera.jpg` is a real 512×512 JPEG with source id and exact URL documented in `PROVENANCE.txt`; the obsolete SVG was removed.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-11

- Status: complete
- Result: added five controlled shadcn Tabs in the reference order, renders exactly one active panel, splits the 19 fields across nine semantic Cards, and switches tabs before focusing the first validation issue.
- Verification: 3 focused files / 64 tests, TypeScript, scoped ESLint, and `git diff --check` passed independently.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-12

- Status: complete
- Final hierarchy correction: the in-flow action/status toolbar now precedes one shadcn Card; that Card owns the large photographic identity header, five-tab rail, and exactly one active field panel, matching the supplied reference instead of separating the hero from the form surface.
- Automated verification: 17 Vitest files / 228 tests and 5/5 candidate Chromium acceptance tests passed; TypeScript, scoped ESLint, and `git diff --check` passed with no failures, skips, or warnings.
- Accessibility corrections: inactive shadcn tab text was raised from a failing 4.45:1 contrast to a semantic foreground token, and the horizontally scrollable mobile tab rail now has an accessible name, keyboard focus, and visible focus ring; the whole-route Axe matrix passes at both desktop and mobile viewports.
- Browser verification: wide 2540×1060 and laptop 1366×768 both fit the Personal panel within one viewport; mobile 390×844 remains a deliberate single-column scroll. Every viewport returned HTTP 200 with 0px horizontal overflow, five tabs, one mounted panel, a 96–112px local portrait, and the expected 2/2/2/2/1 Card distribution across the five tabs.
- Truthfulness verification: zero mutation requests, storage writes, console errors, page errors, and failed requests across all inspected viewports.
- Screenshots: `/tmp/peopleflow-candidate-profile-redesign/literal-wide.png`, `/tmp/peopleflow-candidate-profile-redesign/literal-laptop.png`, `/tmp/peopleflow-candidate-profile-redesign/literal-mobile.png`.
- LSP: changed source/tests reported no error or warning diagnostics; only Spanish-copy spellchecker informational findings remained.
- Native review: inspect created no lineage because the verified Gentle AI package-local binary is unavailable; independent acceptance evidence above remains the fallback.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-13–16 — Quiet PeopleFlow correction

- Status: complete
- RED evidence: 4 focused files / 86 tests produced 13 intentional failures and 73 passes; failures map only to the violet/no-override direction, removed helper copy/icons, and shared past-date picker behavior.
- GREEN evidence: 9 focused and compatibility files / 178 tests passed, including the existing vacancy-closing-date consumers; TypeScript, scoped ESLint, and `git diff --check` passed cleanly.
- Result: candidate pages now inherit the global PeopleFlow violet primary, date of birth uses the shared shadcn Button + Popover + Calendar picker in past-date mode, all per-input/section helper prose and decorative profile icons are removed, section Cards are uniformly neutral, and disclosure/completion copy is concise without weakening local-only truthfulness.
- Direction: use the established PeopleFlow violet primary rather than the candidate cyan override; reserve accent color for actions, progress, focus, and active navigation rather than large surfaces and decorative chips.
- Density: remove every per-input helper line and section blurb from the profile; validation errors remain adjacent and accessible.
- Icon rule: keep functional icons only (date picker, add/remove language, review/reset); remove section-heading chips, field-label icons, and identity metadata decoration.
- Date rule: reuse the existing shadcn `DatePickerField` (Button + Popover + Calendar), extending it backward-compatibly so birth dates accept past civil dates while vacancy closing dates remain future-only.
- Final acceptance: 18 Vitest files / 238 tests and 5/5 Chromium candidate tests passed; TypeScript, scoped ESLint, and `git diff --check` passed without failures, skips, or warnings.
- Browser evidence: 2540×1060, 1366×768, and 390×844 returned HTTP 200 with 0px horizontal overflow, global violet `oklch(0.491 0.27 292.581)`, zero helper descriptions/decorative section icons/native date inputs, one functional date picker, and no primary paint on hero/card surfaces.
- Interaction evidence: the birth-date trigger displays `18 de junio de 1994` and opens the Spanish shadcn Calendar on `junio 1994`; the shared trigger shrinks safely and the Ubicación row gives date/city/country proportional width without overlap or truncation at laptop size.
- Truthfulness evidence: zero mutation requests, storage writes, console errors, page errors, or failed requests in all inspected viewports.
- Screenshots: `/tmp/peopleflow-candidate-profile-redesign/quiet-wide.png`, `/tmp/peopleflow-candidate-profile-redesign/quiet-laptop.png`, `/tmp/peopleflow-candidate-profile-redesign/quiet-mobile.png`, `/tmp/peopleflow-candidate-profile-redesign/quiet-datepicker.png`.
- MCP: shadcn confirmed the canonical date-picker composition and returned its component audit checklist; imports/dependencies, TypeScript, linting, browser behavior, and local image configuration were checked where applicable.
- LSP: no errors; one Next.js serializable-props warning remains on the established client-component `onChange` callback API, while TypeScript and ESLint are clean.
- Allowed source surfaces: `frontend/src/components/candidate-dashboard/candidate-theme.module.css`, `frontend/src/components/ui/date-picker-field.tsx`, `frontend/src/features/candidate/profile-form-fields.tsx`, `frontend/src/features/candidate/profile-workspace.tsx`.
- Allowed test surfaces: corresponding focused tests plus candidate profile route/E2E only when required by changed behavior.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-17–18 — Native shadcn composition correction

- Status: complete
- RED evidence: 2 focused files / 57 tests produced 3 intentional failures and 54 passes, covering the missing default Tabs variant/native triggers and missing CardHeader/CardTitle hierarchy.
- GREEN evidence: 3 focused files / 67 tests passed with TypeScript, scoped ESLint, and `git diff --check` clean.
- Acceptance correction: the installed shadcn inactive-trigger token was raised once from `text-foreground/60` to `text-foreground/70` in the shared primitive, avoiding any profile-level trigger override.
- Final accessibility: candidate Playwright acceptance passed 5/5, including the whole-route Axe matrix on desktop and mobile.
- Final focused/static checks: 4 files / 79 tests passed; TypeScript, scoped ESLint, and `git diff --check` passed without output.
- Direct browser matrix: HTTP 200 with 0px horizontal overflow at 2540×1060, 1366×768, and 390×844; mobile begins with the full active Personal tab after the bounded `justify-start` overflow accommodation.
- Side effects: zero mutation requests, storage writes, console errors, page errors, or failed requests across direct inspection.
- Verification note: one verifier submitted a malformed shell command containing an extra trailing quote; Bash rejected it before execution, then the exact authorized command passed. No check remains pending.
- Final screenshots: `/tmp/peopleflow-candidate-profile-redesign/quiet-wide.png`, `/tmp/peopleflow-candidate-profile-redesign/quiet-laptop.png`, `/tmp/peopleflow-candidate-profile-redesign/quiet-mobile.png`.
- Tabs: use the installed shadcn Tabs default variant and native trigger styling rather than the custom line rail and primary trigger paint; keep only bounded overflow/focus accommodations required on mobile.
- Cards: use shadcn `CardHeader` + `CardTitle` for every visible section title, while retaining a screen-reader FieldLegend so fieldset grouping remains semantic.
- Visual goal: give titles native card padding and separation instead of placing legends against the card edge.
- MCP evidence: official shadcn examples show unmodified `<TabsList><TabsTrigger /></TabsList>` composition and visible titles inside `<CardHeader><CardTitle />`.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

### CPR-20–21 — User-selected line tabs and shadcn-first rules

- Status: complete
- Tabs decision: use the installed shadcn `TabsList` with `variant="line"`; preserve native `TabsTrigger` styling and only the proven mobile overflow/focus accommodations.
- Design-system decision: inventory installed shadcn components and registry patterns before creating a surface; prefer native primitives and their documented subcomponent hierarchy, then add only PeopleFlow-specific layout, semantics, and accessibility adjustments.
- Confirmed composition: the profile portrait already uses shadcn `Avatar`, `AvatarImage`, and `AvatarFallback`; the profile and all nine sections use shadcn `Card`, `CardHeader`, `CardTitle`, and `CardContent`.
- Registry evidence: a read-only MCP listing exposed 471 time-sensitive `@shadcn` items, including the core UI primitives and product blocks; the durable rule requires re-querying before design work and human authorization before dependency or registry installation.
- Durable guidance: `docs/frontend-ui-design-rules.md`, linked from the root README, records primitive hierarchy, composition boundaries, semantic-token rules, Card/Avatar/Tabs examples, installed-vs-registry inventory, and a practical application-list/Kanban component map.
- RED/GREEN: the focused profile contract moved from 1 failure / 42 passes (`default` vs requested `line`) to 43/43 passes with native `TabsList variant="line"` and no trigger overrides.
- Acceptance: the initial verifier process hit external Vitest/Playwright command budgets; direct browser inspection still returned HTTP 200, 0px horizontal overflow, and zero mutation/storage/console/page/request failures at wide, laptop, and mobile. Isolated incident reruns then passed 43/43 Vitest in 6.24s and the complete 10-cell route/Axe/overflow/mutation Playwright matrix in 11.7s with a 120s per-test budget.
- Static checks: TypeScript, scoped ESLint, and `git diff --check` passed without output.
- Commit: not created at that stage (commits were not yet authorized); delivery status is recorded under Delivery Evidence.

## Delivery Evidence

- Implementation commits: `bf1cef9` — `feat(ui): add candidate workspace primitives` (the native `Progress` primitive installed for the profile completion indicator) and `0b94a4f` — `feat(frontend): complete workspace redesign and presentation cleanup` (verified product, tests, E2E, design guide, routes, and cleanup).
- Relevant to this record: `0b94a4f`, with the `Progress` primitive supplied by `bf1cef9`.
- This task record and its documentation update remain untracked and are committed later by the parent, so no hash is claimed here.
- Push, PR creation, merge, deployment, release, install, remote operation, and protected-service mutation remain unauthorized and were not performed.
- Native Gentle review remained unavailable because the package-local binary is missing; the independent verification evidence above remains authoritative.
