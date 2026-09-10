# Tasks: Frontend Public Job Discovery

## Review Workload Forecast

| Field | Value |
| ------- | ------- |
| Estimated changed lines | 1,100–1,500 authored lines across five reviewable PR slices, plus coherent pnpm lockfile and shadcn-generated primitive output |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 bootstrap/tooling → PR 2 preset foundation and minimal root → PR 3 API contracts and URL/data logic → PR 4 list/detail UI and states → PR 5 browser/a11y evidence and final hardening |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

The estimate counts authored additions plus deletions. `frontend/pnpm-lock.yaml` and shadcn-generated output are included in the complete snapshot but may use the approved generated-only `size:exception` when a coherent generated result cannot be split. Handwritten application source remains split into reviewable work units at or below 400 changed lines. The five slices use tracker branch `feat/frontend-foundation`; each work unit records focused verification, runtime verification or `N/A`, snapshot/stat evidence, and an exact rollback boundary.

## Preset fidelity contract

Preset `b27M1Ev2` is the authoritative visual bootstrap. Its confirmed values MUST remain intact: Rhea style, Neutral base color, Violet theme, Neutral chart color, Inter heading and body typography, Lucide icons, Default radius, Default/Solid menu treatment, and Subtle menu accent. Tasks must not substitute Geist, generic tokens, custom radius scales, hand-recreated theme values, another icon family, or ad hoc primitive overrides. Menu/chart settings are preserved for future surfaces only; this change installs no charts and creates no employer menus.

## State ownership reconciliation (authoritative maintainer decision)

A later authoritative maintainer decision supersedes the original design's rejection of TanStack Query and is binding for all remaining implementation tasks:

- TanStack Query orchestrates every application-facing API request server-side: SSR-first list/detail reads execute feature-owned `queryOptions` through `fetchQuery` on a fresh request-scoped server `QueryClient`.
- A fresh server `QueryClient` is created per request/render boundary; never a module-global or cross-request shared client.
- No `QueryClientProvider`, `HydrationBoundary`, dehydrated state, or client TanStack Query cache is used in this slice; result rendering stays server-side, and a client cache would require a future demonstrated client data consumer with a separately designed browser-safe query function and refetch policy.
- `requestJson` remains the low-level server-only transport beneath that orchestration; it is never browser-reachable.
- Zod validates every network boundary with feature-owned schemas.
- URL parameters are authoritative for discovery filters and cursors.
- Zustand is reserved for demonstrated client-local cross-component state that the URL and TanStack Query cannot own; it is NOT added in this slice, and no Zustand dependency or store may appear.
- SSR-first rendering, no browser-direct API access, no Next route-handler proxy, and `cache: "no-store"` freshness are all preserved.

Tasks 3.2, 3.3, 3.4, 4.2, 4.4, and 5.2 below carry the corresponding wording. `specs/public-job-discovery/spec.md` remains implementation-neutral and unchanged.

## Candidate and commit accounting

- All checkboxes remain unchecked until the corresponding implementation commit lands.
- Strict TDD behavioral work is ordered RED → GREEN → TRIANGULATE → REFACTOR. The production-neutral bootstrap is a prerequisite and is not a behavioral RED.
- Tests and relevant docs travel with the behavior they verify. A GREEN task and its TRIANGULATE/REFACTOR work may share one coherent commit only when focused tests, runtime evidence, and rollback boundaries are complete.
- Work-unit commits must leave a coherent start and finish state, use an outcome-focused Conventional Commit message, and remain independently removable where practical.

## 1. Bootstrap prerequisite and frontend-local verification (PR 1)

### 1.1 Prerequisite — production-neutral exact project and shadcn bootstrap

