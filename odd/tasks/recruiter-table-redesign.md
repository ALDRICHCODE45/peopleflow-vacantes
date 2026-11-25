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
