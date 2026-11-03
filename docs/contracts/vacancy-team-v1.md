# Vacancy team and assignment v1 (internal, employer-only)

Status: **agreed (2026-11-02)**, not implemented. Product source: `docs/product/next-three-features.md` §1 (frontend
worktree), with all open questions decided by the user (Q1–Q12, verbatim confirmations recorded there). The backend
session wrote this contract. Style follows `vacancy-checklist-v1.md`.

## Purpose

A vacancy is worked by a **team of 1..N company members**. Each membership is a **tramo** (assignment period) with a
start, an optional end, a function and a cause. The team replaces `job_drafts.principal_recruiter_id`. The team decides
who can see and work the vacancy, who gets the credit for a placement, and how each recruiter's deadlines and deliveries
are measured. Every team change is audited.

The system is not in production and all data is disposable: the migration may drop and rebuild data.

## Backend facts this contract builds on

- Today one Go predicate (`authorized`, `draftstore/store.go:425`: owner OR `principal_recruiter_id`) and one SQL fragment
  (`visibleV2Drafts`, `draftstore/list_v2.go:18`) guard every vacancy-scoped surface: draft read/save, pipeline,
  substates, delivery, management, checklist and marks, publication, lifecycle, board (move, history, detail, CV, discard,
  recover, substate, manual intake), psychometric profile/invitations/results. Unauthorized collapses to 404.
- The company talent pool (org-candidate search, detail, history, edits, CVs, contacts export) is company-wide for every
  recruiter. Its visibility setting is unit **1b** (§9), not this contract.
- Company roles are `owner` and `recruiter` only; `company_members.user_id` is unique (one company per user); removing a
  member hard-deletes the membership row.
- The client commitment is `job_draft_delivery_configs.commitment_date`; the shared target is its `target_quantity`.
- A placement is a participation entering the semantic `placement` stage (stage-history row with `hire=true`). Manual
  intake can never land in `placement` (`ValidateManualStage`), so hires come only from a **move** or a **recovery**.
  Leaving `placement` happens through a **move** or a **discard**, both gated today by `confirm_placement_exit: true`.

## Data model (migration 00054)

