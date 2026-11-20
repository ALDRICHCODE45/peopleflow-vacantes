-- name: ListReplacementChain :many
-- The whole chain of the logical vacancy `process_id` belongs to: the root first
-- (sequence 0, it has no vacancy_replacements row), then the replacements by
-- sequence. source_process_id is NULL for the root. Empty when the process does
-- not exist in the company.
WITH root AS (
    SELECT COALESCE(r.root_process_id, p.id)::uuid AS id
    FROM vacancy_processes p
    LEFT JOIN vacancy_replacements r ON r.process_id = p.id
    WHERE p.id = @process_id AND p.company_id = @company_id
)
SELECT p.id AS process_id, root.id AS root_process_id, COALESCE(r.sequence, 0)::int AS sequence,
    p.status, p.process_status, r.source_process_id
FROM root
JOIN vacancy_processes p ON p.company_id = @company_id
LEFT JOIN vacancy_replacements r ON r.process_id = p.id
WHERE p.id = root.id OR r.root_process_id = root.id
ORDER BY sequence, p.id;

-- name: GetReplacementSuccessor :one
-- The replacement started from `process_id`, if any.
SELECT r.process_id
FROM vacancy_replacements r
WHERE r.source_process_id = @process_id AND r.company_id = @company_id
ORDER BY r.sequence DESC
LIMIT 1;

-- name: ListStartableReplacementCredits :many
-- Fallen credits (did_not_hold) of any process of the chain rooted at `root_process_id`
-- that no replacement has taken yet.
SELECT c.id, c.process_id, c.participation_id, c.hired_at, c.exit_reason, c.status_changed_at
FROM placement_credits c
WHERE c.company_id = @company_id
  AND c.status = 'did_not_hold'
  AND (c.process_id = @root_process_id
       OR c.process_id IN (SELECT r.process_id FROM vacancy_replacements r WHERE r.root_process_id = @root_process_id))
  AND NOT EXISTS (SELECT 1 FROM vacancy_replacement_credits vc WHERE vc.placement_credit_id = c.id)
ORDER BY c.hired_at, c.id;

-- name: GetProcessCloseState :one
-- Publication status and the reason of the latest close event (empty when never
-- closed or closed without reason): the inputs of the closed-covered predicate.
SELECT p.status,
    COALESCE((SELECT e.reason FROM vacancy_lifecycle_events e
     WHERE e.process_id = p.id AND e.action = 'close'
     ORDER BY e.lifecycle_version DESC LIMIT 1), '')::text AS close_reason
FROM vacancy_processes p
WHERE p.id = @process_id AND p.company_id = @company_id;

-- name: ListReplacementChainItems :many
-- The processes of the chain rooted at `root_process_id` with what GET V/replacements
-- lists per item: the root first (sequence 0), then the replacements by sequence.
-- can_open is the lifecycle read rule: the owner, or an active tramo on that draft.
SELECT p.id AS process_id, COALESCE(r.sequence, 0)::int AS sequence, r.source_process_id,
    COALESCE(convert_from(d.fields, 'UTF8')::jsonb->'fields'->>'title', '')::text AS title,
    p.status, p.process_status, p.published_at, p.closed_at,
    u.id AS started_by_id, u.full_name AS started_by_name,
    EXISTS (SELECT 1 FROM vacancy_public_projections pp WHERE pp.id = p.id) AS has_projection,
    COALESCE((SELECT e.reason FROM vacancy_lifecycle_events e
     WHERE e.process_id = p.id AND e.action = 'close' AND p.status = 'closed'
     ORDER BY e.lifecycle_version DESC LIMIT 1), '')::text AS close_reason,
    m.hiring_headcount,
    (@is_owner::boolean OR EXISTS (SELECT 1 FROM vacancy_assignments a
     WHERE a.draft_id = p.id AND a.user_id = @actor_id AND a.ended_at IS NULL))::boolean AS can_open
FROM vacancy_processes p
JOIN job_drafts d ON d.id = p.id
JOIN users u ON u.id = p.published_by
LEFT JOIN vacancy_replacements r ON r.process_id = p.id
LEFT JOIN job_draft_management_configs m ON m.draft_id = p.id
WHERE p.company_id = @company_id AND (p.id = @root_process_id OR r.root_process_id = @root_process_id)
ORDER BY sequence, p.id;