- [x] Create the exact standalone Next.js 15 application shape under `frontend/` before shadcn initialization: App Router, `src/` directory, pnpm, Node 22, and TypeScript alias `@/*` → `./src/*`; create/pin `frontend/package.json`, `frontend/pnpm-lock.yaml`, `frontend/.nvmrc`, `frontend/next.config.ts`, `frontend/tsconfig.json`, `frontend/eslint.config.mjs`, `frontend/postcss.config.mjs`, `frontend/vitest.config.ts`, and `frontend/playwright.config.ts` without asking shadcn to choose or regenerate the framework. From `frontend/`, inspect the current CLI/help and decode the authoritative preset with `pnpm dlx shadcn@latest preset decode b27M1Ev2`; initialize this existing project using current `init --preset b27M1Ev2` semantics with Base UI explicitly selected (`--base base` when supported, otherwise the explicit current interactive option), never an assumed default. Inspect and correct `frontend/components.json` and `frontend/tsconfig.json` before installing any component so `components` → `@/components`, `ui` → `@/components/ui`, `@/*` → `./src/*`, and resolved UI output is `frontend/src/components/ui/`. Verify with `pnpm dlx shadcn@latest info --json` and `pnpm dlx shadcn@latest preset resolve --json`; block on any preset identity/value, Base UI, Tailwind v4, Lucide, framework/RSC, alias, or resolved-path mismatch. Do not use `pnpm dlx shadcn@latest apply --preset ... .`; `apply b27M1Ev2` is reserved for an already initialized shadcn project and is not this blank-project task. Add local scripts/dependencies for frozen install, typecheck, lint, unit tests, E2E, accessibility, and API-offline build, then verify startup and commands from `frontend/`; browser runtime is `N/A` until routes exist. Rollback is limited to the bootstrap files, lockfile, and any coherent shadcn-generated initialization snapshot. <!-- sdd-owner: implementation -->

## 2. Shared preset foundation and minimal public root (PR 2)

### 2.1 RED — define shell, theme, asset, and root expectations

- [x] Add failing Vitest/RTL and Playwright expectations for `frontend/src/app/layout.tsx`, `frontend/src/app/(marketing)/page.tsx`, `frontend/src/components/brand/`, `frontend/src/components/shells/`, and `frontend/src/app/globals.css`: `lang="es-MX"`, one minimal root `h1`, one clear “/vacantes” link, no root API call or broad client boundary, PeopleFlow assets, semantic light/dark tokens, safe focus, Inter typography, exact preset identity, and no unsupported marketing actions; run focused `cd frontend && pnpm test` and root Playwright commands (RED until routes exist). Rollback is limited to these root/foundation tests. <!-- sdd-owner: implementation -->

### 2.2 GREEN — consume the verified preset and implement shared foundation

- [x] From `frontend/`, inspect the current shadcn docs/help and registry behavior before any primitive work. For each needed primitive, run current `pnpm dlx shadcn@latest docs <component...>` and preview/diff with `view`, `add --dry-run`, and applicable `add --diff <file>` routes; install only the primitives required by this slice, never wholesale. Inspect every generated file after installation and re-run `info --json` and `preset resolve --json`. Implement `frontend/src/app/layout.tsx`, `frontend/src/app/globals.css`, `frontend/src/components/brand/`, `frontend/src/components/shells/PublicShell.tsx`, `frontend/src/app/(marketing)/page.tsx`, and approved `frontend/public/brand/` assets using the resolved Base UI APIs, `next/font` Inter for heading/body, `next/image`, Rhea/Neutral/Violet semantic tokens, Default radius, Default/Solid menu treatment, Subtle menu accent, system light/dark preference, and no theme toggle. Keep CLI primitives only in `frontend/src/components/ui`; keep shell/root compositions outside that directory. Verify typecheck, lint, unit tests, build without API availability, and the focused root browser smoke test. Rollback is this foundation candidate plus its reviewed generated snapshot. <!-- sdd-owner: implementation -->

### 2.3 TRIANGULATE — validate root, exact preset, and visual accessibility

- [x] Run root browser and axe checks at representative desktop/mobile widths in both color schemes; assert the decoded/resolved `b27M1Ev2` values are Rhea, Neutral base, Violet theme, Neutral chart, Inter heading/body, Lucide, Default radius, Default/Solid menu, and Subtle menu accent, and assert `info --json` reports Base UI, Tailwind v4, Lucide, `@/*` → `./src/*`, and UI output under `frontend/src/components/ui/`. Inspect computed typography, semantic Violet/Neutral contrast, focus, image dimensions, heading count, absence of ad hoc raw-color/custom-radius/primitive-style overrides, absence of charts/employer menus, and absence of root API requests. Run configured root Playwright/axe commands, record exact results and any `N/A` reason, and fix only foundation defects. <!-- sdd-owner: implementation -->

### 2.4 REFACTOR — stabilize shared tokens and composition