```sql
CREATE TABLE vacancy_teams (
  draft_id   uuid PRIMARY KEY REFERENCES job_drafts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id),
  mode       text NOT NULL CHECK (mode IN ('with_responsible','shared')),
  version    bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL
);

-- One row = one tramo = one CONTINUOUS stay of a person on the vacancy. A tramo ends only when the person leaves the
-- team (removed, left, replaced as responsible with previous_responsible = remove, membership ended). Mode changes and
-- responsible handovers never split a stay; they change the function inside it (vacancy_assignment_functions).
CREATE TABLE vacancy_assignments (
  id                 uuid PRIMARY KEY,
  draft_id           uuid NOT NULL REFERENCES vacancy_teams(draft_id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,
  user_id            uuid NOT NULL REFERENCES users(id),
  started_at         timestamptz NOT NULL,
  started_by         uuid NULL REFERENCES users(id),           -- NULL only for the migration backfill
  start_cause        text NOT NULL CHECK (start_cause IN ('creation','added','reassignment','backfill')),
  recruiter_deadline date NULL,                                -- NULL = falls back to commitment_date
  ended_at           timestamptz NULL,
  ended_by           uuid NULL REFERENCES users(id),
  end_cause          text NULL CHECK (end_cause IN ('removed','left','reassigned','membership_ended')),
  closing_deadline   date NULL,                                -- effective deadline frozen when the tramo ends
  reassignment_id    uuid NULL,
  CHECK ((ended_at IS NULL) = (end_cause IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX vacancy_assignments_one_active_per_user ON vacancy_assignments(draft_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX vacancy_assignments_active_by_user ON vacancy_assignments(user_id) WHERE ended_at IS NULL;
CREATE INDEX vacancy_assignments_by_user ON vacancy_assignments(user_id, started_at DESC);

-- Function periods inside a tramo; exactly one open period per active tramo.
CREATE TABLE vacancy_assignment_functions (
  id            uuid PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id) ON DELETE CASCADE,
  draft_id      uuid NOT NULL,                     -- denormalized for the one-responsible index
  function      text NOT NULL CHECK (function IN ('responsible','collaborator','member')),
  started_at    timestamptz NOT NULL,
  start_cause   text NOT NULL CHECK (start_cause IN ('creation','added','reassignment','mode_change','backfill')),
  ended_at      timestamptz NULL,
  end_cause     text NULL CHECK (end_cause IN ('reassignment','mode_change','tramo_ended')),
  CHECK ((ended_at IS NULL) = (end_cause IS NULL))
);
CREATE UNIQUE INDEX vacancy_assignment_functions_one_open ON vacancy_assignment_functions(assignment_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX vacancy_assignment_functions_one_responsible ON vacancy_assignment_functions(draft_id) WHERE ended_at IS NULL AND function = 'responsible';

CREATE TABLE vacancy_reassignments (               -- responsible handover
  id                 uuid PRIMARY KEY,
  draft_id           uuid NOT NULL REFERENCES vacancy_teams(draft_id) ON DELETE CASCADE,
  company_id         uuid NOT NULL,
  from_assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id),
  to_assignment_id   uuid NOT NULL REFERENCES vacancy_assignments(id),
  reason             text NOT NULL CHECK (reason IN ('workload','recruiter_departure','performance','client_request','other')),
  note               text NULL CHECK (reason <> 'other' OR length(btrim(note)) BETWEEN 1 AND 500),
  previous_responsible text NOT NULL CHECK (previous_responsible IN ('remove','keep_as_collaborator')),
  performed_by       uuid NOT NULL REFERENCES users(id),
  performed_at       timestamptz NOT NULL,
  state_snapshot     jsonb NOT NULL
);

CREATE TABLE vacancy_team_mode_changes (           -- history of PUT V/team/mode
  id                  uuid PRIMARY KEY,
  draft_id            uuid NOT NULL REFERENCES vacancy_teams(draft_id) ON DELETE CASCADE,
  company_id          uuid NOT NULL,
  from_mode           text NOT NULL CHECK (from_mode IN ('with_responsible','shared')),
  to_mode             text NOT NULL CHECK (to_mode IN ('with_responsible','shared') AND to_mode <> from_mode),
  responsible_user_id uuid NULL REFERENCES users(id),        -- set when to_mode = with_responsible
  performed_by        uuid NOT NULL REFERENCES users(id),
  performed_at        timestamptz NOT NULL
);

CREATE TABLE vacancy_commitment_changes (          -- renegotiation after publication
  id            uuid PRIMARY KEY,
  draft_id      uuid NOT NULL REFERENCES job_drafts(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL,
  previous_date date NULL,
  new_date      date NOT NULL,
  reason        text NOT NULL CHECK (reason IN ('client_request','scope_change','internal_delay','other')),
  note          text NULL CHECK (reason <> 'other' OR length(btrim(note)) BETWEEN 1 AND 500),
  performed_by  uuid NOT NULL REFERENCES users(id),
  performed_at  timestamptz NOT NULL
);

CREATE TABLE placement_credits (                   -- one row per hire; company totals count rows (1, not N)
  id                uuid PRIMARY KEY,
  company_id        uuid NOT NULL,
  process_id        uuid NOT NULL,
  participation_id  uuid NOT NULL,
  hire_history_id   uuid NOT NULL UNIQUE,          -- stage-history row with hire = true
  hired_at          timestamptz NOT NULL,
  hired_by          uuid NOT NULL REFERENCES users(id),   -- the mover; never a credit recipient by itself
  team_mode         text NOT NULL CHECK (team_mode IN ('with_responsible','shared')),
  status            text NOT NULL CHECK (status IN ('active','did_not_hold','voided')) DEFAULT 'active',
  exit_history_id   uuid NULL,                     -- stage-history row with departure = true
  exit_reason       text NULL CHECK (exit_reason IN ('moved_by_mistake','candidate_left')),
  status_changed_at timestamptz NULL,
  status_changed_by uuid NULL REFERENCES users(id)
);
CREATE TABLE placement_credit_recipients (
  credit_id     uuid NOT NULL REFERENCES placement_credits(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id),
  assignment_id uuid NOT NULL REFERENCES vacancy_assignments(id),
  kind          text NOT NULL CHECK (kind IN ('direct','participant','shared')),
  PRIMARY KEY (credit_id, user_id)
);

-- company-level setting for unit 1b lives in that unit's migration, not here
```

