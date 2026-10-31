# Candidate CVs and dashboard redesign

Branch `feat/candidate-cvs-redesign` (from main 940f8d9d). Full redesign of the candidate CV library first, then the
candidate dashboard with real data only; design on the canvas before each implementation.

## Specs

- **S1 CV screen redesign.** «quiero hacer un rediseno de la pantalla del los cvs del candidato, no me gusta nada esa
  pantlla» — «es que mira eso, esta muy mal, sin ofender jaja.» Data stays the real library (`/candidato/cvs`: name,
  type, size, uploaded_at, in_use, limits max_cvs / max_bytes / content_types; actions download, rename, delete).
- **S2 Dashboard redesign without mock data.** «y el dashboard: […] sigue habiendo datos mock, el diseno tampoco me
  gusta del todo, un rediseno completo estaria bien igualmente, y sobre los datos que muestra, estoy abierto a re-pensar
  este apartado con el proposito de lo que mas le ayudaria al candidato».
- **S3 Keep the dashboard cards.** «el tema es que las tarjetas es lo unico que si me convence jaja, si me gustaria
  dejarlas dentro del diseno, posiblemente cambiar la data que muestra por data nueva, de nuevo, estoy abierto a
  platicarlo, no importa si hay que cambiar el backend.»
- **S5 Chosen CV design.** «todo el diseno de la tercera opcion, pero agregando el badge de la primera» — artboard
  `design/candidate-cvs-redesign/03-lista-y-panel.html` (list + sticky upload panel: drop zone, capacity, usage tips)
  with the «Usado en postulaciones» badge and its ⓘ popover from 01. Upload, rename, delete, download, failure,
  uncertain-upload, storage-unavailable, wrong-role and limit behavior stay as today.
- **S6 Dashboard data (D1).** User accepted the proposal «Sí, así»: four cards — **Por atender** (pending
  assessments + new company messages), **Postulaciones activas** (submitted + in process, with breakdown), **Perfil**
  (completeness and which fields are missing), **CVs** («n de max» and how many were sent in applications); below, the
  pending list and recent applications on real data; remove the Contratada/Rechazada stacked bar and the prototype
  saved vacancies; ask the backend for a per-application `updated_at` (last status change) to show and sort by recent
  activity.
- **S7 Chosen dashboard design.** «el 2 no me gusta nada, el 3 me convence mucho mas.» — artboard
  `design/candidate-dashboard-redesign/03-bitacora-personal.html` (four cards in two rows, applications as a log ordered
  by last visible activity).
- **S8 Message read state from the backend.** User chose «Pedir al backend «leído»»: the backend stores when the
  candidate read each company message (read_at + mark as read), the same on every device. Until it exists, «Por
  atender» counts only pending assessments and company messages stay visible in their application in the log.
- **S9 Richer dashboard (supersedes the look of S7).** «la verdad es que no me gusta, [screenshot] es muy plano, muy
  seco, no tiene mucho chiste.... este era el dashboard antiguo: [screenshot] y es mucho mejor en terminos de diseno,
  igualmente me gustaria alguna grafica como la que se muestra en el dashboard de la empresa, pero no solo quiero poner
  una grafica por ponerla, quiero algo que realmente valga la pena para el candidato, y aparte mejorar el diseno.»
  Base the new design on the old dashboard's structure (pending banner on top, greeting, four compact KPI cards with
  the number as hero, recent applications + side panel) on real data (S6, S8 stay).
- **S10 Charts that answer candidate questions.** User selected all three: «¿Estoy siendo constante?» (applications
  per week over 3 months / 30 days, colored by current status, like the employer chart), «¿Está funcionando?»
  (what happened to the applications: in process / sent / closed with the advance rate as headline), «¿Cuánto tardan
  en responder?» (average days until a company first moves an application — needs a backend first-change timestamp).
- **S11 Greeting name.** «No, usar el nombre completo»: greet with the full `full_name` (the first token can be a
  surname, e.g. «Hola, Flores»).
