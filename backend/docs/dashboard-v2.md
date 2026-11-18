# Company dashboard v2 read API (sections)

Contract: `docs/contracts/company-dashboard-v2.md` (agreed, DD1–DD6). Slice d2a
implements the six sections (§3); slice d2b the lists and exports (§5) and the
talent base `added_from` / `added_to` filter.
The contract is authoritative; this page records how the code reads the points
it leaves open. The old `GET /v2/me/company/dashboard` ([dashboard.md](dashboard.md))
is unchanged until the frontend moves (slice d2c removes it).

Code: the metrics feature (`internal/features/metrics/`), same engine as
[metrics.md](metrics.md):

- `application/dashboard.go`: window parser, header, scope, the six sections.
- `application/history.go`: the history snapshot types and the interval rules
  (`publishedAt`, `stageAt`, `inProcessAt`).
- `infrastructure/postgres/history.go`: `Store.LoadHistory`.
- `application/dashboard_lists.go`: the list parser, the four lists, their
  facets, applied filters and CSV exports.
- `infrastructure/http/dashboard.go`: the handlers (scope from the session role).

Wiring in `cmd/api/metrics.go`: `Service.WithTalentBase` gets the talent base
visibility rule (`talentbase.CanViewIn`) and the pool's added count
(`pool.ReadAddedBetween`, same identity definition and `created_at` as the
talent base summary). The metrics feature imports nothing from jobs,
applications or companies infrastructure (architecture guard).

## Routes and access

One router group: `NoStore` → `requireAuth` → `requireRecruiter`. Owners and
recruiters pass; a stakeholder gets `403 forbidden` (DD5), an unauthenticated
request `401`. Every response carries `Cache-Control: no-store`.

| Route | Answers |
| --- | --- |
| `GET /v2/me/company/dashboard/summary` | in process with daily series, published vacancies, pool added, positions (§3.1) |
| `GET …/dashboard/attention` | overdue, due this week, stalled: total and top 5 (§3.2) |
| `GET …/dashboard/pipeline` | metrics §4.4 stages, scoped, no top vacancies (§3.3) |
| `GET …/dashboard/vacancies` | top 5 published vacancies by in process, with positions (§3.4) |
| `GET …/dashboard/recent` | the 5 newest participations (§3.5) |
| `GET …/dashboard/origin` | applications per window day, organic / manual (§3.5) |
| `GET …/dashboard/lists/candidates` | candidates, metrics §5.5 rows (§5) |
| `GET …/dashboard/lists/deliveries` | attention deliveries, metrics §5.1 rows (§5) |
| `GET …/dashboard/lists/vacancies` | vacancies in scope with status, in process, positions (§5) |
| `GET …/dashboard/lists/applications` | applications per vacancy and channel, metrics §5.6 rows (§5) |
| `GET …/dashboard/lists/{kind}/export` | CSV of each list (metrics §8) |

The lists take the `/lists/` segment because `GET …/dashboard/vacancies` is the
§3.4 section (recorded in the contract §3 and §5).

**Query:** only `window` = `7 | 30 | 90` (default 30). Anything else (including
`from`, `to`, `recruiter_id`, `scope`) is `422 invalid_filter` with
`fields: [{field, code}]` (`unknown`, `invalid`, `duplicate`), the metrics
writer. So a recruiter cannot widen the scope.

**Header** on every response: `definitions_version: "d2"`,
`window {days, from, to, previous_from, previous_to}`, `as_of`, `scope`
(`company` | `own_vacancies`). The window ends on the **local date of `as_of`**
(Mexico City), so the window and the data always agree, even across midnight
with a cached snapshot.

## Scope (DD1)

The session role decides: an owner sees every vacancy of the company; any other
caller (a recruiter) the vacancies where they have an assignment open at
`as_of` (`started_at ≤ as_of`, `ended_at` null or after). The scope is applied in
Go over the shared snapshots, so it never changes what is cached. The scope is
today's: it is applied to the whole series (a vacancy assigned yesterday shows
its whole history; one unassigned yesterday shows none).

"Vacancy" here is a vacancy published at least once (a `vacancy_processes` row).
Each figure then adds its own state rule:

| Figure | Vacancies |
| --- | --- |
| `in_process` (series and current), `published_vacancies`, `positions`, `vacancies` section | published at the end of the day: published and not paused, closed or finished |
| `attention` deliveries | open now: not closed, not finished (paused counts) |
| `pipeline`, `attention.stalled` | the metrics pipeline snapshot: open vacancies (paused counts) |
| `recent`, `origin` | every vacancy in scope, any state; participations in any state |

## Definitions as computed

