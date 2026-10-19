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

- T1 [done] S1-S4 | writer | Filter bar + results line + empty column state; update §13.12. | commit: df4ac43
- T2 [done] | parent | Guide step 75, queue item 1. | commit: docs commit

## Log

- L1. User request and choices above (2026-10-19).
- L2. Implemented T1: single-row Card toolbar, scrolling 300px chips with dimension icons,
  independent 32px remove buttons and full-text Tooltip/accessibility labels; filtered
  results with plural helper and «Editar filtros» opening the existing Sheet. Preserved
  column-order hint and counts. Filtered empty columns now share «Sin coincidencias»
  and explanatory copy, with no per-column clear button (explicit task clarification
  supersedes S3's original clear link). Updated UI rules §13.12 and §9.
  RED: 3 expected failures (missing toolbar, new remove names/results copy), 263 passed.
  GREEN: pipeline-movement suite 266/266 in 22 files; tsc --noEmit --incremental false,
  eslint on six touched TSX files and git diff --check passed. Tooltip root/trigger and
  portal remain real in tests; content positioning is replaced because jsdom geometry
  caused timeouts. Browser verification of tooltip positioning, mobile scroll and both
  themes remains for review. No packages installed, shared primitives changed or commit made.
- L3. User (verbatim): «el hover de los filtros ( y tambien cuando estan seleccionados) tienen un efecto ensima que queda mal, muy cuadrado, lo vez?» (/home/aldrich_coder45/Pictures/Screenshots/Screenshot_2026-10-19-16-18-32_5360x2520.png). Cause: FieldLabel's default `has-data-checked:bg-input/30` for choice cards, without its rounded border. Fix test-first (RED → GREEN 266): rounded-lg px-2 rows, hover:bg-muted, checked bg-primary/5, container px-1; rule added to §19.
