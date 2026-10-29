-- +goose Up
-- +goose StatementBegin
CREATE TABLE job_draft_psychometric_profiles (
 draft_id UUID PRIMARY KEY REFERENCES job_drafts(id) ON DELETE CASCADE,
 version BIGINT NOT NULL CHECK (version > 0),
 profile JSONB NOT NULL
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
LOCK TABLE job_draft_psychometric_profiles IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM job_draft_psychometric_profiles) THEN
  RAISE EXCEPTION 'psychometric profile data exist; rollback requires an explicit retention decision';
 END IF;
END $$;
DROP TABLE job_draft_psychometric_profiles;
-- +goose StatementEnd
