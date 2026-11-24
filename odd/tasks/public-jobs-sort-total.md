# Public vacancy listing: sort and total (backend)

Additive change to the public vacancies listing so the frontend can sort and show «N vacantes». Branch
`feat/public-jobs-sort-total` (worktree `../peopleflow-vacantes-pubsort`). Frontend in its own session.

## Specs

- **S1** Request verbatim (L2): «el listado público GET de vacantes no permite ordenar. Pedido aditivo:
  `sort=recent|salary_desc|salary_asc`, con `recent` como default igual al orden actual, y un `total` en la respuesta,
  o al menos `total_capped: {count, capped}` si contar sale caro, para poner «N vacantes» en el encabezado.»
- **S2** `sort` query param: `recent` (default; absent = exactly today's order and pagination), `salary_desc`,
  `salary_asc`. Any other value → 400 with the listing's existing validation error shape. The cursor stays valid only
  for the sort it was issued with (a cursor from another sort → the listing's existing invalid-cursor error).
- **S3** Salary privacy (backend decision): salary sorts order only by the salary the public ad already shows. A
  vacancy whose salary is not public sorts AFTER every vacancy with a public salary (then by the `recent` order), so
  the order never reveals a hidden salary. Salary ranges sort by the same figure the filters use (check
  public-salary-filters; document which bound).
- **S4** `total: {"count": int, "capped": bool}` in the response, counted with the same filters as the page,
  independent of `sort` and cursor, capped at 1000 (`capped: true` and `count: 1000` when more exist). Always present.
- **S5** Existing filters, response keys and recent ordering unchanged (existing tests keep passing).

## Tasks

- T1 S1-S5 — sort + total (writer) — done, uncommitted (L3)
- T2 — suite, merge, notify frontend — pending

## Log

- **L1** 2026-11-22, user: «Bien hermano, vamos a realizar todos los pendientes que mencionas por favor, coordinate con
  el frontend para realizar lo que se tenga que realizar (tu haciendo el backend y el haciendo el frontend)».
- **L2** 2026-11-24, frontend session (overnight audit; relays that the user, asleep, authorized coordinating backend
  gaps): request quoted in S1. S3 and the 1000 cap are backend decisions pending the user's confirmation.
- **L3** 2026-11-24, writer (T1): `sort` + `total` on `GET /v2/jobs`, contract `docs/contracts/public-jobs-sort-total-v1.md`,
  backend doc `backend/docs/public-jobs-v2.md` § «Sort and total». RED: unit `sort_total_test.go` failed to compile
  (no `Query.Sort`, `Position.Salary*`, `Page.Total`); integration `TestPublicJobsSortAndTotal`/`TestPublicJobsTotalCap`
  through the production router failed on the old code (`sort=…` → 400 `invalid_request`, `total` absent). GREEN:
  unit `make test` of `./internal/features/jobs/... ./cmd/api ./internal/db`; integration (`-tags=integration -p 1`,
  throwaway postgres:16 `draft_test`) of `./cmd/api`, `applications/.../postgres/v2`, `jobs/.../draftstore`,
  `jobs/.../savedjobs`, `publicjobs`, `http`: all ok; gofmt, vet (both tags), `make gate-sqlc` pass; archguard only
  the known docker/minio violation. Salary bound (S3): `salary_desc` uses the top (`max`, fixed `amount`; the figure
  `salary_min` compares), `salary_asc` the bottom (`min`, fixed `amount`; the figure `salary_max` compares). Totals
  (S4): one statement, `total` CTE = `count(*)` over `SELECT 1 FROM ranked LIMIT 1001`, `LEFT JOIN`ed to the page so
  empty pages keep it; `ranked` is `NOT MATERIALIZED` and seniority is read from a column, so the count branch builds
  no card bodies (checked with `EXPLAIN (GENERIC_PLAN, VERBOSE)`). Seeded 1000 → `{1000,false}`, 1001 → `{1000,true}`.
  Deviations: (1) units — S3 does not say how to compare unlike units; to honour SAL-6 (no conversion) salary sorts
  order by tier: MXN·monthly·gross first, each other unit combination its own fixed tier, then legacy salaries (no
  period/basis), then hidden/absent, with the amount compared only within a tier (needs user/frontend confirmation);
  (2) S5 vs S4 — two existing tests pinned the list envelope at exactly 2 keys
  (`publicJobsHandler_test.go` «list», `public_jobs_flow_integration_test.go`); updated to 3 keys + `total` shape, no
  other existing test changed; (3) sqlc row now carries `sort_group`, `sort_salary`, `total_count`, and the
  geo-index test's direct `SearchPublicJobs` call keeps passing with an empty `sort_order` (= recent).
- **L4** 2026-11-24, parent: committed e30e9183. Full backend suite on the branch (throwaway postgres:16): unit exit 0;
  integration 122 packages ok, only the legacy pre-existing `identity/infrastructure/postgres` and
  `jobs/infrastructure/postgres` FAIL (same on main); archguard only docker/minio. Frontend agreed contract and the
  unit blocks; merge waits for the frontend (its listing schema must accept `total` first; deployment order).
