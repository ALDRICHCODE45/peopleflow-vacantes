# Recruiter performance «Ver tabla completa» redesign (frontend)

Métricas → «Desempeño por reclutador» → «Ver tabla completa» opens a narrow sheet with a wide table; the user finds it
illegible. Design options first, then implementation.

## Specs

- **S1** User, verbatim: «ese mensaje que dice: "ver tabla completa" abre ese sheet con esa tabla en tan poco espacio,
  y sinceramente considero que es ILEJIBLE o al menos muy poco comodo de leer, no alcanzo a leer NADAA, no me gusta nada,
  dame algunas preopuetas para solucionar eso por favor» → 2–3 directions on the canvas that make the full recruiter
  table comfortable to read at 1440 and 390, grounded in design/system.md, visually reviewed before showing them.
- **S2** User: «si, la 01, esta bien» → own page `/empresa/metricas/reclutadores` from
  `design/recruiter-table-redesign/01-pagina-propia-de-tabla.html`; the card's «Ver tabla completa» becomes a link; the
  narrow sheet goes away.
- **S3** User on «Entregas a tiempo»: «lo que sea mas completo» → percentage + «N de M» (as the board card), sorted by the
  percentage with the count as tiebreak.
- **S4** User on «volver»: «lo que recomiendes que sea la mejor experiencia» → the recruiter detail returns to the page the
  person came from: from the table page back to the table (keeping period, filters, order and columns in the URL); from
  Métricas back to Métricas; direct visits fall back to Métricas.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Design directions (`design/recruiter-table-redesign/`) | |
| T2 | S1–S4 | Implementation of `01-pagina-propia-de-tabla.html` | |
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
- **L3** (2026-11-24) User: «1. si, la 01, esta bien. 2. lo que sea mas completo. 3. lo que recomiendes que sea la mejor
  experiencia.» → S2–S4. Canvas handoff of `01-pagina-propia-de-tabla.html` (02 and 03 are alternatives). Table cells may
  wrap (extends the audit-table exception in design/system.md to this table).
