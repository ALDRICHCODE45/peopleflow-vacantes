# Stakeholder metrics v2 (internal, employer-only)

Status: **draft (2026-11-08)**, proposed by the backend session for frontend review. Nothing is built until the
frontend session and the user agree on it. It builds on `stakeholder-metrics-v1.md` (agreed, slices 3a–3c, branch
`feat/stakeholder-metrics-backend`): every v1 definition, gate, filter, shape rule and audit rule stays unless this
document changes it explicitly. Frontend needs: `docs/product/stakeholder-metrics-v2-needs.md` in the frontend repo
(artboards `design/dashboard-redesign/07-metricas-combinada.html` and `08-detalle-indagacion.html`). Backend tracking:
`odd/tasks/stakeholder-metrics-v2-backend.md`.

User (verbatim, for both sessions): «se lo tomen con calma, no hay prisa, hay tiempo, si hay que redisenar algo, si
hay que cambiar algo, adelante, no hay tema, pero algo que si quiero es que se haga bien, quiero tener buena
performance en el cargado de la data, tecnicas de lazy loading o tecnicas para merjorar la ux del usuario».

## 0. What changes, in one screen

1. **Board in sections.** The board loads as independent sections (`summary` first, the rest lazily), all computed
   from one shared **metrics snapshot** per company and period, so seven requests cost about one database load.
2. **Every figure opens its records.** One list route per record kind, sortable, keyset-paginated, with an exact
   `total` taken from the same snapshot as the figure, so the list total equals the figure by construction.
3. **New data:** previous-period comparison (N1), company on-time series (N2), pipeline health per stage (N3),
   overdue deliveries per vacancy (N4), late-days buckets, closed and filled per month.
4. **Server CSV export** per kind, streaming, same filters and order as the list.
5. **Additive.** v1 routes and fields keep working; `definitions_version` becomes `"v2"`.

## 1. Why the current read path has to change first

Facts from the v1 code (`internal/features/metrics`):

- Every route (`summary`, `recruiters`, `recruiters/{id}`, `vacancies`, `reassignments`) calls `Store.Load`: one
  REPEATABLE READ snapshot, ~10 queries over every in-scope vacancy's whole history, then the formulas in Go.
- Lists are sorted and cut in memory after that load.

A board split into seven sections plus a detail page on top of this would mean seven to nine full loads per screen,
and a detail list that reloads (and may see different facts than the figure the user clicked). Splitting the payload
only pays off if the pieces share the load. Hence §2.

## 2. Metrics snapshot (server-side, shared by sections and lists)

- **Key:** `(company_id, from, to)`. Recruiter and requester filters are applied in Go over the snapshot, so a
  board, its filtered variants, the recruiter cards and every detail list of the same period reuse one load.
- **Content:** the v1 fact set (vacancies, tramos, functions, closes, credits, reassignments, origin, delivery
  entries, people) plus, for the pipeline (§4.4), the current participations of open vacancies with their
  current-stage entry time. The pipeline part is a separate entry keyed `(company_id)` because it does not depend on
  the period.
- **`as_of`:** the instant the snapshot was loaded. It is the "now" of every now-dependent rule (overdue vs pending,
  open tramo clipping, days in stage). Every response carries `"as_of"`.
- **Lifetime:** 60 seconds, in-process LRU (bounded, e.g. 128 entries), concurrent misses for one key collapse into
  one load (singleflight). The shared load runs on a context detached from the first caller with its own timeout
  (10 s), so a cancelled request never fails the others.
- **Isolation:** the key starts with the caller's company id from the session, after `requireMetricsViewer`. Owners
  and stakeholders of one company see the same data, so sharing between them is correct. Nothing crosses companies.
- **Consistency:** a list cursor carries the snapshot's `as_of`. If that snapshot already expired, the next page is
  served from a fresh one and its `as_of` changes; keyset cursors never duplicate or skip unchanged rows. The
  frontend may show «Datos actualizados» when `as_of` moves.
- **Staleness:** a write is visible in metrics at most 60 s later. Metrics stay `Cache-Control: no-store` for the
  browser; the frontend's own query cache handles revisits.
- **Audit unaffected:** audited reads (§6) write their audit row in their own transaction **before** serving from
  the snapshot, fail-closed; a cache hit never skips the audit.
- **Indexes to add with the slice:** `process_participations (process_id, created_at)` (origin and applications by
  vacancy; today only a global `(created_at, origin_channel)` exists). The current-stage lookup uses the existing
  `participation_history_order_idx (participation_id, created_at, id)`.
