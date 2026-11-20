# Replacement processes v1 (internal, employer-only)

Status: **DRAFT, frontend review applied (2026-11-19, Log L7)**, not implemented; nothing is agreed beyond the user decisions quoted in
§«Decisions» and §«Decisions status». The 13 review points are folded into the sections below (D14-D16, §«Deployment order»). Product source: the 2 Oct 2026 agreement «procesos de reemplazo vinculados a la vacante original».
Tracking: `odd/tasks/replacement-processes-backend.md` (branch `feat/replacement-processes-backend`). The backend
session wrote this contract; the frontend session reviews it before any implementation slice starts. Style follows
`vacancy-team-v1.md` and `stakeholder-metrics-v2.md`. Every `path:line` below is a backend path (under `backend/`) at the
commit this draft was written against.

## Purpose

A vacancy closes covered, a hired candidate later leaves («no se sostuvo»), and today the recruiter can only mark the
placement as `did_not_hold`. This contract adds the **replacement process**: an explicit, user-started, new process
for the same logical vacancy, linked to the original, to its fallen placement credits and to the candidates that can
be reused. The original result never changes; the replacement has its own board, delivery, coverage, team, clock and
metrics. A replacement of a replacement stays in the same logical vacancy.

The system is not in production and all data is disposable: the migration may be strict and the endpoints may change
before the first implementation slice.

## Backend facts this contract builds on

- **One id for draft and process.** `vacancy_processes.id` is `job_drafts.id` (`db/migrations/00019_create_vacancy_processes.sql:4`);
  every per-process table keys on that id: `job_draft_pipeline_configs`, `job_draft_substate_catalogs`,
  `job_draft_delivery_configs`, `job_draft_management_configs` (00015–00018), `job_draft_checklists` (00048),
  `job_draft_psychometric_profiles` (00049), `vacancy_teams` (00054), `process_participations.process_id`,
  `process_delivery_fulfillments.process_id` (00027), `process_coverage_milestones.process_id` (00023),
  `vacancy_lifecycle_events.process_id` (00034), `placement_credits.process_id` (00054, no FK).
- **A process row exists from publication on.** `vacancy_processes` requires `published_at`/`published_by`
  (00019) and its two axes are `status ∈ published|paused|closed` and `process_status ∈ active|finished` (00034:
  `vacancy_finished_requires_closed`). `Publish` inserts the row and the public projection together
  (`internal/features/jobs/infrastructure/postgres/draftstore/publication.go:144-147`); the board needs the row
  (`internal/features/applications/infrastructure/postgres/board/store.go:55-73` → `app.ErrNotPublished`,
  code `vacancy_not_published`).
- **Public visibility is the projection row, not the process row.** The public catalog reads `vacancy_public_projections`
  joined to `vacancy_processes.status='published'` (`internal/db/public_jobs.sql.go:84-107`); candidate application
  reads join the projection (`internal/features/applications/infrastructure/postgres/v2/store.go:57,239`). A
  **replacement** without a projection is private; an original with a process row is public whether or not its
  projection exists (R3e, «R3e implementation notes»).
- **Lifecycle read model.** `lifecycle.View {publication, process, version, published_at, paused_at, closed_at,
  process_finished_at, allowed_actions, close_reason, close_reason_note}`
  (`internal/features/jobs/application/lifecycle/lifecycle.go:16`), built by `readLifecycle`
  (`…/draftstore/lifecycle.go:254`) and rendered by `GET V/lifecycle`, every lifecycle transition, the `lifecycle`
  key embedded in configuration responses (`…/draftstore/lifecycle_effects.go:34-61`) and the `data` of
  `process_finished` / `lifecycle_transition_invalid`. `AllowedActions` is `lifecycle.go:44`.
- **Close «filled» already means covered.** `POST V/lifecycle/close` with `reason = filled` is rejected with 422
  `close_reason_not_covered` unless live Placement coverage ≥ `hiring_headcount`
  (`…/draftstore/lifecycle.go:159-181`, `db.ReadPlacementCoverage`, `internal/db/coverage.go:18`). Reopen is allowed today
  from any closed state (`internal/features/jobs/application/lifecycle/lifecycle.go:44-60`); it only checks that a `with_responsible` team still has a responsible
  (`…/draftstore/lifecycle.go:184-191`).
- **Who may run lifecycle actions.** `publicationDraft(…, write=true)` (`…/draftstore/publication.go:181`): the
  general gates (`lockGates`, `…/draftstore/store.go:408`) plus `authorized` = company owner OR an active tramo on the
  draft's team (`…/draftstore/store.go:451`); the route group requires the recruiter role (`cmd/api/router.go:387-388`,
  stakeholders excluded). There is no per-function restriction.
- **Board writes.** `beginMutation` (`…/postgres/board/store.go:77-89`) returns `*app.ProcessFinished` (409
  `process_finished`, `data` = lifecycle view) when `vacancy_processes.process_status = 'finished'`. A **closed process that
  continues** (`close` with `process = continue`) is writable today. It is used by moves, discards/recoveries
  (`…/postgres/board/discard.go:32-37`), substates (`…/board/substate.go:56`); manual intake has its own finished guard
  (`…/board/manual_create.go:80-95`).
- **Placement credits.** `placement_credits` (`00054`) has `status active|did_not_hold|voided`, `exit_reason
  moved_by_mistake|candidate_left`; leaving Placement through a move or a discard records the exit and sets
  `did_not_hold` (`candidate_left`) or `voided` (`moved_by_mistake`) in the same tx (`…/board/credits.go:19-77`).
  Coverage is the live count of participations in the Placement stage (`internal/db/coverage.go:12-14`).
- **Manual intake of an existing candidate** reuses `existing: {kind: manual|organic, id}`
  (`internal/features/applications/application/board/manual_validation.go:127-150`) and inserts a participation with an
  `intake` history row, then `RecordDelivery` (`…/board/manual_create.go:119-141`). Participation identity is
  `candidate_id` (organic user) XOR `company_candidate_id` (manual) (`00038:11`); `source='organic'` requires `added_by IS
  NULL`, `source='manual'` requires `added_by IS NOT NULL` (`00038:13-16`); a company CV file cannot be shared between rows
  (`company_candidate_cvs.storage_key UNIQUE`, `00037`).
- **Metrics.** The engine loads one `Vacancy` per `vacancy_processes` row with any activity in the period
  (`internal/features/metrics/infrastructure/postgres/store.go:69-87`) and computes figures in `summarize`
  (`internal/features/metrics/application/summary.go:202`); common filters are parsed in `application/filters.go`.

## Decisions

Quoted words are the user's, verbatim from the feature doc (`odd/tasks/replacement-processes-backend.md`). **The «Spec» column is the
feature doc's `S#`** (S1 model, S2 start, S3 several credits, S4 publication, S5 reused candidates, S6 REO-2, S7 REP-7, S8 states, S9 metrics,
S10 frontend needs); `D#` are this contract's decision numbers and do not follow the `S#` order after D1.

