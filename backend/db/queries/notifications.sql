-- name: InsertNotificationEvent :exec
-- Capture row written by the audit-port decorator inside the caller's tx,
-- right after the audit event (notifications-v1 D1–D3). occurred_at is the DB
-- DEFAULT now(), the same transaction clock as the audit row. payload holds
-- ids/enums only.
INSERT INTO notification_events (id, audit_event_id, company_id, event_type, actor_user_id, job_id, participation_id, subject_user_id, payload)
VALUES (
    sqlc.arg('id')::uuid,
    sqlc.arg('audit_event_id')::uuid,
    sqlc.arg('company_id')::uuid,
    sqlc.arg('event_type')::text,
    sqlc.narg('actor_user_id')::uuid,
    sqlc.arg('job_id')::uuid,
    sqlc.narg('participation_id')::uuid,
    sqlc.narg('subject_user_id')::uuid,
    sqlc.arg('payload')::jsonb
);

-- name: ParticipationHasCandidateMessage :one
-- D3: the discard's candidate message is never copied; capture records only
-- whether it exists, read in the same tx after the discard UPDATE.
SELECT (candidate_message IS NOT NULL)::boolean AS has_message
FROM process_participations
WHERE id = sqlc.arg('id')::uuid;

-- name: ClaimNextNotificationEvent :one
-- Fan-out claim (notifications-v1 D4): the oldest pending, due event not
-- already tried in this tick, locked for the caller's tx; other instances
-- skip it. An event in retry backoff waits for next_attempt_at.
SELECT id, company_id, event_type, actor_user_id, job_id, participation_id, subject_user_id, payload, occurred_at
FROM notification_events
WHERE processed_at IS NULL
  AND (next_attempt_at IS NULL OR next_attempt_at <= now())
  AND NOT (id = ANY (sqlc.arg('skip')::uuid[]))
ORDER BY occurred_at, id
LIMIT 1
FOR UPDATE SKIP LOCKED;

-- name: MarkNotificationEventProcessed :exec
UPDATE notification_events SET processed_at = now()
WHERE id = sqlc.arg('id')::uuid AND processed_at IS NULL;

-- name: RecordNotificationEventFailure :one
-- One failed attempt, in its own tx after the processing tx rolled back; at
-- max_attempts the event is given up (failed, processed). Otherwise the next
-- attempt waits retry_base_ms·2^(attempts-1) after this n-th failure, capped
-- at retry_cap_ms (computed from the stored count, so racing instances agree).
UPDATE notification_events
SET attempts = attempts + 1,
    failed = attempts + 1 >= sqlc.arg('max_attempts')::integer,
    processed_at = CASE WHEN attempts + 1 >= sqlc.arg('max_attempts')::integer THEN now() END,
    next_attempt_at = CASE WHEN attempts + 1 < sqlc.arg('max_attempts')::integer
        THEN now() + interval '1 millisecond' * LEAST(sqlc.arg('retry_base_ms')::bigint * power(2, attempts), sqlc.arg('retry_cap_ms')::bigint) END
WHERE id = sqlc.arg('id')::uuid AND processed_at IS NULL
RETURNING attempts, failed;

-- name: ListNotificationTeamRecipients :many
-- Relation team (§Recipients): users with an active assignment on the job who
-- are still non-stakeholder members of the event's company, company not deleted.
SELECT DISTINCT va.user_id
FROM vacancy_assignments va
JOIN company_members cm ON cm.user_id = va.user_id AND cm.company_id = sqlc.arg('company_id')::uuid
JOIN companies c ON c.id = cm.company_id AND c.deleted_at IS NULL
WHERE va.draft_id = sqlc.arg('job_id')::uuid
  AND va.ended_at IS NULL
  AND cm.role <> 'stakeholder'
ORDER BY va.user_id;

-- name: IsNotificationActiveAssignee :one
-- Relation assignee: the user still holds an active assignment on the job and
-- is a non-stakeholder member of the company, company not deleted.
SELECT EXISTS (
    SELECT 1
    FROM vacancy_assignments va
    JOIN company_members cm ON cm.user_id = va.user_id AND cm.company_id = sqlc.arg('company_id')::uuid
    JOIN companies c ON c.id = cm.company_id AND c.deleted_at IS NULL
    WHERE va.draft_id = sqlc.arg('job_id')::uuid
      AND va.user_id = sqlc.arg('user_id')::uuid
      AND va.ended_at IS NULL
      AND cm.role <> 'stakeholder'
)::boolean AS active;

-- name: IsNotificationCompanyMember :one
-- Relation previous_assignee: still a non-stakeholder member of the company,
-- company not deleted (no assignment required, D10).
SELECT EXISTS (
    SELECT 1
    FROM company_members cm
    JOIN companies c ON c.id = cm.company_id AND c.deleted_at IS NULL
    WHERE cm.company_id = sqlc.arg('company_id')::uuid
      AND cm.user_id = sqlc.arg('user_id')::uuid
      AND cm.role <> 'stakeholder'
)::boolean AS member;

-- name: GetNotificationParticipationCandidate :one
-- Relation candidate: the account behind an organic participation of the job;
-- NULL for a manual candidate (no account).
SELECT candidate_id
FROM process_participations
WHERE id = sqlc.arg('participation_id')::uuid AND process_id = sqlc.arg('job_id')::uuid;

-- name: InsertNotification :exec
-- Immediate notification (D21): a re-processed event inserts nothing twice.
INSERT INTO notifications (id, recipient_user_id, recipient_kind, recipient_reason, company_id, type, group_key, job_id, participation_id, actor_user_id, source_event_id, payload)
VALUES (
    sqlc.arg('id')::uuid,
    sqlc.arg('recipient_user_id')::uuid,
    sqlc.arg('recipient_kind')::text,
    sqlc.arg('recipient_reason')::text,
    sqlc.narg('company_id')::uuid,
    sqlc.arg('type')::text,
    sqlc.arg('group_key')::text,
    sqlc.arg('job_id')::uuid,
    sqlc.narg('participation_id')::uuid,
    sqlc.narg('actor_user_id')::uuid,
    sqlc.arg('source_event_id')::uuid,
    sqlc.arg('payload')::jsonb
)
ON CONFLICT (recipient_user_id, source_event_id, type) WHERE source_event_id IS NOT NULL DO NOTHING;
