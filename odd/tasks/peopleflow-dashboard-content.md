# PeopleFlow dashboard content

## Authority / objective
The user approved the PeopleFlow-themed `/empresa/dashboard` and authorized replacing the remaining stock shadcn demo content with coherent fictional recruiting data, PeopleFlow identity, and product-relevant navigation. The dashboard remains a visual prototype and must not imply live backend analytics.

## Product decisions
- Use the backend-compatible application vocabulary in the UI: `submitted` → Nuevo, `in_review` → En revisión, `hired` → Contratado, and `rejected` → Descartado.
- Use the real job vocabulary where shown: `draft`, `published`, and `closed` translated for display.
- Prefer recent applicants over recent positions in the dashboard table because they represent daily recruiter action; positions belong in the future Vacantes surface.
- Use the existing stacked area chart for application-source composition, with Directas and Referidas as the two visible series.

## Scope
- Replace the Acme/shadcn identity with the existing PeopleFlow logo and coherent fictional employer/user identity.
- Rewrite sidebar navigation for recruiting and rename Quick Create to Nueva vacante.
- Replace all four stock KPI cards with plausible recruiting metrics.
- Replace chart title, descriptions, series, fixture values, and date labels with Spanish application-source content.
- Replace the document table and 68-row fixture with a compact recent-applicant dataset, relevant columns, pipeline tabs, and candidate detail drawer.
- Remove interactions that have no recruiting meaning: drag ordering, numeric target/limit editing, Add Section, demo drawer form, and demo mini-chart.
- Preserve the approved layout, responsive behavior, canonical light/dark themes, semantic colors, radii, and measured geometry.

## Non-goals
- No live backend integration or dashboard analytics endpoint.
- No new application/job statuses beyond the backend's closed vocabularies.
- No implementation of Vacantes, Candidatos, Mensajes, Equipo, Reportes, or Configuración routes; prototype links remain safe placeholders.
- No changes to shared design-system primitives or global theme architecture.
- During implementation, no commit, push, PR, package installation, build, backend mutation, or persistent server lifecycle change; delivery required later explicit user authorization.

## Candidate edit surfaces
- `frontend/src/components/company-dashboard/app-sidebar.tsx`
- `frontend/src/components/company-dashboard/nav-main.tsx`
- `frontend/src/components/company-dashboard/nav-documents.tsx`
- `frontend/src/components/company-dashboard/nav-user.tsx`
- `frontend/src/components/company-dashboard/site-header.tsx`
- `frontend/src/components/company-dashboard/section-cards.tsx`
- `frontend/src/components/company-dashboard/chart-area-interactive.tsx`
- `frontend/src/components/company-dashboard/data-table.tsx`
- `frontend/src/app/(empresa)/empresa/dashboard/data.json`
- `frontend/src/app/(empresa)/empresa/dashboard/page.test.tsx`
- Focused company-dashboard tests when required

## Protected invariants
- Do not modify `frontend/src/components/company-dashboard/dashboard-01-theme.module.css`.
- Preserve `data-pf-kpi-cards`, `data-pf-chart-card`, and `data-pf-data-table` on the same semantic regions. Preserve exactly one `data-pf-growth-footer` marker on the fourth KPI footer, matching the approved baseline geometry contract.
- Preserve the existing sidebar width, header height, card minimum height, content spacing, chart height, table placement, and mobile drawer behavior.
- Keep the existing `ThemeToggle`, `pf-theme`, `.dark`, and `data-theme` behavior.
- Use canonical semantic tokens only; do not add raw brand colors.

## Acceptance criteria
- PeopleFlow logo replaces the stock company glyph/name and remains correct in light/dark sidebar states.
- Sidebar reads Dashboard, Vacantes, Candidatos, Mensajes, Equipo, Reportes, and Configuración; CTA reads Nueva vacante.
- Header reads Dashboard and contains no GitHub demo action.
- KPI cards read Vacantes activas, Candidatos nuevos, En revisión, and Contrataciones este mes with coherent mock values/context.
- Chart reads Origen de las postulaciones, exposes Directas and Referidas, retains 90d/30d/7d controls, canonical violet/lavender colors, deterministic UTC ticks, and Spanish date presentation.
- Table reads Candidatos recientes and uses Candidato, Vacante, Estado, Fuente, Recibida, and Responsable semantics with Todos/Nuevos/En revisión/Contratados tabs.
- Applicant fixtures use only `submitted`, `in_review`, `hired`, and `rejected`; no unsupported pipeline stage appears.
- Selection, column visibility, pagination, and candidate detail drawer work; drag reorder, numeric edits, Add Section, and document-demo drawer content are absent.
- No stock shadcn dashboard strings or identities remain on the rendered dashboard.
- Focused tests, exact TypeScript, focused ESLint, desktop/mobile light/dark browser verification, drawers/dropdowns, no-overflow checks, and geometry regression checks pass.

## Tasks
- [x] PDC-01: adapted PeopleFlow identity, recruiting navigation, header, four KPI cards, and the Directas/Referidas application-source chart. Behavior-first coverage is green; the bounded identity correction now renders Tomás Ríos · Talent Lead · Nexo Labs with `tomas.rios@nexolabs.mx` and TR fallback. Independent re-verification passed 86/86 focused tests, exact TypeScript, and focused ESLint while preserving the single fourth-card growth marker. Delivered in `fdcec97816afb697665a094a994cfee0f8a272dc` on foundations commit `0db090d61ea7f25f94f816677e70e5e0ed16795c`.
- [x] PDC-02: replaced the stock document fixture/table with 12 recent applicants, backend-compatible status/source enums, Spanish filtering tabs/mobile selector, localized selection/column/pagination behavior, and a read-only candidate drawer; removed DnD/editing/demo chart/form/Add Section and deleted the unreferenced stock navigation modules. Independent verification passed 146/146 company-dashboard tests, exact TypeScript, and focused ESLint. Delivered in `fdcec97816afb697665a094a994cfee0f8a272dc`.
- [x] PDC-03: final independent verification PASS after bounded residue/geometry correction. Static checks passed 166/166 focused tests, exact TypeScript, and focused ESLint. Real Chromium passed 31/31 desktop-light, 31/31 desktop-dark, 35/35 mobile-light, and 35/35 mobile-dark checks: correct identity/menu/sidebar localization, filters, pagination, column toggling, candidate drawers, canonical themes/chart colors, no stock asset requests, no overflow/errors/failed requests, 352×32 desktop range control, 382px mobile chart, and 1322.625px mobile table top with zero baseline delta. Evidence: `/tmp/pf-dashboard-content-v1/`. Delivered in `fdcec97816afb697665a094a994cfee0f8a272dc`; no push or PR was authorized.

## Delivery evidence
Shared dashboard dependencies and reusable primitives: `0db090d61ea7f25f94f816677e70e5e0ed16795c` (`feat(ui): add dashboard component foundations`). Complete PeopleFlow employer dashboard: `fdcec97816afb697665a094a994cfee0f8a272dc` (`feat(employer): add PeopleFlow recruiting dashboard`). Pre-commit verification passed `git diff --cached --check`, 166/166 focused tests, exact TypeScript, and focused ESLint while keeping every unrelated working-tree change unstaged.

## Delivery boundary
This slice stops at coherent fictional recruiting content. Real routes, live aggregates, API loading, mutations, and expanded pipeline stages require separate product and backend work.