- **S4 Order.** CVs first, then the dashboard, as separate deliveries (user choice, L3).

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| V1 | S1 | canvas — `design/candidate-cvs-redesign/` directions → user choice: 03 + badge of 01 (L6) | a178cbeb, this commit |
| V2 | S1, S5 | worker — implement 03 + badge of 01 in `cv-workspace.tsx`; keep upload/rename/delete/failure behavior; tests | this commit (L7) |
| D1 | S2, S3, S6 | agree with the user which data each dashboard card and section shows (real data; backend changes allowed) | decided (L9) |
| D2 | S2, S3 | canvas — dashboard directions keeping the cards → user choice | |
| D3 | S6 | backend request: per-application `updated_at` (last status change) in the candidate applications list | |
| D4 | S2, S3, S6, S7, S8 | worker — implement 03 on real data; remove prototype fixtures from the route; tests | this commit (L13) |
| D6 | S9, S10, S11 | canvas — `design/candidate-dashboard-v2/` directions on the old structure with the three charts → user choice | 4ac59acb, 21412d46 (L19, L22) |
| D7 | S10 | backend request: first candidate-visible change timestamp per application (response time) | |
| D8 | S9, S10, S11 | implement the chosen v2 design on real data; tests | |
| D5 | S8 | backend request: message read state; then the frontend counts unread messages in «Por atender» | |

## Log

- **L1** User (verbatim): «Si, quiero hacer un rediseno de la pantalla del los cvs del candidato, no me gusta nada esa
  pantlla, pero antes de que heche a andar el dev server del frontend y la api del backend, crea la rama del rediseno y
  cambiate a ella por favor.» → branch `feat/candidate-cvs-redesign` from main 940f8d9d.
- **L2** User (verbatim): «Si hermano, son en realidad dos cosas, los cvs: [screenshot /candidato/cvs] es que mira eso,
  esta muy mal, sin ofender jaja. y el dashboard: [screenshot /candidato/dashboard] sigue habiendo datos mock, el diseno
  tampoco me gusta del todo, un rediseno completo estaria bien igualmente, y sobre los datos que muestra, estoy abierto
  a re-pensar este apartado con el proposito de lo que mas le ayudaria al candidato, me sigues?»
- **L3** Answers: dashboard purpose — «el tema es que las tarjetas es lo unico que si me convence jaja, si me gustaria
  dejarlas dentro del diseno, posiblemente cambiar la data que muestra por data nueva, de nuevo, estoy abierto a
  platicarlo, no importa si hay que cambiar el backend.»; order — «CVs primero, luego dashboard».
