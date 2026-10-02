# Semantic Badge System

## Objective

Replace the fragmented badge styling with one shadcn-first semantic variant system: compact pastel surfaces, reduced rounding, consistent leading status dots, token-safe dark mode, and no changes to frozen status facts or Spanish labels.

## Visual Direction

The current references show two mismatched treatments: thin outlined application statuses and a saturated full-violet primary-CV badge. The preferred references use compact softly filled rectangles, modest corner radius, semantic text/background pairs, and a small leading dot for state/category meaning.

## Decisions

- Use `rounded-md` instead of the current near-pill `rounded-2xl` geometry.
- Add shared `accent`, `info`, `review`, `success`, `danger`, and `neutral` Badge variants.
- Status badges opt into one decorative leading dot through the shared Badge API; the Spanish label remains the accessible source of meaning.
- Application states map without changing vocabulary: `submitted → info`, `in_review → review`, `hired → success`, `rejected → danger`.
- Active publication/member states use `accent` or `success`; paused/invited states use `review`; closed states use `neutral`.
- Completeness, primary-role, featured, metadata, skills, counters, sources, and read-only labels remain non-status badges and therefore do not receive a status dot. They may use a semantic pastel variant where appropriate.
- Keep `destructive` for API compatibility, but express it through the semantic danger tokens rather than raw red palette classes.
- Keep filters, toggles, tabs, and other interactive controls outside the Badge primitive.

## Constraints

- Preserve every domain status value and Spanish label.
- Preserve the existing `--status-*` light, dark, and system-dark token values.
- Use shared Badge variants instead of repeated feature-local color recipes.
- Do not change candidate/employer behavior, persistence, routes, fixtures, or protected services.
- Maintain truthful enabled/inert placeholder semantics and accessible text labels.
- Do not push, open a pull request, deploy, release, or mutate remote/protected services.

## Tasks

- [x] **BADGE-01 — Establish the primitive contract:** Added semantic variants, tokenized destructive styling, optional decorative status dot, reduced radius, and focused primitive tests in `b9b67e5`.
- [x] **BADGE-02 — Migrate product status badges:** Replaced duplicated application/pipeline/publication/member tone maps and the raw pipeline-route status span with semantic variants while preserving labels and facts in `f7e76fa`.
- [x] **BADGE-03 — Reconcile remaining badge consumers and guidance:** Migrated divergent dashboard/featured/role treatments, kept neutral chips/counters distinct, updated affected tests, and recorded the durable design rule in `7698fc3`.
- [x] **BADGE-04 — Verify and close:** Stabilized the full-suite runner, completed focused/full unit, TypeScript, ESLint, production build, LSP diagnostics, Axe, and isolated light/dark responsive visual acceptance, then corrected the final raw dashboard status surface in `2089524` and `44c234c`.

## Initial Audit

- Duplicated four-state color maps exist in candidate applications, candidate overview, and employer pipeline.
- The company dashboard table maps the same states to generic `secondary/outline/default/destructive` variants.
- Employer vacancy/member states duplicate manual class and dot maps.
- The employer pipeline route and public job detail contain raw span-based badge treatments.
- Neutral metadata chips and interactive filters are separate concepts and must not be forced into status variants.
- Existing status tokens meet the established contrast contract and remain the color source of truth.

## Evidence

- `b9b67e5 feat(ui): add semantic badge variants`
- Focused Badge tests: 1/1 file, 17/17 tests passed under Node 22.23.2.
- TypeScript and focused ESLint passed with no warnings.
- `badge.tsx` contains no raw `red-*` palette class and no conflict marker.
- Pi Lens still reports unresolved installed `@base-ui/react/*` subpaths on both the changed Badge and unchanged shadcn primitives such as `button.tsx`; project `tsc --noEmit` resolves them successfully, so this is retained as a workspace-LSP limitation rather than a source error.
- `f7e76fa feat(ui): unify product status badges`
- BADGE-02 focused verification: 7/7 files and 146/146 tests passed; TypeScript and focused ESLint passed under Node 22.23.2.
- Final callback-annotation verification: 2/2 files and 61/61 tests passed; TypeScript and focused ESLint passed with zero warnings.
- Product status badges now expose exact semantic `data-variant` and `data-dot` contracts; counters, match scores, skills, filters, metadata, and completeness remain dotless.
- `f7bb55b fix(ui): resolve Badge Base UI imports` switched the Badge primitive to package-root Base UI exports; 17/17 Badge tests, TypeScript, focused ESLint, and refreshed LSP diagnostics passed.
- `7698fc3 feat(ui): complete semantic badge migration`
- BADGE-03 focused route/component verification: 8/8 files and 214/214 tests passed. Employer dashboard tests retained their non-failing zero-size Recharts warnings.
- Read-only TypeScript (`--incremental false`), focused ESLint, and `git diff --check` passed under Node 22.23.2.
- The data-table helper's dynamic test RegExp was replaced with a safe accessible-name predicate; its focused suite passed 46/46 and Pi Lens reported no remaining finding.
- BADGE-04 preserved three failed verification attempts: two default `pnpm run test` runs and one explicit `--pool=forks` run each completed 103/103 files and 1,388/1,388 assertions but exited 1 with `[vitest-worker]: Timeout calling "onTaskUpdate"`; none is reclassified as passing.
- A bounded serial-file diagnostic passed 103/103 files and 1,388/1,388 tests without the RPC timeout. Installed Vitest types confirm that `fileParallelism: false` overrides min/max workers to 1, so `2089524 test(frontend): stabilize full Vitest suite` added only `--no-file-parallelism` to the default test script.
- The updated default script then passed 103/103 files and 1,388/1,388 tests; TypeScript, ESLint, and the production build passed. The build generated 15/15 static pages and reported 18 routes.
- Pinned browser acceptance under Node 22.23.2 and pnpm 10.34.5 passed 14/14 candidate/employer Chromium tests and 8/8 light, dark, desktop, and mobile visual cases. The visual manifest at `/tmp/peopleflow-semantic-badge-system/manifest.json` recorded zero horizontal overflow, console errors, page errors, or requests to ports 3001/4010/4011.
- Manual screenshot inspection found one missed raw `Activa` pill in the employer dashboard. `44c234c fix(frontend): unify dashboard vacancy badges` replaced it with the shared `accent` Badge and leading dot. Test-first evidence was 2 expected failures plus 12 passes before implementation, then 14/14 focused passes; an independent verifier also passed TypeScript and ESLint.
- Final post-correction verification passed 103/103 files and 1,390/1,390 tests with no worker timeout, TypeScript, ESLint, and the production build under Node 22.23.2 and pnpm 10.34.5. The refreshed build again generated 15/15 static pages and reported 18 routes.
- Final employer browser regression passed 5/5 Chromium tests with scoped Axe checks and 8/8 refreshed visual cases. Screenshots confirmed the compact semantic dots in candidate application states, vacancy publication states, pipeline stages, dashboard vacancies, and candidate rows in both light and dark responsive layouts.
- Final Pi Lens LSP probing reported zero diagnostics across the ten principal Badge migration surfaces; six paths remained technically inconclusive because the TypeScript server is push-only and silent on clean re-checks. Project TypeScript compilation is the authoritative clean result.
- Residual non-failing output remains unchanged: jsdom canvas/WebGL limitations, zero-size Recharts warnings, one HTML nesting/hydration warning, and webpack large-string cache warnings. Public-job browser specs remain intentionally excluded because they require protected fixture services.

## Delivery Boundary

Local implementation commits are authorized under the ongoing Badge request. Push, pull request, deployment, release, further package installation, remote operation, and protected-service mutation remain unauthorized.
