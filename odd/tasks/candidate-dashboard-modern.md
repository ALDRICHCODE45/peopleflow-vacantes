# Candidate dashboard: modern redesign and candidate mobile review

The candidate workspace (`/candidato/*`) needs a modern dashboard and a mobile review before the partners' demo.
The current dashboard comes from `design/candidate-dashboard-v2/02-tres-preguntas.html`. This document tracks
the audit, the research, the proposal artboards and, after the user chooses one, the implementation.

## Specs

- **S1** The dashboard charts are redesigned. User: «la primera grafica deja mucho que desear, se ve mal».
  User: «realmente no me gusta el diseno de las graficas, creo que no son modernas, creo que les falta ese
  "algo" que no se que es».
- **S2** The donut must draw without stutter. User: «carga muy lento y por "tramos" es decir, en la animacion
  inicial de la grafica se va cerrando el circulo y se para, avanza un poco y se para, avanza mas y se para y
  asi hasta que termina la animacion, eso no puede pasar».
- **S3** The whole dashboard is redesigned. User: «el dashboar en general mmmmmm la verdad es que es "pasableee"
  pero no es como me encantaria vender un dashboard a un candidato, hay cards que no me encantan como la de
  "estado de tus postulaciones"». The «Pendientes» banner too. User: «ese anuncio al principio de pendientes que
  se ve mal, no lo se.. lo siento como algo antiguo».
- **S4** The candidate screens are checked at mobile width in a real browser. Nothing may overflow the view.
  User: «quiero que pruebes todo en el navegador y lo mires por ti mismo, porque en mobile hay algunas cosas que
  se salen de la vista y parecen mal puestas, como en las postulaciones del candidato, por favor, revisa todo».
- **S5** Research and proposal come first; implementation follows only after the user approves a proposal. User:
  «investiga patrones para dashboards modernos, metodos, etc.. haz la propuestas y despues implementamos».

