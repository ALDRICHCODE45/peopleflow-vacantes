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

- T1 S1-S2 — reproduce with a failing test, find the root cause, fix (writer) — pending

## Log

- **L1** 2026-11-24, :8080 log (main 276ebd74+, dev DB v64): five `POST …/pipeline/preview` → 500 between 01:46:04
  and 01:46:42 local, `code_class 5xx`, no error log line (the handler logs nothing for the cause).
