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
