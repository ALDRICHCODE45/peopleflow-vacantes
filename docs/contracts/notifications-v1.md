# Notifications v1 (in-app, stage 1; company members and candidates)

Status: **Agreed — Q1–Q8 decided by the user, reviewed by the frontend; in implementation** (2026-11-26): capture (N1), fan-out (N2), scheduler (N3), member read API (N4), member marks/facets (N5), candidate routes (N6) and the purge command (N7) done on `feat/notifications-backend`. Source of the requested shape:
the frontend proposal `peopleflow-vacantes-frontend/odd/tasks/notifications-system-contract.md` and its decisions
`…/odd/tasks/notifications-system.md` (L1–L9). Backend tracking: `odd/tasks/notifications-backend.md` (S1 request,
S2 backend counter-proposal, **L4 frontend agreement, which overrides S2 where they differ**). Branch
`feat/notifications-backend`. Style follows `replacement-processes-v1.md`. Every `path:line` is a backend path (under
`backend/`) at the commit this draft was written against.

## Purpose

Give company members (owner, recruiter; stakeholder later) and candidates with an account an in-app bell and inbox for
the stage-1 events: new applications, delivery due soon / overdue, vacancy assignment / reassignment / team addition,
psychometric test completed / pending, and the candidate's own status changes, closing messages and pending tests. The
inbox is **grouped server-side**, pins an **attention** section (unread due-soon / overdue deliveries and recruiter deadlines), supports filters
by type and vacancy, cursor pagination, read / unread (exact undo) / read-all, an unread counter cheap enough for
~30 s polling, and facets for the filter popover (design 07).

Email (stage 2) and owner rules / per-role recipients (stage 3) are out of scope, but nothing here blocks them. The
system is not in production and all data is disposable.

## Backend facts this contract builds on

- **Every stage-1 event is already an audit event appended inside the domain transaction.** The audit port's only
  adapter validates and inserts in the caller's `pgx.Tx`, never opening its own
  (`internal/features/audit_events/infrastructure/postgres/auditEventRepository.go:41-58`). The production instance is
  built in the composition root only: `cmd/api/main.go:237` (shared `auditRepo`) and `cmd/api/main.go:573`
  (documents store). The audit table is append-only (no processed flag possible).
- **Exact audit types and metadata keys** (`internal/features/audit_events/domain/entities/catalog.go`):
  - `VacancyApplicationSubmitted` `{vacancy_id, stage_id, source}` (`catalog.go:194`); emitted by Apply with
    `entity_type = process_participation`, `entity_id` = participation, actor = the candidate user
    (`internal/features/applications/infrastructure/postgres/v2/store.go:201`).
  - `VacancyTeamCreated` `{company_id, mode, responsible_user_id, assignment_id}` (`catalog.go:240`); emitted by
    `createTeamFor` (`internal/features/jobs/infrastructure/postgres/draftstore/team.go:41-53`) at draft creation
    (actor = responsible) and at replacement start when an owner hands the replacement to someone else
    (`…/draftstore/replacement_start.go:204`).
  - `VacancyTeamMemberAdded` `{company_id, assignment_id, user_id, function, recruiter_deadline}` (`catalog.go:242`);
    team writes (`…/draftstore/team_write.go:238-260`) and member offboarding (`…/draftstore/offboard.go:332`).
  - `VacancyResponsibleReassigned` `{company_id, reassignment_id, from_user_id, to_user_id, from_assignment_id,
    to_assignment_id, reason, previous_responsible}` (`catalog.go:245`); team writes (`…/team_write.go:368`) and
    offboarding (`…/offboard.go:319`). Team events use `entity_type = vacancy`, `entity_id` = draft id
    (`…/team_write.go:375`, offboarding `…/offboard.go:376-378`).
  - `PsychometricInvitationCreated` and `PsychometricAssessmentFinished` `{vacancy_id, participation_id}`
    (`catalog.go:197`, `catalog.go:202`); `entity_type = psychometric_invitation`, `entity_id` = invitation; the actor is
    `system` for automatic stage-entry invitations (`…/draftstore/psychometric_invitations_context.go:54-68`,
    `internal/features/psychometrics/infrastructure/postgres/stage_entry.go:61`), the recruiter for manual ones
    (`…/psychometrics/infrastructure/postgres/invitations.go:174`) and the candidate on finish
    (`…/psychometrics/infrastructure/postgres/finish.go:85-89,111`).
  - `ParticipationMoved` / `ParticipationDiscarded` `{vacancy_id, from_stage_id, to_stage_id, version, hire,
    departure}` and `ParticipationRecovered` (same + `recovery_override`, `previous_stage_id`) (`catalog.go:233-235`);
    `entity_type = process_participation` (`internal/features/applications/infrastructure/postgres/board/store.go:364`,
    `…/board/discard.go:168-175`).
  - Not notified in stage 1 (see §Capture): `VacancyCandidateAddedManually` (`catalog.go:192`),
    `ParticipationSubstateChanged` (`catalog.go:236`), legacy `ApplicationSubmitted` / `ApplicationTransitioned`,
    `VacancyCandidateCarried`, the other team / psychometric types.
- **`vacancy_id` in metadata is the process id, which is the draft id** (one id for draft and process,
  `db/migrations/00019_create_vacancy_processes.sql:4`). This contract calls it `job_id`.
- **The discard's candidate message is never in audit metadata** (private free text): it lives in
  `process_participations.candidate_message` (`db/migrations/00024_pipeline_discard.sql:8`), written by the discard
  `UPDATE` (`…/board/discard.go:138`) **before** the audit append in the same tx (`…/board/discard.go:173`); recovery
  clears it (`…/board/discard.go:135`).
- **Candidate-visible status is coarse.** `CandidateStatus` exposes only `submitted | in_process | closed`
  (`internal/features/applications/application/v2/status.go:6-13`); the candidate's application history changes only
  when that status or the closing message changes (`…/application/v2/updated_at.go:50-80`).
