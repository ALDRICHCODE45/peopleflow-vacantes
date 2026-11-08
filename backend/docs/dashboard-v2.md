# Company dashboard v2 read API (sections)

Contract: `docs/contracts/company-dashboard-v2.md` (agreed, DD1–DD6). Slice d2a
implements the six sections (§3); the lists and exports (§5) are slice d2b.
The contract is authoritative; this page records how the code reads the points
it leaves open. The old `GET /v2/me/company/dashboard` ([dashboard.md](dashboard.md))
is unchanged until the frontend moves (slice d2c removes it).

Code: the metrics feature (`internal/features/metrics/`), same engine as
[metrics.md](metrics.md):

- `application/dashboard.go`: window parser, header, scope, the six sections.
- `application/history.go`: the history snapshot types and the interval rules
  (`publishedAt`, `stageAt`, `inProcessAt`).
- `infrastructure/postgres/history.go`: `Store.LoadHistory`.
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
  `source`, `applied_at`, `added_by`), the same name and title rules. Stage
  names and kinds come from the current configuration: the exit stage is kind
  `discarded`, a retired stage keeps its configured kind. Newest first, ties by
  participation id descending. Unlike today's (10 rows, schema-2 drafts) it has
  5 rows over vacancies published at least once.
- **`origin`:** per window day, participations created that local day:
  `manual` = `origin_channel` manual, `organic` = portal, careers site and
  unknown (the contract's rule; today's route splits by `source`).

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
  make test-integration PKG=./cmd/api/ RUN='^TestDashboardV2'
```

Unit tests (`application/history_test.go`, `dashboard_test.go`): the
publication rule (pause, resume, close, finish, reopen, midnight), stage
intervals (moves, discard, recovery, substate ignored, fallback), the series
end-of-day values with a vacancy closed and reopened and one paused mid-window,
owner vs recruiter scope, the cache keyed by company only, the week boundary
(Monday, Saturday, Sunday), overdue / due ordering, stalled from the pipeline,
recent and origin, and the strict window parser.

Integration (`cmd/api/metrics_dashboard_integration_test.go`, through the
production router): every section's values for the owner and two recruiters
(each sees only their own vacancies and never another's candidates), the
stakeholder 403, 401, the rejected widening filters and windows, another
company's isolation, pool_added null without talent-base access, and the
7-day pool count equal to the old dashboard's on the same data.