Migration steps: create the tables; backfill one `vacancy_teams` row per draft (`mode = 'with_responsible'`) and one
tramo (with an open `responsible` function period) for its `principal_recruiter_id` (`started_at` = draft `created_at`, `start_cause = 'backfill'`);
drop `job_drafts.principal_recruiter_id`. Down is supported with guards (pattern of 00053/00034): under an exclusive lock on `job_drafts` it
refuses with a clear message while any draft has no open responsible (a `shared` team) or any credit, reassignment,
commitment change or mode change exists; otherwise it restores `principal_recruiter_id` from the open responsible and
drops the new tables.

`state_snapshot` (counts and dates only, never candidate data). `stage_counts[].kind` is the stage's pipeline kind as
stored in the vacancy's pipeline config at capture time (`new`, `screening`, `screening_ok`, `in_process`, `placement`,
`custom`); the exit stage is not listed (its candidates are the `discarded` counts):

```json
{
  "captured_at": "2026-11-12T16:04:00Z",
  "lifecycle": { "publication": "draft|published|paused|closed", "process": "active|finished|null" },
  "stage_counts": [{ "stage_id": "…", "stage_name": "Entrevista", "kind": "custom", "active": 3, "discarded": 1 }],
  "tramo": { "started_at": "…", "effective_deadline": "2026-11-20", "deadline_source": "recruiter|commitment|none",
             "business_days_elapsed": 7, "business_days_total": 12 },
  "delivery": { "target": 5, "delivered": 3, "fulfilled_at": null, "result": null, "commitment_date": "2026-11-30" },
  "placements": { "current": 0, "credited": 0 }
}
```

## Rules

### Team and modes

- **Default** (Q2): a new vacancy is created with `mode = with_responsible` and its creator as the `responsible`, in the
  same transaction as the draft creation.
- **Who can be on a team** (Q3): any current company member, owner included.
- `with_responsible`: exactly one active `responsible` plus 0..N `collaborator`. **Invariant** (Q5): a vacancy in this mode
  always has an active responsible; every operation that would break it is rejected.
- `shared`: 1..N active `member`, all equal. The last member cannot leave or be removed.
- **No size limit** in v1 (Q11).
- **A tramo is a continuous stay.** Changing the mode, or a responsible handover where someone stays on the team, never
  ends a tramo: it closes the open function period (`end_cause = mode_change | reassignment`) and opens the new one at
  the same instant. The tramo keeps its `started_at`, `recruiter_deadline` and its delivery count. A tramo ends only when
  the person leaves the team: `removed`, `left`, `reassigned` (replaced as responsible with `previous_responsible =
  remove`), `membership_ended`. Rejoining later opens a new tramo.

### Access (replaces owner-OR-principal)

```go
// authorized: the company owner, or an active tramo on this vacancy's team.
func authorized(auth authContext, record draftRecord) bool {
    return auth.role == roleOwner || record.activeTeamMember
}
```

`readDraft` loads `active_team_member` with
`EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = d.id AND a.user_id = $actor AND a.ended_at IS NULL)`.
`visibleV2Drafts` becomes
`d.company_id = $1 AND ($2::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id = d.id AND a.user_id = $3 AND a.ended_at IS NULL)) AND …schema_version = '2'`.
Same two choke points, same 404 collapse, so every surface listed above inherits it. Every team mutation locks the
`job_drafts` row `FOR UPDATE` (existing pattern), so a write by someone whose tramo is closing serializes against the
closure. An ex-member loses the vacancy at the commit that ends the tramo. What they left running (psychometric
invitations, messages) stays valid and belongs to the team.

**Lost access** (v1): when the guard denies a caller who once held a tramo on that vacancy (ended tramo, no active one),
the 404 carries code `team_access_ended` instead of the generic not-found code, so the UI can say «Ya no formás parte
del equipo de esta vacante». The check runs only on the denied path (one extra `EXISTS` on ended tramos) and reveals
nothing to people who never had access.

