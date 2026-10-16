-- +goose Up
-- Absence is all-null at version zero; first PUT materializes version one.
-- Delivery and pipeline writes serialize on the same parent draft row.
CREATE TABLE job_draft_delivery_configs (
    draft_id UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE,
    version BIGINT NOT NULL
        CONSTRAINT job_draft_delivery_version_positive CHECK (version > 0),
    cutoff_stage_id UUID,
    target_quantity INTEGER
        CONSTRAINT job_draft_delivery_target_range CHECK (target_quantity BETWEEN 1 AND 999),
    commitment_date DATE
);

-- +goose Down
-- Removes saved delivery settings, not the parent draft or its audit history.
DROP TABLE job_draft_delivery_configs;
