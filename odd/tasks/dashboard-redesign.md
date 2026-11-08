# Dashboard redesign

Redesign proposal for the company dashboard (`/empresa/dashboard`) and company metrics (`/empresa/metricas` + recruiter
detail): compare with the user's references, research modern dashboard patterns, add dashboard rules to
`design/system.md`, and deliver directions on the canvas. No production code in this stage. Branch `feat/stakeholder-metrics`.

## Specs

- **S1** Compare the current dashboard with the user's references (FlowMail, ShipNow) and more examples found by research.
  User's feeling, verbatim: «cuando lo veo, veo caos, no veo orden no me dan ganas de seguir revisando, no me llama la
  atencion, el sistema no me atrapa, no me invita a revisar, lo veo todo muy "amontonado", muy cerca de todo».
  About the references: «aunque si hay mucha informacion en algun ejemplo, no tiene ese efecto en mi de "desorden" todo
  paece tener un por que, y me invita».
- **S2** «explorar e investigar patrones de ux/ui modernos sobre los cuales trabajar y poder hacer otra propuesta».
- **S3** Scope: «Métricas de empresa» (/empresa/metricas and recruiter detail) and «Dashboard de empresa» (/empresa/dashboard).
- **S4** Deliverable: «Investigación + reglas + artboards» — comparison with references, new dashboard rules in
  `design/system.md`, and 2–3 directions on the canvas to choose from. No code yet.
- **S5** Data: «Puede proponer datos nuevos» — anything that needs new backend data is marked clearly for the user to decide.

- **S6** Combined Métricas (L5, L6): KPI cards from artboard 02; «Vacantes cerradas por mes» data from 02 drawn in the
  area-chart style of 01; beside it 02's «Estado de entregas» with a palette without brown or the odd green; 03's pipeline
  by stage («¿Dónde está tu gente?»); 04's delivery compliance, bottlenecks and recruiter comparison; origin of
  applications last. The company dashboard stays a separate screen, redesigned later with the same rules.
- **S7** «todo lo que tenga porcentaje, lo mismo: que exista la posibilidad de indagar en los detalles de esos
  porcentajes» — every number and percentage opens the records behind it («"5 tarde".. bueno, eso le ayuda mucho pero
  cuales??»). Drill-down opens a filtered detail page (L6), with Back returning to the board.
- **S8** Section titles sound professional (no colloquial questions); explanations are not shown by default: «la dejamos
  dentro de un popover para que el cliente la vea si quiere».
- **S9** «quiero tener buena performance en el cargado de la data, tecnicas de lazy loading o tecnicas para merjorar la
  ux del usuario» — the design shows progressive loading per section.
- **S10** Playwright reviews check the UI, not only function: «que se vea bien, que no haya nada extrano, que el diseno
  coincida, etc.. revisa cada detalle».

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S3 | Explore (background): map current screens, sections, density and available data (done, L3) | — |
| T2 | S1, S2 | Research modern dashboard patterns; write `design/dashboard-redesign/research.md` (comparison + principles) (done, L3) | — |
| T3 | S4 | Dashboard rules section in `design/system.md` (done, L3) | — |
| T4 | S3–S5 | Artboards `design/dashboard-redesign/` (2–3 directions, both screens), open on canvas (done, L4) | — |
| T5 | S6–S9 | Artboard `07-metricas-combinada.html` (combined Métricas, new status palette, loading states) (done, L7) | — |
| T6 | S7, S9 | Artboard `08-detalle-indagacion.html` (filtered detail page reached from any number) (done, L7) | — |
| T7 | S6, S8 | Update `design/system.md` dashboard rules: status palette, professional titles, drill-down rule, help only in popovers (done, L7) | — |
| T8 | S5, S7, S9 | Data needs for contract v2 (`docs/product/stakeholder-metrics-v2-needs.md`), sent to the backend session; system.md dashboard rules binding (done, L8) | `ef2a4a9b` |
| T9 | S5–S9 | Review the backend's contract v2 proposal (done, L10) | — |
| T10a | S6–S10 | (branch `feat/metrics-redesign`) Métricas board from 07 against v2a: v2 client/model, sections summary, closures, compliance, delays, origin, recruiters, lazy loading, delivery palette, drill-down hrefs | — |
| T10b | S7, S9, S10 | Detail page `/empresa/metricas/detalle` from 08 against v2b (lists, facets, applied_filters, export) | — |
| T10c | S6, S7 | Pipeline section and candidates drill-down against v2c | — |
| T12 | S3, S5 | Dashboard 09 data needs (`docs/product/company-dashboard-v2-needs.md`) sent to the backend; review its proposal | — |
| T13 | S3, S7–S10 | Implement `/empresa/dashboard` from 09 | — |
| T11 | S3 | Company dashboard artboard with the same rules (`09-dashboard-empresa.html`) (done, L12) | `ae0707a8` |

