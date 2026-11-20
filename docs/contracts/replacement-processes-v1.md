# Replacement processes v1 (internal, employer-only)

Status: **DRAFT for frontend review (2026-11-19)**, not implemented, nothing agreed beyond the user decisions quoted in
§«Decisions». Product source: the 2 Oct 2026 agreement «procesos de reemplazo vinculados a la vacante original».
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
  reads join the projection (`internal/features/applications/infrastructure/postgres/v2/store.go:57,239`). A process
  without a projection is private.
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

Quoted words are the user's, verbatim from the feature doc (`odd/tasks/replacement-processes-backend.md`).

| # | Spec | Decision |
| --- | --- | --- |
| D1 | S1 | **A replacement is a NEW job draft + vacancy process** (new id), cloned from the source and linked to the source process, to the logical-vacancy root and to the fallen credits it replaces. Why a new draft + process and not a flag on the original: every per-process table is keyed by the draft id (facts above), so a separate id gives the replacement its own board, pipeline, delivery fulfillment, coverage milestones, lifecycle, team and credits with **zero change** to those tables, while the original keeps its closed result byte for byte. |
| D2 | S2 | «Placement «no se sostuvo» + vacante cerrada (rec.)». Start requires the source **closed** and ≥ 1 **startable credit**: a `did_not_hold` credit of any process of the logical vacancy (source or chain) that no replacement has taken yet. No time limit. **Explicit start**: nothing starts by itself. |
| D3 | S3 | «Un reemplazo puede cubrir varias bajas (recomendado)»: `placement_credit_ids` is a list; `target_quantity` defaults to its length (and may not be lower). Each credit belongs to at most one replacement (`UNIQUE`); a replacement that closes without covering is **reopened** (S6 «como hoy»), not re-linked. |
| D4 | S4 | «Privado por defecto, con opción de publicarlo (recomendado)». Relayed: «Publicarlo es opcional y sale como aviso normal, sin decir que es reemplazo; publicarlo después no reinicia el reloj.» A replacement is **private** (process row, no projection) unless `publish: true`; publishing later creates only the projection through the existing `POST V/publication`. The ad is the source content: nothing public says «reemplazo». The process clock is `vacancy_processes.published_at` = `started_at` and never moves. |
| D5 | S5 | «Cualquiera, sin entrar directo a Placement (rec.)» and «En cualquier etapa menos Placement (Recomendado)»: any candidate of the original chain (discarded or still in the pipeline) can be carried as a **new participation** at the recruiter-chosen stage, audited, never Placement (nor the exit stage). |
| D6 | S6 | «Si cerró cubierta: reemplazo, no reabrir (Recomendado)». Relayed: «Si la vacante cerró cubierta, «Reabrir» desaparece y aparece «Iniciar reemplazo»; si cerró sin cubrirse, se puede reabrir como hoy.» **Closed covered** = `status = 'closed'` AND the latest close event's reason is `filled` (§«Closed covered»). Reopen then answers 409 `reopen_requires_replacement`. |
| D7 | S7 | «Con el proceso cerrado, solo «No se sostuvo» (Recomendado)». Relayed: «Con el proceso cerrado o finished, el tablero sigue de solo lectura salvo una acción: marcar que un contratado de Placement se fue (motivo candidate_left o moved_by_mistake). La cobertura baja y queda habilitado «Iniciar reemplazo». El resultado original no se toca.» One exception to the finished guard: **discard** of a participation that sits in Placement (§«Departure on a finished process»). |
| D8 | S8 | «Mismos estados con insignia «Reemplazo» (Recomendado)». Relayed: «Activo» = proceso no terminado (process_status active), uno solo por vacante lógica. A replacement uses the same two lifecycle axes; `kind = replacement` is the badge. **Active** means `process_status = 'active'`; at most one active replacement per logical vacancy (§«Concurrency»). |
| D9 | S9 | «Una vacante lógica, reemplazo separado (Recomendado)». Relayed: «La vacante cuenta una sola vez, no como nueva. Entregas, tiempo y placements del reemplazo son del proceso, con filtro «Originales / Reemplazos» y una insignia en los detalles. El resultado original no cambia.» **Vacancy-level figures count the root only; process-level figures count every process** and carry the `process_kind` filter (§«Metrics»). |
| D10 | S10 | The frontend needs map to: `GET V/lifecycle` (+ `kind`, `replacement_of`, `root_process_id`, `can_start_replacement`), the draft list (+ `kind`, `root_process_id`), `POST V/replacements` with `replacement_already_active`, the departure on a finished process, and the metrics filters. |
| D11 | S1 | **Stages map 1:1 by kind and name; ids follow the stored-pipeline invariant.** The replacement's pipeline has the source's stages, kinds, names and order. Built-in stages (`new`, `screening`, `screening_ok`, `in_process`, `placement`, and the exit) MUST have ids `UUIDv5(draft id, kind)` (`decodeStoredPipeline` rejects anything else, `…/draftstore/pipeline.go:182-192`), so they get **new ids derived from the new draft id**; custom stages (≤ 3) keep their source ids (stage ids are only unique per process: `process_participations` is keyed by `(process_id, stage_id)`, no global constraint). Requests therefore name stages by their **source id** (what the frontend already has from the source board) and the server maps them; the 201 response returns the mapping. |
| D12 | S1 | **Permissions mirror the lifecycle.** Whoever may run lifecycle actions on the **source** (owner or active tramo on the source's team, recruiter role) may start a replacement; nothing is stricter. |
| D13 | S1 | **The team is fresh, not cloned.** The replacement opens with its own `with_responsible` team: the caller as `responsible` (vacancy-team-v1 Q2), or `responsible.user_id` when the owner names someone else. The source's tramos, deadlines and reassignments stay on the source. |

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
- `allowed_actions` of a closed covered process drops `reopen` (it keeps `finish_process` while `process = active`).
- Direct `POST V/lifecycle/reopen` on a closed covered process → **409 `reopen_requires_replacement`** (checked at the
  existing «invalid state» step, before body/readiness checks, so it never masks a stale-ETag 412).
- Closed covered with no startable credits: neither Reopen nor Start are offered (`can_start_replacement = false`, blocker
  `no_startable_credits`); the first departure enables Start.

### Start preconditions (D2, D3, D5)

Evaluated in this order inside one transaction, after the general gates, key shape, replay and `If-Match` (as `reopen` does):

1. Source resolved and authorized (D12); never published / no process row → 409 `replacement_source_not_closed`.
2. Source `status = 'closed'` (closed covered, closed not covered, closed+active and closed+finished all qualify) → else 409 `replacement_source_not_closed`.
3. No active replacement in the chain → else 409 `replacement_already_active`.
4. Body validation (shape, `target_quantity ≥ len(placement_credit_ids)`, `commitment_date`).
5. Every credit: belongs to a process of the chain and company; `status = 'did_not_hold'`; no row in `vacancy_replacement_credits` → else 422 `replacement_credits_invalid`.
6. Carried candidates (§Carried candidates) → 422 `carried_candidate_invalid` / `carried_stage_invalid`.
7. Responsible (§Team) → 422 `not_company_member` / 403 `team_action_forbidden`.
8. `publish: true` → the source's public readiness (`publicationRequirements`, `…/draftstore/publication.go:246`) → 422 `publication_incomplete` with `missing`.

### Concurrency (D8)

At most one **active** (`process_status = 'active'`) replacement per root. Lock order extends the existing
draft → process → participation order (`…/postgres/board/store.go:75-76,292`): the **source draft row** `FOR UPDATE` (same as lifecycle
transitions, so Start serializes with close/reopen/finish of the source) → the **root process row** `FOR UPDATE`
(`SELECT … FROM vacancy_processes WHERE id = $root FOR UPDATE`, a fresh statement) → the credit rows
`FOR UPDATE` (re-validating `did_not_hold`, so an owner void/restore racing the start serializes) → inserts. With the root
lock held the transaction reads the chain, checks «no replacement with `process_status = 'active'`», computes
`sequence` and inserts; two simultaneous starts on the same chain therefore serialize and the loser gets
`replacement_already_active`. `UNIQUE (placement_credit_id)` and `UNIQUE (root_process_id, sequence)` are the backstop.
A concurrent `finish_process` of the active replacement commits either before the check (start succeeds) or after
(start rejected); both outcomes are consistent. The new draft id is fresh, so it contends with nothing.

**Reopen guard (assumption A1).** Reopening any process whose root has an active replacement (other than itself) is
rejected with 409 `replacement_already_active`: the logical vacancy already has its running replacement.

### Carried candidates (D5)

`carried_candidates[]`: `{ "candidate": { "kind": "manual" | "organic", "id": "<uuid>" }, "stage_id": "<source stage uuid>" }`. The
`candidate` pair is the same identity the manual intake (`existing`) and the talent pool already use: `kind = manual` →
`company_candidate_id`, `kind = organic` → the candidate's user id. (The feature doc named `company_candidate_id`; that
alone cannot address organic applicants, who have no company candidate, hence the pair — assumption A2.)

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
  A candidate whose credit is `did_not_hold` is a valid carry («Cualquiera»).
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

