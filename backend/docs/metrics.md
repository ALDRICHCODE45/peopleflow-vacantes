# Company metrics read API

Contracts: `docs/contracts/stakeholder-metrics-v1.md` §2 (definitions) and §3 (API), and
`docs/contracts/stakeholder-metrics-v2.md` (snapshot, definition changes, board sections;
slice v2a implemented). The contracts are authoritative; this page summarizes it and records how the code reads the
points the contract leaves open. The data captured for it (origin channel, requester
columns, closing target) is slice 3b; the stakeholder role and gate are slice 3a
([stakeholder-invitations.md](stakeholder-invitations.md)).

Code: `internal/features/metrics/`:

- `application`: filter parser, period, cursor and shape helpers (`filters.go`, `period.go`,
  `cursor.go`, `shape.go`), the metrics snapshot cache (`snapshot.go`), the formulas
  (`dataset.go`, `summary.go`, `sections.go`, `recruiters.go`, `details.go`).
- `infrastructure/postgres`: the fact loader (`store.go`) and the audited detail reads
  (`details.go`).
- `infrastructure/http`: the handlers.

Wiring lives in `cmd/api/metrics.go`, plus one router group. The jobs rules the metrics share
come in from there: the fulfillment business-day calendar (`businesscalendar.IsBusinessDay`)
and the pipeline stage order for manual intake at or beyond the cutoff. The metrics
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
| `GET …/metrics/recruiters` | recruiter cards, paginated (§3.2) |
| `GET …/metrics/recruiters/{userId}` | one card plus `by_month` (§3.3); 404 if the user never had a tramo here |
| `GET …/metrics/vacancies` | vacancy rows, paginated (§3.4) |
| `GET …/metrics/reassignments` | reassignment rows, paginated (§3.4) |
| `GET …/metrics/vacancies/{draftId}/deliveries` | delivered candidates, **audited** (§3.5) |
| `GET …/metrics/vacancies/{draftId}/placements` | credits with candidates, **audited** (§3.5) |

## Filters (§3.0)

- **Every route:** `from`, `to` (required, `YYYY-MM-DD`, inclusive days in
  `America/Mexico_City`, `to - from ≤ 365`), `recruiter_id`, `requester_kind`
  (`client` | `internal_area`), `requester_id`. A uuid needs `requester_kind`. `none` alone
  means «sin solicitante»; `requester_kind=X&requester_id=none` means «X sin especificar»;
  `requester_kind` alone means every vacancy of that kind (M6).
- **Lists only:** `limit` (1–100, default 50) and `cursor`. Summary and the sections
  take no list parameters.
- **Vacancies only:** `outcome` (`filled | cancelled | other | open`) and
  `delivery_result` (`on_time | late | overdue | pending | not_configured`).
- **Strict parser:** an unknown, duplicate or invalid parameter answers
  `422 invalid_filter` with `fields: [{field, code}]`, sorted by field. Codes are
  `required`, `invalid`, `unknown`, `duplicate` and `range` (on `to`, for `from > to` or a
  span over 365 days). A uuid without its kind is `requester_kind: required`. The writer
  is `httpjson.WriteAuditInvalidFilter`, shared with the audit screen. A rejected request
  writes nothing.
- **Cursor:** opaque and bound to the company, the route and the filter hash (`limit` is
  not hashed). Any mismatch answers `400 invalid_cursor`, the audit screen's code. A
  filter error wins over a cursor error.

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

## Metrics snapshot (v2 §2)

Every route except the audited detail reads computes from a shared snapshot:

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
- **Vacancy rows (3.4).**
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
`vacancy_lifecycle_events (action, created_at)`. The participation and requester indexes
§3.6 names came with `00058`. Revisit with a nightly table only if `summary` p95 goes over
500 ms on realistic data.

## Tests

```sh
make test PKG='./internal/features/metrics/... ./cmd/api/'
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  make test-integration PKG=./cmd/api/ RUN='^TestMetrics'
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
  expires.
