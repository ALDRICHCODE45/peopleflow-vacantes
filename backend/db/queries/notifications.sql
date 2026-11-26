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

-- Read and mark queries below run in the caller's scope (notifications-v1
-- §Data model, D18): recipient_user_id = the session user and either
-- recipient_kind 'member' with company_id = the gate's company (members) or
-- recipient_kind 'candidate' with company_id NULL (candidates). The CHECK
-- (recipient_kind = 'candidate') = (company_id IS NULL) makes any other
-- combination match nothing.

-- name: ListNotificationAttention :many
-- Attention (notifications-v1 D13), the single source of the selection: the
-- caller's unread, unresolved items of the attention types (passed by the
-- caller from the domain type table) in the caller's scope, honouring types /
-- job_ids (not state), newest first, capped; total counts every qualifying
-- item. Computed on every page: its ids are excluded from the grouped list.
SELECT n.id, n.group_key, n.type, n.job_id, n.participation_id, n.actor_user_id, n.payload, n.created_at,
       count(*) OVER () AS total
FROM notifications n
WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
  AND n.recipient_kind = sqlc.arg('recipient_kind')::text
  AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
  AND n.type = ANY (sqlc.arg('attention_types')::text[])
  AND n.read_at IS NULL
  AND n.resolved_at IS NULL
  AND (cardinality(sqlc.arg('types')::text[]) = 0 OR n.type = ANY (sqlc.arg('types')::text[]))
  AND (cardinality(sqlc.arg('job_ids')::uuid[]) = 0 OR n.job_id = ANY (sqlc.arg('job_ids')::uuid[]))
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('attention_limit')::integer;

-- name: ListNotificationGroups :many
-- Grouped list (D11, D13, D27): the caller's scoped rows matching
-- types / job_ids, minus the attention ids returned by
-- ListNotificationAttention for the same filters (so only those are
-- excluded), grouped by group_key (one type and job per group), optionally
-- only groups with an unread member, keyset after (at, key) in latest_at DESC,
-- group_key DESC order. latest is the newest row of the group.
WITH grouped AS (
    SELECT n.group_key, n.type, n.job_id,
           count(*) AS total,
           count(*) FILTER (WHERE n.read_at IS NULL AND n.resolved_at IS NULL) AS unread,
           max(n.created_at)::timestamptz AS latest_at,
           min(n.created_at)::timestamptz AS first_at,
           bool_and(n.resolved_at IS NOT NULL) AS resolved
    FROM notifications n
    WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
      AND n.recipient_kind = sqlc.arg('recipient_kind')::text
      AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
      AND (cardinality(sqlc.arg('types')::text[]) = 0 OR n.type = ANY (sqlc.arg('types')::text[]))
      AND (cardinality(sqlc.arg('job_ids')::uuid[]) = 0 OR n.job_id = ANY (sqlc.arg('job_ids')::uuid[]))
      AND NOT (n.id = ANY (sqlc.arg('exclude_ids')::uuid[]))
    GROUP BY n.group_key, n.type, n.job_id
)
SELECT g.group_key, g.type, g.job_id, g.total, g.unread, g.latest_at, g.first_at, g.resolved,
       l.id AS latest_id, l.created_at AS latest_created_at, l.actor_user_id AS latest_actor_user_id,
       l.participation_id AS latest_participation_id, l.payload AS latest_payload
FROM grouped g
CROSS JOIN LATERAL (
    SELECT x.id, x.created_at, x.actor_user_id, x.participation_id, x.payload
    FROM notifications x
    WHERE x.recipient_user_id = sqlc.arg('user_id')::uuid
      AND x.recipient_kind = sqlc.arg('recipient_kind')::text
      AND x.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
      AND x.group_key = g.group_key
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT 1
) l
WHERE (NOT sqlc.arg('unread_only')::boolean OR g.unread > 0)
  AND (sqlc.narg('after_at')::timestamptz IS NULL
       OR (g.latest_at, g.group_key) < (sqlc.narg('after_at')::timestamptz, sqlc.narg('after_key')::text))