### Team actions

A caller who can see the vacancy but may not perform the action gets **403 `team_action_forbidden`**.

| Action | with_responsible | shared |
| --- | --- | --- |
| Add a member | responsible or owner | any active member or owner |
| Remove another member | responsible or owner | owner |
| Leave | collaborator; responsible → 409 `responsible_cannot_leave` | any member except the last |
| Reassign the responsible | owner | — (409 `team_mode_mismatch`) |
| Change the mode | owner | owner |
| Edit a tramo's `recruiter_deadline` (Q7) | responsible or owner | any active member or owner |
| Renegotiate the commitment (Q8) | any active member or owner | any active member or owner |

"Owner" means the company role; an owner who is also on the team gets the union.

### Deadlines (Q7, Q8)

- `recruiter_deadline` is optional at assignment. The **effective deadline** of an active tramo is
  `recruiter_deadline ?? delivery commitment_date ?? none`; `deadline_source` says which. When a tramo ends, its effective
  deadline is frozen in `closing_deadline`, so later renegotiations never change a closed tramo's on-time result.
- `commitment_date` belongs to the vacancy. **Before publication** it is edited freely through `PUT …/pipeline/delivery`
  (unchanged). **After publication** (`vacancy_processes` row exists) that PUT rejects a changed `commitment_date` with
  409 `commitment_change_requires_renegotiation` (other delivery fields are unaffected), and the date changes only through
  `POST …/commitment` with a reason.

### Placement credit (Q4, Q6)

Recipients take the function each active tramo holds at the hire instant (its open function period).

- Written in the same transaction as every stage-history row with `hire = true` (move into `placement`, or recovery back
  into it).
- `with_responsible`: the responsible gets `direct`, every active collaborator gets `participant`. `shared`: every active
  member gets `shared`. Recipients and `team_mode` are frozen at that moment; later mode or team changes never recalculate.
- The mover is recorded only as `hired_by` (Q4); an owner or ex-member who makes the move gets nothing unless they hold an
  active tramo.
- **Leaving placement** (move or discard) requires a reason instead of `confirm_placement_exit: true`:
  `"placement_exit_reason": "moved_by_mistake" | "candidate_left"`. Missing → the existing placement-exit error, now with
  code `placement_exit_reason_required`. `moved_by_mistake` → credit `voided`; `candidate_left` → credit `did_not_hold`
  (it still counts as a placement that did not hold). Leaving placement stays a team action.
- **Discard out of placement asks for both reasons, and they are independent.** The discard reason (`group`/`key`) says
  why the candidate leaves the process (recruiter decision or candidate withdrawal) and feeds discard analytics and the
  candidate message. `placement_exit_reason` says only what happens to the credit. They cannot be derived from each other:
  a candidate withdrawal can follow a real placement (`candidate_left`) or a placement recorded by mistake
  (`moved_by_mistake`). The UI asks for both.
- The owner may correct afterwards: void an `active`/`did_not_hold` credit, or restore a `voided` one to its previous
  outcome. Audited.
- Recruiter card counts: `direct` and `shared` count 1 each; `participant` is reported separately. Company totals count
  `placement_credits` rows. The `did_not_hold` share feeds the replacement-guarantee metrics in feature 3.

### Delivered in a tramo (Q9)

`delivered_in_tramo` = participations whose stage-history entry into the delivery cutoff stage (or a later stage reached by
skipping it through manual intake) has `actor_id` = this recruiter and `created_at` within the tramo. Attribution is by
actor, not by any entry during the tramo.

### Company member removal (Q5)

