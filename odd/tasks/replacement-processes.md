# Replacement processes linked to the original vacancy

2 Oct agreement «Procesos de reemplazo vinculados a la vacante original» (was «❌ No iniciado (hoy se marca "no se
sostuvo")»). Rules: `docs/recruitment-business-rules.md` REP-1…REP-13, REO-2; discovery
`odd/discovery/recruitment-business-rules.md:123-136`. Frontend on `feat/replacement-processes`; backend on
`feat/replacement-processes-backend` (backend session), contract `docs/contracts/replacement-processes-v1.md` (backend
writes it; frontend reviews before implementation).

## Specs

- **S1** Start: «Placement «no se sostuvo» + vacante cerrada (rec.)», no time limit. «Un reemplazo puede cubrir varias
  bajas (recomendado)». Entry point «Iniciar reemplazo» picks which «no se sostuvo» hires it replaces.
- **S2** Reopen (REO-2): «Si cerró cubierta: reemplazo, no reabrir (Recomendado)» — a vacancy closed covered shows
  «Iniciar reemplazo» instead of «Reabrir»; one closed without full coverage reopens as today.
- **S3** Late departure (REP-7): «Con el proceso cerrado, solo «No se sostuvo» (Recomendado)» — the finished board stays
  read-only except marking that a hire in Placement left; coverage drops and «Iniciar reemplazo» becomes available; the
  original result is not rewritten.
- **S4** Resumed candidates: «Cualquiera, sin entrar directo a Placement (rec.)» / «En cualquier etapa menos Placement
  (Recomendado)» — discarded or still-in-pipeline candidates of the source, previous stage shown as reference, the
  recruiter confirms the starting stage (audited); Placement only by a later move.
- **S5** Publication: «Privado por defecto, con opción de publicarlo (recomendado)»; a published replacement is a normal
  listing (no public mention of replacement); publishing later does not restart its clock.
- **S6** Look: «Mismos estados con insignia «Reemplazo» (Recomendado)» — same lifecycle states as any vacancy, a
  «Reemplazo» badge and the link original ↔ replacement; «activo» = process not finished; one active per logical vacancy.
- **S7** Metrics (DEL-10): «Una vacante lógica, reemplazo separado (Recomendado)» — the logical vacancy counts once;
  the replacement's deliveries, time and placements are its own, filter «Originales / Reemplazos», badge in details;
  the original result does not change.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S1–S7 | Review the backend contract `replacement-processes-v1.md` against S1–S7 | backend `e715a257` (accepted) |
| T3a | S1–S7 | Deployment step 1: new lifecycle/list/VacancyRef keys optional in every strict schema + decoders for the new error envelopes (contract «Deployment order») | `4398018a` |
| T2 | S1, S4, S5 | (done, L7) Design proposals (gentle-design): «Iniciar reemplazo» flow with hires to replace, resumed candidates with start stage, private/publish | |
| T3 | S2, S3, S6 | (`92d2a564`) Lifecycle and board: reopen guard, late «No se sostuvo» on a finished board, «Reemplazo» badge and original ↔ replacement link (portfolio, board header, list) | |
| T4 | S1, S4, S5 | Start-replacement flow implementation from artboard `04-tarjeta-y-dialogo.html` (card «⋯» menu + 3-step dialog) | `c3fae6d7` (dialog), `99ea704b` (wiring) |
| T5 | S7 | (`5b0060e4`) Métricas and dashboard: «Originales / Reemplazos» filter and badges | |
| T6 | S1–S7 | Browser check against the backend branch, full suite, local merge | this merge |

## Log

- **L1** User (2026-11-19): «OK.» to the recommendation «procesos de reemplazo» as the next 2 Oct agreement.
- **L2** Explorations: nothing of the replacement exists in frontend or backend; «no se sostuvo» = placement credit
  `did_not_hold` on leaving Placement with `candidate_left`. Backend: `vacancy_processes.id = job_drafts.id`, so a
  replacement is a new draft + process linked by `vacancy_replacements` (source, root = logical vacancy) and
  `vacancy_replacement_credits` (a fallen credit is replaced once); `POST …/job-drafts/{id}/replacements`.
- **L3** User answers (backend block): start «Placement «no se sostuvo» + vacante cerrada (rec.)»; «Un reemplazo puede
  cubrir varias bajas (recomendado)»; «Privado por defecto, con opción de publicarlo (recomendado)»; «Cualquiera, sin
  entrar directo a Placement (rec.)». Frontend block: «Si cerró cubierta: reemplazo, no reabrir (Recomendado)»; «Con el
  proceso cerrado, solo «No se sostuvo» (Recomendado)»; «En cualquier etapa menos Placement (Recomendado)»; «Mismos
  estados con insignia «Reemplazo» (Recomendado)»; «Una vacante lógica, reemplazo separado (Recomendado)».
- **L4** T2 (worker): `design/replacement-processes/` with `01-dialogo-en-pasos.html` (3-step dialog from «Acciones»),
  `02-pagina-de-configuracion.html` (full page, board alert, sticky summary), `03-hoja-lateral.html` (side sheet, header
  CTA); desktop 1440 + 390, light/dark; no overflow, axe 0 violations. Contract review (T1): 13 observations sent to the
  backend (carry-candidates read, deployment order for strict schemas, source must be finished, only the latest closed
  process offers the start, reopen hidden while a replacement is active, publish readiness, error fields, root filter).
- **L5** User on the artboards (verbatim): «yo creo que lo mejor seria algun tipo entre la opcion 1 y la 2, poruqe me gusta el
  dialog de la uno y me gusta que la accion salga desde la "card" del kanban del candidato, no desde el sheet del
  candidato.» Hybrid `04-tarjeta-y-dialogo.html` requested (card «⋯» menu → 01's dialog; 01 link bar; 02 portfolio groups).
- **L6** Contract accepted at backend `e715a257`: carry_candidates[] (eligible only), publish_ready + missing[], deployment
  order (frontend step 1 first), normative process_kind table, root_process_id filter on job-drafts, D14 (only the latest
  process starts or reopens), D15 (starting from closed-active finishes the source atomically), D16 (late departure on
  finished via discard, returns lifecycle), 409s with data.lifecycle: replacement_source_not_latest, reopen_superseded,
  replacement_already_active.
- **L7** User approved `design/replacement-processes/04-tarjeta-y-dialogo.html` (verbatim): «si esta bien, hermano,
  aprovado.» Handoff started for T3/T4 from that artboard.
- **L8** T3a `4398018a` (worker, TDD: RED 20 tests + missing module, GREEN 254; related 226 files / 4798 tests; tsc and
  eslint clean): shared `lifecycleSchema` gains the ten optional keys (all lifecycle clients inherit them), draft-list row,
  metrics top_vacancies/overdue.top vacancy and dashboard vacancyRef gain optional keys, discard response may carry
  `lifecycle`; new `vacancy-lifecycle/replacement-errors.ts` decodes the five 409s, three 422s and `validation_error`
  with `fields[]`; reopen guards mapped to copy. Risk: item 3 (shared publication/movement error envelopes and
  `jobs/drafts/api/client-v2.ts`) → full suite before merge. Non-strict metrics list VacancyRefs left for T5.
- **L9** T4 `c3fae6d7` (worker, TDD: RED missing modules, GREEN 98): `features/vacancy-replacement/` (GET/POST client,
  actions, error copy, 3-step dialog; responsible defaults to the caller per contract D13; caller passes source stages and
  still-placed hires). T3 `92d2a564` (worker, TDD: RED 23 tests / 10 files, GREEN related 51 files / 804 tests): card «⋯»
  late «No se sostuvo» via discard on a finished board (departed card shows in Descartados per contract, badge «No se
  sostuvo»), «Iniciar reemplazo» on the card and in «Acciones», badges + link bar, portfolio «N reemplazos» groups via
  `root_process_id`; old backend = today's UI. Asked backend for credit status on board items, the late-departure
  discard reason, and names in the link bar. Wiring + audit labels delegated.
- **L10** Wiring `99ea704b` (worker, TDD: RED 13, GREEN related 26 files / 439 tests): card → dialog with credit
  preselected and source stages, «Acciones» → dialog, portfolio reads the board then opens it, onStarted navigates to the
  new pipeline; audit labels «Inició un reemplazo» / «Retomó a un candidato en un reemplazo». T5 `5b0060e4` (worker, TDD:
  RED 38, GREEN 309; related 45 files / 636 tests): «Proceso» filter (Todos los procesos / Originales / Reemplazos) in URL,
  every metrics request, chips and CSV; caption «No cambia con el filtro de proceso» on vacancy-level figures; «Reemplazo»
  badges in detail, top_vacancies and overdue rows. Backend agreed: startable_credits carries participation_id, hired_at
  and candidate; chain items carry title and sequence (R4); late-departure discard reason stays from the existing catalog.
  Dashboard rows' `kind` not shown (no filter in v1).
- **L11** Browser check (verifier) on :3000 `e15ae6e5` against backend `1e4749ba` with 00063 on dev, owner of Altavista,
  original `01a1f21e-22dc-7e85-9b05-8912c1010e7a` → replacement `01a1fa51-419a-7ead-b589-a5f133b80f4f`: S1, S2, S3, S4,
  S5 (dialog), audit labels pass; no console errors, no ≥400 from the browser, no overflow. S6 FAIL: a private
  replacement opens the draft screen (board gated on the publication read, which says draft for private replacements per
  D4). S7 pending backend at that time (422 invalid_filter; R6 since committed). UI defects vs artboard: no publish-later,
  list row «Publicada» next to «Privada», dialog footer and step 2 layout at 390/1440, confirmation layout, disabled «⋯»
  instead of state 11, header title truncation at 390. Fixes delegated. Backlog: dashboard participation charts still
  count carried participations (backend, out of scope); confirm whether the departed hire should be carryable.
- **L12** Fixes `7f6024cd` (private replacement opens its board from the lifecycle, publish later from board and row,
  «Privada · sin publicar», state-11 card menu from `fallen_credits`, dialog/confirmation/header layout) and `448deb04`
  (`departed_hire` carry rejection, user decision «No, excluirla del reemplazo (Recomendado)», backend R3d `f903517c`).
  Metrics keys `cacd102b`. Browser re-check on :3000 `448deb04` against backend `ff33fb48`: S1–S7 pass, audit and dark
  pass, no console errors, no ≥400, no overflow; previous defects fixed except step 2 scrolling 20 px with a long
  readiness list and the long-title breadcrumb ellipsis at 390. Created: replacement `01a1fa85-ed4c-7aea-865b-34237e4a3999`
  (Contador(a) Senior); `01a1fa51…` published. Polish delegated: metrics badge wrap at 390, step 2 fit, keep «Proceso
  iniciado el» after publishing, «1 candidato» plural, named link bars, confirmation box. Backlog: «Retomado» mark on
  carried cards needs `carried_from_participation_id` on board items (backend + deployment order); dashboard participation
  charts count carried participations (backend).
- **L13** Polish `8a46965a`, `9114769c`, `287186c0` (metrics badge wraps at 390; compact publish readiness so step 2 fits
  at 1440×900; «1 candidato»; named link bars «Reemplaza a <nombre> en <título>» / «Reemplazo en curso para <nombre>»;
  tinted departure box, bottom sheet at 390; a public replacement keeps «Proceso iniciado el» with «Publicada el»
  stacked; dark tint via `primary-text` because `brand-decorative-strong` is not a Tailwind color). Short browser check
  against backend `c3221415` (R3e: only replacements can be private): originals without a listing show no «Publicar» or
  «Privada», named bars, both dates, step 2 without scroll, confirmation layout, metrics badge — pass; dark tint and the
  1440 header re-checked after `287186c0`. «1 candidato» covered by unit test only (the private replacement misses
  publish fields). Full suite at `9114769c`: 597 files / 10905 tests passed (2 skipped), tsc 0, lint 0 errors (12
  pre-existing warnings); `287186c0` class-only, related 94/94. Backend branch closed at `7fd2205a`; it merges first.