| # | Spec | Decision |
| --- | --- | --- |
| D1 | S1 | **A replacement is a NEW job draft + vacancy process** (new id), cloned from the source and linked to the source process, to the logical-vacancy root and to the fallen credits it replaces. Why a new draft + process and not a flag on the original: every per-process table is keyed by the draft id (facts above), so a separate id gives the replacement its own board, pipeline, delivery fulfillment, coverage milestones, lifecycle, team and credits with **zero change** to those tables, while the original keeps its closed result byte for byte. |
| D2 | S2 | «Placement «no se sostuvo» + vacante cerrada (rec.)». Start requires the source to be the **latest process of the chain** (D14), **closed**, and ≥ 1 **startable credit**: a `did_not_hold` credit of any process of the logical vacancy (source or chain) that no replacement has taken yet. A source that is closed with `process_status = active` is **finished by the start itself, atomically** (D15); a source already finished is accepted as is. No time limit. **Explicit start**: nothing starts by itself. |
| D3 | S3 | «Un reemplazo puede cubrir varias bajas (recomendado)»: `placement_credit_ids` is a list; `target_quantity` defaults to its length (and may not be lower). Each credit belongs to at most one replacement (`UNIQUE`); a replacement that closes without covering is **reopened** (S6 «como hoy»), not re-linked. |
| D4 | S4 | «Privado por defecto, con opción de publicarlo (recomendado)». Relayed: «Publicarlo es opcional y sale como aviso normal, sin decir que es reemplazo; publicarlo después no reinicia el reloj.» A replacement is **private** (process row, no projection) unless `publish: true`; publishing later creates only the projection through the existing `POST V/publication`. The ad is the source content: nothing public says «reemplazo». The process clock is `vacancy_processes.published_at` = `started_at` and never moves. |
| D5 | S5 | «Cualquiera, sin entrar directo a Placement (rec.)» and «En cualquier etapa menos Placement (Recomendado)»: any candidate of the original chain (discarded or still in the pipeline) can be carried as a **new participation** at the recruiter-chosen stage, audited, never Placement (nor the exit stage). |
| D6 | S6 | «Si cerró cubierta: reemplazo, no reabrir (Recomendado)». Relayed: «Si la vacante cerró cubierta, «Reabrir» desaparece y aparece «Iniciar reemplazo»; si cerró sin cubrirse, se puede reabrir como hoy.» **Closed covered** = `status = 'closed'` AND the latest close event's reason is `filled` (§«Closed covered»). Reopen then answers 409 `reopen_requires_replacement`. |
| D7 | S7 | «Con el proceso cerrado, solo «No se sostuvo» (Recomendado)». Relayed: «Con el proceso cerrado o finished, el tablero sigue de solo lectura salvo una acción: marcar que un contratado de Placement se fue (motivo candidate_left o moved_by_mistake). La cobertura baja y queda habilitado «Iniciar reemplazo». El resultado original no se toca.» One exception to the finished guard: **discard** of a participation that sits in Placement (§«Departure on a finished process»). |
| D8 | S8 | «Mismos estados con insignia «Reemplazo» (Recomendado)». Relayed: «Activo» = proceso no terminado (process_status active), uno solo por vacante lógica. A replacement uses the same two lifecycle axes; `kind = replacement` is the badge. **Active** means `process_status = 'active'`; at most one active process per logical vacancy once a replacement exists (D14, D15, §«Concurrency»). |
| D9 | S9 | «Una vacante lógica, reemplazo separado (Recomendado)». Relayed: «La vacante cuenta una sola vez, no como nueva. Entregas, tiempo y placements del reemplazo son del proceso, con filtro «Originales / Reemplazos» y una insignia en los detalles. El resultado original no cambia.» **Vacancy-level figures count the root only; process-level figures count every process** and carry the `process_kind` filter (§«Metrics»). |
| D10 | S10 | The frontend needs map to: `GET V/lifecycle` (+ `kind`, `replacement_of`, `root_process_id`, `can_start_replacement`), the draft list (+ `kind`, `root_process_id`), `POST V/replacements` with `replacement_already_active`, the departure on a finished process, and the metrics filters. |
| D11 | S1 | **Stages map 1:1 by kind and name; ids follow the stored-pipeline invariant.** The replacement's pipeline has the source's stages, kinds, names and order. Built-in stages (`new`, `screening`, `screening_ok`, `in_process`, `placement`, and the exit) MUST have ids `UUIDv5(draft id, kind)` (`decodeStoredPipeline` rejects anything else, `…/draftstore/pipeline.go:182-192`), so they get **new ids derived from the new draft id**; custom stages (≤ 3) keep their source ids (stage ids are only unique per process: `process_participations` is keyed by `(process_id, stage_id)`, no global constraint). Requests therefore name stages by their **source id** (what the frontend already has from the source board) and the server maps them; the 201 response returns the mapping. |
| D12 | S1 | **Permissions mirror the lifecycle.** Whoever may run lifecycle actions on the **source** (owner or active tramo on the source's team, recruiter role) may start a replacement; nothing is stricter. |
| D13 | S1 | **The team is fresh, not cloned.** The replacement opens with its own `with_responsible` team: the caller as `responsible` (vacancy-team-v1 Q2), or `responsible.user_id` when the owner names someone else. The source's tramos, deadlines and reassignments stay on the source. |
| D14 | S8 | **Only the latest process of a chain starts or reopens.** The chain is ordered original (position 0), then replacements by `sequence`. Only its **latest** process may be the `{id}` of `POST V/replacements` and only it has `can_start_replacement = true`; any other process answers 409 (`replacement_source_not_latest`, or `replacement_already_active` when the latest is an active replacement). A process that already has a successor can no longer be reopened (A7). |
| D15 | S8 | **Start finishes a closed-active source.** To keep «uno solo activo por vacante lógica», starting a replacement from a source that is `closed` with `process_status = 'active'` (a `close` with `process = continue`) finishes that source **in the same transaction** (lifecycle event `finish_process`, `lifecycle_version + 1`, existing audit `VacancyProcessFinished` with `cause = replacement_started`). A source that is already `finished` is accepted as is. After a start every earlier process of the chain is finished; the only active one is the new replacement. |
| D16 | S10 | **Late departures keep working on finished sources.** Finishing the source (D15) does not close the door on S7: the Placement departure exception (§«Departure on a finished process») applies to it, so a hired candidate of the original can still be marked as gone and its credit becomes startable for the next replacement. |

## What is cloned and what is fresh

| Piece | Replacement gets | Notes |
| --- | --- | --- |
| `job_drafts` | **cloned**: `fields` bytes (all content), `requester_kind`/`requester_id`; `version = 1`, `status = 'draft'`, `created_by` = caller, new `created_at`/`updated_at` | Same title, description, requirements, location, requester: the ad is the same ad. |
| `job_draft_pipeline_configs` | **cloned** from the source's *effective* configuration (stored or default) as a stored row, `version = 1`; built-in stage ids re-derived for the new draft, custom ids kept (D11); `retired` list dropped | The source's effective configuration is read with `readPipeline` (`…/draftstore/pipeline.go:153`, default ids = `Defaults(sourceID)` when no row). |
| `job_draft_substate_catalogs`, `job_draft_checklists`, `job_draft_psychometric_profiles` | **cloned** rows, `version = 1` | `participation_checklist_marks` are **not** cloned (fresh per participation). |
| `job_draft_delivery_configs` | `cutoff_stage_id` **mapped** to the new id of the same stage (D11); `target_quantity` = request `target_quantity`; `commitment_date` = request `commitment_date`; `version = 1` | The replacement has its own client commitment. |
| `job_draft_management_configs` | `hiring_headcount` = `target_quantity`; `request_date` = start date (Mexico City); `target_close_date` null | Required headcount for coverage = positions to refill. |
| `vacancy_teams` + tramos | **fresh** (D13) | `createTeam` (`…/draftstore/team.go:35`) with `VacancyTeamCreated`. |
| `vacancy_processes` | **fresh** row: `status = published`, `process_status = active`, `lifecycle_version = 1`, `published_at = started_at`, `published_by` = caller | No `vacancy_lifecycle_events`, no fulfillment, no coverage milestones, no commitment changes. |
| `vacancy_public_projections` | only when `publish: true` (or later, D4) | |
| `process_participations` | only the carried candidates (D5) | Fresh ids, versions and history; no checklist marks, substates, psychometric invitations, discards. |
| `placement_credits` | none | The replacement's own hires create their own credits through the normal move path. |

## Data model (migration 00063, proposal)

The latest migration is `00062_drop_birth_date_and_cover_letter.sql`; this one is `00063_replacement_processes.sql`.

```sql
-- One row per replacement process; the original (root) process has NO row, so «kind» is derivable:
-- row present = replacement. process_id is the new draft id.
CREATE TABLE vacancy_replacements (
  process_id        uuid PRIMARY KEY REFERENCES vacancy_processes(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id),
  source_process_id uuid NOT NULL REFERENCES vacancy_processes(id),   -- the process the user started it from
  root_process_id   uuid NOT NULL REFERENCES vacancy_processes(id),   -- the original of the logical vacancy; same for the whole chain
  sequence          integer NOT NULL CHECK (sequence >= 1),           -- 1-based position in the chain, assigned under the root lock
  started_at        timestamptz NOT NULL,                             -- = vacancy_processes.published_at
  started_by        uuid NOT NULL REFERENCES users(id),
  target_quantity   integer NOT NULL CHECK (target_quantity BETWEEN 1 AND 999),
  CHECK (process_id <> source_process_id AND process_id <> root_process_id),
  UNIQUE (root_process_id, sequence)
);
CREATE INDEX vacancy_replacements_source_idx ON vacancy_replacements(source_process_id);

-- The fallen credits a replacement replaces. A credit is replaced at most once (D3).
CREATE TABLE vacancy_replacement_credits (
  replacement_process_id uuid NOT NULL REFERENCES vacancy_replacements(process_id) ON DELETE CASCADE,
  placement_credit_id    uuid NOT NULL UNIQUE REFERENCES placement_credits(id),
  PRIMARY KEY (replacement_process_id, placement_credit_id)
);

-- Lineage of a carried participation (D5); NULL for every normal participation.
ALTER TABLE process_participations
  ADD COLUMN carried_from_participation_id uuid NULL REFERENCES process_participations(id);
CREATE INDEX process_participations_carried_idx ON process_participations(carried_from_participation_id)
  WHERE carried_from_participation_id IS NOT NULL;
```

- **Root and chain.** For the original `root = its own id`; for a replacement `root_process_id` is copied from the source's
  row (or the source id when the source is the original). A replacement of a replacement therefore keeps the same root
  and gets `sequence = max(sequence of the root) + 1`. The chain of a logical vacancy is `{root} ∪ {process_id : root_process_id = root}`.
- **Same company.** Enforced in the transaction (every id is read scoped to the session company); the FK graph cannot
  express it, as for `placement_credits`.
- **Why `carried_from_participation_id` is a column and not a table.** The candidate-facing and metrics readers need a
  cheap «is this a carried row» predicate (§Implementation notes); the lineage is also the audit anchor.
- **Down** is supported with the guard pattern of 00053/00054: under `ACCESS EXCLUSIVE` locks it refuses with a clear
  message while any `vacancy_replacements` row or any `carried_from_participation_id` exists; otherwise it drops the
  column and the two tables.

## Rules

### Closed covered (D6)

`closed_covered ⇔ vacancy_processes.status = 'closed' AND the reason of the latest 'close' event in vacancy_lifecycle_events = 'filled'`
(the value `readLifecycle` already loads as `close_reason`, `…/draftstore/lifecycle.go:275-277`). It is derived from
existing data because a `filled` close was only accepted with live coverage ≥ `hiring_headcount`
(`…/draftstore/lifecycle.go:159-181`), so «filled» is the system's own statement of «cerró cubierta». Consequences:

- It does **not** follow the live coverage afterwards: after a departure (D7) the original stays closed covered, the
  original result is untouched, and Reopen stays unavailable. The way back to coverage is a replacement.
- A close with reason `cancelled`, `other` or no reason (legacy rows) is **closed not covered**: Reopen works as today.
- `allowed_actions` of a closed covered process drops `reopen` (it keeps `finish_process` while `process = active`). `reopen` is also dropped when `active_replacement_id` is non-null and is **not the process itself**, and when the process has a successor in the chain (D14, A1, A7): see §«Reopen guards».
- Direct `POST V/lifecycle/reopen` on a closed covered process → **409 `reopen_requires_replacement`** (checked at the
  existing «invalid state» step, before body/readiness checks, so it never masks a stale-ETag 412).
- Closed covered with no startable credits: neither Reopen nor Start are offered (`can_start_replacement = false`, blocker
  `no_startable_credits`); the first departure enables Start.

### Start preconditions (D2, D3, D5, D14, D15)

Evaluated in this order inside one transaction, after the general gates, key shape, replay and `If-Match` (as `reopen` does). Every
409 below carries `data.lifecycle` = the **source's** lifecycle view (what the screen already shows), plus the ids named.

1. Source resolved and authorized (D12); never published / no process row → 409 `replacement_source_not_closed`.
2. Source `status = 'closed'` (closed covered, closed not covered, closed+active and closed+finished all qualify) → else 409
   `replacement_source_not_closed` (**one** table entry for open, paused and never-published sources; `data: { lifecycle }`).
3. Source is the **latest** process of the chain (D14) → else, if the chain has an active replacement (`process_status = active`)
   → 409 `replacement_already_active` (`data: { process_id, root_process_id, lifecycle }`), otherwise 409
   `replacement_source_not_latest` (`data: { latest_process_id, root_process_id, lifecycle }`).
4. Body validation (shape; `target_quantity ≥ len(placement_credit_ids)`; `commitment_date`) → 400 `validation_error` with `fields[]`
   (`internal/shared/httpjson/validation_errors.go:10-22`): `{ field: "target_quantity", code: "below_credits_count" | "out_of_range" }`,
   `{ field: "commitment_date", code: "out_of_range" }`; a non-business `commitment_date` keeps its own 400 `non_business_date`;
   shape errors stay 400 `invalid_request`.
5. Every credit: belongs to a process of the chain and company; `status = 'did_not_hold'`; no row in `vacancy_replacement_credits` → else
   422 `replacement_credits_invalid`.
6. Carried candidates (§Carried candidates) → 422 `carried_candidate_invalid` / `carried_stage_invalid`.
7. Responsible (§Team) → 422 `not_company_member` / 403 `team_action_forbidden`.
8. `publish: true` → the source's public readiness (`publicationRequirements`, `…/draftstore/publication.go:246`) → 422 `publication_incomplete` with `missing`.

On success, **after** all checks and before returning: if the source is `closed` with `process_status = 'active'`, it is finished (D15): `UPDATE
vacancy_processes SET process_status='finished', process_finished_at=$now, lifecycle_version=lifecycle_version+1`, a
`vacancy_lifecycle_events` row (`action = 'finish_process'`, `process` NULL, actor = caller), and `VacancyProcessFinished` with
`cause = replacement_started` (§Audit events). The source's lifecycle ETag therefore changes; the 201 response carries the source's new
lifecycle view in `source.lifecycle` (informative).

### Concurrency (D8, D14, D15)

Once a replacement exists, at most one process of the chain is **active** (`process_status = 'active'`): D15 finishes the source, so the
only active process afterwards is the new replacement. Lock order extends the existing draft → process → participation order
(`…/postgres/board/store.go:75-76,292`): the **source draft row** `FOR UPDATE` (same as lifecycle transitions, so Start serializes with
close/reopen/finish of the source) → the **root process row** `FOR UPDATE` (`SELECT … FROM vacancy_processes WHERE id = $root FOR UPDATE`,
a fresh statement), then the **source process row** when it is not the root (fixed root-then-source order) → the credit rows `FOR UPDATE`
(re-validating `did_not_hold`, so an owner void/restore racing the start serializes) → inserts and the source finish. With the root lock
held the transaction reads the chain, decides «latest» and «active replacement», computes `sequence` and inserts; two simultaneous starts
from the same source serialize and the loser, which now finds a successor, gets `replacement_already_active` (the winner's replacement is
active) or `replacement_source_not_latest`. `UNIQUE (placement_credit_id)` and `UNIQUE (root_process_id, sequence)` are the backstop. A
concurrent `finish_process` of the source or of the active replacement commits either before the check or after it; both outcomes are
consistent. The new draft id is fresh, so it contends with nothing.

### Reopen guards (A1, A7; D14)

`POST V/lifecycle/reopen` additionally answers, at the existing «invalid state» step (before body/readiness checks, after the
`reopen_requires_replacement` check):

- 409 `replacement_already_active` (`data: { process_id, root_process_id, lifecycle }`) when the chain has an active replacement **other than the
  process being reopened** (A1, user-confirmed: «No, bloqueado mientras haya uno activo»).
- 409 `reopen_superseded` (`data: { successor_process_id, root_process_id, lifecycle }`) when the process already has a successor in the chain
  (A7): its logical vacancy moved on to a replacement, so only the latest process can be reopened. Reopening the latest process, including a
  closed-not-covered or closed-active replacement, works as today.

The matching `allowed_actions` rule (point 5 of the review): `reopen` is absent when `closed_covered`, or `active_replacement_id` is non-null and
≠ the process's own id, or the process has a successor.

### Carried candidates (D5)

`carried_candidates[]`: `{ "candidate": { "kind": "manual" | "organic", "id": "<uuid>" }, "stage_id": "<source stage uuid>" }`. The
`candidate` pair is the same identity the manual intake (`existing`) and the talent pool already use: `kind = manual` →
`company_candidate_id`, `kind = organic` → the candidate's user id. (The feature doc named `company_candidate_id`; that
alone cannot address organic applicants, who have no company candidate, hence the pair — assumption A2.)

