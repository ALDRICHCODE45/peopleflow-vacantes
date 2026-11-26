# Notifications stage 1 (backend)

Backend half of the notifications system (in-app, stage 1), user-approved and relayed by the frontend session
2026-11-26. Branch `feat/notifications-backend` (worktree `../peopleflow-vacantes-notif`). Frontend proposal (source of
the requested shape): `peopleflow-vacantes-frontend/odd/tasks/notifications-system-contract.md`; decisions
`.../odd/tasks/notifications-system.md` L1–L7. Contract to write: `docs/contracts/notifications-v1.md`.

## Specs

- **S1** Requested (L1, verbatim): «events emitted in the same transaction as the domain change (outbox) → per-recipient
  fan-out with group_key/urgency/link; fixed recipients in stage 1 (vacancy team + responsible; the affected person for
  assignments; the candidate for their events; stakeholders nothing by default and never on teams); types
  application_received, delivery_due_soon (T-24h), delivery_overdue (mandatory), vacancy_assigned/reassigned/team_added
  (mandatory), psychometric_completed/pending, candidate_status_changed, candidate_message_received,
  candidate_test_pending; API GET /v2/me/notifications (grouped, attention pinned, filters by types/job_ids, cursor),
  unread-count (polling ~30 s), read / read-all / unread (undo), facets.»
- **S2** Backend design (counter-proposal, L3):
  - **Capture in the same transaction, one place:** the audit append already runs inside every domain transaction
    for all immediate types. The audit repository's append also inserts a `notification_events` row (same tx) when
    the event type is in the notifiable set — no per-call-site changes. Mapping: VacancyApplicationSubmitted →
    application_received; VacancyTeamCreated → vacancy_assigned (responsible); VacancyResponsibleReassigned →
    vacancy_reassigned; VacancyTeamMemberAdded → team_added; PsychometricAssessmentFinished → psychometric_completed;
    PsychometricInvitationCreated → psychometric_pending (team) + candidate_test_pending (candidate);
    ParticipationMoved / ParticipationDiscarded / ParticipationRecovered → candidate_status_changed (candidate);
    ParticipationDiscarded with a candidate message → candidate_message_received (candidate). Manual candidate adds,
    substate changes and legacy job events do not notify in stage 1.
  - **Fan-out:** an in-process dispatcher (package `notifications/fanout`; the archguard forbids `outbox`/`worker`
    path segments) claims `notification_events` with `FOR UPDATE SKIP LOCKED` in small batches every few seconds,
    resolves recipients from current data (active vacancy_assignments; responsible from vacancy_assignment_functions;
    candidate = participation.candidate_id, manual candidates have no account → skipped; stakeholders never), inserts
    `notifications` rows `ON CONFLICT DO NOTHING`, and marks the event processed. The actor never notifies themselves.
  - **Scheduler:** delivery_due_soon (commitment date tomorrow in America/Mexico_City) and delivery_overdue (date
    passed) for published processes without a `process_delivery_fulfillments` row, every 15 min under a dedicated
    session advisory lock (same pattern as the documents ReconcileScheduler).
  - **Dedupe:** immediate `UNIQUE (recipient_user_id, source_event_id, type)`; scheduled `UNIQUE (recipient_user_id,
    type, draft_id, commitment_date)` (a renegotiated date fires again, the same date never twice).
  - **Data:** migration 00068: `notification_events` (id, company_id, audit_event_id, event_type, payload ids,
    created_at, processed_at) and `notifications` (id, recipient_user_id, company_id null for candidates, type,
    urgency normal|attention, group_key, job_id, participation_id, actor_user_id, link, payload jsonb with ids/enums
    only, created_at, read_at). Retention: 180 days (follow-up purge command like audit-purge).
  - **API (stage 1):** `GET /v2/me/notifications` (cursor, filters `types`, `job_ids`, `unread`; attention-pinned
    section first), `GET /v2/me/notifications/unread-count`, `POST /v2/me/notifications/{id}/read`,
    `POST /v2/me/notifications/{id}/unread`, `POST /v2/me/notifications/read-all` (optional same filters),
    `GET /v2/me/notifications/facets`. Recipient-scoped only: a user never reads another user's rows; company
    members see notifications only while still members of that company.
  - Titles/body text are composed by the frontend from type + ids + names returned by the API (names resolved at read
    time, so renames and corrections show current values).

## Tasks

- T1 — contract `docs/contracts/notifications-v1.md` agreed with the frontend — pending
- T2+ — implementation slices from the contract — pending

## Log

- **L1** 2026-11-26, frontend session: request quoted in S1; questions «(1) can you take it after the current one?
  (2) where are those events emitted today, and does an outbox + worker fit; (3) a scheduler for due-soon/overdue (is
  there a runner or Inngest?); (4) dedupe/idempotency.»
- **L2** 2026-11-26, exploration: every immediate type already appends an audit event inside the domain transaction
  (`audit_events/.../catalog.go`; Apply `applications/infrastructure/postgres/v2/store.go:44`, team `draftstore/
  team_write.go:104`, board Move/Discard `board/store.go:301`, `board/discard.go`, psychometrics `finish.go`,
  `invitations.go`, `stage_entry.go`); audit table is append-only (no processed flag possible). No Inngest/queue; one
  in-process scheduler (documents ReconcileScheduler + session advisory lock). Delivery dates:
  `job_draft_delivery_configs.commitment_date` (DATE), fulfilled = `process_delivery_fulfillments` row; API timezone
  America/Mexico_City. Manual candidates have no user. Next migration 00068; no notifications table exists.
  candidate_message_received exists only as the discard message.
- **L3** 2026-11-26, backend counter-proposal (S2) sent to the frontend.
- **L4** 2026-11-26, frontend agreed with S2 plus (verbatim): «1. Server-side grouping: each item in GET
  /v2/me/notifications is a GROUP (`group_key`, `count`, `latest_at`, `sample` with up to 3 subjects (e.g. candidate
  ids/names) and the ids of its notifications or a group token). That way cursor pagination and counts are right.
  Initial keys: application_received → `applications:<job_id>:<local date MX>`; psychometric_completed →
  `psychometrics:<job_id>:<local date>`; the rest without grouping (group = 1 notification). 2. `unread_count` counts
  unread GROUPS (that's what the bell shows, «9+»); also return `unread_notifications` if it's cheap. 3. Group
  read/unread: `POST …/read` and `…/unread` with `{group_keys:[...]}` or `{ids:[...]}` (the «Deshacer» undoes exactly
  what was marked). Keep `read-all` with filters. 4. Each item with `urgency` (normal|due_soon|overdue) and `kind`
  (mandatory|operational|informative); the `attention` section = unread due_soon/overdue, outside the paginated list.
  5. Stakeholders: OK, they receive nothing in stage 1. In stage 3 the owner will be able to enable events for the
  Stakeholder role (all vacancies, in-app only, never by name): leave the recipient resolver ready for a per-role
  rule. 6. facets: counts per type and per job (with title) over the current state (unread/all), for the 07 filter.
  7. Candidate side: same endpoints under the candidate's session (its own scope), only for candidates with an
  account, as you said.» These override S2 where they differ (urgency enum replaces normal|attention).