- **Budgets** (realistic seed: 300 vacancies, 10k participations): cold `summary` p95 ≤ 400 ms including the
  previous-period load; warm section or list page p95 ≤ 50 ms. Measured in the slice with a seeded benchmark, not
  assumed.

## 3. Common rules (unchanged unless stated)

- Same prefix `GET /v2/me/company/metrics`, same gate (owner, stakeholder), same common filters (`from`, `to` ≤ 366
  days, `recruiter_id`, `requester_kind`, `requester_id`), same strict parser (422 `invalid_filter`), same shape rules
  (counts never null, medians null without sample, rates `{value, numerator, denominator}`, people, requester).
- Every response: `definitions_version: "v2"`, `period`, `as_of`.
- **Drill-down rule:** each figure in §4 names the list (§5) and the exact query that reproduces it. The frontend
  builds the detail URL from the figure's query; the list's `total` equals the figure for the same snapshot.
- **Multi-value filters** use one comma-separated parameter (`result=on_time,late`); repeating a parameter is still
  422 `duplicate`.

### 3.1 Definition changes

- **V1 Closed counts distinct vacancies everywhere.** v1 counted close *events* in `summary.vacancies.closed` and
  distinct vacancies in `closed_by_month` (v1 §3.7.4). A figure must equal its list and a list has one row per
  vacancy, so v2 counts **distinct vacancies with ≥ 1 close in the period**, grouped by the reason of their **last**
  close in the period. The median to close uses each vacancy's **first** `filled` close in the period. Only a close →
  reopen → close inside one period changes a number. (Decision DV2.)
- **V2 Previous period** (N1) = the same number of days immediately before `from`
  (`[from − n, from − 1]`, `n = to − from + 1`), same filters, computed **with what is known today** (`as_of`): a
  delivery that was pending at the end of that window and was fulfilled later counts as fulfilled. The facts are not
  replayed as of the old date (they are current-state rows). This keeps the previous figure reproducible by opening
  its list with the shifted period. (Decision DV3.)

## 4. Board sections

Each section is its own route with the common filters. The frontend loads `summary` first and the others when they
approach the viewport; all hit the same snapshot.

### 4.1 `GET …/metrics/summary` (header strip) — extended

All v1 fields stay. New fields:

```json
{
  "definitions_version": "v2",
  "period": { "from": "2026-08-01", "to": "2026-10-31", "time_zone": "America/Mexico_City" },
  "as_of": "2026-11-08T19:40:12Z",
  "previous_period": { "from": "2026-05-02", "to": "2026-07-31" },
  "headline": {
    "on_time_rate": { "current": { "value": 0.7778, "numerator": 98, "denominator": 126 },
                      "previous": { "value": 0.7, "numerator": 70, "denominator": 100 } },
    "assigned": { "current": 42, "previous": 38 },
    "median_business_days_to_close": { "current": 23, "previous": 27 },
    "placements": { "current": 25, "previous": 19 },
    "reassignments": { "current": 6, "previous": 9 }
  },
  "on_time_by_month": [ { "month": "2026-08", "rate": { "value": 0.8, "numerator": 8, "denominator": 10 } } ]
}
```

- `headline` is N1: the frontend computes the delta and decides the arrow and colour (lower is better for days to
  close and reassignments). The previous snapshot loads **in parallel** with the current one, so the summary latency
  is the slower of the two loads, not their sum.
- `on_time_by_month` is N2 (also the sparkline): dense over the months the period touches, deliveries counted by the
  month of `commitment_date` (D12), same rate as v1 2.3. A 12-point sparkline means a 12-month period; the series
  never reaches outside the period, so each point's list stays inside the figure's period.

| Figure | Opens |
| --- | --- |
| on-time rate | `deliveries?result=on_time,late,overdue` |
| on-time point for month M | `deliveries?result=on_time,late,overdue&commitment_month=M` |
| assigned | `vacancies?scope=assigned` |
| median to close | `vacancies?scope=closed&close_reason=filled&sort=business_days_to_close` |
| placements | `placements` |
| reassignments | `reassignments` |
| any previous value | the same list with `from`/`to` of `previous_period` |

### 4.2 `GET …/metrics/closures` (Cierres y entregas)

```json
{ "closed_by_month": [ { "month": "2026-08", "closed": 6, "filled": 5, "cancelled": 1, "other": 0,
                         "no_reason": 0 } ],
  "delivery_status": { "on_time": 20, "late": 7, "overdue": 3, "pending": 9, "not_configured": 3 } }
```

- `closed` = distinct vacancies closed that month (any reason); the reasons split it by the last close in the month,
  so they add up to `closed`. «Cubiertas» = `filled`.
