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
| T1 | S1–S7 | Review the backend contract `replacement-processes-v1.md` against S1–S7 | |
| T2 | S1, S4, S5 | Design proposals (gentle-design): «Iniciar reemplazo» flow with hires to replace, resumed candidates with start stage, private/publish | |
| T3 | S2, S3, S6 | Lifecycle and board: reopen guard, late «No se sostuvo» on a finished board, «Reemplazo» badge and original ↔ replacement link (portfolio, board header, list) | |
| T4 | S1, S4, S5 | Start-replacement flow implementation (after T2 choice) | |
| T5 | S7 | Métricas and dashboard: «Originales / Reemplazos» filter and badges | |
| T6 | S1–S7 | Browser check against the backend branch, full suite, local merge | |

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
