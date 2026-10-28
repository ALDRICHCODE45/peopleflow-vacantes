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
| T1 | all | inline — contract + feature document, backend review | — |
| T2 | S1–S3, S9 | worker — checklist model, server client/actions, evaluation, suggestions from the vacancy, summary/sort | — |
| T3 | S1, S8 | worker — «Checklist» module in the vacancy configuration (editor + reminder stages) | — |
| T4 | S3–S5 | worker — board: card fit, «Mejor ajuste» order, fit filter, sheet «Checklist» tab with marks | — |
| T5 | S8 | worker — reminder with inline marks in the move confirmation | — |
| T6 | S6, S7 | worker — comparison view and terna report (print + CSV) | — |
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
