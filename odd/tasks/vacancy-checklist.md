# Vacancy checklist F1 (internal criteria contrasted against every candidate)

Per-vacancy internal checklist evaluated automatically against every participation, with one-click recruiter marks,
fit on the board, comparison and a shortlist («terna») report. Branch `feat/vacancy-checklist` (from
`chore/backlog-small-fixes` e914505b). Contract: `docs/contracts/vacancy-checklist-v1.md`. Backend: session
01a18189-c774 (worktree `peopleflow-vacantes`, branch `feat/vacancy-checklist`); it merges into main, the user pushes.

## Specs

- **S1 Internal checklist per vacancy, drafted by the system.** «incluir un apartado de "checklist" en donde se
  describan los requerimientos especificos punto por punto de la vacante, auque en la vacante publica ya existan los
  requisitos obligatorios y requisitos opcionales». Employer-only module in the vacancy configuration; opening it
  proposes criteria from the vacancy (minimum years, seniority, education, each language, each skill, location for
  onsite/hybrid, evaluated screening questions with their correct option, one manual criterion per line of the
  required/preferred requirements text); the recruiter edits, removes, reorders and adds; each criterion is
  «Obligatorio» or «Deseable». Never public.
- **S2 Contrasted with every candidate.** «este "checklist" interno debe poder contrastarse con todos y cada uno de los
  candidatos del proceso, y asi poder tener una evaluacion personal "comparando" al un candidato nuevo con el checklist
  de la vacante». Automatic criteria evaluate themselves for every participation (also those already in the process)
  with the contract's evaluation rules over the effective profile and screening answers.
- **S3 Never an empty checklist.** «la vacante resultaba en tener la comparacion del checklist contra cualquier
  candidato completamente vacio, por lo cual en la practica, basicamente servia de muy poco … definitivamente debe de
  haber algun tipo de automatizacion en esto». Three distinct states (cumple / no cumple / sin evaluar), never mixed,
  and the source of each result is visible (perfil, respuesta, reclutador).
- **S4 One-click recruiter marks.** In the candidate sheet the recruiter marks any criterion ✓/✗ (optional note) or
  clears it; a mark overrides the automatic result and shows who and when; audited by the backend.
- **S5 Fit on the board.** Each card shows its fit summary (e.g. «Obligatorios 4/5 · 1 sin evaluar»); the board can be
  ordered by «Mejor ajuste» and filtered by fit. Value appears without any manual input.
- **S6 Comparison.** Compare selected candidates side by side, criterion by criterion.
- **S7 Shortlist report for the client.** User: «1. Si, incluirlo en el reporte.» From the comparison, export the
  terna as a printable report (PDF through the browser) and CSV: candidates × criteria with results and recruiter notes.
  No contact data by default.
- **S8 Non-blocking reminder.** User: «3. si, el recordatorio suena bien.» When moving a candidate into a stage chosen in
  the checklist's reminder stages, the move confirmation lists the required criteria still «sin evaluar» with inline
  ✓/✗; the move works without marking anything.
- **S9 No AI, never rejects.** User: «2. Si, fuera en F1.» No AI suggestions; the checklist never rejects, discards or
  moves a candidate (INT-22).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | all | inline — contract + feature document, backend review | 4ac0bef4, 52590a1b, 5bfa2787 |
| T2 | S1–S3, S9 | worker — checklist model, server client/actions, evaluation, suggestions from the vacancy, summary/sort | 77a0c1cd |
| T3 | S1, S8 | worker — «Checklist» module in the vacancy configuration (editor + reminder stages) | 2c608a1d |
| T4 | S3–S5 | worker — board: card fit, «Mejor ajuste» order, fit filter, sheet «Checklist» tab with marks | b9e1c1e4 |
| T5 | S8 | worker — reminder with inline marks in the move confirmation | b9e1c1e4 |
| T6 | S6, S7 | worker — comparison view and terna report (print + CSV) | ea0f75b5 |
| T7 | all | inline — browser QA against the backend, guide step, review queue, delivery | — |

## Log