- **Team model.** `vacancy_assignments(draft_id, company_id, user_id, …, ended_at)` with one active assignment per
  user and draft, and `vacancy_assignment_functions(function ∈ responsible|collaborator|member, ended_at)` with at most
  one open responsible per draft (`db/migrations/00054_vacancy_teams.sql:9-41`). Stakeholders are never on teams.
- **Participation identity.** `candidate_id` (a `users` row, `db/migrations/00022_create_process_participations.sql:6`)
  XOR `company_candidate_id` (manual, no account) (`db/migrations/00038_*.sql:11`).
- **Delivery dates.** `job_draft_delivery_configs.commitment_date DATE`
  (`db/migrations/00017_create_job_draft_delivery_configs.sql:11`); fulfilled = a `process_delivery_fulfillments` row
  keyed by `process_id` (`db/migrations/00027_delivery_fulfillment.sql:3-4`). Process axes: `status ∈
  published|paused|closed`, `process_status ∈ active|finished` (`db/migrations/00034_vacancy_lifecycle.sql:4-12`).
  Business time zone: `America/Mexico_City` (`internal/features/metrics/application/filters.go:21`).
- **One in-process scheduler pattern exists.** Documents `ReconcileScheduler` (ticker, `Lock.TryRun`)
  (`internal/features/documents/application/reconcile_schedule.go:10-51`), composed and started/stopped from
  `cmd/api/documents_reconcile.go:20-44`, with a session-level `pg_try_advisory_lock` on a dedicated connection and a
  fixed ASCII key (`internal/features/documents/infrastructure/postgres/reconcile_lock.go:14,62-81`). No Inngest, no
  queue.
- **Archguard forbids** an `outbox` path segment and any path containing `worker`
  (`internal/tools/archguard/archguard.go:277-282`).
- **Routes and sessions.** Candidate routes live under `/v2/me/...` behind `requireAuth + requireCandidate`
  (`cmd/api/router.go:193-218`); company-member routes under `/v2/me/company/...` behind a company gate
  (`cmd/api/router.go:220-248`). `RequireCandidateRole` checks the live `user_type = candidate`
  (`internal/features/identity/infrastructure/http/requireCandidateRole.go:16-44`, `account_required` / `wrong_role`).
  Company gates resolve the single membership per user (`…/identity/infrastructure/http/requireCompanyRole.go:135`)
  and inject `CompanyContext{company_id, user_id, role}` (`requireCompanyRole.go:181`); `RequireDocumentReader`
  already passes owner, recruiter and stakeholder (`requireCompanyRole.go:93-101`). A user is a candidate or a
  company user, never both.
- **Error catalog** (`internal/shared/httpjson/errors.go:53-110`): `invalid_request` 400, `validation_error` 400 (with
  `fields[]`, `validation_errors.go:13`), `invalid_filter` 400 (`geo_errors.go:43`), `invalid_cursor` 400
  (`pool_errors.go:6`), `unauthenticated` 401, `forbidden` 403, `company_inactive` 403, `account_required` /
  `wrong_role` 403 (`identity_errors.go:19-22`), `payload_too_large` 413.
- **Next migration number:** `00068` (last is `db/migrations/00067_company_site_hero_video_media.sql`); no
  notifications table exists. `cmd/audit-purge` is the precedent for a retention command.

## Decisions

`S#` / `L#` refer to `odd/tasks/notifications-backend.md`. Every L4 point is covered (L4.1 … L4.7).