- **Which candidates the UI offers.** `GET V/replacements` returns `carry_candidates[]` (below) resolved with exactly this «most recent
  participation» rule, excluding candidates that are currently placed and the **departed hires** (S11). **The POST `stage_id` is chosen among the stages of the SOURCE process**
  (`{id}`; the frontend already has them from the source's pipeline/board). The list shows the candidate's previous stage **only by `kind` and
  `name`** (never an id: that id belongs to another process of the chain).
- **Source of truth.** The candidate must have (or have had) a participation in any process of the chain; the
  **most recent one** (`created_at DESC, id DESC`) is the template. Otherwise 422 `carried_candidate_invalid`
  (`reason: not_in_chain`, which also covers other companies; no leak).
- **Template copy.** The new participation copies the template's identity, `source`, CV references
  (`cv_version_id` / `company_candidate_cv_id` / `corrected_company_cv_id`), `profile_snapshot`,
  `questions_snapshot`, `answers_snapshot` and `origin_channel`, so no file is duplicated (the CV storage key is unique).
  `added_by` is the caller for `source = manual` and stays NULL for `source = organic` (constraint `00038:13-16`);
  `created_at` = `started_at`; `version = 1`; `carried_from_participation_id` = the template. It is **never discarded
  and never has a stage history from the source**: one `intake` history row (`actor_kind = recruiter`, shape allowed by
  `participation_history_movement_shape`, `00038`) at the chosen stage, the stage-entry hook and the delivery hook run as
  for a manual intake.
- **Stage.** `stage_id` is a **source-pipeline stage id** (D11). It is mapped to the replacement's stage (built-in by
  kind, custom by the same id) and must map to a progression stage that is neither `placement` nor the exit stage:
  otherwise 422 `carried_stage_invalid` (`reason: stage_not_found | stage_is_placement | stage_is_exit`;
  `stage_not_found` also covers a retired or unknown source stage, which the clone drops). The 201 response returns the
  new stage ids.
- **Not carried.** A candidate whose most recent participation is **currently in Placement** (an active hire) →
  `carried_candidate_invalid` (`currently_placed`); a duplicate candidate in the list → `duplicate`.
  A candidate whose credit was voided (`moved_by_mistake`) is a valid carry («Cualquiera»).
- **Departed hires (S11, R3d).** User: «No, excluirla del reemplazo (Recomendado)». A candidate is a **departed hire** when **any** participation of
  theirs in the chain has a departure from Placement with exit reason `candidate_left` (the `did_not_hold` credit's own participation included, not
  only the most recent participation). Such a candidate is not offered in `carry_candidates[]` and cannot be carried: 422 `carried_candidate_invalid`,
  reason `departed_hire`. A `moved_by_mistake` departure (a voided credit) does **not** make anyone departed. If the person comes back, the recruiter
  adds them manually.
- **Delivery.** A carried intake counts for the replacement's delivery with the manual-intake rule, for both sources
  (assumption A3): at the cutoff stage, or at a stage after it, it is a delivered candidate, and the delivery may fulfil
  inside the start request. This needs the `RecordDelivery`/`reachedCandidates` rule
  (`…/draftstore/fulfillment.go:80-117`, which today looks at `p.source = 'manual'`) to treat
  `carried_from_participation_id IS NOT NULL` like manual intake.
- At most 200 carried candidates per request (proposal; the board read itself caps at 1000 participations, `…/postgres/board/store.go:249-251`); above it 400 `validation_error`.
- Each carried candidate is audited (`VacancyCandidateCarried`, §Audit events) with the stage.

### Team (D13)

`responsible` is optional. Omitted → the caller is the responsible (vacancy-team-v1 Q2). `{ "user_id": … }` naming
**another** member requires the caller to be the company **owner** (it is a handover; vacancy-team-v1 «Reassign the
responsible» is owner-only): otherwise 403 `team_action_forbidden`. The named user must be a current company member
(422 `not_company_member`, same code as vacancy-team-v1). A non-owner caller is always on the new team (they are the
responsible), so they keep access to what they created; an owner naming someone else keeps access as owner.

### Private by default, publish later (D4)

- A private replacement has a `vacancy_processes` row (it needs one: participations, board, lifecycle) and **no
  `vacancy_public_projections` row**, so it is invisible to the public catalog, candidate applications and saved jobs
  (all of which join the projection).
- `publish: true` inserts the projection in the start transaction (`writePublicProjection`, `…/draftstore/public_projection.go:52`).
- **Publish later** uses the existing `POST V/publication` (same body `{}`, same `Idempotency-Key`/`If-Match`, same
  readiness and `publication_incomplete`). For a replacement without a projection it inserts **only the projection**; the
  `already_published` check (`…/draftstore/publication.go:125`) becomes «projection exists». Only while the process is
  `published` or `paused` (closed → 409 `lifecycle_transition_invalid`). `VacancyPublished` is emitted as today. The
  projection's `published_at` is the publication time (what candidates see); `vacancy_processes.published_at` is not
  touched: **the clock does not restart**.
- `GET V/publication` for a private replacement answers `status: "draft"` with the readiness list, so the existing
  publish UI keeps working; once the projection exists it answers `published`.
- **Only replacements can be private (R3e).** Everything above about «a process row without a projection» applies to
  replacements only; an original keeps the publication semantics it had before this contract (see «R3e implementation notes»).
- **Required fix (gotcha).** `refreshPublicProjection` (`…/draftstore/public_projection.go:44`, called from `save_v2.go:90,130`)
  upserts the projection whenever a process row exists. For a private replacement that would publish it on the first
  save. It must refresh only when a projection already exists, and `GET V/publication`/`Publish` must key on the
  projection (`readPublishedAt`, `…/publication.go:47,120`), not on the process row.
- The public ad shows nothing about replacement: no field of `vacancy_public_projections` or of the public API changes.

## Endpoints

Prefix `V = /v2/me/company/job-drafts/{id}` (the existing job-draft routes, `cmd/api/router.go:388-450`, same
`NoStore` + `requireAuth` + `requireRecruiter` group). Errors are JSON `{error, code, data?}`; the 404 collapse and
`team_access_ended` behave as on every draft route.

### `POST V/replacements`

`{id}` is the **source** process: the **latest** process of the chain, which must be closed (D14; a closed-active source is finished by the start, D15). Headers: `Idempotency-Key` (UUID, required; stored
in `job_draft_idempotency`, operation `vacancy-replacement:r1`, fingerprint includes the source id and the canonical
body; replay returns the frozen response with `Idempotency-Replayed: true`), `If-Match` = the **source's lifecycle
ETag** (`"vl-<id>-v<n>"`, `GET V/lifecycle`; missing 428, malformed 400, stale 412, exactly as lifecycle transitions,
`lifecycle.CheckPrecondition`).

```json
{
  "placement_credit_ids": ["…", "…"],
  "responsible": { "user_id": "…" },
  "target_quantity": 2,
  "commitment_date": "2026-12-15",
  "publish": false,
  "carried_candidates": [
    { "candidate": { "kind": "manual", "id": "…" }, "stage_id": "…" },
    { "candidate": { "kind": "organic", "id": "…" }, "stage_id": "…" }
  ]
}
```

- `placement_credit_ids`: required, 1..999 distinct UUIDs.
- `target_quantity`: optional, default `len(placement_credit_ids)`; integer 1..999 and ≥ `len(placement_credit_ids)`; otherwise 400
  `validation_error` with `fields: [{ "field": "target_quantity", "code": "below_credits_count" | "out_of_range" }]`.
- `commitment_date`: required `YYYY-MM-DD`, same rules as the delivery PUT
  (`internal/features/jobs/application/deliveryconfig/config.go:115-118`): within today..today+1 year in Mexico City
  (400 `validation_error`, `fields: [{ "field": "commitment_date", "code": "out_of_range" }]`), a business day (400 `non_business_date`).
- `responsible`, `publish` (default `false`), `carried_candidates` (default `[]`): above. Unknown keys, wrong types or a
  non-object body → 400 `invalid_request`.

Response **201** (headers `Location: /v2/me/company/job-drafts/{new_id}`, `ETag` = the new process' lifecycle ETag
`"vl-<new_id>-v1"`, `Idempotency-Replayed`):

```json
{
  "id": "<new draft id = new process id>",
  "kind": "replacement",
  "sequence": 1,
  "replacement_of": "<source process id>",
  "root_process_id": "<root process id>",
  "visibility": "private",
  "started_at": "2026-11-19T18:00:00.000000Z",
  "started_by": { "id": "…", "name": "Ana López" },
  "responsible": { "id": "…", "name": "Ana López" },
  "target_quantity": 2,
  "commitment_date": "2026-12-15",
  "placement_credit_ids": ["…", "…"],
  "stage_map": [
    { "kind": "new", "source_stage_id": "…", "stage_id": "…" },
    { "kind": "custom", "source_stage_id": "…", "stage_id": "…" }
  ],
  "carried": [
    { "participation_id": "…", "carried_from_participation_id": "…",
      "candidate": { "kind": "manual", "id": "…" }, "stage_id": "<new stage id>" }
  ],
  "delivery": { "delivered": 1, "target": 2, "fulfilled": false },
  "source": { "id": "<source process id>", "finished_by_start": true, "lifecycle": { "…": "the source's new lifecycle view" } },
  "lifecycle": { "…": "the new process' lifecycle view, §GET V/lifecycle" }
}
```