ORDER BY g.latest_at DESC, g.group_key DESC
LIMIT sqlc.arg('page_limit')::integer;

-- name: ListMemberNotificationSamples :many
-- Group sample (§Grouping): per group, the newest distinct participations
-- (at most sample_limit) of the caller's member-scope rows.
SELECT s.group_key, s.participation_id::uuid AS participation_id
FROM (
    SELECT n.group_key, n.participation_id,
           row_number() OVER (PARTITION BY n.group_key ORDER BY max(n.created_at) DESC, n.participation_id DESC) AS rank
    FROM notifications n
    WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
      AND n.recipient_kind = 'member'
      AND n.company_id = sqlc.arg('company_id')::uuid
      AND n.group_key = ANY (sqlc.arg('group_keys')::text[])
      AND n.participation_id IS NOT NULL
    GROUP BY n.group_key, n.participation_id
) s
WHERE s.rank <= sqlc.arg('sample_limit')::integer
ORDER BY s.group_key, s.rank;

-- name: ListNotificationJobs :many
-- Read-time job resolution (D19): the current draft title of each job of the
-- company and whether the caller can still open it (owner of the company or
-- an active assignment on it). Jobs of other companies or gone are absent;
-- has_title is false when the draft has no title.
SELECT d.id,
       ((convert_from(d.fields, 'UTF8')::jsonb -> 'fields' ->> 'title') IS NOT NULL)::boolean AS has_title,
       COALESCE(convert_from(d.fields, 'UTF8')::jsonb -> 'fields' ->> 'title', '')::text AS title,
       (sqlc.arg('is_owner')::boolean OR EXISTS (
           SELECT 1 FROM vacancy_assignments va
           WHERE va.draft_id = d.id
             AND va.company_id = d.company_id
             AND va.user_id = sqlc.arg('user_id')::uuid
             AND va.ended_at IS NULL))::boolean AS can_open
FROM job_drafts d
WHERE d.company_id = sqlc.arg('company_id')::uuid
  AND d.id = ANY (sqlc.arg('job_ids')::uuid[]);

-- name: ListNotificationCandidateNames :many
-- Read-time candidate names (D19): the name the company currently sees for
-- each participation of one of its processes (company correction, else the
-- manual candidate or account name; '' when unknown). The caller gates it by
-- vacancy access.
SELECT p.id, p.process_id,
       COALESCE(CASE WHEN o.corrections ? 'full_name' THEN o.corrections ->> 'full_name'
                     ELSE COALESCE(cc.full_name, u.full_name) END, '')::text AS name
FROM process_participations p
JOIN vacancy_processes vp ON vp.id = p.process_id AND vp.company_id = sqlc.arg('company_id')::uuid
LEFT JOIN users u ON u.id = p.candidate_id AND u.deleted_at IS NULL
LEFT JOIN company_candidates cc ON cc.id = p.company_candidate_id AND cc.company_id = vp.company_id
LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id = p.candidate_id AND o.company_id = vp.company_id
WHERE p.id = ANY (sqlc.arg('participation_ids')::uuid[]);

-- name: ListNotificationUserNames :many
-- Read-time names of actors and from/to users (D19): the current account name;
-- for a candidate account the company's correction wins and is_candidate lets
-- the caller gate it like a candidate name. Deleted users are absent.
SELECT u.id, (u.user_type = 'candidate')::boolean AS is_candidate,
       COALESCE(CASE WHEN o.corrections ? 'full_name' THEN o.corrections ->> 'full_name' ELSE u.full_name END, '')::text AS name
FROM users u
LEFT JOIN company_candidate_corrections o ON u.user_type = 'candidate' AND o.user_id = u.id AND o.company_id = sqlc.arg('company_id')::uuid
WHERE u.id = ANY (sqlc.arg('user_ids')::uuid[])
  AND u.deleted_at IS NULL;