| # | Source | Decision — reason |
| --- | --- | --- |
| D1 | S2 | **Capture = a decorator of the audit port** (`internal/features/notifications/capture`) wrapping the production audit repository in `cmd/api/main.go` (both instances); after the inner `Append` succeeds it inserts a `notification_events` row in the **same tx** when the type is notifiable, and fails the tx if that insert fails — same atomicity as S2 with zero call-site changes and without coupling the audit feature to notifications. |
| D2 | S2 | **Closed notifiable map in code** (audit type → notification types, §Capture), guarded by a test that every key exists in the audit catalog — one place to review what notifies. |
| D3 | S2 | **`notification_events` stores only ids/enums copied from the audit event**; the only extra read at capture is `candidate_message IS NOT NULL` for `ParticipationDiscarded` (same tx, row already updated) — keeps capture cheap and the message flag race-free against a later recovery. |
| D4 | S2 | **Fan-out in-process** (`internal/features/notifications/fanout`, no `outbox`/`worker` segments): every API instance claims due pending events (`next_attempt_at IS NULL OR next_attempt_at <= now()`) with `FOR UPDATE SKIP LOCKED`, ≤ 100 per tick (one event per tx), every 2 s, resolves recipients from current data, inserts `ON CONFLICT DO NOTHING`, marks processed in the same tx; a failed or panicking event is rolled back and retried with exponential backoff (30 s · 2^(n−1), cap 30 min, ~2 h over 10 attempts) — at-least-once processing, exactly-once rows via uniques, no poison event blocks the queue, no extra infrastructure. |
| D5 | S2, L4.5 | **Recipient resolver = ordered rules `(notification type → relation)`** with relations `team`, `assignee`, `candidate` in stage 1 and a reserved `role:<member_role>` relation (company-wide, in-app only) for stage 3 — the per-role stakeholder rule plugs in without touching capture or fan-out. |
| D6 | S1, S2, L4.5 | **Actor never notified; stakeholders receive nothing; candidate notifications only for organic participations (account); member recipients must be active company members at fan-out and are filtered by their current company at read time** — fixed stage-1 rules agreed in L4. |
| D7 | S2 | **`candidate_status_changed` only when the candidate-visible status (`submitted | in_process | closed`) changes** — a move between internal stages is not shown to the candidate today (`status.go:6-13`), so notifying it would leak pipeline detail and spam. |
| D8 | S2 | **A discard with a candidate message yields only `candidate_message_received`** (its payload says `status: closed`), not also `candidate_status_changed` — one domain event, one bell item. |
| D9 | S1 | **Type name `vacancy_team_added`** (frontend proposal / L1), not `team_added` (S2) — keeps the `vacancy_` prefix of its siblings. |
| D10 | S1, Q2 | **A reassignment notifies both people**: `vacancy_reassigned` to the new responsible (`to_user_id`, relation `assignee`) and `vacancy_unassigned` to the previous one (`from_user_id`, relation `previous_assignee`, only while still a company member) — user decision Q2 (2026-11-26). |
| D11 | L4.1 | **Server-side grouping**: each list item is a group; `group_key = applications:<job_id>:<YYYY-MM-DD>` for `application_received`, `psychometrics:<job_id>:<YYYY-MM-DD>` for `psychometric_completed`, `psychometrics_pending:<job_id>:<YYYY-MM-DD>` for `psychometric_pending` (Q3) (local date of the event in `America/Mexico_City`), `n:<notification_id>` for everything else — counts and cursors are exact. |
| D12 | L4.4 | **`kind` (mandatory/operational/informative) and `urgency` (normal/due_soon/overdue) are derived from `type`** by a closed table, not stored — the type fully determines both in stage 1; stage 3 can add columns. |
| D13 | L4.4, Q7 | **`attention` = unread, unresolved deadline notifications (`delivery_due_soon` / `delivery_overdue` / `assignment_deadline_due_soon` / `assignment_deadline_overdue`), returned outside the paginated list** (and excluded from it while in attention), honouring `types` / `job_ids`, capped at 20 with `attention_total` — pinned on top as designed. |
| D14 | L4.2 | **`unread_count` counts unread groups (attention included); `unread_notifications` counts rows** — both from one partial index, cheap for 30 s polling. |
| D15 | L4.3 | **`POST …/read` and `…/unread` take exactly one of `{group_keys}`, `{ids}` or (unread only) `{marked_at}`**; every mark stamps one statement timestamp returned as `marked_at`, so «Deshacer» reverts exactly that batch even if new rows arrived in the group meanwhile. |
| D16 | L4.3 | **`read-all` keeps the list filters (`types`, `job_ids`) plus `before`** (marks only rows created at or before the moment the user was looking) and returns `marked_at` for undo. |
| D17 | L4.6 | **Facets = group counts per type and per job (with current title) over `state = unread | all`**, ignoring the other filters — what the 07 popover needs. |
| D18 | L4.7 | **Two route trees, same handlers and shapes**: company members `/v2/me/company/notifications…` behind the owner/recruiter/stakeholder gate; candidates `/v2/me/notifications…` behind `requireCandidate` — follows the existing `/v2/me` vs `/v2/me/company` convention (`router.go:193-248`) and makes the scope unambiguous. |
| D19 | S2 | **Names and titles are resolved at read time**; candidate names in a member's group appear only while the recipient can still open that vacancy (owner of the company or active assignment), otherwise `name: null` — renames show current values and leaving a team stops exposing candidates. |
| D20 | S2 | **Scheduler** every 15 min (and once at start) under a session advisory lock with fixed key `0x6e6f7469665f7363` (ASCII `notif_sc`), date rule in `America/Mexico_City`, over vacancy commitment dates and per-recruiter `recruiter_deadline` (Q7); it also **resolves** stale deadline items (fulfilled, closed, renegotiated or changed, assignment ended, superseded) — the documents pattern, one instance at a time, no stale red badges. |
| D21 | S2 | **Dedupe**: immediate `UNIQUE (recipient_user_id, source_event_id, type)`; scheduled `UNIQUE (recipient_user_id, type, job_id, commitment_date)` — a retried command or re-run never notifies twice; a renegotiated date fires again. |
| D22 | S2 | **Retention 180 days** for `notifications` (read or not) and processed `notification_events`, purged by a follow-up `cmd/notifications-purge` like `cmd/audit-purge` — bounded tables and list queries. |
| D23 | — | **Reading or marking notifications is not audited** — no new sensitive data (names shown are already visible to the recipient in the vacancy), and 30 s polling would flood the audit log. |
| D24 | S2 | **Titles and bodies are composed by the frontend** from `type` + ids + resolved names + a `link` descriptor; the API stores ids/enums only (no PII in `payload`). |
| D25 | — | **No backfill**: notifications start with events committed after the deploy (the scheduler evaluates current deliveries on its first run). |
| D26 | — | **Ids or group keys that are not the caller's are silently not affected** (counted out of `affected_*`), never 404 — no enumeration of other users' rows. |
| D27 | L4.1 | **Keyset cursor over groups `(latest_at DESC, group_key DESC)`, opaque and bound to the filters** — stable under grouping because a group's `latest_at` only grows (it can only jump above the cursor, never be duplicated). |

## Data model (migration `00068_notifications`, proposal)

