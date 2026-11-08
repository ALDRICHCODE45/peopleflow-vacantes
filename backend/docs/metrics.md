# Company metrics read API

Contract: `docs/contracts/stakeholder-metrics-v1.md` §2 (definitions) and §3 (API). The
contract is authoritative; this page summarizes it and records how the code reads the
points the contract leaves open. The data captured for it (origin channel, requester
columns, closing target) is slice 3b; the stakeholder role and gate are slice 3a
([stakeholder-invitations.md](stakeholder-invitations.md)).

Code: `internal/features/metrics/`:

- `application`: filter parser, period, cursor and shape helpers (`filters.go`, `period.go`,
  `cursor.go`, `shape.go`), the formulas (`dataset.go`, `summary.go`, `recruiters.go`,
  `details.go`).
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
| `GET /v2/me/company/metrics/summary` | company view (§3.1) |
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
- **Lists only:** `limit` (1–100, default 50) and `cursor`.
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

- Every response carries `definitions_version: "v1"` and
  `period: {from, to, time_zone}`.
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

## Definitions as computed

- **Scope.** A vacancy counts only if it was published at least once (a
  `vacancy_processes` row, D6) and had activity in the period: a tramo overlapping it, a
  close, a commitment date, a hire, a reassignment or an application inside it. Facts are
  loaded per request in one REPEATABLE READ snapshot and the formulas run in Go. There
  are no metrics tables (§3.6).
- **Assigned (2.1).** A tramo overlaps `[from, to]`. A rejoin counts once. Functions
  count once per function held at any time in the period.
- **Concluded and time to close (2.2).** Close events come from
  `vacancy_lifecycle_events`. Every close in the period counts, so close → reopen → close
  counts twice. The median runs over `filled` closes, in business days from the first
  publication. `closing_target` judges each filled close against the
  `target_close_date` in effect at that instant, rebuilt from
  `vacancy_close_target_changes`.
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
- **Closed by month (2.6).** Distinct vacancies per month and reason (D10).
- **Requester (2.7).** Current `job_drafts.requester_kind/requester_id`, with the name from
  the requester catalog. In `by_requester`, `vacancies` is the assigned count and `filled`
  is the filled closes; named groups sort by name, then «sin especificar», then
  «sin solicitante».
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

The integration tests (`cmd/api/metrics_*_integration_test.go`) seed one company with
every edge case by SQL and read only through the production router. They cover:

- rejoin, close → reopen → close, a legacy null reason, a renegotiated commitment, a
  late delivery across a holiday;
- an organic apply into the cutoff, a voided credit, a `did_not_hold` credit;
- a former member, requester `none` and «sin especificar», an empty company;
- the role gate, other-company isolation, rejected filters, pagination and the audit rows
  of detail reads, including the failure path.
