# Vacancy checklist F1 — backend

Backend half of the vacancy checklist. Contract: `docs/contracts/vacancy-checklist-v1.md` (frontend branch
`feat/vacancy-checklist` @4ac0bef4, frontend session 01a18189-ce79). Branch `feat/vacancy-checklist-backend` from main
7d4a7f29; merged here, the user pushes.

## Specs

- **S1 Checklist storage.** `GET/PUT /v2/me/company/job-drafts/{id}/checklist`: `{version, criteria[0..50],
  reminder_stage_ids}`; never saved → `{"version":"0","criteria":[],"reminder_stage_ids":[]}` (never 404); PUT full
  replacement with required If-Match (428 / 412 / 400 malformed), opaque hashed ETag like substates; identical PUT is a
  no-op; audit `JobDraftChecklistConfigured` {version, previous, new} in the same transaction.
- **S2 Criterion validation.** Kinds `min_years_experience`, `seniority`, `education`, `language`, `skill`, `location`,
  `screening_answer`, `manual` with exact params (unknown keys `not_allowed`); 400 `validation_error` with `fields`
  (`required`, `invalid`, `too_long`, `duplicate`, `not_allowed`); screening questions must be single-choice questions
  of the vacancy with existing options; location country/state from the geo catalog; reminder stages must be current
  pipeline stages (GET filters retired ones).
- **S3 Marks.** `GET …/checklist/marks` → `{items:[Mark]}` for every participation (discarded included) of criteria
  still in the checklist; `PUT …/participations/{pid}/checklist-marks/{criterion_id}` `{verdict, note}` → 200 Mark,
  last write wins, identical write is a no-op; `DELETE` → 204 idempotent; audit `ParticipationChecklistMarked`
  {vacancy_id, criterion_id, previous, new}; 404 for foreign participation or unknown criterion.
- **S4 Access and lifecycle.** Same gates as the board (recruiter, owner-or-principal → 404 otherwise); writes on a
  finished process → 409 `process_finished`; GETs always work (marks → empty without process).

## Tasks

| ID | Specs | Route | Commit |
|----|-------|-------|--------|
| T1 | all | inline — contract review, adjustments sent to frontend | — |
| T2 | S1, S2 | inline — pure package `jobs/application/checklist` (decode, validate, ETag, marks) + unit tests | f84da991 |
| T3 | S1, S2, S4 | worker — migration, draftstore checklist GET/PUT, handler, routes, integration tests | 6e6ab52e |
| T4 | S3, S4 | worker — marks storage, endpoints, integration tests | 8273cade |
| T5 | all | inline — docs, live run for frontend QA, review, merge | — |

## Log

- **L1** (frontend session, verbatim summary of the request): «el backend guarda y valida el checklist por vacante (GET
  y PUT con ETag/If-Match, reemplazo completo, auditoría JobDraftChecklistConfigured) y las marcas del reclutador por
  postulación (GET masivo .../checklist/marks, PUT y DELETE por criterio, auditoría ParticipationChecklistMarked; last
  write wins). La evaluación automática NO la calcula el backend en v1».
- **L2** Adjustments sent to frontend (agent decision, user asleep): hashed ETag `"vc1-…"` instead of literal "0";
  envelope carries `error`; `too_long` instead of `too_many`; location params use geo `.id`; screening only single
  choice; stale reminder stages filtered on GET; writes blocked when process finished; marks follow criterion id
  (new id when kind/params change); identical mark write no-op; marked_by.full_name resolved at read; audit snapshots
  are JSON strings; at most one location criterion. Branch renamed `feat/vacancy-checklist-backend` (frontend owns
  `feat/vacancy-checklist`).
- **L3** Verification: `go vet ./...`, `go test ./...` (incl. scripts/closure after fixing the archguard `"code"` literal
  and regenerating sqlc models) and integration `go test -p 1 -tags=integration` on cmd/api, applications v2 and jobs
  against draft_test: all green. Commit slices: T2 grammar, T3 checklist storage, T4 marks (each its own commit).