```sql
CREATE TABLE notification_events (
    id               uuid PRIMARY KEY,                       -- uuid v7
    audit_event_id   uuid NOT NULL UNIQUE,                   -- the audit row it was captured with (no FK: audit is purged on its own clock)
    company_id       uuid NOT NULL REFERENCES companies(id), -- every notifiable type is company-scoped
    event_type       text NOT NULL,                          -- audit type, closed in code (D2)
    actor_user_id    uuid NULL REFERENCES users(id),         -- NULL for system
    job_id           uuid NOT NULL,                          -- draft/process id
    participation_id uuid NULL,
    subject_user_id  uuid NULL REFERENCES users(id),         -- team events: responsible_user_id | user_id | to_user_id
    payload          jsonb NOT NULL DEFAULT '{}',            -- ids/enums only (from/to stage, function, has_message, invitation_id, …)
    occurred_at      timestamptz NOT NULL DEFAULT now(),     -- same clock as the audit row (same tx)
    attempts         integer NOT NULL DEFAULT 0,
    processed_at     timestamptz NULL,
    failed           boolean NOT NULL DEFAULT false,         -- true when given up after 10 attempts (processed_at set too)
    next_attempt_at  timestamptz NULL                        -- retry backoff after a failed attempt (D4); NULL = due now
);
CREATE INDEX notification_events_pending ON notification_events (occurred_at, id) INCLUDE (next_attempt_at) WHERE processed_at IS NULL;
CREATE INDEX notification_events_processed ON notification_events (processed_at) WHERE processed_at IS NOT NULL; -- purge

CREATE TABLE notifications (
    id               uuid PRIMARY KEY,                       -- uuid v7
    recipient_user_id uuid NOT NULL REFERENCES users(id),
    recipient_kind   text NOT NULL CHECK (recipient_kind IN ('member','candidate')),
    recipient_reason text NOT NULL CHECK (recipient_reason IN ('team','assignee','previous_assignee','candidate')), -- stage 3 adds 'role'
    company_id       uuid NULL REFERENCES companies(id),
    type             text NOT NULL CHECK (type IN (
                         'application_received','delivery_due_soon','delivery_overdue',
                         'assignment_deadline_due_soon','assignment_deadline_overdue',
                         'vacancy_assigned','vacancy_reassigned','vacancy_unassigned','vacancy_team_added',
                         'psychometric_completed','psychometric_pending',
                         'candidate_status_changed','candidate_message_received','candidate_test_pending')),
    group_key        text NOT NULL CHECK (char_length(group_key) BETWEEN 3 AND 120),
    job_id           uuid NOT NULL,
    participation_id uuid NULL,
    actor_user_id    uuid NULL REFERENCES users(id),
    source_event_id  uuid NULL REFERENCES notification_events(id) ON DELETE SET NULL,
    commitment_date  date NULL,
    payload          jsonb NOT NULL DEFAULT '{}',            -- ids/enums only (D24)
    created_at       timestamptz NOT NULL DEFAULT now(),
    read_at          timestamptz NULL,
    resolved_at      timestamptz NULL,                       -- deadline items no longer true (D20)
    CHECK ((recipient_kind = 'candidate') = (company_id IS NULL)),
    CHECK ((source_event_id IS NULL) = (type IN ('delivery_due_soon','delivery_overdue','assignment_deadline_due_soon','assignment_deadline_overdue'))),
    CHECK ((commitment_date IS NULL) <> (type IN ('delivery_due_soon','delivery_overdue','assignment_deadline_due_soon','assignment_deadline_overdue')))
);
-- Dedupe (D21). source_event_id is never set to NULL: the purge keeps an event while any notification references it (the CHECK forbids NULL on immediate types).
CREATE UNIQUE INDEX notifications_dedupe_immediate ON notifications (recipient_user_id, source_event_id, type)
    WHERE source_event_id IS NOT NULL;
CREATE UNIQUE INDEX notifications_dedupe_scheduled ON notifications (recipient_user_id, type, job_id, commitment_date)
    WHERE commitment_date IS NOT NULL;
-- List: groups per recipient ordered by latest activity; filters by type/job.
CREATE INDEX notifications_recipient_group ON notifications (recipient_user_id, group_key, created_at DESC);
CREATE INDEX notifications_recipient_recent ON notifications (recipient_user_id, created_at DESC, id);
-- Unread counter, unread groups and attention (D13, D14).
CREATE INDEX notifications_recipient_unread ON notifications (recipient_user_id, group_key)
    INCLUDE (type, job_id) WHERE read_at IS NULL AND resolved_at IS NULL;
-- Facets per job and read-all by job.
CREATE INDEX notifications_recipient_job ON notifications (recipient_user_id, job_id);
-- Scheduler resolution and retention.
CREATE INDEX notifications_delivery_open ON notifications (job_id, commitment_date)
    WHERE commitment_date IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX notifications_created ON notifications (created_at);
```

- Member scope: `recipient_kind = 'member' AND company_id = <CompanyContext.company_id>`. Candidate scope:
  `recipient_kind = 'candidate' AND company_id IS NULL`. Always `recipient_user_id = <session user>`.
- "Unread" everywhere means `read_at IS NULL AND resolved_at IS NULL`. A resolved item stays in the list (shown as
  read, `resolved: true`) and never in attention.
- Retention (D22): rows with `created_at < now() - 180 days` are deleted; `notification_events` with
  `processed_at < now() - 180 days` too (pending events never). `cmd/notifications-purge` deletes notifications first,
  then events, in batches; an expired event that a remaining notification still references is kept until that
  notification expires, because the `ON DELETE SET NULL` action would violate the `source_event_id` CHECK of immediate
  rows (so in practice `source_event_id` is never nulled). No FK from `notifications.job_id` / `participation_id` (soft references; reads
  tolerate missing targets).
- Down migration drops both tables (data disposable).

## Capture (D1–D3, D7, D8)

The capture decorator runs after the inner audit `Append` succeeded, in the same tx. For a notifiable audit type it
inserts one `notification_events` row; the fan-out later derives the notification types below. Ids come from:

| Audit type | `job_id` | `participation_id` | `subject_user_id` | payload | Notification types (recipients) |
| --- | --- | --- | --- | --- | --- |
| `VacancyApplicationSubmitted` | `metadata.vacancy_id` | `entity_id` | — | `{}` | `application_received` (team) |
| `VacancyTeamCreated` | `entity_id` | — | `metadata.responsible_user_id` | `{assignment_id}` | `vacancy_assigned` (assignee) |
| `VacancyResponsibleReassigned` | `entity_id` | — | `metadata.to_user_id` | `{reassignment_id, from_user_id, reason}` | `vacancy_reassigned` (assignee) + `vacancy_unassigned` (previous assignee, D10) |
| `VacancyTeamMemberAdded` | `entity_id` | — | `metadata.user_id` | `{assignment_id, function}` | `vacancy_team_added` (assignee) |
| `PsychometricAssessmentFinished` | `metadata.vacancy_id` | `metadata.participation_id` | — | `{invitation_id: entity_id}` | `psychometric_completed` (team) |
| `PsychometricInvitationCreated` | `metadata.vacancy_id` | `metadata.participation_id` | — | `{invitation_id: entity_id}` | `psychometric_pending` (team) + `candidate_test_pending` (candidate) |
| `ParticipationMoved` | `metadata.vacancy_id` | `entity_id` | — | `{from_stage_id, to_stage_id}` | `candidate_status_changed` (candidate) if the visible status changes (D7) |
| `ParticipationRecovered` | `metadata.vacancy_id` | `entity_id` | — | `{from_stage_id, to_stage_id}` | `candidate_status_changed` (candidate), always (closed → submitted/in_process) |
| `ParticipationDiscarded` | `metadata.vacancy_id` | `entity_id` | — | `{from_stage_id, to_stage_id, has_message}` | `has_message` → `candidate_message_received`, else `candidate_status_changed` (candidate) (D8) |

