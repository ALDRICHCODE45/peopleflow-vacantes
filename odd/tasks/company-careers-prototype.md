# Company careers prototype

## Status
- Workflow: ODD
- Delivery: feature branch chain
- Branch: `feature/company-careers-prototype`
- Base: `cf2942198ecf90858382999c3b1d545d7321534e`
- Worktree: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-company-careers-prototype`
- Current task: CCP-R4A review and commit
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
- Render applicant counts, response-time estimates, verification, save/apply/share controls, and relative-time labels only from local prototype enrichment; keep them visually scoped as non-persistent demonstration features and emit zero business mutations.
- Use the existing PeopleFlow theme/tokens and one real photographic cover asset.
- Treat `design/screens/vacante-detalle.html`, `design/screens/vacantes-listado.html`, and the user-supplied screenshots as the visual/composition source of truth for the redesign.
- Apply the horizontal vacancy-card redesign to public cards on `/vacantes` and `/empresas/[companyId]`; leave the employer create-form `VacancyPreview` unchanged.

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
- [x] **CCP-04 — Enriched canonical vacancy detail:** Extended `/vacantes/[jobId]` with prototype disclosure, role requirements/skills/benefits/pay cadence/closing date, and an accessible company profile link; preserved canonical/SEO/not-found, safe text, and truthful action boundaries. Updated two stale Playwright company-name locators to exact matching. Authored 384/400 lines. Verification: 23/23 focused, 59/59 adjacent, TypeScript and exact-scope ESLint PASS; full detail Chromium suite 16/16 PASS; independent verifier PASS. Commit evidence: `a807d37a77a47610f18444ff3a8a0b5038853b68`.
- [x] **CCP-05 — Visual polish and responsive states:** Loaded the existing Clash Display assets globally, replaced the external placeholder cover with a provenance-pinned local public-domain WebP through `next/image`, and corrected the enriched detail heading hierarchy. Preserved the intentional OS-only public theme behavior and deferred browser-only focus/overflow/contrast decisions to CCP-06. Authored 234/400 text lines plus one 206,060-byte binary asset. Verification: 44/44 focused, 143/144 adjacent with one proven pre-existing dashboard token failure, TypeScript and exact-scope ESLint PASS; independent verifier PASS. Commit evidence: `854c72c75f57372e60c547fa22f4027e072f3ce2`.
- [x] **CCP-06 — Integrated browser acceptance:** Technical acceptance completed: desktop/mobile light/dark Playwright matrix, axe smoke, keyboard/focus, no-overflow, truthful-copy, route/SEO, regression suites, reduced motion, local asset/font loading, and request-boundary checks passed after correcting two dark-link contrast defects. Human review rejected the visual baseline and authorized a reference-faithful redesign. Contrast-fix commit evidence: `973fec9ffc51f57cdd9a14492895d5325f418d55`.
- [x] **CCP-R1 — Public shell and theme controls:** Matched the reference public navbar with PeopleFlow brand, Vacantes/Empresas/Recursos, dark-light toggle, Ingresar, and Publicar vacante; kept placeholder actions non-mutating and mobile-safe. Authored 397/400 lines. Verification: 21/21 focused, 50/50 adjacent, 27/27 Chromium board, 18/18 audit cases, zero axe nodes/overflow, target sizes and theme persistence/restoration PASS; independent verifier PASS. Commit evidence: `310f58bf6491cba0e519273a93e31497d65a5702`.
- [x] **CCP-R2 — Prototype metrics and visual primitives:** Extended local-only enrichment with applicants, response time, featured/verified state, experience and relative-time presentation; added reusable monogram, verification, label, and prototype-disclosure primitives without wire/API changes. Authored 267/400 lines. Verification: 23/23 focused, 33/33 adjacent, TypeScript and exact-scope ESLint PASS; independent verifier PASS. Commit evidence: `74b22d9212a4dee6e7abf8515aa585a6bd14b588`.
- [x] **CCP-R3A — Reference vacancy card component:** Rebuilt shared `VacancyCard` to the supplied horizontal left-content/right-salary layout with logo tile, metadata, full-DOM/clamped description, skills/benefits, enriched-only bookmark affordance, CTA, verification, responsive stacking, and hover polish. Authored 303/400 lines. Commit evidence: `2af4911395b1a976db98e73ee7287629ed89971c`.
- [x] **CCP-R3B — Card browser contracts and integration:** Updated global-board/company-page browser contracts, added a >220-code-point fixture, removed obsolete flat-card assumptions, and verified hover, responsive stacking, clamp safety, focus, prototype disclosure, wire-only exclusion, and zero business mutations. Authored 296/300 lines. Verification: 58/58 unit, TypeScript/ESLint PASS, 27/27 ordinary Chromium, 12/12 a11y/reduced-motion, and 2/2 isolated 3002/4011 long-content/company; independent verifier PASS. Commit evidence: `3ee5cc070b14e72f458a34d98db4ee06316e590b`.
- [x] **CCP-R4A — Vacancy detail header and stats:** Rebuilt the canonical detail header with a 40px breadcrumb target, monogram, featured state, title/company metadata, four reference stat cards, and the responsive two-column content/rail scaffold while preserving canonical/SEO/not-found/safe text. Authored 397/400 lines. Verification: 20/20 focused, 46/46 adjacent, TypeScript and exact-scope ESLint PASS; independent verifier PASS. Commit evidence: pending.
- [ ] **CCP-R4B — Vacancy detail content and sticky rail:** Refine responsibilities/requirements/skills/benefits into the reference structure, add colored token-only benefit tiles and the sticky salary/action/company/share rail with non-persistent affordances, then update browser contracts. Forecast: 300–400 lines.
- [ ] **CCP-R5 — Prototype interactions:** Add accessible client islands for save/apply/share/bookmark feedback with explicit prototype disclosure and zero fetch/storage/business mutations. Forecast: 250–400 lines.
- [ ] **CCP-R6 — Redesign browser acceptance:** Update obsolete truthfulness assertions to prototype-scoped contracts; run light/dark desktop/mobile Playwright, axe, keyboard, hover, overflow, canonical, safe-text, and zero-business-mutation acceptance; request human visual approval.

## Acceptance criteria
- Company page communicates identity before vacancies and fits the hero thesis in the initial desktop viewport.
- Cover photography is real and carries meaningful alt/decorative treatment.
- Public vacancy cards match the supplied horizontal reference layout on the global board and company microsite, including responsive right-rail stacking and restrained hover interaction.
- Detail remains canonical at `/vacantes/[jobId]`, closely matches `design/screens/vacante-detalle.html`, and clearly separates fictional enrichment/actions from wire data.
- Apply/save/share, applicants, response time, and PeopleFlow verification are visibly scoped as non-persistent prototype features and trigger no business mutations.
- Public pages expose a working dark/light toggle while preserving automatic system-theme behavior.
- Existing `/vacantes` filters, pagination, error/empty states, and transport inventory remain intact.
- No horizontal overflow at 375px or 1440px; visible focus; WCAG A/AA axe smoke has no serious/critical candidate-caused issues.

## Evidence
- CCP-01: independent verifier PASS under Node 22.23.2 and pnpm 10.34.5; no browser claim for this pure-model slice.
- CCP-02: independent verifier PASS under Node 22.23.2 and pnpm 10.34.5; browser/axe/human visual acceptance remains deferred.
- CCP-03A: independent verifier initially found mutable exported entries and unsafe excerpt truncation; both were corrected and reverified PASS at 399/400 authored lines.
- CCP-03B: independent verifier PASS; the old decorative initials assertion was intentionally replaced by semantic H3/canonical link/company link/two-child card evidence. The port 3001 dev server was restarted after a production build overwrote its `.next` cache.
- CCP-04: independent verifier initially found two strict-mode substring locator conflicts after adding `Conoce a Acme`; both Playwright assertions now use exact matching and reverified PASS. `vacante-detalle.spec.ts` passed 16/16 in Chromium; the identical cross-cutting assertion remains covered semantically because that serial file has an unrelated pre-existing first-test failure.
- CCP-05: independent verifier PASS. Local cover `acme-cover.webp` is 1600×900, 206,060 bytes, SHA-256 `1f1231ae8a0bf195deee5a466b2078cbacb217dc01a8a0047a3bd185761dd86f`; Commons/USDA public-domain provenance and transformation are committed alongside it. The adjacent dashboard `--brand-decorative-strong` failure is pre-existing in HEAD.
- CCP-06 technical acceptance: original matrix found five serious dark-link contrast nodes at 2.14–2.15:1. Company/detail body links now use `text-foreground` with persistent underline; independent rerun passed 35/35 focused tests, TypeScript, ESLint, and 18 browser/axe cases with zero axe nodes. Existing suites resolved to board 27/27, detail 16/16, and cross-cutting remainder 3/3; its root-link first test remains pre-existing RED. Zero business/API mutations were observed; development-only Next diagnostic POSTs were caused by pre-existing Base UI warnings on the board.
- CCP-R1: independent verifier PASS at 397/400. Real browser targets are ≥40px for logo/nav/login/toggle and ≥36px for the publish CTA; mobile hides desktop nav/login without overflow. Toggle click, `pf-theme` persistence, reload, cleanup, and system-mode restoration passed.
- CCP-R2: independent verifier PASS at 267/400. Six new fields remain local to `PrototypeJobEnrichment`; wire schemas/API decoding are unchanged. Reusable UI helpers are server-safe, noninteractive, token-only, and explicitly disclose that prototype data/actions do not connect to a backend.

## Redesign feedback
- The first visual baseline was technically accepted but human-rejected as too flat and too far from the committed design references.
- Public cards, not the employer create-form preview, own the supplied card redesign.
- Exact layout and interaction details matter more than withholding unimplemented product features; those features will render as explicitly non-persistent prototype affordances.

## Next step
Commit CCP-R4A, record its identity, attempt native review, then complete content, sticky rail and browser contracts in CCP-R4B.
