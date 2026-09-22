# Employer workspace expansion

## Status
- Workflow: ODD
- Delivery: bounded work-unit commits on `feature/company-careers-prototype`
- Worktree: `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-company-careers-prototype`
- Current task: EW-03 employer vacancy portfolio
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
- [ ] **EW-03 — Employer vacancy portfolio:** Build `/empresa/vacantes` with reference-faithful summary metrics, responsive status filters, vacancy rows, and a semantic pipeline action for every position.
- [ ] **EW-04 — Pipeline model and modes:** Add frozen candidate fixtures and build the per-position pipeline board/list experience with application-status stages, accessible switching, and truthful non-persistent controls.
- [ ] **EW-05 — Pipeline route:** Build `/empresa/vacantes/[jobId]/pipeline` with breadcrumb context, vacancy status, not-found handling, and responsive integration inside the employer shell.
- [ ] **EW-06 — Team/users workspace:** Build `/empresa/equipo` with member search/filtering, owner/recruiter roles, account status, workload context, and a clearly non-persistent invitation affordance.
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

## Next step
Implement EW-03 (`/empresa/vacantes`) with the reference vacancy portfolio composition.
