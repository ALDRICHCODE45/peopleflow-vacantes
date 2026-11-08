# Metrics and company dashboard benchmark (T6)

Seeded benchmark of the latency budgets in `docs/contracts/stakeholder-metrics-v2.md` §2 and
`docs/contracts/company-dashboard-v2.md` §4: with the realistic seed (300 vacancies, 10k participations),
**cold `summary` p95 ≤ 400 ms** including the previous-period load, and **warm section or list page
p95 ≤ 50 ms**. Tracking: `odd/tasks/stakeholder-metrics-v2-backend.md` T6. This page records a measurement
only; no production code changed for it.

## How to run

Opt-in, on the isolated `draft_test` database only (the harness refuses anything else):

```sh
cd backend
METRICS_BENCH=1 \
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  go test -tags=integration -count=1 -timeout 30m -run '^TestMetricsBench' -v ./cmd/api/
```

- Without `METRICS_BENCH=1` the test skips, so `make test-integration` does not pay for it.
- `METRICS_BENCH_N` sets the runs per measurement (default 30). `METRICS_BENCH_KEEP=1` keeps the two
  seeded companies afterwards; otherwise they and their audit rows are removed.
- It takes about two minutes (seeding takes 6–13 s per company).

Code:

- `cmd/api/metrics_bench_integration_test.go`: `TestMetricsBench_Budgets` (seed, loader timings, routes
  through the production router, EXPLAIN).
- `internal/tools/metricsdemo/bench.go`: `Bench`, `RealisticBench`, `BuildBenchPlan`, `ApplyBench`,
  `RemoveBench`. It reuses the demo seed's builder primitives (vacancies, tramos, functions, participations,
  moves, discards, credits, reassignments, closes, delivery configs and fulfillments) with generated
  vacancies. The demo seed's own output is unchanged: `TestBuildPlanDigestUnchanged` pins its digest, taken
  before the change. The two refactors it needed are a company id on the builder (the demo passes
  `CompanyID()`) and a company argument to `purge`.

## Method

- **Seed.** `RealisticBench("A")` and `RealisticBench("B")`: two companies of the same size. Ids are uuid v5
  under the demo namespace and the bench key, and `now` is pinned (2026-11-05 07:00 Mexico City), so every
  run seeds the same rows. Each company has:
  - 300 published vacancies spread over 12 months, plus 15 drafts that were never published.
  - 15 recruiters. 15 % of the vacancies have a shared team and 30 % have a collaborator.
  - 80 % of the vacancies have a delivery configuration; 10 % have a stored pipeline with a custom stage and
    a retired stage.
  - Applications through portal, careers site, unknown and manual intake.
  - Moves, discards (35 %), recoveries and substates.
  - Closes: filled, cancelled, other and no reason, a few with reopen. Filled closes come with their hires
    and credits, some of which did not hold.
  - Reassignments for every reason, and renegotiated commitments.
  - After seeding, `ANALYZE` refreshes planner statistics.
- **Isolation.** `Store.Load` for A is timed with A alone, then again after B is seeded. The test also
  checks that A's snapshot has the same vacancies either way.
- **Routes.** Every request goes over loopback HTTP through the production router as A's owner: real JWT
  verification, the role gate, the handlers, JSON encoding, and the audit insert on audited lists.
  - **Cold**: before each run the service clock moves 61 s forward, so every cache (60 s TTL) has expired.
    Each run therefore pays the snapshot loads, and the summary pays both periods in parallel.
  - **Warm**: the same request repeated with the clock still, so each run is a cache hit.
  - Requests are serial, N = 30 each; the tables give p50, p95 and max.
- **Loaders.** `Store.Load`, `LoadPipeline` and `LoadHistory` are timed directly (no HTTP, no cache) after
  one untimed warm-up run.
- **EXPLAIN (ANALYZE, BUFFERS)** runs on copies of the heaviest loader queries, with the same arguments the
  loaders pass. The copies live in the test file and must follow `infrastructure/postgres` when it changes.

## Run of 2026-11-08

Machine:
- CPU and memory: `nproc` 16, `uname -m` x86_64, AMD Ryzen 7 5700G, 31 GiB RAM, Linux 7.2.11, Go 1.26.1.
- Database: PostgreSQL 16.14 in Docker on the same host, with default settings (`jit` on, `shared_buffers`
  128MB, `work_mem` 4MB).

Data:

