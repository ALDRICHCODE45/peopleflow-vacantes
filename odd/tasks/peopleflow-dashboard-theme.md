# PeopleFlow dashboard theme

## Authority / objective
The user visually approved the exact shadcn `dashboard-01` baseline at `/empresa/dashboard` and authorized the first PeopleFlow customization slice: apply the canonical PeopleFlow semantic palette, add an explicit light/dark control, and differentiate the chart series with canonical violet and lavender brand colors.

## Scope
- Preserve the approved dashboard composition, content, responsive behavior, and measured geometry.
- Replace the temporary neutral shadcn token isolation with canonical PeopleFlow light/dark semantics from `frontend/src/app/globals.css`.
- Reuse the existing `ThemeToggle`, theme bootstrap, `.dark` class, and `pf-theme` persistence. Do not create a second theme system.
- Place the toggle in the dashboard header control group.
- Use canonical PeopleFlow violet plus canonical decorative lavender for the chart series.
- Keep destructive colors and accessibility semantics intact.

## Non-goals
- No PeopleFlow navigation labels, logo, company/user identity, demo content, table schema, or backend integration changes in this slice.
- No changes to approved KPI/chart/table positions, radii, spacing, or mobile drawer behavior.
- No global palette redesign and no invented color values.
- No commit, push, PR, or backend/service lifecycle mutation without separate user authorization.

## Candidate edit surfaces
- `frontend/src/components/company-dashboard/dashboard-01-theme.module.css`
- `frontend/src/components/company-dashboard/site-header.tsx`
- `frontend/src/components/company-dashboard/chart-area-interactive.tsx`
- `frontend/src/components/company-dashboard/data-table.tsx` only if its chart config must share the chosen series mapping
- `frontend/src/app/(empresa)/empresa/dashboard/page.test.tsx`
- Focused theme/header tests only if required

## Acceptance criteria
- Dashboard primary actions and chart branding resolve to canonical PeopleFlow violet.
- Secondary surfaces, muted text, borders, cards, popovers, and sidebar inherit canonical PeopleFlow light/dark tokens from `globals.css`.
- Desktop and Mobile chart series use canonical violet and decorative lavender and remain distinguishable in both themes.
- A header theme toggle with accessible name `Cambiar tema` switches light/dark, persists through the existing `pf-theme` mechanism, and introduces no hydration warning.
- Mobile Sheet/dropdown portals receive the same PeopleFlow theme.
- Every existing screenshot-fidelity geometry assertion remains unchanged and passing.
- Independent desktop/mobile light/dark verification reports no console/page/request errors or horizontal overflow.

## Tasks
- [x] PDT-01: removed the temporary neutral light/dark palette declarations so the dashboard and body portals inherit canonical PeopleFlow semantics from `globals.css`; mapped both chart configs to Desktop=`var(--primary)` and Mobile=`var(--brand-decorative-strong)`. RED observed 5 failing contracts; GREEN passed 55/55 focused tests, exact TypeScript, focused ESLint, CSS Modules purity, and byte-preservation of every measured geometry rule.
- [x] PDT-02: reused the canonical `ThemeToggle` in the dashboard header control group, before the GitHub link so the approved group right edge stays fixed. The toggle remains available on mobile, uses the existing `pf-theme` persistence/bootstrap, and introduces no local theme state. RED observed 7 failures; GREEN passed 63/63 focused tests, exact TypeScript, and focused ESLint while preserving GitHub semantics and header height/padding.
- [x] PDT-03: independent verification PASS. Focused dashboard tests passed 63/63, exact TypeScript and focused ESLint passed, and real Chromium covered desktop/mobile light/dark, mobile drawers, and desktop dropdowns. The toggle updates `data-theme`, `.dark`, and `pf-theme`, survives reload, and remains visible on mobile; computed tokens match canonical `globals.css`; Quick Create/Desktop chart use primary violet and Mobile uses decorative lavender; portals inherit the active PeopleFlow theme; all approved geometry stayed within 2px with no overflow, console/page/request errors, or failed requests. Evidence: `/tmp/pf-dashboard-theme-v1/`.

## Delivery evidence
The approved theme behavior was delivered with the complete dashboard in `fdcec97816afb697665a094a994cfee0f8a272dc` (`feat(employer): add PeopleFlow recruiting dashboard`) on shared foundations `0db090d61ea7f25f94f816677e70e5e0ed16795c`. No push or PR was authorized.

## Delivery boundary
This was a styling and theme-control slice only. The later PeopleFlow customization phase (logo, navigation, identities, copy, and data) proceeded only after separate user approval; live integrations remain outside this delivery.
