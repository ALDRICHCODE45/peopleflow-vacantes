# Replacement follow-ups (backend)

Backend follow-ups of replacement processes (`replacement-processes-backend.md`, frontend `replacement-processes.md`
L12–L13, `frontend-backlog.md`) plus the end of the birth date transition. Branch `feat/replacement-followups-backend`
(worktree `../peopleflow-vacantes-followups`). Frontend in its own session (adds the board field optional first).

## Specs

- **S1** Board item: every pipeline board item (board list, detail, original, move/discard/recover/substate, credits,
  manual create responses) carries `carried_from_participation_id`: the source participation id (UUID string) for a
  row carried into a replacement, `null` otherwise. Additive, always present. Relayed from the frontend backlog:
  ««Retomado» mark on carried cards needs `carried_from_participation_id` on board items».
- **S2** Dashboard: «dashboard participation charts count carried participations (backend)». A carried row is not a
  new application: it is excluded from every figure presented as applications or origin (company dashboard
  origin-by-day chart, dashboard applications list, recent applications), as metrics v2 `origin`/`applications`
  already do. Operational figures keep counting carried rows (in-process series and counts, candidates list, pipeline
  stage counts and stalled, period activity), per replacement-processes-backend L17 (d).
- **S3** Birth date transition ends: user 2026-11-22 «No, todavía no hay prod» (no old client remains). `PUT` of the
  candidate profile rejects a `birth_date` key like any other unknown key (400 `invalid_request`, repository never
  called). Frontend confirmed it no longer sends `birth_date` (`profile-api.ts:39`, strict write schema).
- **S4** Carry candidates discard reason (frontend request L4): each `carry_candidates[]` item of `GET V/replacements`
  carries `discard_reason`: `{"group": "recruiter"|"candidate", "key": "<catalog key>"}` (same shape as the board
  item's `discard.reason`) from that participation's `reason_group`/`reason_code` when `discarded` is true, `null`
  otherwise. Additive, always present.

## Tasks

- T1 S1 — board item field (writer) — commit: 61cf2107
- T2 S2 — dashboard carried exclusion (writer) — commit: 61a9bbb1
- T3 S3 — birth date rejected (parent inline) — commit: ff3b7888
- T5 S4 — carry candidates discard reason (writer) — commit: f68e728d + contract docs commit after 61cf2107
- T4 S1–S4 — docs, full suite, merge — done (merge into local main)

## Log

- **L1** 2026-11-22, user: «Bien hermano, vamos a realizar todos los pendientes que mencionas por favor, coordinate con
  el frontend para realizar lo que se tenga que realizar (tu haciendo el backend y el haciendo el frontend)».
- **L2** 2026-11-22, user decisions: production «No, todavía no hay prod»; AWS «Sí, ya está la cuenta»; documents
  «PDF, Word, Excel, JPG/PNG · 10 MB (Recomendado)»; delete «Propietario y reclutadores; auditado (Recomendado)».
- **L3** 2026-11-22, exploration: board item is hand-written SQL (`board/store.go:115-203`, `app.Item`
  `application/board/movement.go:122-138`); wire-shape tests `movement_corrections_test.go:12-27`,
  `cmd/api/board_corrections_flow_integration_test.go:44`, `v2/movement_regression_integration_test.go:88`,
  `v2/manual_read_integration_test.go:159`; contract `replacement-processes-v1.md:584` says the board item is unchanged
  (L11) — superseded by S1. Metrics: `loadTracks` (`metrics/infrastructure/postgres/history.go:155-162`) feeds origin
  chart (`application/dashboard.go:547-578`), applications list (`dashboard_lists.go:570-609`), in-process and
  candidates list; `loadRecent` (`history.go:180-193`); `loadOrigin` already excludes carried. Birth date:
  `candidates/infrastructure/http/handler.go:98-103`, tests `handler_test.go:750,784,804-818`,
  `harmonization_shape_test.go:33`.
- **L4** 2026-11-22, frontend session: «en GET V/replacements, `carry_candidates[]` no trae el motivo del descarte
  (replacement_carry_read.go:26-27 y :63-64 solo leen discarded_at y previous_stage_id). El follow-up «carry rows do not
  show the discard reason» lo necesita. Propuesta: `discard_reason: {group, key}`, con la misma forma que
  `discard.reason` de los items del tablero (pipeline-movement discardReasonSchema: group recruiter|candidate y la key
  del catálogo). Presente solo cuando `discarded` es true; si no, ausente o null.» Decided: always present, `null`.
- **L5** 2026-11-22, T3 done `ff3b7888`: RED (subtest got 200), GREEN; candidates packages ok. The unknown-key error
  body is the generic `invalid JSON body` (it does not name the key), like every other unknown key.
- **L6** 2026-11-22, T5 done `f68e728d` (writer): `carry_candidates[]` items gain `discard_reason` `{group,key}` (same
  keys as the board `app.Reason`) or `null`; items have 7 keys. RED (unit build failure; integration comparison without
  the key), GREEN: draftstore unit + integration, `cmd/api` `TestReplacement*` on a throwaway postgres:16. Contract
  section still to update in T4.
- **L7** 2026-11-22, T1 done `61cf2107` (writer): `Item.CarriedFromParticipationID` (last key; also in the hand-written
  `Moved.MarshalJSON` allowlist); board list, detail, manual create, move/discard/recover/substate. `original` is a
  separate type (not an item) and credits only read the item, so neither changes. RED (key absent), GREEN; applications
  unit + integration ok; `cmd/api` integration: only `TestPublicGeoSearchIndexCapability` failed (known planner flake on
  stale stats / empty geo, ROADMAP). Docs `pipeline-movement.md`, contract ~L584 supersedes L11.
- **L8** 2026-11-22, T2 done (writer): `Track.Carried`; origin-by-day and applications list (also `total`/CSV) skip
  carried tracks; `loadRecent` filters carried in SQL (the section is «Candidatos recientes» / «Últimas postulaciones y
  registros», presented as applications). In-process, candidates list and stage counts keep them. RED (unit: 4 organic
  instead of 1; integration with the SQL reverted), GREEN; metrics unit + integration, `cmd/api` Dashboard|Metrics|
  Replacement|MX|Origin 106 PASS. `scopeSQL` untouched.
- **L9** 2026-11-22, T4: full backend suite on the branch against a throwaway postgres:16 (`draft_test`, migrations,
  geo `-skip-postal-codes`): `make test PKG=./...` exit 0; integration `-p 1` 117 packages ok, 2 FAIL —
  `identity/infrastructure/postgres` (`TestUsersMigrationDownDropsTable`, legacy down migration blocked by FKs) and
  `jobs/infrastructure/postgres` (legacy `applications`/jobs tables dropped by legacy migration tests on a shared DB).
  Both packages are untouched by the branch and fail the same way on `main` c2fde6bd on a fresh database:
  pre-existing, not regressions. Merged into local main; user pushes.
