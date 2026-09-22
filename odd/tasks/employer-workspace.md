# Employer workspace expansion

## Status
- Workflow: ODD
- Delivery: bounded work-unit commits on `feature/company-careers-prototype`
- Worktree: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-company-careers-prototype`
- Current task: EW-06B team workspace surface
- Push/PR/merge/deploy: not authorized
- RDD: clone-local disabled; do not reactivate

## Goal
Expand the PeopleFlow employer product into a coherent recruiting workspace with a vacancy portfolio, a per-position candidate pipeline offering board and list modes, and a team/users screen. Preserve the approved employer shell, create-vacancy flow, PeopleFlow tokens, and the visual language of `design/screens` while keeping all new behavior truthful, local, and non-persistent.

## Product and route decisions
- Keep `/empresa/dashboard` and `/empresa/vacantes/nueva` intact unless a bounded integration task explicitly connects them to a new real destination.
- Add `/empresa/vacantes` for the employer vacancy portfolio.
- Add `/empresa/vacantes/[jobId]/pipeline` as the canonical per-position recruiting pipeline.
- Add `/empresa/equipo` for organization members and roles.
- Use local frozen prototype fixtures; do not extend backend, wire schemas, APIs, packages, or lockfiles.
- Vacancy publication states are local prototype states; candidate pipeline stages use the existing application vocabulary: `submitted`, `in_review`, `hired`, and `rejected`.
- Team roles stay within the existing backend vocabulary: `owner` and `recruiter`.
- Preserve Mensajes, Reportes, and Configuración as honest unresolved prototypes.
- Derive the team screen from the employer visual system because no committed team reference exists.

## Design read
High-density recruiting operations UI with calm violet-led surfaces, compact metrics, clear hierarchy, and restrained semantic accents. The committed sources of truth are `design/screens/vacantes-empresa.html`, `design/screens/sistema-empresa.html`, `design/screens/dashboard-empresa.html`, `design/screens/crear-vacante.html`, and the current approved employer shell. Avoid nested interactive rows, color-only status, undersized unlabeled icon controls, decorative gradients outside the reference language, and generic dashboard templates.

## Constraints
- Strict RED → GREEN → REFACTOR; each implementation work unit stays at or below 400 authored additions+deletions.
- Node 22.23.2 and pnpm 10.34.5.
- Spanish UI; English code, tests, filenames, and commit messages.
- Responsive at 375px, 768px, 1024px, and 1440px; visible focus; keyboard operable; reduced-motion compatible; light/dark compatible.
- No business mutations, fetches, persistence, invitation delivery, candidate movement, or fake success claims.
- Do not edit `dashboard-01-theme.module.css` or stop/reset/replace externally owned services on 3001/4010.
- Preview 3100 may be restarted only when needed for authorized browser validation; fixture 4011 remains isolated.
- Work-unit commits keep tests and docs with behavior. No push, PR, merge, or deploy.

## Tasks
- [x] **EW-01 — Employer navigation foundation:** Turned Vacantes and Equipo into real destinations, made the shared sidebar route-aware, and generalized the employer header for titles and breadcrumbs while preserving unresolved prototypes. Authored 389/400 code/test lines. Verification: 126/126 adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS. Commit: `59dea2f`.
- [x] **EW-02 — Employer vacancy model:** Added validated, deeply frozen local Nexo Labs vacancy fixtures with truthful local publication state, four-stage pipeline counts, and canonical pipeline URLs. Authored 372/400 lines. Verification: 19/19 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS. Commit: `5cc3ff0`.
- [x] **EW-03A — Employer vacancy portfolio surface:** Built the reference-faithful client surface with truthful summary metrics, accessible composable search/status filters, responsive non-clickable vacancy rows, and one semantic pipeline action per position. Authored 321/400 lines. Verification: 25/25 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after correcting empty-recovery honesty and feature-layer coupling. Commit: `7f638c2`.
- [x] **EW-03B — Employer vacancy portfolio route:** Mounted the portfolio at `/empresa/vacantes` with shared header context, metadata, semantic create-vacancy CTA, truthful prototype disclosure, and route-level tests. Authored 275/400 lines. Verification: 42/42 route+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS. Commit: `9446cf4`.
- [x] **EW-04A — Pipeline candidate model:** Added validated, deeply frozen local candidate fixtures for every vacancy, using only application-contract statuses and bounded deterministic recruiter-facing enrichment. Authored 383/400 lines. Verification: 39/39 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after correcting per-stage subset honesty, schema bounds, and Spanish copy. Commit: `3eed666`.
- [x] **EW-04B — Pipeline board surface:** Built the per-position kanban experience with four contract-aligned columns, local search, representative non-interactive candidate cards, honest sample disclosure, and contained horizontal scrolling. Authored 347/400 lines. Verification: 27/27 focused tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after correcting all Spanish count agreement. Commit: `56a73db`.
- [x] **EW-04C — Pipeline list mode and switching:** Added an accessible Tablero/Lista mode switch and responsive semantic list over the exact same filtered candidate set and search state. Authored 317/400 lines. Verification: 49/49 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS. Commit: `0061d62`.
- [x] **EW-05 — Pipeline route:** Mounted `/empresa/vacantes/[jobId]/pipeline` with exact local fixture resolution, Vacantes breadcrumb, vacancy status, truthful portfolio history/team context, non-persistence disclosure, exact candidate scoping, metadata, and framework not-found handling. Authored 398/400 diff lines including the copy correction. Verification: 74/74 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS. Commit: `44efc0e`.
- [x] **EW-06A — Team model and fixtures:** Defined six strict frozen Nexo Labs members with closed `owner`/`recruiter` roles, prototype-local `active`/`invited` states, vacancy-derived workload totals, unique identity boundaries, and one local prototype owner. Authored 377/400 lines. Verification: 18/18 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after tightening collection and whitespace invariants. Commit: `1b71dfd`.
- [ ] **EW-06B — Team workspace surface:** Build metrics, member search/status filtering, responsive non-interactive member rows, empty recovery, and token-only accessible presentation.
- [ ] **EW-06C — Team invitation affordance:** Add an inline local-only invitation form that validates input, never persists or appends a member, and explicitly reports that nothing was sent or saved.
- [ ] **EW-06D — Team route:** Mount `/empresa/equipo` through the shared employer shell with metadata, header, and truthful local-demo disclosure.
- [ ] **EW-07 — Dashboard connections:** Connect approved dashboard vacancy and pipeline entry points to the new routes without regressing metrics, chart, recent candidates, or create-vacancy behavior.
- [ ] **EW-08 — Integrated employer acceptance:** Prove live navigation, vacancy filtering, pipeline board/list switching, team UX, keyboard/focus, responsive overflow, accessibility, and zero business mutations in Chromium.

## Acceptance criteria
- Sidebar active state follows the current employer route and never marks unresolved `#` destinations active.
- Every listed employer vacancy exposes one canonical pipeline link; no clickable row contains nested controls.
- Board and list modes expose the same candidates and application states, with text labels in addition to color.
- Pipeline and team interactions are explicit prototype behavior and cause no network, storage, clipboard, or business mutations.
- Team roles remain `Propietario`/`Reclutador`; invented permissions are not implied.
- All new pages match PeopleFlow typography, spacing, surfaces, token semantics, light/dark themes, and mobile navigation.
- No horizontal document overflow at 375px or 1440px; focus indicators remain visible; serious/critical candidate-caused axe violations are zero.

