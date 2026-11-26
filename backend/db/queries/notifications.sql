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

-- name: ListScheduledDeliveryRecipients :many
-- Scheduler (notifications-v1 §Scheduler, D20, Q1): every team recipient of
-- an active published or paused process with a commitment date up to
-- today + 1 and no fulfillment row. Recipients at run time, same rules as the
-- fan-out team relation (active assignment, non-stakeholder member, company
-- not deleted); the caller applies the date rule.
SELECT vp.id AS job_id, vp.company_id, dc.commitment_date::date AS commitment_date, va.user_id
FROM vacancy_processes vp
JOIN job_draft_delivery_configs dc ON dc.draft_id = vp.id
JOIN companies c ON c.id = vp.company_id AND c.deleted_at IS NULL
JOIN vacancy_assignments va ON va.draft_id = vp.id AND va.ended_at IS NULL
JOIN company_members cm ON cm.user_id = va.user_id AND cm.company_id = vp.company_id AND cm.role <> 'stakeholder'
WHERE vp.process_status = 'active'
  AND vp.status IN ('published', 'paused')
  AND dc.commitment_date IS NOT NULL
  AND dc.commitment_date <= sqlc.arg('until')::date
  AND NOT EXISTS (SELECT 1 FROM process_delivery_fulfillments f WHERE f.process_id = vp.id)
ORDER BY vp.id, va.user_id;

-- name: ListScheduledAssignmentDeadlines :many
-- Per-recruiter deadlines (Q7): active assignments with a recruiter_deadline
-- up to today + 1, same process filter, whose user is still a non-stakeholder
-- member of the company (company not deleted). function is the open function
-- of the assignment (NULL if none is open).
SELECT va.id AS assignment_id, vp.id AS job_id, vp.company_id, va.user_id, va.recruiter_deadline::date AS recruiter_deadline, vaf.function
FROM vacancy_assignments va
JOIN vacancy_processes vp ON vp.id = va.draft_id
JOIN companies c ON c.id = vp.company_id AND c.deleted_at IS NULL
JOIN company_members cm ON cm.user_id = va.user_id AND cm.company_id = vp.company_id AND cm.role <> 'stakeholder'
LEFT JOIN vacancy_assignment_functions vaf ON vaf.assignment_id = va.id AND vaf.ended_at IS NULL
WHERE va.ended_at IS NULL
  AND va.recruiter_deadline IS NOT NULL
  AND va.recruiter_deadline <= sqlc.arg('until')::date
  AND vp.process_status = 'active'
  AND vp.status IN ('published', 'paused')
  AND NOT EXISTS (SELECT 1 FROM process_delivery_fulfillments f WHERE f.process_id = vp.id)
ORDER BY vp.id, va.user_id;

-- name: InsertScheduledNotification :execrows
-- Scheduled notification (D21): each (recipient, type, job, date) fires at
-- most once; a renegotiated date is a new key. No actor, no source event.
INSERT INTO notifications (id, recipient_user_id, recipient_kind, recipient_reason, company_id, type, group_key, job_id, commitment_date, payload)
VALUES (
    sqlc.arg('id')::uuid,
    sqlc.arg('recipient_user_id')::uuid,
    'member',
    sqlc.arg('recipient_reason')::text,
    sqlc.arg('company_id')::uuid,
    sqlc.arg('type')::text,
    sqlc.arg('group_key')::text,
    sqlc.arg('job_id')::uuid,
    sqlc.arg('commitment_date')::date,
    sqlc.arg('payload')::jsonb
)
ON CONFLICT (recipient_user_id, type, job_id, commitment_date) WHERE commitment_date IS NOT NULL DO NOTHING;

-- name: ResolveStaleScheduledNotifications :execrows
-- Resolution (D20, §Scheduler): an open deadline item stops being true when
-- the process is no longer active published/paused (closed with any process
-- value, finished, gone) or has a fulfillment row; a delivery item when the
-- current commitment_date differs (renegotiated or cleared); an assignment
-- item when its assignment ended or its recruiter_deadline differs (changed
-- or cleared); a due-soon item when an overdue item exists for the same
-- recipient, job and date.
UPDATE notifications n
SET resolved_at = now()
WHERE n.resolved_at IS NULL
  AND n.commitment_date IS NOT NULL
  AND (
    NOT EXISTS (
        SELECT 1 FROM vacancy_processes vp
        WHERE vp.id = n.job_id AND vp.process_status = 'active' AND vp.status IN ('published', 'paused'))
    OR EXISTS (SELECT 1 FROM process_delivery_fulfillments f WHERE f.process_id = n.job_id)
    OR (n.type IN ('delivery_due_soon', 'delivery_overdue') AND NOT EXISTS (
        SELECT 1 FROM job_draft_delivery_configs dc
        WHERE dc.draft_id = n.job_id AND dc.commitment_date = n.commitment_date))
    OR (n.type IN ('assignment_deadline_due_soon', 'assignment_deadline_overdue') AND NOT EXISTS (
        SELECT 1 FROM vacancy_assignments va
        WHERE va.id::text = n.payload->>'assignment_id'
          AND va.draft_id = n.job_id
          AND va.user_id = n.recipient_user_id
          AND va.ended_at IS NULL
          AND va.recruiter_deadline = n.commitment_date))
    OR (n.type IN ('delivery_due_soon', 'assignment_deadline_due_soon') AND EXISTS (
        SELECT 1 FROM notifications o
        WHERE o.recipient_user_id = n.recipient_user_id
          AND o.job_id = n.job_id
          AND o.commitment_date = n.commitment_date
          AND o.type = CASE n.type WHEN 'delivery_due_soon' THEN 'delivery_overdue' ELSE 'assignment_deadline_overdue' END))
  );
