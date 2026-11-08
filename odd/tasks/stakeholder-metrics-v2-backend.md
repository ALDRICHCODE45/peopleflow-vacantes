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
- [x] T4 (S1, S3, S4, S5) Slice v2b: sortable keyset lists with total, facets, applied filters, vacancy_id, deliveries, placements (audited), CSV export, overdue top requester/attributed_to — commit: v2b commit.
- [x] T5 (S1–S5) Slice v2c: pipeline section, candidates (audited), applications, exports, participation index 00060 — commit: v2c commit.
- [ ] T8 Dev-only demo seed (`cmd/devseed-metrics-demo`) for the browser review, approved (L11), after T5.
- [ ] T7 Propose company dashboard v2 contract (frontend needs `docs/product/company-dashboard-v2-needs.md`, L5), after T5.
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
- **L5** Frontend session (2026-11-08): «Otro pedido, sin apuro (va después de v2b/v2c o cuando te cierre mejor): el
  usuario aprobó el rediseño del dashboard de empresa (/empresa/dashboard …). Necesita datos que hoy no da GET
  /v2/me/company/dashboard: deltas vs ventana anterior, serie diaria de candidatos en proceso, «Necesita atención»
  (entregas vencidas, que vencen esta semana y candidatos detenidos, top 5 + total cada una), pipeline por etapa (mismo
  criterio que metrics pipeline, DV1), posiciones por vacante, y que cada cifra abra sus registros.» Open questions:
  scope per role (recruiter whole company or own vacancies), reuse of metrics snapshot/lists by recruiters (not metrics
  viewers), «vencen esta semana» Mon–Sun vs next 7 days. Main pushed with v1 merged (frontend + backend).
- **L6** Frontend session (2026-11-08): «No mergees feat/stakeholder-metrics-v2-backend a main hasta que te avise que el
  frontend tolerante está en main» (v1 frontend decodes with zod `.strict()`; new keys break it). Confirmed every
  metrics response carries `as_of` since v2a.
- **L7** Frontend tolerant decoders in its local main (5db857e7, push pending). Lists, list rows and per-vacancy
  details ignore unknown keys; strict stay: summary, closures/compliance/delays/origin, recruiter cards and
  recruiters/{id} — «Si v2b o v2c agregan algo en esas rutas, avisame antes de mergear». `delays.overdue.top`
  `requester`/`attributed_to` (§4.5 addition) already decoded as optional.
- **L8** v2b implemented by a worker, independently verified (audit of personal data, cross-company names): pass, no
  blocking defects; 61 `^TestMetrics|^TestAudit` integration tests, race x3, vet green. Approved edits outside the
  metrics surfaces: httpjson errors.go dispatch line, audit catalog pins, audit-log-v1 annex row, audit type count
  67→68. Contract §5 records the worker's choices (default order, repeated multi-value, requester_kind echo, cursor v2).
  Low notes: previous-period drill-downs asserted indirectly, mid-stream CSV abort untested, full page walk only on
  deliveries, unsigned cursor (as v1, company-bound).
- **L9** Frontend session (2026-11-08): main pushed with the v2-tolerant frontend. «Te propongo no mergear por partes:
  hacemos un solo merge cuando termines v2c y el frontend del tablero nuevo esté verificado. Los merges los hago yo y
  el push lo hace el usuario.»
- **L10** Frontend session (2026-11-08), user request: «un script de seed **solo para desarrollo** (nunca en migraciones
  de producción …, idempotente y reversible) que cree una **empresa demo aparte** en la base local
  `peopleflow_vacancies`, sin tocar Trust People Company … Que los números cuadren entre secciones y listas.» «el
  usuario prefiere iniciar sesión él mismo en el navegador de revisión … proponé cómo … Avisame la propuesta antes de
  correr nada sobre la base local o Cognito.» Proposal sent: Go dev-only cmd with apply/remove, local-only guard,
  deterministic ids, dates relative to today, integration test figure == list total over the seed; accounts signed up
  by the user (nocheblanca92+demo-owner/stakeholder/recruiter), memberships attached by email; admin-create-user only
  with explicit ok.
- **L11** User approved via the frontend session: «tu propuesta tal cual: cmd dev-only `devseed-metrics-demo`
  (apply/remove, guardas de base local, ids deterministas, test de integración figura = total de lista). Las 3 cuentas
  … las registra él en la app con el registro normal, sin admin-create-user. Las filas de auditoría que genere la demo
  se quedan al hacer remove (no usar el bypass). Hacelo después de v2c». Environment: frontend local uses the Cognito
  dev pool, API at http://127.0.0.1:8081, database `peopleflow_vacancies`. Notify the frontend when the seed is ready;
  the user registers the 3 accounts before `apply`. Implementation note: remove must cope with audit rows that keep
  the demo company id (check FKs from audit_events before deleting the company).
- **L12** v2c implemented by a worker, independently verified (audited candidate names, generic cache refactor): pass,
  no defects; 69 `^TestMetrics|^TestAudit` + `TestMigration00060` integration tests, race x3, vet green. Contract §4.4
  fixed: the top-vacancy drill-down is `candidates?vacancy_id=V&stage_kind=new,screening,screening_ok,in_process,custom,retired`
  (placement excluded, as the figure); paused vacancies are open; entry falls back to `created_at`. Low notes:
  cross-company test has no competing pipeline data; no EXPLAIN of the new index.