## Log

- **L1** User (verbatim): «No, hay que hacer cambios hermano, sinceramente no me gusta el diseno de los dashboard y tengo
  que ser muy sincero contigo, cuando lo veo, veo caos, no veo orden no me dan ganas de seguir revisando, no me llama la
  atencion, el sistema no me atrapa, no me invita a revisar, lo veo todo muy "amontonado", muy cerca de todo, no me gusta
  para nada, y creo que esto nos viene muy bien porque creo que en system design actual no hay reglas estrictas para
  dashboards o cosas asi, y creo que podemos sacar mucho de sto, y sinceramente no se decirte exactamente que esta mal y
  que esta bien, pero si te puedo decir mi sentir, y tambien te puedo mostrar ejemplos de dashboards que si me gustan,
  estos son algunos ejemplos: [Image#1] [Image#2] fijate que aunque si hay mucha informacion en algun ejemplo, no tiene
  ese efecto en mi de "desorden" todo paece tener un por que, y me invita, y de nuevo, no estoy diciendo que el diseno
  actual sea "horrible" o "malisimo" simplemente digo que no esta al nivel de un dashboard moderno, tu trabajo es
  comparar el dashboard actual con los ejemplos que te acabo de mostrar, buscar mas ejemplos para contrastar, explorar e
  investigar patrones de ux/ui modernos sobre los cuales trabajar y poder hacer otra propuesta. alguna duda?»
  Image#1: FlowMail (light, white cards on a grey canvas, welcome header + two actions, 4 KPI cards with delta pills,
  line chart + donut + top-list row, bar chart + recent table + AI insights row). Image#2: ShipNow analytics (one dark
  hero KPI + 4 small KPI cards, line/bar chart, top country/company ranked lists with bars, heatmap, filterable table).
- **L2** Answers: scope Métricas de empresa + Dashboard de empresa; deliverable investigación + reglas + artboards;
  new data may be proposed if marked.
- **L3** T1 map: both screens stack one column of equal Cards; `gap-4` at every level; Métricas has no KPI strip,
  no chart, 7 equal cards with `border-t` sub-blocks, ⓘ per card and per stat, 10-column recruiter table, 6-field
  filter bar before data. Research written to `design/dashboard-redesign/research.md` (comparison, 11 principles,
  new data N1–N4). 15 dashboard rules added to `design/system.md` (proposed, binding once a direction is picked).
  Directions: 01/02 Pulso (bento), 03/04 Historia (questions), 05/06 Foco (strip + tabs + attention rail).
- **L4** Artboards written by three background workers and opened on the canvas: `01-pulso-dashboard.html`,
  `02-pulso-metricas.html`, `03-historia-dashboard.html`, `04-historia-metricas.html`, `05-foco-dashboard.html`,
  `06-foco-metricas.html`. Parent review of rendered screenshots: Foco chart smoothed to a 7-day average, Historia
  tooltip overlap and channel names fixed; manifest heights set to measured values. Waiting for the user's pick.