- **L1** (user, verbatim): «Bien hermano, primero vamos a hacer esas cosas pequenas que valen la pena, no podemos dejar
  nada asi. y despues de eso, quiero discutir algo contigo para implementar, pero quiero platicarlo contigo para poder
  tenerlo bien disenado antes de pasar a la implementacion de cualquier cosa y quiero dejarte haciendolo mientras yo
  duermo, mira, como  sabes, este sistema es un sistema orientado a la empresa (pero tambien al candidato, aunque ahora
  tenemos mas ideas para la empresa, debido a que mis clientes son reclutadores y tienen el "know-how" sobre esto) por
  lo que quiero agregar una propuesta sobre el perfil de la empresa, (los usuarios de la empresa), en la vacante, tengo
  la idea de incluir un apartado de "checklist" en donde se describan los requerimientos especificos punto por punto de
  la vacante, auque en la vacante publica ya existan los requisitos obligatorios y requisitos opcionales, este
  "checklist" interno debe poder contrastarse con todos y cada uno de los candidatos del proceso, y asi poder tener una
  evaluacion personal "comparando" al un candidato nuevo con el checklist de la vacante, sin embargo, algo que si tengo
  que comentarte, es que esto mismo ya lo aplique una vez a un cliente, en un sistema de reclutamiento interno, y era en
  papel, una buena idea, sin embargo, en la realidad, practicamente NADIE, ocupaba esta feature, es decir, ahi aprendi
  que lo mas dificil de hacer es que los usuarios de tu sistema efectivamente usen el sistema y las features como debe
  de ser, entonces la vacante resultaba en tener la comparacion del checklist contra cualquier candidato completamente
  vacio, por lo cual en la practica, basicamente servia de muy poco, he estado pensando en como podemos hacer esto sin
  incluir tambien las cosas que salieron mal, y para eso quiero tu ayuda, porque definitivamente debe de haber algun
  tipo de automatizacion en esto, peroo esto es solo una idea, quisiera que tu hicieras un analizis mas a fondo de esto
  y bajarlo a tierra para implementar la mejor opcion. Algo que tambien estoy pensando es incluir pruebas psicometricas
  DENTRO de peopleflow, lo cual se me hace muy interesante, pero eso lo podemos hablar despues. que dices?»
- **L2** Analysis given to the user: the paper checklist failed on effort (cost first, value later), being outside the
  workflow, re-asking known data and showing empty = «no cumple». Proposal: system-drafted checklist, automatic criteria
  over existing data, three honest states, value on the board without input, marks where the recruiter already acts,
  reminder at stage moves, terna report as the adoption hook; AI later with evidence.
- **L3** (user, verbatim): «Bien, respondo tus preguntas: 1. Si, incluirlo en el reporte. 2. Si, fuera en F1. 3. si, el
  recordatorio suena bien. 4. Si es que se puede, diseno mas implementacion de F1 coordinada con el backend.»
- **L4** Exploration facts: `required_requirements`/`preferred_requirements` are free text (≤16 KiB), not lists; evaluated
  screening questions are never scored and participation snapshots drop the answer key, so `screening_answer` criteria
  store their own accepted options; board payload has effective profile (years, seniority, education summary,
  languages, skills, location) and answers `{question_id, option_id}`; no salary expectation anywhere → no salary
  criterion in F1. Move confirmation already exists for every move (`use-movement-board.ts` requestMove/confirmMove).
- **L5** Decisions taken by the agent (user asleep, recorded for review): automatic evaluation runs in the frontend over
  the board payload with rules fixed in the contract (backend stores criteria and marks only); a missing skill is
  «sin evaluar», not «no cumple»; last write wins on marks (audited); terna report excludes contact data; default
  reminder stages = every stage after «Nuevo» when the checklist is first saved; max 50 criteria.
- **L6** Backend review (session 01a18189-c774, 13 + 2 adjustments) folded into the contract: opaque `vc1-…` ETag separate
  from the decimal `version`, `412 version_conflict`, `428 precondition_required`, `too_long` for array limits, location by
  geo catalog ids with at most one location criterion, screening only single-choice questions with case-insensitive
  ids, `409 process_finished` on writes once the process ended, idempotent no-op PUTs, `marked_by` resolved at read,
  editor rule «new id when kind/params change». Only the frontend edits the contract file. Backend branch
  `feat/vacancy-checklist-backend` (validation f84da991).
- **L7** T2 (worker mvrvh51y-3-8vw4): `frontend/src/features/vacancy-checklist/` model, client, actions, evaluate, suggest;
  RED observed per rule → GREEN 166/166; tsc and eslint clean; parent re-ran 166/166. Commit 77a0c1cd. Slice boundary:
  the branch passes ~400 authored lines here (868 in 6 commits incl. the backlog fixes); delivery is commit-by-commit
  review, one commit per task.
- **L8** Launched in parallel: T3 (mvrw0u48-4-4icn, vacancy-config + vacancy-checklist/editor) and T4+T5 merged into one
  worker (mvrw1j1i-5-k4v0, pipeline-movement + vacancy-checklist/board) because both change the board dialogs. T6 waits
  for T3: the runtime's surface-overlap check reads the `[jobId]` route segment as a glob and rejects it next to T3.
- **L9** T4+T5 (worker mvrw1j1i-5-k4v0): board ChecklistProvider (non-blocking load, quiet retry), fit line on cards,
  «Ordenar: Mejor ajuste», «Checklist» filter dimension, sheet «Checklist» tab (optimistic marks, rollback,
  process_finished), reminder inside the existing move confirmation, 2–5 selection linking to `/pipeline/comparar?ids=`.
  Worker RED → GREEN 18 focused; its broad run timed out under parallel load, parent re-ran pipeline-movement +
  checklist board + pipeline route: 429/429. Commit b9e1c1e4.
