# Employer workspace expansion

## Status
- Workflow: ODD
- Delivery: bounded work-unit commits on `feature/company-careers-prototype`
- Worktree: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-company-careers-prototype`
- Current task: EW-08 integrated employer acceptance verified; commit authorization pending
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
- [x] **EW-06B — Team workspace surface:** Built four derived metrics, diacritic-insensitive member search, accessible status filtering, deterministic non-interactive responsive rows, complete role/status/workload facts, dynamic result announcements, and honest empty recovery. Authored 378/400 lines. Verification: 33/33 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after correcting agreement, workload completeness, and desktop accessibility. Commit: `36a532d`.
- [x] **EW-06C — Team invitation affordance:** Added an accessible inline local-only invitation prototype with owner/recruiter selection, local validation, clean attempt lifecycle, and explicit no-send/no-save feedback; it owns no collection or callback and cannot append a member. Authored 395/400 lines. Verification: 35/35 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after correcting stale error/status lifecycle. Commit: `e9a9ad1`.
- [x] **EW-06D — Team route:** Mounted `/empresa/equipo` through the shared employer shell with metadata, active navigation, consultation-only intro copy, route-level local-demo disclosure, one invitation affordance, and the six-member workspace. Authored 329/400 lines. Verification: 84/84 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS after correcting overstated management copy. Commit: `67abee2`.
- [x] **EW-07 — Dashboard connections:** Added a server-rendered `Vacantes activas` panel derived from the frozen active Nexo vacancies, with one portfolio link and one canonical per-position pipeline link per row, while preserving metrics, chart, recent candidates, and create-vacancy behavior. Excluded the reference's global-pipeline link because no truthful canonical global route exists. Authored 394/400 lines. Verification: 245/245 focused+adjacent tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS. Commit: `34dd04d`.
- [ ] **EW-08 — Integrated employer acceptance:** Live Chromium coverage now proves dashboard navigation, vacancy filtering, pipeline board/list switching, team UX, keyboard operation, desktop/mobile overflow containment, candidate-scoped accessibility, and zero network/storage/business mutations. Implementation and independent verification are complete; the work-unit commit awaits explicit authorization.

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
- EW-06B implementation: `36a532d`.
- The read-only team surface derives all metrics and filters from props, keeps rows non-interactive, stacks labelled facts on narrow screens, and exposes live result counts without fixture coupling.
- Independent verification corrected singular metric labels, zero-vacancy/nonzero-candidate workload disclosure, and desktop accessibility of row field labels. Reverification: 33/33 tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS.
- EW-06C implementation: `e9a9ad1`.
- The invitation affordance validates locally, exposes no member collection or callback, never contacts transport/storage/router APIs, and reports exactly that no invitation was sent and no change was saved.
- Independent verification corrected stale error/ARIA and prior-result messages when a new attempt begins. Reverification: 35/35 tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS.
- EW-06D implementation: `67abee2`.
- The server route reuses exactly one layout-owned employer shell, mounts one invitation and one workspace over the frozen six-member fixture, and preserves active Equipo navigation and shared header controls.
- Independent verification corrected the intro from unsupported management language to truthful consultation language. Reverification: 84/84 tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS.
- EW-07 implementation: `34dd04d`.
- The dashboard now adds three current active Nexo vacancies between the chart and recent-candidate table, with a portfolio link and one accessible canonical pipeline link per semantic non-interactive row. KPI/chart/table/data snapshots remain unchanged.
- Parent readback corrected literal `candidato(s)` copy to natural singular/plural before independent verification. Final verification: 245/245 tests, TypeScript, ESLint, diff-check, and LSP diagnostics PASS.
- EW-08 implementation is verified and awaiting commit authorization.
- A 346-line Chromium contract exercises four real interaction flows plus an eight-case dashboard/portfolio/pipeline/team × desktop/mobile matrix. The matrix reports zero document overflow, candidate-scoped serious/critical Axe violations, non-Next write methods, foreign/API/3001/4010 traffic, and local/session storage writes.
- Browser diagnosis found wide pipeline board/list descendants escaping the shared employer `main` at 375px despite correct internal scroll regions. `SidebarInset` now uses `overflow-x-clip`, reducing board/list document overflow from 538px/142px to zero while preserving internal horizontal scrolling.
- Final independent verification: 36/36 focused Vitest tests and 5/5 Chromium tests PASS; all eight responsive matrix cases execute; TypeScript, scoped ESLint, `git diff --check`, and LSP diagnostics PASS. Known full-dashboard contrast findings remain pre-existing and outside the deliberately scoped ActiveVacancies audit.

## Next step
After explicit authorization, create the EW-08 Conventional Commit, record its identity here, and close the employer workspace expansion without pushing, opening a PR, merging, or deploying.
