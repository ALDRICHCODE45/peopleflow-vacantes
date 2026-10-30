# Candidate CVs and dashboard redesign

Branch `feat/candidate-cvs-redesign` (from main 940f8d9d). Full redesign of the candidate CV library first, then the
candidate dashboard with real data only; design on the canvas before each implementation.

## Specs

- **S1 CV screen redesign.** «quiero hacer un rediseno de la pantalla del los cvs del candidato, no me gusta nada esa
  pantlla» — «es que mira eso, esta muy mal, sin ofender jaja.» Data stays the real library (`/candidato/cvs`: name,
  type, size, uploaded_at, in_use, limits max_cvs / max_bytes / content_types; actions download, rename, delete).
- **S2 Dashboard redesign without mock data.** «y el dashboard: […] sigue habiendo datos mock, el diseno tampoco me
  gusta del todo, un rediseno completo estaria bien igualmente, y sobre los datos que muestra, estoy abierto a re-pensar
  este apartado con el proposito de lo que mas le ayudaria al candidato».
- **S3 Keep the dashboard cards.** «el tema es que las tarjetas es lo unico que si me convence jaja, si me gustaria
  dejarlas dentro del diseno, posiblemente cambiar la data que muestra por data nueva, de nuevo, estoy abierto a
  platicarlo, no importa si hay que cambiar el backend.»
- **S5 Chosen CV design.** «todo el diseno de la tercera opcion, pero agregando el badge de la primera» — artboard
  `design/candidate-cvs-redesign/03-lista-y-panel.html` (list + sticky upload panel: drop zone, capacity, usage tips)
  with the «Usado en postulaciones» badge and its ⓘ popover from 01. Upload, rename, delete, download, failure,
  uncertain-upload, storage-unavailable, wrong-role and limit behavior stay as today.
- **S6 Dashboard data (D1).** User accepted the proposal «Sí, así»: four cards — **Por atender** (pending
  assessments + new company messages), **Postulaciones activas** (submitted + in process, with breakdown), **Perfil**
  (completeness and which fields are missing), **CVs** («n de max» and how many were sent in applications); below, the
  pending list and recent applications on real data; remove the Contratada/Rechazada stacked bar and the prototype
  saved vacancies; ask the backend for a per-application `updated_at` (last status change) to show and sort by recent
  activity.
- **S4 Order.** CVs first, then the dashboard, as separate deliveries (user choice, L3).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| V1 | S1 | canvas — `design/candidate-cvs-redesign/` directions → user choice: 03 + badge of 01 (L6) | a178cbeb, this commit |
| V2 | S1, S5 | worker — implement 03 + badge of 01 in `cv-workspace.tsx`; keep upload/rename/delete/failure behavior; tests | this commit (L7) |
| D1 | S2, S3, S6 | agree with the user which data each dashboard card and section shows (real data; backend changes allowed) | decided (L9) |
| D2 | S2, S3 | canvas — dashboard directions keeping the cards → user choice | |
| D3 | S6 | backend request: per-application `updated_at` (last status change) in the candidate applications list | |
| D4 | S2, S3 | implement dashboard on real data; remove prototype fixtures from the route; tests | |

## Log

- **L1** User (verbatim): «Si, quiero hacer un rediseno de la pantalla del los cvs del candidato, no me gusta nada esa
  pantlla, pero antes de que heche a andar el dev server del frontend y la api del backend, crea la rama del rediseno y
  cambiate a ella por favor.» → branch `feat/candidate-cvs-redesign` from main 940f8d9d.
- **L2** User (verbatim): «Si hermano, son en realidad dos cosas, los cvs: [screenshot /candidato/cvs] es que mira eso,
  esta muy mal, sin ofender jaja. y el dashboard: [screenshot /candidato/dashboard] sigue habiendo datos mock, el diseno
  tampoco me gusta del todo, un rediseno completo estaria bien igualmente, y sobre los datos que muestra, estoy abierto
  a re-pensar este apartado con el proposito de lo que mas le ayudaria al candidato, me sigues?»
- **L3** Answers: dashboard purpose — «el tema es que las tarjetas es lo unico que si me convence jaja, si me gustaria
  dejarlas dentro del diseno, posiblemente cambiar la data que muestra por data nueva, de nuevo, estoy abierto a
  platicarlo, no importa si hay que cambiar el backend.»; order — «CVs primero, luego dashboard».
