# Vacancy team and assignment («Asignación de la vacante»)

A vacancy is worked by a team of 1..N recruiters with assignment periods (tramos); the owner reassigns the responsible,
the responsible manages collaborators, and placement credit follows the team mode. Frontend over
`docs/contracts/vacancy-team-v1.md` (backend session, worktree `peopleflow-vacantes`); product source
`docs/product/next-three-features.md` §1. Feature 1 of 3 (then 1b talent-pool visibility, 2 audit, 3 stakeholder).

## Specs

- **S1** Team of 1..N recruiters per vacancy: «una vacante este asignada a mas de un reclutador, por vacante, y que
  puedan trabajar en conjunto para llegar a las metas, y aqui, importa mas que nunca la auditoria». Each member holds a
  tramo (continuous stay) with functions inside it; the vacancy workspace shows the team and its history.
- **S2** Electable mode per vacancy: «considero que es interesante que esto sea elegible, que pueda o no haber un
  responsabe mas colaboradores». Credit: «si hay un responsable asignado mas colaboradores, entonces el credito directo
  del placemente es del responsable y los demas son participantes en el placement", y si no se asigno un responsable,
  entonces el credito es de todos». Default at creation: with responsible, the creator is the responsible (Q2).
- **S3** Permissions: «las cosas que "solo pueda hacer el owner" se limiten a las acciones mas sencibles y especificas,
  no a cada cosa que consideremos "importante"»; «Sumar o sacar colaboradores los puede hacer el responsable». Owner
  only: reassign the responsible, change the mode, remove another member in a team without responsible («1. estoy de
  acuerdo, que el owner saque. 2. si, el owner.»). The responsible cannot leave on their own; a collaborator can
  («3. estoy de acuerdo tambien con lo que dices.»). The UI never derives permissions: it renders `viewer.can.*`.
- **S4** Reassignment: «el motivo es obligatorio de una lista y la opcion de otro con nota»; state snapshot at the change
  («si, eso es lo que quiero»); «asi es, solo el owner». The owner chooses whether the previous responsible stays as a
  collaborator; default «sale de la vacante» (Q10).
- **S5** Deadlines: the recruiter deadline is optional; when unset it falls back to the client commitment date (Q7).
  After publication the commitment date changes only by renegotiation with a reason from the list (pedido del cliente,
  cambio de alcance, retraso interno, otro con nota), done by the team (Q8).
- **S6** Leaving placement (move or discard) asks for the credit's fate: «Lo moví por error» voids the credit; «El
  candidato renunció / no se presentó / se cayó después» keeps it as «placement que no se sostuvo». Discard asks for
  both its own reason and this one. The owner can void / restore a credit afterwards (Q6).
- **S7** Removing a company member who is the responsible of non-finished vacancies runs «Reasignar sus vacantes a…»
  (one person for all, or per vacancy), reason «baja del reclutador», as one operation (Q5).
- **S8** The recruiter who leaves loses the vacancy; their work stays attributed; they see their own tramo summary
  without candidate data («Vacante X, tu tramo del 1 al 12, entregaste 8»). A request after losing access shows that
  access ended, not «la vacante no existe» (`team_access_ended`).
- **S9** All remaining decisions: «si hermano, voy con esas.» (Q2–Q4, Q7–Q12; no team size limit; no notifications in
  v1).
- **S10** UI priorities approved («Completamente, a darle.»): shadcn first, never hand-built (rules §1, §2, §5, §19,
  read `docs/design/shadcn-reference/` before each component); validated screens keep their design (§21); base = the
  layout of artboard 03 plus «la composicion de las cards, se usaron iconos solo cuando son necesarios, el orden de las
  cosas»; one primary action per surface, badges only for categories (§15, §16); skeleton, content and empty states
  (§11, §22); important actions through `ConfirmActionDialog` with their fields inside, no chained dialogs (§18);
  results by Sileo `notifyActionResult` (§12); permissions only from `viewer.can.*`; Mexican Spanish with «tú»,
  plural helper; browser review and shadcn audit before delivery (§25). Prototype in the app with real components
  and contract-shaped fixtures, development only; first the team page + reassign, reviewed by the user before the
  rest.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1–S9 | Contract review with the backend session (done, L4) | — |
