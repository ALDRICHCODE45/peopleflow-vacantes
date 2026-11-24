# Settings page and audit log redesign (frontend)

Redesign the employer Configuración page (the two large cards at the top go away) and the audit log (filters, header,
truncated select values). Design first with options on the canvas, then implementation.

## Specs

- **S1** User, verbatim: «no me gusta nada la pantalla de configuracion actual, y no me gusta solamente por las dos
  cards gigantes que hay arriba del todo: [captura] por favor eso hay que mejorarlo, esas dos cards se van.» → the
  «Datos de tu empresa» and «Base de talento visible para» cards at the top of /empresa/configuracion are removed as
  standalone cards; their content lives inside the page's own navigation/sections.
- **S2** User, verbatim: «la otra es la tabla de auditoria, sigue sin gustarme la verdad, los filtros no me gustan, en
  los selects, hay valores que no se pueden ver porque son muy grandes y el select simplemente los corta [captura] no me
  gusta en general el acomodo, del header, no me gusta en general muchas cosas la vdd..» → audit log redesign: filters,
  header layout, no truncated option values (e.g. «Carlos Eduardo Ramírez Tamez (ex miembro)»).
- **S3** «me gustaria ver mas opciones revisando y basandote en tu system design y evidentemente en las revisiones
  pertinentes necesarias y tambien en tu revision visual» → 2–3 directions per screen on the canvas, grounded in
  design/system.md, reviewed visually before showing them.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1, S3 | Design directions for Configuración (`design/settings-redesign/`) | |
| T2 | S2, S3 | Design directions for the audit log (`design/audit-log-redesign/`) | |
| T3 | S1, S2 | Implementation of the chosen artboards | |
| T4 | S1, S2 | Browser check, full suite, merge to main | |

## Log

- **L1** (2026-11-24) User message verbatim (S1–S3 above), with screenshots of /empresa/configuracion (two large cards
  «Datos de tu empresa» and «Base de talento visible para» above the section navigation) and /empresa/auditoria (filters
  panel with Persona/Acción/Vacante/Desde/Hasta; the Persona select cuts «Carlos Eduardo Ramírez Tamez (ex mie…»;
  «Filtros», «Columnas», reset and «Exportar CSV» spread across the header). Also asked whether WhatsApp/LinkedIn show no
  preview because the link is localhost (answered: yes).
- **L2** (2026-11-24) T1 y T2: direcciones de diseño, ninguna elegida todavía, cada una a 1440×900 y 390×844 en claro y
  oscuro, interactivas, con revisión visual y automática en Chromium (render, axe-core, desbordes, objetivos táctiles,
  flujos con clic). `design/settings-redesign/` (S1 S3): `01-ajustes-en-una-columna-con-navegacion-lateral`,
  `02-resumen-compacto-y-secciones`, `03-lista-de-ajustes-tipo-ios`. `design/audit-log-redesign/` (S2 S3):
  `01-barra-de-filtros-en-linea-con-chips`, `02-panel-lateral-de-filtros-y-tabla`,
  `03-linea-de-tiempo-agrupada-por-dia`. Cada carpeta trae `design.json` y `self-check.md` (UX y sistema); las
  desviaciones de `design/system.md` por decidir están en el segundo (tabla con texto que se parte, popover más ancho,
  mono para IP e identificadores, exportación siempre habilitada con panel de rango).
