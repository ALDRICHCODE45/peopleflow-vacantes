# Replacement processes (backend)

Backend half of the 2 Oct 2026 agreement «procesos de reemplazo vinculados a la vacante original». Branch
`feat/replacement-processes-backend` (worktree `../peopleflow-vacantes-replacement`). Frontend in its own session.
Contract: `docs/contracts/replacement-processes-v1.md` (draft first, reviewed by the frontend before implementation).

## Specs

- **S1** Model: a replacement is a NEW job draft + vacancy process cloned from the original, linked to its source
  process, to the logical vacancy root, and to the fallen placement credits it replaces (each credit replaced once).
- **S2** Start — user: «Placement «no se sostuvo» + vacante cerrada (rec.)»: requires one or more `did_not_hold`
  placement credits of the source (or its chain) and the source closed; no time limit. Explicit start (REP).
- **S3** Several fallen placements — user: «Un reemplazo puede cubrir varias bajas (recomendado)»; target defaults to
  the number of credits.
- **S4** Publication — user: «Privado por defecto, con opción de publicarlo (recomendado)». Relayed: «Publicarlo es
  opcional y sale como aviso normal, sin decir que es reemplazo; publicarlo después no reinicia el reloj.»
- **S5** Reused candidates — user: «Cualquiera, sin entrar directo a Placement (rec.)» and «En cualquier etapa menos
  Placement (Recomendado)»: any candidate of the original (discarded or still in the pipeline), new participation, at
  the recruiter-chosen stage (audited), never Placement.
- **S6** REO-2 — user: «Si cerró cubierta: reemplazo, no reabrir (Recomendado)». Relayed: «Si la vacante cerró
  cubierta, «Reabrir» desaparece y aparece «Iniciar reemplazo»; si cerró sin cubrirse, se puede reabrir como hoy.»
  Reopen returns 409 with its own code.
- **S7** REP-7 — user: «Con el proceso cerrado, solo «No se sostuvo» (Recomendado)». Relayed: «Con el proceso cerrado
  o finished, el tablero sigue de solo lectura salvo una acción: marcar que un contratado de Placement se fue (motivo
  candidate_left o moved_by_mistake). La cobertura baja y queda habilitado «Iniciar reemplazo». El resultado original no
  se toca.»
- **S8** States — user: «Mismos estados con insignia «Reemplazo» (Recomendado)». Relayed: «Activo» = proceso no
  terminado (process_status active), uno solo por vacante lógica.
- **S9** Metrics — user: «Una vacante lógica, reemplazo separado (Recomendado)». Relayed: «La vacante cuenta una sola
  vez, no como nueva. Entregas, tiempo y placements del reemplazo son del proceso, con filtro «Originales / Reemplazos»
  y una insignia en los detalles. El resultado original no cambia.»
- **S10** Frontend needs (relayed): lifecycle of the draft with kind original|replacement, replacement_of, root,
  can_start_replacement; draft list with kind and root; POST replacements with an «already active» error; the
  departure endpoint on a finished process; metrics filters.

## Tasks

- [ ] T1 (S1-S10) Contract draft `docs/contracts/replacement-processes-v1.md`; frontend review — worker + parent.
- [ ] T2+ Implementation slices — defined after the contract is agreed.

## Log

- **L1** 2026-11-19, relayed by the frontend session as authorized by the user: «Nuevo frente, autorizado por el
  usuario: procesos de reemplazo vinculados a la vacante original (acuerdo del 2/10, sin iniciar; hoy solo se marca el
  placement como «no se sostuvo»).»
- **L2** Backend map (read-only explore): vacancy_processes.id = job_drafts.id and every per-process table keys on the
  draft id; did_not_hold is a side effect of leaving Placement with candidate_left (board/credits.go:19-77); finished
  blocks every board write (board/store.go:77-89); reopen allowed on a fulfilled closed original (conflicts with REO-2).
- **L3** User decisions asked by the backend session: S2, S3, S4, S5 (quoted above).
- **L4** User decisions relayed verbatim by the frontend session: S5, S6, S7, S8, S9 and S10 needs (quoted above).
- **L5** 2026-11-19, backend worker: drafted `docs/contracts/replacement-processes-v1.md` (DRAFT for frontend review; nothing
  approved, T1 not done). It maps S1-S10 to D1-D13, proposes migration `00063` (`vacancy_replacements`,
  `vacancy_replacement_credits`, `process_participations.carried_from_participation_id`), the endpoints
  (`POST/GET V/replacements`, lifecycle and draft-list keys, `reopen_requires_replacement`, departure = existing
  `POST …/discard` with a finished-process exception, `process_kind` metrics filter with a vacancy-level vs process-level
  figure table), two audit events (`VacancyReplacementStarted`, `VacancyCandidateCarried`, four-places reminder) and slices
  R1-R7. Facts found that shape the design: built-in stage ids are anchored to the draft id (`decodeStoredPipeline`), so a
  replacement's built-in stage ids are new and requests name stages by source id; a private replacement needs a process row
  without a projection, and `refreshPublicProjection` would publish it on first save unless fixed; a participation needs a
  process row. Assumptions to confirm: A1 reopen blocked while a replacement is active, A2 carried candidates addressed by
  `{kind, id}` (not only `company_candidate_id`), A3 carried intake counts as delivered like manual intake, A4 unknown
  participation on a finished process answers 404 on discard, A5 «assigned» counts a root if the recruiter has a tramo on
  any process of the chain, A6 closed covered = latest close reason `filled`. Open question Q1: dashboard counts of a private
  active replacement.
