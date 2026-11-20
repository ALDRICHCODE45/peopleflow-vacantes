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