`{id}` is the **source** process (any closed process of the chain). Headers: `Idempotency-Key` (UUID, required; stored
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
- `target_quantity`: optional, default `len(placement_credit_ids)`; integer 1..999 and ≥ `len(placement_credit_ids)`
  (else 400 `validation_error`).
- `commitment_date`: required `YYYY-MM-DD`, same rules as the delivery PUT
  (`internal/features/jobs/application/deliveryconfig/config.go:115-118`): within today..today+1 year in Mexico City
  (400 `validation_error`), a business day (400 `non_business_date`).
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
  "lifecycle": { "…": "the new process' lifecycle view, §GET V/lifecycle" }
}
```

Errors (new codes in **bold**, §Error codes):

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request`, `validation_error`, `non_business_date`, `idempotency_key_required`, `invalid_idempotency_key` | existing semantics |
| 403 | **`team_action_forbidden`** (existing team code) | non-owner names another responsible |
| 404 | `not_found`, `team_access_ended` | source not visible to the caller |
| 409 | **`replacement_source_not_closed`** | source is not closed (open, paused, never published) |
| 409 | **`replacement_already_active`** | the chain already has an active replacement; `data: { process_id, root_process_id }` |
| 409 | `idempotency_conflict` | same key, different payload |
| 412/428 | `version_conflict` / `precondition_required` | stale / missing lifecycle ETag |
| 422 | **`replacement_credits_invalid`** | `data.credits: [{ credit_id, reason: "not_in_chain" \| "not_did_not_hold" \| "already_replaced" }]` |
| 422 | **`carried_candidate_invalid`** | `data.candidates: [{ index, reason: "not_in_chain" \| "currently_placed" \| "duplicate" }]` |
| 422 | **`carried_stage_invalid`** | `data.candidates: [{ index, reason: "stage_not_found" \| "stage_is_placement" \| "stage_is_exit" }]` |
| 422 | `not_company_member`, `publication_incomplete` (+ `missing`) | existing codes |

