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

## Tasks

| ID | Specs | Task | Commit |
| --- | --- | --- | --- |
| T1 | S2, S4 | Browser audit of `/candidato/*` with Valeria's demo data at 1440 and 390 px, plus the cause of the donut stutter (verify, background) (done, L4) | — |
| T2 | S1, S3, S5 | Research modern candidate and personal dashboards and chart patterns; write `design/candidate-dashboard-modern/research.md` (explore, background) (done, L3) | — |
| T3 | S1–S5 | 2–3 proposal artboards in `design/candidate-dashboard-modern/`, desktop and 390 px, opened on the canvas (done, L5) | — |
| T4 | S1–S3 | Implement artboard `04-bento-con-siguiente-paso.html` on `/candidato/dashboard` (L8): next-step card, bento tiles, charts by threshold, saved vacancies read, fix the 1 s assessment ticker re-render (L4) | — |
| T5 | S4 | Mobile fixes from L4: application titles and filter group, profile tabs, job section nav fade, CV file name, settings switches, guardadas gap, copy bugs | — |

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