-- name: ListChainReplacedCredits :many
-- The credits each replacement of the chain took, oldest hire first.
SELECT vc.replacement_process_id, vc.placement_credit_id
FROM vacancy_replacement_credits vc
JOIN vacancy_replacements r ON r.process_id = vc.replacement_process_id
JOIN placement_credits c ON c.id = vc.placement_credit_id
WHERE r.company_id = @company_id AND r.root_process_id = @root_process_id
ORDER BY c.hired_at, c.id;

-- name: ListStartableCreditDetails :many
-- ListStartableReplacementCredits with the hired candidate and the departure time.
-- The name is the board's company view: the company's correction of an organic
-- candidate's name wins over the account's.
SELECT c.id, c.process_id, c.participation_id, c.hired_at, c.exit_reason,
    COALESCE(h.created_at, c.status_changed_at)::timestamptz AS left_at,
    CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END::text AS candidate_kind,
    COALESCE(p.company_candidate_id, p.candidate_id)::uuid AS candidate_id,
    (CASE WHEN jsonb_exists(o.corrections, 'full_name') THEN o.corrections->>'full_name'
          ELSE COALESCE(cc.full_name, cu.full_name) END)::text AS full_name
FROM placement_credits c
JOIN process_participations p ON p.id = c.participation_id AND p.process_id = c.process_id
LEFT JOIN participation_stage_history h ON h.id = c.exit_history_id
LEFT JOIN users cu ON cu.id = p.candidate_id
LEFT JOIN company_candidates cc ON cc.id = p.company_candidate_id AND cc.company_id = c.company_id
LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id = p.candidate_id AND o.company_id = c.company_id
WHERE c.company_id = @company_id
  AND c.status = 'did_not_hold'
  AND (c.process_id = @root_process_id
       OR c.process_id IN (SELECT r.process_id FROM vacancy_replacements r WHERE r.root_process_id = @root_process_id))
  AND NOT EXISTS (SELECT 1 FROM vacancy_replacement_credits vc WHERE vc.placement_credit_id = c.id)
ORDER BY c.hired_at, c.id;

-- name: ListStartableCreditRecipients :many
-- The frozen recipients of the startable credits, by user id (as the board's credit list).
SELECT rc.credit_id, rc.user_id, u.full_name, rc.kind
FROM placement_credit_recipients rc
JOIN users u ON u.id = rc.user_id
JOIN placement_credits c ON c.id = rc.credit_id
WHERE c.company_id = @company_id
  AND c.status = 'did_not_hold'
  AND (c.process_id = @root_process_id
       OR c.process_id IN (SELECT r.process_id FROM vacancy_replacements r WHERE r.root_process_id = @root_process_id))
  AND NOT EXISTS (SELECT 1 FROM vacancy_replacement_credits vc WHERE vc.placement_credit_id = c.id)
ORDER BY rc.credit_id, rc.user_id;

-- name: ListFallenCreditDetails :many
-- Every fallen (did_not_hold) credit of the chain rooted at `root_process_id`, whether or
-- not a replacement took it (replaced_by_process_id), with the hired candidate and the
-- departure time (the same views as ListStartableCreditDetails). Voided and active credits
-- are not fallen. Ordered by departure, then hire.
SELECT c.id, c.process_id, c.participation_id, c.hired_at, c.exit_reason,
    COALESCE(h.created_at, c.status_changed_at)::timestamptz AS left_at,
    CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END::text AS candidate_kind,
    COALESCE(p.company_candidate_id, p.candidate_id)::uuid AS candidate_id,
    (CASE WHEN jsonb_exists(o.corrections, 'full_name') THEN o.corrections->>'full_name'
          ELSE COALESCE(cc.full_name, cu.full_name) END)::text AS full_name,
    vc.replacement_process_id AS replaced_by_process_id
FROM placement_credits c
JOIN process_participations p ON p.id = c.participation_id AND p.process_id = c.process_id
LEFT JOIN participation_stage_history h ON h.id = c.exit_history_id
LEFT JOIN users cu ON cu.id = p.candidate_id
LEFT JOIN company_candidates cc ON cc.id = p.company_candidate_id AND cc.company_id = c.company_id
LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id = p.candidate_id AND o.company_id = c.company_id
LEFT JOIN vacancy_replacement_credits vc ON vc.placement_credit_id = c.id
WHERE c.company_id = @company_id
  AND c.status = 'did_not_hold'
  AND (c.process_id = @root_process_id
       OR c.process_id IN (SELECT r.process_id FROM vacancy_replacements r WHERE r.root_process_id = @root_process_id))
ORDER BY left_at, c.hired_at, c.id;