**What the frontend decodes (point 11).** Only `id`, `kind`, `lifecycle` and the headers (`Location`, `ETag`, `Idempotency-Replayed`).
`stage_map`, `carried[]` (including `carried[].stage_id`), `delivery`, `source` and the other keys are **informative**: they may gain keys
and the frontend must not depend on them or parse them strictly.

Errors (new codes in **bold**, §Error codes):

| Status | Code | When |
| --- | --- | --- |
| 400 | `validation_error` (+ `fields[]`: `target_quantity`, `commitment_date`) | §Start preconditions 4 |
| 400 | `invalid_request`, `non_business_date`, `idempotency_key_required`, `invalid_idempotency_key` | existing semantics |
| 403 | **`team_action_forbidden`** (existing team code) | non-owner names another responsible |
| 404 | `not_found`, `team_access_ended` | source not visible to the caller |
| 409 | **`replacement_source_not_closed`** | source is not closed (open, paused, never published); `data: { lifecycle }` |
| 409 | **`replacement_source_not_latest`** | source is not the latest process of the chain (D14) and no replacement is active; `data: { latest_process_id, root_process_id, lifecycle }` |
| 409 | **`replacement_already_active`** | the chain already has an active replacement; `data: { process_id, root_process_id, lifecycle }` (`lifecycle` = the source's) |
| 409 | `idempotency_conflict` | same key, different payload |
| 412/428 | `version_conflict` / `precondition_required` | stale / missing lifecycle ETag |
| 422 | **`replacement_credits_invalid`** | `data.credits: [{ credit_id, reason: "not_in_chain" \| "not_did_not_hold" \| "already_replaced" }]` |
| 422 | **`carried_candidate_invalid`** | `data.candidates: [{ index, reason: "not_in_chain" \| "currently_placed" \| "departed_hire" \| "duplicate" }]` |
| 422 | **`carried_stage_invalid`** | `data.candidates: [{ index, reason: "stage_not_found" \| "stage_is_placement" \| "stage_is_exit" }]` |
| 422 | `not_company_member`, `publication_incomplete` (+ `missing`) | existing codes |

Atomic: draft, clones, team, process, link rows, carried participations, projection (when `publish`), idempotency row and
audit events commit or roll back together (fail-closed audit, as `Append` does today).

**R3a implementation notes** (what the first Start slice does; the rest of the contract is unchanged):

- **Not yet accepted (superseded).** R3a answered 400 `invalid_request` to `publish: true` and to a non-empty `carried_candidates`; since R3b the carried list is accepted
  (see «R3b implementation notes») and since R3c `publish: true` is accepted (see «R3c implementation notes»). `publish: false` and `publish: null` are private. A start
  that carries nobody answers `carried: []` and `delivery: { delivered: 0, target, fulfilled: false }`.
- **Body.** Shape errors are `invalid_request`: not an object, unknown key, `placement_credit_ids` absent / empty / above 999 / not canonical lowercase UUIDs /
  duplicated, `commitment_date` absent or not `YYYY-MM-DD`, `target_quantity` not an integer, `responsible` not exactly `{ user_id }`. Range errors are
  `validation_error` with every offending field in this order: `target_quantity` (`out_of_range` for outside 1..999, which outranks `below_credits_count`),
  then `commitment_date` (`out_of_range` outside today..today+1 year, Mexico City); `non_business_date` only when nothing else is wrong.
- **Credits.** Reasons are decided in the order `not_in_chain` (unknown id, another company, a process outside the chain), `not_did_not_hold`, `already_replaced`;
  `data.credits` lists only the problems, in request order, and a request with any problem creates nothing. Valid credits are row-locked first.
- **Replay and ETag.** The replay check comes before `If-Match` (a stale ETag replays); the fingerprint is the canonical body bound to the source id, so a
  whitespace-only change replays and any other change, or another source, is 409 `idempotency_conflict`. When two starts race on a closed-**active** source, the
  loser can answer 412 `version_conflict` (the winner finished the source, which moved its ETag) instead of 409 `replacement_already_active`; both are the
  contract's «stale» and «active» outcomes. On a finished source the loser is always `replacement_already_active`.
- **Clone.** Besides the pieces in §«What is cloned», the checklist's `reminder_stage_ids` and the psychometric profile's `auto_send_stage_ids` name stages, so they
  are carried through the stage map (a retired stage that has no counterpart is dropped, as the reads already hide it). The 201's `stage_map` lists the
  progression stages in order, then the exit stage.
- **Audit.** `VacancyReplacementStarted` metadata uses numbers for `sequence`, `target_quantity`, `carried_count` and a **sorted** `credit_ids` list; the new draft
  and team emit `JobDraftCreated` / `VacancyTeamCreated`; a closed-active source emits `VacancyProcessFinished` (version = source version + 1, `publication =
  closed`, `process = finished`, `cause = replacement_started`, `replacement_process_id`; the two new keys are absent on ordinary finishes).
- **Private by default.** Start inserts the process row and, unless `publish: true` (R3c), never a projection. `refreshPublicProjection` refreshes only a projection that exists
  (the contract's required fix), so saving the content of a private replacement does not publish it; the old compatibility that materialized a projection for a
  process row without one on a save is gone. (R3a left `GET V/publication`, `Publish` and the `publish` allowed action keyed on the process row; R3c keys them on the projection.)

**R3b implementation notes** (carried candidates; the rest of the contract is unchanged):

- **Order and codes.** `carried_candidates` is checked after the credits and before the responsible. Candidate problems (`not_in_chain`, `currently_placed`, `departed_hire` (R3d), `duplicate`)
  come first and answer 422 `carried_candidate_invalid`; only when no candidate has a problem are the stages checked (`stage_not_found`, `stage_is_placement`,
  `stage_is_exit`, 422 `carried_stage_invalid`). Both carry `data.candidates: [{ index, reason }]` with **only the offending indexes**, in request order, one reason per
  index. A repeated `{kind, id}` is `duplicate` from its second occurrence on (the first one is judged on its own merits). A rejected start creates nothing.
- **Body.** Each item is exactly `{ candidate: { kind, id }, stage_id }`; `kind` is `manual | organic`, ids are canonical lowercase UUIDs; anything else is 400
  `invalid_request`. More than 200 items is 400 `validation_error` with `fields: [{ "field": "carried_candidates", "code": "out_of_range" }]` (listed after
  `target_quantity` and `commitment_date`); a shape error in the list outranks it.
- **Most recent participation.** `created_at DESC, id DESC` over every participation of the chain's processes. The kind is the identity column: `organic` matches
  `candidate_id` (a manual intake of an organic account included), `manual` matches `company_candidate_id`. «Currently placed» = the template is not discarded and sits
  in the Placement stage of **its own** process. A candidate carried before is the template of the next carry (the copy is the newest row).
- **Stage.** `stage_id` must be a stage of the **source** process (the one the start runs from): built-ins by their source id, custom by their id. The same mapping as the
  clone gives the replacement's stage; `stage_map` and `carried[].stage_id` are consistent. The replacement's own built-in ids are not accepted (`stage_not_found`).
- **Copy.** `INSERT … SELECT` from the template: identity, `source`, `cv_version_id` / `company_candidate_cv_id` / `corrected_company_cv_id`, `profile_snapshot`,
  `questions_snapshot`, `answers_snapshot`, `origin_channel`. `added_by` = the caller for `source = manual`, NULL for `organic`; `created_at` = `started_at`; `version = 1`;
  never discarded, no substate, no checklist marks. One `intake` history row per carried participation (recruiter actor, `created_at` = `started_at`).
  The template is not touched and is not locked (a participation lock after the credit locks could deadlock with a late departure); every process of the chain but
  the source and the root is finished, and the two locked ones cannot change, so the only race is a late departure, which can only make a candidate eligible.
- **Delivery.** `reachedCandidates` and `RecordDelivery` treat `carried_from_participation_id IS NOT NULL` like `source = 'manual'`, so a carried intake at the cutoff or
  after it is delivered and may fulfil inside the start (`VacancyDeliveryFulfilled`, one per process). Carried candidates are accounted after all of them exist, so a
  start whose carries reach the target fulfils once. The 201's `delivery` is read after that (`delivered` can exceed `target`: it counts every delivered candidate, the
  fulfillment snapshot keeps exactly `target`). Nothing changes for an ordinary process: no participation of it has the column set.
- **Audit.** `VacancyCandidateCarried` (entity `process_participation` = the new participation, category `candidate`) per candidate, after `VacancyReplacementStarted`
  (`carried_count` = the number carried). `source_process_id` and `source_participation_id` name the **template** (where the copy came from, which can be older than the
  replacement's source); `stage_id` is the replacement's stage; `candidate_kind` / `candidate_id` the `{kind, id}`. No `cv_id`.
- **Stage-entry hook.** The store calls its optional `StageEntryHook` (`OnStageEntered(…, "intake")`, the port the board and the apply path use) for every carried
  participation inside the transaction, so psychometric auto-send can follow; a hook error aborts the start. The hook is a seam (`Store.WithStageEntryHook`): **the
  composition root (`cmd/api/main.go`) must call `draftStore.WithStageEntryHook(newPsychometricStageEntryHook(draftStore))` for it to run in production** (R3b did not
  touch `main.go`; until then carried candidates do not get auto-sent invitations).
- **Candidate-facing exclusion.** Implemented for `GET /v2/me/applications` and `PUT /v2/me/applications/{id}/message-read` (carried rows are not found) and for the
  `application` of the saved-jobs list. Deliberately unchanged: the already-applied check of `POST /v2/jobs/{id}/applications` (the candidate is already in that
  process: `UNIQUE (process_id, candidate_id)` would reject a second row anyway) and, outside this slice's reach, the candidate's psychometric invitation list
  (`source = 'organic'`) and the metrics `origin` / `applications` figures (R6). (The public ad's `applicants` bucket was left out of R3b and is done in R3c.)

**R3c implementation notes** (publish now or later; the rest of the contract is unchanged):

- **`publish: true` on Start.** `publish` is an optional boolean (`absent`, `null` and `false` are private; any other type is 400 `invalid_request`). When true, the start
  transaction evaluates `publicationRequirements` on the **new** draft (the clone: same content, the delivery and management configuration the start just wrote, so the
  codes Start fills never appear) and, if anything is missing, answers 422 `publication_incomplete` with `missing` and creates nothing. Otherwise it writes the projection
  with `published_at` = the start instant (equal to `vacancy_processes.published_at` and `vacancy_replacements.started_at`), emits the usual `VacancyPublished` (version 1,
  `publishedAt`, `snapshot`; once) and `VacancyReplacementStarted.visibility = public`. The 201 carries `visibility: "public"` and a `lifecycle` whose `allowed_actions` has no
  `publish`. The check runs after the clone, which is after every earlier precondition, so the order of the other errors is the contract's. The frozen idempotent response and the
  fingerprint include `publish`, so the same key with another `publish` is 409 `idempotency_conflict`.
- **Publish later.** `POST V/publication` on a draft without a projection: a draft that never published inserts the process row and the projection as before; a draft that has a
  process row (a private replacement) inserts **only the projection** (`published_at` = now). The process row, its `published_at`, `lifecycle_version`, lifecycle history and the delivery
  commitment are untouched, so the clock does not restart. Order after the draft `If-Match`: projection exists → 409 `already_published`; process `closed` → 409
  `lifecycle_transition_invalid` (`data: { action: "publish", lifecycle }`, before body and readiness); body; readiness → 422 `publication_incomplete`; write. `published` and `paused`
  processes can be published (a paused one stays paused, so the public ad answers 410 `vacancy_unavailable` until it resumes). Replay, ETag and the single-winner race (four concurrent publishes: one 201, three 409) are those of
  `Publish`; `commitment_date_past` blocks publish later exactly as it blocks a first publication (the recruiter fixes the date through the delivery PUT).
- **Reads key on the projection.** `readPublicationAt` (the projection's `published_at`) is what `GET V/publication`, `Publish` and `refreshPublicProjection` read; `readPublishedAt`
  (the process clock) is only the published-write guard's. A private replacement reads `{"status":"draft","publishedAt":null,"missing":[…]}` without writing; once the projection exists it
  reads `published` with the **projection's** time (what candidates see). `refreshPublicProjection` keeps the projection's `published_at` (the upsert never updates it).
  `guardPublishedWrite` stays keyed on the process row, as since R3a: a private replacement, like any live process, cannot lose a requirement through an edit (`commitment_date_past` exempted).
- **`allowed_actions`.** `publish` is appended last for a `published` or `paused` process whose `visibility` is `private` (`["pause","close","publish"]`, `["resume","close","publish"]`),
  also in every transition response; never on `closed`. The lifecycle `publish` route does not exist: it is `POST V/publication`.
- **Public numbers equal an ordinary ad's.** The public detail/list `applicants` bucket (`db/queries/public_jobs.sql`) counts only participations with
  `carried_from_participation_id IS NULL`, so carrying candidates into a published replacement does not move it (real applicants still count). The body of a published replacement has the
  same keys and values as an ordinary ad of the same content, and no field names a replacement.

### `GET V/replacements`

The chain of the logical vacancy `{id}` belongs to (works from the original or from any replacement). Authorization:
the same as `GET V/lifecycle` (owner or active tramo on `{id}`). `{id}` is also the **source** the start-related fields refer to.

```json
{
  "root_process_id": "…",
  "items": [
    { "id": "…", "kind": "original", "sequence": 0, "replacement_of": null,
      "title": "Analista contable", "visibility": "public",
      "lifecycle": { "publication": "closed", "process": "finished", "close_reason": "filled", "closed_at": "…" },
      "started_at": "2026-09-01T15:00:00.000000Z", "started_by": { "id": "…", "name": "…" },
      "coverage": { "covered": 2, "required": 3 }, "replaced_credit_ids": [], "can_open": true },
    { "id": "…", "kind": "replacement", "sequence": 1, "replacement_of": "<original id>",
      "title": "Analista contable", "visibility": "private",
      "lifecycle": { "publication": "closed", "process": "active", "close_reason": "filled", "closed_at": "…" },
      "started_at": "…", "started_by": { "id": "…", "name": "…" },
      "coverage": { "covered": 1, "required": 1 }, "replaced_credit_ids": ["…"], "can_open": true }
  ],
  "start_replacement": {
    "allowed": true,
    "blocker": null,
    "active_replacement_id": "…",
    "startable_credits": [ { "…": "see below" } ],
    "publish_ready": true,
    "missing": []
  },
  "carry_candidates": [
    { "candidate": { "kind": "manual", "id": "…", "full_name": "Marta Ruiz" },
      "process_id": "…", "participation_id": "…",
      "stage": { "kind": "in_process", "name": "En proceso" },
      "discarded": true, "eligible": true }
  ],
  "carry_candidates_truncated": false,
  "fallen_credits": [
    { "id": "…", "participation_id": "…", "process_id": "…",
      "hired_at": "…", "left_at": "…", "exit_reason": "candidate_left",
      "candidate": { "kind": "manual", "id": "…", "full_name": "Luis Pérez" },
      "status": "replaced", "replaced_by_process_id": "…" }
  ]
}
```

- `items` ordered original first, then `sequence` ascending; **`sequence` of the original is `0`** and every item carries its `title` (feature doc L11:
  the frontend lists the chain without a second request; the lifecycle view keeps ids only and its `sequence` stays `null` for an original). `started_at` of the original is its `published_at`.
  `coverage` is the live board coverage of that process. `can_open` = the caller may open that draft (owner or active
  tramo); the list itself exposes only titles, counts and lifecycle, never candidate data.
- `start_replacement.allowed` = the source `{id}` is the **latest** process of the chain (D14) ∧ closed ∧ ≥ 1 startable credit. (The
  source may itself be a closed-active replacement: Start finishes it, D15.) `blocker` ∈
  `null | "source_not_closed" | "not_latest" | "replacement_active" | "no_startable_credits"`, checked in that order, except that a
  non-latest source with an active replacement in the chain reports `replacement_active`. `active_replacement_id` = the chain's
  replacement with `process_status = active`, or null. `startable_credits`, `publish_ready`/`missing`, and `carry_candidates` are filled
  **only when `allowed`** (empty arrays / `publish_ready: null` otherwise).
- **`publish_ready` / `missing[]` (point 8).** Lets the «Publicar» checkbox be validated before submitting: `publish_ready` is true when
  `POST V/replacements` with `publish: true` would not answer `publication_incomplete`, and `missing` is that error's list (same codes
  and order as `publicationRequirements`, `…/draftstore/publication.go:246`) evaluated against the **source's content**. The codes that Start
  itself fills (`request_date_missing`, `hiring_headcount_missing`, `delivery_cutoff_missing`, `delivery_target_missing`,
  `commitment_date_missing`, `commitment_date_past`) are never reported here.
- Each `startable_credits` item:

```json
{ "credit_id": "…", "process_id": "…", "participation_id": "…",
  "candidate": { "kind": "manual", "id": "…", "full_name": "Luis Pérez" },
  "hired_at": "…", "left_at": "…", "exit_reason": "candidate_left",
  "recipients": [{ "user_id": "…", "name": "…", "kind": "direct" }] }
```

  The names are the board's company name view (the same exposure as the board listing; not an audited read). Startable
  credit = `placement_credits.status = 'did_not_hold'` on a process of the chain with no `vacancy_replacement_credits` row.
  `left_at` is the departure history row's time; `exit_reason` is the stored one (a `did_not_hold` restored by the owner may
  carry `moved_by_mistake`).
- **`carry_candidates[]` (point 1, blocking).** One row per distinct candidate identity `{kind, id}` that has a participation in any process
  of the chain, resolved with the **most recent participation** rule (`created_at DESC, id DESC`, §Carried candidates) and **excluding
  candidates that are currently in Placement and the departed hires** (S11: any participation of the chain left Placement with exit reason `candidate_left`). Fields: `candidate {kind, id, full_name}` (the board's company name view);
  `process_id` and `participation_id` of that most recent participation (the template); `stage {kind, name}` = the stage that
  participation is in, or, when `discarded` is true, the stage it was discarded from — **by `kind` and `name` only, never an id**, because
  that id belongs to another process of the chain; `discarded` = that participation sits in the exit stage; `eligible` and optional `reason`
  are reserved: v1 lists **only eligible** candidates, so `eligible` is always `true` and `reason` is omitted (a stale list is still
  validated by the POST, `carried_candidate_invalid` / `currently_placed`). The POST `stage_id` for a carried candidate is chosen among the
  stages of the **source** process `{id}`, not from this row. Ordered by `full_name` ascending, id ascending; at most 1000 rows
  (`carry_candidates_truncated: true` beyond that). The list is personal data of the same exposure as the board listing (not an audited read).

- **`fallen_credits[]` (R4b, S10).** **Always present** (`[]` when no credit fell or the draft never published) and **independent of `start_replacement.allowed`**, so
  the board can keep a «No se sostuvo» badge on a card while a replacement is active, the vacancy is not latest or not closed, or the credit is already replaced. One row per
  `placement_credits.status = 'did_not_hold'` credit of the **whole chain** (voided and active credits never list; a credit a replacement took stays listed), ordered by `left_at`, then `hired_at`
  (then id; a credit with no departure time sorts last). Fields: `id` (the credit), `participation_id`, `process_id` (the process the credit belongs to), `hired_at`, `left_at` and `exit_reason`
  (as in `startable_credits`), `candidate {kind, id, full_name}` (the same company name view as `startable_credits`), and `status`:
  - `"replaced"` — linked in `vacancy_replacement_credits`; adds `replaced_by_process_id`;
  - `"startable"` — not replaced, `start_replacement.allowed` is true and the credit is in `startable_credits`;
  - `"blocked"` — otherwise; adds `blocker`, the **`start_replacement.blocker` of `{id}`** verbatim (`replacement_active` | `not_latest` | `source_not_closed`; the contract's
    `not_latest`, not `source_not_latest`). Like `start_replacement`, it depends on the `{id}` the request was made on.
  `replaced_by_process_id` and `blocker` are **absent** (not `null`) when they do not apply. `startable_credits` is unchanged; `fallen_credits` is additive (a client that ignores unknown keys is unaffected).

**R4 implementation notes** (what `GET V/replacements` does; the rest of the contract is unchanged; backend page `backend/docs/replacement-processes.md`):

- **Access and shape.** Same access as `GET V/lifecycle` (owner or an active tramo on `{id}`; 404 `not_found` otherwise, 403 stakeholder, 401 no session, 400 malformed id), `no-store`, **no `ETag`**
  (derived from several resources). Same chain payload from any process of the chain; only `start_replacement` and `carry_candidates` depend on `{id}`. A draft that never published has no
  process: `root_process_id` = its own id, `items: []`, `start_replacement.blocker = "source_not_closed"`.
- **`start_replacement`** `allowed` / `blocker` / `active_replacement_id` are the source's own lifecycle view (`can_start_replacement`, `start_replacement_blocker`, `active_replacement_id`), so the two reads
  cannot disagree. `startable_credits[]` carry exactly the fields above plus (L11) `participation_id`, `hired_at` and `candidate {kind, id, full_name}`; the board item is unchanged. `left_at` is the departure
  history row's time (else the credit's `status_changed_at`, null when neither exists); `recipients[]` are the credit's frozen recipients ordered by user id.
- **Items.** `lifecycle` is `{publication, process, close_reason, closed_at}` (`close_reason` only while closed, null otherwise); `coverage.required` is the process' `hiring_headcount` (null when unset; a replacement's
  is its `target_quantity`); `replaced_credit_ids` oldest hire first; `visibility` is `public` with a projection, else `private`.
- **`publish_ready` / `missing[]`** are `publicationRequirements` on the **source's** content with the six Start-filled codes removed, in `publicationRequirements`' order.
- **`carry_candidates[]`** (only when `allowed`): the most recent participation per `{kind, id}` over the whole chain, `currently_placed` rows and (R3d) departed hires excluded, so a hire voided by mistake (`moved_by_mistake`) is a candidate like any other;
  a discarded row shows the stage it was discarded from (a retired stage keeps its kind and name). Ordered by the board's name view then id, 1000 rows maximum (`carry_candidates_truncated`).

**R4b implementation notes** (`fallen_credits`, feature doc S10 frontend request): query `ListFallenCreditDetails` (`db/queries/replacements.sql`, the `ListStartableCreditDetails` joins plus a left join on
`vacancy_replacement_credits`), assembled by `readFallenCreditViews` (`draftstore/replacement_read.go`) after `startable_credits`, from the same read snapshot. The array is filled for any chain (also when the source
cannot start) and is `[]` for a draft with no process. No new error, no ETag, no write.

**R3d implementation notes** (S11, feature doc Log L20; the rest of the contract is unchanged):

- **Rule.** A candidate is a *departed hire* when any `placement_credits` row of a process of the chain, whose participation is that candidate's (kind = identity column, as in
  the carry templates: `organic` = `candidate_id`, `manual` = `company_candidate_id`), has `exit_reason = 'candidate_left'`. The test is on the stored **exit reason**, not on the credit
  status: an owner correction of the status (`did_not_hold` ⇄ `voided`) never changes the reason of the departure, so a `candidate_left` credit the owner voided still makes the person
  departed, and a `moved_by_mistake` credit the owner restored to `did_not_hold` does not. It is the same condition for every participation of the person in the chain, including a
  newer, unplaced one (someone who left, was re-added to the pipeline and is not placed now is still departed). A hire from before credits existed has no reason on file and is not departed.
