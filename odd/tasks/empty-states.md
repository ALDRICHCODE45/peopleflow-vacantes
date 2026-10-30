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
| E3 | S1, S2, S3 | canvas — `design/empty-states/` board with every empty state, user approval | 996fe837 (approved L6) |
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
- **L5** E3 board written (worker): design/empty-states/00-anatomia (5 variants), 01-empresa (18 proposals; Entrega
  unreachable by contract), 02-candidato (7), 03-publico (5); README catalogs screen → title → action. «Invitar miembro»
  and «Marcar CV principal» require backend (not offered). Open: keep «Evaluaciones adicionales» visible when empty?
  team-without-members reachable? Awaiting user approval.
- **L6** User (verbatim): «1.si . y lo demas como tu lo recomiendes» → board approved as is; «Evaluaciones adicionales»
  stays hidden when the candidate has none (each application already shows its own assessment); «Invitar miembro» and
  «CV principal» become a backend request for a second stage (not offered in the UI now).
- **L7** E4 plan (work-unit slices, native review per code commit): A shared `SectionEmpty` (in-card / no-results /
  nothing-selected variants) next to `StateCard`; B employer lists (vacancies, talent, team, dashboard); C candidate
  sheet tabs + psychometric invitation/result + checklist detail; D careers editor; E candidate side; F public.
- **L8** E4-A 1e1c1c59: `SectionEmpty` (RED 3 → GREEN, 66/66 feedback, tsc 0, eslint clean; docs §22.1 + system.md);
  assess 103 lines reviewDue false. Workers launched in parallel with disjoint surfaces: E4-B (employer lists), E4-C
  (sheet/psychometrics/checklist detail), E4-E (candidate side). E4-D and E4-F next wave to keep machine load bounded.
- **L9** First wave landed, each slice with native review approved and acknowledged: E4-E 072f5ecd (567/567 in area;
  review-e65edc0e27ed29a8 clean), E4-B 2d7428de (1042 in area; creation route is /empresa/vacantes/borradores/nuevo;
  review-4125f4d83f8448bf clean), E4-C f7950ab6 (684 in area; review-10422ba0082fc3d5, advisory R3-001
  board/ui.tsx:106-107 → follow-up). b8cb0924 fixes the R9 regression in checklist-module.test (label in list and detail).
  board.test «adds a manual card…» fails only under load (passes alone). Second wave: E4-D running; E4-F waits for D
  (writer-overlap guard misreads the «(empresa)» path).
