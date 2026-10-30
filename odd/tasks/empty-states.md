# Empty states across the whole system

Branch `feat/empty-states` (stacked on `feat/redesign-psychometrics-ux` at 4d4a52d1). Every screen that can be empty
gets a deliberate, consistent empty state, defined first in the design system and approved on the canvas.

## Specs

- **S1 Cover every UI state.** «es importante cubrir de buena manera todos losposibles estados de la ui, ahora puedo ver
  dos estados, el estado de carga con los skeletons y el estado en donde hay contenido, pero no se ve el empty state».
- **S2 New users land there; it must be perfect.** «y eso si es smamente importante porque los usuarios nuevos van a caer
  en ese estado y hay que estar completamente seguros de que sea perfecto».
- **S3 Reference.** «como referencia hay que tomar el empty state del pipeline de una vacante, cuando aun no hay pipeline
  configurado porque la vacante aun no esta publicada o por alguna otra razon».
- **S4 Design system rule.** «si es que no tienes eso en tu system design, agregalo/expandelo para todos los empty states
  del sistema».
- **S5 Scope.** User chose «Todo el sistema»: inventory of the whole app and fix every empty state that does not meet
  the standard, in several commits.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| E1 | S5 | explore — inventory every empty state (file:line, trigger, form, copy, verdict) | inventory file |
| E2 | S3, S4 | parent — `design/system.md` empty-state section (anatomy, variants, copy, actions, icon tone) | |
| E3 | S1, S2, S3 | canvas — `design/empty-states/` board with every empty state, user approval | |
| E4 | S1, S2, S5 | implement approved empty states by area (slices + native review per code commit) | |
| E5 | S1 | browser QA of each empty state (isolated or read-only data) | |

## Log

- **L1** User (verbatim): «perfecto hermano, si, revise todo y me gusta, lo unico que me gustaria recordarte es que es
  importante cubrir de buena manera todos losposibles estados de la ui, ahora puedo ver dos estados, el estado de carga
  con los skeletons y el estado en donde hay contenido, pero no se ve el empty state, y eso si es smamente importante
  porque los usuarios nuevos van a caer en ese estado y hay que estar completamente seguros de que sea perfecto, y como
  referencia hay que tomar el empty state del pipeline de una vacante, cuando aun no hay pipeline configurado porque la
  vacante aun no esta publicada o por alguna otra razon, si es que no tienes eso en tu system design,
  agregalo/expandelo para todos los empty states del sistema, me sigues?»
- **L2** User chose scope «Todo el sistema». Existing standard: `StateCard` (components/feedback/state-card.tsx) and
  docs/frontend-ui-design-rules.md §22; not present in design/system.md. E1 inventory launched.
- **L3** E1 done: odd/tasks/empty-states-inventory.md — ~22 weak/missing (no creation CTA on vacancies, talent, team;
  plain text in candidate sheet tabs and psychometric result; omitted panels: sheet checklist, education, CV picker,
  delivery; careers editor empties incomplete; public catalog offers filter recovery when nothing is filtered).
- **L4** E2 done: design/system.md «Empty states» section — anatomy, copy, actions, variants (page/section StateCard,
  in a card, no results, nothing selected, compact exceptions) and no silent disappearance.