-- name: CountUnreadNotifications :one
-- Bell counter (D14): unread groups (attention included) and unread rows of
-- the caller's scope, from notifications_recipient_unread.
SELECT count(DISTINCT n.group_key)::integer AS unread_groups, count(*)::integer AS unread_notifications
FROM notifications n
WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
  AND n.recipient_kind = sqlc.arg('recipient_kind')::text
  AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
  AND n.read_at IS NULL
  AND n.resolved_at IS NULL;

-- name: MarkNotificationsRead :one
-- POST B/read (D15, D26): stamps one statement timestamp on the caller's
-- unread, unresolved scoped rows selected by group key or id (the
-- other array is empty); rows of others are not matched. Returns the stamp
-- and the affected rows / distinct groups.
WITH stamp AS (
    SELECT statement_timestamp() AS at
), marked AS (
    UPDATE notifications n
    SET read_at = (SELECT at FROM stamp)
    WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
      AND n.recipient_kind = sqlc.arg('recipient_kind')::text
      AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
      AND n.read_at IS NULL
      AND n.resolved_at IS NULL
      AND (n.group_key = ANY (sqlc.arg('group_keys')::text[]) OR n.id = ANY (sqlc.arg('ids')::uuid[]))
    RETURNING n.group_key
)
SELECT (SELECT at FROM stamp)::timestamptz AS marked_at,
       count(*)::integer AS affected_notifications,
       count(DISTINCT m.group_key)::integer AS affected_groups
FROM marked m;

-- name: MarkNotificationsUnread :one
-- POST B/unread (D15, D26): clears read_at on the caller's read, unresolved
-- scoped rows selected by group key, id or the exact read_at of an
-- earlier mark (undo of exactly that batch); a resolved row stays read.
WITH stamp AS (
    SELECT statement_timestamp() AS at
), marked AS (
    UPDATE notifications n
    SET read_at = NULL
    WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
      AND n.recipient_kind = sqlc.arg('recipient_kind')::text
      AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
      AND n.read_at IS NOT NULL
      AND n.resolved_at IS NULL
      AND (n.group_key = ANY (sqlc.arg('group_keys')::text[])
           OR n.id = ANY (sqlc.arg('ids')::uuid[])
           OR n.read_at = sqlc.narg('marked_at')::timestamptz)
    RETURNING n.group_key
)
SELECT (SELECT at FROM stamp)::timestamptz AS marked_at,
       count(*)::integer AS affected_notifications,
       count(DISTINCT m.group_key)::integer AS affected_groups
FROM marked m;

-- name: MarkAllNotificationsRead :one
-- POST B/read-all (D16): stamps one statement timestamp on every unread,
-- unresolved scoped row of the caller matching types / job_ids (empty =
-- all) created at or before `before` (NULL = the stamp), attention included.
WITH stamp AS (
    SELECT statement_timestamp() AS at
), marked AS (
    UPDATE notifications n
    SET read_at = (SELECT at FROM stamp)
    WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
      AND n.recipient_kind = sqlc.arg('recipient_kind')::text
      AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
      AND n.read_at IS NULL
      AND n.resolved_at IS NULL
      AND (cardinality(sqlc.arg('types')::text[]) = 0 OR n.type = ANY (sqlc.arg('types')::text[]))
      AND (cardinality(sqlc.arg('job_ids')::uuid[]) = 0 OR n.job_id = ANY (sqlc.arg('job_ids')::uuid[]))
      AND n.created_at <= COALESCE(sqlc.narg('before')::timestamptz, (SELECT at FROM stamp))
    RETURNING n.group_key
)
SELECT (SELECT at FROM stamp)::timestamptz AS marked_at,
       count(*)::integer AS affected_notifications,
       count(DISTINCT m.group_key)::integer AS affected_groups
FROM marked m;

