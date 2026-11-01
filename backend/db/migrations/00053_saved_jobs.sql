-- +goose Up
-- +goose StatementBegin
-- A candidate's saved public jobs. Exactly one catalog source is referenced, so
-- a hard-deleted job takes its saved rows with it; job_id is the public id.
CREATE TABLE saved_jobs (
    candidate_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    process_id UUID REFERENCES vacancy_processes (id) ON DELETE CASCADE,
    legacy_job_id UUID REFERENCES jobs (id) ON DELETE CASCADE,
    job_id UUID GENERATED ALWAYS AS (COALESCE(process_id, legacy_job_id)) STORED,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT saved_jobs_one_source CHECK (num_nonnulls(process_id, legacy_job_id) = 1),
    PRIMARY KEY (candidate_id, job_id)
);
CREATE INDEX saved_jobs_candidate_idx ON saved_jobs (candidate_id, saved_at DESC, job_id);
CREATE INDEX saved_jobs_process_idx ON saved_jobs (process_id) WHERE process_id IS NOT NULL;
CREATE INDEX saved_jobs_legacy_idx ON saved_jobs (legacy_job_id) WHERE legacy_job_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM saved_jobs) THEN
  RAISE EXCEPTION 'saved jobs exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE saved_jobs;
-- +goose StatementEnd
