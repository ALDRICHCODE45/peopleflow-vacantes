# Replacement processes follow-ups (frontend)

Frontend follow-ups of `replacement-processes.md` (L12–L13) listed in `frontend-backlog.md` «Replacement processes
follow-ups». Branch `feat/replacement-followups` from `main` `c2fde6bd`. Backend counterpart (separate session):
`feat/replacement-followups-backend` (board-item `carried_from_participation_id`, dashboard charts without carried
participations, `birth_date` rejected again).

## Specs

- **S1** «carry rows do not show the discard reason» → the carry candidate rows (step 3 «Candidatos que retomas») show
  the discard reason of a discarded candidate.
- **S2** «the dialog header has no icon tile or company name» → the «Iniciar reemplazo» dialog header shows the icon
  tile and the company name, as in artboard `design/replacement-processes/04-tarjeta-y-dialogo.html`.
- **S3** «the finished original has no «Acciones» button» → a finished original shows the «Acciones» button.
- **S4** «the 390 breadcrumb ellipsis for long titles comes from the sidebar top bar» → at 390 px a long vacancy title
  in the top-bar breadcrumb stays readable (no premature ellipsis).
- **S5** «Retomado» mark on carried cards (needs `carried_from_participation_id` on board items; same optional-first
  deployment order) → board cards of carried candidates show «Retomado», reading the optional backend field.
- **S7** Backend: «el PUT /me/profile ahora lo rechaza con 400 invalid_request (ff3b7888). El GET ya no lo devolvía desde
  00062, así que podés sacar la lectura tolerante cuando quieras.» → `profileReadSchema` no longer accepts `birth_date`.
- **S6** «the publish dialog plural «1 candidato» is checked only by a unit test» → verified in the browser.
- **S8** User choice (L7): «Sí: «Cubierta al cierre»» — «Solo cuando la cobertura de hoy es menor que la del cierre. Si
  no, sigue diciendo «Cubierta».» → a vacancy closed as filled whose live coverage is now below its required places
  (REP-7: a departure lowers coverage, the close result stays) reads «Cubierta al cierre» wherever the close reason
  shows; otherwise «Cubierta».

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Discard reason on carry rows (`discard_reason`) | `a3d147fb` |
| T2 | S2 | Dialog header icon tile and company name | `ed84ad60` |
| T3 | S3 | «Acciones» on the finished original | `c0a0cc1a` |
| T4 | S4 | 390 breadcrumb | `2afa860c`, D1 fix (this commit) |
| T5 | S5, S7 | «Retomado» mark (`carried_from_participation_id`) and drop the tolerant `birth_date` read | `42d3f674`, `3e1c4aab` |
| T6 | S1–S6 | Browser check, full suite, local merge to main | `aa93c739` |
| T7 | S8 | «Cubierta al cierre» label (branch `feat/closed-covered-label`) | `97f527cc` (board), `48d3c049` (list rows) |

## Log

- **L1** (2026-11-22) User: «Si hermano, adelante, avisame cuando todo este mergeado a main para poder hacer push, por
  favor.» Backend session relayed the user's request to do all pending items (backend there, frontend here); the user
  confirmed here: «Sí, arrancá con los follow-ups del frontend». Decisions relayed: no prod yet (no deploy); documents
  (PDF, Word, Excel, JPG/PNG, max 10 MB) follow a contract the backend writes first; owners and authorized recruiters
  delete with audit, stakeholders read only.
- **L2** `birth_date`: the profile write schema is strict and never sends it (`profile-api.ts:39`); the read keeps a
  tolerant `birth_date: z.unknown().optional()` until the GET stops returning it.