- **`GET V/replacements`.** `carry_candidates[]` filters them out in SQL (`readCarryCandidates`). They stay in `fallen_credits[]` and `startable_credits[]` (the credit is still fallen).
- **`POST V/replacements`.** `planCarried` decides `departed_hire` (`readDepartedHires`) after `not_in_chain` and `currently_placed` for the same item (a departed hire that was hired again and
  is placed now answers `currently_placed`) and before the stage problems; `duplicate` keeps applying from the second occurrence on. Same payload shape (`data.candidates: [{ index, reason }]`,
  only offending indexes). A rejected start creates nothing.

**R3e implementation notes** (T12, finding F1 of the independent verify; feature doc Log L22). Only a replacement can be private. An **original** process row with no public
projection (the metrics demo seed, a legacy row) keeps the publication semantics it had before this contract, in every path:

- **Publication read and `Publish`.** `readPublicationAt` reads the **process clock** (`vacancy_processes.published_at`) for any process that is not a replacement, so `GET V/publication`
  answers `published` with that time and `POST V/publication` answers 409 `already_published`, as before. For a replacement it reads the projection's `published_at` (R3c, unchanged).
- **Lifecycle.** `visibility` is `public` for every original with a process row; it is `private` only for a replacement (`sequence >= 1`) with no projection, which is also the only case that
  gets the `publish` allowed action. Same rule in the draft list (`visibility`) and in the `GET V/replacements` item `visibility`.