- **L5** User feedback on the six artboards (verbatim): «Mira, las primeras cards, me gustan las cards de la propuesta
  numero 2, en la segunda seccion me gusta la de la propuesta 1, pero solo el estilo de la grafica, pero que muestre los
  datos que muestra la propuesta 2: "vacantes cerradas por mes" , creo que esa grafica debe de ir acompanada de la card
  de la propuesta 2: "Estado de entregas" ese dato es de mucha ayuda, y que se pueda indagar mas en esos datos, pero algo
  que no me gusta de esta card es que ocupa colores raros que a mi parecer no convinan aqui, como cafe o ese verde raro,
  y creo que tambien ayudaria mucho la grafica de "?Donde esta tu gente?" y que tambien se pueda indagar mas para conocer
  mas detalles, y te lo digo porque me ha pasado en sistemas que he hecho para otros clientes, cuando hay dashboard que
  muestran data que al cliente le ayuda mucho, por ejemplo, esta persona va mal porque ha entregado 20 porciento de las
  vacantes a tiempo y 80 por ciento a destiempo, y el cliente me dice, muy bien pero ahora yo me tengo que dar a la
  tarea de averiguar cuales son esas vacantes, quiero conocer mas detalles, que el sistema me de esa opcion. Tambien la
  secciond e ? Cumplimos lo prometido?" ayuda mucho, creo, y creo que tambien todo lo que tenga porcentaje, lo mismo: que
  exista la posibilidad de indagar en los detalles de esos porcentajes. tambien eso de ? donde se atora? y creo que hay
  que cambiar ese tipo de textos, que suene mas profesional, y tambien algo muy importante, estoy notanto que la
  propuesta 4 tiene mucho texto al inicio de las secciones, y los clientes si se les hace util eso pero solo cuando ellos
  lo decidan, no ponemos la explicacion por defecto, la dejamos dentro de un popover para que el cliente la vea si
  quiere, y de nuevo, con los porcentajes, numeros, etc.. por ejemplo: "5 tarde".. bueno, eso le ayuda mucho pero
  cuales?? tengo que meterme al sistema y buscar yo por mi cuenta. me sigues? . Y tambien eso de "Quien lo esta
  logrando" muy buenooo, una comparacion de colaboradores, muy muy bueno, eso me gusta, pero siempre tratando de ser bien
  claro en todo, de nuevo, con capacidad de indagar mucho mas. y creo que el origen de las postulaciones lo pondria hasta
  el ultimo hermano, no se me hace algo que a los reclutadores o al stakeholder le vaya a interesar para tomar deciciones
  importantes. y ojo, se que hay cambios importantes tanto de ux/ui como de data, y te quiero decir (para ti y para el
  backend) que se lo tomen con calma, no hay prisa, hay tiempo, si hay que redisenar algo, si hay que cambiar algo,
  adelante, no hay tema, pero algo que si quiero es que se haga bien, quiero tener buena performance en el cargado de la
  data, tecnicas de lazy loading o tecnicas para merjorar la ux del usuario, en general mi mensaje es que se tomen su
  tiempo, hagan las cosas bien. De nuevo, te recuerdo a ti, que sigas tu system design, a la hora de revisar con el mcp
  de playwhirte no solo revises funcionalidad, revisa la ui, que se vea bien, que no haya nada extrano, que el diseno
  coincida, etc.. revisa cada detalle, alguna duda?»
  Reading (propuesta N = artboard 0N): KPI cards from 02; area-chart style from 01 showing 02's «Vacantes cerradas por
  mes»; next to it 02's «Estado de entregas» without brown/odd green; 03's «¿Dónde está tu gente?»; 04's «¿Cumplimos lo
  prometido?», «¿Dónde se atora?», «¿Quién lo está logrando?» with professional titles; explanations only in popovers;
  every number/percentage drillable to the underlying records; origin last; performance (lazy loading) required.
- **L6** Answers: «Métricas = la combinación; dashboard aparte»; drill-down: «Página de detalle filtrada».
- **L7** `design/system.md` rules updated (1 professional titles, 7 help only in popovers, 9 delivery palette violet /
  light violet / grey / red, 16 every figure drillable to `/empresa/metricas/detalle`, 17 progressive loading).
  Artboards `07-metricas-combinada.html` (3365 px) and `08-detalle-indagacion.html` (900 px) written by a worker (first
  attempt stalled with no file; resumed once in small writes). Parent review of rendered screenshots: numbers consistent
  (98+22+6=126, Jorge Paredes 1 de 5 a tiempo on both pages); fixed 08 table header misalignment. Waiting for approval;
  after it, send the backend the data proposal (N1–N4 + paginated detail queries per figure, performance first).
