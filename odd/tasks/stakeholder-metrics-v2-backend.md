# Stakeholder metrics v2 — backend

Backend side of the `/empresa/metricas` redesign (frontend `odd/tasks/dashboard-redesign.md`). Contract
`docs/contracts/stakeholder-metrics-v2.md`, branch `feat/stakeholder-metrics-v2-backend` (from
`feat/stakeholder-metrics-backend`, unmerged). Coordinated with the frontend session over intercom.

## Specs

- **S1** Frontend needs (`docs/product/stakeholder-metrics-v2-needs.md`, frontend repo): «Every count, percentage,
  bar segment, chart point and table number links to a filtered detail page `/empresa/metricas/detalle` that lists
  the records behind it, with the same period and filters plus the figure's own filter. The page needs: the total for
  the figure, a sortable list, server pagination, CSV export, and a link to each vacancy or candidate.»
- **S2** New data N1 delta vs previous period, N2 company monthly on-time series, N3 pipeline per stage (candidates,
  median days in stage, stalled), N4 overdue deliveries per vacancy; late-days buckets 1–2 / 3–5 / more than 5;
  closed and filled per month.
- **S3** «The header and the Resumen strip must be fast and come first; each lower section loads on its own»;
  «responses must be cancel-safe»; «Detail lists paginate on the server (cursor or keyset), sortable on the listed
  columns, with an exact total»; «Previous-period comparison (N1) should not double the latency of the summary»; «the
  detail total equals the figure».
- **S5** Frontend review: «Pido que `deliveries` devuelva `facets.result` = conteos por result con los mismos filtros
  ignorando el propio `result` (mismo snapshot, así suman igual), y que `candidates` devuelva `facets.stage_kind` (y
  el conteo de stalled) con la misma regla»; «pido `applied_filters` en la respuesta de cada lista con las
  personas/solicitantes resueltos».
- **S4** Answer the four open questions: generic vs per-kind detail endpoint; stalled threshold; CSV server vs
  client; which detail reads are audited.

## Tasks

- [x] T1 (S1–S4) Draft contract v2 and send it to the frontend session for review — commit: c56132e2.
- [x] T2 (S1–S5) Agree contract (frontend review + user decisions DV1–DV6) — commit: facets/applied filters commit.
- [x] T3 (S2, S3) Slice v2a: snapshot cache, definition changes, summary N1/N2, closures, compliance, delays, origin — commit: v2a commit.
- [ ] T4 Slice v2b: sortable keyset lists with total, deliveries, placements (audited), CSV export.
- [ ] T5 Slice v2c: pipeline section, candidates (audited), applications, participation index.
- [ ] T6 (S3) Seeded benchmark of the §2 budgets (cold summary p95 ≤ 400 ms, warm ≤ 50 ms), after T5.

## Log

- **L1** Frontend session (2026-11-08, intercom): «El usuario aprobó el rediseño de /empresa/metricas (combinado +
  página de detalle filtrada). Te paso las necesidades de datos para que propongas el contrato stakeholder-metrics v2
  (vos definís endpoints y formas; el documento adjunto solo dice qué muestra cada cifra y qué registros debe abrir).»
  User (verbatim): «se lo tomen con calma, no hay prisa, hay tiempo, si hay que redisenar algo, si hay que cambiar
  algo, adelante, no hay tema, pero algo que si quiero es que se haga bien, quiero tener buena performance en el
  cargado de la data, tecnicas de lazy loading o tecnicas para merjorar la ux del usuario».
- **L2** Exploration: every v1 route runs a full `Store.Load` (~10 queries, whole history of in-scope vacancies) and
  paginates in memory; stage history exists (`participation_stage_history`, current-stage entry derivable); the
  audit export is the only CSV export (BOM, formula guard, 50k limit); the v1 cursor binds no sort. Hence the shared
  snapshot (§2) and the sort-bound keyset (§5).
- **L3** Frontend session (2026-11-08): «aprobado, muy buena propuesta … El usuario aceptó DV1–DV6 tal como las
  recomendaste (7 días hábiles fijos sin placement; cerradas = vacantes distintas; periodo anterior del mismo largo con
  el conocimiento de hoy; origen por vacante y canal sin personas; links del stakeholder dentro de métricas; snapshot
  de 60 s con as_of).» Two additions applied in §5: facets per list (own filter ignored) and `applied_filters` with
  resolved names. Frontend builds on `feat/metrics-redesign` (from main) following the backend slices; it merges v1
  (backend then frontend) into main.
- **L4** v2a implemented by a worker, independently verified (concurrency): pass, no blocking defects. Unit, race x5,
  15 `^TestMetrics` integration tests, vet, archguard green. Decided: median/closing target/by_requester.filled use
  vacancies whose last close is filled, at their first filled close (written into §3.1). Moved: participation index to
  v2c (it serves applications), the seeded benchmark to T6. Note: `WithClock` swaps the clock without a lock (tests
  only).