| | Company A | Company B |
| --- | --- | --- |
| Published vacancies (open now) | 300 (100) | 300 (95) |
| Drafts (incl. unpublished) | 315 | 315 |
| Participations (active) | 10,161 (7,272) | 10,213 (7,368) |
| Stage history rows | 27,255 | 26,682 |
| Tramos / functions | 446 / 453 | 464 / 471 |
| Closes / credits / reassignments | 216 / 148 / 21 | 214 / 155 / 34 |
| Delivery configs / fulfillments | 248 / 245 | 247 / 242 |
| Rows written by the seed | 48,403 | 47,982 |

The whole database held 20,374 participations, 53,937 history rows and 6,073 users (only the two bench
companies).

### Loaders (Store, no HTTP, no cache)

| Loader | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- |
| Store.Load A, 12 months (A alone) | 49.2 | 56.4 | 56.4 |
| Store.Load A, 12 months (A+B) | 47.4 | 51.9 | 52.8 |
| Store.Load B, 12 months (A+B) | 47.6 | 52.4 | 53.2 |
| Store.Load A, previous 12 months | 4.3 | 6.7 | 7.9 |
| Store.LoadPipeline A | 25.7 | 29.7 | 30.0 |
| Store.LoadHistory A (182 days) | 170.3 | 184.9 | 193.0 |

Isolation: seeding B did not slow A down (p95 56.4 alone, 51.9 with B; the difference is noise). A's
snapshot had the same 300 vacancies both ways.

### Metrics routes (owner of A, 12-month period)

| Route | Mode | p50 ms | p95 ms | max ms | Budget (p95) | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| summary (with previous period) | cold | 49.9 | 56.8 | 57.1 | ≤ 400 | pass |
| summary (with previous period) | warm | 2.4 | 3.8 | 3.9 | ≤ 50 | pass |
| closures | cold | 48.7 | 53.2 | 67.4 | — | — |
| closures | warm | 0.6 | 0.7 | 0.9 | ≤ 50 | pass |
| compliance | cold | 48.5 | 53.4 | 55.2 | — | — |
| compliance | warm | 0.6 | 0.7 | 1.1 | ≤ 50 | pass |
| delays | cold | 49.0 | 53.6 | 55.7 | — | — |
| delays | warm | 0.5 | 0.8 | 0.9 | ≤ 50 | pass |
| origin | cold | 48.4 | 50.9 | 52.0 | — | — |
| origin | warm | 0.4 | 0.5 | 0.9 | ≤ 50 | pass |
| pipeline | cold | 36.2 | 41.0 | 41.5 | — | — |
| pipeline | warm | 10.0 | 12.9 | 16.3 | ≤ 50 | pass |
| recruiters (cards) | cold | 67.6 | 111.5 | 112.4 | — | — |
| recruiters (cards) | warm | 7.5 | 8.2 | 8.4 | ≤ 50 | pass |
| list vacancies | cold | 54.9 | 64.6 | 64.7 | — | — |
| list vacancies | warm | 3.8 | 5.2 | 5.6 | ≤ 50 | pass |
| list deliveries | cold | 52.9 | 62.0 | 65.7 | — | — |
| list deliveries | warm | 1.5 | 2.0 | 2.1 | ≤ 50 | pass |
| list placements (audited) | cold | 51.2 | 56.0 | 57.0 | — | — |
| list placements (audited) | warm | 1.6 | 2.0 | 2.0 | ≤ 50 | pass |
| list reassignments | cold | 48.9 | 53.4 | 54.8 | — | — |
| list reassignments | warm | 0.9 | 1.2 | 1.3 | ≤ 50 | pass |
| list candidates (audited) | cold | 40.1 | 44.9 | 45.1 | — | — |
| list candidates (audited) | warm | 13.4 | 14.7 | 15.8 | ≤ 50 | pass |
| list applications | cold | 49.0 | 53.0 | 59.4 | — | — |
| list applications | warm | 0.9 | 1.3 | 1.3 | ≤ 50 | pass |

### Company dashboard routes (owner of A, `window=90`)