- `actor_user_id` = the audit `actor_id` (NULL for system). `has_message` = `SELECT candidate_message IS NOT NULL FROM
  process_participations WHERE id = entity_id` inside the tx (D3).
- Visible-status rule (D7), evaluated at fan-out with the process's initial stage (`CandidateStatus`, `status.go:6`):
  notify when `CandidateStatus(from) ≠ CandidateStatus(to)`; the payload of the notification carries the new
  `status`. Moves into/out of the initial stage (`submitted ↔ in_process`) notify; moves between later stages, hires
  and substate changes do not.
- **Do not notify in stage 1:** `VacancyCandidateAddedManually`, `VacancyCandidateCarried`,
  `ParticipationSubstateChanged`, `ParticipationChecklistMarked`, legacy `ApplicationSubmitted` /
  `ApplicationTransitioned`, `PsychometricInvitationRevoked` / `ReminderRecorded` / `LinkIssued` / `ConsentGiven` /
  `ComparisonCreated`, `VacancyTeamModeChanged`, `VacancyTeamMemberRemoved` / `Left`,
  `VacancyAssignmentDeadlineChanged`, `VacancyAssignmentEndedByMembership`, `VacancyCommitmentRenegotiated` and
  `VacancyDeliveryFulfilled` (these four only **resolve** delivery items through the scheduler, D20), every lifecycle,
  document, company, member and session type. Candidate-recipient types on a manual participation (no account)
  produce nothing; a `Moved` that keeps the visible status produces nothing. Such events are still captured (capture
  stays lookup-free, D3) and the fan-out marks them processed without rows.

## Recipients (D5, D6, D10)

The resolver runs at fan-out over current data, per notification type:

| Type | Relation | Users |
| --- | --- | --- |
| `application_received`, `psychometric_completed`, `psychometric_pending` | `team` | every user with an active `vacancy_assignments` row on `job_id` (`ended_at IS NULL`), whatever the function (responsible, collaborator, member) |
| `delivery_due_soon`, `delivery_overdue` (scheduler) | `team` | same, at scheduler run time |
| `vacancy_assigned`, `vacancy_reassigned`, `vacancy_team_added` | `assignee` | `subject_user_id`, only if their assignment on `job_id` is still active |
| `vacancy_unassigned` | `previous_assignee` | `payload.from_user_id`, while still a company member (no assignment required) |
| `assignment_deadline_due_soon`, `assignment_deadline_overdue` (scheduler) | `assignee` | the user of the active assignment that holds the `recruiter_deadline` |
| `candidate_status_changed`, `candidate_message_received`, `candidate_test_pending` | `candidate` | `process_participations.candidate_id` of `participation_id`; skipped when NULL (manual candidate, no account) |

Filters applied to every recipient: the **actor is excluded**; a `member` recipient must have a `company_members` row
in `company_id` (and the company not deleted) at fan-out; **stakeholders never** (they hold no assignments, and no
role rule exists in stage 1); owners only when they are on the team. At read time the member endpoints show only rows
of the caller's current company (D6). The resolver is an ordered list of `(type, relation)` rules; stage 3 adds
`role:stakeholder` (all company members with that role, in-app only, never by name) from company settings without
changing capture, fan-out or the API (D5). Recipients are de-duplicated per notification type.

## Grouping (D11, D27)

- `group_key` is set at fan-out, per recipient row:
  - `application_received` → `applications:<job_id>:<YYYY-MM-DD>`
  - `psychometric_completed` → `psychometrics:<job_id>:<YYYY-MM-DD>`
  - `psychometric_pending` → `psychometrics_pending:<job_id>:<YYYY-MM-DD>` (Q3)
  - every other type → `n:<notification_id>` (a group of one)
  where the date is `occurred_at` of the event converted to `America/Mexico_City`.
- A group has one type and one job by construction, so `types` / `job_ids` filters never split a group.
- Group fields: `count` (rows in the group within retention), `unread_count`, `read` (`true` iff `unread_count = 0`,
  i.e. a group is unread when **any** member is unread), `latest_at` (max `created_at`), `first_at`, `latest` (the
  newest notification: id, created_at, actor, payload) and `sample` with **at most 3 subjects** — the newest distinct
  participations of the group (`participation_id` + candidate `name`, D19); for groups of one, `sample` holds the one
  subject when the type has one (empty for assignment / delivery types).

## Kind and urgency per type (D12)

| Type | Kind | Urgency | Recipient kind |
| --- | --- | --- | --- |
| `application_received` | operational | normal | member |
| `delivery_due_soon` | operational | due_soon | member |
| `delivery_overdue` | mandatory | overdue | member |
| `assignment_deadline_due_soon` | operational | due_soon | member |
| `assignment_deadline_overdue` | mandatory | overdue | member |
| `vacancy_assigned` | mandatory | normal | member |
| `vacancy_reassigned` | mandatory | normal | member |
| `vacancy_unassigned` | mandatory | normal | member |
| `vacancy_team_added` | mandatory | normal | member |
| `psychometric_completed` | operational | normal | member |
| `psychometric_pending` | operational | normal | member |
| `candidate_status_changed` | operational | normal | candidate |
| `candidate_message_received` | operational | normal | candidate |
| `candidate_test_pending` | operational | normal | candidate |

No `informative` type in stage 1; the enum value exists for stage 2/3.

## Scheduler (D20, D21)

