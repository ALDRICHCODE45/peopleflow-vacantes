# Overnight product audit (design and functionality)

Enterprise-buyer audit of PeopleFlow in the browser (production build on :3000 against dev :8080), every role and the
whole vacancy lifecycle; fix gaps, implement minor missing features, extend the design system where needed. Local
merges to `main` allowed (no push).

## Specs

- **S1** User, verbatim: «quiero que aproveches el tiempo para hacer una auditoria de diseño/funcionalidad al sistema,
  usa el navegador para probar TODO lo que un reclutador haria, todo lo que un candidato haria, en todos los roles
  posibles, todo el flujo de vida de la vacante, vacantes con equipos, con encargados, sin encargads, como sw crean, etc..»
- **S2** «imagina que le estas vendiendo el software a una empresa muy grande e importante, navegues por cada una de las
  funcionalidades en DETALLE en busca de huecos de disponibilidad, accesibilidad, etc..» with buyer questions such as
  «1. ? como sw crea una vacante con encargado? 2¿como se cambia al encaegado (responsable creo que era)? 3. ¿puedo
  compartir la vacante solo con el enlace o el sistema me da la opcion de "compartir en whatssapp o compartie por
  correo?» → the report answers each buyer question with the real path and its gaps.
- **S3** «si encuentras huecos, arreglalos, y si llegas a la conclucion de que fata alguna funcionalidad menor (como esa
  de compartir la vacante etc.. ) implemwntala».
- **S4** «debera ser igualmwnte una auditoria comparando lo que ves en el navwgador con lo que tienes en tu system design
  y si llegas a la comclusion de qje hay que extender el system design, adelante».
- **S5** «busca errores, cosas que podria hacer el ususario, que feedback le daria el sistema».
- **S6** Decisions: «Mergear a main local (Recomendado)» (each fix with tests, green suite and browser check; never push);
  data «Libre en Grupo Altavista» (names starting «Auditoría …»; never delete data not created here); candidate account
  «Busco una existente» (if none, candidate flows are reported as pending); backend gaps «Coordinar con la sesión
  backend».

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T0 | — | Finish modern-choice-controls (browser check, merge) | |
| T1 | S1, S2, S4, S5 | Audit A: vacancy creation, team/responsible, lifecycle, replacement — owner vs recruiter | |
| T2 | S1, S2, S4, S5 | Audit B: pipeline, candidates, checklist, psychometrics, talent base, documents | |
| T3 | S1, S2, S4, S5 | Audit C: candidate and public side (listing, detail, share, apply, workspace) and careers site | |
| T4 | S1, S2, S4, S5 | Audit D: company admin (settings, team, invitations, site editor, metrics, dashboard, audit log, stakeholder) | |
| T5 | S3, S4 | Triage findings; fix gaps and implement minor features in slices (each: tests, suite, browser, merge) | |
| T6 | S2 | Morning report: buyer Q&A, fixed, pending, backend requests | |

## Log

- **L1** (2026-11-24) User request verbatim (S1–S5 above, full message): «Mira hermano, me tengo que ir a dormir, mientras
  este dormido quiero que aproveches el tiempo para hacer una auditoria de diseño/funcionalidad al sistema, usa el
  navegador para probar TODO lo que un reclutador haria, todo lo que un candidato haria, en todos los roles posibles,
  todo el flujo de vida de la vacante, vacantes con equipos, con encargados, sin encargads, como sw crean, etc.. quiero
  que imagines que le estas vendiendo el software a una empresa muy grande e importante, navegues por cada una de las
  funcionalidades en DETALLE en busca de huecos de disponibilidad, accesibilidad, etc.. imagina que la empresa te hace
  preguntas como ppr ejemplo, 1. ? como sw crea una vacante con encargado? 2¿como se cambia al encaegado (responsable
  creo que era)? 3. ¿puedo compartir la vacante solo con el enlace o el sistema me da la opcion de "compartir en
  whatssapp o compartie por correo? etc.. me explico?? y si encuentras huecos, arreglalos, y si llegas a la conclucion de
  que fata alguna funcionalidad menor (como esa de compartir la vacante etc.. ) implemwntala, no importa, debera ser
  igualmwnte una auditoria comparando lo que ves en el navwgador con lo que tienes en tu system design y si llegas a la
  comclusion de qje hay que extender el system design, adelante, busca errores, cosas que podria hacer el ususario, que
  feedback le daria el sistema, me sigues?? asi que si tienes alfuna pregunta que hacerle antes de irmw a doemor,
  adelante, hazla ya». Answers: S6.
- **L2** Audit C done (`odd/discovery/overnight-audit-C.md`, 18 findings); fixes delegated on `feat/audit-public-fixes`
  (based on `feat/modern-choice-controls`). Backend F3 agreed (`feat/public-jobs-sort-total`, in progress): public listing
  `?sort=recent|salary_desc|salary_asc` (`recent` default = today's order; invalid → 400 list validation error; cursor bound
  to its sort) and response `total: {count, capped}` (same filters, cap 1000 → «1000+ vacantes»); salary sorts use only the
  salary the listing already shows, hidden salaries go last in both directions by recency. No candidate test account
  exists (F18): candidate logged-in flows wait for the user.
