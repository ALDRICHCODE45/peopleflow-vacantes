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
- **L6** User answers (asked by the backend session): Q1 «Sí, cuenta como vacante activa (recomendado)»; A1 «No, bloqueado mientras haya uno activo (recomendado)»; A3 «Sí, cuenta como entrega, igual que una carga manual (rec.)». A2/A4/A5/A6 accepted by the backend as technical. Next: frontend review of the contract.
- **L7** 2026-11-19, backend worker: frontend review applied to `docs/contracts/replacement-processes-v1.md` (still DRAFT, T1 not done). The 13 points:
  (1) `GET V/replacements` gains `carry_candidates[]` {candidate{kind,id,full_name}, process_id, participation_id, stage{kind,name}, discarded, eligible, reason?},
  most-recent-participation rule, currently placed excluded; POST `stage_id` is chosen among the SOURCE process stages, the previous stage is shown by name only.
  (2) New «Deployment order» section (frontend optional keys + new-409 decoders → backend R2/R6 emit → frontend required; local merge after or together) and an
  explicit list of every `VacancyRef` carrier that gains `kind`/`root_draft_id`/`sequence` (metrics lists, `pipeline.top_vacancies`, `delays.overdue.top`,
  dashboard rows; `overdue.top` disambiguated from the dashboard `attention.deliveries.top`). (3) Start from a closed-active source finishes it atomically
  (`finish_process` event + `VacancyProcessFinished` `cause = replacement_started`); a finished source is accepted (D2, D15, errors, audit). (4) Only the latest
  process of the chain can start (D14), `replacement_source_not_latest`. (5) `allowed_actions` drops `reopen` also when `active_replacement_id` is another process
  (and, new A7 to confirm, when the process has a successor: `reopen_superseded`). (6) The departure discard returns an optional `lifecycle` object on placement
  departures. (7) Errors: one `replacement_source_not_closed` entry with `data.lifecycle`; `replacement_already_active` with `data.lifecycle`;
  `target_quantity` below the credit count → 400 `validation_error` with `fields[]`. (8) `publish_ready` + `missing[]` in `start_replacement`. (9) The vacancy-level vs
  process-level table is NORMATIVE; `process_kind` absent = all, invalid → `invalid_filter`. (10) `root_process_id` filter on the draft list (cursor-bound).
  (11) `stage_map` and `carried[].stage_id` are informative; the frontend decodes `{id, kind, lifecycle}` + headers. (12) The «Spec» column cites the feature doc's
  S#; NOT remapped as requested (D2/D3=S1, D4=S5, D5=S4, …) because that mapping contradicts S1-S9 above (S4 is publication, S5 candidates); a sentence now states the
  column's meaning. (13) Audit labels are the frontend's. Slices updated (R2 ~400, R3a ~450, R4 ~350, R5 ~250, R6 two slices, R7 folded into R6b).
- **L8** Backend session accepts A7 (a process with a successor cannot be reopened, 409 reopen_superseded) and confirms D14/D15/D16 implement «uno solo activo por vacante lógica» (start finishes a closed-active source atomically; only the latest process starts or reopens; late departures still allowed on finished). Point 12: the frontend mapping used its own S# numbering; the Spec column keeps this doc S#. Contract ready for the frontend to close.
