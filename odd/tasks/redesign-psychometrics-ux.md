# Redesign: psychometrics result, comparison, applications and configuration UX

Visual review after the psychometric tests merge (local main ef73f9ff, not pushed). Branch
`feat/redesign-psychometrics-ux` from main. Every redesign goes design-first on the gentle-design canvas
(`design/<slug>/`), the user chooses, then implementation. UI rules: `docs/frontend-ui-design-rules.md`, `design/system.md`.

## Specs

- **S1 Psychometrics tab in the candidate sheet (priority).** «lo mas importante es el rediseno de lo que aparece dentro
  de la tab de "Psicometria" de la ficha del candidato, y mi razon principal es que considero que es un espacio muy
  pequeno en donde estamos poniendo bastante informacion importante sobre la psicometria del candidato, las dos ideas
  que se me ocurren (ojo, solo son ideas, pero quiero tu opinion y tus propuestas) es 1. hacer toda la ficha del usuario
  mas grande 2. darle su propia pagina propia al apartado de psicometria 3. tener en la tab la informacion minima
  indispensable de los resultados, y el contenido mas denso y basto, tenerlo en un dialog grande como el que sale en el
  preview de la pagina de empleo de la empresa»
- **S2 Candidate comparison.** «tambien la comparacion de los candidatos hay que hacer un rediseno, este diseno si se me
  hace malo, muy plano la verdad, parece que no pertenece a peopleflow»
- **S3 Candidate applications.** «tambien un rediseno de las postulaciones del candidato, no me convence el estado
  actual.»
- **S4 Psychometric profile configuration.** «y el formulario de la confiuracion de psicometria, no es mala, pero es un
  formulario grande, hay que cuidar mucho la ux/ui, hay que cuidar mucho el diseno, porque realmente no me gusta nada
  los formularios grandes con scorll muy extenso y planos, parecen formularios de gobierno»
- **S5 Checklist configuration.** Screenshot 3 of L1 (configuracion/checklist: large repeated cards); included by L3.
- **S6 Board sort control.** «presione el boton de Ordenar: Mejor ajuste y no vi que pasara nada.. que hace exactamente
  ese boton?» — it orders each column by checklist fit (orderByFit); the state is invisible and an unchanged order
  looks like a no-op. Psychometric results never order candidates (F1 rule).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| R1 | S1 | worker — design directions: psychometrics tab summary + full report (page vs large dialog vs expandable sheet) | |
| R2 | S1 | implement the chosen R1 artboard | |
| R3 | S2 | design directions: candidate comparison | |
| R4 | S2 | implement chosen R3 | |
| R5 | S3 | design directions: candidate applications | |
| R6 | S3 | implement chosen R5 | |
| R7 | S4 | design directions: psychometric profile configuration without a long flat form | |
| R8 | S4 | implement chosen R7 | |
| R9 | S5 | design + implement checklist configuration | |
| R10 | S6 | sort control with visible state, explanation and unchanged-order feedback | |

## Log

- **L1** (user, verbatim): «Bien hermano, estuve revisando las partes importantes del lado del candidato y del reclutador, y hay
  bastantes cosas que me parece que merecen un rediseno propio completo, mira, son todas estas: [5 screenshots:
  comparar candidatos, configuracion/psicometria, configuracion/checklist, ficha Psicometria con gestion de invitacion,
  ficha Psicometria con resultado] realmente todas me parecen importantes, sin embargo, lo mas importante es el rediseno
  de lo que aparece dentro de la tab de "Psicometria" de la ficha del candidato, [...S1...] tambien la comparacion de
  los candidatos hay que hacer un rediseno, [...S2...] tambien un rediseno de las postulaciones del candidato, [...S3...]
  y el formulario de la confiuracion de psicometria, [...S4...] me sigues?? que opinas?»
- **L2** Parent recommendation: S1 = tab as an actionable summary (status, 7 competencies as compact rows with band and
  fit, top focus areas, compact invitation management with an actions menu, no relevante collapsed) + «Ver informe
  completo» opening the dense report on its own page (guide first, side index, printable); show the alternatives as
  artboards instead of deciding in the abstract. Existing features (comparison, applications, checklist) are separate
  redesigns from main.
- **L3** User (verbatim): «Si hermano, commpletamente, arrancamos.» — start R1; add S6 to the package; checklist included.
- **L4** R1 / S1 design directions authored in `design/psychometric-report/`: `01-informe-en-pagina.html`
  (recommended: actionable tab summary + guide-first page with sticky index and print layout),
  `02-informe-en-dialog.html` (same summary + large dialog following the company-site preview proportions/chrome),
  and `03-ficha-expandible.html` (same summary + two-column expanded candidate sheet). Each includes the stored
  guide, competency bands/fit, folded No relevante content, interpretation disclosures, quality, 15 facets and
  comparison history; direction 01 also shows Lucía's in-progress invitation management. Manifest:
  `design/psychometric-report/design.json`. No artboard chosen yet; the parent/user decides before R2.
  Self-check uses only `design/system.md` colors and system UI font fallback. Canvas tool/browser preview unavailable
  in the worker; visual verification and opening the canvas remain for the parent.
- **L5** User canvas comment ytuqbtn2 on 03 (verbatim): «Sinceramente esta version me gusta demasiado hermano, de verdad, sin
  embargo me gustaria mejorar/pulir esta seccion del "resumen" del reclutador, me explico?? siento que le hace falta,
  que dices?» → direction 03 (ficha expandible) preferred; its aside redesigned as a preparation panel (panorama mini
  matrix + fit counts, guide/comparison/quality actions, invitation timeline, footnote). Commit 734cee6d; comment
  resolved. Pending for R2: lift «Ver informe completo» above the fold in the compact tab.
- **L6** Canvas comment x3dg96i8 on 03 (report column flat, «parece un documento de word», no consistency, research UX/UI
  patterns): researched record/detail views (Appian SAIL, SAP Fiori), assessment report case studies (dribbble
  22915821, LayersRank, Circadian), interview guide tools (ReCo). Rule adopted: ONE section anatomy (card on muted
  background; header icon + title + meta + one action; body; footnote), same disclosure everywhere, question cards,
  competency rows with mini band scale, comparison history as timeline, no native ▸ or browser lists. Applies to every
  report section in R2.
