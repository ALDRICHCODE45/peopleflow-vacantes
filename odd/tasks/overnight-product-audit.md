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