| T2 | S1–S8 | Design directions (gentle-design): 01–07 rejected (L7); 03 layout kept as base | — |
| T2b | S1–S4, S10 | In-app prototype: team page (configuración › Equipo) + reassign responsible, fixtures, user review | — |
| T3 | S2, S5, S6 | Breaking changes: `team` in draft list/read, `placement_exit_reason` in move/discard, commitment 409 on delivery PUT | — |
| T4 | S1–S5 | Team panel in the vacancy workspace: read, add, remove, leave, deadline, mode, reassign responsible, history | — |
| T5 | S6 | Placement credit in participation detail + owner void/restore | — |
| T6 | S5 | Commitment renegotiation dialog | — |
| T7 | S7 | Offboard flow in Equipo (preview + reassign + remove) | — |
| T8 | S8 | Own tramo history view and `team_access_ended` handling | — |
| T9 | all | Integration against the real backend, verification | — |

## Log

- **L1** (user, 2026-11-02, original request): «Bien hermano, quisiera discutir contigo la siguiente funcionalidad de
  este sistema, ... 3 Y lo tercero es sobre la reasignacion de una vacante, no se si eso ya lo habiamos platicado o no,
  pero es importante, hay muchas veces que el reclutador ya no puede, o esta quedamo sobre la vacante, y se decide
  hacer el cambio, y puede a priori, parecer algo sencillo, pero hay muchas cosas que considerar, es decir, el primer
  reclutador ya tenia avance, ya habia subido candidatos, YA HABIA USADO TIEMPO de su fecha de entrega de candidatos,
  hay que tener todo eso bien capturado, es decir, hay que pensar bien, en la reasignacion, se va a cambiar tambien el
  tiempo maximo de entrga, que tiempos se van a cambiar, el tema de la auditoria, que se quede guardado, cuando cambio,
  a quien se reasigno, quien la tenia, el estado de la vacante antes de cambiar de reclutador, y tambien deberia de
  tener un apartado propio para analiticas/dashboard que sirve igualmente para la vista del stake holder, que pueda ver
  no se... un promedio de cuantas veces un reclutador tiene que dejar su vacante y reasignarla a otro reclutador, que
  vacantes se han reasignado, cuantas veces, a que reclutador, me sigues??» (full text: product doc and Engram
  `product/next-three-features-2026-11`). Order agreed: assignment → audit → stakeholder.
- **L2** (user): placement credit to the recruiter assigned at placement; multiple recruiters per vacancy; mandatory
  reason; snapshot; owner only reassigns; «este sistema aun no esta en produccion, no tiene datos reales ... toda la
  data que hay ahora, es data de desarrollo, no es data real de produccion, es desechable».
- **L3** (user): modes electable, credit by mode, responsible manages collaborators, owner-only list approved. Q1/Q5/Q6
  decided directly with the backend session; Q2–Q4, Q7–Q12: «si hermano, voy con esas.»
- **L4** Backend wrote `docs/contracts/vacancy-team-v1.md` (branch `docs/vacancy-team-contract`, uncommitted pending
  user authorization). Frontend review points 1–7 answered: members list is recruiter-readable (membership id ≠ user
  id); participation detail gains `placement_credit` + `can.void_credit/restore_credit` and a credits list; discard
  out of placement asks for both reasons; tramo = continuous stay with `functions[]` (mode change no longer splits);
  `GET /company/members/{id}/offboard-preview`; 404 `team_access_ended`; ETags stated. T1 done.
- **L5** Data is disposable; the contract's backfill keeps dev data usable. Talent-pool visibility (1b) and
  notifications (Q12) are out of scope, recorded in the backlog/roadmap.
- **L6** T2 design proposals under `design/vacancy-team/`: `01-equipo-configuracion.html` (S1–S5, list/detail),
  `02-franja-y-panel.html` (S1–S5, pipeline strip + sheet), `03-equipo-e-historia.html` (S1–S5, team + timeline),
  `04-reasignar-responsable.html` (S3–S5), `05-placement-y-credito.html` (S6),
  `06-renegociar-compromiso.html` (S5), `07-baja-y-mis-tramos.html` (S7–S8). Manifest `design.json` links this feature;
  per-artboard token self-check and limitations are in `self-check.md`. 01–03 are alternatives awaiting the user's
  choice; 04–07 complement any direction. No production implementation. Canvas `list`/`open` and rendered visual
  verification remain pending because this worker does not expose `gentle_design`; the parent must open slug
  `vacancy-team` and report the returned URL.