`internal/features/notifications/schedule`, composed like `cmd/api/documents_reconcile.go`: runs once at start, then
every **15 min**, each run under `pg_try_advisory_lock(0x6e6f7469665f7363)` on a dedicated connection (another instance
holding it → skip the run). With `today` = current date in `America/Mexico_City`, for every process with
`process_status = 'active' AND status IN ('published','paused')` (Q1), a `job_draft_delivery_configs.commitment_date`,
and **no** `process_delivery_fulfillments` row:

- `commitment_date ∈ {today, today + 1}` → `delivery_due_soon` (T-24h approximated by the local date; a date set for
  today still warns once).
- `commitment_date < today` (the commitment day has ended) → `delivery_overdue`.

Recipients = the team at run time (D5); `actor_user_id` NULL; `group_key = n:<id>`; `commitment_date` = the date
evaluated; insert `ON CONFLICT DO NOTHING` on `notifications_dedupe_scheduled`, so each (recipient, type, job, date)
fires at most once; a renegotiated date fires again; a member added to the team later does not get past items (Q5).

**Resolution** (same run): set `resolved_at = now()` on unresolved delivery items when the process now has a
fulfillment row (`VacancyDeliveryFulfilled`), is `closed` (any `process` value) or `finished`, its current
`commitment_date` differs from the item's (renegotiated), or — for `delivery_due_soon` — an overdue item exists for
the same recipient, job and date. Resolved items leave attention and the unread counts.

**Per-recruiter deadlines** (Q7, same run, same process filter): for every active `vacancy_assignments` row
(`ended_at IS NULL`) with a `recruiter_deadline`, the same date rule yields `assignment_deadline_due_soon` /
`assignment_deadline_overdue` for that assignment's user only, with `commitment_date = recruiter_deadline` and payload
`{assignment_id, function, commitment_date}` (same dedupe index, so a changed deadline fires again). They resolve when
the assignment ends, its `recruiter_deadline` changes or is cleared (`VacancyAssignmentDeadlineChanged`), the process
has a fulfillment row, is `closed` or `finished`, or — for due-soon — an overdue item exists for the same recipient,
job and date.

Fan-out (D4) is a separate loop in every instance (no advisory lock): claim `≤ 100` due pending events (`next_attempt_at
IS NULL OR next_attempt_at <= now()`) `ORDER BY occurred_at, id FOR UPDATE SKIP LOCKED`, one event per tx: resolve +
insert + `processed_at = now()`; on error or panic roll back, increment `attempts` (separate tx) and set
`next_attempt_at = now() + min(30 s · 2^(attempts−1), 30 min)` (an event is tried at most once per tick and never
blocks later ones); after 10 attempts set `failed = true, processed_at = now()`, `next_attempt_at = NULL`. Logs carry
the event type, id, failing step and SQLSTATE only (no payload, no error message). Candidate rows store
`actor_user_id = NULL`.

## Endpoints

Two route trees, identical handlers, query params and shapes (D18). `B` below is the base:

- **Company members:** `B = /v2/me/company/notifications`, middleware `NoStore, requireAuth,
  RequireDocumentReader` (owner, recruiter, stakeholder; stakeholders get empty results in stage 1). Scope: session
  user + `CompanyContext.company_id`.
- **Candidates:** `B = /v2/me/notifications`, middleware `NoStore, requireAuth, requireCandidate`. Scope: session
  user, `recipient_kind = 'candidate'`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `B` | grouped list + attention |
| GET | `B/unread-count` | bell counter (polled ~30 s and on focus) |
| POST | `B/read` | mark groups or notifications read |
| POST | `B/unread` | mark unread (undo) |
| POST | `B/read-all` | mark everything matching filters read |
| GET | `B/facets` | counts for the filter popover |

All responses are `Cache-Control: no-store`. All ids are UUID strings; all timestamps RFC 3339 UTC.

### Common filters

| Param | Values | Default | Notes |
| --- | --- | --- | --- |
| `state` | `all` \| `unread` | `all` | `unread` = groups with at least one unread member |
| `types` | comma list of the 14 types | all | ≤ 14 values; unknown → `invalid_filter`; a member asking for a candidate type (or vice versa) gets an empty result, not an error |
| `job_ids` | comma list of UUIDs | all | ≤ 20 values; malformed → `invalid_filter` |

### `GET B`

Query: common filters + `cursor` (opaque) + `limit` (1–50, default 20).

The list contains groups ordered by `latest_at DESC, group_key DESC`, **excluding** the notifications currently in
attention (D13). `attention` is returned only on the first page (no `cursor`; with a `cursor` both `attention` and
`attention_total` are `null`); it holds unread, unresolved deadline items (`delivery_due_soon` / `delivery_overdue` /
`assignment_deadline_due_soon` / `assignment_deadline_overdue`) honouring `types` and `job_ids` (not `state`), newest
first (`created_at DESC, id DESC`), ≤ 20, with `attention_total` = all qualifying items.

**Attention overflow**: only the ≤ 20 items in `attention` are excluded from `items`. Qualifying items beyond the
first 20 appear in `items` in their normal order. Every page recomputes the same top 20 with the same filters, so
an item is never in both places and never hidden (an item arriving between pages can shift the boundary by one,
like any new notification).

