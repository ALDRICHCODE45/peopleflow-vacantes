-- +goose Up
-- One optional substate catalog per draft. Absence means an empty catalog at
-- version zero. Parent draft locking serializes even concurrent first PUTs.
-- Draft and pipeline fields, versions and timestamps are never changed here.
CREATE TABLE job_draft_substate_catalogs (
    draft_id UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE,
    version BIGINT NOT NULL
        CONSTRAINT job_draft_substate_version_positive CHECK (version > 0),
    catalog BYTEA NOT NULL
);

-- +goose Down
-- Audit rows deliberately survive removal of the substate catalog table.
DROP TABLE job_draft_substate_catalogs;