Atomic: draft, clones, team, process, link rows, carried participations, projection (when `publish`), idempotency row and
audit events commit or roll back together (fail-closed audit, as `Append` does today).

### `GET V/replacements`

The chain of the logical vacancy `{id}` belongs to (works from the original or from any replacement). Authorization:
the same as `GET V/lifecycle` (owner or active tramo on `{id}`).

```json
{
  "root_process_id": "…",
  "items": [
    { "id": "…", "kind": "original", "sequence": null, "replacement_of": null,
      "title": "Analista contable", "visibility": "public",
      "lifecycle": { "publication": "closed", "process": "finished", "close_reason": "filled", "closed_at": "…" },
      "started_at": "2026-09-01T15:00:00.000000Z", "started_by": { "id": "…", "name": "…" },
      "coverage": { "covered": 2, "required": 3 }, "replaced_credit_ids": [], "can_open": true },
    { "id": "…", "kind": "replacement", "sequence": 1, "replacement_of": "<original id>",
      "title": "Analista contable", "visibility": "private",
      "lifecycle": { "publication": "published", "process": "active", "close_reason": null, "closed_at": null },
      "started_at": "…", "started_by": { "id": "…", "name": "…" },
      "coverage": { "covered": 0, "required": 1 }, "replaced_credit_ids": ["…"], "can_open": true }
  ],
  "start_replacement": {
    "allowed": false,
    "blocker": "replacement_active",
    "active_replacement_id": "…",
    "startable_credits": []
  }
}
```

