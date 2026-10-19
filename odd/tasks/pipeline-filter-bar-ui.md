# Pipeline filter bar — single-row toolbar (v0 reference)

Branch `feat/pipeline-filter-bar-ui` from `main`. Reference: v0 chat `qqPqctX1XRU`, files saved in
`docs/design/v0/reference-qqPqctX1XRU/` (pipeline-filters.tsx, pipeline-board.tsx, globals.css), screenshot
/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-10-19-16-04-20_5360x2520.png; current problem
/tmp/gpJ8vZaT/pi-clipboard-150efefc-3d74-492c-bcd2-4a0e2a7f7f36.png.

## Specs

- S1. User (verbatim): «actualmente los filtros se amontonan encima de las columnas del kanban board, y cuando son filtros grandes como las preguntas, es aun peor, entonces v0 tiene una propuesta mejor para resolver esto».
- S2. User choice (verbatim): «Recortar con «…» + texto completo al pasar (Recomendado)» — chips have a max width; question and answer truncate with an ellipsis; the full text is in a tooltip and the accessible name. No invented short labels; no backend change.
- S3. User choice (verbatim): «Solo filtros y columnas vacías (Recomendado)» — single-row filter bar, «Vista filtrada» results line + «Editar filtros», and the «Sin coincidencias» empty column state with «Limpiar filtros». The header stays as is.
- S4. UI rules: docs/frontend-ui-design-rules.md (all; §13.12 to be updated, §17, §19).

## Tasks

- T1 [pending] S1-S4 | writer | Filter bar + results line + empty column state; update §13.12. | commit: -
- T2 [pending] | parent | Guide step, queue item. | commit: -

## Log

- L1. User request and choices above (2026-10-19).
