-- +goose Up
-- Notifications stage 1 (docs/contracts/notifications-v1.md §Data model). notification_events is the capture row
-- written by the audit-port decorator in the same transaction as the audit event (D1–D3: ids/enums only);
-- notifications holds one row per recipient, written by the fan-out (immediate types, deduped per source event) or
-- the scheduler (deadline types, deduped per commitment date) (D21). kind/urgency derive from type in code (D12).
-- job_id and participation_id are soft references (reads tolerate missing targets); retention is 180 days (D22).
CREATE TABLE notification_events (
    id               uuid PRIMARY KEY,
    audit_event_id   uuid NOT NULL UNIQUE,                   -- no FK: audit is purged on its own clock
    company_id       uuid NOT NULL REFERENCES companies(id),
    event_type       text NOT NULL,                          -- audit type, closed in code (D2)
    actor_user_id    uuid NULL REFERENCES users(id),         -- NULL for system
    job_id           uuid NOT NULL,                          -- draft/process id
    participation_id uuid NULL,
    subject_user_id  uuid NULL REFERENCES users(id),         -- team events: responsible_user_id | user_id | to_user_id
    payload          jsonb NOT NULL DEFAULT '{}',            -- ids/enums only
    occurred_at      timestamptz NOT NULL DEFAULT now(),     -- same clock as the audit row (same tx)
    attempts         integer NOT NULL DEFAULT 0,
    processed_at     timestamptz NULL,
    failed           boolean NOT NULL DEFAULT false          -- given up after 10 attempts (processed_at set too)
);
CREATE INDEX notification_events_pending ON notification_events (occurred_at, id) WHERE processed_at IS NULL;
CREATE INDEX notification_events_processed ON notification_events (processed_at) WHERE processed_at IS NOT NULL;

CREATE TABLE notifications (
    id                uuid PRIMARY KEY,
    recipient_user_id uuid NOT NULL REFERENCES users(id),
    recipient_kind    text NOT NULL CHECK (recipient_kind IN ('member','candidate')),
    recipient_reason  text NOT NULL CHECK (recipient_reason IN ('team','assignee','previous_assignee','candidate')),
    company_id        uuid NULL REFERENCES companies(id),
    type              text NOT NULL CHECK (type IN (
                          'application_received','delivery_due_soon','delivery_overdue',
                          'assignment_deadline_due_soon','assignment_deadline_overdue',
                          'vacancy_assigned','vacancy_reassigned','vacancy_unassigned','vacancy_team_added',
                          'psychometric_completed','psychometric_pending',
                          'candidate_status_changed','candidate_message_received','candidate_test_pending')),
    group_key         text NOT NULL CHECK (char_length(group_key) BETWEEN 3 AND 120),
    job_id            uuid NOT NULL,
    participation_id  uuid NULL,
    actor_user_id     uuid NULL REFERENCES users(id),
    source_event_id   uuid NULL REFERENCES notification_events(id) ON DELETE SET NULL,
    commitment_date   date NULL,
    payload           jsonb NOT NULL DEFAULT '{}',           -- ids/enums only (D24)
    created_at        timestamptz NOT NULL DEFAULT now(),
    read_at           timestamptz NULL,
    resolved_at       timestamptz NULL,                      -- deadline items no longer true (D20)
    CHECK ((recipient_kind = 'candidate') = (company_id IS NULL)),
    CHECK ((source_event_id IS NULL) = (type IN ('delivery_due_soon','delivery_overdue','assignment_deadline_due_soon','assignment_deadline_overdue'))),
    CHECK ((commitment_date IS NULL) <> (type IN ('delivery_due_soon','delivery_overdue','assignment_deadline_due_soon','assignment_deadline_overdue')))
);
-- Dedupe (D21). source_event_id becomes NULL only after the event is purged, after the notification's own retention.
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

-- +goose Down
-- Data is disposable (contract §Data model): drop both tables, dependents first.
DROP TABLE notifications;
DROP TABLE notification_events;