- **`refreshPublicProjection`.** A content save of an original with a process row and no projection writes the projection (with the process clock as `published_at`), as before; a
  private replacement is still never published by a save.
- Unchanged: replacements (every R3a-R3d behavior), `guardPublishedWrite` (process-keyed), the public API, the row shapes.

### `GET V/lifecycle` and every lifecycle view (D10)

The lifecycle view (§Backend facts) gains these keys. They are **derived on read**: they never change
`lifecycle_version`, so `If-Match` ETags are unaffected. They appear wherever `lifecycle.View` is rendered (GET,
transition responses, the `lifecycle` key embedded in configuration responses, and the `data` of `process_finished` /
`lifecycle_transition_invalid` / the new 409s). Idempotent replays return the frozen body, which may predate these keys.

```json
{
  "publication": "closed", "process": "finished", "version": "5",
  "allowed_actions": ["finish_process"],
  "close_reason": "filled", "close_reason_note": null,
  "visibility": "public",
  "kind": "original",
  "sequence": null,
  "replacement_of": null,
  "root_process_id": "<own id for an original>",
  "closed_covered": true,
  "can_start_replacement": true,
  "start_replacement_blocker": null,
  "startable_credits_count": 1,
  "active_replacement_id": null
}
```

- `kind`: `original | replacement`. For a draft without a process row: `original`, `root_process_id` = its own id.
- `visibility`: `public` (projection exists, or the process is an original: R3e) | `private` (replacement without projection) | `null` (never published). A
  private replacement has `publication: "published"` (the process axis, D8) and `allowed_actions` also contains
  `"publish"` while `publication` is `published` or `paused` (it routes to `POST V/publication`, as the existing
  `publish` action does).
- `allowed_actions`: `reopen` is removed when `closed_covered` (D6), when `active_replacement_id` is non-null and is not this process's own id (A1), and when the process has a successor (A7); see §«Reopen guards».
- `can_start_replacement` = this process is the **latest** of its chain (D14) ∧ closed ∧ `startable_credits_count ≥ 1`; it is false on every
  other process of the chain. `start_replacement_blocker`: `null | "source_not_closed" | "not_latest" | "replacement_active" | "no_startable_credits"`
  (same order and meaning as `GET V/replacements`). `startable_credits_count` and `active_replacement_id` are computed against the whole chain;
  `active_replacement_id` can be the process's own id (a closed-active replacement). The credit detail lives in
  `GET V/replacements` (so the lifecycle read stays one cheap query per embed).
- New 409s on `POST V/lifecycle/reopen`: **`reopen_requires_replacement`**, `data: { action: "reopen", lifecycle: <view> }`
  (same envelope as `lifecycle_transition_invalid`); **`replacement_already_active`** (A1), `data: { process_id, root_process_id, lifecycle }`;
  **`reopen_superseded`** (A7), `data: { successor_process_id, root_process_id, lifecycle }`.

### Draft list (D10)

`GET /v2/me/company/job-drafts` (`cmd/api/router.go:390`, item `draftListItem`, `…/http/draftListHandler.go:49-67`) items gain:

```json
{ "kind": "replacement", "sequence": 1, "replacement_of": "…", "root_process_id": "…", "visibility": "private" }
```

For an original `kind = original`, `sequence`/`replacement_of` null, `root_process_id` = `id`; a never-published draft has
`visibility: null`. The query (`…/draftstore/list_v2.go:36-48`) left-joins `vacancy_replacements` and the projection; the
cursor, ordering (`updated_at DESC, id DESC`) and the `status` field (`COALESCE(p.status,'draft')`) do not change, so a
private replacement lists with `status: "published"` and the badge comes from `kind`/`visibility`.

**New filter `root_process_id`** (point 10), so the frontend can group an original and its replacements:
`GET /v2/me/company/job-drafts?root_process_id=<uuid>` returns, within the caller's usual visibility scope (owner: all; otherwise active
tramo), the drafts whose `root_process_id` equals the value (the original, whose `root_process_id` is its own `id`, plus every
`vacancy_replacements` row with that root). Same parser rules as `limit`/`cursor`: a single value that is a canonical UUID, otherwise 400
`invalid_request` (`parseDraftListRequest`, `…/http/draftListHandler.go:152`); an unknown or foreign id answers an empty page; the value is bound
into the cursor (`draftlist.Cursor` gains `RootProcessID`), so a cursor issued for another filter answers 400 `invalid_cursor`. Ordering is unchanged.

### Departure on a finished process (D7)

**Endpoint: the existing `POST V/participations/{pid}/discard`** (`cmd/api/router.go:406`), unchanged request:

```json
{ "reason": { "group": "candidate", "key": "no_longer_interested" },
  "comment": null, "candidate_message": null,
  "placement_exit_reason": "candidate_left" }
```

with `If-Match` = the participation's ETag (no `Idempotency-Key`, as today). `reason` is the discard reason
(`ValidReason`, `…/application/board/discard.go`), independent of `placement_exit_reason` (`candidate_left` →
credit `did_not_hold`; `moved_by_mistake` → credit `voided`), exactly the two-reason rule of vacancy-team-v1
«Discard out of placement asks for both reasons». **Moves stay blocked**: a move out of Placement would leave an active
candidate on a finished board, and a move cannot target the exit stage (`…/postgres/board/store.go:305`).

**The exact exception to `beginMutation`** (`…/postgres/board/store.go:77-89`): for the discard (not recover) route only,
`beginMutation` stops raising `ProcessFinished` itself and instead returns the tx plus `finished = true` (and the lifecycle
view). `discardOrRecover` (`…/board/discard.go:32`) then, right after the locked `readItem`:

```
if finished && !( !recovering && stageKind(item.StageID) == "placement" && item.Discard == nil ) {
    return ProcessFinished{lifecycle}        // 409 process_finished, unchanged body
}
```

Everything else (recover, moves, substates, manual intake `…/board/manual_create.go:80-95`, checklist marks, psychometric,
configuration writes `requireActiveProcess`) keeps blocking on `finished`. Observable differences: (1) a **finished** process
now answers a discard on a Placement participation instead of 409; (2) on a finished process an unknown participation now
answers 404 before `process_finished` (the participation is read before the state check; assumption A4). A closed
process that **continues** (`process_status = active`) is writable today and does not change.

On the allowed path the effects are those of any placement departure, nothing extra:

- Participation → exit stage with the discard reason; one history row with `departure = true`; `placement_exit_reason`
  is **required** (missing → 409 `placement_exit_reason_required`, existing).
- **Coverage** (`db.ReadPlacementCoverage`, live Placement count) drops by one in the response `coverage`. Milestones
  (`process_coverage_milestones`), the delivery fulfillment, `close_reason`, `closed_at`, `process_finished_at` and the
  lifecycle history are **not touched**: the original result stays.
- **Credit**: `recordPlacementCredit` (`…/board/credits.go:19-77`) attaches the exit to the credit of that placement
  episode: `candidate_left` → `did_not_hold` (startable, D2), `moved_by_mistake` → `voided` (never startable).
  `RecordDelivery` is not called (it only runs on intake/recovery).
- **Response (point 6).** The 200 body keeps `item`, `coverage`, `delivery` (`app.Moved`, `…/application/board/movement.go:154`) and gains an
  optional **`lifecycle`** key: the process's full lifecycle view, including `can_start_replacement`, `start_replacement_blocker` and
  `startable_credits_count`, computed after the credit change in the same transaction. It is present when the discard is a **placement
  departure** (`departure = true`, on any process state: open, closed or finished) and absent otherwise (moves, recoveries and ordinary
  discards are unchanged), so the UI can enable «Iniciar reemplazo» without a second request.
- `can_start_replacement` turns true when this process is the latest of its chain, is closed, a credit is `did_not_hold` and no replacement
  is active (a departure on an older, superseded process still makes its credit startable, but `can_start_replacement` stays false there; the
  button lives on the latest process).
- Audit: unchanged events (`ParticipationDiscarded`, `VacancyPlacementCreditChanged` with `cause = exit:<reason>`); the
  process state at that moment is in `vacancy_lifecycle_events`. The owner's credit void/restore
  (`POST V/participations/{pid}/placement-credits/{cid}/void|restore`) is not blocked by `finished` today and does not change;
  voiding a credit that a replacement already took leaves the link in place.

### Metrics (D9)

Filter **`process_kind`** = `original | replacement`, one value, **absent = all**; any other value → 422 `invalid_filter`
(`process_kind: invalid`), repeated → `duplicate`. Naming follows the v2 filters (`requester_kind`, `stage_kind`, `close_reason`; strict parser). It is a **common filter**: accepted by every route of `GET /v2/me/company/metrics/*` (sections, recruiter
routes, lists, exports, `vacancies/{draftId}/deliveries|placements`; `cmd/api/router.go:265-286`) and echoed in
`applied_filters.process_kind` of every list. It joins the cursor hash like the other filters.

Counting rule (D9): **a replacement never counts as a new vacancy; its deliveries, placements, time and pipeline are its own
process' figures.** **The table below is NORMATIVE** (point 9): which figures ignore `process_kind` (vacancy-level) and which are filtered by it
(process-level) is part of the contract, and the integration tests of slice R6 assert it figure by figure.