- **L3** Backend `feat/replacement-followups-backend` (not merged yet), verbatim: «1) Items del tablero (lista, detalle,
  original, respuestas de mover/descartar/recuperar/subestado, créditos y alta manual): `carried_from_participation_id` es un
  string UUID de la participación de origen, o `null`. Siempre viene. 2) … cada item de `carry_candidates[]` trae
  `discard_reason`. Si `discarded` es true, con la misma forma y los mismos nombres que `discard.reason` del tablero
  ({group, key}); si no, `null`. Siempre viene.» Frontend reads both optional first (deployment order: the strict board
  schemas must accept the key before the backend merges). User, relayed: «nadie TOQUE NADA DE AWS TODAVIA».
- **L4** Exploration (T2–T4): artboard `04-tarjeta-y-dialogo.html:321` header = 40×40 tile (`rounded-[14px]`, primary/10,
  lucide `Repeat` 20px) + «Iniciar reemplazo» + meta «<título> · <empresa>»; company name from
  `useCompanyMembershipState()` (`state.kind === "exists"` → `company.name`). «Acciones» hidden by `board.tsx:145` when
  `allowed_actions` is empty and `can_start_replacement` is false (finished original with an active replacement); the
  artboard keeps the button with «Iniciar reemplazo». Breadcrumb: `components/company-dashboard/site-header.tsx` truncates
  the only copy of the title at 390; precedent `candidate-dashboard/candidate-header.tsx:28-34`.
- **L5** (2026-11-22) User, on the documents contract question «¿también descartados?»: «Sí, también descartados».
  Power loss interrupted the first full-suite run; rerun at `3e1c4aab`: 599 files / 10933 tests passed (2 skipped), tsc 0,
  lint 0 errors (12 pre-existing warnings).
- **L6** Browser check (verifier) on :3000 dev `3e1c4aab` against backend main `fc0fd252` (dev DB v63), account Andrea
  Salinas (Grupo Altavista), 390/1440 light/dark: S1 pass («Descartado · No cumple requisitos · antes: Nuevos»), S2 pass
  (Repeat tile, «Supervisor(a) de Obra · Grupo Altavista»), S3 pass (disabled «Iniciar reemplazo» + «Ya hay un reemplazo
  activo para esta vacante.»), S5 pass («Retomado» on the carried card of `01a1fa85`), S4 pass with D1: at 390 a long title
  squeezed the crumb `<nav>` under its 40px link and the h1 covered part of the back link (tap area ~27–33px). Fixed with
  `max-sm:shrink-0` on the nav (RED/GREEN in site-header.test.tsx; related 24 files / 257 tests); not re-measured in the
  browser. S6 not verifiable without editing data (the only private replacement misses publish fields; «1 candidato»
  stays unit-tested). No console errors, no ≥400, no page overflow. Out of scope, noted: original «Contador(a) Senior»
  shows «Cerrada · Cubierta» with «Cobertura 0 de 1» after the departure.
- **L7** Merged to local main `aa93c739` (not pushed). Backend on «Cerrada · Cubierta» + «Cobertura 0 de 1»: «es lo que
  pide el contrato, S7/REP-7 … La etiqueta muestra el resultado del cierre, que queda congelado, y la cobertura es en
  vivo … es un tema de copy de UI (por ejemplo, «Cubierta al cierre»)». User chose «Sí: «Cubierta al cierre»» with the
  option text «Solo cuando la cobertura de hoy es menor que la del cierre. Si no, sigue diciendo «Cubierta».»
- **L8** Backend list-row `coverage: {covered, required} | null` (main `ad5fa542`, same rule as board.coverage). Browser
  check (verifier) on :3000 dev `48d3c049` against `ad5fa542`, Andrea Salinas, 390/1440 light/dark: list rows of the three
  closed-as-filled vacancies below target (Contador(a) Senior 0/1, Supervisor(a) de Almacén 1/2, Supervisor(a) de Obra 1/2)
  read «Cerrada · Cubierta al cierre»; the 14 at 1/1 read «Cerrada · Cubierta»; Cancelada/Otro/Sin motivo unchanged; each
  board's «Motivo de cierre» matches its row; the close dialog still offers «Cubierta» (opened and cancelled). No console
  errors, no ≥400, no overflow.
