# Company metrics read API

Contracts: `docs/contracts/stakeholder-metrics-v1.md` §2 (definitions) and §3 (API), and
`docs/contracts/stakeholder-metrics-v2.md` (snapshot, definition changes, board sections,
detail lists and CSV exports; slices v2a, v2b and v2c implemented). The contracts are authoritative; this page summarizes it and records how the code reads the
points the contract leaves open. The data captured for it (origin channel, requester
columns, closing target) is slice 3b; the stakeholder role and gate are slice 3a
([stakeholder-invitations.md](stakeholder-invitations.md)).

The company dashboard v2 sections (`GET /v2/me/company/dashboard/{summary,attention,pipeline,vacancies,recent,origin}`,
owner and recruiter) run on this engine: the same pipeline snapshot plus a history snapshot
keyed by company. See [dashboard-v2.md](dashboard-v2.md).

Code: `internal/features/metrics/`:

- `application`: filter parser, period, cursor and shape helpers (`filters.go`, `period.go`,
  `cursor.go`, `shape.go`), the snapshot caches (`snapshot.go`), the formulas
  (`dataset.go`, `summary.go`, `sections.go`, `recruiters.go`, `details.go`), the v2 list
  grammar (`lists.go`: keyset, facets, applied filters, audit filters), the list kinds
  (`kinds.go`), the pipeline section with the candidates and applications lists
  (`pipeline.go`) and the CSV export rows (`export.go`).
- `infrastructure/postgres`: the fact loader (`store.go`), the pipeline loader
  (`pipeline.go`), the audited detail reads (`details.go`), name resolution and the
  list/export audit rows (`lists.go`).
- `infrastructure/http`: the handlers; `export.go` streams the CSV.

Wiring lives in `cmd/api/metrics.go`, plus one router group. The jobs rules the metrics share
come in from there: the fulfillment business-day calendar (`businesscalendar.IsBusinessDay`),
the pipeline stage order for manual intake at or beyond the cutoff, and each vacancy's
pipeline configuration (`pipelineconfig.Defaults` plus the stored configuration, mapped
to `application.Pipeline` by `metricsPipelineFrom`) for the pipeline section. The metrics
feature imports nothing from jobs (architecture guard).

## Access

Every route sits in one group: `NoStore` → `requireAuth` → `requireMetricsViewer`. Owners
and stakeholders pass. A recruiter gets `403 forbidden`, and an unauthenticated request
gets `401`. Every response, errors included, carries `Cache-Control: no-store`. Only the
caller's company is ever read.

| Route | Answers |
| --- | --- |
| `GET /v2/me/company/metrics/summary` | company view (§3.1) plus the v2 strip (v2 §4.1) |
| `GET …/metrics/closures` | closed per month and delivery status (v2 §4.2) |
| `GET …/metrics/compliance` | late buckets and the on-time series (v2 §4.3) |
| `GET …/metrics/delays` | closing target, overdue top, reassignments by reason (v2 §4.5) |
| `GET …/metrics/origin` | applications by channel (v2 §4.6) |
| `GET …/metrics/pipeline` | current candidates per stage kind, stalled, top vacancies (v2 §4.4) |
| `GET …/metrics/recruiters` | recruiter cards, paginated (§3.2) |
| `GET …/metrics/recruiters/{userId}` | one card plus `by_month` (§3.3); 404 if the user never had a tramo here |
| `GET …/metrics/deliveries` | delivery rows (v2 §5.1) |
| `GET …/metrics/vacancies` | vacancy rows (§3.4, v2 §5.2) |
| `GET …/metrics/placements` | credits with candidates, **audited per page** (v2 §5.3) |
| `GET …/metrics/reassignments` | reassignment rows (§3.4, v2 §5.4) |
| `GET …/metrics/candidates` | current participations of open vacancies, **audited per page** (v2 §5.5) |
| `GET …/metrics/applications` | applications per vacancy and channel (v2 §5.6) |
| `GET …/metrics/{kind}/export` | CSV of `deliveries`, `vacancies`, `placements` (**audited**), `reassignments`, `candidates` (**audited**), `applications` (v2 §8) |
| `GET …/metrics/vacancies/{draftId}/deliveries` | delivered candidates, **audited** (§3.5) |
| `GET …/metrics/vacancies/{draftId}/placements` | credits with candidates, **audited** (§3.5) |

