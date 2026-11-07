-- +goose Up
-- +goose StatementBegin
-- stakeholder-metrics-v1 §1: a read-only `stakeholder` membership role next to
-- owner and recruiter, and the copyable single-use invitation that creates it.
ALTER TABLE company_members
    DROP CONSTRAINT company_members_role_check,
    ADD CONSTRAINT company_members_role_check
        CHECK (role IN ('owner', 'recruiter', 'stakeholder'));

-- One invitation link. Only the SHA-256 of the url token is stored; the token
-- itself is shown once at creation. A row is pending while revoked_at and
-- used_at are NULL and expires_at is in the future. used_by + member_id let an
-- accept replay by the same user recognize the membership it created (F2);
-- member_id has no FK so a removed membership simply stops matching.
CREATE TABLE stakeholder_invitations (
    id           UUID PRIMARY KEY,
    company_id   UUID NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
    token_sha256 BYTEA NOT NULL
        CONSTRAINT stakeholder_invitations_token_sha256_key UNIQUE
        CONSTRAINT stakeholder_invitations_token_sha256_length CHECK (octet_length(token_sha256) = 32),
    created_by   UUID NOT NULL REFERENCES users (id),
    created_at   TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    used_at      TIMESTAMPTZ,
    used_by      UUID REFERENCES users (id),
    member_id    UUID,
    CONSTRAINT stakeholder_invitations_expiry CHECK (expires_at > created_at),
    CONSTRAINT stakeholder_invitations_use CHECK ((used_at IS NULL) = (used_by IS NULL) AND (used_at IS NULL) = (member_id IS NULL)),
    CONSTRAINT stakeholder_invitations_revoked_or_used CHECK (revoked_at IS NULL OR used_at IS NULL)
);

-- The pending list and the 20-pending limit read this partial index.
CREATE INDEX stakeholder_invitations_pending_idx
    ON stakeholder_invitations (company_id, created_at DESC)
    WHERE revoked_at IS NULL AND used_at IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE stakeholder_invitations;
-- Dev data is disposable: stakeholders cannot exist under the old role set.
DELETE FROM company_members WHERE role = 'stakeholder';
ALTER TABLE company_members
    DROP CONSTRAINT company_members_role_check,
    ADD CONSTRAINT company_members_role_check
        CHECK (role IN ('owner', 'recruiter'));
-- +goose StatementEnd
