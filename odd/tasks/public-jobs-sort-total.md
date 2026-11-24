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

- T1 S1-S5 — sort + total (writer) — pending
- T2 — suite, merge, notify frontend — pending

## Log

- **L1** 2026-11-22, user: «Bien hermano, vamos a realizar todos los pendientes que mencionas por favor, coordinate con
  el frontend para realizar lo que se tenga que realizar (tu haciendo el backend y el haciendo el frontend)».
- **L2** 2026-11-24, frontend session (overnight audit; relays that the user, asleep, authorized coordinating backend
  gaps): request quoted in S1. S3 and the 1000 cap are backend decisions pending the user's confirmation.