- [x] Refactor only `frontend/src/app/globals.css`, `frontend/src/components/brand/`, and `frontend/src/components/shells/` to remove duplicated navigation markup and non-semantic styling while preserving the exact preset tokens, Inter roles, Default radius, both schemes, WCAG AA focus/contrast, reduced-motion-safe transitions, and one shared shell for root and vacancy routes. Re-run typecheck, lint, unit, root browser, axe, and preset/configuration assertions; rollback only this foundation refactor. <!-- sdd-owner: implementation -->

## 3. API boundary, schemas, URL state, and formatting (PR 3)

### 3.1 RED — specify contracts before implementation

- [x] Add failing unit/page-data tests under `frontend/src/features/jobs/**` and `frontend/src/lib/**` for server-only environment validation, timeout/status/JSON classification, Zod acceptance/rejection with omitted optionals, UUID prevalidation, Mexico Spanish enum/date/salary formatting, canonical query ordering and repeated/unknown/invalid removal, exact `MXN|USD`, cursor preservation, and cursor reset on every filter change. Run focused Vitest commands from `frontend/`, record expected RED, and roll back only the contract-test commit. <!-- sdd-owner: implementation -->

### 3.2 GREEN — implement shared transport and jobs data contracts

- [x] Implement `frontend/src/lib/env/server.ts` with `server-only` and strict origin/timeout rules; implement `frontend/src/lib/api/` request, timeout, status, JSON, and safe logging boundaries; implement `frontend/src/features/jobs/{schemas,api,url,formatters}/` and `types.ts` for validated root-level “/jobs” operations exposed through TanStack Query query functions (`queryOptions`) whose `queryFn` is the only caller of the server-only `requestJson` transport and whose successful payloads are decoded with the feature-owned Zod schemas, deterministic `es-MX` output, exact scalar filters, canonical URLs, opaque cursors, and dynamic `cache: "no-store"` behavior. The `@tanstack/react-query` dependency is added here if absent; no Zustand dependency or store, browser-direct fetch, or Next proxy may be introduced. Run focused RED-to-GREEN Vitest, typecheck, lint, and mocked data-boundary commands; browser runtime is `N/A` until route composition exists. Rollback is the contract/data candidate only. <!-- sdd-owner: implementation -->

### 3.3 TRIANGULATE — test failure classification and URL invariants

- [x] Prove with focused tests timeout, network, `429`, `5xx`, unexpected `4xx`, invalid JSON, schema rejection, detail `404`, malformed UUID short-circuit, omitted optionals, AND forwarding, canonical redirect comparison, currency exactness, cursor byte-for-byte URL transport, and filter cursor reset, and that the TanStack Query query functions are the only application-facing request path over `requestJson` (no bypass reads, browser fetches, or proxies). Run the configured `cd frontend && pnpm test -- --run src/features src/lib` equivalent, inspect safe-log assertions, and record exact result and rollback boundary. <!-- sdd-owner: implementation -->

### 3.4 REFACTOR — isolate domain ownership and deterministic helpers

- [x] Refactor `frontend/src/features/jobs/{api,schemas,url,formatters,types.ts}` and `frontend/src/lib/{api,env}` so route concerns remain absent from domain modules, no browser-direct fetch or proxy exists, no cursor is decoded/logged, the TanStack Query orchestration boundary over `requestJson` remains the single request path with no Zustand store, and formatting has no hydration-dependent relative dates or invented salary periods. Re-run focused tests, typecheck, lint, and an API-unavailable production build. <!-- sdd-owner: implementation -->

## 4. Vacancy list route and navigation states (PR 4)

### 4.1 RED — activate fixture and define list behavior

- [x] Add failing RTL/page-data and Playwright tests for `frontend/src/app/(public)/vacantes/page.tsx`, `error.tsx`, and `frontend/src/features/jobs/components/` covering canonical redirect before API access, validated success/empty/error output, scalar labeled filters, desktop filter column, mobile titled Base UI Sheet, pending announcements, reset link, list semantics, optional-field omission, and next-link filter/cursor preservation. Create or activate the minimal test-only jobs HTTP fixture under `frontend/tests/fixtures/` in this RED unit; it must never become a production route or bundle. Run focused Vitest and Playwright commands and record RED; rollback only list tests and fixture activation. <!-- sdd-owner: implementation -->

### 4.2 GREEN — implement list composition, controls, and states