- **L7** (user, 2026-11-02, on 01–07): «ninguna opcion me gusta, la ui no es nada buena, no es ni parecida a los
  compnentes de shadcn que tenemos, las acciones son como drops basicos y muy malos ... como opcion de configuracion y
  posicionamiento de las cosas/opciones y donde se ubica cada cosa, el tercero me gusta mas, pero de nuevo, no es nada
  parecido al estilo que tenemos ahora en todo el sistema..» Kept: «en la mayoria de veces respeto la composicion de
  las cards, se usaron iconos solo cuando son necesarios, el orden de las cosas o el "layout" de las cosas es bueno ...
  tiene una buena base, pero el diseno en si, el resultado, es malo.» None chosen; 03's structure is the base. Cause:
  native controls and token-only styling instead of the real shadcn components.
- **L8** Backend committed the contract with the user's authorization on `docs/vacancy-team-contract`: `56d7dacb`
  docs(contracts) vacancy team v1, `2956603d` docs(roadmap). Not merged or pushed.
- **L9** (user, 2026-11-02): path 2 approved («si hermano, adelante con tu recomendacion»), and the UI priorities in S10
  («Completamente, a darle.»). T2b starts: in-app prototype of the team page + reassign, delegated (context backstop).
- **L10** (user, 2026-11-02): «el backend no esta haciendo nada, coordinate con el para comenzar a implementar los dos
  en cuanto sea posible.» Sent to the backend session: implement vacancy team v1 in parallel on its own feat branch,
  slices in order: (1) team reads + members list, (2) team writes/reassign/mode, (3) breaking changes, (4) credits,
  offboard, own history; ping with SHA per slice; contract diffs before committing.
- **L11** (backend, 2026-11-02): started on `feat/vacancy-team-backend` (tracking `odd/tasks/vacancy-team-backend.md`,
  c77f5d66). Slices: T1 migration 00054 + access guard + team_access_ended + GET V/team + GET V/team/history; T2
  writes/reassign/mode; T3 breaking changes; T4 credits; T5 offboard; T6 own history. Members list = existing
  `GET /v2/me/company/members` (recruiter-readable). Until T3, draft `principal_recruiter` and v2 `principal` keep their
  shape (derived from the responsible). QA auth: local PEM mode (IDENTITY_JWT_MODE=pem). T2b prerequisites resolved by
  the parent: added `docs/design/shadcn-reference/calendar.md` + `examples/calendar-example.tsx.txt` (official,
  fetched 2026-11-02); typecheck runs as `pnpm exec tsc --noEmit --incremental false`.
- **L11** Contract amendment agreed with the backend (`25942f8d` on `feat/vacancy-team-backend`): table
  `vacancy_team_mode_changes`; `GET V/team/history` is one mixed timeline (`tramo` | `reassignment` | `mode_change`),
  20 per page, opaque cursor, 400 `invalid_cursor`; a tramo's `at` is its latest event (frontend request); after its
  own writes the UI re-reads from the first page. Prototype worker: business dates reuse
  `delivery-config/date-field.tsx`; typecheck with `--incremental false`.