- Opens: month → `vacancies?scope=closed&closed_month=M` (`&close_reason=filled` for «cubiertas»); status →
  `deliveries?result=X`.

### 4.3 `GET …/metrics/compliance` (Cumplimiento)

```json
{ "late_buckets": { "up_to_2": 3, "from_3_to_5": 2, "over_5": 2 },
  "on_time_by_month": [ "same as summary" ] }
```

- Buckets split `late` by `business_days_late`: `up_to_2` (0–2; a delivery can be late by 0 business days when the
  commitment day was followed by a weekend or holiday), `from_3_to_5`, `over_5`. They add up to `late`.
- Opens: `deliveries?result=late&late_bucket=B`; month as in §4.1.

### 4.4 `GET …/metrics/pipeline` (Pipeline por etapa) — N3, current state

The pipeline is a picture of **now**, not of the period: `from`/`to` are validated and echoed but do not filter.
Recruiter and requester filters apply. Universe: open vacancies (published, not closed and not finished at `as_of`);
with `recruiter_id`, the vacancies where that user has an open tramo.

```json
{ "stalled_threshold_business_days": 7,
  "stages": [ { "kind": "new", "candidates": 41, "median_business_days_in_stage": 2, "stalled": 3 },
              { "kind": "custom", "candidates": 4, "median_business_days_in_stage": 5, "stalled": 1 },
              { "kind": "placement", "candidates": 2, "median_business_days_in_stage": 1, "stalled": 0 } ],
  "top_vacancies": [ { "vacancy": { "draft_id": "…", "title": "…" }, "requester": null,
                       "responsible": { "user_id": "…", "name": "…", "former_member": false },
                       "in_process": 18 } ] }
```

- **Stages** are grouped by kind across vacancies, in the fixed order `new, screening, screening_ok, in_process,
  custom, placement`; every vacancy's custom stages (up to 3 each, free names) fold into `custom`; a participation
  sitting in a stage that is no longer in its vacancy's configuration counts under `retired` (omitted when 0).
  Discarded participations (exit stage) are not counted.
- **Days in stage:** business days from the current-stage entry to `as_of`. The entry is the latest
  `participation_stage_history` row of kind `intake | move | recovery` into the participation's current `stage_id`;
  `substate` and `not_applicable` rows never reset it.
- **Stalled:** days in stage ≥ the threshold (DV1: 7 business days, same for every stage), never in `placement`.
- **Top vacancies:** the 5 open vacancies with most active participations outside `placement` and the exit stage;
  ties by title.
- Opens: stage → `candidates?stage_kind=K` (`&stalled=true` for stalled); top vacancy →
  `candidates?vacancy_id=V`.

### 4.5 `GET …/metrics/delays` (Retrasos)

```json
{ "closing_target": { "on_time": 0, "late": 0, "no_target": 18 },
  "overdue": { "total": 3,
               "top": [ { "vacancy": { "draft_id": "…", "title": "…" }, "commitment_date": "2026-10-20",
                          "business_days_overdue": 13, "delivered": 2, "target": 5 } ] },
  "reassignments_by_reason": { "workload": 2, "recruiter_departure": 3, "performance": 0, "client_request": 1,
                               "other": 0 } }
```

- `overdue.top` (N4): up to 4 rows, most business days overdue first (commitment date to `as_of`), ties by title.
- Opens: closing target → `vacancies?scope=closed&close_reason=filled&closing_target=X`; overdue →
  `deliveries?result=overdue&sort=business_days_overdue&order=desc`; reason →
  `reassignments?reason=R`.

### 4.6 `GET …/metrics/origin` and `GET …/metrics/recruiters`

- `origin`: `{ "by_channel": { "portal", "careers_site", "manual", "unknown" } }` (v1 2.5). Opens
  `applications?channel=C` (§5.6, by vacancy, no candidate names — DV4).
- `recruiters`: unchanged v1 cards and `recruiters/{userId}`. Card figures open:
  - on-time N de M → `deliveries?attributed_to=U&result=on_time,late,overdue` (N: `result=on_time`);
  - assigned → `vacancies?scope=assigned&recruiter_id=U`;
  - placements → `placements?recipient=U`;
  - conversion N de M → `vacancies?scope=closed_assigned&recruiter_id=U` (N: `&credited_to=U`);
  - reassignments received / lost → `reassignments?recruiter_id=U&direction=received|lost`.

`summary` keeps its v1 aggregate fields, so a frontend still on v1 is unaffected; the board v2 reads the strip from
`summary` and the rest from the sections.

## 5. Detail lists (one route per kind)

