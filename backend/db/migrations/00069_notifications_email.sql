-- +goose Up
-- Notifications stage 2 (docs/contracts/notifications-v2.md §Data model): personal preferences as sparse override
-- rows (D1, D2, D4; defaults live in code, mandatory types can never be stored), the global email suppression list
-- (D18), one row per email to send (D8, D10, D12; no address column, D19), and on notifications the creation-time
-- in-app snapshot (D6: false = hidden from every inbox read) plus the link to its email delivery. The unread index is
-- rebuilt to cover visible rows only. Existing rows stay visible (in_app default true); no backfill.
CREATE TABLE notification_preferences (
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id  uuid NULL REFERENCES companies(id) ON DELETE CASCADE,       -- NULL = candidate (D1)
    type        text NOT NULL CHECK (type IN (                              -- mandatory types can never be stored (D2)
                    'application_received','delivery_due_soon','assignment_deadline_due_soon',
                    'psychometric_completed','psychometric_pending',
                    'candidate_status_changed','candidate_message_received','candidate_test_pending')),
    channel     text NOT NULL CHECK (channel IN ('in_app','email')),
    enabled     boolean NOT NULL,
    source      text NOT NULL CHECK (source IN ('settings','unsubscribe')), -- support trace instead of audit (D5)
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_preferences_key UNIQUE NULLS NOT DISTINCT (user_id, company_id, type, channel),
    CHECK ((company_id IS NULL) = (type IN ('candidate_status_changed','candidate_message_received','candidate_test_pending')))
);

-- Suppression list (D18): global, normalized address; ingestion arrives with SES.
CREATE TABLE email_suppressions (
    address     text PRIMARY KEY CHECK (address = lower(btrim(address)) AND address <> '' AND char_length(address) <= 320),
    reason      text NOT NULL CHECK (reason IN ('bounce','complaint','manual')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per email to send (D8, D10, D12). No address column (D19). Rows go with their user or company (CASCADE, like
-- notification_preferences) so a hard delete is never blocked by pending or historical mail.
CREATE TABLE notification_email_deliveries (
    id                  uuid PRIMARY KEY,                                   -- uuid v7; also the Message-ID local part
    recipient_user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_kind      text NOT NULL CHECK (recipient_kind IN ('member','candidate')),
    company_id          uuid NULL REFERENCES companies(id) ON DELETE CASCADE, -- same rule as notifications
    type                text NOT NULL CHECK (type IN (                      -- same 14 values as notifications.type (00068)
                            'application_received','delivery_due_soon','delivery_overdue',
                            'assignment_deadline_due_soon','assignment_deadline_overdue',
                            'vacancy_assigned','vacancy_reassigned','vacancy_unassigned','vacancy_team_added',
                            'psychometric_completed','psychometric_pending',
                            'candidate_status_changed','candidate_message_received','candidate_test_pending')),
    group_key           text NOT NULL CHECK (char_length(group_key) BETWEEN 3 AND 120),
    job_id              uuid NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sending','retry','sent','skipped','failed')),
    skip_reason         text NULL CHECK (skip_reason IN
                        ('recipient_gone','no_address','suppressed','preference_off','resolved','read')),
    send_after          timestamptz NOT NULL,                               -- window close (grouped) or creation (single)
    attempts            integer NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz NULL,                                   -- status 'retry'
    lease_until         timestamptz NULL,                                   -- status 'sending'
    error_class         text NULL CHECK (error_class IN ('transient','permanent')),  -- never a provider message
    provider_message_id text NULL,
    sent_at             timestamptz NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK ((recipient_kind = 'candidate') = (company_id IS NULL)),
    CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
    CHECK ((status = 'sent') = (sent_at IS NOT NULL)),
    -- §Sender: a retry waits for next_attempt_at, a claimed row holds a lease; the claim clears next_attempt_at and
    -- every finalize clears lease_until.
    CHECK ((status = 'retry') = (next_attempt_at IS NOT NULL)),
    CHECK ((status = 'sending') = (lease_until IS NOT NULL))
);
-- At most one open window per recipient and group (D10); 'retry'/'sending' rows are outside it on purpose.
CREATE UNIQUE INDEX notification_email_deliveries_open ON notification_email_deliveries (recipient_user_id, group_key)
    WHERE status = 'pending';
-- Sender claim (D12).
CREATE INDEX notification_email_deliveries_due ON notification_email_deliveries (send_after, id)
    WHERE status IN ('pending','retry','sending');
-- Retention (D20).
CREATE INDEX notification_email_deliveries_created ON notification_email_deliveries (created_at);

ALTER TABLE notifications
    ADD COLUMN in_app boolean NOT NULL DEFAULT true,                        -- D6: false = hidden from every inbox read
    ADD COLUMN email_delivery_id uuid NULL REFERENCES notification_email_deliveries(id) ON DELETE SET NULL;
CREATE INDEX notifications_email_delivery ON notifications (email_delivery_id) WHERE email_delivery_id IS NOT NULL;
-- The unread counter / attention index only covers visible rows (D6).
DROP INDEX notifications_recipient_unread;
CREATE INDEX notifications_recipient_unread ON notifications (recipient_user_id, group_key)
    INCLUDE (type, job_id) WHERE read_at IS NULL AND resolved_at IS NULL AND in_app;

-- +goose Down
-- Data is disposable (contract §Data model): restore the stage-1 unread index, drop the two columns (their index goes
-- with them), then the three tables.
DROP INDEX notifications_recipient_unread;
CREATE INDEX notifications_recipient_unread ON notifications (recipient_user_id, group_key)
    INCLUDE (type, job_id) WHERE read_at IS NULL AND resolved_at IS NULL;
ALTER TABLE notifications
    DROP COLUMN email_delivery_id,
    DROP COLUMN in_app;
DROP TABLE notification_email_deliveries;
DROP TABLE email_suppressions;
DROP TABLE notification_preferences;