- `{id}` in the member routes is the **membership** id (`company_members.id`), as today, not the user id.
- The UI reads `GET …/members/{id}/offboard-preview` first (below). `DELETE /v2/me/company/members/{id}` stays as the safety
  net: on a member who is the active responsible of any non-finished vacancy → 409 `member_is_responsible` with the same
  `data.vacancies` as the preview. Otherwise it ends all of that user's active tramos with `end_cause =
  membership_ended` in the same transaction.
- `POST /v2/me/company/members/{id}/offboard` (owner) does it in one atomic operation (below). On finished vacancies the
  responsible's tramo just ends; reopening a vacancy whose team has no active responsible requires assigning one first
  (409 `responsible_required`).

### Notifications (Q12)

None in v1. On the radar: in-app first, email once SES exists.

## Endpoints

Prefix `V = /v2/me/company/job-drafts/{id}`. Errors are JSON `{error, code, data?}`. The team resource has a strong
opaque ETag from `vacancy_teams.version`, returned in the `ETag` header of `GET V/team` and of every team write. Every
team write requires `If-Match` with it (missing 428, stale 412 `team_version_conflict`, malformed 400). Every POST
requires a UUID `Idempotency-Key` with frozen-response replay. Every team write returns 200 with the full team resource.

**Member picker** (adding someone): no new endpoint. `GET /v2/me/company/members` is already readable by recruiters
(`requireRecruiter`) and returns `members[].{id, role, user: {id, full_name, email}}`. The UI subtracts the active
members from `GET V/team` (match on `user.id`).

### `GET V/team`

```json
{
  "mode": "with_responsible",
  "members": [
    { "assignment_id": "…", "user": { "id": "…", "name": "Ana López" }, "function": "responsible",
      "started_at": "2026-11-02T18:00:00Z", "recruiter_deadline": null,
      "effective_deadline": "2026-11-30", "deadline_source": "commitment" }
  ],
  "viewer": {
    "function": "collaborator",
    "is_owner": false,
    "can": { "add_member": false, "remove_member": false, "leave": true, "reassign_responsible": false,
             "change_mode": false, "edit_deadline": false, "renegotiate_commitment": true }
  }
}
```

### `GET V/team/history?cursor=`

One mixed timeline, newest first by `at`, ties by `kind` then `id`. 20 items per page; `next_cursor` is opaque (`null` on
the last page); a malformed or foreign cursor → 400 `invalid_cursor`.

```json
{
  "items": [
    { "kind": "tramo", "at": "2026-11-02T18:00:00Z",
      "tramo": { "assignment_id": "…", "user": { "id": "…", "name": "Ana López" },
                 "started_at": "…", "started_by": { "id": "…", "name": "…" } | null, "start_cause": "added",
                 "ended_at": null, "ended_by": null, "end_cause": null,
                 "recruiter_deadline": null, "closing_deadline": null,
                 "functions": [{ "function": "collaborator", "started_at": "…", "ended_at": null,
                                 "start_cause": "added", "end_cause": null }] } },
    { "kind": "reassignment", "at": "…",
      "reassignment": { "id": "…", "from_user": { "id": "…", "name": "…" }, "to_user": { "id": "…", "name": "…" },
                        "reason": "workload", "note": null, "previous_responsible": "remove",
                        "performed_by": { "id": "…", "name": "…" }, "state_snapshot": { } } },
    { "kind": "mode_change", "at": "…",
      "mode_change": { "id": "…", "from_mode": "with_responsible", "to_mode": "shared",
                       "responsible_user": null, "performed_by": { "id": "…", "name": "…" } } }
  ],
  "next_cursor": null
}
```

`at` = for a tramo, its LATEST event: `coalesce(ended_at, latest functions[].started_at, started_at)`, so a recent
removal, departure or function change surfaces at the top (the item still carries `started_at`, `ended_at` and
`functions[]` for the whole stay); `reassignment.performed_at`; `mode_change.performed_at`. Because a tramo's `at` moves
when it changes, a team change made while paging may shift an item across pages; the UI re-reads from the first page
after its own writes. `functions[]` is in chronological
order. `state_snapshot` is the stored object of §«Data model». `started_by` is `null` only for `backfill`.

### `POST V/team/members`

`{ "user_id": "…", "recruiter_deadline": "2026-11-20" | null }`. Function `collaborator` (with_responsible) or `member`
(shared). Errors: 422 `not_company_member`; 409 `team_member_already_active`.

### `POST V/team/members/{user_id}/remove`

`{}`. Ends the tramo with `removed`. On the responsible → 409 `use_reassign_responsible`; on the last shared member → 409
`team_last_member`; not on the team → 404 `team_member_not_found`.

### `POST V/team/leave`

`{}`. Ends the caller's tramo with `left`. Errors: 409 `responsible_cannot_leave`, 409 `team_last_member`.

### `PATCH V/team/members/{user_id}`

`{ "recruiter_deadline": "YYYY-MM-DD" | null }`.

### `POST V/team/reassign-responsible` (owner)

```json
{ "to_user_id": "…", "reason": "workload|recruiter_departure|performance|client_request|other",
  "note": "required when reason = other, 1–500 chars", "recruiter_deadline": null,
  "previous_responsible": "remove" }
