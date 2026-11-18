# Metrics demo seed (dev only)

`cmd/devseed-metrics-demo` creates a separate company, **«Demo Métricas»**, in the local
database with about a year of realistic data, so the stakeholder metrics board
(`/empresa/metricas`) and its detail pages can be reviewed in the browser with numbers that
add up between sections and lists. It is **never** part of the migrations and never touches
another company (Trust People Company included).

Code: `internal/tools/metricsdemo` (plan, apply, remove, guards); the command is a thin
wrapper. Tracking: `odd/tasks/stakeholder-metrics-v2-backend.md` T8 (L10, L11) and T13 (L23:
the demo vacancies open in the app).

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
company id, plus the fictitious users. That includes rows the app creates for the demo company
that the seed never writes: the careers site (opening `/empresa/sitio` lazily creates its
draft row) with its slug history and media, and legacy jobs (`POST /jobs`) with their
applications. Every statement is scoped by the demo company id or the fixed fictitious user ids.
Running it twice is fine (the second run deletes nothing). The output lists the rows deleted
per table.

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
- 31 published vacancies over the last twelve months and one draft never published. Each
  draft is the canonical schema-2 document the app's own create codec produces
  (`draftinput.DecodeCreateV2`), so the v2 draft routes read it. The demo holds only states the
  app can reach (unit test `TestBuildPlanStatesAreReachable`): every published vacancy has a
  complete delivery configuration, and no active candidate sits in a retired stage:
  - closes filled, cancelled, other (with note), one legacy close without reason, and one
    close (other) → reopen → close (filled); closing targets on time, late and none, one
    moved after the reopen;
  - deliveries in every result the app can reach: on time, late in every bucket (including
    0 business days: a Friday commitment reached on Saturday), overdue, and pending
    (commitment today or later this month); renegotiated commitments. There is **no «not
    configured»** delivery: the app publishes a vacancy only with a complete delivery
    configuration, and a never-published draft is outside the metrics;
  - placements, one `did_not_hold`, shared credits (shared team) and participant credits;
  - reassignments with the five reasons (workload, recruiter_departure, performance with
    the previous responsible kept as collaborator, client_request, other with note);
  - applications through the four channels (portal, careers_site, manual intakes by a
    recruiter, unknown for legacy ones);
  - open vacancies (one paused) with candidates in every current stage kind, a stored
    pipeline with a custom stage and a retired one, some stalled (≥ 7 business days on the
    metrics calendar) and some discarded. The retired stage is empty, as the app requires:
    the candidate who reached it was discarded from it before it was retired, so the metrics
    `retired` stage kind is 0 (omitted).
- 60 fictitious candidate accounts (`candidatoNN.demo-metricas@example.invalid`) with a CV
  record and a CV library entry each (the board shows the CV name), and company CV records
  for the manual intakes. The CV files do not exist: downloading one fails.

## What works in the app

Checked through the production router by the integration test
`TestMetricsDemo_DraftRoutesOpenEveryVacancy`, as the demo owner:

- the vacancy list `GET /v2/me/company/job-drafts` (`/empresa/vacantes`) lists all 32 demo
  drafts;
- for every demo draft, these answer 200: `GET /v2/me/company/job-drafts/{id}`, `…/pipeline`,
  `…/checklist`, `…/publication`, `…/team`, `…/management`, `…/pipeline/delivery` and
  `…/lifecycle`;
- `GET …/job-drafts/{id}/board` answers 200 for the 31 published vacancies. For the
  never-published draft it answers 409 `vacancy_not_published`, which is the app's normal
  response;
- every vacancy the dashboard links to (`dashboard/vacancies` and `dashboard/attention`,
  «Abrir pipeline») opens its board.

Not checked, or known not to work:

- **CV files**: none exist, so downloading a CV (`…/participations/{pid}/cv`, `…/cv/original`)
  fails.
- **Public projection**: the demo writes no `vacancy_public_projections` rows. Demo vacancies
  never appear on the public portal (`/jobs`), and the views that join that projection skip
  them: the candidate-side application views, psychometric invitations, and board duplicate
  hints. The fictitious candidates cannot sign in anyway.
- **Writes** are not covered by the test (moving candidates, lifecycle actions, saving a
  draft, team changes) or the per-candidate reads (`…/participations/{pid}`, `/history`).
  Manual-intake participations point at a company CV without a `company_candidates` row.
  Use the demo for reading. Anything you change is discarded by the next apply.

## Figures

Figures for a 12-month period (from the integration test). Today = 2026-11-05 and
today = 2026-11-17 give the same totals; only the monthly on-time series moves. 31 assigned;
closed 16 filled, 4 cancelled, 1 other, 1 without reason; deliveries 14 on time, 6 late
(3 up to 2, 1 from 3 to 5, 2 over 5 business days), 7 overdue, 4 pending, 0 not
configured (on-time rate 14/27); 20 placements (1 did not hold); 6 reassignments;
140 applications (portal 68, careers site 37, manual 19, unknown 16); 30 candidates in
the pipeline (new 12, screening 7, screening OK 4, in process 4, custom 1, placement 2),
14 stalled; top vacancies by in process: Cajero Universal 3, Ingeniero DevOps 3,
Desarrollador Frontend 2, Oficial de Cumplimiento 2, Reclutador TI 2; 7 recruiter cards
(one former member).

## What remove leaves

- **audit_events rows** written while the demo was used (for example `MetricsDetailViewed`
  from reading the placements or candidates lists). The table is append-only (its trigger
  refuses deletes) and has no foreign keys, so nothing blocks deleting the company; those
  rows keep the deleted demo ids. Remove does not use the purge bypass (decision L11).
- The three accounts' **users rows**, now without a company membership.

No other row stays. Remove also clears the app-created rows listed under **remove**, so no
foreign key blocks deleting the demo company or its vacancies
(`TestMetricsDemo_RemoveDeletesAppCreatedRows`).

## Tests

```sh
make test PKG='./internal/tools/metricsdemo/... ./cmd/devseed-metrics-demo/...'
DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:55432/draft_test?sslmode=disable' \
  make test-integration PKG=./cmd/api/ RUN='^TestMetricsDemo'
```

The unit tests cover the guards, the deterministic ids, the plan for every day of
2026–2028 (no instant after now, every designed delivery result, late bucket and stalled
flag holds), that every draft passes the persisted schema-2 validation, and that the plan
holds only app-reachable states. The integration test applies the demo, reads every section through the
production router as the owner, checks that every figure equals the total of its
drill-down list (with and without the common filters), that every case shows up, that a
second apply gives the same figures, that remove leaves only the rows above and another
company untouched, and that refused accounts write nothing. The route tests check the
vacancy list and per-vacancy routes listed above, and that remove copes with app-created
rows.