- **«En proceso» (DD2):** an active participation (not discarded) whose stage, in
  the vacancy's **current** pipeline configuration, is not `new`, not
  `placement` and not the exit stage; a retired stage counts (as metrics §4.4).
  A stage retyped later rewrites its history (contract §4 approximation).
- **End of day:** the value after every row strictly before the next local
  midnight. A row at exactly 00:00 belongs to the new day.
- **Stage intervals:** `intake`, `move` and `recovery` rows put the
  participation in their `stage_id`; a `discard` row takes it out (inactive)
  until a recovery. `substate` and `not_applicable` rows never change anything.
  A participation without any of those rows sits in its current stage (and
  discard state) from its `created_at`.
- **Publication:** published from `vacancy_processes.published_at`; then each
  `vacancy_lifecycle_events` row before the instant: `pause`, `close` and
  `finish_process` end it, `resume` and `reopen` restart it.
- **`in_process.series`:** the previous window's last day then every window
  day, oldest first (`window + 1` points); `previous` is the first point,
  `current` the last (today's end, that is every known row).
- **`published_vacancies`:** at the end of `to` and of `previous_to`.
- **`positions` (DD3):** over the vacancies published at the end of today:
  `covered` = active placement credits, `required` = `hiring_headcount`
  (unset → 0).
- **`pool_added`:** company-wide pool identities whose `created_at` (the manual
  record's creation, or the organic candidate's first application in the
  company) falls in `[from 00:00, to + 1 00:00)` local, and the same for the
  previous window. `null` without talent-base access (owners, `all_recruiters`
  or listed viewers have it). The counts are cached 60 s per company and window;
  the access check runs on every request.
  - **Difference with the old `pool_added_last_7_days`:** the old figure is a
    rolling `now() − 7 days`; `window=7` is the last 7 local calendar days
    including today. They agree unless an addition falls between
    `now() − 7 days` and the start of the local day six days ago (the new one
    leaves it out) — at most the part of one day.
- **`attention`** (state now): deliveries of open vacancies in scope with a
  complete configuration, a commitment date and no fulfillment.
  - `overdue`: commitment before today; `business_days_overdue` is
    business days in `(commitment, today]` (the fulfillment calendar, as
    metrics); most days first, ties by title (case-insensitive), then id.
  - `due_this_week` (DD6): commitment from today through the Sunday of the
    Monday–Sunday week; on Sunday only Sunday. Soonest first, ties by title.
    These rows carry no `business_days_overdue`.
  - `delivered` is the metrics delivered count (never goes down); `target` 0
    without one. `responsible` is the open responsible function or null.
  - `stalled`: metrics DV1 over the pipeline snapshot rows in scope (≥ 7
    business days in the stage, never placement); most days first, ties by
    candidate name, then participation. `total` equals the sum of the
    pipeline section's `stalled` for the same caller.
  - `as_of` is the older of the history and pipeline snapshots.
- **`pipeline`:** exactly metrics §4.4 `stages` (shared `stageFigures`), with
  the recruiter scope being the metrics recruiter filter (open tramo at
  `as_of`); `stalled_threshold_business_days` is 7.
- **`vacancies`:** the published vacancies in scope ordered by «en proceso» now,
  ties by title then id, top 5. A vacancy with 0 is still listed (it is
  active); metrics §4.4 `top_vacancies` leaves those out.
- **`recent`:** today's row shape (`participation_id`, `candidate {kind, id,
  name, professional_title}`, `vacancy {id, title}`, `stage {id, name, kind}`,
  `source`, `applied_at`, `added_by`), the same name rule. The title differs
  from today's endpoint: organic rows read `professional_title` from the
  participation's application-time snapshot (like the board), not the live
  candidate profile; snapshots taken before migration 00061 read null; company
  corrections (including explicit null) win; manual intakes read their company
  record. The legacy `GET /v2/me/company/dashboard` still reads the live profile
  until it is removed (T12 of stakeholder-metrics-v2-backend). Stage
  names and kinds come from the current configuration: the exit stage is kind
  `discarded`, a retired stage keeps its configured kind. Newest first, ties by
  participation id descending. Unlike today's (10 rows, schema-2 drafts) it has
  5 rows over vacancies published at least once.
- **`origin`:** per window day, participations created that local day:
  `manual` = `origin_channel` manual, `organic` = portal, careers site and
  unknown (the contract's rule; today's route splits by `source`).

## Lists (§5, slice d2b)

Same grammar as metrics §5 ([metrics.md](metrics.md)): `sort`, `order`,
`limit` (1–100, default 50), `cursor`, exact `total`, `facets` (each ignores
only its own filter), `applied_filters`, `next_cursor`; keyset over
(sort value, id), nulls last, ties by id. Every response carries the dashboard
header (`definitions_version: "d2"`, `window`, `as_of`, `scope`). Not audited
(DD4): no audit row for pages or exports.

**Parser** (`parseDashboardList`): `window`, `sort`, `order`, `vacancy_id`,
`limit`, `cursor` and the kind's filters only; anything else (including
`recruiter_id`, `requester_*`, `scope`, metrics `from`/`to` outside
applications) is `422 invalid_filter` with `unknown`. Exports take neither
`limit` nor `cursor`. Codes: `invalid`, `duplicate`, `unknown`, `required`
(`on` without `in_process=true`), `range` (`to` before `from`; `on` outside the
series days `previous_to..to`; `from`/`to` outside the window). The window
bounds are checked against the response's window (the snapshot's `as_of`
date), then the cursor: a filter error wins over a cursor error.

**Scope:** the session role only, through `Viewer.sees` (history snapshot) or
the metrics recruiter filter (pipeline snapshot), as the sections. A
`vacancy_id` outside the caller's scope (another recruiter's, another
company's, unknown) answers an empty list with `applied_filters.vacancy.title`
null: titles resolve only from the vacancies in scope, never from
`Store.Names`.

**Cursor:** the metrics v2 cursor bound to company, route
(`dashboard_candidates`, …), sort, order and a hash of every filter, the
window and the caller's scope (`company` / `own_vacancies`). The dashboard
fields are `omitempty` in the hash, so metrics cursors keep theirs.

| List | Source | Rows | Filters | Sorts (default first) | Facets |
| --- | --- | --- | --- | --- | --- |
| `candidates` with `in_process=true` | history snapshot | participations in process (DD2) at the end of `on` (today without it) in vacancies published then | `on`, `stage_kind`, `stalled`, `vacancy_id` | `business_days_in_stage`, `candidate`, `title`, `entered_stage_at` | `stage_kind`, `stalled` |
| `candidates` without it | pipeline snapshot | active participations of open vacancies (paused included) | `stage_kind`, `stalled`, `vacancy_id` | same | same |
| `deliveries` | history snapshot | open vacancies in scope, configured, unfulfilled, commitment before Sunday of this week | `state` (`overdue`, `due_this_week`), `vacancy_id` | metrics §5.1 sorts | `state` |
| `vacancies` | history snapshot | every vacancy in scope published at least once | `status` (`published`), `vacancy_id` | `published_at`, `title`, `positions_open`, `in_process` | `status` (`published, paused, closed, finished`) |
| `applications` | history snapshot | vacancies in scope with participations created from `from` to `to` (window by default) | `from`, `to`, `channel`, `vacancy_id` | `total`, `title` | `channel` |

- **Candidates at a past day:** the stage is the one at the end of that day
  (the series' interval rules), `entered_stage_at` the latest intake / move /
  recovery row into it before then (else creation), `business_days_in_stage`
  to the last instant of that day (to `as_of` today), `stalled` by DV1 on that
  count. Candidate names are the company's view (manual record, correction,
  account name), loaded with the history tracks.
- **Deliveries:** overdue rows have result `overdue` and
  `business_days_overdue` (attention's count); due-this-week rows are
  `pending`. `attributed_to` is the metrics rule (the history snapshot now
  loads the assignment functions for it).
- **Vacancies:** `status` at the end of today: `published` by the publication
  rule, else `finished`, `closed` or `paused` from the current state.
  `in_process` is the DD2 count for published vacancies and 0 otherwise (its
  drill-down only opens published vacancies). `positions_open` =
  `max(required − covered, 0)`.
  The response carries `positions: {covered, required}` next to `total`: the
  sum of every row of the filtered result, not only the page, so
  `status=published` equals `summary.positions`. The CSV export has no aggregate
  (each row keeps its covered/required columns).
- **Applications:** total = the selected channels' sum (metrics §5.6); a
  channel outside the four is `unknown`. `from`/`to` are echoed in
  `applied_filters` (they narrow the window, unlike the metrics period).
  Its CSV export keeps only the selected channels' columns when `channel` is
  set (each row's channel cells add up to its Total); without `channel` it has
  every column, as the metrics applications export.
- **Exports:** `dashboard-<kind>-<window from>-<window to>.csv`, the metrics
  writer (BOM, formula guard, 50,000 rows → `422 metrics_export_too_large`).
  Candidates, deliveries and applications reuse the metrics headers;
  vacancies: `ID vacante, Vacante, Solicitante, Responsable, Estado, Publicada,
  En proceso, Cubiertas, Requeridas`.

### Figure → list

| Figure | List (total equals it) |
| --- | --- |
| `summary.in_process` current / series point D | `candidates?in_process=true` / `&on=D` |
| `summary.published_vacancies.current` | `vacancies?status=published` |
| `summary.positions` | the sum of `positions` over `vacancies?status=published` |
| `summary.pool_added` current / previous | talent base `candidates?added_from=…&added_to=…` with the window's dates |
| `attention.overdue` / `due_this_week` | `deliveries?state=overdue` / `state=due_this_week` |
| `attention.stalled` | `candidates?stalled=true` |
| `pipeline` stage K (stalled) | `candidates?stage_kind=K` (`&stalled=true`) |
| `vacancies` top in process | `candidates?vacancy_id=V&in_process=true` |
| `origin` day D (manual) | `applications?from=D&to=D` (`&channel=manual`) |

## Talent base added dates (slice d2b)

`GET /v2/me/company/candidates` (applications feature, talent-base gate
unchanged) accepts `added_from` and `added_to` (`YYYY-MM-DD`, local Mexico City
days, inclusive, each optional and single). They become half-open instants
`[from 00:00, to + 1 00:00)` over the list's `created_at` (manual record
creation, or the organic candidate's first application in the company): the
rule of `pool.ReadAddedBetween`, so `summary.pool_added` equals the list's
`total` with the window's dates. A malformed date is
`400 invalid_filter` `{field, code: "invalid"}` (that endpoint's shape);
`added_from` after `added_to` is `{field: "added_to", code: "range"}`;
repeating one is `duplicate`. Both are bound by the cursor (omitted from its
hash when unset). `/candidates/summary` is unchanged: it takes no query.

## History snapshot (§4)

- **Key** `(company_id)` only; TTL 60 s, LRU 128, singleflight, load detached
  from the caller with its own 10 s timeout (the metrics generic cache). Owner
  and recruiters of a company share one load.
- `Store.LoadHistory` reads in one REPEATABLE READ, read-only transaction:
  every vacancy with a `vacancy_processes` row (the metrics vacancy facts,
  tramos, responsible), its publication state and pipeline configuration, its
  lifecycle events, its active credits; the participations not discarded
  before the history start, or created after it, each with its intake / move /
  recovery / discard rows by participation id
  (`participation_history_order_idx`); each vacancy's 5 newest participations
  in any state (a lateral `LIMIT 5`, served by
  `process_participations (process_id, created_at)` from 00060); and the
  delivery cutoff entries of the open vacancies.
- The history starts 182 local days before today (`HistoryDays`: the 90-day
  window, its previous end point, one day of margin).
- No new index or migration: every history lookup goes by participation id.
  Not measured yet with `EXPLAIN` on realistic data (metrics T6 benchmark).

## Tests

```sh
make test PKG='./internal/features/metrics/... ./cmd/api/'
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  make test-integration PKG=./cmd/api/ RUN='^TestDashboard|^TestTalentBaseAdded'
```

Unit tests (`application/history_test.go`, `dashboard_test.go`,
`dashboard_lists_test.go`): the
publication rule (pause, resume, close, finish, reopen, midnight), stage
intervals (moves, discard, recovery, substate ignored, fallback), the series
end-of-day values with a vacancy closed and reopened and one paused mid-window,
owner vs recruiter scope, the cache keyed by company only, the week boundary
(Monday, Saturday, Sunday), overdue / due ordering, stalled from the pipeline,
recent and origin, and the strict window parser; for d2b the strict list
parser, every figure equal to its list total for the owner and a recruiter
(each series day via `on`), out-of-scope `vacancy_id`, facets, the keyset walk
and cursor binding (route, filters, sort, window, scope) and the exports.

Integration (`cmd/api/metrics_dashboard_integration_test.go`, through the
production router): every section's values for the owner and two recruiters
(each sees only their own vacancies and never another's candidates), the
stakeholder 403, 401, the rejected widening filters and windows, another
company's isolation, pool_added null without talent-base access, and the
7-day pool count equal to the old dashboard's on the same data.
`cmd/api/metrics_dashboard_lists_integration_test.go` (d2b): the gate (403,
401, widening filters) of the eight list routes, figure = total for the owner
and both recruiters, recruiter scope (no foreign rows, foreign `vacancy_id` →
empty, title null), another company, the page walk and cursor binding, CSV
exports and no audit rows. `talent_base_pool_integration_test.go`
(`TestTalentBaseAddedFilter_EqualsDashboardPoolAdded`): the list filtered by
the window's dates equals `pool_added` (windows 7 and 30, current and
previous), cursor binding and the range error.
