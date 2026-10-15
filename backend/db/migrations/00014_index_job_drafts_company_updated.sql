-- +goose Up
-- +goose StatementBegin
-- Keyset index of the employer draft list (GET /v2/me/company/job-drafts),
-- which reads one company's drafts ordered by updated_at DESC, id DESC and
-- resumes after the last (updated_at, id). With this index the list reads only
-- the rows of the page instead of sorting every draft of the company.
--
-- The existing job_drafts_company_id_idx stays: removing it is a separate
-- decision. CREATE INDEX (not CONCURRENTLY) runs inside the goose transaction;
-- it locks writes to job_drafts while it builds, which is acceptable for the
-- current table size.
CREATE INDEX job_drafts_company_updated_id_idx
    ON job_drafts (company_id, updated_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX job_drafts_company_updated_id_idx;
-- +goose StatementEnd