- `items` ordered original first, then `sequence` ascending. `started_at` of the original is its `published_at`.
  `coverage` is the live board coverage of that process. `can_open` = the caller may open that draft (owner or active
  tramo); the list itself exposes only titles, counts and lifecycle, never candidate data.
- `start_replacement.allowed` = the source `{id}` is closed ∧ ≥ 1 startable credit ∧ no active replacement in the chain.
  `blocker` ∈ `null | "source_not_closed" | "no_startable_credits" | "replacement_active"`. `startable_credits` is filled
  **only when allowed**; each item:

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
- `visibility`: `public` (projection exists) | `private` (replacement without projection) | `null` (never published). A
  private replacement has `publication: "published"` (the process axis, D8) and `allowed_actions` also contains
  `"publish"` while `publication` is `published` or `paused` (it routes to `POST V/publication`, as the existing
  `publish` action does).
- `allowed_actions`: `reopen` is removed when `closed_covered` (D6).
- `can_start_replacement` = source closed ∧ `startable_credits_count ≥ 1` ∧ `active_replacement_id = null`.
  `start_replacement_blocker`: `null | "source_not_closed" | "no_startable_credits" | "replacement_active"`.
  `startable_credits_count` and `active_replacement_id` are computed against the whole chain. The credit detail lives in
  `GET V/replacements` (so the lifecycle read stays one cheap query per embed).
- New 409 on `POST V/lifecycle/reopen`: **`reopen_requires_replacement`**, `data: { action: "reopen", lifecycle: <view> }`
  (same envelope as `lifecycle_transition_invalid`); and **`replacement_already_active`** (A1), `data: { process_id,
  root_process_id }`.

### Draft list (D10)

`GET /v2/me/company/job-drafts` (`cmd/api/router.go:390`, item `draftListItem`, `…/http/draftListHandler.go:49-67`) items gain:

```json
{ "kind": "replacement", "sequence": 1, "replacement_of": "…", "root_process_id": "…", "visibility": "private" }
```

For an original `kind = original`, `sequence`/`replacement_of` null, `root_process_id` = `id`; a never-published draft has
`visibility: null`. The query (`…/draftstore/list_v2.go:36-48`) left-joins `vacancy_replacements` and the projection; the
cursor, ordering (`updated_at DESC, id DESC`) and the `status` field (`COALESCE(p.status,'draft')`) do not change, so a
private replacement lists with `status: "published"` and the badge comes from `kind`/`visibility`. No new filter in v1.

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
- `can_start_replacement` turns true on the next lifecycle read when the source is closed, the credit is `did_not_hold`
  and no replacement is active.
- Audit: unchanged events (`ParticipationDiscarded`, `VacancyPlacementCreditChanged` with `cause = exit:<reason>`); the
  process state at that moment is in `vacancy_lifecycle_events`. The owner's credit void/restore
  (`POST V/participations/{pid}/placement-credits/{cid}/void|restore`) is not blocked by `finished` today and does not change;
  voiding a credit that a replacement already took leaves the link in place.