- **L8** User approved 07/08: «Bien hermano, si me gusta, podemos avanzar con esto». Dashboard rules in `design/system.md`
  marked binding. Needs document `docs/product/stakeholder-metrics-v2-needs.md` written and sent to the backend session
  (01a1bbfc-ccc2, `peopleflow-vacantes`) by intercom with the user's verbatim performance message; waiting for its v2
  proposal. Next while waiting: company dashboard artboard (T11).
- **L9** Slice boundary: `feat/stakeholder-metrics` already holds ~12k authored lines unmerged. T10 (implementation)
  starts on its own branch after the user's merge decision on `feat/stakeholder-metrics`; design commits stop here.
- **L10** Backend proposal `docs/contracts/stakeholder-metrics-v2.md` (branch `feat/stakeholder-metrics-v2-backend`,
  `c56132e2`): shared 60 s snapshot per (company, period), sections summary/closures/compliance/pipeline/delays/origin/
  recruiters, one list route per kind (deliveries, vacancies, placements, reassignments, candidates, applications) with
  keyset + exact total, server CSV export, audit for lists with candidate names. User accepted DV1–DV6 as recommended
  («Acepto las 6 recomendaciones»). Frontend review approved with two additions sent to the backend: `facets.result`
  on deliveries and `facets.stage_kind`/stalled on candidates (detail tabs), and `applied_filters` with resolved names
  on every list (filter chips). Backend slices v2a sections, v2b lists, v2c pipeline; frontend follows them.
- **L11** Backend agreed contract v2 (`10474af9`): facets on every list kind (all enum values, zeros, ignoring only
  their own filter), `applied_filters` with resolved names (null name for foreign ids, no error). Backend started v2a.
- **L12** `09-dashboard-empresa.html` written by a worker (2238 px): Resumen strip as 07 (hero Candidatos en proceso),
  «Necesita atención» hero with tabs vencidas / vencen esta semana / detenidos (N4) + Pipeline por etapa (N3), Vacantes
  activas + Candidatos recientes, Postulaciones last. Parent review: smoothed the chart to a 7-day average and unified
  stage badges. Waiting for the user's review.
- **L13** Backend v2a ready on `feat/stakeholder-metrics-v2-backend` (`afebab8d`): summary with `previous_period`,
  `headline {current, previous}`, `on_time_by_month`; `closures`, `compliance`, `delays`, `origin` per §4; every response
  `definitions_version "v2"` + `as_of`. Note: summary `closed_by_month` keeps v1 shape (no `closed`); monthly `closed`
  only in `/closures`. Backend continues with v2b (detail lists).
- **L14** Merged into local `main` (no push; the user pushes): `feat/stakeholder-metrics-backend` (`472cf029`) then
  `feat/stakeholder-metrics`, no conflicts. Full checks on merged main: typecheck 0, lint 0 errors (12 pre-existing
  warnings), vitest 547 files / 10090 passed, 2 skipped; go build, go vet, go test all pass. Branch
  `feat/metrics-redesign` created from main for T10.
- **L15** User: «Bien hermano, retomando, me gusta la propuesta 09, adelante, y ya hice push de lo mergeado.» 09 approved;
  main pushed by the user. 09 needs data outside contract v2 (dashboard endpoint): needs doc written and sent (T12).
- **L16** Backend contract v2 §5 addendum: every list accepts optional `vacancy_id` (422 on malformed uuid, empty list +
  `applied_filters.vacancy.title` null for foreign/unknown ids, recorded on audited reads); arrives with v2b.
- **L17** Backend scheduled the dashboard contract after v2c (reuses pipeline snapshot and candidate lists). Leaning:
  owner sees the whole company, recruiter by default only vacancies with an open tramo (user decides); same formulas and
  snapshot behind recruiter-gated routes; «vencen esta semana» = Monday–Sunday, Mexico City time.