```

`previous_responsible` defaults to `remove` (Q10): the old responsible's tramo ends with `reassigned`. With
`keep_as_collaborator` their tramo continues and its function period changes to `collaborator`. If the target is already
on the team, their tramo continues and its function changes to `responsible`; otherwise a new tramo opens with
`start_cause = reassignment` (`recruiter_deadline` applies only to a new tramo). Writes the reassignment row with the
snapshot. Errors: 409 `reassign_target_is_responsible`;
422 `reassignment_note_required`; 422 `not_company_member`; 409 `team_mode_mismatch`.

### `PUT V/team/mode` (owner)

`{ "mode": "with_responsible" | "shared", "responsible_user_id": "…" }`. `responsible_user_id` is required when switching
to `with_responsible` and must be an active member (422 `responsible_not_on_team`). Same mode → 409 `team_mode_unchanged`.

### Delivery config ETag

`GET V/pipeline/delivery` already returns its strong ETag in the `ETag` header (stored-result pattern of
`writeDraftResult`); `POST V/commitment` requires `If-Match` with that ETag and returns the updated delivery config with
its new ETag.

### `POST V/commitment`

`{ "commitment_date": "YYYY-MM-DD", "reason": "client_request|scope_change|internal_delay|other", "note": "…" }`.
Updates `job_draft_delivery_configs.commitment_date` and writes `vacancy_commitment_changes`. Errors: 409
`vacancy_not_published` (before publication use the delivery PUT); 409 `commitment_unchanged`; 422
`commitment_note_required`; 409 `delivery_not_configured`. Uses the delivery config's ETag, not the team's.

### Placement exit (existing endpoints, changed body)

`POST V/participations/{pid}/moves` and `…/discard`: `confirm_placement_exit` is replaced by
`placement_exit_reason: "moved_by_mistake" | "candidate_left"`.

### Reading placement credits

- `GET V/participations/{pid}` (board participation detail) gains
  `placement_credit: { id, status, team_mode, hired_at, hired_by: {id, name}, exit_reason,
  recipients: [{ user_id, name, kind }] } | null` (the latest credit) and
  `can: { void_credit, restore_credit }` (true only for the owner and only when the transition is valid).
- `GET V/participations/{pid}/placement-credits` lists every credit of that participation (a re-hire creates another),
  newest first, same item shape.

### `POST V/participations/{pid}/placement-credits/{credit_id}/void` and `/restore` (owner)

`{}`. Void: `active|did_not_hold → voided`. Restore: `voided →` the outcome its exit reason implies (`active` while the
participation is still in placement, else `did_not_hold`). Errors: 409 `credit_status_unchanged`.

### `GET /v2/me/company/members/{id}/offboard-preview` (owner, read-only)

```json
{ "user": { "id": "…", "full_name": "Luis Pérez" },
  "vacancies": [{ "draft_id": "…", "title": "Analista contable", "lifecycle": "published",
                  "team": [{ "user_id": "…", "name": "Ana López", "function": "collaborator" }] }],
  "other_tramos": 3 }