-- name: ListNotificationFacetTypes :many
-- GET B/facets (D17): groups of the caller's scope (attention
-- included) per type, only groups with an unread member when unread_only;
-- zero counts are absent.
SELECT g.type, count(*)::integer AS count
FROM (
    SELECT n.group_key, n.type, bool_or(n.read_at IS NULL AND n.resolved_at IS NULL) AS unread
    FROM notifications n
    WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
      AND n.recipient_kind = sqlc.arg('recipient_kind')::text
      AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
    GROUP BY n.group_key, n.type
) g
WHERE NOT sqlc.arg('unread_only')::boolean OR g.unread
GROUP BY g.type
ORDER BY count(*) DESC, g.type;

-- name: ListNotificationFacetJobs :many
-- GET B/facets (D17): the same groups per job with the current title
-- (members: the draft title of the company; candidates: the public title they
-- see in /v2/me/applications, only for a process they participate in;
-- has_title false when gone or untitled), ordered by count
-- DESC, title (untitled last), job id; capped at jobs_limit, total = every
-- job with a group in that state.
WITH jobs AS (
    SELECT g.job_id, count(*) AS count
    FROM (
        SELECT n.group_key, n.job_id, bool_or(n.read_at IS NULL AND n.resolved_at IS NULL) AS unread
        FROM notifications n
        WHERE n.recipient_user_id = sqlc.arg('user_id')::uuid
          AND n.recipient_kind = sqlc.arg('recipient_kind')::text
          AND n.company_id IS NOT DISTINCT FROM sqlc.narg('company_id')::uuid
        GROUP BY n.group_key, n.job_id
    ) g
    WHERE NOT sqlc.arg('unread_only')::boolean OR g.unread
    GROUP BY g.job_id
), titled AS (
    SELECT j.job_id, j.count,
           CASE WHEN sqlc.arg('recipient_kind')::text = 'candidate' THEN (
               SELECT v.title FROM vacancy_public_projections v
               WHERE v.id = j.job_id
                 AND EXISTS (SELECT 1 FROM process_participations p
                             WHERE p.process_id = v.id AND p.candidate_id = sqlc.arg('user_id')::uuid))
           ELSE (
               SELECT convert_from(d.fields, 'UTF8')::jsonb -> 'fields' ->> 'title' FROM job_drafts d
               WHERE d.id = j.job_id AND d.company_id = sqlc.narg('company_id')::uuid)
           END AS title
    FROM jobs j
)
SELECT t.job_id, (t.title IS NOT NULL)::boolean AS has_title, COALESCE(t.title, '')::text AS title,
       t.count::integer AS count, (count(*) OVER ())::integer AS total
FROM titled t
ORDER BY t.count DESC, t.title NULLS LAST, t.job_id
LIMIT sqlc.arg('jobs_limit')::integer;

-- name: GetNotificationCandidateUser :one
-- Candidate scope (notifications-v1 D18): the live candidate account of the
-- session subject, resolved after the candidate gate passed.
SELECT u.id FROM users u
WHERE u.cognito_sub = sqlc.arg('cognito_sub')::text
  AND u.user_type = 'candidate'
  AND u.deleted_at IS NULL;

-- name: ListCandidateNotificationJobs :many
-- Read-time job resolution for candidates (§Endpoints): the title the
-- candidate sees in /v2/me/applications (public projection; has_title false
-- when absent) and the company {id, name} of the process, only for processes
-- the candidate participates in. Jobs gone or foreign are absent.
SELECT vp.id,
       (v.title IS NOT NULL)::boolean AS has_title,
       COALESCE(v.title, '')::text AS title,
       c.id AS company_id,
       c.name AS company_name
FROM vacancy_processes vp
JOIN companies c ON c.id = vp.company_id
LEFT JOIN vacancy_public_projections v ON v.id = vp.id
WHERE vp.id = ANY (sqlc.arg('job_ids')::uuid[])
  AND EXISTS (SELECT 1 FROM process_participations p
              WHERE p.process_id = vp.id AND p.candidate_id = sqlc.arg('user_id')::uuid);
