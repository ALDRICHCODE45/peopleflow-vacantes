# Pipeline column editing with candidates (cut 7) — frontend

Frontend of backend cut 7 (`docs/pipeline-customization-design.md` §17 in the backend repo
`/home/aldrich_coder45/Desktop/workspace/peopleflow-vacantes`, branch `feat/pipeline-column-editing`).
Branch `feat/pipeline-column-editing-ui`, stacked on `feat/pipeline-board-filters-ui`.

## Specs

- S1. User decision (verbatim): «Cada uno se queda en su columna (Recomendado)» — reordering with candidates keeps every candidate in its column; the new order only affects future moves; with preview; history is never rewritten.
- S2. User decision (verbatim): «"No aplica por cambio de proceso" (Recomendado)» — a column now before a candidate who never went through it is recorded as not applicable; never completed, never delivery.
- S3. User decision (verbatim): «Permitir; al recuperar se elige columna (Recomendado)» — removing the previous column of discarded candidates is allowed; on recovery the recruiter picks the column, nearest earlier one proposed by default; audited.
- S4. Contract §17.2 (backend): `POST …/pipeline/preview` (PUT body without `confirm_impact`, no If-Match) → 200 exactly `{stages:[{id,kind,name}], not_applicable:[{participation_id,candidate:{id,full_name},stage_id}], recovery_reassigned:[{participation_id,candidate:{id,full_name},retired_stage_id,default_stage_id}], has_impact}`; PUT gains optional `confirm_impact`; impact without it → 409 `impact_confirmation_required`; removing a column with active candidates → 409 `stage_occupied` details `[{stage_id}]`; cutoff → 409 `cutoff_stage_in_use`; `stage_change_requires_empty_pipeline` no longer returned; PUT 200 always has `applied_impact:{not_applicable,recovery_reassigned}`; GET/PUT gain `retired:[{id,kind,name}]`; `structure_locked` now means "structure changes need an impact preview". Board gains `retired_stages:[{id,kind,name}]`; `discard.recovery_stage_id`; `POST …/recover` gains optional `to_stage_id` (required → 409 `recovery_stage_required` when the previous column was removed; must be absent otherwise → 400; outside range [default and earlier progression stages] → 400). History kind `not_applicable` `{kind,stage_id,actor,at}`.
- S5. UI rules: docs/frontend-ui-design-rules.md (all, incl. §17 dense panels, §18 ConfirmActionDialog for every important action, §19 official shadcn composition). Never invent data; no automatic retries; strict decoders.

## Tasks

- T1 [pending] S1-S5 | writer A | Column configuration page: unlock reorder/add/remove with candidates, preview → ConfirmActionDialog with impact → PUT confirm_impact, errors, applied_impact toast, retired decode; pipeline client/model. | commit: -
- T2 [pending] S1-S5 | writer B | Board: retired_stages, history not_applicable, recover with to_stage_id selection, board column reorder with candidates via preview. | commit: -
- T3 [pending] | parent | Guide step, queue item, full suite. | commit: -

## Log

- L1. User (verbatim): «sigan con la unidad 7 y si la terminan, con lo que sigue, etc..obviamente si hay decisiones de producto, pues tendran que esperar a que despierte, pero traten de hacer trabajo que no requiera eso». Answers above given in the questionnaire of 2026-10-19; contract accepted by the frontend with `applied_impact` echo and preview `stages`.
