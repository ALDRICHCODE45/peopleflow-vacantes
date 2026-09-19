# Company careers prototype

## Status
- Workflow: ODD
- Delivery: feature branch chain
- Branch: `feature/company-careers-prototype`
- Base: `cf2942198ecf90858382999c3b1d545d7321534e`
- Worktree: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-company-careers-prototype`
- Current task: CCP-02 review and commit
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
- [ ] **CCP-03 — Enriched vacancy cards:** Create a reusable richer vacancy card using department, skills, benefits, excerpt, salary/work metadata, and company link; integrate into the company page and improve the global board only where contracts remain honest. Forecast: 300–400 lines.
- [ ] **CCP-04 — Enriched canonical vacancy detail:** Extend `/vacantes/[jobId]` with prototype disclosure, role requirements/skills/benefits, and an accessible company profile block linking to the careers page; preserve canonical/SEO/not-found and truthful action boundaries. Forecast: 300–400 lines.
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

## Next step
Run native review for CCP-02, then expose the isolated worktree through a dev server for human browser review before CCP-03.