- **L4** Exploration. Dashboard route renders `prototype-candidate`, `prototype-messages`, `prototype-portfolio`
  fixtures (only pending assessments are real); real sources: applications (`submitted|in_process|closed`, vacancy
  state, closing message), CV library, profile read, pending assessments. Saved vacancies are prototype too. CV screen
  issues: native file input, oversized «1 de 10» progress, half-width card for one file, unexplained «En uso»
  (`in_use`: used by a sent application; deleting keeps every application's copy).
- **L5** V1 canvas `design/candidate-cvs-redesign/`: 01-biblioteca-lista (compact list, drop zone on top, «Usado en
  postulaciones» badge with ⓘ popover), 02-galeria-documentos (document cards, «Agregar CV» tile in the grid),
  03-lista-y-panel (list + sticky upload panel with capacity and usage tips). Each has a design-only state switcher
  (con CVs / vacía / subiendo / error / límite). Headless check: no page errors in any state, menu Escape returns
  focus, no horizontal overflow at 1440 and 390. Awaiting the user's choice.
- **L6** User (verbatim): «Me gusta mucho la tercera opcion hermano, peroo me gusta el badge de "Usado en postulaciones"
  de la primera opcion, entonces, todo el diseno de la tercera opcion, pero agregando el badge de la primera, me
  explico?» → 03-lista-y-panel updated with the 01 badge + ⓘ popover (green check text removed). Chosen artboard:
  03-lista-y-panel.html; 01 and 02 are alternatives. Headless: no errors, popover opens, Escape returns focus to ⓘ, no
  overflow at 1440 (limit state) and 390.
- **L7** V2 implemented by worker (presentation only in `cv-workspace.tsx`; same upload/rename/delete/recovery paths;
  drag-and-drop calls the same `selected()`; generic `InfoPopover` reused). Deviations from 03: neutral file tiles,
  spinner instead of a fabricated progress percentage, badge beside the name only at 2xl. Worker ran on Node 25 (49
  `localStorage.clear` failures in untouched tests); parent rerun on the required Node 22.23.4: 47 files / 649 tests
  passed (candidate, candidate-cvs, (candidato) routes, candidate-dashboard), `tsc` 0, eslint clean on changed files.
  Browser QA pending: candidate login is real Cognito, asked the user to check /candidato/cvs in their browser.
- **L8** User (verbatim): «Bien, muy buena base, pero las cards de los cvs estan muy "flacas" me sigues? muy delgadas,
  no se ven como en el diseno propuesto.» Root cause: the file tile was absolutely positioned inside CardHeader, so it
  added no height and rows collapsed to two text lines. Fix: the tile is an in-flow grid column (44×52, row-span 2),
  rows center vertically with more padding, PDF/Word tiles tinted with status-danger/status-info as in 03. RED on the
  previous code (tile test), GREEN 562/562 on Node 22, tsc 0, eslint clean.
- **L9** Answers: CV rows — «Sí, quedaron bien» (V2 browser QA by the user; handoff 03 implemented). Dashboard cards —
  «Sí, así (Recomendado)» → S6. **Slice boundary:** the CV delivery (V1–V2) ends at 453e0e9a; the dashboard (D2–D4)
  is the next slice.
- **L10** D2 (S2, S3, S6): dashboard directions in `design/candidate-dashboard-redesign/`: `01-resumen-dividido.html`
  (four cards + balanced pending/recent panels), `02-agenda-de-acciones.html` (full-width action queue + recent
  application cards), `03-bitacora-personal.html` (2×2 cards + recent-update timeline and pending rail). Each includes
  Con actividad / Primera visita / Al día, actionable cards and only Enviada / En proceso / Cerrada; recency represents
  the requested D3 `updated_at`, not an API integration. `design.json` records 1440×900 viewports and tradeoffs.
  No direction chosen yet; product links are inert in these standalone design examples. Token/font self-check completed;
  browser overflow, focus and state-switcher verification remain pending (no browser runner supplied to this worker).
- **L11** D3: backend (session 01a18f07) proposes `updated_at` always present, RFC3339, derived from
  participation_stage_history (no migration): time of the last candidate-visible change (submitted↔in_process,
  discard→closed with message, recovery); internal moves keeping the visible status do not bump it; equals applied_at
  otherwise; ordering stays applied_at DESC (dashboard sorts client-side); contract doc backend/docs/vacancy-applications.md
  «Candidate list (private)». Frontend agreed (recovery counts) and accepts it first: 59532e0b — optional, RFC3339 with
  offset, >= applied_at, other unknown keys still rejected; RED 3 accept cases, GREEN 481/481 on Node 22, tsc 0, eslint
  clean. Backend waits for the user's go-ahead in its own session.
  D2 parent check (headless, canvas): 01/02/03 load with no page or console errors; each of «Con actividad»,
  «Primera visita», «Al día» changes the content; no horizontal overflow at 1440 or 390; no Contratada/Rechazada/
  En revisión/saved/recommended copy. Awaiting the user's choice.
