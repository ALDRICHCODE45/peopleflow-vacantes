# Coverage on vacancy list rows (backend)

Additive field on the employer drafts/vacancies list so the frontend can show «Cubierta al cierre». Branch
`feat/list-row-coverage-backend` (worktree `../peopleflow-vacantes-coverage`). Frontend in its own session (reads it
optional and nullable, may ship first).

## Specs

- **S1** Each row of the employer list (`GET /v2/me/company/job-drafts`, list v2; frontend `rowSchema` in
  `frontend/src/features/jobs/drafts/list/client.ts`) carries `coverage: { "covered": int >= 0, "required": int >= 1 |
  null }`, `null` for a draft without a process, with the same live semantics as the board's `board.coverage`.
  Always present.
- **S2** Frontend request verbatim (L2). Existing list behavior (filters, order, pagination, other keys) unchanged.

## Tasks

- T1 S1-S2 — list row coverage (writer) — commit: ffd7426e
- T2 — suite, merge, notify frontend — done (merged into local main)

## Log

- **L1** 2026-11-22, user: «Bien hermano, vamos a realizar todos los pendientes que mencionas por favor, coordinate con
  el frontend para realizar lo que se tenga que realizar (tu haciendo el backend y el haciendo el frontend)».
- **L2** 2026-11-22, frontend session: «el usuario eligió el copy «Cubierta al cierre» cuando la cobertura en vivo cae
  por debajo de la requerida; si no, sigue diciendo «Cubierta». En el tablero ya está, con board.coverage. Las filas de
  la lista de borradores/vacantes (GET de la lista; rowSchema en frontend jobs/drafts/list/client.ts) no traen
  cobertura. Pedido aditivo: `coverage: { covered: int ≥0, required: int ≥1 | null }` en cada fila, `null` en
  borradores, con la misma semántica en vivo que board.coverage.»
- **L3** 2026-11-22, writer T1 (S1-S2): every row of `GET /v2/me/company/job-drafts` carries `coverage`
  `{ "covered": int, "required": int|null } | null` (key right after `candidates`), `null` without a process. `covered` = participations
  in the current Placement stage (first `placement` stage of the page's pipeline, board's rule), `required` = `hiring_headcount`
  (null if unset): computed inside the single page statement (left join `job_draft_management_configs`, per-stage totals reused from
  `candidate_counts`), no per-row query. RED: integration test `TestDraftListCoverageFlow_RowsFollowTheBoardLive` failed on the missing key;
  GREEN after the change, including departure after close (covered 1 → 0 like the board). Rows now have 24 keys.
- **L4** 2026-11-22, parent: committed ffd7426e. Jobs unit packages ok; integration ok except
  `TestJobsMigrationDownDropsTable` (legacy migration 00007, pre-existing on main, also seen in
  replacement-processes-backend L13/L14 and replacement-followups L9). `cmd/api` DraftList|ListFlow|ReplacementList|
  DraftFlow|Departure ok. Merged into local main; :8080 restarted from main.