Common to every list:

- Query: common filters + the kind's filters + `sort`, `order` (`asc | desc`), `limit` (1–100, default 50),
  `cursor`.
- Response: `{ "definitions_version", "period", "as_of", "total", "items": [...], "next_cursor" }`. `total` is the
  exact count for the filters (not the page).
- Keyset over `(sort value, id)`; nulls last in both orders. The cursor binds company, route, filters, sort and order
  (v1 binds no sort); any mismatch is 400 `invalid_cursor`. An unknown `sort` value is 422 `invalid_filter`
  (`sort: invalid`).
- Links: every row carries ids (`draft_id`, candidate `id`) and nothing else about routing (§7).
- `0` figures are not links (frontend rule); a list with a 0 total still answers 200 with `items: []`.

### 5.1 `GET …/metrics/deliveries` — new, not audited

One row per vacancy in the delivery universe of the period (v1 2.3, D12/P1).

- Row: `vacancy {draft_id, title}`, `requester`, `attributed_to [person]` (responsible, or every member in `shared`,
  at the target moment; at the end of the commitment day for overdue), `commitment_date`,
  `original_commitment_date`, `renegotiations`, `target_reached_at` (delivered date), `result`,
  `business_days_late` (late only), `business_days_overdue` (overdue only), `delivered`, `target`.
- Filters: `result` (multi: `on_time, late, overdue, pending, not_configured`), `late_bucket`, `commitment_month`
  (`YYYY-MM`), `attributed_to` (user id), plus common.
- Sort: `commitment_date` (default, desc), `business_days_late`, `business_days_overdue`, `target_reached_at`,
  `delivered`, `title`.
- The per-vacancy candidates stay in v1 `vacancies/{draftId}/deliveries` (audited).

### 5.2 `GET …/metrics/vacancies` — extended

- New row fields: `opened_at` (first publication; v1 `first_published_at` stays), `last_close {date, reason}` in the
  period (null if none), `business_days_to_close` (first filled close in the period, V1), `closing_target`
  (`on_time | late | no_target`, null when not closed filled).
- New filters: `scope` (`activity` default = v1 behaviour, `assigned`, `closed`, `closed_assigned`), `closed_month`,
  `close_reason` (multi: `filled, cancelled, other, no_reason`; replaces v1 `outcome` for closed rows, `outcome` stays
  accepted), `closing_target`, `credited_to` (user id: a credit for that user on the vacancy, any hire date — v1 2.4
  conversion numerator).
- Sort: `opened_at` (default, desc), `last_close_date`, `business_days_to_close`, `title`.

### 5.3 `GET …/metrics/placements` — new, **audited**