| Level | Figure (endpoint · field) | Rule |
| --- | --- | --- |
| **Vacancy-level — root only, `process_kind` ignored** | `summary` · `vacancies.assigned`, `vacancies.closed`, `vacancies.median_business_days_to_close`, `vacancies.closing_target`, `by_requester[].vacancies/filled`, `placements.positions_covered/positions_required`, `closed_by_month`; `headline.assigned`, `headline.median_business_days_to_close`; `closures` · `closed_by_month`; `delays` · `closing_target`; `GET …/vacancies` (list, export, facets `close_reason`); recruiter cards `assigned` and conversion (`vacancies?scope=closed_assigned`, `credited_to`) | Replacement processes are **skipped**. `assigned` counts a root for a recruiter who has a tramo overlapping the period on the root **or on any replacement of it** (so someone who only worked the replacement is not invisible, and the vacancy still counts once — A5). `closed`/`closing_target`/median/positions are the root's own closes and coverage. |
| **Process-level — every process, `process_kind` filters** | `summary` · `delivery.*`, `headline.on_time_rate`, `on_time_by_month`; `placements.credits`, `did_not_hold`, `headline.placements`; `reassignments.*`, `headline.reassignments`; `origin.*`; `closures` · `delivery_status`; `compliance` · all; `delays` · `overdue`, `reassignments_by_reason`; `origin`; `pipeline`; `recruiters` and `recruiters/{userId}` (on-time N of M, placements, reassignments); lists `deliveries`, `placements`, `reassignments`, `candidates`, `applications` (+ exports); `vacancies/{draftId}/deliveries|placements` | Each replacement is a row/figure of its own: its delivery (own target and commitment), its time (`PublishedAt` = `started_at`), its credits, its pipeline and its team. `process_kind=original` = roots only; `replacement` = replacements only. |

- **Original unchanged.** `did_not_hold` credits stay in the original's `placements.did_not_hold`; the replacement's
  own hires are new credits on the replacement process. Nothing recomputes the original's delivery, close or coverage.