- **S6** «Vacantes guardadas» (`/candidato/guardadas`) is redesigned with the same quality bar as the dashboard. User:
  «me gustaria que redisenes esta pantalla, la pantalla de vacantes guardadas: [Image#3] lo mismo que con el dashboard,
  ui me parece seca, sin gracia, muy basica, no me parece para nada algo digno de un sass como PF». Proposal first, then
  implementation after approval (S5).

- **S7** Align, do not redesign, the rest of the candidate UI with the new dashboard and saved-vacancies language,
  starting with the most important screens. User: «no quiero hacer un rediseno completo profundo de toda la ui, no,
  quiero ALINEAR poco a poco lo demas, iniciando con las partes mas importantes que son: 1. postulaciones. 2. cvs. y
  perfil, de nuevo, no quiero algo completamente cambiado que no tenga nada que ver, pero la verdad es que lo que estamos
  haciendo me gusta mas que lo que estaba y eso hay que aprovecharlo. de todas formas, haz las propuestas, yo las reviso y
  en ello nos basamos».
- **S8** `design/system.md` is reviewed and updated with the patterns the new screens introduced. User: «tambien no
  olvides revisar tu system design y corregir/actualizar lo que sea necesario».
- **S9** The dark violet/black surface is used sparingly, with an explicit rule. User: «este fondo morado/negro que hay
  en algunas partes de la ui: [Image#4] me gusta mucho pero hay que usarlo con mucha cabeza en el sistema porque si nos
  pasamos un poco, terminamos con un sistema con una identidad visual completamente distinta».

- **S10** «Mis CVs» and «Perfil» get a complete redesign, not an alignment. User: «MIs postulaciones esta bien, pero mis
  cvs y mi perfil no me gusta, si me gustaria un rdiseno competo de esas dos pantallas.» Proposal first (S5); the
  dark-surface rule (S9, system.md) still applies.

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S2, S4 | Browser audit of `/candidato/*` with Valeria's demo data at 1440 and 390 px, plus the cause of the donut stutter (verify, background) (done, L4) | — |
| T2 | S1, S3, S5 | Research modern candidate and personal dashboards and chart patterns; write `design/candidate-dashboard-modern/research.md` (explore, background) (done, L3) | — |
| T3 | S1–S5 | 2–3 proposal artboards in `design/candidate-dashboard-modern/`, desktop and 390 px, opened on the canvas (done, L5) | — |
| T4 | S1–S3 | (done, L9–L11) Implement artboard `04-bento-con-siguiente-paso.html` on `/candidato/dashboard` (L8): next-step card, bento tiles, charts by threshold, saved vacancies read, fix the 1 s assessment ticker re-render (L4) | — |
| T5 | S4 | (done, L9) Mobile fixes from L4: application titles and filter group, profile tabs, job section nav fade, CV file name, settings switches, guardadas gap, copy bugs | — |
| T6 | S5, S6 | 2–3 proposal artboards for «Vacantes guardadas» in `design/candidate-saved-modern/`, desktop and 390 px, on the canvas (done, L13) | — |
| T7 | S4, S6 | (done, L15) Implement `design/candidate-saved-modern/02-postulate-primero.html` on `/candidato/guardadas` (L14) | `00f962fd` |
| T8 | S8, S9 | (done, L17) Update `design/system.md`: candidate workspace patterns from artboards 04 and saved 02, and the dark surface rule | — |
| T9 | S7, S9 | (done, L17) Alignment proposals for Postulaciones, CVs and Perfil in `design/candidate-align/`, each comparable with the current screen, on the canvas | — |
| T10 | S7 | (done, L19) Implement the approved alignment of Postulaciones (`design/candidate-align/01-postulaciones.html`), plus the «En proceso» chip colour drift on the dashboard (L17) | — |
| T11 | S5, S10 | (done, L20) Full-redesign proposals for «Mis CVs» and «Perfil» in `design/candidate-cvs-profile/`, 2–3 directions each, on the canvas | — |
| T12a | S10 | (done, L27) Implement `design/candidate-cvs-profile/03-cvs-vista-previa.html` on `/candidato/cvs` (L21); preview slot pluggable | — |
| T12b | S10 | Real first-page preview for PDFs (source to decide: pdf.js vs backend inline/thumbnail) | — |
| T13 | S10 | (done, L31) Employer side: accept and show `professional_title` from the application snapshot (board card, candidate sheet, talent base, dashboard recent, manual intake) before the backend merges (L29) | — |
| T12c | S10 | (done, L28) Implement the chosen Perfil artboard (after the user's choice) | — |

## Log

- **L1** User request, verbatim (2026-11-18): «Bien hermano, me acaban de decir que la reunion se pospuso para
  manana, pero eso me sirve para ver todos los datos de las pantallas y poder hacer correcciones si es necesario, y
  creo que hace falta una revision del frontend en algunos aspectos, primero esto: [Image#1] el dashboar de el
  candidato no se ve del todo bien, creo que la primera grafica deja mucho que desear, se ve mal, la segunda grafica
  tiene un problema que yo pense que era de mi computadora, pero no, carga muy lento y por "tramos" es decir, en la
  animacion inicial de la grafica se va cerrando el circulo y se para, avanza  un poco y se para, avanza mas y se
  para y asi hasta que termina la animacion, eso no puede pasar, ademas que realmente no me gusta el diseno de las
  graficas, creo que no son modernas, creo que les falta ese "algo" que no se que es, pero que no me gusta a mi que
  lo estoy viendo, y sinceramente, el dashboar en general mmmmmm la verdad es que es "pasableee" pero no es como me
  encantaria vender un dashboard a un candidato, hay cards que no me encantan como la de "estado de tus
  postulaciones" ademas de las graficas que ya te comente, ese anuncio al principio de pendientes que se ve mal, no
  lo se.. lo siento como algo antiguo, me gustaria mejorarlo por favor y quiero que pruebes todo en el navegador y lo
  mires por ti mismo, porque en mobile hay algunas cosas que se salen de la vista y parecen mal puestas, como en las
  postulaciones del candidato, por favor, revisa todo, investiga patrones para dashboards modernos, metodos, etc..
  haz la propuestas y despues implementamos. gracias.» Image#1 shows the three chart cards «¿Estoy siendo
  constante?», «¿Está funcionando?» and «¿Cuánto tardan en responder?».
- **L2** Context: branch `feat/candidate-dashboard-redesign` from `main` `4771d3fe`. The demo runs on a production
  build on :3000 with Grupo Altavista data. Valeria Mendoza (nocheblanca92+demo-candidato) has 4 applications,
  3 saved vacancies and 1 unread message; all are dated today. `design/system.md` is older than
  `frontend/src/app/globals.css` (token drift from the metrics redesign).
- **L3** Research done (`design/candidate-dashboard-modern/research.md`): the current dashboard repeats the status four
  times, opens with an old alert-box «Pendientes», gives four KPIs equal weight, and draws 13 nearly empty weekly bars for
  4 applications. Data available: applications (status, applied/updated/first response, message), assessments
  (answered/63), profile completeness, CVs, saved vacancies (API exists, not read by the dashboard). No event history.
  Three directions: A «Tu siguiente paso» (one action hero + rings + segmented status bar + 12-week dot strip), B «Bento
  personal» (hero figure + tiles + pending chips), C «Bitácora viva» (timeline protagonist + side summary). Chart rule:
  no chart under 5 records; rings only for part-of-whole with a goal; one animation on mount, ease-out 200–400 ms.
- **L4** Browser audit (`/tmp/pf-audit-candidate/`). S2 cause confirmed: `candidate/dashboard/assessments.tsx:20` ticks
  `setInterval(…, 1000)` and `:23-25` calls `onResult` with a new object each second; `workspace.tsx:62` re-renders the
  whole workspace → `DashboardCharts` → Recharts `<Pie>` gets a new animation id per render (`Pie.js:468`) and restarts
  (400 ms begin + 1500 ms ease-in), so the ring draws in steps over ~6–7 s (539 renders in 9 s). With the ticks disabled
  it draws in 1.44 s with no pauses. Fix: call `onResult` only when eligible ids change (one `setTimeout` to the next
  `expires_at`), stable `useSource` object, memoized chart data, `React.memo`. Bars restart the same way. 390 px: no page
  scroll, but clipped content: application title in `candidate-applications/inbox.tsx:32` (`ItemTitle` `w-fit`), filter
  toggle group in `applications-workspace.tsx:111` (hidden «Cerradas»), profile tabs `profile-workspace.tsx:31,256`, job
  section nav `PublicJobDetailView.tsx:64` without fade, CV file name cut `cv-workspace.tsx:42`, settings switches stacked
  under text, ~80 px gap in guardadas. Copy bugs: «excluye las 1», «1 aún esperan».
- **L5** T3 artboards (worker): `01-siguiente-paso.html` (A), `02-bento-personal.html` (B), `03-bitacora-viva.html` (C)
  + `design.json`; tokens re-synced in `design/system.md`/`system.html` (rules untouched). Each has toggles for rich
  history, pending assessment, profile 83 %, loading and 390 px; validated in headless Chromium (no errors, no overflow
  at 390, toggles work), screenshots `/tmp/pf-design-cd/`. Assumed data not loaded today: saved vacancies (API exists),
  per-application pipeline stage (not exposed), CV usage count (only `in_use`), derived streak/dot strip/histogram/focus
  order (computable from existing fields).
- **L6** User asked which one I recommend; recommendation: 02 · Bento personal, with one change taken from 01: when
  something is pending (message, assessment about to expire, incomplete profile), a highlighted «Siguiente paso» card
  with one action sits above the bento instead of the pending chips; with nothing pending it disappears and the bento
  moves up. User: «Si hermano, hazla y a ver como queda, pero ya me gusta esta version, haz ese ajuste, y si me gusta
  comenzamos a implementar.» → artboard `04-bento-con-siguiente-paso.html`.
- **L7** Artboard `04-bento-con-siguiente-paso.html` (worker): 02 with the pending chips replaced by a full-width
  «Siguiente paso» card above the bento (144 px at 1440, one action in the focus order assessment → message → profile →
  saved vacancies, «+N más» popover, tinted card without alert styling); «Sin pendientes» hides it and the bento moves up.
  Validated: 32 toggle combinations at 1440 and 390 without overflow, popover focus return, reduced motion. Screenshots
  `/tmp/pf-design-cd/d-*.png`. Open question: saved vacancies count as pending, so the card almost always shows.
- **L8** User approved artboard 04: «si hermano, me gusta, adelante con los siguientes pasos.» Saved vacancies not
  applied to do NOT count as a pending step (my recommendation, which the user's go-ahead accepted): the «Siguiente
  paso» card shows only for an assessment about to expire, an unread message or an incomplete profile; saved vacancies
  keep their bento tile. Handoff started on the canvas. T4 and T5 run as two parallel writers with disjoint surfaces.
- **L9** T4 `27c154b3` + T5 merge `afddde3d`; full suite 577 files / 10424 tests passed (2 skipped), tsc 0, lint 0 errors.
  Browser check on the production build (`/tmp/pf-check-cd/`): no overflow at 390, card button 44 px, thresholds hold,
  donut/banner/«Estado» gone; S2 PASS (17 commits in the first 2 s, then 0 commits and 0 DOM mutations over 10 s; ring
  draws in ~400 ms without pauses); all six T5 fixes PASS at 390 and 1440; no console errors, no ≥400. Valeria's message
  was read at 09:31:38 (before the check), so the live card is hidden (correct for 0 pending) — the backend re-applies
  before the demo. Polish left: «Primera respuesta» value 20 px vs 32–40, card radius 24 vs 14 px, hero legend wraps at
  390, tiles taller than the artboard, greeting with full name, «100%» crowds the ring at 390, 1–2 tiles rise twice
  (loading → loaded swap), whole entrance 565–785 ms.
- **L10** User on the «Perfil» tile (screenshot: thick dark-green ring, «100%» crammed inside, empty band below):
  «mira, lo unico que no me encanta es esto: [Image#2] pero lo demas, lo de la racha todas las demas cards me gustan
  mucho.» Added to the running polish worker: thin brand ring, a check icon when complete, the profile sections companies
  see (real data), missing items as chips when incomplete, «Ver perfil»/«Completar perfil» link, same height as the
  neighbouring tiles, no empty band.
- **L11** Polish `00381bb6` (worker, 31 overview tests, related 59 green, tsc/eslint 0): Perfil tile redesigned (56 px
  violet ring, check when complete, chips of the sections companies see, «Te falta poco» + missing chips when
  incomplete, «Ver perfil»/«Completar perfil»), «Hola, Valeria», «El mismo día» 32 px, single entrance (skeletons do not
  animate; content after 600 ms fades 150 ms), tighter hero legend. Card radius kept at 24 px: system.md sets none and the
  shared card uses 24 px, the artboard's 14 px is the odd one out. Rebuilt :3000 and measured: greeting «Hola, Valeria»,
  figure 32 px/600, hero legend on one line at 390 (3 items at the same y), Perfil tile 348×212 at 1440 and 358×196 at
  390, screenshots `/tmp/pf-polish/after-perfil-*.png` checked by eye.
- **L12** User approved the dashboard («Perfecto hermnao, me gusta») and asked to redesign «Vacantes guardadas» (S6),
  verbatim in S6. Image#3: page title, «3 guardadas · 2 por postularte», groups «Por postularte» and «Ya te postulaste»,
  full-width white cards with logo initials, title, company, location, salary, «Guardada el …», «Postularme» / «Ver
  vacante», a bookmark icon; lots of empty width.
- **L13** T6 artboards in `design/candidate-saved-modern/` (worker): `01-shortlist.html` (dark «Por postularte» hero +
  tiles + card grid with chips, applied cards with a status strip), `02-postulate-primero.html` (ranked queue with
  reasons + sticky dark preview; sort Sugerido/Salario/Recientes), `03-compara-y-decide.html` (dark side-by-side board,
  shared salary scale, bruto/neto never ranked together, picker up to 3). Toggles 9 / 0 / loading / 390; 36 overflow
  checks pass, Quitar + Deshacer works, motion once with reduced motion respected. Data gaps: application status needs a
  join with the candidate applications by id; no closing date, so no «cierra pronto»; no «similares» data.
- **L14** User chose «02 · Postúlate primero»: «Me gusta mas la segunda hermano, vamos por esa.» Handoff started (T7).
- **L15** T7 `00f962fd` (worker: 27 workspace tests, related 53 green, tsc/eslint 0). Saved vacancies as artboard 02:
  sort Sugerido/Salario/Recientes with real reasons (bruto ranked before neto, never compared as equal), dark sticky
  preview ≥1280 px, rows expand in place below, application status joined from the candidate applications, Quitar +
  Deshacer with focus moving on, collapsed «Ya no disponibles», empty and loading states, one entrance. Full suite 577
  files / 10441 tests passed (2 skipped), tsc 0, lint 0 errors. Rebuilt :3000 and checked in the browser at 1440, 390 and
  dark: no overflow, no console errors or ≥400, the joined status «Enviada» shows, the preview and the expanded row match
  the artboard (`/tmp/pf-sv/*.png`).
- **L16** User approved saved vacancies («me gusta ya lo revise y me gusta») and set the next plan (S7–S9, verbatim
  above). Image#4 is the dark preview panel of saved vacancies.
- **L17** T8/T9 (worker). `design/system.md`: new «Espacio del candidato» patterns (values from the implemented code)
  and the rule «Superficie oscura (hero)» (at most one per screen, only the headline figure or the single item to act
  on, never lists/sections/forms/navigation/dialogs/bands, none on Perfil/CVs/Configuración); inventory of the four
  current uses (candidate «Este mes», saved preview, company dashboard and Métricas hero), all compliant; fixes: radius
  table (cards 24 px), shadows, typography scope, Button/Input/Segmented/Skeleton, first-use empty state; drift flagged:
  the dashboard paints «En proceso» violet while inbox/Guardadas use amber (fix in T10). `system.html`: do/don't pair.
  Artboards `design/candidate-align/01-postulaciones.html`, `02-cvs.html`, `03-perfil.html` with «Ver actual»: same
  structure and features, shared header/section cards/rows/chips/ring, no dark surface on any of them. 150 overflow runs
  and 126 interaction checks pass; screenshots `/tmp/pf-design-align/`.
- **L18** User: «MIs postulaciones esta bien, pero mis cvs y mi perfil no me gusta, si me gustaria un rdiseno competo de
  esas dos pantallas.» → T10 implements the Postulaciones alignment; T11 designs full redesigns for CVs and Perfil.
- **L19** T10 `af9a9183` (worker; related 121 green, tsc/eslint 0): Postulaciones aligned to `candidate-align/01` (header
  counts, section card, saved-style rows with message chip, tint + left bar selection, light detail with 64 px logo,
  «Postulada hoy», first-use card with «Ver vacantes guardadas»); the dashboard «En proceso» chip now uses the canonical
  amber mapping. Full suite 577 files / 10451 tests passed (2 skipped), tsc 0, lint 0 errors. Rebuilt :3000; browser at
  1440, 1024, 390 and dark: no overflow, no errors or ≥400, layout matches the artboard (`/tmp/pf-pa/*.png`).
- **L20** T11 (worker, isolated worktree, merged `c1893018`): `design/candidate-cvs-profile/` with research.md (8
  principles) and six artboards: CVs 01 galería con miniaturas, 02 versión actual e historial, 03 biblioteca con vista
  previa; Perfil 04 así te ven las empresas (edit in place + rail), 05 una sola página (sticky rail, ~3,400 px), 06
  secciones como tarjetas (bento + focused sheet). Every current field, action, validation and retention rule kept; no
  dark surface. 96 overflow runs and 108 interaction checks pass. Data gaps: first-page thumbnails/inline PDF preview need
  pdf.js, a thumbnail endpoint or an inline download; no per-application CV usage (no `cv_id` in applications); no «CV
  principal» field; «Lo ven / Solo tú» inferred from the employer schema (backend to confirm); no work-history list; two
  completeness models (editor 10 vs dashboard 12).
- **L21** User chose CVs «03 · Biblioteca con vista previa» on the canvas (handoff request). Handoff started (T12a). The
  real PDF preview needs a source decision (T12b); the layout ships with a pluggable preview slot that shows honest file
  metadata, never fake document content. Perfil choice still pending.
- **L22** User decisions: CV preview → «pdf.js en el frontend (Recomendado)» (T12b; new dependency, loaded only on
  /candidato/cvs → risk item 5, independent verification); Perfil → «04 · Así te ven las empresas (Recomendado)» (T12c;
  «Lo ven las empresas / Solo tú» to be confirmed by the backend); completeness → «10 datos en los dos lados
  (Recomendado)» (LinkedIn and portfolio optional on the dashboard too).
- **L23** Perfil 04 handoff started (T12c), in an isolated worktree `feat/candidate-profile` because T12a is writing in this one; visibility labels live in one map to adjust after the backend's answer.
- **L24** Backend visibility answer (main, with file evidence): companies receive a COPY at application time
  (`process_participations.profile_snapshot`: location, skills, years, seniority, highest education level, languages),
  plus the live phone, name and email, and the CV version attached to the application. NOT shared: birth date, LinkedIn,
  portfolio, current company, summary, study details, all salaries, period and currency. Professional title is
  inconsistent (only live in the dashboard «recent» section and the legacy v1 route) → product decision for the user. The
  Perfil worker was steered to this map, with the ficha showing only company-visible data and the snapshot note.
- **L25** User: título profesional → «Que lo vean las empresas (Recomendado)». Asked the backend to add `professional_title` to the application snapshot and expose it in the pipeline detail and talent base; the profile map keeps it as company-visible.
- **L26** Backend started `feat/snapshot-professional-title` (from main): `professional_title` frozen in the application snapshot; pipeline detail `profile.professional_title`; talent base `professional_title` (company correction still wins); «recent» reads the snapshot; old applications → null, no backfill. Frontend follow-up: show the title in the employer pipeline candidate sheet once the backend commit lands.
- **L27** T12a (worker; related 67 green, tsc/eslint 0): `/candidato/cvs` as artboard 03 with `cvs/library.tsx`, the
  pluggable `CvPreview` (`src` | `renderPage`, honest placeholder otherwise), arrow-key selection, page-wide drop overlay,
  focus to the next row after delete, one entrance. Accepted deviations: panel from 1280 px (same breakpoint as saved
  vacancies; the sidebar takes the space at 900), empty copy no longer promises a page preview, spinner instead of a
  percentage (no upload progress events), «En uso» label, short row date.
- **L28** T12c `d5594931`, merged `b59c4e38` (worker; related 134 green, tsc/eslint 0): `/candidato/perfil` as artboard 04
  with the confirmed visibility map `profile/visibility.ts` (title company-visible), a ficha showing only company data,
  in-place section editing, the fixed «Cambios sin guardar» bar, the rail with «n de 10 datos clave» and «Qué recibe la
  empresa» (built from the map, with the copy-at-application line). Shared `profile-completeness.ts` (10 items; LinkedIn,
  portfolio and seniority do not count) used by the editor and the dashboard. Worker choices: education status «Solo tú»;
  highest level includes «En curso»; ficha facts line; «Qué recibe la empresa» kept at 390. TDD partial: screen tests
  written after the first draft (RED observed only for completeness and visibility).
- **L29** Backend `feat/snapshot-professional-title` (bb9e10bc migration 00061 constraint, ec4c7777 behaviour; not merged): board card/detail `profile.professional_title` (+ `original.professional_title`), talent base `professional_title` from the latest snapshot, dashboard `recent[].candidate.professional_title` from the snapshot, manual 201 includes it. The frontend board `profileSchema` is `.strict()` → the new key would break decoding; backend asked not to merge until the frontend accepts and shows it (T13), then merge together.
- **L30** Backend `feat/snapshot-professional-title` independently verified PASS (HEAD 2f278ffa). Deploy note: migration 00061 must run before the new code (otherwise applying fails on the old constraint). Plan: frontend schemas accept the key present or absent → backend applies 00061 locally and runs its branch on :8081 → end-to-end browser check → joint merge into local main together with this branch, once the user approves it.
- **L31** T13 (worker; related 123 files / 2163 tests green, tsc/eslint 0): new strict `boardProfileSchema` with optional +
  nullable `professional_title` (board, detail, manual 201); the talent-base `profileSchema` unchanged and still rejects
  it. Title shown on the pipeline card (name clamps to 1 line so the card keeps its height), the sheet header and the
  dashboard «Candidatos recientes»; the talent base already showed it. Findings for the backend: `original.professional_title`
  already existed on main (only its value changes); move/discard responses do NOT carry the profile
  (`board/filter_data.go:51`).
- **L32** Independent verification at the merge of T12–T13 (`/tmp/pf-verify-cvp/`): Part A pdfjs-dist 6.5.438 PASS (checks
  before bytes reach pdf.js, same-origin source only, no scripting/forms layer, no CDN, async chunks only and no server
  code, worker emitted same-origin, Apache-2.0, optional `@napi-rs/canvas` without install scripts, lockfile limited to
  that subtree). Part B PASS at 1440/1024/390, light and dark: CVs real first page sharp, Perfil ficha shows only
  company-visible data with the title, Descartar restores, rail and dashboard both 10 de 10, title end to end (new
  application `ca97bc3d-5403-41d7-be8f-130caeb7593f`: card, sheet and «Candidatos recientes»), 0 console errors and 0
  ≥400. Fixed the medium finding: the dashboard profile tile said «Las empresas ven todo tu perfil» → «Lo que ven las
  empresas está completo», chip «Educación» → «Nivel de estudios». Open low items: Apache-2.0 notice stripped by
  minification (add a third-party notice), title truncated on 284 px cards, no cMap/standard fonts (fallback rendering).
- **L33** Full suite after T12–T13: 581 files passed, 1 failed — `requestPath.test.ts` guard (fetch only in registered same-origin adapters) caught the new `cvs/pdf-page.ts` fetch. Fixed: the preview now fetches the fixed `/api/candidate/cvs/${encodeURIComponent(id)}/file` with `redirect: "error"`, registered in the guard list with a reason, plus a dedicated guard test (47 related tests green, tsc/eslint 0). Full suite rerun.
- **L34** Full suite rerun: 582 files / 10504 tests passed (2 skipped), tsc 0, lint 0 errors. Rebuilt :3000 (final candidate build); smoke: CV first page drawn on a canvas with one `/file` 200, dashboard tile «Lo que ven las empresas está completo», no console errors, no ≥400.