### Metrics (D9)

Filter **`process_kind`** = `original | replacement`, one value, absent = both. Naming follows the v2 filters
(`requester_kind`, `stage_kind`, `close_reason`; strict parser, 422 `invalid_filter` `process_kind: invalid`, repeated →
`duplicate`). It is a **common filter**: accepted by every route of `GET /v2/me/company/metrics/*` (sections, recruiter
routes, lists, exports, `vacancies/{draftId}/deliveries|placements`; `cmd/api/router.go:265-286`) and echoed in
`applied_filters.process_kind` of every list. It joins the cursor hash like the other filters.

Counting rule (D9): **a replacement never counts as a new vacancy; its deliveries, placements, time and pipeline are its own
process' figures.**

| Level | Figure (endpoint · field) | Rule |
| --- | --- | --- |
| **Vacancy-level — root only, `process_kind` ignored** | `summary` · `vacancies.assigned`, `vacancies.closed`, `vacancies.median_business_days_to_close`, `vacancies.closing_target`, `by_requester[].vacancies/filled`, `placements.positions_covered/positions_required`, `closed_by_month`; `headline.assigned`, `headline.median_business_days_to_close`; `closures` · `closed_by_month`; `delays` · `closing_target`; `GET …/vacancies` (list, export, facets `close_reason`); recruiter cards `assigned` and conversion (`vacancies?scope=closed_assigned`, `credited_to`) | Replacement processes are **skipped**. `assigned` counts a root for a recruiter who has a tramo overlapping the period on the root **or on any replacement of it** (so someone who only worked the replacement is not invisible, and the vacancy still counts once — A5). `closed`/`closing_target`/median/positions are the root's own closes and coverage. |
| **Process-level — every process, `process_kind` filters** | `summary` · `delivery.*`, `headline.on_time_rate`, `on_time_by_month`; `placements.credits`, `did_not_hold`, `headline.placements`; `reassignments.*`, `headline.reassignments`; `origin.*`; `closures` · `delivery_status`; `compliance` · all; `delays` · `overdue`, `reassignments_by_reason`; `origin`; `pipeline`; `recruiters` and `recruiters/{userId}` (on-time N of M, placements, reassignments); lists `deliveries`, `placements`, `reassignments`, `candidates`, `applications` (+ exports); `vacancies/{draftId}/deliveries|placements` | Each replacement is a row/figure of its own: its delivery (own target and commitment), its time (`PublishedAt` = `started_at`), its credits, its pipeline and its team. `process_kind=original` = roots only; `replacement` = replacements only. |

- **Original unchanged.** `did_not_hold` credits stay in the original's `placements.did_not_hold`; the replacement's
  own hires are new credits on the replacement process. Nothing recomputes the original's delivery, close or coverage.
- **Rows carry the badge.** Every row that has `vacancy {draft_id, title}` gets `vacancy.kind`
  (`original | replacement`), `vacancy.root_draft_id` and `vacancy.sequence` (null for originals):
  `deliveries`, `placements`, `reassignments`, `candidates`, `applications`, the per-vacancy detail routes, and `pipeline.top_vacancies`.
  The `vacancies` list rows (root only) gain `replacements: { count, active_draft_id | null }`.
- **Facets.** Process-level lists add `facets.process_kind = { original: n, replacement: n }` computed with every filter but
  its own (v2 §5). CSV exports keep API codes in enum cells and gain a `process_kind` column.
- **Scope.** `scopeSQL` (`…/postgres/store.go:69`) loads, for every in-scope process, its **whole chain** (so root-level
  figures and `assigned` can see the replacement tramos). `Vacancy` gets `Kind`, `RootID`, `Sequence`; `Scope` gets
  `ProcessKind`.
- **Not changed.** Definitions version stays `v2`; all existing fields stay; the snapshot lifetime and cache key add
  `process_kind` to the filter part of the key; audit of metrics reads (`MetricsDetailViewed/Exported`) is unchanged.