- **L10** T3 (worker mvrw0u48 → continued as mvrw2iam-6-rzyg): the config shell routes each module to
  `/configuracion/<slug>`, so the worker built `VacancyChecklistModule` (client loads) + editor + nav entry, and the
  parent wrote `configuracion/checklist/page.tsx` mirroring «Solicitud» (RED: missing page → GREEN). Worker RED 26
  → GREEN; parent: configuracion + employer-vacancies + vacancy-checklist 602/602, tsc clean. Commit 2c608a1d. T6
  launched (mvrwuo5s-7-smdi).
- **L11** T6 worker stopped on UI rules: no local `shadcn-reference/table.md` (§19) and §26 (RichDataTable for person
  tables). Parent decision: §19 asks to read the official docs first, not for a pre-existing file — the worker reads
  them and adds `docs/design/shadcn-reference/table.md`; §26 governs listing tables, while the comparison is a
  criteria × candidates matrix (2–5 columns), so it uses shadcn `Table` with §26.1 cell rules, horizontal ScrollArea
  and a sticky criterion column on mobile.
- **L12** T6 (worker mvrwwiei-8-eyq6): `/pipeline/comparar` route, comparison builder, matrix, print stylesheet scoped
  by `body:has([data-comparison-report])` (no effect on other pages), formula-safe CSV without contact data, official
  Table reference. Worker RED → GREEN 22 new; checklist + pipeline routes 230/230, tsc and eslint clean. Commit ea0f75b5.
- **L13** Backend ready (msg 5cefd37c): binary from `feat/vacancy-checklist-backend` @421b8616 on :8080, migration 00048
  applied, go vet + go test ./... green; seed vacancy 01a13ce2-ddaf-73e7-848c-367979b20ead «Software Developer» (4
  participations, 3 single_choice_informative + 1 open question).
- **L14** T7 browser QA round 1 (own Playwright, :3000 dev + :8080, employer session, 1440 px). Works end to end: empty
  config → «Sugerir desde la vacante» drafted 16 criteria (seniority, language, 5 skills, 9 requirement lines) →
  saved (toast); board loads fit for 4 candidates; sheet tab marks a criterion (persisted, shown as «reclutador» in the
  comparison); move confirmation lists pending required criteria and still moves; 3-candidate comparison renders; no
  page errors, no 4xx/5xx. Design defects sent to a fix worker: P1 clipped card fit pill; P2 full-width «Comparar»
  on every card; P3 sort toggle alone on its row; P4 sheet tab with an always-open note per criterion; P5 reminder
  lists all 11 pending as tall cards; P6 unknown results show a source («perfil», «Sin fuente»); P7 language label
  shows the code («Idioma en»); P8 two stacked cards in the empty config + confusing importance checkbox + loose
  reminder spacing; P9 comparison truncates labels/fit and shows two navigations. Screenshots /tmp/pf-cl/0*.png.
- **L15** The full suite during the fix worker exposed a real T2 defect: `vacancy-checklist/client.ts` was missing from
  the guarded transport inventory (`jobs/requestPath.test.ts`) and its bodyless DELETE 204 uses a same-origin guarded
  `fetch` like `employer-team/client.ts`; registered in both lists (9bd31e5a). Risk item 2 (transport guard allowlist).
- **L16** Backend request (msg 82474209): never finish a real process to test `process_finished`; it is covered by
  backend integration (TestChecklistFlowRetiredReminderAndFinishedProcess) and by mocked 409 tests in the UI.
- **L17** P1–P9 fixed (worker mvrxk9r2-9-hosg): RED 11 → GREEN, checklist + pipeline + config + routes 978/978.
  Browser round 2 (1440 px light/dark, 390 px mobile): compact fit line, opt-in «Comparar candidatos» selection with
  «Comparar (3)», sort toggle inside the filter bar, compact sheet rows with collapsed notes, reminder capped at five +
  «y 5 más», no source on unknown results, single config card + Obligatorio|Deseable toggle, comparison readable in dark
  and scrolls with a sticky criterion column on mobile; no page overflow at 390 px; live DELETE of the round-1 mark
  returned the automatic result («cumple · perfil»). Parent fixes with RED → GREEN: fit icon follows its tone (check
  only when every required criterion is met); the fourth sheet tab clipped «Resumen» at 390 px (tablist 352 > 324 px)
  → tighter triggers and container padding below sm, measured 340/340 in the browser. Data note: the checklist saved in
  round 1 keeps the old label «Idioma en: mínimo C1» (saved before P7); new suggestions use catalog names.
  Docs: guide step 91 and review-queue item 3.