- **L12** (T2b prototype, 2026-11-02): added the development-only configuration route
  `/empresa/vacantes/{jobId}/configuracion/equipo`; the existing configuration navigation gains Equipo only when
  `NODE_ENV=development` and `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1`. From `frontend/`, run
  `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1 pnpm dev`, then open
  `http://localhost:3000/empresa/vacantes/{an-authorized-existing-draft-UUID}/configuracion/equipo?fixture=owner`.
  Fixtures: `owner`, `collaborator`, `shared`, `long-history`, `empty-history`; `state=loading` and `state=error`
  expose explicit review states. Writes update memory only; refresh resets them, and results use informational
  `notifyActionResult`, not a server-save success. No real team client or production entry point exists.
  S1–S4/S10: typed Zod boundaries, company picker subtracting active user IDs, capability-only actions, mode/team/history
  layout, avatar/function/deadline display, confirmation dialogs, reassignment reason/note/previous-responsible choice
  and snapshots, 20-item mixed history with first-page reload after writes. Important remaining gap: the mandated
  `DeliveryDateField` hardcodes the visible label «Fecha compromiso» and IDs; its API cannot label a recruiter deadline.
  No new Calendar or shared UI edit was made. Selecting a new recruiter deadline (including the optional date inside
  reassignment) remains pending; the deadline action currently only removes the override to use the commitment date.
  The real company layout and authorized draft gate remain intact: start the existing backend/auth environment and
  sign in as an employer with access to the draft. The prototype's team data itself needs no backend endpoint.
  Browser review remains pending for all fixtures/dialogs, desktop/mobile and light/dark: bundled Playwright Chromium
  was unavailable; system Chrome launched, but localhost:3000 refused the connection. No server was started by the
  worker. Focused tests, TypeScript and touched-file ESLint were exercised; final observed results are in the handoff.
- **L13** Recruiter deadline gap closed inline (worker mvztaaxd timed out without changes): `BusinessDateField` extracted
  from `DeliveryDateField` (delivery screen unchanged, pinned by `date-field.test.tsx`, which passed before the change);
  «Plazo del reclutador» in «Editar plazo» (`deadline-dialog.tsx`, with «Usar la fecha compromiso») and in «Reasignar
  responsable». Calendar comes from the client (`calendar`, real adapter: GET V/pipeline/delivery). RED observed for both
  new uses; GREEN: 11/11 in team + date-field, plus 92 in the wider focused run; tsc and ESLint clean. The deadline test
  opens `DeadlineDialog` directly because DropdownMenu loops in jsdom; the menu path is browser QA. Browser review is
  the user's: employer sign-in is Cognito with the user's account. QA: API from main on :8080 (backend session), Next on
  :3000 with `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1`.
- **L14** (user, 2026-11-02, prototype review): «todo parece un tramite, en ciertos lugares parece mucha informacion, el
  usuario se satura, no sabe a que prestar atencion ... me gustaria que algunas cosas en lugar de desplegables fueran
  sheets, como el estado guardado, o cosas que son mucha data»; «no se ve para nada bien un dropdownmenu cuyas opciones
  ocupen mas de una linea» (system design rule); «el apartado de historia de equipo ... propon algo sencillo, pero no me
  gusta historia, las cards de la "historia" son muy planas, secas, no parecen de peopleflow»; «lo que aparece dentro
  del "Estado guardado" ... parece un documento administrativo, en gris, negro, sin chiste»; «el historial largo se
  vuelve un scroll infinito»; «el empty state me gusta, el estado de error y de carga tambien»; «cuando termines,
  asegurate de revisar todo tu mismo por favor» (Playwright, design only). Decisions: lighter member rows; menu items
  on one line («Quitar»); section renamed «Movimientos del equipo»; the card shows the latest 5 as a tinted timeline
  and «Ver todos los movimientos» opens a Sheet with the paginated list; the snapshot lives in a Sheet «Cómo estaba la
  vacante» with visual progress (delivery, deadline used, candidates per stage); the reassign dialog shows a one-line
  summary instead of the full snapshot.
- **L15** (T2b review follow-up, 2026-11-02; S1–S4, S10): lighter member rows and one-line menu labels;
  «Movimientos del equipo» now uses one tinted timeline card capped at 5, with full cursor pagination in a floating
  Sheet. Reassignment snapshots moved from the accordion/dialog into «Cómo estaba la vacante», with progress bars,
  pipeline stage tints and lifecycle badges; the confirmation keeps only today's compact summary. Approved empty,
  error and loading compositions preserved (related copy renamed). Focused tests, TypeScript and touched-file ESLint
  passed; browser review remains parent-owned and pending. No real team endpoint or production behavior added.