```

`vacancies` lists ONLY non-finished vacancies where the member holds the open `responsible` function, each with its
current team (the member excluded) so the UI can suggest a target. `other_tramos` counts the collaborator/member tramos
and finished-vacancy tramos that will simply end. Empty `vacancies` → a plain `DELETE` is enough.

### `POST /v2/me/company/members/{id}/offboard` (owner)

```json
{ "default_to_user_id": "…", "reassignments": [{ "draft_id": "…", "to_user_id": "…" }] }
```

Every non-finished vacancy where the member is responsible must resolve to a target (per-vacancy entry or the default),
otherwise 422 `offboard_unresolved_vacancies` with the list. Atomic: one reassignment per vacancy (reason
`recruiter_departure`, `previous_responsible = remove`), every other tramo ended with `membership_ended`, the membership
removed. Uses `Idempotency-Key`; no team ETag (it spans vacancies; each vacancy row is locked).

### `GET /v2/me/vacancy-assignments/history?cursor=` (any company member, own tramos only)

```json
{ "items": [{ "vacancy_title": "Analista contable",
              "functions": [{ "function": "responsible", "started_at": "…", "ended_at": "…" },
                            { "function": "collaborator", "started_at": "…", "ended_at": "…" }],
              "started_at": "…", "ended_at": "…", "end_cause": "removed",
              "effective_deadline": "2026-11-12", "delivered_in_tramo": 8,
              "placements": { "direct": 0, "participant": 1, "shared": 0 } }],
  "next_cursor": null }
```

One item per tramo (continuous stay), so «tu tramo del 1 al 12, entregaste 8» is never split by a mode change or a
handover. No candidate data. Ex-members keep this view while they belong to the company.

### Breaking changes to existing responses

- Draft list item `principal_recruiter` and the v2 draft body's `principal_recruiter_id` become
  `team: { mode, responsible: { id, name } | null, members_count, viewer_function }`. The v2 draft body is shared by
  `GET`, create (`POST`) and save (`PATCH`), so all three return `team` (`viewer_function` = the caller's open function or
  `null`). Idempotent replays return the response exactly as it was frozen, so a replay of a request made before this
  change still carries `principal_recruiter_id`. Draft ETags and canonical write fingerprints do not change. v1 draft
  responses keep their shape.
- `POST /v2/me/company/job-drafts` keeps its body; the creator becomes the responsible.
- `PUT …/pipeline/delivery`: commitment rule above.
- Move and discard bodies: `placement_exit_reason` above.

## Audit events

Same transaction, `entity_type = 'vacancy'`, `entity_id = draft_id` unless stated. Metadata carries IDs and codes only;
free-text notes stay in the domain tables, never in audit metadata. `company_id` goes in metadata until feature 2
promotes it to a column.

| Event | Metadata |
| --- | --- |
| `VacancyTeamCreated` | company_id, mode, responsible_user_id, assignment_id |
| `VacancyTeamMemberAdded` | company_id, assignment_id, user_id, function, recruiter_deadline |
| `VacancyTeamMemberRemoved` | company_id, assignment_id, user_id, function |
| `VacancyTeamMemberLeft` | company_id, assignment_id, user_id, function |
| `VacancyResponsibleReassigned` | company_id, reassignment_id, from_user_id, to_user_id, from_assignment_id, to_assignment_id, reason, previous_responsible |
| `VacancyTeamModeChanged` | company_id, from_mode, to_mode, responsible_user_id (function periods change; tramos continue) |
| `VacancyAssignmentDeadlineChanged` | company_id, assignment_id, user_id, previous, new |
| `VacancyCommitmentRenegotiated` | company_id, change_id, previous_date, new_date, reason |
| `CompanyMemberOffboarded` (`entity_type = 'company_member'`) | company_id, user_id, reassignment_ids, ended_assignment_ids |
| `VacancyAssignmentEndedByMembership` | company_id, assignment_id, user_id |
| `VacancyPlacementCredited` (`entity_type = 'process_participation'`) | company_id, vacancy_id, credit_id, team_mode, hired_by, recipients `[{user_id, kind}]` |
| `VacancyPlacementCreditChanged` (`entity_type = 'process_participation'`) | company_id, vacancy_id, credit_id, from_status, to_status, cause (`exit:moved_by_mistake`, `exit:candidate_left`, `owner_void`, `owner_restore`) |

## Out of scope (v1)

Individual quotas per recruiter (later, optional); notifications (Q12); talent-pool visibility (unit 1b); metrics screens
and the recruiter card UI (feature 3); `company_id`/IP/UA columns and DB-enforced append-only audit (feature 2).
