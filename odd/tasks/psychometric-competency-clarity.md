# Psychometric competencies people can understand

Branch `feat/psychometric-competency-clarity` (stacked on `feat/empty-states` at e17c2372). Common competency names and
on-demand help (popover) for competencies and profile fields; design first on the canvas, then implementation and the
backend content change.

## Specs

- **S1 Clearer names.** «sinceramente yo les pondria otro tipo de nombre mas comun, apertura a probar, es decir, no se..
  podria usar otras palabras mas comunes tal vez para que la gente lo entienda mejor, o cuidado de acuerdos, orden para
  avanzar, no me dicen nada a mi, pausa para decidir.. eso que es? me sigues?? yo las cambiaria».
- **S2 A short description of each competency.** «porque no hay algun texto que describa esas competencias al menos un
  pooco mas en detalle […] y en algun lado pondria una breve descripcion».
- **S3 Description inside a popover with a visible trigger.** «las descripciones no deben estar a la vista ocupando
  espacio, deben estar dentro de algun popover (ese si debe estar visible) que al pulsarlo, ahora si, se muestre la
  descripcion».
- **S4 Field help.** User agreed to the proposal to explain each profile field (importancia, banda deseada, tarea
  concreta, justificación laboral), what confirming changes, and «Alto no siempre es mejor» — through the same
  on-demand popover pattern (S3).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| C1 | S1–S4 | canvas — `design/psychometric-competency-help/` (names + popovers in configuration and candidate sheet) → user choice | |
| C2 | S1 | backend request — rename competencies in the versioned content (`content.v1.json`), ids unchanged | backend branch, uncommitted (L6) |
| C3 | S1–S4 | implement chosen design; single frontend source for names/descriptions; tests | |

## Log

- **L1** User (verbatim): «Bien hermano, creo que ya entendi, son 60 preguntas, mas tres preguntas de atencion, que se
  les hacen a todos los candidatos, […] lo unico que me queda duda es que me costo un poco entender o darle sentido a las
  competencias, ahora las que entiendo son "Apoyo entre pares" y "Manejo de la presion" y las entiendo como trabajo en
  equipo y facilidad de trabajar bajo presion, pero porque no hay algun texto que describa esas competencias al menos un
  pooco mas en detalle, y sinceramente yo les pondria otro tipo de nombre mas comun, apertura a probar, es decir, no se..
  podria usar otras palabras mas comunes tal vez para que la gente lo entienda mejor, o cuidado de acuerdos, orden para
  avanzar, no me dicen nada a mi, pausa para decidir.. eso que es? me sigues?? yo las cambiaria y en algun lado pondria
  una breve descripcion.»
- **L2** User (verbatim): «Si hermano, estoy de acuerdo, pero las descripciones no deben estar a la vista ocupando
  espacio, deben estar dentro de algun popover (ese si debe estar visible) que al pulsarlo, ahora si, se muestre la
  descripcion, me sigues?»
- **L3** Findings: definitions already exist in backend content (`content.v1.json`, «Definition shown to recruiter» in
  docs/psychometrics/bands-and-competencies-v1.md) but the editor shows names only; names duplicated in frontend
  (`features/psychometrics/labels.ts`, `profile/editor.tsx:26`). Proposed names (for the canvas, not yet approved):
  Organización y seguimiento, Cumplimiento de compromisos, Iniciativa para coordinar, Trabajo en equipo, Apertura al
  cambio, Reflexión antes de actuar, Trabajo bajo presión. Ids stay unchanged, so stored results keep working.
- **L4** C1 board written: design/psychometric-competency-help/ — 01-configuracion (new names, ⓘ trigger on each competency
  and on Importancia, Banda deseada, Tarea concreta, Justificación laboral and Confirmar perfil; one popover open),
  02-ficha-candidato (same pattern in the sheet), 03-nombres (old → proposed → popover text, one alternative name per
  competency). Checks: 27 triggers, keyboard/Escape/click-outside, one popover at a time, zero console errors. Awaiting
  the user's choice of names and copy.
- **L5** User (verbatim): «1. la alternativa hermano. 2. asi estan bien.» → final names (alternative column of
  03-nombres): comp.organizacion «Planificación y seguimiento», comp.compromisos «Seguimiento de acuerdos»,
  comp.coordinacion «Coordinación del trabajo», comp.colaboracion «Colaboración en equipo», comp.exploracion
  «Exploración de alternativas», comp.deliberacion «Revisión antes de decidir», comp.presion «Manejo de presión
  laboral». Popover texts (7 competencies + common footer + 5 fields) approved as written in the board.
- **L6** Backend session reports C2 done, uncommitted on branch feat/psychometric-competency-clarity-backend (from
  local main ef73f9ff): content.v1.json competencies[].name renamed (ids, definitions, facets, rationale byte-identical),
  docs/psychometrics/bands-and-competencies-v1.md and README.md updated; TestDocumentationDrift RED → GREEN. No content
  version bump: `name` is only checked non-empty by the loader, not in scoring, snapshots, API responses or checksums.