- **L3** Audit D done (`odd/discovery/overnight-audit-D.md`, 21 findings); frontend fixes delegated in the linked worktree
  `/tmp/pf-wt-admin` (`feat/audit-admin-fixes`). Backend takes tonight on `feat/admin-audit-gaps-backend`: D5 team
  `workload: {active_vacancies}` per member (same for every viewer); D20 `counts_by_status` on the first stakeholder
  vacancies page; D11 optional invitation `note` (≤80, migration 00065, shown from the invitations list, not in audit
  metadata). Left for the user's decision: D2 recruiter invitations (security), D3 company edit + logo (backend proposes
  PNG/JPG/WebP only, no SVG), D15 audit CSV headers (changes a downloaded format).
- **L4** Audit A done (`odd/discovery/overnight-audit-A.md`, 23 findings). F1 (team page dev-only) is a pending user
  decision since `vacancy-team.md` L37 («Production ships nothing new until NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE handling is
  removed (user decision pending)») → prepare on its own branch, do not merge; morning decision. Backend asked about the
  team API completeness (F1), responsible at creation (F2), salary basis rule (F5), duplicate/history (F21/F22).
  Backend F3 committed (`e30e9183`, contract `docs/contracts/public-jobs-sort-total-v1.md`): salary sorts by blocks
  (MXN·mensual·bruto first, other units in a fixed order, legacy salaries, then hidden/no salary). Asked to hold its merge
  until the frontend accepts the always-present `total` (deployment order).
- **L5** Backend answers (audit A): F1 team backend complete and merged (vacancy-team-v1: GET team, team/history, POST
  team/members, POST team/members/{user_id}/remove, POST team/leave, PATCH team/members/{user_id}, owner-only POST
  team/reassign-responsible and PUT team/mode; commitment, placement credits, assignment history, offboarding); the only
  production gate is the frontend `teamDataSource`. F2 create body is exactly `{"fields":{...}}`; the creator becomes the
  responsible; choosing another needs PUT team/mode and/or POST team/reassign-responsible after create. F5 backend rule:
  public salary needs public_visible + mode, currency, pay_period and basis (gross|net) (`publicjobs/projection.go:119-124`)
  → basis required in the form when the switch is on. F21 no duplicate (replacement clone is reusable backend work, S–M).
  F22 exists for owners: GET /v2/me/company/audit-events?vacancy_id=… (+ …/audit-events/vacancies); recruiters would need
  a new piece.
- **L6** Merged to local main `1dbb4350` (`feat/audit-public-fixes` at `134e2352`: modern choice/file controls + public
  fixes). Evidence: full suite at `16df9591` 629 files / 11552 passed, 2 failed → `button-variants-merge` real (fixed in
  `134e2352`: «Crear cuenta» through `cn`), `delivery-config` focus test passes in isolation (load flake); tsc 0, lint 0
  errors. Browser (prod build of `16df9591`): focus ring, Quitar focus, «Ya vinculado» description, single «Sigue en
  Placement», share menu (copy/WhatsApp/Correo/LinkedIn + origen=compartido), OG + JobPosting JSON-LD, anonymous apply
  card, dark link contrast 6.61:1, listing chips/titles/card, closed-vacancy company link — pass; minor: stages popover at
  390 clips 17 px when opened low, skip link 5th stop on desktop, `/candidatos` title doubled, employer share not
  reachable (fixed in the A tranche). Native review (escalate item 3, shared Button link variant) approved, lineage
  `review-4157357d02f219f6`, 11 advisories (status slot live region, closed-page read timeout, JSON-LD null bounds, share
  helpers, publish share gate, choice-question validation test) → follow-up sent to the A-tranche worker.
- **L7** Backend F0 fix merged (`102be62c`: pipeline impact joined users, so manual candidates were dropped and their
  history panicked → 500 without log; apply had the same bug). Browser retest on :3000: add column, save, reorder and the
  demo preview (cancelled) pass; impact lists both manual candidates. New findings: the impact list also flags earlier
  stages a candidate never reached (`pipelineconfig/impact.go:138`; 34 rows on the demo for one new column) and writes
  «No aplica» marks for them → product/backend decision; dialog says «Ningún candidato cambia de columna» but lists
  «Nombre → Columna» rows; toast overlaps the inline success; board header truncates long column names. Admin branch:
  backend admin fields accepted as optional (`6e2b23c5`).
- **L8** Admin/pipeline branch `feat/audit-admin-fixes` at `9da444a9` (B fixes + non-public A fixes; related 173 files /
  2707 tests, tsc clean). Not done: «No encontramos este borrador» heading (description now mentions missing access; the
  heading is asserted in 6 other suites), «Abrir tablero» hiding (no access flag in the ficha data), A-F16 starter listed
  twice (needs a viewer id from the backend), inline CV preview in the sheet (no reusable preview for participation CVs),
  board search by email (board payload has no email). Merges cleanly into main; integration (with the A tranche) gets the
  full suite and a browser check before merging.
