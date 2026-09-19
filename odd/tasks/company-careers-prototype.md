# Company careers prototype

## Status
- Workflow: ODD
- Delivery: feature branch chain
- Branch: `feature/company-careers-prototype`
- Base: `cf2942198ecf90858382999c3b1d545d7321534e`
- Worktree: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-company-careers-prototype`
- Current task: CCP-04 review and commit
- Push/PR: not authorized

## Goal
Build a frontend-only public company careers prototype where a company can present its identity, who it is, what it does, a photographic cover, and its vacancies. Improve public vacancy cards and the canonical vacancy detail using the fictional enrichment fields introduced by NVS-05–10, without changing backend or API contracts.

## Design read
Public B2B careers microsite for candidates, with a confident editorial-tech language, real photography, restrained violet brand accents, strong typography, and calm motion. Design dials: variance 7, motion 4, density 4. Avoid generic glassmorphism, AI-purple mesh heroes, centered template layouts, fake metrics, and duplicate CTAs.

Prototype subject: `Acme`, treated explicitly as a fictional Mexican technology company. The page's single job is to help a candidate understand the company and evaluate its open roles.

## Route and data decisions
- Add `/empresas/[companyId]` under the existing public route group and `PublicShell`.
- Keep `/vacantes` as the global board.
- Keep `/vacantes/[jobId]` as the only canonical vacancy detail URL.
- Join company profile and enriched vacancy fields locally in the view layer using existing `company.id` / job ids.
- Keep `jobItemSchema`, `jobsListSchema`, `api/*`, request-path inventory, backend, and write contracts unchanged.
- Mark company/profile enrichment as fictional prototype data.
- Use the existing PeopleFlow theme/tokens and one real photographic cover asset; do not invent verification, candidate, popularity, or performance metrics.

## Constraints
- Strict TDD from `openspec/config.yaml`; Node 22.23.2.
- Preserve the source recovery worktree and NVS-11 standby state byte-for-byte.
- Keep every implementation work unit at or below 400 authored additions+deletions.
- Technical artifacts in English; visible UI copy in Spanish.
- Responsive, keyboard accessible, reduced-motion aware, light/dark compatible.
- No push, PR, merge, release, backend, dependency, API, schema, or transport changes without explicit authorization.
- Work-unit commits are required; browser and human acceptance happen after implementation slices.

## Tasks
- [x] **CCP-01 — Prototype contracts and fixtures:** Added pure company-profile and enriched-job view models, fictional Acme fixture, disclosure, and strict unit tests. No React, fetch, schema, or transport changes. Authored 383/400 lines. Verification: 12/12 focused, 35/35 adjacent, TypeScript and exact-scope ESLint PASS. Commit evidence: `6646dc8e71bbf0b7166268374c424f78e7c06ee5`.
- [x] **CCP-02 — Company careers route:** Built `/empresas/[companyId]` with an asymmetric photographic hero, identity/about/work sections, compact facts, truthful vacancy seam, not-found behavior, metadata, and focused tests. Authored 370/400 lines. Verification: 11/11 focused, 34/34 adjacent, TypeScript, exact-scope ESLint, and Next build PASS. Commit evidence: `9a9534f7a751ffdda49bafae4c33ac207a5a44bc`.
- [x] **CCP-03A — Company vacancy cards:** Created the reusable richer vacancy card plus frozen local prototype job fixtures and rendered both fictional Acme roles on the company page. No API fetch or global-board change. Authored 399/400 lines. Verification: 25/25 focused, 352 adjacent writer regression, TypeScript, exact-scope ESLint, and Next build PASS; independent verifier PASS after two corrected findings. Commit evidence: `38fe435ef3a8e40b80e39f2e70386a5f680ef8f2`.
- [x] **CCP-03B — Global board card integration:** Replaced the existing board row with the reusable card and opportunistically enriched only known prototype ids while preserving wire-only fallback, filters, pagination, empty/error states, and long-content behavior. Updated the stale initials-tile browser contract to assert semantic card structure. Authored 384/400 lines. Verification: 8/8 focused, 23/23 adjacent, TypeScript and exact-scope ESLint PASS; two focused Chromium scenarios passed in the writer harness; independent verifier PASS. Commit evidence: `974209da693dc14a9da984654375b46f1e165331`.
- [x] **CCP-04 — Enriched canonical vacancy detail:** Extended `/vacantes/[jobId]` with prototype disclosure, role requirements/skills/benefits/pay cadence/closing date, and an accessible company profile link; preserved canonical/SEO/not-found, safe text, and truthful action boundaries. Updated two stale Playwright company-name locators to exact matching. Authored 384/400 lines. Verification: 23/23 focused, 59/59 adjacent, TypeScript and exact-scope ESLint PASS; full detail Chromium suite 16/16 PASS; independent verifier PASS. Commit evidence: pending.
- [ ] **CCP-05 — Visual polish and responsive states:** Apply the selected design system, real cover asset, loading/empty/error treatment, reduced motion, responsive geometry, light/dark contrast, and cross-page consistency without unrelated redesign. Forecast: 250–400 lines.
- [ ] **CCP-06 — Integrated browser acceptance:** Run desktop/mobile light/dark Playwright, axe smoke, keyboard/focus, no-overflow, truthful-copy, route/SEO, regression suites, and request-boundary checks; request human visual acceptance.

## Acceptance criteria
- Company page communicates identity before vacancies and fits the hero thesis in the initial desktop viewport.
- Cover photography is real and carries meaningful alt/decorative treatment.
- Vacancy cards are substantially more useful without fabricating backend guarantees.
- Detail remains canonical at `/vacantes/[jobId]` and clearly separates fictional enrichment from wire data.
- No apply/save/verified/popularity claims are introduced.
- Existing `/vacantes` filters, pagination, error/empty states, and transport inventory remain intact.
- No horizontal overflow at 375px or 1440px; visible focus; WCAG A/AA axe smoke has no serious/critical candidate-caused issues.

## Evidence
- CCP-01: independent verifier PASS under Node 22.23.2 and pnpm 10.34.5; no browser claim for this pure-model slice.
- CCP-02: independent verifier PASS under Node 22.23.2 and pnpm 10.34.5; browser/axe/human visual acceptance remains deferred.
- CCP-03A: independent verifier initially found mutable exported entries and unsafe excerpt truncation; both were corrected and reverified PASS at 399/400 authored lines.
- CCP-03B: independent verifier PASS; the old decorative initials assertion was intentionally replaced by semantic H3/canonical link/company link/two-child card evidence. The port 3001 dev server was restarted after a production build overwrote its `.next` cache.
- CCP-04: independent verifier initially found two strict-mode substring locator conflicts after adding `Conoce a Acme`; both Playwright assertions now use exact matching and reverified PASS. `vacante-detalle.spec.ts` passed 16/16 in Chromium; the identical cross-cutting assertion remains covered semantically because that serial file has an unrelated pre-existing first-test failure.

## Next step
Commit CCP-04, record its identity, attempt native review, and confirm the live enriched detail route before CCP-05 visual polish.