## Evidence
- EW-01 implementation: `59dea2f`.
- `Dashboard`, `Vacantes`, and `Equipo` are real Next destinations; nested vacancy/team paths retain the correct active section while unresolved prototype links remain `#` and inactive.
- `SiteHeader` preserves the dashboard default and accepts a custom title, linked parent breadcrumb, and status context without duplicating shell controls.
- Strict TDD: initial focused RED covered missing routes/active state/header props; GREEN reached 42 focused tests. An adjacent dashboard expectation then failed, was corrected without behavior changes, and the full employer slice passed 126/126.
- Independent verification: TypeScript, exact-scope ESLint, `git diff --check`, and five-file LSP diagnostics PASS. Protected `dashboard-01-theme.module.css` remained untouched.
- EW-02 implementation: `5cc3ff0`.
- Six deterministic Nexo Labs fixtures validate through strict zod schemas, cover active/paused/closed states, and expose only `submitted`/`in_review`/`hired`/`rejected` candidate counts.
- Deep-freeze, exact lookup, canonical route, totals, summary, invalid-input, and source-boundary contracts passed 9/9 focused and 19/19 focused+adjacent tests; TypeScript, ESLint, diff-check, and LSP diagnostics PASS.
- EW-03A implementation: `7f638c2`.
- The portfolio derives 3 active, 1 paused, 30 in-process, and 2 closed metrics; exposes search plus four counted state filters; renders six semantic rows with exactly one canonical pipeline link each; and stays token-only and mutation-free.
- Independent verification found and reverified two corrections: an empty portfolio never offers a clear action that cannot restore results, and the employer feature owns its UTC-pinned Spanish date formatter instead of depending on the public jobs feature.
- EW-03B implementation: `9446cf4`.
- The server route reuses the single employer shell/header, mounts all six frozen vacancies, links to `/empresa/vacantes/nueva`, discloses local non-persistent data, and passed 42/42 route+adjacent tests plus TypeScript/ESLint/diff-check/LSP.
- EW-04A implementation: `3eed666`.
- Ten deeply frozen representative candidates cover all six vacancies; the backend role demonstrates all four allowed stages. Every visible stage count is bounded by its vacancy counter, schemas trim and cap recruiter-facing fields, and the UI helper states the visible sample honestly in natural Spanish.
- Independent verification: 39/39 focused+adjacent tests, TypeScript, scoped ESLint, diff-check, and six-file LSP diagnostics PASS.
- EW-04B implementation: `56a73db`.
- The board always exposes Nuevo/En revisión/Contratado/Descartado columns, filters locally by name/title/skill, renders each candidate once in a non-interactive card, contains narrow-screen overflow inside the board region, and discloses the visible sample against vacancy totals.
- Independent verification corrected and reverified natural singular/plural copy for years, comments, column aria labels, and sample totals; 27/27 focused tests plus TypeScript/ESLint/diff-check/LSP PASS.
- EW-04C implementation: `0061d62`.
- The 40px Tablero/Lista controls expose pressed state, preserve one search query and candidate set, and switch between the original board and a semantic nine-column table with contained focusable overflow and non-interactive rows.
- Independent verification: 49/49 tests, TypeScript, ESLint, diff-check, and two-file LSP diagnostics PASS.
- EW-05 implementation: `44efc0e`.
- The route resolves all six vacancies by exact id, scopes representative candidates on the server, and uses framework `notFound()` for unknown, malformed, or near-miss ids. It reuses the employer shell through the route group rather than duplicating it.
- Independent verification found and corrected one truthfulness defect: the all-stage portfolio total is now described as historical rather than currently in process. Reverification: 74/74 tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS.
- EW-06A implementation: `1b71dfd`.
- Team fixtures preserve backend role vocabulary while keeping member account state explicitly prototype-local. Recruiter workload totals are cross-checked against submitted+in-review vacancy totals, never the representative candidate-card sample.
- Independent verification tightened the parse boundary to reject surrounding identity whitespace, duplicate ids, case-insensitive duplicate emails, and any owner count other than the single local prototype owner. Reverification: 18/18 tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS.

## Next step
Implement EW-06B as the read-only team metrics/search/status-filter workspace with responsive non-interactive member rows and empty recovery.
