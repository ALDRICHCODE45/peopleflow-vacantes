# Employer settings and useful navigation

## Outcome

Add `/empresa/configuracion` in the existing employer shell, using the candidate settings composition and installed UI primitives. Remove destinations that have no useful page; keep implemented prototype workspaces.

## Behavior

- Five sections: Organización, Reclutamiento, Notificaciones, Apariencia and Seguridad.
- Organization actions link to the existing team and careers-site editors.
- Recruitment and notification switches own visit-local React state. They do not persist settings, change application requirements, send messages or claim a backend save.
- Appearance uses the existing shared `pf-theme` preference and system/light/dark modes.
- Password and two-factor controls remain enabled, focusable and inert under the presentation rules; no authentication effect or success is fabricated.
- Section anchors work with keyboard navigation. The rail stacks on small screens; cards retain semantic headings and named controls.

## Navigation audit

| Area | Retained destinations |
| --- | --- |
| Employer | Dashboard, Vacantes, Base de talento, Equipo, Sitio de empleo, Configuración |
| Candidate | Dashboard, Postulaciones, Guardadas, Perfil, CVs, Configuración; existing Explorar vacantes action |

All retained destinations mount implemented workspaces. The employer sidebar removes Mensajes and Reportes, which previously rendered inert buttons. Configuración now links to the new route and participates in active-route matching.

The employer account menu supplies three real links: Configuración, Equipo and Sitio de empleo. It no longer exposes the generic inert profile, billing, notifications or logout actions. The reusable default NavUser behavior is unchanged for callers that explicitly need it.

## Copy and presentation audit

Runtime source and the jobs-server demo fixture were searched for common voseo and unaccented Argentine imperatives; a separate accented-word scan covered imperative endings. No visible runtime regionalisms were found. Historical unit-test strings remain unchanged, including accented rich-text offset fixtures. External future API content is outside this audit.

Organization links use native Next links with the installed `buttonVariants`, `cn` merging and button styling slot: Base UI's non-native Button otherwise changes their role to button. Mobile helper copy was shortened after a screenshot exposed truncation.

## Verification

- RED: five settings tests failed against the initial empty workspace; six navigation tests failed before sidebar cleanup.
- GREEN: 225 focused tests across eleven files, covering employer/candidate settings and navigation, dashboard composition, decorative WebGL scheduling and theme transitions.
- Production build, TypeScript and scoped ESLint passed. Active LSP checks reported no findings, with five silent-on-clean results inconclusive; the compiler remains the complete type-check evidence.
- Chromium: 27 distinct passing browser cases across candidate workspaces (9), employer workspaces (6), employer settings (4) and login/WebGL (8). Settings were additionally rerun after presentation corrections.
- Browser checks cover actual Base UI menus/selects, keyboard destinations, visit-local preferences, persisted theme, inert security controls, mobile/desktop overflow, unclipped helper text and serious/critical axe findings. Screenshots were inspected.
- Independent read-only technical review reported no concrete findings; it did not independently run tests or assess real Mac rendering.

The Base UI account portal cannot settle in jsdom. Its unit contract stays at the source boundary; browser tests exercise the real menu. Existing dashboard chart zero-size warnings are jsdom-only, not failed assertions.

## Delivery boundaries

No dependencies or private environment files changed. Test servers were temporary and only the process started for these checks was stopped; the existing jobs fixture remained running. Integrate local commits into `main` without pushing, preserving the pre-existing backend documents. Real Mac/Safari performance and final visual acceptance remain user-owned.
