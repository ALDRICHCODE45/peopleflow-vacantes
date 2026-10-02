# PeopleFlow employer dashboard shell

## Authority / objective
The user explicitly selected the official shadcn `dashboard-01` block and then chose the supplied preview screenshot as the final visual authority over current CLI 4.21.0 output. The initial minimal structural adaptation was technically verified but visually rejected because it omitted the block's exact sidebar footer/avatar, header, cards, chart, table, spacing, and composition. The complete CLI block remains the implementation baseline, but narrow deltas are authorized where the current registry revision differs from the screenshot: GitHub header action, circular brand glyph, full `Customize Columns` label, chart date alignment, and measured geometry. PeopleFlow branding/navigation/content adaptations happen only after separate visual acceptance. This is still a visual prototype and no backend integration may be implied.

## Authoritative references
- `design/screens/dashboard-empresa.html` and linked `design/screens/assets/base.css` / theme scripts for PeopleFlow navigation, labels, palette, and dashboard visual language.
- Official shadcn `dashboard-01` Base UI / `base-rhea` registry item for layout composition only.
- Official shadcn Sidebar documentation for `SidebarProvider`, `Sidebar`, `SidebarInset`, `SidebarTrigger`, responsive off-canvas behavior, and accessibility semantics.
- User preview: `/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-09-17-14-02-57_3440x2520.png`.

## Scope and constraints
Work only in `/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes-frontend-tdd-recovery`. Preserve all unrelated dirty and untracked work. Do not install the complete `dashboard-01` block: its dry run would add 34 files, 11 dependencies, and overwrite shared `button`, `input`, `separator`, `label`, `select`, and `sheet` components. Add only the minimum official Sidebar-supporting primitives and adapt them to the existing Base UI `base-rhea`, Tailwind v4, Lucide, and semantic-token conventions. Do not overwrite existing shared primitives.

The employer navigation must mirror the design prototype:
- Principal: Dashboard, Vacantes, Candidatos, Mensajes.
- Organización: Equipo, Reportes, Configuración.
- Primary action: Nueva vacante.
- PeopleFlow logo/wordmark and a clearly fictional employer/user identity.

Only Dashboard is a real preview route in this slice, at the user-approved `/empresa/dashboard` URL implemented under the invisible route group as `app/(empresa)/empresa/dashboard/page.tsx`. Other destinations remain clearly non-operational prototype links; they must not lead to accidental 404 pages or claim implemented behavior. Main content is a restrained preview surface demonstrating the shell, not a port of shadcn demo charts/tables and not a new dashboard product design. Preserve light/dark theme behavior and reduced-motion/accessibility expectations.

## Candidate edit surfaces
- `frontend/src/app/(empresa)/layout.tsx`
- `frontend/src/app/(empresa)/empresa/dashboard/page.tsx`
- `frontend/src/components/company-dashboard/**`
- `frontend/src/components/ui/sidebar.tsx`
- `frontend/src/components/ui/skeleton.tsx`
- `frontend/src/components/ui/tooltip.tsx`
- `frontend/src/hooks/use-mobile.ts`
- Focused tests colocated with the new shell/route.
- `frontend/src/app/globals.css` only if the official sidebar semantic tokens are absent and only for the bounded sidebar token mapping.

No writes to backend, design sources, marketing/auth/public-vacancy features, package dependencies, lockfile, existing shared UI primitives, service state, or historical evidence.

## Tasks
- [x] EDS-01: introduced the minimum compatible shadcn Sidebar foundation without overwriting existing primitives; built the PeopleFlow employer shell, responsive header, design-derived navigation, logo, mock user footer, and `/empresa/dashboard` preview route. Behavior-first RED was observed for missing modules, then GREEN with 23/23 focused tests; package/lock/global CSS and existing primitives remained byte-unchanged.
- [x] EDS-02: independent verification PASS for the initial minimal adaptation. Focused shell/page tests 23/23, theme/layout/logo regressions 36/36, full frontend TypeScript, and focused ESLint over 11 files all passed. Existing project-owned Next service was used without lifecycle changes: Chromium verified desktop/mobile × light/dark, HTTP 200, one main landmark, correct title/H1, no console/page errors, functional mobile open/close, and Ctrl+B collapse. User subsequently rejected this direction because it was not an exact `dashboard-01` reproduction.
- [x] EDS-03: integrated the complete official CLI block at `/empresa/dashboard` and reconciled the user-selected screenshot-era `registry/new-york-v4` visual details without PeopleFlow customization. The final baseline includes Tabler iconography and `IconInnerShadowTop`, the GitHub header action, responsive `Customize Columns`, the official 400×400 avatar, deterministic UTC chart labels, joined range controls, neutral light/dark portal theming, and narrowly scoped reference geometry.
- [x] EDS-04: independent final verification PASS. Focused route tests passed 51/51, exact TypeScript and focused ESLint passed, and Next compiled every requested browser case with HTTP 200. Chromium verified desktop light/dark at 1460×1013, mobile light/dark at 390×844, open drawers, dropdowns, avatar loading, all 15 chart labels, complete chart paths, no horizontal overflow, and no console/page/request errors. Direct authority-image measurements are within 0–1px for KPI/card/chart/table geometry and within 1px for the range control; no material residual remains beyond the ignored Next development indicator and raster antialiasing. Evidence: `/tmp/pf-eds04-closure-v2/`.

## Delivery evidence
The user later authorized committing the complete approved dashboard before beginning the next screen in a fresh session. Shared dashboard foundations were committed as `0db090d61ea7f25f94f816677e70e5e0ed16795c` (`feat(ui): add dashboard component foundations`); the complete employer dashboard route, components, data, and tests were committed as `fdcec97816afb697665a094a994cfee0f8a272dc` (`feat(employer): add PeopleFlow recruiting dashboard`). No push or PR was authorized.

## Delivery boundary
During this slice, no commit, push, PR, or backend mutation was authorized. Final verification used isolated, verifier-owned temporary Next development servers on `127.0.0.1:3199`; each process group was recorded, terminated, and confirmed absent after capture. The user visually approved the exact baseline before the later PeopleFlow branding, navigation, content, and integration phases began.

Native review preflight was inspected after verification but not started: the workspace projection includes unrelated tracked vacancy/auth-era changes and requires an intended-untracked selection among a very large pre-existing inventory. Starting that transaction would review a mixed candidate rather than this employer-dashboard slice. Isolate this work as a user-approved commit or other bounded candidate before native review; do not select unrelated untracked evidence merely to force START.

LSP probing reported two non-blocking rule artifacts in vendored official code: `useSidebar` was falsely flagged despite calling `React.useContext`, and the official `useIsMobile` boolean coercion uses `!!isMobile`. TypeScript and focused ESLint remain clean.
