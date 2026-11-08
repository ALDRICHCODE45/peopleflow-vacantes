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