- **L16** (T2b browser findings, 2026-11-02; S1–S4, S10): widened the team column at lg, grouped capability-only
  actions in Equipo actual's footer (omitted when none), and reduced mode copy to one sentence. Movements now name
  both responsible people and align the snapshot link; both Sheets close with «Cerrar». Snapshot values lead their
  progress bars without duplicate labels, fixture stages use built-in tints (unknown IDs stay neutral), placements
  use plain zero/plural copy, and the capture note reads «Guardado el …». RED observed; 41 team + 16 shell tests,
  TypeScript and touched-file ESLint passed. Empty/error/loading states preserved; browser re-review is parent-owned.
- **L17** (user, 2026-11-02, after the second browser pass, `fc24f4ae`): «me cierra completamente hermano.» T2b approved:
  the Equipo section is the visual reference for the rest of the feature.
- **L18** (T7, S3/S7/S10): extended only the existing company-member removal action with contract-shaped in-memory
  preview/offboard fixtures, one confirmation with shared PersonField pickers, team-based suggestion, per-vacancy
  overrides and atomic unresolved-map validation (422); membership IDs stay separate from user IDs. Locally run
  `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1 pnpm dev` from `frontend/`, sign in as an owner and open
  `/empresa/equipo?offboard=responsible` (default: two vacancies), `?offboard=none`, or `?offboard=collaborator`, then
  choose the existing member action «Quitar del equipo». Fixtures adapt to the selected real member and current company
  list; removing changes memory only, refresh resets it. Production/flag-off keep today's confirmation and DELETE,
  pinned by tests. 105 employer-team/vacancy-team tests, TypeScript and touched-file ESLint passed; browser review and
  real endpoint integration remain parent-owned/pending.
- **L18** Backend slice 1 done on `feat/vacancy-team-backend` (`efa6c361`; docs `55d4fc9a`, `efe64f75`): migration
  00054, access guard owner OR active tramo with 404 `team_access_ended`, creator becomes responsible, GET V/team (+ETag)
  and GET V/team/history. Draft list/read keep `principal_recruiter`/`principal` until slice 3. Backend order: slice 3
  (breaking changes) → slice 2 (team writes) → credits/offboard/own history. Contract addition agreed: snapshot
  `stage_counts[].kind` (new | screening | screening_ok | in_process | placement | custom). Requested a branch API on a
  separate port with its own DB at 54 for the real team-read client; :8080 stays on main.
- **L19** Branch QA API from the backend: http://127.0.0.1:8081 (`feat/vacancy-team-backend` @ `285395c8` = slice 1 +
  stage kind), DB `peopleflow_vacancies_team` (dev copy at 54, 12 drafts backfilled), same Cognito. Stop: PID file
  `peopleflow-vacantes/.scratch/qa-api-team/api.pid`. Frontend switches with `PEOPLEFLOW_API_BASE_URL`. :8080 stays on
  main.
- **L20** (user, 2026-11-02): «1.si, 2. seguimos con tu recomendacion, 3. tu recomendacion.» Existing Equipo menu
  options become «Hacer dueño» / «Hacer reclutador» / «Quitar» (§13.13; confirmation buttons unchanged). «Mis tramos» is
  its own page «Mi historial de vacantes», reached from the account menu; on-screen copy never says «tramo».
- **L21** (T4 real reads, S1/S8/S10): development opt-in `NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=1` keeps fixtures;
  `=api` reads the real team (retaining its strong ETag), mixed cursor history, v2 company members and the existing
  delivery calendar through authenticated server actions. Unset/other values and production keep Equipo hidden.
  For branch QA use `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:8081`. API writes reject `not_available_yet` and are hidden
  by the single `writesAvailable=false` switch; no fixture snapshot/counts are invented. Ended access has its own
  StateCard, including at the configuration draft gate; generic 404/session handling stays unchanged. Approved
  composition preserved; browser/backend integration verification remains parent-owned.
- **L22** T4 real reads verified in the browser against :8081 (`NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE=api`,
  `PEOPLEFLOW_API_BASE_URL=http://127.0.0.1:8081`): team, history and delivery calendar from the backend; writes hidden.
  Two integration defects fixed test-first: timestamps arrive with offset + microseconds (`…276165+00:00`), so
  `instantSchema` uses `datetime({ offset: true })` like pipeline-movement; members live at `/me/company/members`, not
  `/v2/…` (contract fixed by the backend, `9bc2a080`; offboard routes also under `/me`), read with the employer-team
  strict decoder, skipping memberships without a user. 96 tests (vacancy-team + requestPath), tsc and ESLint clean.
