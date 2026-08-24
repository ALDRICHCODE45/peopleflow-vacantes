-- name: CreateCompanyMember :one
-- Adds a row to `company_members`. UNIQUE(user_id) means a second insert with
-- the same user_id surfaces SQLSTATE 23505 to the adapter (mapped to
-- ErrMemberExists in the companies/infrastructure layer); FK violations on
-- user_id / company_id surface SQLSTATE 23503 (mapped to ErrUserNotFound /
-- ErrCompanyNotFound).
INSERT INTO company_members (id, user_id, company_id, role)
VALUES ($1, $2, $3, $4)
RETURNING id, user_id, company_id, role, created_at, updated_at;


-- name: GetMembershipByUserID :one
-- Single membership lookup for the membership-resolver chain
-- (`sub → users.id → company_members`) — see design D6. Returns
-- pgx.ErrNoRows when the user has no membership, which the service maps to
-- ErrNotAMember.
SELECT id, user_id, company_id, role, created_at, updated_at
FROM company_members
WHERE user_id = $1;


-- name: ListByCompanyID :many
-- All members of a company (GET /me/company/members), enriched with the
-- user's public identity (full_name, email) via LEFT JOIN. A member whose
-- user can't be resolved (deleted / missing) still surfaces with NULL user
-- columns, so the adapter can render `user: null` instead of dropping the
-- row. Ordered by created_at for stable rendering; backed by
-- `company_members_company_id_idx` B-tree.
SELECT
    cm.id,
    cm.company_id,
    cm.role,
    cm.created_at,
    cm.updated_at,
    u.id AS user_id,
    u.full_name AS user_full_name,
    u.email AS user_email
FROM company_members cm
LEFT JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
WHERE cm.company_id = $1
ORDER BY cm.created_at ASC, cm.id ASC;


-- name: UpdateMemberRole :execrows
-- Same-company guard (design D7): the SQL predicate
-- `id = $1 AND company_id = $2` is the race-free, IDOR-proof boundary for
-- UpdateRole. 0 rows affected → ErrMemberNotFound in the adapter.
-- `updated_at` is touched here so downstream callers never have to remember
-- to do it.
UPDATE company_members
SET role = $3, updated_at = now()
WHERE id = $1 AND company_id = $2;


-- name: RemoveCompanyMember :execrows
-- Same-company guard (design D7) — see UpdateMemberRole for rationale.
-- HARD DELETE (design D2) frees `user_id` for re-assignment.
DELETE FROM company_members
WHERE id = $1 AND company_id = $2;