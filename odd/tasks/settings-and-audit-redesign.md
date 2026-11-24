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
