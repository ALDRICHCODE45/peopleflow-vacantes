# Metrics demo seed (dev only)

`cmd/devseed-metrics-demo` creates a separate company, **«Demo Métricas»**, in the local
database with about a year of realistic data, so the stakeholder metrics board
(`/empresa/metricas`) and its detail pages can be reviewed in the browser with numbers that
add up between sections and lists. It is **never** part of the migrations and never touches
another company (Trust People Company included).

Code: `internal/tools/metricsdemo` (plan, apply, remove, guards); the command is a thin
wrapper. Tracking: `odd/tasks/stakeholder-metrics-v2-backend.md` T8 (L10, L11).

## Before you run it

1. Register three **employer** accounts in the app with the normal sign-up (for example
   `nocheblanca92+demo-owner@…`, `+demo-stakeholder@…`, `+demo-recruiter@…`). Do **not**
   create a company with them: an account that already belongs to a company is refused.
2. The API's database must be the local `peopleflow_vacancies` (see `.env`).

## Guards

The command refuses, before opening any connection:

- a `DATABASE_URL` that is not a `postgres://` URL on exactly `127.0.0.1`, `localhost` or
  `::1` with the database exactly `peopleflow_vacancies` (query parameters that could move
  the host or database, such as `host`, `dbname` or `service`, are refused too);
- an environment marked production: `APP_ENV`, `ENV`, `ENVIRONMENT` or `GO_ENV` set to
  `production`/`prod`, or `APP_ENV` set to anything but empty, `local` or `test`.

Once connected, apply and remove check `current_database()` again before writing. The
command loads `backend/.env` like the API (without overriding the environment). The
integration test calls the package with its own pool and `TestOnlyDatabase("draft_test")`;
the command has no way to use that override.

## Commands

Run from `backend/`:

```sh
go run ./cmd/devseed-metrics-demo apply \
  --owner-email E --stakeholder-email E --recruiter-email E
go run ./cmd/devseed-metrics-demo remove
```

**apply** looks up the three accounts by email (case-insensitive). If any is missing, is a
candidate account, is a demo account, repeats another, or belongs to a company other than
the demo, it fails and writes nothing. Otherwise, in one transaction, it removes the
previous demo content (the same purge as `remove`) and writes the demo again with dates
recomputed from today (America/Mexico_City). Every id is a uuid v5 over a fixed namespace,
so running apply twice gives the same rows; re-running it on a later day refreshes the
dates. Anything done inside the demo company in the browser is discarded by a re-apply.

**remove** deletes, in one transaction and in dependency order, every row tied to the demo
company id, plus the fictitious users. Running it twice is fine (the second run deletes
nothing). The output lists the rows deleted per table.

## What it creates

- The company «Demo Métricas» (active), with the three accounts as **owner**,
  **stakeholder** and **recruiter**. The accounts' users rows are never modified.
- Five fictitious recruiters (users rows without a login, `@example.invalid` emails):
  Mariana Ortiz, Jorge Paredes, Lucía Hernández and Diego Navarro as members, and
  Valeria Ríos as a **former member** (membership removed; her tramos ended when she left,
  her history stays).
- Requesters: Banorte · Finanzas, Liverpool · Tecnología, Grupo Bimbo · Operaciones
  (clients) and Interno · RR. HH. (internal area); three vacancies without a requester and
  one «cliente sin especificar».
- 31 published vacancies over the last twelve months and one draft never published:
  - closes filled, cancelled, other (with note), one legacy close without reason, and one
    close (other) → reopen → close (filled); closing targets on time, late and none, one
    moved after the reopen;
  - deliveries in every result: on time, late in every bucket (including 0 business days:
    a Friday commitment reached on Saturday), overdue, pending (commitment today or later
    this month) and not configured; renegotiated commitments;
  - placements, one `did_not_hold`, shared credits (shared team) and participant credits;
  - reassignments with the five reasons (workload, recruiter_departure, performance with
    the previous responsible kept as collaborator, client_request, other with note);
  - applications through the four channels (portal, careers_site, manual intakes by a
    recruiter, unknown for legacy ones);
  - open vacancies (one paused) with candidates in every stage kind, a stored pipeline with
    a custom stage and a retired one, some stalled (≥ 7 business days on the metrics
    calendar) and some discarded.
- 60 fictitious candidate accounts (`candidatoNN.demo-metricas@example.invalid`) with a CV
  record each, and company CV records for the manual intakes. The CV files do not exist:
  downloading one fails.

The demo vacancies have no public projection, so they never appear on the public job
portal. They are meant for reading the metrics; acting on them in the board may hit that
missing projection.

Figures for a 12-month period with today = 2026-11-05 (from the integration test): 31
assigned; closed 16 filled, 4 cancelled, 1 other, 1 without reason; deliveries 12 on
time, 6 late (3 up to 2, 1 from 3 to 5, 2 over 5 business days), 5 overdue, 3 pending,
5 not configured; 20 placements (1 did not hold); 6 reassignments; 140 applications;
31 candidates in the pipeline, 15 stalled; 7 recruiter cards (one former member).

## What remove leaves

- **audit_events rows** written while the demo was used (for example `MetricsDetailViewed`
  from reading the placements or candidates lists). The table is append-only (its trigger
  refuses deletes) and has no foreign keys, so nothing blocks deleting the company; those
  rows keep the deleted demo ids. Remove does not use the purge bypass (decision L11).
- The three accounts' **users rows**, now without a company membership.

No other row stays: no table has a foreign key that blocks deleting the demo company or
its vacancies.

## Tests

```sh
make test PKG='./internal/tools/metricsdemo/... ./cmd/devseed-metrics-demo/...'
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  make test-integration PKG=./cmd/api/ RUN='^TestMetricsDemo'
```

The unit tests cover the guards, the deterministic ids, and the plan for every day of
2026–2028 (no instant after now, every designed delivery result, late bucket and stalled
flag holds). The integration test applies the demo, reads every section through the
production router as the owner, checks that every figure equals the total of its
drill-down list (with and without the common filters), that every case shows up, that a
second apply gives the same figures, that remove leaves only the rows above and another
company untouched, and that refused accounts write nothing.