- [x] Implement `frontend/src/app/(public)/layout.tsx`, `frontend/src/app/(public)/vacantes/page.tsx`, `frontend/src/app/(public)/vacantes/error.tsx`, and list-owned files under `frontend/src/features/jobs/components/` for awaited Next.js 15 `searchParams`, canonical redirect, server-rendered validated data via TanStack Query `fetchQuery` on a fresh request-scoped server `QueryClient` (thin Server Components that never call `requestJson` or fetch directly and render the returned validated data directly without hydrating a client query cache), semantic rows, Spanish labels, empty/reset/error states, forward next link, and isolated `JobsNavigationIsland` pending behavior. Compose only CLI-managed primitives from `frontend/src/components/ui/`; business compositions remain in `frontend/src/features/jobs/components/`. Add no totals, sorting, multi-select, apply/auth, charts, employer menus, or unsupported fields. Run focused RED-to-GREEN tests, list Playwright tests against the fixture, typecheck, and lint; rollback is the list candidate. <!-- sdd-owner: implementation -->

### 4.3 TRIANGULATE — verify list navigation and accessibility

- [x] Run browser scenarios for unfiltered/filtered refresh and share, exact currency, AND forwarding, cursor reset/preservation, final-page omission, empty reset, 5xx/schema/timeout retry, mobile Sheet title/Escape/focus return, visible focus, long text wrapping, no horizontal overflow, both color schemes, and reduced motion. Confirm rendered controls and primitives retain semantic Violet/Neutral styling, Inter, Default radius, and no ad hoc overrides. Run configured list Playwright and axe commands, recording exact results and rollback scope. <!-- sdd-owner: implementation -->

### 4.4 REFACTOR — preserve server-first list boundaries

- [x] Refactor list components and route composition to keep API data and result rendering server-side, keep the client island limited to ephemeral pending state with job data read solely server-side through the request-scoped TanStack Query `QueryClient` (no Zustand, no client query cache, no island-held data), use FieldGroup/Field and resolved Base UI APIs, preserve the mobile `<768px` fallback and unique IDs, and remove duplicated or unsupported UI. Re-run focused tests, typecheck, lint, build, preset/configuration assertions, and fixture-offline verification. <!-- sdd-owner: implementation -->

## 5. Vacancy detail route, metadata, and not-found/error states (PR 4)

### 5.1 RED — define detail and metadata behavior

- [x] Add failing unit/page-data and Playwright tests for `frontend/src/app/(public)/vacantes/[jobId]/` and detail components covering UUID short-circuit, valid detail success, request-scoped dedupe for metadata/page, dynamic no-store reads, validated plain-text descriptions with paragraphs/line breaks, optional metadata omission, dynamic title/canonical metadata, branded `404` noindex behavior, and retryable service/schema failures. Use the fixture activated in 4.1, expanding only test-only routes/data as required; run focused frontend commands and record RED with rollback limited to detail tests/fixture additions. <!-- sdd-owner: implementation -->

### 5.2 GREEN — implement detail page and boundaries

- [x] Implement `frontend/src/app/(public)/vacantes/[jobId]/page.tsx`, `error.tsx`, `not-found.tsx`, metadata generation, and detail-owned files under `frontend/src/features/jobs/components/` using awaited Next.js 15 `params`, UUID validation before API access, render-scoped dedupe around no-store TanStack Query getJob reads executed with `fetchQuery` on the fresh request-scoped server `QueryClient` (`requestJson` as the only transport; no `HydrationBoundary` or client query cache), semantic `article`, safe React text rendering, Spanish formatting, list navigation, branded not-found, and separate retryable error states. Do not add save/share/apply/company-profile/benefits/structured sections. Run focused RED-to-GREEN tests, typecheck, lint, build, and detail Playwright tests; rollback is the detail candidate only. <!-- sdd-owner: implementation -->

### 5.3 TRIANGULATE — verify detail safety and SEO

- [x] Run browser and axe scenarios for visible detail, omitted optionals, long unsafe-looking text, malformed UUID with fixture request count zero, backend `404`, 5xx/timeout/invalid schema, metadata canonical/index rules, keyboard return link, both themes, reduced motion, and narrow/wide wrapping. Confirm detail surfaces preserve Inter, semantic Violet/Neutral hierarchy, Default radius, and absence of ad hoc overrides. Record exact configured E2E/axe results and rollback boundary. <!-- sdd-owner: implementation -->

### 5.4 REFACTOR — simplify detail rendering and metadata reads