- **L4** Exploration. Dashboard route renders `prototype-candidate`, `prototype-messages`, `prototype-portfolio`
  fixtures (only pending assessments are real); real sources: applications (`submitted|in_process|closed`, vacancy
  state, closing message), CV library, profile read, pending assessments. Saved vacancies are prototype too. CV screen
  issues: native file input, oversized «1 de 10» progress, half-width card for one file, unexplained «En uso»
  (`in_use`: used by a sent application; deleting keeps every application's copy).
- **L5** V1 canvas `design/candidate-cvs-redesign/`: 01-biblioteca-lista (compact list, drop zone on top, «Usado en
  postulaciones» badge with ⓘ popover), 02-galeria-documentos (document cards, «Agregar CV» tile in the grid),
  03-lista-y-panel (list + sticky upload panel with capacity and usage tips). Each has a design-only state switcher
  (con CVs / vacía / subiendo / error / límite). Headless check: no page errors in any state, menu Escape returns
  focus, no horizontal overflow at 1440 and 390. Awaiting the user's choice.
- **L6** User (verbatim): «Me gusta mucho la tercera opcion hermano, peroo me gusta el badge de "Usado en postulaciones"
  de la primera opcion, entonces, todo el diseno de la tercera opcion, pero agregando el badge de la primera, me
  explico?» → 03-lista-y-panel updated with the 01 badge + ⓘ popover (green check text removed). Chosen artboard:
  03-lista-y-panel.html; 01 and 02 are alternatives. Headless: no errors, popover opens, Escape returns focus to ⓘ, no
  overflow at 1440 (limit state) and 390.
- **L7** V2 implemented by worker (presentation only in `cv-workspace.tsx`; same upload/rename/delete/recovery paths;
  drag-and-drop calls the same `selected()`; generic `InfoPopover` reused). Deviations from 03: neutral file tiles,
  spinner instead of a fabricated progress percentage, badge beside the name only at 2xl. Worker ran on Node 25 (49
  `localStorage.clear` failures in untouched tests); parent rerun on the required Node 22.23.4: 47 files / 649 tests
  passed (candidate, candidate-cvs, (candidato) routes, candidate-dashboard), `tsc` 0, eslint clean on changed files.
  Browser QA pending: candidate login is real Cognito, asked the user to check /candidato/cvs in their browser.
- **L8** User (verbatim): «Bien, muy buena base, pero las cards de los cvs estan muy "flacas" me sigues? muy delgadas,
  no se ven como en el diseno propuesto.» Root cause: the file tile was absolutely positioned inside CardHeader, so it
  added no height and rows collapsed to two text lines. Fix: the tile is an in-flow grid column (44×52, row-span 2),
  rows center vertically with more padding, PDF/Word tiles tinted with status-danger/status-info as in 03. RED on the
  previous code (tile test), GREEN 562/562 on Node 22, tsc 0, eslint clean.
- **L9** Answers: CV rows — «Sí, quedaron bien» (V2 browser QA by the user; handoff 03 implemented). Dashboard cards —
  «Sí, así (Recomendado)» → S6. **Slice boundary:** the CV delivery (V1–V2) ends at 453e0e9a; the dashboard (D2–D4)
  is the next slice.
- **L10** D2 (S2, S3, S6): dashboard directions in `design/candidate-dashboard-redesign/`: `01-resumen-dividido.html`
  (four cards + balanced pending/recent panels), `02-agenda-de-acciones.html` (full-width action queue + recent
  application cards), `03-bitacora-personal.html` (2×2 cards + recent-update timeline and pending rail). Each includes
  Con actividad / Primera visita / Al día, actionable cards and only Enviada / En proceso / Cerrada; recency represents
  the requested D3 `updated_at`, not an API integration. `design.json` records 1440×900 viewports and tradeoffs.
  No direction chosen yet; product links are inert in these standalone design examples. Token/font self-check completed;
  browser overflow, focus and state-switcher verification remain pending (no browser runner supplied to this worker).
- **L11** D3: backend (session 01a18f07) proposes `updated_at` always present, RFC3339, derived from
  participation_stage_history (no migration): time of the last candidate-visible change (submitted↔in_process,
  discard→closed with message, recovery); internal moves keeping the visible status do not bump it; equals applied_at
  otherwise; ordering stays applied_at DESC (dashboard sorts client-side); contract doc backend/docs/vacancy-applications.md
  «Candidate list (private)». Frontend agreed (recovery counts) and accepts it first: 59532e0b — optional, RFC3339 with
  offset, >= applied_at, other unknown keys still rejected; RED 3 accept cases, GREEN 481/481 on Node 22, tsc 0, eslint
  clean. Backend waits for the user's go-ahead in its own session.
  D2 parent check (headless, canvas): 01/02/03 load with no page or console errors; each of «Con actividad»,
  «Primera visita», «Al día» changes the content; no horizontal overflow at 1440 or 390; no Contratada/Rechazada/
  En revisión/saved/recommended copy. Awaiting the user's choice.
- **L12** User (verbatim): «el 2 no me gusta nada, el 3 me convence mucho mas.» → chosen artboard 03-bitacora-personal.html
  (01 and 02 are alternatives). Exploration: the frontend has no persisted read state — «Nuevo mensaje» clears only for
  the current mount (`features/candidate/application-message.tsx:32`). Asked how «Por atender» counts messages; answer
  «Pedir al backend «leído» (Recomendado)» → S8, D5.
- **L13** D4 implemented by worker: route mounts a real workspace (`features/candidate/dashboard/`), no prototype
  imports; four cards on real sources (Por atender = pending assessments only per S8; active = submitted + in_process;
  Perfil % + missing fields via extracted `profile-completeness.ts`; CVs n de max + used), log sorted by
  updated_at ?? applied_at with «Postulaste el …» fallback, only Enviada / En proceso / Cerrada, closed + message →
  «Leer mensaje» through `ApplicationMessage` (new optional `showUnread`/`triggerLabel`, defaults unchanged so
  Postulaciones renders as before; no fabricated message timestamp). Sources load/fail independently with retry. Scope
  extension to application-message.{tsx,test.tsx} approved by the parent (defaults preserved). Parent rerun on Node 22:
  78 files / 1460 tests passed, tsc 0, eslint 0 errors (13 warnings in unchanged files). Deviations: native
  StateCard/SectionEmpty geometry, md/lg breakpoints, AssessmentBlock keeps real progress, absolute dates. Browser QA
  pending (real Cognito login): asked the user to check /candidato/dashboard.
- **L14** Independent verify (Risk item 3, shared code), all PASS: Postulaciones never called `ApplicationMessage`
  (inline message in `candidate-applications/inbox.tsx:63`), so its only caller is the dashboard
  (`candidate-dashboard-overview.tsx:95`, `showUnread={false}`, «Leer mensaje», no fabricated sentAt); component
  defaults unchanged and tested; strict schema accepts only optional updated_at (rejects null/empty/invalid/date-only/
  earlier/unknown keys); applications-workspace tests byte-identical to origin/main; 156 tests passed on Node 22 in an
  isolated copy; S6 met, S7 met for shared-code interaction, S8 met for the interim frontend. Verifier scratch left at
  /tmp/candidate-verify.XwOneb (outside the repo).
- **L15** User browser QA of a8736c6c rejected the look (S9 verbatim) and asked for meaningful charts. Parent analysis:
  the 03 implementation lost the old hierarchy (pending banner first), the compact number-first cards and the visual
  side panel. Found greeting bug «Hola, Flores» (first token of full_name «Flores Vazquez Bryan Aldrich»). Answers:
  charts — all three (S10); name — «No, usar el nombre completo» (S11). D4's data layer stays; its presentation is
  replaced by D8.
- **L16** D6 (S6, S8, S9, S10, S11): new directions in `design/candidate-dashboard-v2/`:
  `01-ritmo-protagonista.html` (full-width weekly chart, recent applications + results/response rail),
  `02-tres-preguntas.html` (three equal insight cards, recent applications + status panel),
  `03-perspectivas-en-panel.html` (recent applications beside keyboard-accessible insight tabs + status legend).
  All restore the pending banner first, full-name greeting and four compact number-led KPIs; Por atender counts
  assessments only, messages use «Leer mensaje», and statuses are Enviada / En proceso / Cerrada. Each includes
  Con actividad / Primera visita / Al día, 3-month / 30-day constancy controls, accessible SVGs with hidden data
  tables, and an explicit first-change backend dependency for response time. Sample data: 12 applications
  (6 in process, 4 sent, 2 closed), October 4 vs September 2, first-response mean 6 days across 8 responses.
  `design.json` links this feature, records 1440×900 and honest tradeoffs; no direction chosen or production
  integration. Token/font self-check completed. Product actions are intentionally inert. No exact browser validation
  command or canvas tool supplied to this worker: visual, keyboard and overflow checks at 1440/390 remain for the
  parent; `/gentle:design open candidate-dashboard-v2` opens the canvas. No comments resolved; no commit.
- **L17** D3 ready on backend branch feat/applications-updated-at (18b5d08f, local): updated_at UTC "Z" with optional
  µs, always present. D7 in progress: `first_response_at` nullable, key always present, never reset. Frontend accepts it:
  a732e63f (optional nullable, >= applied_at; µs proven for updated_at) — RED 4 accept cases, GREEN 561/561 on Node 22,
  tsc 0, eslint clean. D5 proposal accepted (message_read_at always present, null when no message/unread; PUT
  /v2/me/applications/{id}/message-read {updated_at} → 204 / 404 not_found / 409 message_unavailable|message_changed /
  400 invalid_request); asked that message_read_at be null whenever message is null. D6 parent check (headless):
  three artboards load with no errors; every state/period toggle works; full name shown; no forbidden copy; 01 overflowed
  at 390 because its screen-reader-only <table> ignored width:1px — fixed with `table.sr{display:block}`; now no
  overflow at 1440 or 390 in any state of 01/02/03. Awaiting the user's choice.
- **L18** D7 ready (backend 8f8b66df, local). D5 name confirmed `message_read_at` (null whenever message is null, DB CHECK;
  {error, code} on both 409s); backend implementing on feat/applications-message-read. Frontend accepts it: optional
  nullable, requires a message and >= applied_at — RED 3 accept cases, GREEN 568/569 (Node 22), tsc 0, eslint clean.
  The one failure, «S3 profile phone saves > sends +52…» (profile-workspace.test.tsx), exceeded the 5 s test timeout
  (5231 ms) with machine load average 29; that file imports nothing from candidate-applications and is untouched on this
  branch. Its single re-run timed out at the 120 s command limit under the same load. **Pending:** re-run
  profile-workspace.test.tsx when the load drops.
- **L19** Canvas comment rzt8dlxg on 02-tres-preguntas (verbatim): «Me gusta mucho sta opcion pero hay mucho que mejorar,
  hay errores visuales muy obvios y graves, sunpongo que puedes verlos, ademas de que en el diseno real tendras que usar
  las graficas de shadcn.» → chosen direction: **02-tres-preguntas** (01 and 03 are alternatives); production charts
  use shadcn `components/ui/chart.tsx` (Recharts + ChartContainer). Fixes (worker + parent): screen-reader table
  captions rendered over the chart titles (moved into `div.sr`); donut center text inside the hole (shadcn «Donut with
  Text»); shadcn chart language (header action period toggle, dashed horizontal grid, rounded bars, dot legend,
  tooltips); 200px weekly plot with regular ticks; response histogram on a baseline in --primary (it reused the
  «Enviada» color) and without the obsolete backend note; aligned chart header/plot/legend/footer rows (header row
  68px desktop, auto on mobile); KPI cards share one grid without progress bars; copy «Evaluaciones por responder».
  Parent browser check: no errors; chart descriptions aligned (556/555/555 px); no overflow at 1440, 1024 and 390 in
  every state and period. Comment resolved.
- **L20** D5 verified by the backend (9b28e783 on feat/applications-message-read, stacked on 18b5d08f + 8f8b66df; local
  only): PUT /v2/me/applications/{id}/message-read {updated_at} → 204 no-store; 404 not_found; 409 message_unavailable /
  message_changed; 400 invalid_request; discard and recovery reset message_read_at. Frontend client + action:
  `markMessageRead` / `markMessageReadAction` (strict body, uuid id, no-store, redirect error, timeout, bounded error
  envelope; 204 is the only success; never retries); shared failure map gains message_unavailable / message_changed
  (409 only). RED (missing exports), GREEN 157/157 in candidate-applications and 662/663 in the wider run where the
  only failure was the test's own wrong expectation (already_applied is a known shared code) — fixed to an unknown
  code; tsc 0, eslint clean. Wiring on the dashboard happens in D8. The earlier profile-workspace timeout re-ran green
  at load 3.5: 39/39.
- **L21** Independent verify of c42107b7 (Risk item 3, shared failure map): PASS — consumers fall back to generic copy;
  18 old codes × statuses 100–599 map identically (9,000 results); PUT transport guards; contract match. It found a
  guard I broke: `jobs/drafts/pipeline/server-action-surface.test.ts` pins the public Server Action surface → allowlist
  gains markMessageReadAction. First FULL frontend suite run (Node 22; earlier runs were folder-scoped) also found:
  `jobs/requestPath.test.ts` (fetch allowlist → candidate-applications/client.ts added with its 204 rationale, like
  vacancy-checklist) and `ui/button-variants-merge.test.ts` (real bug from a8736c6c: dashboard «Iniciar sesión» outline
  link rendered borderless; now `cn(buttonVariants({ variant: "outline" }), "min-h-10")`). Rerun: 9023 passed, 1
  skipped, 2 failed — combobox.test.tsx (17.4 s) and jobs/drafts/rich/description.test.ts (5155 ms > 5 s), both test
  timeouts at load average 19–23 in files untouched on this branch (empty diff vs origin/main); their isolated rerun hit
  the 110 s command limit under the same load. tsc 0, eslint 0 errors. **Pending:** re-run those two files when the
  load drops. Process fix: run the full suite before every code commit.
- **L22** User (verbatim): «si hermano, aprobado» → design 02-tres-preguntas (21412d46) approved for D8. Slice boundary:
  D8 is the next slice (dashboard v2 presentation on the existing data layer).
- **L23** D8 implemented by worker (presentation of 02 on the existing data layer): `features/candidate/dashboard/
  charts.tsx` (shadcn ChartContainer + Recharts: weekly stacked bars with 3 meses / 30 días, donut with total, response
  histogram; accessible data tables; older-server empty state when first_response_at is absent), pure `insights.ts`
  (+ tests: local-calendar weeks, periods, month comparison, advance rate, response days, unread predicate), full-name
  greeting (S11), Pendientes banner, compact KPIs, unread = message && message_read_at null (absent field ≠ unread);
  opening an unread message calls markMessageReadAction once with updated_at, badge clears only after ok, 409
  message_changed refetches. `ApplicationMessage` gains optional `onOpen` (defaults unchanged) and drops the prototype
  type import. Assessment loading/error stays independent (render-boundary regression found by the full suite and
  fixed without touching that test). Checks (Node 22): focused 29/29; render-boundary 2/2; full suite 9037 passed, 3
  failed, 1 skipped under load average 20–27 — draft-editor-shell, manual-intake/sheet, combobox; all three untouched
  (empty diff vs origin/main) and green in isolation at load ~5: 16/16, 66/66, 29/29. tsc 0; eslint 0 errors.
  Deviations: native Card/SectionEmpty geometry, period toggle wraps under the title in narrow cards, all loaded
  recent applications listed (unread actions stay reachable), chart descriptions describe the loaded applications.
  Browser QA pending (user, real Cognito).
