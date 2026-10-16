-- +goose Up
-- Absence is all-null version zero. Writes serialize on the parent draft row.
CREATE TABLE job_draft_management_configs (
    draft_id UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE,
    version BIGINT NOT NULL
        CONSTRAINT job_draft_management_version_positive CHECK (version > 0),
    request_date DATE,
    hiring_headcount INTEGER
        CONSTRAINT job_draft_management_headcount_range CHECK (hiring_headcount BETWEEN 1 AND 999)
);

-- +goose Down
-- Removes saved management settings; draft and audit history survive.
DROP TABLE job_draft_management_configs;
