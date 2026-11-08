-- Stakeholder invitations (stakeholder-metrics-v1 §1.3). Every write runs in
-- the adapter's transaction together with its audit event.

-- name: CountPendingStakeholderInvitations :one
-- Run after LockCompanyForMemberMutation so two creates cannot both pass the limit.
SELECT count(*) FROM stakeholder_invitations
WHERE company_id = $1 AND revoked_at IS NULL AND used_at IS NULL AND expires_at > $2;

-- name: CreateStakeholderInvitation :exec
INSERT INTO stakeholder_invitations (id, company_id, token_sha256, created_by, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: ListPendingStakeholderInvitations :many
SELECT id, created_at, created_by, expires_at FROM stakeholder_invitations
WHERE company_id = $1 AND revoked_at IS NULL AND used_at IS NULL AND expires_at > $2
ORDER BY created_at DESC, id DESC;

-- name: RevokeStakeholderInvitation :execrows
-- Only a pending invitation of the caller's company changes; anything else
-- affects no row and the DELETE still answers 204.
UPDATE stakeholder_invitations SET revoked_at = $3
WHERE id = $1 AND company_id = $2 AND revoked_at IS NULL AND used_at IS NULL AND expires_at > $3;

-- name: GetStakeholderInvitationByTokenForUpdate :one
-- The accept holds this row lock until commit, so two accepts of one token
-- yield one member.
SELECT id, company_id, expires_at, revoked_at, used_at, used_by, member_id
FROM stakeholder_invitations
WHERE token_sha256 = $1
FOR UPDATE;

-- name: StakeholderMembershipExists :one
-- The replay check: the membership the invitation created still exists.
SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE id = $1 AND user_id = $2 AND company_id = $3 AND role = 'stakeholder'
);

-- name: LockLiveCompanyForShare :one
-- A soft-deleted company accepts no new member.
SELECT id FROM companies WHERE id = $1 AND deleted_at IS NULL FOR SHARE;

-- name: MarkStakeholderInvitationUsed :exec
UPDATE stakeholder_invitations SET used_at = $2, used_by = $3, member_id = $4
WHERE id = $1;