```json
{
  "attention": [
    {
      "group_key": "n:01937b2e-6b1a-7c2e-9f10-0a1b2c3d4e5f",
      "type": "delivery_overdue",
      "kind": "mandatory",
      "urgency": "overdue",
      "count": 1,
      "unread_count": 1,
      "read": false,
      "resolved": false,
      "latest_at": "2026-11-26T12:00:03Z",
      "first_at": "2026-11-26T12:00:03Z",
      "job": { "id": "6f1c…", "title": "Analista de nómina" },
      "latest": {
        "id": "01937b2e-6b1a-7c2e-9f10-0a1b2c3d4e5f",
        "created_at": "2026-11-26T12:00:03Z",
        "actor": null,
        "payload": { "commitment_date": "2026-11-25" }
      },
      "sample": [],
      "link": { "kind": "vacancy_delivery", "job_id": "6f1c…" }
    }
  ],
  "attention_total": 1,
  "items": [
    {
      "group_key": "applications:6f1c…:2026-11-26",
      "type": "application_received",
      "kind": "operational",
      "urgency": "normal",
      "count": 5,
      "unread_count": 3,
      "read": false,
      "resolved": false,
      "latest_at": "2026-11-26T18:41:10Z",
      "first_at": "2026-11-26T15:02:44Z",
      "job": { "id": "6f1c…", "title": "Analista de nómina" },
      "latest": {
        "id": "01937c90-…",
        "created_at": "2026-11-26T18:41:10Z",
        "actor": null,
        "payload": {}
      },
      "sample": [
        { "participation_id": "a1…", "name": "Ana López" },
        { "participation_id": "b2…", "name": "Luis Pérez" },
        { "participation_id": "c3…", "name": null }
      ],
      "link": { "kind": "vacancy_candidates", "job_id": "6f1c…" }
    },
    {
      "group_key": "n:01937a11-…",
      "type": "vacancy_reassigned",
      "kind": "mandatory",
      "urgency": "normal",
      "count": 1,
      "unread_count": 0,
      "read": true,
      "resolved": false,
      "latest_at": "2026-11-26T10:15:00Z",
      "first_at": "2026-11-26T10:15:00Z",
      "job": { "id": "9d2e…", "title": "Ejecutivo de ventas" },
      "latest": {
        "id": "01937a11-…",
        "created_at": "2026-11-26T10:15:00Z",
        "actor": { "user_id": "u7…", "name": "Valeria Ruiz" },
        "payload": { "from_user_id": "u3…", "reason": "workload" }
      },
      "sample": [],
      "link": { "kind": "vacancy", "job_id": "9d2e…" }
    }
  ],
  "next_cursor": "eyJ2IjoxLCJhdCI6IjIwMjYtMTEtMjZUMTA6MTU6MDBaIiwiZ2siOiJuOjAxOTM3YTExLeKApiIsImYiOiI3YzJh4oCmIn0",
  "unread_count": 4,
  "unread_notifications": 6
}
```

- `job.title`: members — the current draft title (same source as the draft list, `…/draftstore/list_v2.go:173`);
  candidates — the title they see in `/v2/me/applications` (public projection). `null` when the job no longer exists.
  Candidates also get `company: {id, name}` on each item.
- `sample[].name` and `latest.actor.name` are resolved at read time; candidate names are `null` when the member can no
  longer open the vacancy (D19). Candidate-side items never include actor names (`actor: null`).
- `payload` per type (ids/enums only): `vacancy_reassigned {from_user_id, reason}`; `vacancy_unassigned
  {to_user_id, reason}`; `reason` ∈ `workload | recruiter_departure | performance | client_request | other` (the
  reassignment enum, `00054_vacancy_teams.sql`; the free-text `note` of `other` is never included). For these two types
  the item also carries `from_user` / `to_user` `{user_id, name}` resolved at read time like `actor` (D19; `name` is
  the current company member name, `null` if the user no longer exists); assignment deadline `{assignment_id, function, commitment_date}`; `vacancy_team_added {function}`;
  `vacancy_assigned {}`; delivery `{commitment_date}`; psychometric `{invitation_id}` (+ `participation_id` in
  `sample`); `candidate_status_changed {status}`; `candidate_message_received {status: "closed"}` (the text is read
  from `/v2/me/applications`); `candidate_test_pending {invitation_id}`.
- `link.kind` per type: `application_received` / `psychometric_completed` group → `vacancy_candidates {job_id}`
  (single-member group → `participation {job_id, participation_id}`); `psychometric_pending` group → same as the other grouped types (`vacancy_candidates`, single-member group → `participation`, Q3);
  assignment types → `vacancy {job_id}` (`vacancy_unassigned`: `link: null` when the recipient can no longer open the
  vacancy, D19); delivery and assignment deadline → `vacancy_delivery {job_id}`; `candidate_status_changed` /
  `candidate_message_received` → `application {job_id, participation_id}` (`participation_id` is the same id as `item.id`
  of `/v2/me/applications` and of `PUT /v2/me/applications/{id}/message-read`); `candidate_test_pending` → `assessment
  {invitation_id}`. The frontend maps kinds to paths.
- `unread_count` / `unread_notifications`: the caller's whole scope, not filtered (saves a poll).
- **Cursor** (D27): base64url of `{v, at: latest_at, gk: group_key, f: hash(state, types, job_ids)}`; the next page
  takes groups strictly after `(at, gk)` in the order. A cursor used with different filters, or undecodable →
  `400 invalid_cursor`. A group that receives a new row while paging moves above the cursor (seen on refresh, never
  twice); marking read with `state=unread` drops groups without shifting later pages. `next_cursor: null` on the
  last page.

### `GET B/unread-count`

```json
{ "unread_count": 4, "unread_notifications": 6 }
```

Unread groups (attention included) and unread rows, from `notifications_recipient_unread`. No params.

### `POST B/read` and `POST B/unread`

Body: exactly one of

```json
{ "group_keys": ["applications:6f1c…:2026-11-26", "n:01937a11-…"] }
{ "ids": ["01937c90-…", "01937a11-…"] }
{ "marked_at": "2026-11-26T18:45:02.123456Z" }
```

`group_keys` ≤ 100, `ids` ≤ 200; `marked_at` is accepted by `unread` only and reverts exactly the rows the earlier
mark stamped with that `read_at` (D15). `read` touches only unread rows; `unread` only read ones; both are idempotent.
Rows that are not the caller's are ignored (D26). Response `200`:

```json
{
  "affected_notifications": 3,
  "affected_groups": 1,
  "marked_at": "2026-11-26T18:45:02.123456Z",
  "unread_count": 3,
  "unread_notifications": 3
}
```

(`marked_at` is the statement timestamp written to `read_at` by `read`, or the timestamp of the `unread` operation.)
«Deshacer» after a group read = `POST B/unread {"marked_at": <returned value>}`.