| Route | Mode | p50 ms | p95 ms | max ms | Budget (p95) | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| summary | cold | 215.5 | 236.2 | 241.0 | ≤ 400 | pass |
| summary | warm | 7.1 | 8.9 | 9.1 | ≤ 50 | pass |
| attention | cold | 208.3 | 225.3 | 225.4 | — | — |
| attention | warm | 10.6 | 11.7 | 11.8 | ≤ 50 | pass |
| pipeline | cold | 35.1 | 38.9 | 40.6 | — | — |
| pipeline | warm | 9.0 | 11.0 | 11.8 | ≤ 50 | pass |
| vacancies | cold | 170.8 | 178.8 | 179.2 | — | — |
| vacancies | warm | 0.6 | 0.8 | 0.9 | ≤ 50 | pass |
| recent | cold | 168.6 | 176.6 | 188.1 | — | — |
| recent | warm | 1.6 | 2.5 | 3.2 | ≤ 50 | pass |
| origin | cold | 169.1 | 177.6 | 182.6 | — | — |
| origin | warm | 1.4 | 1.7 | 1.8 | ≤ 50 | pass |
| list candidates (`in_process=true`) | cold | 176.9 | 188.2 | 190.9 | — | — |
| list candidates | warm | 9.5 | 10.6 | 11.9 | ≤ 50 | pass |
| list deliveries (`state=overdue`) | cold | 168.2 | 180.7 | 193.0 | — | — |
| list deliveries | warm | 0.4 | 0.7 | 0.9 | ≤ 50 | pass |
| list vacancies (`status=published`) | cold | 183.6 | 266.5 | 287.6 | — | — |
| list vacancies | warm | 0.9 | 1.3 | 1.4 | ≤ 50 | pass |
| list applications | cold | 173.8 | 190.0 | 192.7 | — | — |
| list applications | warm | 1.6 | 1.9 | 2.3 | ≤ 50 | pass |

The contract budgets only the cold summary; the other cold rows show what a section or list costs when it
is the first request of the minute.

Between runs on this machine, the percentiles moved by up to about 50 ms on a few cold rows (for example,
recruiters cold p95 was 64 ms in one run and 111 ms in this one). Dashboard list vacancies cold max reached
280–290 ms in every run. No run came near a budget.

### EXPLAIN (ANALYZE, BUFFERS) highlights

| Query | Execution ms | Seq Scan on | Indexes used |
| --- | --- | --- | --- |
| Load: scope | 0.7 | vacancy_processes, delivery configs, fulfillments, vacancy_assignments, lifecycle events, placement_credits, vacancy_reassignments (hashed subplans) | job_drafts company index, `process_participations_process_created_idx` (00060) |
| Load: vacancies | 4.4 | vacancy_processes, configs, fulfillments, vacancy_commitment_changes (per-row subplans) | job_drafts company index, `vacancy_assignment_functions_one_responsible` |
| Load: tramos / functions | 0.2 / 0.5 | vacancy_assignments, vacancy_assignment_functions | — |
| Load: closes | 0.9 | vacancy_close_target_changes (one subplan) | `vacancy_lifecycle_events_action_created_idx` (00059), `vacancy_close_target_changes_draft_idx` |
| Load: credits | 1.3 | placement_credits | process_participations / users pkeys |
| Load: origin | 4.7 | process_participations (10,161 of 20,374 rows match) | — |
| Load: entries | 18.8 | **participation_stage_history (all 44k intake/move/recovery rows)**, process_participations | — |
| LoadPipeline: participations | 20.6 | process_participations, users | `participation_history_order_idx` (2,409 subplan loops) |
| LoadHistory: tracks | **109–120** | process_participations, users | `participation_history_order_idx` (**9,075 subplan loops**) |
| LoadHistory: recent | 8.0 | (tiny tables) | `process_participations_process_created_idx` (00060), users pkey |

What the plans show:

- **Every page was already in memory**, so "cold" here means the app caches were empty, not that the data
  came from disk.
- **The heaviest query is LoadHistory's `tracks`: 109–120 ms, about two thirds of LoadHistory.** For each of
  the 9,075 participations it runs a separate lookup that builds a JSON list of that participation's stage
  changes. That lookup uses `participation_history_order_idx`. The planner's cost estimate (~150k) is above
  PostgreSQL's default `jit_above_cost` (100k), so JIT compilation also runs and adds about 14 ms
  (Generation 1.1 + Optimization 0.8 + Emission 12.7) to every execution.
