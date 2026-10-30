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
- **S4 Order.** CVs first, then the dashboard, as separate deliveries (user choice, L3).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| V1 | S1 | canvas — `design/candidate-cvs-redesign/` directions → user choice: 03 + badge of 01 (L6) | a178cbeb, this commit |
| V2 | S1 | implement chosen CV design; keep upload/rename/delete/failure behavior; tests | |
| D1 | S2, S3 | agree with the user which data each dashboard card and section shows (real data; backend changes allowed) | |
| D2 | S2, S3 | canvas — dashboard directions keeping the cards → user choice | |
| D3 | S2, S3 | backend request for any new data agreed in D1 (if needed) | |
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