- **L23** T8 first part: «Mi historial de vacantes» at /empresa/mi-historial, account-menu item, fixtures behind the
  flag (endpoint `GET /v2/me/vacancy-assignments/history` lands in backend slice 4). Browser review by the parent:
  first version repeated the «trámite» rows (3–4 grey lines, zero figures), redone as AHORA/ANTES sections, two-line
  rows with medallions and only non-zero figures, 5 rows + «Ver todo» Sheet; fixed mobile cut titles (figures move
  under the text), Sheet opening scrolled past AHORA (initial focus on the title), and cut end reasons (text wraps up to
  two lines). 37 tests, tsc, ESLint clean.
- **L24** Backend slice 3 done (`45135cd8`, docs `c4bc9414`), live on :8081: draft list items and v2 draft bodies
  return `team: {mode, responsible: {id,name}|null, members_count, viewer_function}` (no `principal_recruiter` /
  `principal_recruiter_id`); moves/discard replace `confirm_placement_exit` with `placement_exit_reason`
  (`moved_by_mistake` | `candidate_left`; missing → `placement_exit_reason_required`; on any other move → invalid
  request; discard out of placement needs both its reason and this one); delivery PUT after publication with a changed
  date → 409 `commitment_change_requires_renegotiation`; `POST V/commitment {commitment_date, reason, note?}` with
  If-Match = delivery ETag + UUID Idempotency-Key → 200 delivery body + new ETag (409 `vacancy_not_published`,
  `delivery_not_configured`, `commitment_unchanged`; 422 `commitment_note_required`). Frontend T3/T6 start as three
  parallel writers: T3a team in draft list/read + consumers, T3b placement exit reason, T6 renegotiation.
- **L25** T3a done (`e487bfd5`): draft list and v2 bodies require `team`; portfolio shows the responsible (or «Equipo
  · N personas») in the same slot; Equipo workload counts by `team.responsible.id` (shared teams not counted: the list
  item does not say who is in them). 411 tests; browser OK on :8081. T6 done (`cbbedb6f`): after publication the
  commitment date is read-only with «Renegociar fecha» → one ConfirmActionDialog (new date, reason, note for «Otro»);
  POST V/commitment with delivery ETag + retry-stable UUID; the published delivery PUT sends the CURRENT
  `commitmentDate` unchanged (backend: omitting it → 400; changing or clearing it → 409). 365 tests; browser OK
  (calendar inside the dialog disables weekends and holidays; no write confirmed).
- **L26** T3b done: `placement_exit_reason` replaces `confirm_placement_exit`; leaving placement asks «¿Qué pasó con este
  placement?» («Lo moví por error» / «El candidato se fue», with helpers) inside the existing move and discard
  confirmations (discard keeps its own reason), «Mover» disabled until chosen; every entry point covered. 517 tests
  (pipeline-movement + vacancy-team), tsc clean, ESLint 0 errors (2 pre-existing warnings). Browser on :8081: QA moved
  Ana Pérez Gómez to Placement in the disposable branch DB to open both dialogs (no exit confirmed; she stays there
  for credit QA in slice 4). Fixed the pressed option being invisible in dark mode (also in «Reasignar responsable»);
  rule added to §24.
- **L27** Backend slice 2 done (`0d0f6f55`, docs `40bfe1b7`, contract `82a1cdac`), live on :8081: team writes (add,
  remove, leave, PATCH deadline, reassign-responsible, PUT mode) with If-Match = team ETag and UUID Idempotency-Key on
  POSTs; 200 = full team body + new ETag; 403 `team_action_forbidden`; 422 `recruiter_deadline_not_applicable`
  (reassign to someone already on the team with a deadline) and `responsible_not_applicable` (switch to shared with a
  responsible); a leave replay returns the frozen 200; history carries reassignments with snapshots (stage kind,
  business-day counts; total null without a deadline). T4 writes start.