### `POST B/read-all`

Body (all optional): `{ "types": [...], "job_ids": [...], "before": "2026-11-26T18:44:00Z" }`. Marks every unread row
in scope matching the filters and created at or before `before` (default: now), attention items included. Response as
`read` above; «Deshacer» = `POST B/unread {"marked_at"}`.

### `GET B/facets`

Query: `state` (`all` | `unread`, default `unread`). Counts **groups** (attention included) in that state, ignoring
`types` / `job_ids`. `jobs` ordered by `count DESC, title`, ≤ 50, `jobs_total` = distinct jobs.

```json
{
  "state": "unread",
  "types": [
    { "type": "application_received", "count": 2 },
    { "type": "delivery_overdue", "count": 1 },
    { "type": "vacancy_reassigned", "count": 1 }
  ],
  "jobs": [
    { "job_id": "6f1c…", "title": "Analista de nómina", "count": 3 },
    { "job_id": "9d2e…", "title": "Ejecutivo de ventas", "count": 1 }
  ],
  "jobs_total": 2
}
```

Types with zero count are omitted.

### Limits

`limit` ≤ 50 groups; `attention` ≤ 20; `sample` ≤ 3; `types` ≤ 14, `job_ids` ≤ 20; `group_keys` ≤ 100, `ids` ≤ 200 per
request; JSON body through the shared decoder size cap. Polling `unread-count` every 30 s is the expected load; no
rate limit added in stage 1.

## Error codes

Reused from the existing catalog only; no new code.

| Status | Code | When |
| --- | --- | --- |
| 400 | `invalid_request` | malformed JSON, unknown body field |
| 400 | `validation_error` | body with zero or more than one of `group_keys` / `ids` / `marked_at`; empty array; over the limit; malformed UUID or group key; `marked_at` on `read`; malformed `before` (`fields[]` names the field) |
| 400 | `invalid_filter` | unknown `state` / `types` value, malformed `job_ids`, too many values, `limit` out of range |
| 400 | `invalid_cursor` | undecodable cursor or cursor from other filters |
| 401 | `unauthenticated` | missing / invalid session |
| 403 | `forbidden` | member routes: not a member of any company (existing gate) |
| 403 | `company_inactive` | member routes: company deleted (existing gate) |
| 403 | `account_required` / `wrong_role` | candidate routes: no candidate account / company user (existing gate) |
| 413 | `payload_too_large` | body over the decoder cap |

Ids or group keys of other users never produce 404 (D26).

## Audit

Reading, counting, marking read/unread and read-all are **not audited** (D23): they reveal nothing the recipient
cannot already see, and polling would flood the log. Capture itself adds no audit rows; the source audit event is the
trace (`notification_events.audit_event_id`).

## Deployment order

1. **Backend first.** Migration 00068 is additive; capture starts writing `notification_events` at deploy; fan-out and
   scheduler start with the API process. No backfill (D25): the first scheduler run creates due-soon / overdue items
   for current deliveries (Q8).
2. **All endpoints are new** (`/v2/me/company/notifications…`, `/v2/me/notifications…`); nothing existing changes
   shape, so the frontend deploys after the backend slices N4–N6 are live.
3. The purge command (N7) can ship any time before 180 days of data exist; run it daily from the deploy scheduler,
   dry run first (`go run ./cmd/notifications-purge`, `-execute` deletes).

## Slices (~400 lines each, tests included)

| Slice | Content |
| --- | --- |
| N1 | Migration 00068; notifications domain (type table: kind, urgency, recipient kind, group rule, relation); capture decorator + notifiable map (D1–D3) wired at `cmd/api/main.go:237,573`; catalog-closure test; same-tx rollback tests. |
| N2 | Fan-out loop (SKIP LOCKED, attempts/failed), recipient resolver (team, assignee, candidate; actor/membership/stakeholder filters; role-rule seam), visible-status rule, group keys in MX date; start/stop in `main.go`. |
| N3 | Scheduler (lock key, due-soon/overdue rule for commitment dates and recruiter deadlines, dedupe, resolution); start/stop in `main.go`. |
| N4 | Member read API: `GET B` (groups, attention, cursor, name/title resolution with access check) + `GET B/unread-count`; routes. |
| N5 | Member writes and facets: `read`, `unread` (`group_keys` / `ids` / `marked_at`), `read-all`, `facets`. |
| N6 | Candidate route tree reusing N4/N5 handlers with the candidate scope; candidate titles/company from the application read model. |
| N7 | `cmd/notifications-purge` (180 days, both tables), like `cmd/audit-purge`. |

## Resolved questions (user decisions, 2026-11-26)

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Due-soon / overdue for paused processes and closed processes that continue? | Paused **yes**; any closed **no** (resolves). As recommended. |
| Q2 | Notify the previous responsible on reassignment? | **Yes, in stage 1** — new type `vacancy_unassigned` (D10). |
| Q3 | Group `psychometric_pending`? | **Yes**, `psychometrics_pending:<job_id>:<YYYY-MM-DD>` (D11). |
| Q4 | Marking `candidate_message_received` read also marks the message read? | **No**, independent; the frontend may call both. |
| Q5 | Members added to a team later receive past delivery items? | **No**; they see the delivery state on the vacancy. |
| Q6 | Page 20 (max 50), attention cap 20, sample 3, facet jobs ≤ 50? | **Yes**, as drafted. |
| Q7 | Per-recruiter `recruiter_deadline` due-soon / overdue? | **Yes, in stage 1** — `assignment_deadline_due_soon` / `_overdue` to the assignee only (§Scheduler). |
| Q8 | First scheduler run creates overdue items for every past-due delivery? | **Accept** (non-production data). |

## Out of scope (v1)

- Email delivery, digests and personal preferences (stage 2; kinds already returned so mandatory ones can be locked).
- Owner rules per event and role, stakeholder role events (stage 3; resolver seam D5).
- Real-time push (polling only), more event types, notifications for manual candidates (no account).
- Free-text content in notifications (the discard message stays in the application read model).