- [x] Refactor only detail route/feature files to remove duplicate fetches, unsafe HTML-like rendering, fixed-height content, invented labels, or route-owned domain rules while keeping metadata and page output consistent. Re-run detail tests, typecheck, lint, axe, preset/configuration assertions, and API-offline production build before commit. <!-- sdd-owner: implementation -->

## 6. Browser, accessibility, visual evidence, and final hardening (PR 5)

### 6.1 RED — define the cross-route evidence matrix

- [x] Add failing Playwright/axe scenarios and fixture expectations under `frontend/tests/e2e/` and `frontend/tests/fixtures/` for root-to-list navigation, browser Back/Forward, filtered canonical URLs, opaque next cursor, list/detail success and required failure states, mobile Sheet, keyboard/focus, both themes, reduced motion, long content, no overflow, and API-offline build. Add focused configuration/visual assertions for exact `b27M1Ev2` identity and values, Inter heading/body, semantic Violet/Neutral styling, Default radius, both schemes, preserved Default/Solid menu and Subtle menu accent settings, and absence of ad hoc overrides; rely on the active fixture and record RED with rollback limited to evidence tests. <!-- sdd-owner: implementation -->

### 6.2 GREEN — complete browser, accessibility, and visual harness

- [x] Complete only the test-only fixture routes/data needed by the evidence matrix and the harness under `frontend/tests/fixtures/`, `frontend/tests/e2e/`, and local Playwright/a11y configuration; ensure fixture data never enters production bundles and application API access remains server-side. Add representative visual checks at desktop/mobile widths in light/dark schemes that verify computed Inter, semantic Violet/Neutral hierarchy, Default radius, exact resolved preset identity, no ad hoc raw-color/custom-radius/primitive-style drift, and no charts or employer menus. Run `pnpm test:e2e`, `pnpm test:a11y`, typecheck, lint, unit tests, and API-offline build; rollback is the final harness candidate and does not remove product behavior. <!-- sdd-owner: implementation -->

### 6.3 TRIANGULATE — execute complete local quality gates

- [x] Run from `frontend/` the complete sequence: `corepack pnpm install --frozen-lockfile`, `pnpm dlx shadcn@latest preset decode b27M1Ev2`, `pnpm dlx shadcn@latest preset resolve --json`, `pnpm dlx shadcn@latest info --json`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:a11y`, and `pnpm build`. Confirm preset identity/value, explicit Base UI, Tailwind v4, Lucide, Inter, aliases/resolved UI path, semantic Violet/Neutral styling, Default radius, both schemes, and no ad hoc overrides are blocking assertions; confirm no build-time API fetch, no charts, no employer menus, no backend/shared-config changes, and record generated snapshot identity plus each slice/work-unit line count. <!-- sdd-owner: implementation -->

### 6.4 REFACTOR — final bounded hardening and evidence

- [x] Apply only bounded fixes required by final evidence to `frontend/` (contrast, focus, copy, wrapping, reduced motion, fixture timing, lint/type issues, or exact preset drift), then rerun every affected focused command and the complete quality-gate sequence. Record a final review summary confirming no landing completion, auth, application, candidate/employer, backend, shared-root/config/docs, ISR, streaming-dependent, browser-direct API, chart, or employer-menu behavior was introduced; rollback names the exact final fixes. <!-- sdd-owner: implementation -->

## 7. Work-unit delivery checkpoints

### 7.1 Candidate boundaries

- [ ] For each completed work unit, inspect `git diff --stat` and `git diff --cached --stat`, confirm one purpose, tests/docs travel with behavior, the unit is independently coherent, focused/runtime results are recorded, and the rollback boundary names exact removable files; use an outcome-focused Conventional Commit message and keep authored changes near or below 400 lines where practical. <!-- sdd-owner: implementation -->

### 7.2 Delivery policy — resolved before apply

The resolved values are `delivery_strategy: ask-on-risk`, `chain_strategy: feature-branch-chain`, tracker branch `feat/frontend-foundation`, and five PR slices. `Decision needed before apply: No`. The generated-only `size:exception` is approved only for one coherent `frontend/pnpm-lock.yaml` or shadcn-generated output snapshot; it never applies to handwritten/authored application source. `apply b27M1Ev2` remains an existing initialized-project operation, not a blank-project task, and the outdated `apply --preset ... .` form is forbidden.