- **L18** T10a-A1 (`5db857e7`): v1 decoders accept the v2 header (`as_of`) and the v2 summary fields (`previous_period`,
  `headline`, `on_time_by_month`); new schemas and actions for closures, compliance, delays, origin and recruiters, each
  section loading on its own. Overdue rows decode optional `requester` + `attributed_to [person]` (backend choice, v2b).
  Merged to local main so the backend can merge v2 after the user pushes (main frontend decoded v1 with `.strict()`).
- **L19** T10a-A2 (`73d3cd48`): `drilldown.ts` (detail URL from the figure query, period and filters; off until T10b; 0 is
  never a link), `delta.ts` (N1 count/median/rate deltas with "lower is better"), `use-section.ts` (eager or lazy near
  the viewport, stale data kept dimmed, late answers dropped, retry). Slice boundary: the next commit starts slice 2
  (workspace rewrite + sections).
- **L20** T10a-A3: board workspace rewritten for v2 — `MetricsBoardHeader` (title, scope, freshness from `as_of` +
  applied period + definitions version, period control 30 días / 90 días / 12 meses / Personalizado, one «Filtros»
  popover with removable chips), `MetricsSection` shell (professional title, «Cómo se calcula» popover, own skeleton,
  failure + retry, stale numbers dimmed), section slots in `sections/*` (placeholders for B1/B2), `palette.ts`
  (rule 9 tones), `figure.tsx` (drillable figure). New period shortcut «12 meses» = twelve calendar months up to today
  (artboard said «Año»; twelve whole months keep twelve chart points inside the 366-day limit). Lazy sections load
  near the viewport; «Filtros» loads the recruiter names on open. Tests: company-metrics 99 passed; typecheck 0; eslint 0.
- **L21** Backend v2b ready (`81041985`): lists deliveries/vacancies/placements/reassignments with sort/order/limit/
  cursor (cursor v2; a v1 cursor is 400), total, facets, applied_filters, vacancy_id; `{kind}/export` CSV (placements
  audited per page and per export). Default order asc on title/candidate/reason, desc otherwise; a repeated value in a
  multi filter is 422; `requester_kind` alone echoes as `requester_kind`; `held` is boolean; CSV enum cells carry API
  codes. Strict routes only gain `requester`/`attributed_to` on `delays.overdue.top`. T10b unblocked.
- **L22** User pushed main (tolerant decoders on origin/main). Agreed with the backend: one merge of v2 after v2c and the
  verified board frontend. T10b writer launch refused while B1/B2 run (the `(empresa)` route glob was read as
  overlapping); relaunch T10b when B1/B2 finish.
- **L23** Browser review plan (explorer): real backend v2 branch on :8081 + frontend dev on :3000 + Cognito sign-in in
  the Playwright MCP browser; no test sessions exist and the fixture API has no metrics routes. User decisions: «Tú
  inicias sesión» (the user types the passwords) and «Empresa demo con datos» (a dev-only seed creating a separate demo
  company with realistic metrics data, Trust People Company untouched). Seed + demo accounts requested from the backend
  session, proposal first before touching the local DB or Cognito.
- **L24** Demo seed approved by the user: backend dev-only Go command `backend/cmd/devseed-metrics-demo` (apply/remove,
  refuses non-local DBs, deterministic ids, relative dates, integration test figure = list total), company «Demo
  Métricas». The user registers nocheblanca92+demo-owner/stakeholder/recruiter@gmail.com himself through normal app
  sign-up; `apply` then adds their memberships. Audit rows from the demo stay on `remove`. Backend builds it after v2c.
- **L25** T10b (`759391ee`): `/empresa/metricas/detalle` per artboard 08 — per-kind query validation, title from
  applied_filters, chips, facet status switch, sortable table (≤ 6 columns), cursor pagination, links by role (owner →
  vacancy board, stakeholder → stays in metrics), CSV export route handler (422 too large → readable message), audit
  catalog «Detalle de métricas exportado». Drill-down links switched on (`DETAIL_PAGE_ENABLED = true`).
  Backend §4.4 adjustment for v2c: a top vacancy opens `candidates?vacancy_id=V&stage_kind=new,screening,screening_ok,
  in_process,custom,retired`; applications `total` = sum of applications in the chosen channels.
