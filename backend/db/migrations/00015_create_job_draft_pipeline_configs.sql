-- +goose Up
-- One optional configuration per draft; absence means deterministic defaults at
-- version zero. Locking the parent draft serializes even concurrent first PUTs.
-- Draft fields/version/timestamps are never updated by a pipeline write.
CREATE TABLE job_draft_pipeline_configs (
    draft_id      UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE,
    version       BIGINT NOT NULL
        CONSTRAINT job_draft_pipeline_version_positive CHECK (version > 0),
    configuration BYTEA NOT NULL
);

-- +goose Down
-- Audit rows deliberately survive removal of the configuration table.
DROP TABLE job_draft_pipeline_configs;