- **Rows carry the badge (point 2, explicit list).** The shared Go type `VacancyRef {draft_id, title}`
  (`internal/features/metrics/application/details.go:63`) gains **`kind`** (`original | replacement`), **`root_draft_id`** (uuid; own id for an
  original) and **`sequence`** (`null` for an original). Because it is one type, these keys appear in **every** place that serializes it, and
  in no other:
  - metrics lists: `deliveries` rows (`kinds.go:19`), `placements` rows (`kinds.go:280`), `reassignments` rows (`details.go:53`), `candidates`
    rows (`pipeline.go:267`), `applications` rows (`pipeline.go:366`), and their CSV exports (a `process_kind` column);
  - metrics sections: **`pipeline.top_vacancies[].vacancy`** (`pipeline.go:195`) and **`delays.overdue.top[].vacancy`** (`sections.go:70`,
    the `OverdueRow` of `GET …/metrics/delays`; not the dashboard's `attention.deliveries.top[]`, which is a different row below);
  - dashboard (`/v2/me/company/dashboard/*`): `attention.deliveries.top[].vacancy` (`AttentionDelivery`, `dashboard.go:306`),
    `attention.stalled.top[].vacancy` (`StalledRow`, `dashboard.go:325`), `vacancies` section `top[].vacancy` (`ActiveVacancy`,
    `dashboard.go:460`), and the dashboard list rows `lists/vacancies` (`DashboardVacancyRow`, `dashboard_lists.go:440`),
    `lists/deliveries`, `lists/candidates`, `lists/applications` (`dashboard_lists.go:334,349,422,597`). The frontend's dashboard `vacancyRef` is
    this same shape.
  - **Not changed:** `applied_filters.vacancy` (`VacancyFilter {draft_id, title}`, `lists.go:186`), `dashboard/recent` rows (`RecentVacancy
    {id, title}`, `history.go:85`), and the flat `vacancies` list rows (`VacancyRow`, `details.go:11`), which are roots only and instead gain
    `replacements: { count, active_draft_id | null }`.
  - The per-vacancy detail responses `GET …/metrics/vacancies/{draftId}/deliveries|placements` (`Detail[T]`, `details.go:94`) gain a top-level
    `process: { kind, root_draft_id, sequence }` next to their `draft_id`.
- **Facets.** Process-level lists add `facets.process_kind = { original: n, replacement: n }` computed with every filter but
  its own (v2 §5). CSV exports keep API codes in enum cells and gain a `process_kind` column.
- **Scope.** `scopeSQL` (`…/postgres/store.go:69`) loads, for every in-scope process, its **whole chain** (so root-level
  figures and `assigned` can see the replacement tramos). `Vacancy` gets `Kind`, `RootID`, `Sequence`; `Scope` gets
  `ProcessKind`.
- **Not changed.** Definitions version stays `v2`; all existing fields stay; the snapshot lifetime and cache key add
  `process_kind` to the filter part of the key; audit of metrics reads (`MetricsDetailViewed/Exported`) is unchanged.
- **Company dashboard** (`/v2/me/company/dashboard/*`, `company-dashboard-v2.md`) is operational: replacement processes are
  rows like any other, with `kind` on their vacancy objects (list above), and no `process_kind` filter in v1. User answer Q1: a private
  active replacement **counts** as an active vacancy there («Sí, cuenta como vacante activa»).

## Error codes

All through the closed catalog (`internal/shared/httpjson`); new codes join the lifecycle family
(`lifecycle_errors.go`) or a new `replacement_errors.go` resolved from `Resolve` like `resolveTeamError`
(`errors.go:95+`), and are added to the catalog code tests.

| Code | Status | `data` | Where |
| --- | --- | --- | --- |
| `replacement_source_not_closed` | 409 | `{ lifecycle }` | POST replacements (one entry for open, paused and never-published sources) |
| `replacement_source_not_latest` | 409 | `{ latest_process_id, root_process_id, lifecycle }` | POST replacements (D14) |
| `replacement_already_active` | 409 | `{ process_id, root_process_id, lifecycle }` | POST replacements; reopen guard (A1). `lifecycle` is always the **source's / reopened process'** view |
| `reopen_requires_replacement` | 409 | `{ action: "reopen", lifecycle }` | POST lifecycle/reopen on closed covered |
| `reopen_superseded` | 409 | `{ successor_process_id, root_process_id, lifecycle }` | POST lifecycle/reopen on a process with a successor (A7) |
| `replacement_credits_invalid` | 422 | `{ credits: [{ credit_id, reason }] }` | POST replacements |
| `carried_candidate_invalid` | 422 | `{ candidates: [{ index, reason }] }` | POST replacements |
| `carried_stage_invalid` | 422 | `{ candidates: [{ index, reason }] }` | POST replacements |
| existing, reused as is | | | `validation_error` 400 + `fields[]` (`WriteValidationError`), `team_action_forbidden` 403, `not_company_member` 422 (`team_errors.go`), `process_finished` 409, `placement_exit_reason_required` 409 (`movement_errors.go`), `lifecycle_transition_invalid` 409, `publication_incomplete` 422, `non_business_date` 400, `invalid_cursor` 400, `invalid_filter` 422 (metrics), `precondition_required` 428, `version_conflict` 412, idempotency codes |

The five new 409 codes carry `data.lifecycle` so the frontend decodes one envelope (`{ error, code, data: { lifecycle, … } }`) through the same
path as `lifecycle_transition_invalid` / `process_finished`.

## Audit events

Same transaction, `entity_type = 'vacancy_process'` (the lifecycle events' entity, `…/draftstore/lifecycle.go:222`),
`entity_id` = the **new** process id, `VacancyID` = the new process id. Metadata is a closed set of ids and codes; free
text never goes in.

| Event (new) | Entity | Metadata |
| --- | --- | --- |
| `VacancyReplacementStarted` | `vacancy_process` (new id) | company_id, vacancy_id (new), source_process_id, root_process_id, sequence, target_quantity, credit_ids (list), carried_count, visibility (`private`\|`public`), responsible_user_id |
| `VacancyCandidateCarried` | `process_participation` (new participation id) | company_id, vacancy_id (new), source_process_id, source_participation_id, candidate_kind, candidate_id, stage_id |

One **existing** event gains metadata (D15): `VacancyProcessFinished` is also emitted, on the **source** process, when a start finishes it, with
`cause = replacement_started` and `replacement_process_id` = the new process; the two keys are added to its `spec(...)` row
(`catalog.go:204`, closed set today `version, publication, process, reason`) and are absent on ordinary `finish_process` events. No new type, so
only place 2 of the four below changes for it.

Reused unchanged: `JobDraftCreated` (new draft), `VacancyTeamCreated` (new team), `VacancyPublished` (`publish: true`
or publish later), `VacancyDeliveryFulfilled` (if the carry fulfils), `VacancyReopened` (rejections emit nothing),
`ParticipationDiscarded` + `VacancyPlacementCreditChanged` (departure, D7). The existing
`VacancyCandidateAddedManually` is **not** reused for carries (its keys include `cv_id`).

**A catalog event lives in four places; a new type must be added to all four**:

1. the constant in `internal/features/audit_events/domain/entities/catalog.go` (vacancy group, next to `EventVacancyPlacementCreditChanged`, line 93);
2. its `spec(Event…, CategoryVacancy|CategoryCandidate, <closed metadata keys>)` row in the `catalog` slice (same file, ~line 203-209; `VacancyReplacementStarted` → `CategoryVacancy`, `VacancyCandidateCarried` → `CategoryCandidate`);
3. its row in the **Annex** of `docs/contracts/audit-log-v1.md` (the label table; update its «(63)» count; `catalog_annex_test.go` fails without the row);
4. its label in the frontend annex copy `frontend/src/features/audit-log/model.ts` (`ANNEX`, ~line 63-134). **The labels for `VacancyReplacementStarted` and `VacancyCandidateCarried` are the frontend's to write** (point 13): the backend only adds the annex row in `docs/contracts/audit-log-v1.md` with the proposed label below, and the frontend copy may word them differently; an unknown type renders a generic label until then.

Proposed labels (es-MX, for the annex): `VacancyReplacementStarted` → «Inició un proceso de reemplazo»; `VacancyCandidateCarried` →
«Reutilizó a un candidato en un proceso de reemplazo».

## Deployment order (point 2, blocking)

The frontend parses these shapes with `.strict()` (an unknown key is a decode error): the lifecycle view, the draft-list row,
`pipeline.top_vacancies[].vacancy` and `delays.overdue.top[].vacancy` of the metrics, and the dashboard `vacancyRef`. Adding keys on the backend
first would break those screens, and making them required on the frontend first would break against the old backend. Therefore:

1. **Frontend ships first**: the new keys as **optional** in every strict schema listed above (lifecycle: `kind`, `sequence`, `replacement_of`,
   `root_process_id`, `visibility`, `closed_covered`, `can_start_replacement`, `start_replacement_blocker`, `startable_credits_count`,
   `active_replacement_id`; draft-list row: `kind`, `sequence`, `replacement_of`, `root_process_id`, `visibility`; `VacancyRef`: `kind`,
   `root_draft_id`, `sequence`), and decoders for the new error envelopes (`replacement_source_not_closed`, `replacement_source_not_latest`,
   `replacement_already_active`, `reopen_requires_replacement`, `reopen_superseded`, `replacement_credits_invalid`, `carried_candidate_invalid`,
   `carried_stage_invalid`, and `validation_error` with `fields[]`).
2. **Backend slice R2** (and R6 for the metrics/dashboard rows, R4/R5 for their own responses) adds the keys.
3. **Frontend makes them required** once the backend that emits them is deployed.

**Local merge:** the frontend branch merges **after or together with** the backend branch, never before step 1 is on it; the backend never merges
a slice that emits a key before the frontend with step 1 is mergeable. Idempotent replays (lifecycle transitions, publication) may still return
frozen bodies without the new keys, which the optional phase tolerates (and the required phase must keep tolerating for replays, or treat
the keys as required only on fresh reads).

## Implementation notes (cross-cutting, for the slices)

- **Candidate-facing reads** must exclude carried rows: `applications/v2/store.go:239` (my applications) and any
  list keyed on `source = 'organic'` filter `carried_from_participation_id IS NULL`, otherwise a published replacement
  would show a carried organic candidate an application they never made. Metrics `origin`/`applications` count
  `carried_from_participation_id IS NULL` only (a carry is not an application).
- **Talent pool history** (`pool/history.go`) will list the replacement participation as a process of that candidate;
  no badge in v1.
- **Frozen idempotent responses** (lifecycle transitions, publication) keep their old shape on replay.
- No new route needs a frontend change to existing ones except the additive keys above.

## Proposed implementation slices

Each ≤ ~400 changed lines where possible; every slice ships integration tests through the production router. Order matters, and the frontend
step 1 of §«Deployment order» precedes R2.

1. **R1 · Migration and chain primitives** (~250): `00063_replacement_processes.sql` (+ down guard), store helpers: resolve root/chain and
   «latest», startable credits, active replacement, successor, closed-covered predicate. No routes. Migration up/down test.
2. **R2 · Lifecycle read side + reopen guards + codes** (~400): `lifecycle.View` keys (`kind`, `sequence`, `replacement_of`, `root_process_id`,
   `visibility`, `closed_covered`, `can_start_replacement` with the latest-only rule, blocker, counts, `active_replacement_id`), `AllowedActions`
   without `reopen` (closed covered / other active replacement / successor), `reopen_requires_replacement`, `replacement_already_active`,
   `reopen_superseded`, draft-list keys **and the `root_process_id` filter + cursor binding**, `replacement_errors.go`. Observable with seeded rows
   before Start exists. (Grew from ~350: if it exceeds ~450, move the list filter to its own ~100-line slice R2b.)
3. **R3a · Start: clone + process + links + finish source** (~450; **implemented** as R3a + R3a2, see Log L13 of the feature doc; ~750 code lines, the source finish is the small R3a2 commit): `POST V/replacements` with credits, target, commitment date, responsible,
   idempotency, ETag, latest/active/not-closed checks, concurrency (§Concurrency), **finish of a closed-active source (lifecycle event +
   `VacancyProcessFinished` `cause`)**, `validation_error` `fields[]`, `VacancyReplacementStarted`, audit catalog changes (constants, specs,
   annex). Over budget on purpose; split the source-finish into R3a2 (~120) if review prefers.
4. **R3b · Carried candidates** (~350; **implemented**, see Log L14 of the feature doc and «R3b implementation notes»): participation copy, `intake` history, delivery rule change (`reachedCandidates`/`RecordDelivery`),
   `VacancyCandidateCarried`, candidate-facing exclusion, the carry error codes. **R3d** (S11, Log L20): departed hires (`candidate_left`) are excluded from `carry_candidates[]` and rejected with `departed_hire`.
5. **R3c · Private/public** (~300; **implemented**, see Log L15 of the feature doc and «R3c implementation notes»): `publish: true`, `readPublishedAt` → projection keyed, `refreshPublicProjection` fix, publish-later,
   `GET V/publication` for private replacements, `allowed_actions` `publish`.
6. **R4 · `GET V/replacements`** (~350; **implemented**, see «R4 implementation notes»): chain list, `start_replacement` (blocker, startable credits, **`publish_ready`/`missing`**), coverage per item,
   **`carry_candidates[]`** with the most-recent-participation resolution and placed-exclusion. Split `carry_candidates` into R4b (~150) if it
   exceeds the budget.
7. **R5 · Departure on finished** (~250): the `beginMutation` exception, **the optional `lifecycle` key in the discard response on placement
   departures**, tests (finished: Placement discard allowed with both reasons; recover/move/substate/intake still 409; coverage, credit status,
   milestones and fulfillment unchanged; `lifecycle.can_start_replacement` flips on the latest process).
8. **R6 · Metrics** (~450, two slices): R6a dataset kind/root/chain load, `process_kind` parsing, cache key, vacancy-level vs process-level figures
   (the normative table), facets; R6b `VacancyRef` keys on every row listed in §Metrics (metrics **and** dashboard), per-vacancy `process`, exports.
   Per-figure tests asserting list totals equal figures (v2 rule).
9. **R7 · Dashboard rows** (~100): folded into R6b (Q1 answered: the active replacement counts).

## Open questions

None open. Q1 was answered by the user (see §«Decisions status»); the text below is kept for the record.

- **Q1 · Dashboard counts (answered).** `company-dashboard-v2` counts «published vacancies» from `vacancy_processes.status = 'published'`
  (an operational notion). A private active replacement would count there. Recommendation: **count it** (it is real work in
  progress, and the dashboard is operational, not the stakeholder's «una vacante lógica»); alternative: count only
  `visibility = public` processes. Answered by the user: count it.

## Assumptions made in this draft (flag in review)

- **A1** Reopen of any process of a chain with an active replacement (other than itself) is rejected (`replacement_already_active`); the feature doc was silent. **User-confirmed** (L6).
- **A2** Carried candidates are addressed by `{ kind, id }` (manual or organic), not by `company_candidate_id` alone.
- **A3** A carried intake counts as a delivered candidate with the manual-intake rule, for both sources.
- **A4** On a finished process an unknown participation answers 404 (was 409 `process_finished`) on the discard route only.
- **A5** A recruiter counts as «assigned» to a logical vacancy if they have a tramo on the root or any of its replacements.
- **A6** `closed covered` is defined by the latest close reason `filled`, not by live coverage.
- **A7** (new with the review, to confirm) A process that already has a successor in its chain cannot be reopened (`reopen_superseded`); only the latest
  process can. Needed so that D14/D15 («latest», «one active») hold; the user's A1 answer covers the active-replacement case only.

## Out of scope (v1)

Notifications; automatic replacement start; re-linking a credit to a second replacement; guarantee-window rules
(«no time limit», S2); replacement-specific KPIs (e.g. share of `did_not_hold` credits replaced); a replacement badge in
the talent pool; public mention of replacement (forbidden by S4); draft-list filters other than `root_process_id`; per-recruiter replacement
quotas.

## Decisions status

User answers (2026-11-19): Q1 «Sí, cuenta como vacante activa (recomendado)» — a private active replacement counts in
«published vacancies» (logical vacancy still once). A1 «No, bloqueado mientras haya uno activo (recomendado)». A3 «Sí,
cuenta como entrega, igual que una carga manual (rec.)». A2, A4, A5, A6 are technical and accepted by the backend session.
Frontend review applied in Log L7: the 13 points are folded into this document (D14-D16, `carry_candidates[]`, §«Deployment order»,
`publish_ready`/`missing[]`, the finish-on-start rule, the latest-only rule, the `reopen` rules, the departure's `lifecycle`, the error table, the
normative metrics table, the `root_process_id` list filter, the informative-vs-decoded response keys, the `Spec` column note and the audit-label
ownership). Pending: the frontend's step 1 of §«Deployment order», confirmation of A7, and the user's confirmation that the finish-on-start rule (D15)
and the latest-only rule (D14) match what they meant by «uno solo por vacante lógica»; implementation slices start only after that.

## R5 implementation notes

- The finished-process exception lives in `beginMutationState` (applications board store); only discard uses it. The
  finished check runs after the locked participation read and before the ETag check, so a stale tag on a finished board
  still answers 409 `process_finished`, and an unknown participation on discard answers 404 (A4).
- Recover on a finished process stays 409 `process_finished`, even for an unknown participation (A4 is discard-only).
- The discard response `lifecycle` key is produced through the existing `VacancyContext.Lifecycle` port, read after the
  credit change in the same transaction, on every placement departure (open, closed-active and finished processes).

## R6a implementation notes

- **Snapshot key.** The snapshot stays keyed `(company, from, to)`. `process_kind` narrows it in Go per request, like `requester_*` and
  `recruiter_id`, and joins the **cursor hash** (omitted when absent); a snapshot per kind would not work anyway, because the vacancy-level
  figures read the original while `process_kind=replacement` is set. `Scope` therefore gets no `ProcessKind`: the store loads whole chains.
- **Chain load.** `scopeSQL` adds the chain (original and every replacement) of each process with activity. `Vacancy` carries `Kind`, `RootID`,
  `Sequence`, `ProcessActive`; an original also `Replacements {count, active_draft_id}` and the tramos and functions of its chain
  (`Dataset.link`).
- **Cards, beyond the table.** The recruiter card's `vacancies.*` block (`assigned`, `as_responsible`, `as_collaborator`, `as_member`,
  `started_in_period`) and `by_month[].assigned` are vacancy-level with the chain's tramos and functions, like `assigned` and `conversion`;
  `delivery.*`, `placements.direct|participant|shared|did_not_hold`, `reassignments.*`, `business_days_in_tramos` are process-level. The people
  listed by `GET …/recruiters` are those with a tramo on a process the filter selects.
- **Per-vacancy details** under another `process_kind` answer an empty `items` (still audited as viewed).
- **Carried participations** (R3b notes, closed here): metrics `origin` and `applications` leave them out; the cutoff-entry scan treats a carried
  intake like a manual one (A3). The dashboard's participation-based figures (`origin` by day, `lists/applications`, in-process series) keep
  counting them: they are operational and name participations, not applications.
- **Existing tests changed** (facets only): the exact-wire assertions of the deliveries, placements, reassignments, candidates and
  applications `facets` gained `process_kind`.

## R6b implementation notes

- **`VacancyRef`** is one Go type, so `kind`, `root_draft_id` and `sequence` appear on exactly the rows the Metrics section lists, metrics and dashboard,
  and `Detail` carries `process`; `VacancyRow` gains `replacements`. `applied_filters.vacancy`, the dashboard `recent` rows and the flat `vacancies`
  rows (apart from `replacements`) are unchanged.
- **Exports.** The `process_kind` column is the **last** one (header `Tipo de proceso`, cells `original | replacement`) of the `deliveries`,
  `placements`, `reassignments`, `candidates` and `applications` exports and of the four dashboard list exports; the `vacancies` export (roots only)
  keeps its columns. The dashboard applications CSV keeps it when it drops channel columns.
- **Q1 needed no query change.** The history snapshot reads every `vacancy_processes` row of the company, never the projection, so an active private
  replacement is published for the dashboard, and the logical vacancy counts once because its original is closed (a `close` event) and finished (D15)
  before the replacement exists. Tests pin the figure, its list total and the recruiter scope.
- **Existing tests changed** (the contract's new keys only): exact-wire `vacancy` objects of metrics and dashboard rows (`VacancyRef` literals,
  `mxRef`), the flat vacancies rows (`replacements`), the detail header (`process`) and the CSV headers/rows (one extra column).

