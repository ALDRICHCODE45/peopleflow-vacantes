# Pipeline preview answers 500 on vacancies with candidates (bugfix)

Branch `fix/pipeline-preview-500` (worktree `../peopleflow-vacantes-pipefix`).

## Specs

- **S1** Report (verbatim, frontend overnight audit B, 2026-11-24): «en una vacante con candidatos, cualquier cambio de
  estructura del pipeline (renombrar, agregar o reordenar columnas) falla. POST
  /v2/me/company/job-drafts/{id}/pipeline/preview → HTTP 500, y no se guarda nada. Reproducido en «Auditoría B —
  Analista de pruebas de pipeline» 01a20c74-ee53-7325-9aea-b86a36255ba0 (owner de Altavista, con
  nuevos/screening/placement y una baja) y en la demo 01a20a4d-db56-7ec7-bb85-5600657ae4af (solo preview, cancelado).
  Guardar subestados sí funciona.» Frontend caller: frontend/src/features/jobs/drafts/pipeline/client.ts:105.
- **S2** Expected: preview (and the subsequent apply) of a structure change on a vacancy with participations answers
  per its contract (pipeline-customization docs), never 500; nothing is saved by preview.

## Tasks

- T1 S1-S2 — reproduce with a failing test, find the root cause, fix (writer) — fixed, in review (L2); open: the
  slog census manifest in `backend/cmd/api/task63_logging_security_a1h_test.go` (outside the writer surface) needs
  the new handler log call registered

## Log

- **L1** 2026-11-24, :8080 log (main 276ebd74+, dev DB v64): five `POST …/pipeline/preview` → 500 between 01:46:04
  and 01:46:42 local, `code_class 5xx`, no error log line (the handler logs nothing for the cause).
- **L2** 2026-11-24, T1 (writer). **Root cause**: `pipelineImpact` loaded the board with
  `process_participations p JOIN users u ON u.id=p.candidate_id`
  (`backend/internal/features/jobs/infrastructure/postgres/draftstore/pipeline_impact.go:51` on main). Company-added
  (manual) participations have `candidate_id NULL` + `company_candidate_id`, so the inner join dropped them, but the
  history query (by process) still returned their rows, and `people[byID[pid]]` (`:85`) indexed with the zero value of
  a missing map key: all-manual board → `people` empty → `panic: index out of range [0] with length 0`, which chi
  `Recoverer` turns into a bodiless 500 (stack on stderr only, no slog line: L1). Mixed organic+manual board: no panic,
  but manual candidates silently missing from the impact and their history credited to the first organic
  participation. Rename/add/reorder all hit it because the read runs before any diff. Not related to 00063/00064,
  departures, credits or substates. Apply (PUT) shares `pipelineImpact`, so it failed the same way.
  **RED** (`TestPipelinePreviewAndApplyOnBoardWithManualCandidatesAndDeparture`, throwaway postgres:16, v64): rename,
  reorder and add previews each `panic: runtime error: index out of range [0] with length 0` at
  `pipeline_impact.go:85` → `preview …: 500`. Mixed-board test against the old join semantics: `not_applicable:[]`,
  `has_impact:false` (manual candidate in En proceso unmarked).
  **Fix**: the query LEFT JOINs users and company_candidates (scoped to the process company) and takes candidate
  id/name as the board projection does (`COALESCE(cc.id,u.id)`, organic name corrections); a history row for a
  participation outside the locked set is now an error instead of a wrong index. `pipelineHandler` logs every 500
  (GET/PUT/preview) as `pipeline handler failed` with request_id, method, route pattern, code_class, error_type,
  sqlstate (driver errors, message never logged) or cause (other errors); responses unchanged.
  **Tests**: new `backend/cmd/api/pipeline_preview_participations_integration_test.go` (manual new/screening/placement,
  discarded, Placement departure did_not_hold; rename/reorder/add preview 200 + exact impact + nothing written;
  unconfirmed PUT 409 `impact_confirmation_required`, confirmed PUT echoes the preview impact and writes 2 marks;
  organic+manual board) and `backend/cmd/api/pipeline_failure_log_test.go` (bounded log record; contract errors log
  nothing). Integration green: cmd/api `TestPipelinePreview|TestPipelineFlow|TestPipelineRoutes|TestColumn` and
  `Pipeline|Column|Impact|Substate`, draftstore/postgres/pipelineconfig, applications/postgres/v2 `Column|Pipeline|Impact`
  (14 Columns/Movement DB tests). Unit: jobs/... green; cmd/api red only on
  `TestTask63A1h_RuntimeHandlerSlogCallCensus` (19 calls, want 18): the new call is direct literal keys, none
  forbidden; the manifest needs 19, direct 10 and
  `backend/internal/features/jobs/infrastructure/http/pipelineHandler.go|ErrorContext|direct_literal_keys: 1`.
  gofmt/vet (+integration) clean; archguard only docker/minio; no SQL files changed (no sqlc gate).
- **L3** 2026-11-24, parent: kept the cause logging (driver errors log only SQLSTATE; other causes are internal
  invariant/scan errors without row values) and registered the new slog call in the census test
  `task63_logging_security_a1h_test.go` (19 calls, 10 direct). `make test` on ./cmd/api and ./internal/features/jobs/...
  green; removed the writer's stray .orig.bak and /tmp log. Merged into local main; :8080 restarted.