- **Company dashboard** (`/v2/me/company/dashboard/*`, `company-dashboard-v2.md`) is operational: replacement processes are
  rows like any other, with `kind` on their vacancy objects, and no `process_kind` filter in v1 (open question Q1).

## Error codes

All through the closed catalog (`internal/shared/httpjson`); new codes join the lifecycle family
(`lifecycle_errors.go`) or a new `replacement_errors.go` resolved from `Resolve` like `resolveTeamError`
(`errors.go:95+`), and are added to the catalog code tests.

| Code | Status | `data` | Where |
| --- | --- | --- | --- |
| `replacement_source_not_closed` | 409 | `{ lifecycle }` | POST replacements |
| `replacement_already_active` | 409 | `{ process_id, root_process_id }` | POST replacements; reopen guard (A1) |
| `reopen_requires_replacement` | 409 | `{ action: "reopen", lifecycle }` | POST lifecycle/reopen on closed covered |
| `replacement_credits_invalid` | 422 | `{ credits: [{ credit_id, reason }] }` | POST replacements |
| `carried_candidate_invalid` | 422 | `{ candidates: [{ index, reason }] }` | POST replacements |
| `carried_stage_invalid` | 422 | `{ candidates: [{ index, reason }] }` | POST replacements |
| existing, reused as is | | | `team_action_forbidden` 403, `not_company_member` 422 (`team_errors.go`), `process_finished` 409, `placement_exit_reason_required` 409 (`movement_errors.go`), `lifecycle_transition_invalid` 409, `publication_incomplete` 422, `non_business_date` 400, `validation_error` 400, `precondition_required` 428, `version_conflict` 412, idempotency codes |

## Audit events