## Filters (§3.0)

- **Every route:** `from`, `to` (required, `YYYY-MM-DD`, inclusive days in
  `America/Mexico_City`, `to - from ≤ 365`), `recruiter_id`, `requester_kind`
  (`client` | `internal_area`), `requester_id`. A uuid needs `requester_kind`. `none` alone
  means «sin solicitante»; `requester_kind=X&requester_id=none` means «X sin especificar»;
  `requester_kind` alone means every vacancy of that kind (M6).
- **Lists only:** `limit` (1–100, default 50) and `cursor`. Summary and the sections
  take no list parameters. Exports take neither (`unknown`).
- **Sortable lists** (deliveries, vacancies, placements, reassignments, candidates,
  applications, and their exports):
  `sort`, `order` (`asc | desc`) and `vacancy_id` (a canonical uuid; a vacancy of another
  company or an unknown id answers an empty list, not an error). An unknown sort is
  `sort: invalid`. The default sort is the first one listed below; a text sort (`title`,
  `candidate`, `reason`) defaults to `asc`, every other sort to `desc`.
- **Multi-value filters** (`result`, `close_reason`, `reason`, `stage_kind`, `channel`) are one comma-separated
  parameter; an empty, unknown or repeated value is `invalid`, a repeated parameter
  `duplicate`. The values are kept in the order sent.
- **Deliveries:** `result` (multi), `late_bucket` (`up_to_2 | from_3_to_5 | over_5`),
  `commitment_month` (`YYYY-MM`), `attributed_to`. Sorts `commitment_date`,
  `business_days_late`, `business_days_overdue`, `target_reached_at`, `delivered`, `title`.
- **Vacancies:** `scope` (`activity` default | `assigned | closed | closed_assigned`),
  `closed_month`, `close_reason` (multi, `filled | cancelled | other | no_reason`),
  `closing_target` (`on_time | late | no_target`), `credited_to`, and the v1 `outcome`
  (`filled | cancelled | other | open`) and `delivery_result`. Sorts `opened_at`,
  `last_close_date`, `business_days_to_close`, `title`.
- **Placements:** `recipient`, `held` (`true` = active, `false` = did_not_hold). Sorts
  `hired_at`, `title`, `candidate`.
- **Reassignments:** `direction` (`received | lost`; without `recruiter_id` it is
  `recruiter_id: required`), `reason` (multi). Sorts `performed_at`, `reason`, `title`.
- **Pipeline:** the common filters only; `from`/`to` are validated and echoed, never
  applied (a picture of now).
- **Candidates:** `stage_kind` (multi, `new | screening | screening_ok | in_process |
  custom | placement | retired`), `stalled` (only `true`; anything else `invalid`). The
  period is echoed, not applied. Sorts `business_days_in_stage`, `candidate`, `title`,
  `entered_stage_at`.
- **Applications:** `channel` (multi, `portal | careers_site | manual | unknown`). Sorts
  `total`, `title`.
- **Strict parser:** an unknown, duplicate or invalid parameter answers
  `422 invalid_filter` with `fields: [{field, code}]`, sorted by field. Codes are
  `required`, `invalid`, `unknown`, `duplicate` and `range` (on `to`, for `from > to` or a
  span over 365 days). A uuid without its kind is `requester_kind: required`. The writer
  is `httpjson.WriteAuditInvalidFilter`, shared with the audit screen. A rejected request
  writes nothing.
- **Cursor:** opaque and bound to the company, the route, the sort, the order and a hash
  of every filter (`limit` is not hashed). Any mismatch, including a v1 token, answers
  `400 invalid_cursor`, the audit screen's code. A filter error wins over a cursor error.

## Shapes

- Every response carries `definitions_version: "v2"`,
  `period: {from, to, time_zone}` and `as_of` (RFC 3339, UTC, to the second): the
  snapshot's load instant, or the read instant for the audited detail reads.
- Counts are integers, never null. Medians are null without a sample; an even sample
  averages the middle pair (it can be `x.5`).
- Rates are always `{value, numerator, denominator}`. `value` is rounded to 4 decimals and
  is null when the denominator is 0.
