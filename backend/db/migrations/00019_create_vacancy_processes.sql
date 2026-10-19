-- +goose Up
-- P1 employer-only process; legacy jobs/applications and draft versions stay intact.
CREATE TABLE vacancy_processes (
    id UUID PRIMARY KEY REFERENCES job_drafts (id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies (id),
    status TEXT NOT NULL CONSTRAINT vacancy_process_status CHECK (status IN ('published')),
    published_at TIMESTAMPTZ NOT NULL,
    published_by UUID NOT NULL REFERENCES users (id)
);

-- +goose Down
-- Removes publication state, not draft/configuration data or publication audits.
DROP TABLE vacancy_processes;
