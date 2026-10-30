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
| R2 | S1 | worker — implement design/psychometric-report/03-ficha-expandible.html (chosen): compact tab summary + expandable two-column sheet, preparation panel, uniform report sections | d0a4c42f |
| R3 | S2 | design directions: candidate comparison | |
| R4 | S2 | worker — implement design/candidate-comparison/01-resumen-y-matriz.html (chosen) in features/vacancy-checklist/compare | 53a0967a |
| R5 | S3 | design directions: candidate applications | |
| R6 | S3 | implement chosen R5 | |
| R7 | S4 | design directions: psychometric profile configuration without a long flat form | |
| R8 | S4 | worker — implement design/psychometric-profile-config/03-lista-maestra-detalle.html (chosen) | |
| R9 | S5 | design + implement checklist configuration | |
| R10 | S6 | worker — sort control with visible state, explanation and unchanged-order feedback | e434a6fc |

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
- **L7** User (verbatim): «me convence hermano.» → 03-ficha-expandible.html is the chosen artboard (01 and 02 are
  alternatives); gentle_design implement handoff started (in_progress). R2 delegated.
- **L8** R3 / S2 directions authored in `design/candidate-comparison/`: `01-resumen-y-matriz.html`
  (segmented candidate summaries + compact grouped matrices), `02-tarjetas-lado-a-lado.html` (one repeated candidate
  card anatomy + Solo diferencias), and `03-criterio-primero.html` (criterion cards distributing people by result +
  group filters). Manifest: `design/candidate-comparison/design.json`; all artboards target 1440px. L6 anatomy retained:
  elevated card, icon/identity + title + metadata + contextual action, body and footnote. Each retains print/PDF,
  complete CSV, stages, checklist counts, evidence sources and notes; ordering uses checklist only, never psychometrics.
  Self-check: background, foreground, card, primary, primary-foreground, muted, muted-foreground, border and
  status-info/review/success match `design/system.md`; system UI font fallback only, visible focus, semantic tables/lists,
  reduced-motion and responsive/print styles included. Two desirable labels unavailable in the screenshot are explicitly
  marked Texto no disponible; the Docker requirement keeps its visible ellipsis. No artboard chosen or implemented.
  Canvas/browser tools unavailable in this worker: opening the canvas and visual/interaction verification remain for
  the parent (`/gentle:design open candidate-comparison`). No commits made; unrelated R2 changes preserved.
- **L9** User chose design/candidate-comparison/01-resumen-y-matriz.html via the canvas implement handoff (02 and 03 are
  alternatives); handoff in_progress; R4 delegated in parallel with R2 (disjoint surfaces).
- **L10** R2 implemented (d0a4c42f): RED 5 new cases → GREEN; 1106/1106 in pipeline-movement + psychometrics; tsc 0;
  eslint clean. Parent browser check (employer session): CTA visible above the fold at 1440×900, expanded 1280px
  two-column workspace, Lucía's in-progress block with menu; parent widened the panorama scale column (130→156px) so
  «Medio» fits. Handoff marked implemented. R4 continues with an authorized shared checklist-bar extraction in
  vacancy-checklist/board.
- **L11** R4 implemented (53a0967a): shared ChecklistFitSummary extracted from board ChecklistFit (authorized, markup
  pinned by test); RED 2 → GREEN; 250 tests in checklist + compare route + board columns; tsc 0. Parent print check
  found empty segments printing black (print --border black) and the hover hint on paper → --border mid grey, hint
  print:hidden. Handoff marked implemented.
- **L12** Native review (RDD on), one slice per work unit in detached `.review/` worktrees: R2 d0a4c42f
  (review-51ae501d1ee0d28d, approved; advisory R3-001 candidate-sheet.tsx:52 focus restoration on expand/collapse →
  follow-up) and R4 53a0967a (review-9ef6225578090431, approved, clean). Both acknowledged; worktrees removed.
- **L13** R5 / S3 directions authored in `design/candidate-applications/`: `01-lista-con-estado.html`
  (scannable independent rows, public-state timeline and next action), `02-tarjetas-con-progreso.html`
  (two-column cards grouped En proceso / En revisión / Enviadas / Cerradas, integrated evaluation), and
  `03-pendientes-primero.html` (attention cards before a compact complete history). Manifest: `design.json`, title
  «Mis postulaciones», linked to this feature; each direction records its tradeoff. All target 1440×900 and adapt to
  390×844. L6 retained: elevated card on muted foundation, icon + identity + meta + state, body, consistent footnote/
  contextual action; no flat document, internal recruitment stages or candidate-facing psychometric results.
  Current-page read-only references captured with the candidate helper under `/tmp/t12qa/r5/`:
  `current-desktop-1440x900.png` and `current-mobile-390x844.png` (both full page). Requested five-case sample and
  3/63 progress are illustrative; the current session has two applications and 10/63. R6 contract caveat recorded in
  the manifest: live API exposes Enviada / En proceso / Finalizada, whereas En revisión / Contratada / Rechazada,
  local unread messages and historical nullable links belong to the portfolio model; no API expansion authorized.
  Self-check: only `design/system.md` colors, tints, radius/shadow recipes and system UI fallback; semantic lists,
  landmarks, visible focus, ≥40px controls and reduced-motion rules. Chrome checked all three at both widths:
  no horizontal overflow, one h1/main, no external assets or JS errors; accent-insensitive search, empty/clear and
  applicable status filters passed. Product actions remain enabled/inert, with historical entries unlinked.
  Design-only work: no meaningful production RED/GREEN; frontend untouched, no commit. Canvas tool unavailable:
  parent opens `/gentle:design open candidate-applications`; no direction chosen and R6 remains pending.
- **L14** R7 / S4: three directions in design/psychometric-profile-config/ — 01-tablero-de-importancia (importance lanes +
  detail panel), 02-pasos-guiados (stepper + live summary), 03-lista-maestra-detalle (master/detail, recommended for
  recurring edits); manifest linked, L6/tokens self-check; parent browser check at 1440×1080: no horizontal overflow,
  sticky save/confirm bar with completeness. Waiting for the user's choice (R8).
- **L15** R10 implemented (e434a6fc): «Orden: Llegada / Mejor ajuste (checklist)» Select, criterion tooltip on hover
  and focus, polite «Ya estaban en orden de mejor ajuste»; 670/670 in pipeline-movement + vacancy-checklist, tsc 0;
  browser-checked by the parent. Native review review-9375bb5b78af3885 approved (clean), acknowledged.
- **L16** User (verbatim): «para la configuracion de la psicometria me gusta mucho el tercer diseno, y en "Mis
  postulaciones" sinceramente no me convence ningun diseno, el primero creo que va bien encaminado, pero igualmente no
  me convence» (+ screenshot of 01). → R7 chosen 03-lista-maestra-detalle (01, 02 alternatives); R8 started. R5: parent
  diagnosis of 01 — ~330px cards for one application, generic Enviada/Seguimiento/Cierre stepper, repeated filler line,
  underlined titles, native select, assessment block takes half the card → new artboard 04 «bandeja compacta»: ~72px
  rows with next-step chip, segmented filters, side detail panel with timeline/assessment/messages.
- **L17** R5 / S3: added 04-bandeja-compacta.html after L16, keeping 01–03: 72px inbox rows with a single next-step
  chip only when there is something to do, segmented filters with counts, side detail with dated activity, assessment
  without results and closing message; mobile full-screen detail. Real-contract statuses primary; extra statuses only in
  a labelled secondary frame. Chrome-verified 1440×900 and 390×844. Waiting for the user's choice (R6).