- Monthly series are dense, ascending, with one entry per month the period touches, zeros
  included.
- A person is `{user_id, name, former_member}`. `name` is null for a deleted account.
  `former_member` is true when the user is no longer a member of this company (the audit
  screen's rule).
- A requester is `{kind, id, name}`: `id` and `name` are null for «sin especificar», and
  the whole value is null for «sin solicitante».

## Detail lists (v2 §5)

- Response: `definitions_version`, `period`, `as_of`, `total` (every row for the
  filters), `facets`, `applied_filters`, `items`, `next_cursor`.
- **Keyset** over (sort value, id): nulls last in both orders, ties by id ascending in
  both orders; text compares lowercased, numbers as numbers, instants as times. Pages
  are cut in memory from the snapshot after the cursor's position, so an expired snapshot
  never duplicates or skips an unchanged row.
- **Facets** are counted over the rows that pass every filter except the facet's own:
  `deliveries.result`, `vacancies.close_reason` (closed rows by the reason of their last
  close in the close window), `placements.held` (`{"true", "false"}`),
  `reassignments.reason`, `candidates.stage_kind` (with `retired` only when > 0) and
  `candidates.stalled` (a count), `applications.channel`. Every enum value is present.
- **Applied filters:** `recruiter`, `attributed_to`, `recipient`, `credited_to` as people;
  `requester` as the requester object for a uuid, `{kind, id: null, name: null}` for
  «X sin especificar», `"none"` for «sin solicitante»; `requester_kind` alone is echoed as
  sent under `requester_kind` (so it never reads as «sin especificar»); `vacancy` as
  `{draft_id, title}`; plain filters as sent (multi-values as arrays, `held` as a boolean).
  `from`, `to`, `sort`, `order`, `limit` and `cursor` are not echoed. Names come from the
  whole period snapshot first; misses go to `Store.Names`, which names a person only if
  they are a member of the company now or appear in its history (a tramo, a credit, a
  reassignment they performed), a requester or vacancy only within the company. Anything
  else resolves with `name`/`title` null, never across companies.
- **Deliveries:** the delivery universe of the period (2.3). `attributed_to` is the
  people the result counts for (responsible, or members in shared, at the target moment;
  at the end of the commitment day for overdue; empty for pending and not configured),
  the rule of the recruiter cards. `business_days_overdue` runs from the commitment date
  to `as_of`. The `delays.overdue.top` rows carry the same `requester` and
  `attributed_to` (same code).
- **Vacancies:** `scope=activity` keeps the v1 rows. `assigned` = a tramo overlapping the
  period (narrowed to that user's tramo by `recruiter_id`), `closed` = a close in the
  close window, `closed_assigned` = both. The close window is `closed_month` clipped to
  the period, else the period: `close_reason` and the facet judge the last close in it.
  `closing_target` and `business_days_to_close` follow V1 (null unless the last close in
  the period is filled). `credited_to` = a credit for that user on the vacancy, any hire
  date. Row `last_close` is the last close in the period.
- **Placements:** active and did_not_hold credits hired in the period; recipients by kind,
  then user id. The candidate's name (the company's view) is loaded with the credits in
  the snapshot.
- **Reassignments:** `recruiter_id` keeps the rows where that user lost or received;
  `direction` keeps one side.
- **Candidates:** every active participation of the pipeline snapshot (below) with its
  `stage {kind, name}` (the stage's name in its vacancy; a retired stage keeps its retired
  name, empty if the id is unknown), `business_days_in_stage`, `stalled` and
  `entered_stage_at`. `recruiter_id` = an open tramo at `as_of` (as the section), never
  the period. The list for `stage_kind=K` (`&stalled=true`) reproduces the section's
  `candidates` (`stalled`) of K; a top vacancy's `in_process` is reproduced by
  `vacancy_id=V&stage_kind=screening,screening_ok,in_process,custom,retired`
  (`application.InProcessQuery`): plain `vacancy_id=V` also lists its new and placement
  rows.
- **Applications:** one row per vacancy of the period snapshot with ≥ 1 participation
  created in the period in the selected channels (every channel without `channel`).
  Rows carry all four channel counts; row `total` and the response `total` sum only the
  selected channels, so the response total is the §4.6 origin figure (not the row count)
  and the rows add up to it. `facets.channel` equals `origin.by_channel` for the same
  common filters.

## Audit of lists and exports (v2 §6)

- `placements` and `candidates` write one `MetricsDetailViewed` per successful page, after the page is
  built from the snapshot and before it is written, in its own transaction; a failed
  insert answers `500` and serves nothing. Metadata: `report`, `filters` (the normalized
  query: `from`, `to`, sent filters (`stage_kind` and `stalled` included), `sort`,
  `order`, `limit`; never the cursor) and,
  when filtered by vacancy, `vacancy_id`. The entity is the vacancy when filtered by one,
  else the company; the row's vacancy column is set only for a vacancy of this company.
- A `placements` or `candidates` export writes one `MetricsDetailExported` (`sensitive_read`; `report`,
  `filters` without `limit`, `row_count`, `vacancy_id` when filtered) the same way,
  before the first byte. Deliveries, vacancies, reassignments, applications and the
  pipeline section are not audited.
- A rejected request or an export over the limit writes nothing.

## CSV export (v2 §8)

- `GET …/metrics/{kind}/export`: the list's filters, sort and order, every row, from the
  snapshot. UTF-8 BOM, Spanish headers, ISO dates (instants as RFC 3339 UTC), the audit
  export's formula guard on every cell (header included), `Content-Disposition:
  attachment; filename="metricas-<kind>-<from>-<to>.csv"`, `Cache-Control: no-store`.
  Rows are formatted on demand and flushed every 500.
- Enum cells (result, reason, status, stage kind) keep the API codes; `Detenido` is
  `true`/`false`; people are names (`Cuenta
  eliminada` for a deleted account), joined with `; `; a requester is its name, `Cliente
  sin especificar`, `Área sin especificar` or `Sin solicitante`.
- Above 50,000 rows: `422 metrics_export_too_large` with `row_count` and `limit` (the
  `audit_export_too_large` body; registered in `httpjson/metrics_errors.go`), nothing
  written. `Service.WithExportLimit` lowers the cap in tests.
- Errors before the first byte are normal JSON answers; a failure after the 200 aborts the
  connection (`http.ErrAbortHandler`) instead of ending a short file.

## Metrics snapshot (v2 §2)

Every route except the v1 per-vacancy detail reads computes from a shared snapshot
(the `placements` list too; its audit row is written separately):

- **Key** `(company_id, from, to)`, the company taken from the session after the gate.
  The loader reads the whole period unfiltered in one REPEATABLE READ transaction; the
  requester filter and the recruiter filter (a tramo of that user overlapping the
  period) run in Go over it with the loader's former SQL rules, so a board, its
  filtered variants, the cards and the lists of one period share one load.
- **`as_of`** is the instant the load started. It is the "now" of every now-dependent
  rule (overdue vs pending, open tramos), on cache hits too.
- **Lifetime** 60 s from `as_of`, in-process LRU bounded to 128 entries. Concurrent misses
  for one key share one load (singleflight); the load runs on a context detached from
  the first caller (`context.WithoutCancel`) with its own 10 s timeout, so a cancelled
  request fails no other. Failed loads are not cached. A write shows in metrics at most
  60 s later; responses stay `Cache-Control: no-store`.
- `summary` loads the period and its previous period in parallel.
- **Pipeline snapshot** (`pipeline`, `candidates`): a separate entry keyed `(company_id)`
  only, so every period shares it, with the same TTL, LRU bound, singleflight and
  detached 10 s load (the generic `cache` in `snapshot.go`). `Store.LoadPipeline` reads, in
  one REPEATABLE READ transaction, the open vacancies (`vacancy_processes.status <>
  'closed'` and `process_status <> 'finished'`; paused counts as open), their tramos,
  responsible, requester and pipeline configuration, and their participations with
  `discarded_at IS NULL`, each with its history rows into the current `stage_id`
  (`participation_history_order_idx`). `application.StageEntry` takes the latest
  `intake | move | recovery` row as the current-stage entry (`substate` and
  `not_applicable` never reset it); without one it falls back to the participation's
  `created_at`.
- The clock is the service clock (`WithClock` in tests); TTL, bound and timeout are
  constructor parameters of the cache (`newSnapshots`) for unit tests.
- `recruiters/{userId}` still asks the store whether the user ever had a tramo here,
  and names a user outside the snapshot's people with one query.

## Definitions as computed

- **Scope.** A vacancy counts only if it was published at least once (a
  `vacancy_processes` row, D6) and had activity in the period: a tramo overlapping it, a
  close, a commitment date, a hire, a reassignment or an application inside it. The
  formulas run in Go over the snapshot. There are no metrics tables (§3.6).
- **Assigned (2.1).** A tramo overlaps `[from, to]`. A rejoin counts once. Functions
  count once per function held at any time in the period.
- **Concluded and time to close (2.2, v2 V1).** Close events come from
  `vacancy_lifecycle_events`. `vacancies.closed` counts distinct vacancies with a close
  in the period, by the reason of their **last** close in the period. A vacancy whose
  last close is `filled` is measured at its **first** filled close in the period: the
  median (business days from the first publication) and `closing_target` (that close
  against the `target_close_date` in effect at that instant, rebuilt from
  `vacancy_close_target_changes`). So `closing_target` adds up to `closed.filled`, and
  `by_requester.filled` counts the same vacancies.
- **Delivery (2.3).**
  - The target moment is the N-th frozen `reached_at`, never `fulfilled_at` (D8).
  - A configured vacancy (a complete config or a frozen row) enters the period by its
    `commitment_date` (D12). An unconfigured one enters when assigned in the period (P1).
  - `overdue` and `pending` use the request's "now".
  - `delivered` is the live count of participations that ever entered the cutoff (or a
    manual intake at or beyond it), so it never goes down.
  - Per recruiter, the result goes to the users holding `responsible` or `member` at the
    target moment. For `overdue`, that moment is the end of the commitment day.
  - `delivered_in_tramo` counts participations the recruiter moved into the cutoff during
    one of their tramos, with the move inside the period. Organic applies count for no
    recruiter.
- **Placements (2.4).** Credits `active` and `did_not_hold` with `hired_at` in the period.
  `did_not_hold` is a subset of the recipient kinds (P3). Coverage (`positions_covered` /
  `positions_required`) sums active credits and `hiring_headcount` over the vacancies
  closed in the period; a missing headcount adds 0. Conversion is vacancies with a credit
  for the recruiter ÷ `closed_assigned`.
- **Origin (2.5).** Participations created in the period, by `origin_channel`.
- **Closed by month (2.6, v2 V1).** Distinct vacancies per month, by their last close
  that month (D10), so the reasons add up to the month's `closed` (sent by `closures`).
- **Requester (2.7).** Current `job_drafts.requester_kind/requester_id`, with the name from
  the requester catalog. In `by_requester`, `vacancies` is the assigned count and `filled`
  is the filled closes; named groups sort by name, then «sin especificar», then
  «sin solicitante».
- **Pipeline (v2 §4.4, N3).** Stage kinds in the fixed order `new, screening,
  screening_ok, in_process, custom, placement`, then `retired` only when > 0. A
  participation in a stage of its vacancy's progression takes that stage's kind (every
  custom stage folds into `custom`); in the exit stage it is not counted; in any other
  stage (retired or unknown) it is `retired`. Days in stage are business days from the
  entry to `as_of` (the fulfillment calendar, `(entry, as_of]`); the median is null at 0
  candidates. Stalled = days ≥ 7 (`StalledThreshold`, DV1), never in `placement`. Top
  vacancies: up to 5 open vacancies by active participations outside `new`, `placement`
  and the exit stage (retired included; DD2 «en proceso», shared with the company
  dashboard), ties by title (case-insensitive) then id; a vacancy with 0 is not listed. `responsible` is the open responsible function, null without one.
- **Previous period (v2 V2).** `[from − n, from − 1]` with `n = to − from + 1`, the same
  filters, read from its own snapshot with today's knowledge: a delivery fulfilled
  after that window ended counts as fulfilled.
- **Headline (v2 N1).** `{current, previous}` of `delivery.on_time_rate`,
  `vacancies.assigned`, `vacancies.median_business_days_to_close`, `placements.credits`
  and `reassignments.total`.
- **On-time series (v2 N2).** Dense over the period's months; configured deliveries
  counted by the month of `commitment_date`, the 2.3 on-time rate (pending not judged).
- **Late buckets (v2 §4.3).** `late` split by `business_days_late`: `up_to_2` (0–2),
  `from_3_to_5`, `over_5`.
- **Overdue (v2 §4.5, N4).** `total` overdue deliveries in the delivery period; `top` up
  to 4, most business days from `commitment_date` to `as_of` first, ties by title
  (case-insensitive), then by id.
- **Business days in tramos (2.8).** Each tramo is clipped to the period and to "now".
  Days count in `(start, end]`, the fulfillment calendar's rule.
- **Reassignments (2.9).** Rows performed in the period. On the reassignments list,
  `recruiter_id` keeps the rows where that user lost or received. The note appears only
  for `other` and only in the list. `snapshot` keeps `lifecycle`, `delivery` and
  `placements` from `state_snapshot`.
- **Vacancy rows (3.4, v2 §5.2).**
  - `closes[]` and `reassignments` are limited to the period. Coverage is all-time.
  - `outcome=open` means no close in the period.
  - `delivery.business_days_late` is set only for `late` (the 2.3 `late` definition).

## Audited detail reads (§3.5)

These keep their own store path (no snapshot).

Each successful deliveries or placements read writes one `MetricsDetailViewed` row
(`sensitive_read`; entity `vacancy`; metadata `report`, `vacancy_id`) in the read's
transaction. A failed audit insert fails the read with `500` (fail-closed). A vacancy
from another company, a never-published vacancy or a malformed id answers `404` and is
not audited.

- **Lists:** not period-filtered (the period is echoed only).
- **Deliveries:** in order. `delivered_by` is null for an organic apply straight into the
  cutoff.
- **Placements:** voided credits are not listed.
- **Candidate names:** the company's view (manual name, or the company's correction of
  the account name).

## Indexes

Migration `00059_metrics_indexes.sql` adds `vacancy_assignments (draft_id, started_at)` and
`vacancy_lifecycle_events (action, created_at)`; `00060_metrics_participation_index.sql`
adds `process_participations (process_id, created_at)` (origin and applications by
vacancy). The participation and requester indexes
§3.6 names came with `00058`. Revisit with a nightly table only if `summary` p95 goes over
500 ms on realistic data.

## Tests

```sh
make test PKG='./internal/features/metrics/... ./cmd/api/'
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  make test-integration PKG=./cmd/api/ RUN='^TestMetrics|^TestAudit'
```

Unit tests in `internal/features/metrics/application` cover the snapshot cache (TTL,
singleflight, cancelled caller, LRU bound, company isolation; run them with `-race`) and
the v2 formulas. The integration tests (`cmd/api/metrics_*_integration_test.go`) seed one
company with every edge case by SQL and read only through the production router. They
cover:

- rejoin, close → reopen → close, a legacy null reason, a renegotiated commitment, a
  late delivery across a holiday;
- an organic apply into the cutoff, a voided credit, a `did_not_hold` credit;
- a former member, requester `none` and «sin especificar», an empty company;
- the role gate, other-company isolation, rejected filters, pagination and the audit rows
  of detail reads, including the failure path;
- every section figure, close → reopen → close with different reasons, each late
  bucket, the bounded and ordered overdue top, and a write showing after the snapshot
  expires;
- for every §4 figure that opens a v2b list (summary, closures, compliance, delays and
  the recruiter cards of every recruiter), the list total equals the figure, for the
  period and its previous period, with and without the common filters
  (`TestMetricsLists_FigureEqualsTotal`);
- sorting and keyset pages, the cursor bound to sort and order, facets, applied filters
  without cross-company names, the placements audit per page and per export with their
  failure paths, the CSV shape and the export limit;
- the pipeline (`metrics_pipeline_integration_test.go`): a default and a stored pipeline
  with custom and retired stages, a closed vacancy, a discarded, a recovered, a placed
  participation and substate / not_applicable rows that never reset the entry; every
  stage figure, stalled figure, top vacancy and origin figure equals its candidates or
  applications total with and without the common filters; candidates audit per page and
  export with the failure paths; the gate and other-company isolation of the five new
  routes; the pipeline snapshot expiring after 60 s.

`db/migrations/migration_00060_integration_test.go` applies, rolls back and reapplies
00060.
