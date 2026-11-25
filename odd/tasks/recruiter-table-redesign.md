# Recruiter performance «Ver tabla completa» redesign (frontend)

Métricas → «Desempeño por reclutador» → «Ver tabla completa» opens a narrow sheet with a wide table; the user finds it
illegible. Design options first, then implementation.

## Specs

- **S1** User, verbatim: «ese mensaje que dice: "ver tabla completa" abre ese sheet con esa tabla en tan poco espacio,
  y sinceramente considero que es ILEJIBLE o al menos muy poco comodo de leer, no alcanzo a leer NADAA, no me gusta nada,
  dame algunas preopuetas para solucionar eso por favor» → 2–3 directions on the canvas that make the full recruiter
  table comfortable to read at 1440 and 390, grounded in design/system.md, visually reviewed before showing them.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Design directions (`design/recruiter-table-redesign/`) | |
| T2 | S1 | Implementation of the chosen artboard | |
| T3 | S1 | Browser check, full suite, merge to main | |

## Log

- **L1** (2026-11-24) User, with screenshots of the «Desempeño por reclutador» card (Reclutador, Vacantes asignadas,
  Entregas a tiempo with bar, Placements, Conversión, chevron) and the «Ver tabla completa» sheet (~380 px wide: «Fichas
  por reclutador», «Orden: nombre (A–Z)», «Qué mide cada columna», «Columnas», reset, a table whose columns are cut after
  «Asigna…»), verbatim S1. Before that: «Muy bien hermano, me gusta mucho, commit, merge y yo hago push» about the settings
  and audit redesign (already merged to local main `648e92ce`).
- **L2** (2026-11-24) T1/S1: `design/recruiter-table-redesign/` — three directions, each at 1440×900 and 390×844 (light/dark, owner/stakeholder),
  with all eight columns of the current sheet, sort, column choice, «Qué mide cada columna», period, empty/loading/error states and
  row → recruiter-detail navigation: `01-pagina-propia-de-tabla.html` (own page `/empresa/metricas/reclutadores`, grouped headers, sticky
  first column and header), `02-dialogo-ancho-con-tabla-completa.html` (near-fullscreen dialog over Métricas, same columns as today;
  phone = full screen with pinned name and column groups), `03-comparativa-por-tarjetas.html` (one card per recruiter plus a compare mode
  for 2–3). Reviewed in Chromium (axe 0 violations, 57 keyboard/click checks); deviations in `self-check.md`. None chosen yet; the user picks one.