- **Load: entries is the heaviest Load query (19 ms).** It hash-joins every participation and every
  intake/move/recovery history row in the database (not only company A's), then keeps the cutoff entries.
  It cost little only because the database is small. With many companies it grows with the whole table
  unless the planner switches to `participation_history_order_idx`.
- **Sequential scans on the large tables** (process_participations, participation_stage_history) are the
  planner's choice at this size:
  - origin keeps 50 % of process_participations, so a sequential scan is right.
  - entries, tracks and pipeline participations read 12–50 % of a 20k-row table.
  - The small tables (assignments, configs, credits, reassignments) are a few hundred rows.
  
  At production size the planner may choose differently. These plans say nothing about a database with
  many companies.
- **00059 / 00060 indexes:**
  - `vacancy_lifecycle_events_action_created_idx` (00059) is used by closes.
  - `process_participations_process_created_idx` (00060) is used by the scope's participation subquery and
    by recent.
  - `vacancy_assignments_draft_started_idx` (00059) was not used: vacancy_assignments has 910 rows and a
    sequential scan is cheaper.
  - origin does not use the 00060 index (half the table matches).
- **Tables filtered by vacancy or company with only a primary key** (from `pg_indexes`): placement_credits
  (no `process_id` / `company_id` index), vacancy_commitment_changes (no `draft_id`), vacancy_reassignments
  (no `draft_id` / `company_id`) and vacancy_processes (no `company_id`). The loaders scan them in full,
  either once (in the scope query) or once per vacancy (the commitment-change lookups in `vacancies`).

## Verdict

| Budget | Measured (p95) | Verdict |
| --- | --- | --- |
| Metrics cold `summary` ≤ 400 ms, incl. previous period | 56.8 ms | **pass** (14 % of budget) |
| Metrics warm section ≤ 50 ms | worst: pipeline 12.9 ms | **pass** |
| Metrics warm list page ≤ 50 ms | worst: candidates (audited) 14.7 ms | **pass** |
| Dashboard cold `summary` ≤ 400 ms | 236.2 ms | **pass** (59 % of budget) |
| Dashboard warm section ≤ 50 ms | worst: attention 11.7 ms | **pass** |
| Dashboard warm list page ≤ 50 ms | worst: candidates 10.6 ms | **pass** |

All budgets are met with the realistic seed. The company-dashboard-v2 §4 fallback (a nightly per-day
rollup) is **not needed**. The dashboard's cold path has the least headroom: LoadHistory takes about
185 ms at p95 and its `tracks` query is most of that.

### Caveats

- **The seed's previous period is almost empty**, because the seed covers 12 months: `Store.Load` for the
  previous 12 months takes 6.7 ms. A company with 24 months of history would load about as much for the
  previous period as for the current one. The summary runs both loads in parallel, so the expected cost is
  the slower of the two (about 50–60 ms here), not the sum. That case was not measured.
- **The database held only the two bench companies.** Plans and timings on a database shared by many
  companies (bigger `process_participations` and `participation_stage_history`) are not measured.
- **Not covered:** a single client making serial requests over loopback on one machine, so no network
  latency, no concurrent load and no contention on the database connection pool.
- **Recruiter scope not measured.** The dashboard routes ran as the owner, so the whole company was in
  scope. Recruiter scope narrows in Go and should cost less.

## Recommendations (not implemented)

None is needed to meet the budgets. In order of value if headroom becomes a concern:

1. **LoadHistory `tracks`** (largest gain, about two thirds of the dashboard's cold time):
   - Replace the per-participation JSON lookup with one ordered scan of `participation_stage_history` for
     the vacancies in scope (`ORDER BY participation_id, created_at, id`), grouped in Go. Or join a single
     `GROUP BY participation_id` aggregate.
   - Disable JIT for the history read (`SET LOCAL jit = off` inside its read-only transaction), or raise
     `jit_above_cost` on the server. Either saves about 14 ms per execution of this query.
   - Restrict tracks to vacancies that were open at some point in the 182-day window. Today it includes
     every published vacancy's participations that were not discarded before `since`, which takes in old
     closed vacancies.
2. **Load `entries`**: drive it from the configured vacancies' participations and look up history through
   `participation_history_order_idx`, for example with a LATERAL per participation or a `participation_id
   = ANY(...)` filter. That way it no longer hash-joins the whole history table, and its cost stays tied to
   one company when the database grows.
3. **Indexes to evaluate with EXPLAIN on a production-size copy before adding:**
   - `placement_credits (process_id)`
   - `vacancy_commitment_changes (draft_id, performed_at)`
   - `vacancy_reassignments (draft_id, performed_at)`
   - `vacancy_processes (company_id)`

   They matter only when these tables are large across companies; at this size the sequential scans are
   cheaper.
4. **Re-run this benchmark against a production-size copy.** The main gap in this measurement is a
   database with many companies and two years of history; repeat it before a big tenant onboards. To
   measure a larger company, change the `Bench` size fields the test passes (for example
   `Vacancies: 1000, Participations: 40_000`); the builder needs no other change.