- Row: `credit_id`, `candidate {id, full_name}` (company's name view), `vacancy {draft_id, title}`, `requester`,
  `recipients [{person, kind}]`, `status` (`active | did_not_hold`), `hired_at`.
- Filters: `recipient` (user id), `held` (`true` = active, `false` = did_not_hold), plus common.
- Sort: `hired_at` (default, desc), `title`, `candidate`.

### 5.4 `GET …/metrics/reassignments` — extended

- New filters: `direction` (`received | lost`, needs `recruiter_id`, else 422 `invalid_filter` `recruiter_id:
  required`), `reason` (multi).
- Sort: `performed_at` (default, desc), `reason`, `title`.

### 5.5 `GET …/metrics/candidates` — new, **audited**, current state

- Row: `participation_id`, `candidate {id, full_name}`, `vacancy {draft_id, title}`, `stage {kind, name}`,
  `business_days_in_stage`, `stalled`, `entered_stage_at`.
- Filters: `stage_kind` (multi, kinds of §4.4 incl. `custom`, `retired`), `stalled` (`true`), `vacancy_id`, plus
  common (period echoed, not applied, as §4.4).
- Sort: `business_days_in_stage` (default, desc), `candidate`, `title`, `entered_stage_at`.

### 5.6 `GET …/metrics/applications` — new, not audited (DV4)

One row per vacancy with applications created in the period.

- Row: `vacancy {draft_id, title}`, `requester`, `portal`, `careers_site`, `manual`, `unknown`, `total`.
- Filter: `channel` (multi). `total` of the response = the sum of applications in the selected channels (the figure);
  `items` are the vacancies with ≥ 1 of them.
- Sort: `total` (default, desc), `title`.

## 6. Audit (answers question 4)

- Audited: lists that return candidate names — `placements` (§5.3), `candidates` (§5.5) — and the v1 per-vacancy
  `deliveries` / `placements` reads. Not audited: `deliveries` (§5.1), `vacancies`, `reassignments`, `applications`
  and every section (no personal data).
- One `MetricsDetailViewed` row per successful audited **page** read, metadata `report` (`deliveries | placements |
  candidates`), `vacancy_id` (now optional: set for per-vacancy reads and when the list is filtered by vacancy),
  `filters` (the normalized query, without cursor). Written in its own transaction before the response, fail-closed
  (500, nothing served).
- Exports of audited kinds write one new `MetricsDetailExported` row (`sensitive_read`; metadata `report`,
  `filters`, `row_count`), before streaming, fail-closed. Catalog and the owner's audit screen labels get the new
  event and keys.

## 7. Links for a stakeholder

The stakeholder still reaches no board, vacancy or candidate profile route (v1 D3). Rows carry ids only; the frontend
links them by role: owner → the real vacancy board or candidate profile; stakeholder → stays inside metrics (a vacancy
opens `vacancies/{draftId}/deliveries|placements` and the lists filtered by `vacancy_id`; a candidate is not a link).
Opening read-only boards to stakeholders remains a separate later slice. (Decision DV5.)

## 8. CSV export (answers question 3)

`GET …/metrics/{kind}/export` for every list kind of §5, same filters, `sort` and `order`, no `cursor`/`limit`.

- **Server-generated, streaming**, from the snapshot: UTF-8 BOM, Spanish column headers matching the table, one
  line per row, ISO dates, the audit export's formula guard on every cell, `Content-Disposition` attachment
  `metricas-<kind>-<from>-<to>.csv`.
- Limit 50,000 rows like the audit export; above it 422 `metrics_export_too_large` with `row_count` and `limit`
  (same body as `audit_export_too_large`), nothing written.
- Why server and not the client paging the API: one request instead of up to 500 page requests, exact same order and
  filters as the screen, the existing BOM/formula-guard code, and one audit row per export instead of one per page.

## 9. Answers to the frontend's open questions

1. **Generic or per kind?** One route per kind (§5) with one shared grammar (common filters, `sort`, `order`,
   `limit`, `cursor`, `total`). Each kind has its own filters, sort keys, row shape and audit rule; the strict parser
   validates them per route, and typed responses stay simple. The frontend can still keep one generic detail page
   that maps `kind → route`.
2. **Stalled threshold?** Proposal DV1: fixed 7 business days for every stage, `placement` excluded, returned in the
   response so the UI shows it. Per-stage or per-company thresholds can come later without changing shapes.
3. **CSV?** Server-generated streaming export per kind (§8).
4. **Audited reads?** Lists with candidate names: placements and candidates in stage, plus v1 per-vacancy detail;
   one row per page read and one per export (§6).

## 10. Slices (after agreement)

1. **v2a Snapshot and sections:** snapshot cache (§2), definition changes (§3.1), `summary` extension (N1, N2),
   `closures`, `compliance`, `delays`, `origin`; benchmark against the budgets.
2. **v2b Detail lists:** sort and keyset for every list, `total`, `deliveries`, extended `vacancies` and
   `reassignments`, audited `placements`, CSV export, audit catalog changes.
3. **v2c Pipeline:** pipeline snapshot, `pipeline` section, audited `candidates`, `applications`, participation
   index.

Each slice ships with integration tests through the production router that assert, per figure, that the list
`total` for the figure's drill-down query equals the figure.

## Decisions (proposed, pending)

1. **DV1 Stalled threshold.** Recommendation: 7 business days, same for every stage, placement excluded.
   Alternative: a threshold per stage kind (more settings, no clear default per stage yet).
2. **DV2 Closed counts distinct vacancies.** Recommendation: distinct vacancies everywhere, reason of the last close,
   median from the first filled close, so every figure equals its list. Alternative: keep counting events and add a
   per-close list kind (two notions of «cerradas» on one screen).
3. **DV3 Previous period.** Recommendation: the same length immediately before, computed with today's knowledge.
   Alternative: same months of the previous year (seasonality, but needs ≥ 2 years of data).
4. **DV4 Origin drill-down.** Recommendation: applications per vacancy and channel, no candidate list (high volume,
   little value for a stakeholder, no personal data, no audit). Alternative: an audited list of applicants.
5. **DV5 Stakeholder links.** Recommendation: stakeholder links stay inside metrics; owners link to boards and
   profiles. Alternative: read-only boards for stakeholders (separate feature, ~60 routes).
6. **DV6 Snapshot lifetime.** Recommendation: 60 s, `as_of` in every response. Alternative: no cache (every section
   and page reloads; simpler, roughly 7× the database work per board view, and lists may disagree with figures).