- **L26** Backend v2 complete: v2c (`f6e61e59`) adds `pipeline` (§4.4), `candidates` (audited per page, facets
  stage_kind/stalled), `applications` (total = sum of chosen channels, facets channel), both exports, migration 00060
  (index). No strict route changed. Backend now builds the demo seed. T10c worker launched (pipeline section between
  Cumplimiento and Retrasos, candidates/applications detail kinds).
- **L27** Backend dashboard contract `docs/contracts/company-dashboard-v2.md` (backend branch): sections
  `/v2/me/company/dashboard/{summary,attention,pipeline,vacancies,recent,origin}` on the metrics engine behind the
  recruiter gate, `window=7|30|90`, lists with the metrics §5 grammar (not audited). Frontend review approved, no
  additions. User accepted DD1–DD6 («Acepto las 6 recomendaciones»): DD1 recruiter sees own vacancies, owner the
  company; DD2 one «en proceso» = active, not new, not placement (also changes metrics top_vacancies.in_process before
  the single merge); DD3 positions covered = active placement credits; DD4 dashboard lists not audited; DD5 no
  stakeholder dashboard; DD6 due this week = today to Sunday, Mexico City.
- **L28** Backend confirmed the DD2 query: top_vacancies opens `candidates?vacancy_id=V&stage_kind=screening,screening_ok,
  in_process,custom,retired` (replaces L25's). Backend order: seed → DD2 metrics adjustment → d2a → d2b; d2c after the
  frontend stops calling the old dashboard endpoint.
- **L29** T10c: pipeline section (between Cumplimiento and Retrasos, lazy; stages with candidates, median days, stalled;
  top vacancies opening the DD2 query) and detail kinds candidates (never links) and applications (summary uses the
  response total). Stage labels reuse the app's pipeline words (Nuevos, Screening, Screening OK, En proceso, Placement,
  «Columnas propias», «Columnas retiradas»). 212 tests green in company-metrics + metricas routes.
- **L30** Full suite after T10c (`ccdf1162`): 560 files passed, 1 failed — `features/jobs/requestPath.test.ts` (3 tests):
  the metrics CSV export broke the reviewed request-path boundary (fetch in `company-metrics/client.ts` and
  `detail/detail-page.tsx`, route handler outside `app/api`). Fix delegated: mirror the audit export
  (`app/api/company/metrics/[kind]/export/route.ts`, server-only `export-client.ts`, `detail/export-button.tsx`).
  Risk: item 2 (a route handler forwarding the session token) → independent verification after the fix.
- **L31** Backend demo seed ready (`c13cae15`, verified only against draft_test): company «Demo Métricas», 31 published
  vacancies, deliveries 12/6/5/3/5, 20 placements (1 did not hold), 6 reassignments, applications 68/37/19/16, pipeline
  with stalled and custom/retired, 7 recruiter cards (1 former member). Order proposed: backend migrates the local DB to
  00060 and starts the v2 API on :8081 → frontend dev on :3000 → user registers and signs in once with each demo account
  (no company) → backend runs `apply`.
- **L32** Export boundary fixed (95cf6b2f): route `app/api/company/metrics/[kind]/export/route.ts`,
  server-only `company-metrics/export-client.ts`, `detail/export-button.tsx`; old route removed; request-path guard
  allowlists extended for the new files only. 498 focused tests green, typecheck 0. Differs from the audit export: GET
  with a query (matches the upstream GET) instead of POST; cross-site blocked by Origin/Sec-Fetch-Site. Backend DD2
  applied (`cd8bcaae`), API on :8081 restarted.
- **L33** Independent verification of the export boundary: pass (no token leak, path injection, backend text echo or
  weakened guard), with one low-severity note — a GET export relies only on Origin/Sec-Fetch-Site against cross-site
  navigation. Hardened in `74f2617e`: the route answers only POST (like the audit export, so SameSite=Lax keeps the session
  cookie off cross-site requests) and «Exportar CSV» is a button posting to it. 93 focused tests green, typecheck 0.
- **L34** Full frontend suite on `feat/metrics-redesign` after the export hardening: 562 files / 10235 tests passed, 2
  skipped; lint 0 errors (12 pre-existing warnings); typecheck 0. Waiting for the user's demo account sign-ins.