- **L28** T4 writes implemented (worker, 144 tests) and exercised in the browser on :8081 with three QA recruiters the
  backend seeded only in the branch DB (Ana López, Diego Hernández, Mariana Ruiz; they cannot sign in): add Ana →
  saved, «se unió como colaborador» in movements; reassign to Ana (workload, previous stays as collaborator) → saved,
  deadline field hidden for a current member, real snapshot (1 de 5, 14 de 32 días hábiles, stage tints by kind).
  Findings sent to a fix worker: status line overlapping three footer buttons, «X pasó la vacante de X a Y» wording,
  one reassignment producing three movements, add dialog «Sin fecha» in api mode, unsorted pickers, zero stages in the
  snapshot.
- **L29** T4 done: real team writes plus the browser findings fixed (status on its own footer row, «X le pasó la
  vacante a Y» when the performer is the previous responsible, function changes collapsed into their reassignment or
  mode change, real commitment date in api mode, pickers sorted es-MX via `sortPeople` (popup order is browser QA,
  §13.7), zero stages hidden in the snapshot, mode names quoted «Con responsable»). Browser on :8081: add Diego,
  remove Diego, mode → «Equipo sin responsable» → «Con responsable» with Ana as responsible; every movement recorded
  once. 159 tests (vacancy-team + requestPath), tsc, ESLint clean. Edit-deadline calendar path not clicked in the
  browser (dialog covered by tests; calendar inside AlertDialog verified in T6).
- **L30** Backend slice 4 done (`744b9b7f`, docs `1c8eaf66`, episode rule `145f16f0` agreed): every hire (move or
  recovery into placement) creates a credit with recipients frozen from the active tramos; exits follow
  `placement_exit_reason` and the episode rule (a credit's fate is decided by its own episode; restore → active only
  if its episode is still open, else did_not_hold; at most one active credit per participation); owner void/restore
  POSTs with Idempotency-Key; participation detail carries `placement_credit` (latest) + `can.void_credit/
  restore_credit`; `GET …/placement-credits` lists every credit newest first. QA DB has 0 credits: Ana Pérez Gómez was
  hired before this build, so QA moves her out and back in to create the first credit. T5 starts.
- **L31** T5 done: «Crédito del placement» block in the candidate sheet (status badge, who placed and in which mode,
  recipients direct → shared → participant), owner «Anular crédito» / «Restaurar crédito» through ConfirmActionDialog
  with retry-stable Idempotency-Key, «Colocaciones anteriores» (max 3). Browser on :8081: Ana Pérez Gómez moved out
  («El candidato se fue») and back into Placement → first credit (Ana López direct, Test User participant); void →
  «Anulado»; restore → «Activo» (episode still open). Fixed after review: blank gap in both dialogs (empty status slot)
  and recipient order. 502 tests (pipeline-movement + requestPath), tsc, ESLint clean.
- **L32** Backend slice 5 done (`92ec3835`, docs `9ad895f2`, contract `7bf19f87` + `df6a42f7`): offboard-preview,
  DELETE (409 `member_is_responsible` with data.vacancies), POST offboard with Idempotency-Key → {user_id,
  handed_over[], ended_assignment_ids[]}, all under `/me/company/members/{membershipId}`; preview items carry
  `hand_over` (responsible | last_member); handed-over responsible tramos end `reassigned` (reason
  recruiter_departure), every other tramo `membership_ended`; lifecycle reopen without an active responsible → 409
  `responsible_required`. T7 real client starts.
- **L33** T7 real client done: preview-first «Quitar» in api mode, offboard dialog labels by `hand_over`, POST
  offboard with retry-stable key, result line «{nombre} salió de la empresa. Pasó N vacante(s) a otras personas.»;
  DELETE race 409 opens the dialog; production keeps today's confirmation + DELETE; lifecycle reopen maps 409
  `responsible_required`. 216 tests (employer-team + vacancy-lifecycle + requestPath), tsc clean. Browser on :8081:
  Mariana Ruiz (made responsible of Software Developer) offboarded → vacancy handed to Test User, reason «Baja del
  reclutador». Movements defects found (sent to a fix): a tramo shows as one event, so Mariana's join disappeared and
  «salió del equipo por reasignación» duplicates the reassignment; «X pasó la vacante de Y a X» when the performer is
  the receiver.