Same transaction, `entity_type = 'vacancy_process'` (the lifecycle events' entity, `…/draftstore/lifecycle.go:222`),
`entity_id` = the **new** process id, `VacancyID` = the new process id. Metadata is a closed set of ids and codes; free
text never goes in.

| Event (new) | Entity | Metadata |
| --- | --- | --- |
| `VacancyReplacementStarted` | `vacancy_process` (new id) | company_id, vacancy_id (new), source_process_id, root_process_id, sequence, target_quantity, credit_ids (list), carried_count, visibility (`private`\|`public`), responsible_user_id |
| `VacancyCandidateCarried` | `process_participation` (new participation id) | company_id, vacancy_id (new), source_process_id, source_participation_id, candidate_kind, candidate_id, stage_id |

Reused unchanged: `JobDraftCreated` (new draft), `VacancyTeamCreated` (new team), `VacancyPublished` (`publish: true`
or publish later), `VacancyDeliveryFulfilled` (if the carry fulfils), `VacancyReopened` (rejections emit nothing),
`ParticipationDiscarded` + `VacancyPlacementCreditChanged` (departure, D7). The existing
`VacancyCandidateAddedManually` is **not** reused for carries (its keys include `cv_id`).

**A catalog event lives in four places; a new type must be added to all four**:

1. the constant in `internal/features/audit_events/domain/entities/catalog.go` (vacancy group, next to `EventVacancyPlacementCreditChanged`, line 93);
2. its `spec(Event…, CategoryVacancy|CategoryCandidate, <closed metadata keys>)` row in the `catalog` slice (same file, ~line 203-209; `VacancyReplacementStarted` → `CategoryVacancy`, `VacancyCandidateCarried` → `CategoryCandidate`);
3. its row in the **Annex** of `docs/contracts/audit-log-v1.md` (the label table; update its «(63)» count; `catalog_annex_test.go` fails without the row);
4. its label in the frontend annex copy `frontend/src/features/audit-log/model.ts` (`ANNEX`, ~line 63-134; the frontend session owns it; an unknown type renders a generic label until then).

Proposed labels (es-MX, for the annex): `VacancyReplacementStarted` → «Inició un proceso de reemplazo»; `VacancyCandidateCarried` →
«Reutilizó a un candidato en un proceso de reemplazo».

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

Each ≤ ~400 changed lines where possible; every slice ships integration tests through the production router. Order matters.

1. **R1 · Migration and chain primitives** (~250): `00063_replacement_processes.sql` (+ down guard), sqlc/queries or store helpers:
   resolve root/chain, startable credits, active replacement, closed-covered predicate. No routes. Migration up/down test.
2. **R2 · Lifecycle read side + reopen guard + codes** (~350): `lifecycle.View` keys (`kind`, `sequence`, `replacement_of`,
   `root_process_id`, `visibility`, `closed_covered`, `can_start_replacement`, blocker, counts), `AllowedActions` without `reopen`
   when closed covered, `reopen_requires_replacement` and the A1 guard, draft list keys, `replacement_errors.go`. Observable
   with seeded rows before Start exists.
3. **R3a · Start: clone + process + links** (~400): `POST V/replacements` with credits, target, commitment date, responsible,
   idempotency, ETag, concurrency (§Concurrency), `VacancyReplacementStarted`, audit catalog in the four places (backend three; docs annex).
4. **R3b · Carried candidates** (~350): participation copy, `intake` history, delivery rule change (`reachedCandidates`/`RecordDelivery`), `VacancyCandidateCarried`,
   candidate-facing exclusion, the three carry error codes.
5. **R3c · Private/public** (~300): `publish: true`, `readPublishedAt` → projection keyed, `refreshPublicProjection` fix, publish-later,
   `GET V/publication` for private replacements, `allowed_actions` `publish`.
6. **R4 · `GET V/replacements`** (~250): chain list, `start_replacement`, startable credits, coverage per item.
7. **R5 · Departure on finished** (~200): the `beginMutation` exception and tests (finished: Placement discard allowed with both
   reasons; recover/move/substate/intake still 409; coverage, credit status, milestones and fulfillment unchanged).
8. **R6 · Metrics** (~400, split in two if needed): dataset kind/root/chain load, `process_kind` filter parsing and cache key, vacancy-level vs process-level
   figures, row badges, facets, exports. Per-figure tests asserting list totals equal figures (v2 rule).
9. **R7 · Dashboard rows** (~100): `kind` on dashboard vacancy objects (after Q1).

## Open questions

- **Q1 · Dashboard counts.** `company-dashboard-v2` counts «published vacancies» from `vacancy_processes.status = 'published'`
  (an operational notion). A private active replacement would count there. Recommendation: **count it** (it is real work in
  progress, and the dashboard is operational, not the stakeholder's «una vacante lógica»); alternative: count only
  `visibility = public` processes. Decide before slice R7; R1–R6 do not depend on it.

## Assumptions made in this draft (flag in review)

- **A1** Reopen of any process of a chain with an active replacement is rejected (`replacement_already_active`); the feature doc is silent.
- **A2** Carried candidates are addressed by `{ kind, id }` (manual or organic), not by `company_candidate_id` alone.
- **A3** A carried intake counts as a delivered candidate with the manual-intake rule, for both sources.
- **A4** On a finished process an unknown participation answers 404 (was 409 `process_finished`) on the discard route only.
- **A5** A recruiter counts as «assigned» to a logical vacancy if they have a tramo on the root or any of its replacements.
- **A6** `closed covered` is defined by the latest close reason `filled`, not by live coverage.

## Out of scope (v1)

Notifications; automatic replacement start; re-linking a credit to a second replacement; guarantee-window rules
(«no time limit», S2); replacement-specific KPIs (e.g. share of `did_not_hold` credits replaced); a replacement badge in
the talent pool; public mention of replacement (forbidden by S4); filters on the draft list; per-recruiter replacement
quotas.

## Decisions status

Nothing here is approved yet. Review by the frontend session first; the user decides Q1 and confirms A1–A6 when the draft
is accepted. Implementation slices start only after that.
