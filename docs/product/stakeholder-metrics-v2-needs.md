# Stakeholder metrics v2 — frontend needs

From the approved redesign of `/empresa/metricas` (artboards `design/dashboard-redesign/07-metricas-combinada.html` and
`08-detalle-indagacion.html`, feature `odd/tasks/dashboard-redesign.md`). This lists what the screen shows and what
each figure must open. The backend proposes the contract (v2); nothing here fixes endpoint shapes.

User's message for both sessions (verbatim): «se lo tomen con calma, no hay prisa, hay tiempo, si hay que redisenar
algo, si hay que cambiar algo, adelante, no hay tema, pero algo que si quiero es que se haga bien, quiero tener buena
performance en el cargado de la data, tecnicas de lazy loading o tecnicas para merjorar la ux del usuario».

## 1. The core new rule: every figure opens its records

User (verbatim): «todo lo que tenga porcentaje, lo mismo: que exista la posibilidad de indagar en los detalles de esos
porcentajes» · «"5 tarde".. bueno, eso le ayuda mucho pero cuales??».

Every count, percentage, bar segment, chart point and table number links to a filtered detail page
`/empresa/metricas/detalle` that lists the records behind it, with the same period and filters plus the figure's own
filter. The page needs: the total for the figure, a sortable list, server pagination, CSV export, and a link to each
vacancy or candidate. A `0` is not a link. Existing audit behaviour for audited detail reads stays as in v1.

Record kinds the detail page must list (columns shown in the artboard):

| Kind | Columns | Filters it must accept |
| --- | --- | --- |
| Deliveries | vacancy (id, title), client/area, recruiter, target date, delivered date, business days late, candidates delivered, status | period, recruiter, client/area, status (on time / late / overdue / pending / no target), days-late bucket |
| Vacancies | vacancy, client/area, responsible recruiter, opened, closed, close reason, business days to close, closing target status | period, recruiter, client/area, closed month, close reason, closing target status |
| Placements | candidate, vacancy, recruiter(s), credit type, held / did not hold, date | period, recruiter, client/area, held |
| Reassignments | vacancy, from, to, reason, date | period, recruiter (received / lost), client/area, reason |
| Candidates in stage | candidate, vacancy, stage, days in stage, stalled | stage, stalled only, recruiter, client/area |

## 2. Figures on the board and their drill-down

✓ = in v1 today · **N#** = new data.

| Section | Figure | Data | Opens |
| --- | --- | --- | --- |
| Resumen | Entregas a tiempo 78 % (98 de 126) + sparkline | ✓ rate · **N1** delta vs previous period · **N2** monthly series | Deliveries, status on time / late / overdue |
| Resumen | Vacantes asignadas, Mediana para cerrar, Placements, Reasignaciones | ✓ values · **N1** delta each | Vacancies · closed vacancies sorted by days to close · Placements · Reassignments |
| Cierres y entregas | Vacantes cerradas por mes: cerradas and cubiertas per month (12) | ✓ closed per month · **new**: filled per month if not in v1 | Vacancies closed in that month (filled) |
| Cierres y entregas | Estado de entregas: on time / late / overdue / pending / no target | ✓ | Deliveries by status |
| Cumplimiento | Late deliveries by business days late: 1–2, 3–5, more than 5 | **new** buckets | Deliveries late in bucket |
| Cumplimiento | On-time rate per month, company-wide (12) | **N2** | Deliveries of that month |
| Pipeline por etapa | Per stage: candidates, median days in stage, stalled count | **N3** (stalled threshold to be defined with the user) | Candidates in stage / stalled |
| Pipeline por etapa | Top 5 open vacancies by candidates in process | **new** ranking | Vacancy pipeline |
| Retrasos | Closing target: on time / late / no target | ✓ | Vacancies by closing target status |
| Retrasos | Overdue deliveries per vacancy (top 4 + total) with days overdue | **N4** list (count exists) | Deliveries overdue |
| Retrasos | Reassignments by reason (5) | ✓ | Reassignments by reason |
| Desempeño por reclutador | Per recruiter: assigned, on-time rate N de M, placements, conversion N de M | ✓ (card) | Deliveries / vacancies / placements of that recruiter, by status |
| Origen | Applications by channel | ✓ | Applications by channel (or none if not worth it — tell us) |

## 3. Loading and performance (rule 17 in `design/system.md`)

- The header and the Resumen strip must be fast and come first; each lower section loads on its own and the sections
  below the fold load when they approach the viewport. So the board wants independently fetchable pieces (summary,
  closures + delivery state, compliance, pipeline, delays, recruiters, origin) rather than one heavy payload — or tell us
  why one payload is cheaper.
- Changing the period keeps the old numbers dimmed until the new ones arrive; responses must be cancel-safe.
- Detail lists paginate on the server (cursor or keyset), sortable on the listed columns, with an exact total.
- Previous-period comparison (N1) should not double the latency of the summary.
- Same filter semantics everywhere (366-day max, Mexico City time, recruiter, client/area) so a figure and its detail
  list always agree: the detail total equals the figure.

## 4. Open questions for the backend proposal

1. One generic detail endpoint by kind, or one per kind?
2. Stalled threshold for N3: fixed (e.g. 7 business days) or per stage? (user decision; propose a default)
3. CSV export: server-generated or client from the paginated API?
4. Which detail reads are audited for stakeholders (v1 audits the delivery detail).
